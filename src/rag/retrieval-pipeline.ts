import type { JsonFileBM25Index } from './bm25';
import type { VectorEntry, VectorStore } from './store';
import type { CachedMetadata, TFile } from 'obsidian';
import {
  collectCandidateReasonsRust,
  createEntriesFingerprintRust,
  calculateRecallAtKRust,
  planBm25CandidateResolutionRust,
  planBm25HitLookupRust,
  planBm25SourceLookupsRust,
  planMergedRetrievalCandidatesByEntryIdRust,
  planStructuralHeadingNeighborsRust,
  planStructuralLinkedPathsRust,
  rankTopKPairsRust,
  RustIvfRuntimeIndex,
  RustVectorRuntimeIndex,
  type RustBm25EntryInput,
  type RustStructuralEntryInput,
  type RustStructuralHeadingInput,
  type RustStructuralHeadingSeed,
  type RustStructuralLinkEdge,
  type RustMergedRetrievalCandidatePlan,
} from './rust-core';

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
    const entries = (await this.vectorStore.getEntries()).filter(
      (entry) => request.isEntryCompatible?.(entry) ?? true,
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
    return index
      .query(request.queryVector, request.candidateLimit, this.options.probeCount, signal)
      .map(({ entry, score }) => ({
        entry,
        source: this.source,
        sourceScore: score,
        reason: 'ivf',
      }));
  }

  private getOrBuildIndex(entries: readonly VectorEntry[], signal?: AbortSignal): IvfVectorIndex {
    const fingerprint = createEntriesFingerprint(entries);
    if (this.index && this.indexedFingerprint === fingerprint) {
      return this.index;
    }
    this.index?.dispose();
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

    const hitPlan = planBm25HitLookupRust(
      [...scores.entries()].map(([docId, score]) => ({
        docId,
        sourcePath: this.bm25Index.getDocumentSource(docId) ?? docId,
        score,
      })),
      request.candidateLimit,
      4,
    );
    if (hitPlan === null || hitPlan.hits.length === 0) return [];

    const foundEntries = await this.vectorStore.getEntriesByIds(hitPlan.lookupDocIds);
    throwIfAborted(signal);
    const sourceLookupPaths = planBm25SourceLookupsRust(
      hitPlan.hits,
      foundEntries.map((entry) => entry.id),
    );
    if (sourceLookupPaths === null) return [];

    const pathEntries =
      sourceLookupPaths.length > 0
        ? await this.vectorStore.getEntriesByFilePaths(sourceLookupPaths)
        : [];
    throwIfAborted(signal);

    const plan = planBm25CandidateResolutionRust({
      hits: hitPlan.hits,
      foundEntries: foundEntries.map((entry) => toBm25EntryInput(entry, request)),
      pathEntries: pathEntries.map((entry) => toBm25EntryInput(entry, request)),
      candidateLimit: request.candidateLimit,
      maxScore: hitPlan.maxScore,
    });
    if (plan === null) return [];

    const candidates: RetrievalCandidate[] = [];
    for (const item of plan) {
      const entry = item.entrySet === 'found' ? foundEntries[item.entryIndex] : pathEntries[item.entryIndex];
      if (!entry) {
        continue;
      }
      candidates.push({
        entry,
        source: 'bm25',
        sourceScore: item.sourceScore,
        reason: 'keyword-match',
      });
    }
    return candidates;
  }
}

function toBm25EntryInput(
  entry: VectorEntry,
  request: RagRetrievalRequest,
): RustBm25EntryInput {
  return {
    id: entry.id,
    filePath: entry.metadata.filePath,
    compatible: request.isEntryCompatible?.(entry) ?? true,
  };
}

