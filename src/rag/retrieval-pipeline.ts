import type { JsonFileBM25Index } from './bm25';
import type { VectorEntry, VectorStore } from './store';
import type { CachedMetadata, TFile } from 'obsidian';
import { assignVectorClustersRust, rankTopKPairsRust, recomputeCentroidsRust } from './rust-core';

export type RetrievalCandidateSource =
  | 'vector'
  | 'bm25'
  | 'ann'
  | 'structural'
  | 'graph-local'
  | 'graph-global'
  | 'evidence';

export interface RagRetrievalRequest {
  question: string;
  queryVector: number[];
  candidateLimit: number;
  isEntryCompatible?: (entry: VectorEntry) => boolean;
}

export interface RetrievalCandidate {
  entry: VectorEntry;
  source: RetrievalCandidateSource;
  sourceScore?: number;
  rank?: number;
  reason?: string;
}

export interface MergedRetrievalCandidate {
  entry: VectorEntry;
  sources: RetrievalCandidateSource[];
  sourceScores: Partial<Record<RetrievalCandidateSource, number>>;
  sourceRanks: Partial<Record<RetrievalCandidateSource, number>>;
  reasons: string[];
}

export interface CandidateProvider {
  id: string;
  source: RetrievalCandidateSource;
  deadlineMs: number;
  getCandidates(request: RagRetrievalRequest, signal?: AbortSignal): Promise<RetrievalCandidate[]>;
}

export type RetrievalProviderStatus = 'ok' | 'timeout' | 'error';

export interface RetrievalProviderDiagnostic {
  providerId: string;
  source: RetrievalCandidateSource;
  status: RetrievalProviderStatus;
  durationMs: number;
  candidateCount: number;
  error?: string;
}

export interface RagRetrievalResult {
  candidates: MergedRetrievalCandidate[];
  diagnostics: RetrievalProviderDiagnostic[];
}

export class ExactVectorCandidateProvider implements CandidateProvider {
  readonly id = 'exact-vector';
  readonly source = 'vector';

  constructor(
    private readonly vectorStore: VectorStore,
    readonly deadlineMs = 300,
  ) {}

  async getCandidates(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    const entries = request.isEntryCompatible
      ? scoreVectorEntries(
          (await this.vectorStore.getEntries()).filter(request.isEntryCompatible),
          request.queryVector,
          request.candidateLimit,
          signal,
        ).map((result) => result.entry)
      : await this.vectorStore.query(request.queryVector, request.candidateLimit, signal);
    return entries.map((entry) => ({
      entry,
      source: this.source,
    }));
  }
}

export interface IvfVectorCandidateProviderOptions {
  minEntryCount: number;
  clusterCount: number;
  probeCount: number;
}

export interface IvfVectorCandidateProviderState {
  mode: 'exact' | 'ann' | 'empty';
  entryCount: number;
  clusterCount: number;
  probeCount: number;
  lastBuiltAt: number | null;
  lastQueriedAt: number | null;
}

export class IvfVectorCandidateProvider implements CandidateProvider {
  readonly id = 'ivf-vector';
  readonly source = 'ann';
  private index: IvfVectorIndex | null = null;
  private indexedFingerprint = '';
  private state: IvfVectorCandidateProviderState = {
    mode: 'empty',
    entryCount: 0,
    clusterCount: 0,
    probeCount: 0,
    lastBuiltAt: null,
    lastQueriedAt: null,
  };

  constructor(
    private readonly vectorStore: VectorStore,
    private readonly options: IvfVectorCandidateProviderOptions,
    readonly deadlineMs = 300,
  ) {}

