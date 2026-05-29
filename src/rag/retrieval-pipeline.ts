import type { JsonFileBM25Index } from './bm25';
import type { VectorEntry, VectorStore } from './store';
import type { CachedMetadata, TFile } from 'obsidian';

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
}

export interface RetrievalCandidate {
  entry: VectorEntry;
  source: RetrievalCandidateSource;
  sourceScore?: number;
  reason?: string;
}

export interface MergedRetrievalCandidate {
  entry: VectorEntry;
  sources: RetrievalCandidateSource[];
  sourceScores: Partial<Record<RetrievalCandidateSource, number>>;
  reasons: string[];
}

export interface CandidateProvider {
  id: string;
  source: RetrievalCandidateSource;
  deadlineMs: number;
  getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]>;
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

  async getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const entries = await this.vectorStore.query(request.queryVector, request.candidateLimit);
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
  private indexedEntryCount = 0;
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

  async getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const entries = await this.vectorStore.getEntries();
    if (entries.length < this.options.minEntryCount) {
      this.state = {
        mode: entries.length === 0 ? 'empty' : 'exact',
        entryCount: entries.length,
        clusterCount: 0,
        probeCount: 0,
        lastBuiltAt: this.state.lastBuiltAt,
        lastQueriedAt: Date.now(),
      };
      const exactEntries = await this.vectorStore.query(request.queryVector, request.candidateLimit);
      return exactEntries.map((entry) => ({
        entry,
        source: 'vector',
      }));
    }

    const index = this.getOrBuildIndex(entries);
    this.state = {
      ...this.state,
      mode: 'ann',
      entryCount: entries.length,
      clusterCount: index.clusterCount,
      probeCount: Math.max(1, Math.min(this.options.probeCount, index.clusterCount)),
      lastQueriedAt: Date.now(),
    };
    return index.query(request.queryVector, request.candidateLimit, this.options.probeCount).map(
      ({ entry, score }) => ({
        entry,
        source: this.source,
        sourceScore: score,
        reason: 'ivf',
      }),
    );
  }

  private getOrBuildIndex(entries: readonly VectorEntry[]): IvfVectorIndex {
    if (this.index && this.indexedEntryCount === entries.length) {
      return this.index;
    }
    this.index = IvfVectorIndex.build(entries, this.options.clusterCount);
    this.indexedEntryCount = entries.length;
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

  async getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    if (!this.bm25Index.isReady) return [];

    const scores = this.bm25Index.search(request.question);
    if (scores.size === 0) return [];

    const filePaths = [...scores.keys()];
    const maxScore = Math.max(...scores.values(), 1);
    const entries = await this.vectorStore.getEntriesByFilePaths(filePaths);
    const allowedPaths = new Set(filePaths);

    return entries
      .filter((entry) => allowedPaths.has(entry.metadata.filePath))
      .map((entry) => ({
        entry,
        source: this.source,
        sourceScore: (scores.get(entry.metadata.filePath) ?? 0) / maxScore,
        reason: 'keyword-match',
      }));
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

  async getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const seedEntries = await this.vectorStore.query(
      request.queryVector,
      Math.max(1, Math.min(this.seedLimit, request.candidateLimit)),
    );
    if (seedEntries.length === 0) return [];

    const seedIds = new Set(seedEntries.map((entry) => entry.id));
    const targetPaths = new Set<string>();
    for (const seedEntry of seedEntries) {
      this.addLinkedFilePaths(seedEntry.metadata.filePath, targetPaths);
    }

    const linkedEntries =
      targetPaths.size > 0 ? await this.vectorStore.getEntriesByFilePaths([...targetPaths]) : [];
    const headingEntries = await this.getHeadingNeighborEntries(seedEntries);
    const candidatesById = new Map<string, RetrievalCandidate>();

    for (const entry of [...linkedEntries, ...headingEntries]) {
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
      const candidates = await withProviderDeadline(
        provider.getCandidates(request),
        provider.deadlineMs,
      );
      return {
        candidates,
        diagnostic: {
          providerId: provider.id,
          source: provider.source,
          status: 'ok',
          durationMs: Date.now() - startedAt,
          candidateCount: candidates.length,
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

  static build(entries: readonly VectorEntry[], requestedClusterCount: number): IvfVectorIndex {
    if (entries.length === 0) return new IvfVectorIndex([], []);

    const clusterCount = resolveClusterCount(entries.length, requestedClusterCount);
    let centroids = createInitialCentroids(entries, clusterCount);
    let clusters = assignClusters(entries, centroids);

    for (let iteration = 0; iteration < 4; iteration++) {
      centroids = recomputeCentroids(clusters, centroids);
      clusters = assignClusters(entries, centroids);
    }

    return new IvfVectorIndex(centroids, clusters);
  }

  query(
    vector: readonly number[],
    topK: number,
    probeCount: number,
  ): Array<{ entry: VectorEntry; score: number }> {
    if (this.centroids.length === 0) return [];

    const centroidIndexes = this.centroids
      .map((centroid, index) => ({
        index,
        score: cosineSimilarity(vector, centroid),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(probeCount, this.centroids.length)))
      .map((candidate) => candidate.index);

    const candidates = centroidIndexes.flatMap((index) => this.clusters[index] ?? []);
    return candidates
      .map((entry) => ({
        entry,
        score: cosineSimilarity(vector, entry.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
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
): VectorEntry[][] {
  const clusters = Array.from({ length: centroids.length }, () => [] as VectorEntry[]);
  for (const entry of entries) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < centroids.length; index++) {
      const score = cosineSimilarity(entry.vector, centroids[index]);
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

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const dimensions = Math.min(a.length, b.length);
  for (let i = 0; i < dimensions; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    dot += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

function withProviderDeadline<T>(operation: Promise<T>, deadlineMs: number): Promise<T> {
  if (deadlineMs <= 0) return operation;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ProviderTimeoutError()), deadlineMs);
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

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