function toStructuralEntryInput(
  entry: VectorEntry,
  request: RagRetrievalRequest,
): RustStructuralEntryInput {
  return {
    id: entry.id,
    filePath: entry.metadata.filePath,
    startLine: entry.metadata.startLine,
    ...(entry.metadata.heading ? { heading: entry.metadata.heading } : {}),
    compatible: request.isEntryCompatible?.(entry) ?? true,
  };
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
    const targetPaths = new Set(
      planStructuralLinkedPathsRust(
        seedEntries.map((entry) => entry.metadata.filePath),
        this.collectStructuralLinkEdges(seedEntries),
      ) ?? [],
    );

    const linkedEntries =
      targetPaths.size > 0 ? await this.vectorStore.getEntriesByFilePaths([...targetPaths]) : [];
    throwIfAborted(signal);
    const headingEntries = await this.collectStructuralHeadingEntries(seedEntries, request);
    const candidatesById = new Map<string, RetrievalCandidate>();

    for (const entry of [...linkedEntries, ...headingEntries]) {
      if (!(request.isEntryCompatible?.(entry) ?? true)) continue;
      if (seedIds.has(entry.id)) continue;
      candidatesById.set(entry.id, {
        entry,
        source: this.source,
        sourceScore: 1,
        reason: targetPaths.has(entry.metadata.filePath)
          ? 'link-neighborhood'
          : 'heading-neighborhood',
      });
    }

    return [...candidatesById.values()].slice(0, request.candidateLimit);
  }

  private collectStructuralLinkEdges(
    seedEntries: readonly VectorEntry[],
  ): RustStructuralLinkEdge[] {
    const edges: RustStructuralLinkEdge[] = [];
    for (const [sourcePath, links] of Object.entries(this.metadata.resolvedLinks)) {
      for (const targetPath of Object.keys(links)) {
        edges.push({ sourcePath, targetPath });
      }
    }

    for (const seedEntry of seedEntries) {
      const sourcePath = seedEntry.metadata.filePath;
      const sourceFile = this.metadata.getFileByPath(sourcePath);
      if (!sourceFile) continue;

      const cache = this.metadata.getFileCache(sourceFile);
      for (const link of cache?.links ?? []) {
        const targetFile = this.metadata.getFirstLinkpathDest(link.link, sourcePath);
        if (targetFile) edges.push({ sourcePath, targetPath: targetFile.path });
      }
    }
    return edges;
  }

  private async collectStructuralHeadingEntries(
    seedEntries: readonly VectorEntry[],
    request: RagRetrievalRequest,
  ): Promise<VectorEntry[]> {
    const paths = [...new Set(seedEntries.map((entry) => entry.metadata.filePath))];
    if (paths.length === 0) return [];

    const entries = await this.vectorStore.getEntriesByFilePaths(paths);
    const plan = planStructuralHeadingNeighborsRust({
      seeds: this.collectStructuralHeadingSeeds(seedEntries),
      entries: entries.map((entry) => toStructuralEntryInput(entry, request)),
      headings: this.collectStructuralHeadingRows(paths),
    });
    if (plan === null) return [];

    const selected: VectorEntry[] = [];
    for (const entryIndex of plan) {
      const entry = entries[entryIndex];
      if (entry) selected.push(entry);
    }
    return selected;
  }

  private collectStructuralHeadingSeeds(
    seedEntries: readonly VectorEntry[],
  ): RustStructuralHeadingSeed[] {
    const seeds: RustStructuralHeadingSeed[] = [];
    for (const entry of seedEntries) {
      if (!this.metadata.getFileByPath(entry.metadata.filePath)) continue;
      seeds.push({
        id: entry.id,
        filePath: entry.metadata.filePath,
        startLine: entry.metadata.startLine,
        endLine: entry.metadata.endLine ?? entry.metadata.startLine,
        ...(entry.metadata.heading ? { heading: entry.metadata.heading } : {}),
      });
    }
    return seeds;
  }

  private collectStructuralHeadingRows(paths: readonly string[]): RustStructuralHeadingInput[] {
    const headings: RustStructuralHeadingInput[] = [];
    for (const path of paths) {
      const file = this.metadata.getFileByPath(path);
      if (!file) continue;
      for (const heading of this.metadata.getFileCache(file)?.headings ?? []) {
        headings.push({
          filePath: path,
          startLine: heading.position.start.line,
          level: heading.level,
        });
      }
    }
    return headings;
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

function scoreVectorEntries(
  entries: readonly VectorEntry[],
  vector: readonly number[],
  topK: number,
  signal?: AbortSignal,
): Array<{ entry: VectorEntry; score: number }> {
  throwIfAborted(signal);
  const runtimeIndex = RustVectorRuntimeIndex.build(entries.map((entry) => entry.vector));
  const rustScores =
    runtimeIndex?.rankTopK(vector, topK) ??
    rankTopKPairsRust(
      vector,
      entries.map((entry) => entry.vector),
      topK,
    );
  runtimeIndex?.dispose();
  if (rustScores !== null) {
    throwIfAborted(signal);
    const selected: Array<{ entry: VectorEntry; score: number }> = [];
    for (const result of rustScores) {
      const resultIndex = result.index;
      if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= entries.length) {
        continue;
      }
      const entry = entries[resultIndex];
      if (entry) selected.push({ entry, score: result.score });
    }
    return selected;
  }

  return [];
}