  async getCandidates(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfAborted(signal);
    const entries = (await this.vectorStore.getEntries()).filter((entry) =>
      request.isEntryCompatible?.(entry) ?? true,
    );
    throwIfAborted(signal);
    if (entries.length < this.options.minEntryCount) {
      this.state = {
        mode: entries.length === 0 ? 'empty' : 'exact',
        entryCount: entries.length,
        clusterCount: 0,
        probeCount: 0,
        lastBuiltAt: this.state.lastBuiltAt,
        lastQueriedAt: Date.now(),
      };
      const exactEntries = scoreVectorEntries(
        entries,
        request.queryVector,
        request.candidateLimit,
        signal,
      );
      return exactEntries.map(({ entry, score }) => ({
        entry,
        source: 'vector',
        sourceScore: score,
      }));
    }

    const index = this.getOrBuildIndex(entries, signal);
    this.state = {
      ...this.state,
      mode: 'ann',
      entryCount: entries.length,
      clusterCount: index.clusterCount,
      probeCount: Math.max(1, Math.min(this.options.probeCount, index.clusterCount)),
      lastQueriedAt: Date.now(),
    };
    return index.query(request.queryVector, request.candidateLimit, this.options.probeCount, signal).map(
      ({ entry, score }) => ({
        entry,
        source: this.source,
        sourceScore: score,
        reason: 'ivf',
      }),
    );
  }

  private getOrBuildIndex(entries: readonly VectorEntry[], signal?: AbortSignal): IvfVectorIndex {
    const fingerprint = createEntriesFingerprint(entries);
    if (this.index && this.indexedFingerprint === fingerprint) {
      return this.index;
    }
    this.index = IvfVectorIndex.build(entries, this.options.clusterCount, signal);
    this.indexedFingerprint = fingerprint;
    this.state = {
      ...this.state,
      entryCount: entries.length,
      clusterCount: this.index.clusterCount,
      lastBuiltAt: Date.now(),
    };
    return this.index;
  }

  getState(): IvfVectorCandidateProviderState {
    return { ...this.state };
  }
}

export class BM25CandidateProvider implements CandidateProvider {
  readonly id = 'bm25';
  readonly source = 'bm25';

  constructor(
    private readonly vectorStore: VectorStore,
    private readonly bm25Index: JsonFileBM25Index,
    readonly deadlineMs = 80,
  ) {}

  async getCandidates(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfAborted(signal);
    if (!this.bm25Index.isReady) return [];

    const scores = this.bm25Index.search(request.question);
    if (scores.size === 0) return [];

    const docIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, request.candidateLimit * 4)
      .map(([docId]) => docId);
    const maxScore = Math.max(...docIds.map((docId) => scores.get(docId) ?? 0), 1);
    const entriesById = new Map(
      (await this.vectorStore.getEntriesByIds(docIds)).map((entry) => [entry.id, entry]),
    );
    throwIfAborted(signal);
    const foundEntries = docIds
      .map((docId) => entriesById.get(docId))
      .filter((entry): entry is VectorEntry =>
        entry !== undefined && (request.isEntryCompatible?.(entry) ?? true),
      );
    const missingSources = docIds
      .filter((docId) => !entriesById.has(docId))
      .map((docId) => this.bm25Index.getDocumentSource(docId) ?? docId);
    const fallbackEntries =
      missingSources.length > 0
        ? await this.vectorStore.getEntriesByFilePaths([...new Set(missingSources)])
        : [];
    throwIfAborted(signal);

    return [...foundEntries, ...fallbackEntries]
      .filter((entry) => request.isEntryCompatible?.(entry) ?? true)
      .filter((entry) => scores.has(entry.id) || scores.has(entry.metadata.filePath))
      .map((entry) => ({
        entry,
        source: 'bm25' as const,
        sourceScore:
          (scores.get(entry.id) ?? scores.get(entry.metadata.filePath) ?? 0) / maxScore,
        reason: 'keyword-match',
      }))
      .slice(0, request.candidateLimit);
  }
}

export interface StructuralMetadataContext {
  resolvedLinks: Record<string, Record<string, number>>;
  getFileByPath(path: string): TFile | null;
  getFileCache(file: TFile): CachedMetadata | null;
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
}

export class StructuralGraphCandidateProvider implements CandidateProvider {
  readonly id = 'structural-graph';
  readonly source = 'structural';

  constructor(
    private readonly vectorStore: VectorStore,
    private readonly metadata: StructuralMetadataContext,
    private readonly seedLimit = 1,
    readonly deadlineMs = 30,
  ) {}

  async getCandidates(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    const seedLimit = Math.max(1, Math.min(this.seedLimit, request.candidateLimit));
    const seedEntries = request.isEntryCompatible
      ? scoreVectorEntries(
          (await this.vectorStore.getEntries()).filter(request.isEntryCompatible),
          request.queryVector,
          seedLimit,
          signal,
        ).map((result) => result.entry)
      : await this.vectorStore.query(request.queryVector, seedLimit, signal);
    throwIfAborted(signal);
    if (seedEntries.length === 0) return [];

    const seedIds = new Set(seedEntries.map((entry) => entry.id));
    const targetPaths = new Set<string>();
    for (const seedEntry of seedEntries) {
      this.addLinkedFilePaths(seedEntry.metadata.filePath, targetPaths);
    }

    const linkedEntries =
      targetPaths.size > 0 ? await this.vectorStore.getEntriesByFilePaths([...targetPaths]) : [];
    throwIfAborted(signal);
    const headingEntries = await this.getHeadingNeighborEntries(seedEntries);
    const candidatesById = new Map<string, RetrievalCandidate>();

    for (const entry of [...linkedEntries, ...headingEntries]) {
      if (!(request.isEntryCompatible?.(entry) ?? true)) continue;
      if (seedIds.has(entry.id)) continue;
      candidatesById.set(entry.id, {
        entry,
        source: this.source,
        sourceScore: 1,
        reason: targetPaths.has(entry.metadata.filePath) ? 'link-neighborhood' : 'heading-neighborhood',
      });
    }

    return [...candidatesById.values()].slice(0, request.candidateLimit);
  }

  private addLinkedFilePaths(sourcePath: string, targetPaths: Set<string>): void {
    const outgoingLinks = this.metadata.resolvedLinks[sourcePath] ?? {};
    for (const targetPath of Object.keys(outgoingLinks)) {
      if (targetPath !== sourcePath) {
        targetPaths.add(targetPath);
      }
    }

    for (const [candidateSourcePath, links] of Object.entries(this.metadata.resolvedLinks)) {
      if (candidateSourcePath !== sourcePath && Object.hasOwn(links, sourcePath)) {
        targetPaths.add(candidateSourcePath);
      }
    }

    const sourceFile = this.metadata.getFileByPath(sourcePath);
    if (!sourceFile) return;

    const cache = this.metadata.getFileCache(sourceFile);
    for (const link of cache?.links ?? []) {
      const targetFile = this.metadata.getFirstLinkpathDest(link.link, sourcePath);
      if (targetFile && targetFile.path !== sourcePath) {
        targetPaths.add(targetFile.path);
      }
    }
  }