export function mergeRetrievalCandidateGroupsByEntryId(
  candidates: readonly RetrievalCandidate[],
): RustMergedRetrievalCandidatePlan[] {
  if (candidates.length === 0) return [];

  const rustPlan = planMergedRetrievalCandidatesByEntryIdRust(
    candidates.map((candidate) => ({
      entryId: candidate.entry.id,
      source: candidate.source,
      sourceScore: candidate.sourceScore,
      rank: candidate.rank,
    })),
  );
  if (rustPlan !== null) return rustPlan;

  const groups: RustMergedRetrievalCandidatePlan[] = [];
  const groupByEntryId = new Map<string, number>();

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate) continue;

    const existingGroupIndex = groupByEntryId.get(candidate.entry.id);
    if (existingGroupIndex === undefined) {
      groupByEntryId.set(candidate.entry.id, groups.length);
      groups.push({
        entryIndex: index,
        firstCandidateIndex: index,
        candidateIndexes: [index],
        sources: [
          {
            source: candidate.source,
            sourceScore: candidate.sourceScore,
            rank: candidate.rank,
          },
        ],
      });
      continue;
    }

    const group = groups[existingGroupIndex];
    if (!group) continue;
    group.candidateIndexes.push(index);
    const source = group.sources.find((item) => item.source === candidate.source);
    if (!source) {
      group.sources.push({
        source: candidate.source,
        sourceScore: candidate.sourceScore,
        rank: candidate.rank,
      });
      continue;
    }

    const candidateScore = candidate.sourceScore;
    if (Number.isFinite(candidateScore ?? Number.NaN)) {
      source.sourceScore = candidateScore;
    }
    const candidateRank = candidate.rank;
    if (Number.isFinite(candidateRank ?? Number.NaN)) {
      const nextRank = candidateRank as number;
      const existingRank = source.rank;
      source.rank = Number.isFinite(existingRank ?? Number.NaN)
        ? Math.min(existingRank as number, nextRank)
        : nextRank;
    }
  }

  return groups;
}

export function calculateRecallAtK(
  exactIds: readonly string[],
  approximateIds: readonly string[],
  k: number,
): number {
  return calculateRecallAtKRust(exactIds, approximateIds, k) ?? 0;
}

function mergeCandidates(candidates: readonly RetrievalCandidate[]): MergedRetrievalCandidate[] {
  if (candidates.length === 0) return [];

  const plan = mergeRetrievalCandidateGroupsByEntryId(candidates);

  const merged: MergedRetrievalCandidate[] = [];
  for (const group of plan) {
    const representative = candidates[group.firstCandidateIndex];
    if (!representative) {
      continue;
    }
    const sources: RetrievalCandidateSource[] = [];
    const sourceScores: Partial<Record<RetrievalCandidateSource, number>> = {};
    const sourceRanks: Partial<Record<RetrievalCandidateSource, number>> = {};
    for (const source of group.sources) {
      const candidateSource = toRetrievalCandidateSource(source.source);
      if (!candidateSource) {
        continue;
      }
      sources.push(candidateSource);
      if (source.sourceScore !== undefined) sourceScores[candidateSource] = source.sourceScore;
      if (source.rank !== undefined) sourceRanks[candidateSource] = source.rank;
    }
    if (sources.length === 0) {
      continue;
    }
    merged.push({
      entry: representative.entry,
      sources,
      sourceScores,
      sourceRanks,
      reasons: collectCandidateReasonsRust(
        candidates.map((candidate) => candidate.reason),
        group.candidateIndexes,
      ) ?? [],
    });
  }
  return merged;
}

function toRetrievalCandidateSource(source: string): RetrievalCandidateSource | null {
  if (
    source === 'vector' ||
    source === 'bm25' ||
    source === 'ann' ||
    source === 'structural' ||
    source === 'graph-local' ||
    source === 'graph-global' ||
    source === 'evidence'
  ) {
    return source;
  }
  return null;
}

class IvfVectorIndex {
  private constructor(
    private readonly entries: readonly VectorEntry[],
    private readonly runtimeIndex: RustIvfRuntimeIndex | null,
  ) {}

  get clusterCount(): number {
    return this.runtimeIndex?.clusterCount ?? 0;
  }

  static build(
    entries: readonly VectorEntry[],
    requestedClusterCount: number,
    signal?: AbortSignal,
  ): IvfVectorIndex {
    if (entries.length === 0) return new IvfVectorIndex(entries, null);
    throwIfAborted(signal);
    const runtimeIndex = RustIvfRuntimeIndex.build(
      entries.map((entry) => entry.vector),
      requestedClusterCount,
      4,
    );
    return new IvfVectorIndex(entries, runtimeIndex);
  }

  dispose(): void {
    this.runtimeIndex?.dispose();
  }

  query(
    vector: readonly number[],
    topK: number,
    probeCount: number,
    signal?: AbortSignal,
  ): Array<{ entry: VectorEntry; score: number }> {
    if (!this.runtimeIndex || this.runtimeIndex.clusterCount === 0) return [];

    throwIfAborted(signal);
    const scoredRows = this.runtimeIndex.query(vector, topK, probeCount);
    if (scoredRows === null) return [];
    const selected: Array<{ entry: VectorEntry; score: number }> = [];
    for (const result of scoredRows) {
      const entry = this.entries[result.index];
      if (entry) selected.push({ entry, score: result.score });
    }
    return selected;
  }
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
  const fingerprint = createEntriesFingerprintRust(
    entries.map((entry) => ({
      id: entry.id,
      vector: entry.vector,
      metadata: {
        indexedAt: entry.metadata.indexedAt ?? 0,
        contentHash: entry.metadata.contentHash ?? '',
      },
    })),
  );
  return fingerprint ?? '';
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