  private async getHeadingNeighborEntries(seedEntries: readonly VectorEntry[]): Promise<VectorEntry[]> {
    const paths = [...new Set(seedEntries.map((entry) => entry.metadata.filePath))];
    if (paths.length === 0) return [];

    const entries = await this.vectorStore.getEntriesByFilePaths(paths);
    const seedIds = new Set(seedEntries.map((entry) => entry.id));
    const headingRangesByPath = new Map<
      string,
      Array<{ startLine: number; endLine?: number; heading?: string }>
    >();

    for (const seedEntry of seedEntries) {
      const sourceFile = this.metadata.getFileByPath(seedEntry.metadata.filePath);
      if (!sourceFile) continue;

      const cache = this.metadata.getFileCache(sourceFile);
      const headingRanges = cache?.headings
        ? getHeadingRanges(cache.headings).filter((range) =>
            isLineInRange(seedEntry.metadata.startLine, range.startLine, range.endLine),
          )
        : [];

      const ranges =
        headingRanges.length > 0
          ? headingRanges.map((range) => ({ ...range, heading: seedEntry.metadata.heading }))
          : seedEntry.metadata.heading
            ? [
                {
                  startLine: seedEntry.metadata.startLine,
                  endLine: seedEntry.metadata.endLine,
                  heading: seedEntry.metadata.heading,
                },
              ]
            : [];
      if (ranges.length === 0) continue;

      const existing = headingRangesByPath.get(seedEntry.metadata.filePath) ?? [];
      existing.push(...ranges);
      headingRangesByPath.set(seedEntry.metadata.filePath, existing);
    }

    return entries.filter((entry) => {
      if (seedIds.has(entry.id)) return false;
      const ranges = headingRangesByPath.get(entry.metadata.filePath) ?? [];
      return ranges.some(
        (range) =>
          (!range.heading ||
            !entry.metadata.heading ||
            entry.metadata.heading === range.heading) &&
          isLineInRange(entry.metadata.startLine, range.startLine, range.endLine),
      );
    });
  }
}

export class RagRetrievalPipeline {
  constructor(private readonly providers: readonly CandidateProvider[]) {}

  async retrieve(request: RagRetrievalRequest): Promise<RagRetrievalResult> {
    const providerResults = await Promise.all(
      this.providers.map((provider) => this.runProvider(provider, request)),
    );
    return {
      candidates: mergeCandidates(providerResults.flatMap((result) => result.candidates)),
      diagnostics: providerResults.map((result) => result.diagnostic),
    };
  }

  private async runProvider(
    provider: CandidateProvider,
    request: RagRetrievalRequest,
  ): Promise<{ candidates: RetrievalCandidate[]; diagnostic: RetrievalProviderDiagnostic }> {
    const startedAt = Date.now();
    try {
      const abortController = new AbortController();
      const candidates = await withProviderDeadline(
        provider.getCandidates(request, abortController.signal),
        provider.deadlineMs,
        abortController,
      );
      const rankedCandidates = candidates.map((candidate, index) => ({
        ...candidate,
        rank: candidate.rank ?? index + 1,
      }));
      return {
        candidates: rankedCandidates,
        diagnostic: {
          providerId: provider.id,
          source: provider.source,
          status: 'ok',
          durationMs: Date.now() - startedAt,
          candidateCount: rankedCandidates.length,
        },
      };
    } catch (error) {
      const isTimeout = error instanceof ProviderTimeoutError;
      return {
        candidates: [],
        diagnostic: {
          providerId: provider.id,
          source: provider.source,
          status: isTimeout ? 'timeout' : 'error',
          durationMs: Date.now() - startedAt,
          candidateCount: 0,
          error: isTimeout ? undefined : stringifyError(error),
        },
      };
    }
  }
}

function getHeadingRanges(
  headings: NonNullable<CachedMetadata['headings']>,
): Array<{ startLine: number; endLine?: number }> {
  return headings.map((heading, index) => {
    const nextSameOrHigher = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    return {
      startLine: heading.position.start.line,
      endLine:
        nextSameOrHigher && nextSameOrHigher.position.start.line > heading.position.start.line
          ? nextSameOrHigher.position.start.line - 1
          : undefined,
    };
  });
}

function isLineInRange(line: number, startLine: number, endLine?: number): boolean {
  return line >= startLine && (typeof endLine !== 'number' || line <= endLine);
}

function scoreVectorEntries(
  entries: readonly VectorEntry[],
  vector: readonly number[],
  topK: number,
  signal?: AbortSignal,
): Array<{ entry: VectorEntry; score: number }> {
  throwIfAborted(signal);
  const rustScores = rankTopKPairsRust(
    vector,
    entries.map((entry) => entry.vector),
    topK,
  );
  if (rustScores !== null) {
    throwIfAborted(signal);
    const selected: Array<{ entry: VectorEntry; score: number }> = [];
    for (const result of rustScores) {
      const entry = entries[result.index];
      if (entry) selected.push({ entry, score: result.score });
    }
    return selected;
  }

  const scored: Array<{ entry: VectorEntry; score: number }> = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    const score = cosineSimilarity(vector, entry.vector);
    if (score === null) continue;
    scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export function calculateRecallAtK(
  exactIds: readonly string[],
  approximateIds: readonly string[],
  k: number,
): number {
  const limit = Math.max(0, k);
  if (limit === 0) return 0;

  const exactTopK = new Set(exactIds.slice(0, limit));
  if (exactTopK.size === 0) return 0;

  const approximateTopK = approximateIds.slice(0, limit);
  const hits = approximateTopK.filter((id) => exactTopK.has(id)).length;
  return hits / exactTopK.size;
}

function mergeCandidates(candidates: readonly RetrievalCandidate[]): MergedRetrievalCandidate[] {
  const byId = new Map<string, MergedRetrievalCandidate>();

  for (const candidate of candidates) {
    const existing = byId.get(candidate.entry.id);
    if (existing) {
      if (!existing.sources.includes(candidate.source)) {
        existing.sources.push(candidate.source);
      }
      if (typeof candidate.sourceScore === 'number') {
        existing.sourceScores[candidate.source] = candidate.sourceScore;
      }
      if (typeof candidate.rank === 'number') {
        existing.sourceRanks[candidate.source] = Math.min(
          existing.sourceRanks[candidate.source] ?? candidate.rank,
          candidate.rank,
        );
      }
      if (candidate.reason && !existing.reasons.includes(candidate.reason)) {
        existing.reasons.push(candidate.reason);
      }
      continue;
    }

    byId.set(candidate.entry.id, {
      entry: candidate.entry,
      sources: [candidate.source],
      sourceScores:
        typeof candidate.sourceScore === 'number'
          ? { [candidate.source]: candidate.sourceScore }
          : {},
      sourceRanks:
        typeof candidate.rank === 'number' ? { [candidate.source]: candidate.rank } : {},
      reasons: candidate.reason ? [candidate.reason] : [],
    });
  }

  return [...byId.values()];
}

class IvfVectorIndex {
  private constructor(
    private readonly centroids: number[][],
    private readonly clusters: VectorEntry[][],
  ) {}

  get clusterCount(): number {
    return this.centroids.length;
  }

  static build(
    entries: readonly VectorEntry[],
    requestedClusterCount: number,
    signal?: AbortSignal,
  ): IvfVectorIndex {
    if (entries.length === 0) return new IvfVectorIndex([], []);

    const clusterCount = resolveClusterCount(entries.length, requestedClusterCount);
    let centroids = createInitialCentroids(entries, clusterCount);
    let clusters = assignClusters(entries, centroids, signal);

    for (let iteration = 0; iteration < 4; iteration++) {
      throwIfAborted(signal);
      centroids = recomputeCentroids(clusters, centroids);
      clusters = assignClusters(entries, centroids, signal);
    }

    return new IvfVectorIndex(centroids, clusters);
  }

  query(
    vector: readonly number[],
    topK: number,
    probeCount: number,
    signal?: AbortSignal,
  ): Array<{ entry: VectorEntry; score: number }> {
    if (this.centroids.length === 0) return [];

    const resolvedProbeCount = Math.max(1, Math.min(probeCount, this.centroids.length));
    const rustCentroidScores = rankTopKPairsRust(vector, this.centroids, resolvedProbeCount);
    const centroidIndexes =
      rustCentroidScores !== null
        ? rustCentroidScores.map((candidate) => candidate.index)
        : this.centroids
            .map((centroid, index) => ({
              index,
              score: cosineSimilarity(vector, centroid),
            }))
            .filter(
              (candidate): candidate is { index: number; score: number } =>
                candidate.score !== null,
            )
            .sort((a, b) => b.score - a.score)
            .slice(0, resolvedProbeCount)
            .map((candidate) => candidate.index);

    const candidates = centroidIndexes.flatMap((index) => this.clusters[index] ?? []);
    throwIfAborted(signal);
    return scoreVectorEntries(candidates, vector, topK, signal);
  }
}

function resolveClusterCount(entryCount: number, requestedClusterCount: number): number {
  if (requestedClusterCount > 0) {
    return Math.max(1, Math.min(requestedClusterCount, entryCount));
  }
  return Math.max(1, Math.min(128, Math.round(Math.sqrt(entryCount))));
}

function createInitialCentroids(entries: readonly VectorEntry[], clusterCount: number): number[][] {
  if (clusterCount === 1) return [[...entries[0].vector]];

  return Array.from({ length: clusterCount }, (_, index) => {
    const entryIndex = Math.floor((index * (entries.length - 1)) / (clusterCount - 1));
    return [...entries[entryIndex].vector];
  });
}

function assignClusters(
  entries: readonly VectorEntry[],
  centroids: readonly (readonly number[])[],
  signal?: AbortSignal,
): VectorEntry[][] {
  const clusters = Array.from({ length: centroids.length }, () => [] as VectorEntry[]);
  const rustAssignments = assignVectorClustersRust(
    entries.map((entry) => entry.vector),
    centroids,
  );
  if (rustAssignments !== null && rustAssignments.length === entries.length) {
    for (let index = 0; index < entries.length; index++) {
      throwIfAborted(signal);
      const clusterIndex = rustAssignments[index] ?? 0;
      const entry = entries[index];
      if (entry) clusters[clusterIndex]?.push(entry);
    }
    return clusters;
  }

  for (const entry of entries) {
    throwIfAborted(signal);
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < centroids.length; index++) {
      const score = cosineSimilarity(entry.vector, centroids[index]);
      if (score === null) continue;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    clusters[bestIndex].push(entry);
  }
  return clusters;
}

function recomputeCentroids(
  clusters: readonly (readonly VectorEntry[])[],
  previousCentroids: readonly (readonly number[])[],
): number[][] {
  const vectors: number[][] = [];
  const assignments: number[] = [];
  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
    const cluster = clusters[clusterIndex] ?? [];
    for (const entry of cluster) {
      vectors.push(entry.vector);
      assignments.push(clusterIndex);
    }
  }

  const rustCentroids = recomputeCentroidsRust(vectors, assignments, previousCentroids);
  if (rustCentroids !== null) return rustCentroids;

  return clusters.map((cluster, index) => {
    if (cluster.length === 0) return [...previousCentroids[index]];

    const dimensions = cluster[0].vector.length;
    const centroid = Array.from({ length: dimensions }, () => 0);
    for (const entry of cluster) {
      for (let dimension = 0; dimension < dimensions; dimension++) {
        centroid[dimension] += entry.vector[dimension] ?? 0;
      }
    }
    return centroid.map((value) => value / cluster.length);
  });
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    dot += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function withProviderDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
  abortController: AbortController,
): Promise<T> {
  if (deadlineMs <= 0) return operation;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(new ProviderTimeoutError());
    }, deadlineMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

class ProviderTimeoutError extends Error {
  constructor() {
    super('retrieval provider timed out');
  }
}

function createEntriesFingerprint(entries: readonly VectorEntry[]): string {
  return entries
    .map((entry) => {
      const contentHash = entry.metadata.contentHash ?? '';
      const indexedAt = entry.metadata.indexedAt ?? 0;
      return `${entry.id}:${contentHash}:${indexedAt}:${entry.vector.length}`;
    })
    .join('|');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
