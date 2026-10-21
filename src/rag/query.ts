import type { EmbeddingProvider } from '../llm/embedding';
import type { VectorStore, VectorEntry } from './store';
import type { IndexedDbBM25Index } from './bm25';
import { DEFAULT_SEARCH_QUALITY } from './search-defaults';
import { BM25DocumentCorpusStore, FallbackRetrievalCorpusStore } from './corpus-store';
import {
  BM25CandidateProvider,
  ExactVectorCandidateProvider,
  IvfVectorCandidateProvider,
  RagRetrievalPipeline,
  StructuralGraphCandidateProvider,
  type CandidateProvider,
  type RetrievalProviderReadiness,
  type RetrievalProviderDiagnostic,
  type StructuralMetadataContext,
  type RetrievalCandidate,
} from './retrieval-pipeline';
import {
  countKeywordMatchesRust,
  cosineSimilarityRust,
  isSourceRevisionCurrentRust,
  planDiverseResultIndicesRust,
  planRagStatusRust,
  planQueryResultScoreRust,
  selectRelevantResultIndicesRust,
  tokenizeRust,
  type RustSourceSelectionReason,
  type RustRagStatusPlan,
} from './rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';
import { appLogger } from '../utils/logger';

const QUERY_SCORE_YIELD_INTERVAL = 512;
const DEFAULT_QUERY_EMBEDDING_TIMEOUT_MS = 10_000;
const DEFAULT_QUERY_EMBEDDING_COOLDOWN_MS = 30_000;
const QUERY_EMBEDDING_TIMEOUT_THRESHOLD = 2;
const DEFAULT_INDEX_READINESS_TIMEOUT_MS = 1_000;
const INDEX_READINESS_POLL_MS = 25;
const INDEX_READINESS_REASONS = {
  missing: 'missing',
  legacy: 'legacy',
  staleFile: 'stale-file',
  embeddingChanged: 'embedding-changed',
} as const;

export interface QueryResult {
  entry: VectorEntry;
  score: number;
  vectorScore: number;
  bm25Score: number;
  combinedScore: number;
  retrievalSources?: string[];
  sourceEvidenceScore?: number;
  bestEvidenceRank?: number;
  hasStructuralEvidence?: boolean;
  hasStrongStructuralEvidence?: boolean;
  selectionReason?: RustSourceSelectionReason;
  sourcePath: string;
  chunkRange: {
    startLine: number;
    endLine?: number;
  };
  keywordMatches: number;
}

export interface RAGExhaustiveBm25Match {
  path: string;
  startLine?: number;
  endLine?: number;
  score: number;
  rank: number;
}

export interface RAGQueryEngineOptions {
  corpusStore?: import('./corpus-store').RetrievalCorpusStore;
  getCandidatePaths?: () => Promise<ReadonlySet<string>>;
  annEnabled?: boolean;
  annClusterCount?: number;
  annProbeCount?: number;
  annMinEntryCount?: number;
  structuralGraphEnabled?: boolean;
  structuralMetadataContext?: StructuralMetadataContext;
  embeddingModel?: string;
  embeddingProvider?: string;
  queryEmbeddingTimeoutMs?: number;
  queryEmbeddingCooldownMs?: number;
  indexReadinessTimeoutMs?: number;
}

export type RAGCandidateReadiness = 'ready' | 'initializing' | 'unavailable';

export interface RAGQueryOptions {
  signal?: AbortSignal;
  excludedProviderIds?: readonly string[];
  /** 일반 채팅의 candidate-first 경로는 BM25 후보를 우선하고 느린 보조 provider를 생략합니다. */
  fastCandidates?: boolean;
  onRetrieved?: (
    results: readonly QueryResult[],
    diagnostics: readonly RetrievalProviderDiagnostic[],
  ) => void;
}

export interface RAGIndexFileSnapshot {
  path: string;
  mtime: number;
  size: number;
}

interface QueryEmbeddingResolution {
  vector: number[];
  status: RetrievalProviderDiagnostic['status'];
  durationMs: number;
  readiness: RetrievalProviderDiagnostic['readiness'];
  estimatedCost: RetrievalProviderDiagnostic['estimatedCost'];
  skippedReason?: string;
  error?: string;
}

export class RAGQueryEngine {
  private readonly corpusStore: import('./corpus-store').RetrievalCorpusStore | undefined;
  private readonly getCandidatePaths: RAGQueryEngineOptions['getCandidatePaths'];
  private vectorStore: VectorStore | null;
  private embeddingProvider: EmbeddingProvider | null;
  private bm25Index: IndexedDbBM25Index | undefined;
  private bm25Weight: number;
  private minScore: number;
  private retrievalPipeline: RagRetrievalPipeline;
  private embeddingModel: string | undefined;
  private embeddingProviderId: string | undefined;
  private readonly queryEmbeddingTimeoutMs: number;
  private readonly queryEmbeddingCooldownMs: number;
  private readonly indexReadinessTimeoutMs: number;
  private consecutiveQueryEmbeddingTimeouts = 0;
  private queryEmbeddingCooldownUntil = 0;
  private lastRetrievalDiagnostics: RetrievalProviderDiagnostic[] = [];

  constructor(
    vectorStore: VectorStore | null,
    embeddingProvider: EmbeddingProvider | null,
    bm25Index?: IndexedDbBM25Index,
    bm25Weight: number = DEFAULT_SEARCH_QUALITY.bm25Weight,
    minScore: number = DEFAULT_SEARCH_QUALITY.minScore,
    options: RAGQueryEngineOptions = {},
  ) {
    this.corpusStore = options.corpusStore;
    this.getCandidatePaths = options.getCandidatePaths;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.bm25Index = bm25Index;
    this.bm25Weight = bm25Weight;
    this.minScore = minScore;
    this.embeddingModel = options.embeddingModel;
    this.embeddingProviderId = options.embeddingProvider;
    this.queryEmbeddingTimeoutMs = normalizePositiveDuration(
      options.queryEmbeddingTimeoutMs,
      DEFAULT_QUERY_EMBEDDING_TIMEOUT_MS,
    );
    this.queryEmbeddingCooldownMs = normalizeNonNegativeDuration(
      options.queryEmbeddingCooldownMs,
      DEFAULT_QUERY_EMBEDDING_COOLDOWN_MS,
    );
    this.indexReadinessTimeoutMs = normalizeNonNegativeDuration(
      options.indexReadinessTimeoutMs,
      DEFAULT_INDEX_READINESS_TIMEOUT_MS,
    );
    const providers: CandidateProvider[] = [];
    if (vectorStore && embeddingProvider) {
      providers.push(
        options.annEnabled === true
          ? new IvfVectorCandidateProvider(vectorStore, {
              minEntryCount: options.annMinEntryCount ?? 500,
              clusterCount: options.annClusterCount ?? 0,
              probeCount: options.annProbeCount ?? 4,
            })
          : new ExactVectorCandidateProvider(vectorStore),
      );
    }
    if (bm25Index) {
      const bm25Corpus = new BM25DocumentCorpusStore(bm25Index);
      providers.push(
        new BM25CandidateProvider(
          options.corpusStore ??
            (vectorStore ? new FallbackRetrievalCorpusStore(vectorStore, bm25Corpus) : bm25Corpus),
          bm25Index,
        ),
      );
    }
    if (
      (options.corpusStore || vectorStore) &&
      options.structuralGraphEnabled === true &&
      options.structuralMetadataContext
    ) {
      providers.push(
        new StructuralGraphCandidateProvider(
          vectorStore,
          options.structuralMetadataContext,
          1,
          undefined,
          options.corpusStore ?? vectorStore ?? undefined,
          bm25Index,
        ),
      );
    }
    this.retrievalPipeline = new RagRetrievalPipeline(providers);
  }

  async queryBm25Exhaustive(
    question: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<readonly RAGExhaustiveBm25Match[] | null> {
    if (!this.bm25Index?.isReady) return null;
    const totalDocs = this.bm25Index.totalDocs;
    const normalizedLimit =
      limit === undefined
        ? totalDocs
        : Math.max(0, Math.min(totalDocs, Math.floor(Number.isFinite(limit) ? limit : 0)));
    if (normalizedLimit === 0) return [];
    // 한 파일이 많은 청크를 차지해도 다른 파일의 후보를 잘라내지 않도록
    // 전체 BM25 런타임을 조회하고, 반환 대표 경로만 limit로 제한합니다.
    const lookupLimit = totalDocs;
    const hits = await this.bm25Index.searchTopWithSources(
      question,
      lookupLimit,
      signal,
    );
    if (!this.bm25Index.isReady) return null;
    const seenPaths = new Set<string>();
    const representatives = hits.filter((hit) => {
      if (seenPaths.has(hit.sourcePath)) return false;
      seenPaths.add(hit.sourcePath);
      return seenPaths.size <= normalizedLimit;
    });
    const documents = await this.bm25Index.getCorpusDocumentsByIds(
      representatives.map((hit) => hit.docId),
    );
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const representativeByPath = new Map(
      representatives.map((hit) => [hit.sourcePath, hit] as const),
    );
    const matches: RAGExhaustiveBm25Match[] = [];
    hits.forEach((hit, index) => {
      if (representativeByPath.get(hit.sourcePath) !== hit) return;
      const document = documentById.get(hit.docId);
      matches.push({
        path: hit.sourcePath,
        ...(document?.startLine !== undefined ? { startLine: document.startLine + 1 } : {}),
        ...(document?.endLine !== undefined ? { endLine: document.endLine + 1 } : {}),
        score: hit.score,
        rank: index + 1,
      });
    });
    return matches;
  }

  async query(
    question: string,
    topK = 5,
    minScore?: number,
    filePathPrefixes?: readonly string[],
    options: RAGQueryOptions = {},
  ): Promise<QueryResult[]> {
    throwIfQueryAborted(options.signal);
    await this.waitForIndexReadiness(options.signal);
    if (this.getCandidateReadiness() === 'initializing') {
      this.lastRetrievalDiagnostics = [];
      options.onRetrieved?.([], this.lastRetrievalDiagnostics);
      return [];
    }
    const threshold = minScore ?? this.minScore;
    const candidatePaths = await this.getCandidatePaths?.();
    const isInScope = (entry: VectorEntry): boolean =>
      (!candidatePaths || candidatePaths.has(entry.metadata.filePath)) &&
      this.isEntryInQueryScope(entry, filePathPrefixes);
    const excludedProviderIds =
      options.fastCandidates && this.bm25Index?.isReady
        ? [
            ...(options.excludedProviderIds ?? []),
            'query-embedding',
            'exact-vector',
            'ivf-vector',
            'structural-graph',
          ]
        : options.excludedProviderIds;
    const embeddingResolution = await this.resolveQueryEmbedding(question, {
      ...options,
      excludedProviderIds,
    });
    const qVector = embeddingResolution.vector;
    const retrieval = await this.retrievalPipeline.retrieve(
      {
        question,
        queryVector: qVector,
        candidateLimit: topK * 8,
        excludedProviderIds,
        requireSourceRevision: this.corpusStore !== undefined,
        vectorFilter:
          qVector.length > 0
            ? {
                embeddingProvider: this.embeddingProviderId,
                embeddingModel: this.embeddingModel,
                dimension: qVector.length,
                filePathPrefixes,
              }
            : undefined,
        isEntryCompatible: (entry) =>
          isInScope(entry) && this.isEntryCompatible(entry, qVector, filePathPrefixes),
        isEntryInScope: isInScope,
        filterCurrentCandidates: this.corpusStore
          ? (candidates) => this.filterCurrentCandidates(candidates)
          : undefined,
      },
      options.signal,
    );
    throwIfQueryAborted(options.signal);
    const diagnostics: RetrievalProviderDiagnostic[] = [
      {
        providerId: 'query-embedding',
        source: 'embedding',
        status: embeddingResolution.status,
        durationMs: embeddingResolution.durationMs,
        candidateCount: 0,
        readiness: embeddingResolution.readiness,
        estimatedCost: embeddingResolution.estimatedCost,
        skippedReason: embeddingResolution.skippedReason,
        error: embeddingResolution.error,
      },
      ...retrieval.diagnostics,
    ];
    const rankingStarted = performance.now();
    const queryTokens = tokenizeRust(question) ?? [];

    const scored: QueryResult[] = [];
    let scopeRejected = 0;
    let invalidScoreRejected = 0;
    for (let index = 0; index < retrieval.candidates.length; index++) {
      const candidate = retrieval.candidates[index];
      const entry = candidate.entry;
      if (!isInScope(entry)) {
        scopeRejected += 1;
        continue;
      }
      const vectorScore =
        qVector.length > 0
          ? entry.vector.length === qVector.length
            ? cosineSimilarityRust(qVector, entry.vector)
            : entry.vector.length === 0 || candidate.sources.includes('bm25')
              ? 0
              : null
          : 0;
      if (vectorScore === null) {
        invalidScoreRejected += 1;
        continue;
      }
      const bm25 = candidate.sourceScores.bm25 ?? 0;
      const scorePlan = planQueryResultScoreRust({
        cosineScore: vectorScore,
        bm25Score: bm25,
        bm25Weight: this.bm25Weight,
        hasBm25: this.bm25Index?.isReady ?? false,
        sourceScores: candidate.sourceScores,
        sourceRanks: candidate.sourceRanks,
        retrievalSources: candidate.sources,
      });
      if (!scorePlan) {
        invalidScoreRejected += 1;
        continue;
      }
      scored.push({
        entry,
        score: scorePlan.combinedScore,
        vectorScore,
        bm25Score: bm25,
        combinedScore: scorePlan.combinedScore,
        retrievalSources: [...candidate.sources],
        sourceEvidenceScore: scorePlan.sourceEvidenceScore,
        bestEvidenceRank: scorePlan.bestEvidenceRank,
        hasStructuralEvidence: scorePlan.hasStructuralEvidence,
        hasStrongStructuralEvidence: scorePlan.hasStrongStructuralEvidence,
        selectionReason: scorePlan.selectionReason,
        sourcePath: entry.metadata.filePath,
        chunkRange: {
          startLine: entry.metadata.startLine,
          endLine: entry.metadata.endLine,
        },
        keywordMatches: countKeywordMatches(queryTokens, entry.metadata.text),
      });
      if (index > 0 && index % QUERY_SCORE_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }
    const relevantResults = selectRelevantResults(
      scored,
      threshold,
      this.bm25Index?.isReady ?? false,
    );
    // 네트워크·작업자 대기 중 바뀐 제외 정책도 응답 직전에 적용합니다.
    const currentPaths = await this.getCandidatePaths?.();
    throwIfQueryAborted(options.signal);
    const allowedResults = currentPaths
      ? relevantResults.filter((result) => currentPaths.has(result.sourcePath))
      : relevantResults;
    const results = selectDiverseResults(allowedResults, topK);
    diagnostics.push({
      providerId: 'query-ranking',
      source: 'reranker',
      status: 'ok',
      durationMs: performance.now() - rankingStarted,
      candidateCount: results.length,
      readiness: 'ready',
      estimatedCost: 'low',
      ranking: {
        mergedCandidates: retrieval.candidates.length,
        scopeRejected,
        invalidScoreRejected,
        scoredCandidates: scored.length,
        scoreRejected: scored.length - relevantResults.length,
        policyRejected: relevantResults.length - allowedResults.length,
        diversityRejected: allowedResults.length - results.length,
        returnedCandidates: results.length,
      },
    });
    this.lastRetrievalDiagnostics = diagnostics;
    options.onRetrieved?.(results, diagnostics);
    return results;
  }

  getLastRetrievalDiagnostics(): RetrievalProviderDiagnostic[] {
    return [...this.lastRetrievalDiagnostics];
  }

  getCandidateReadiness(): RAGCandidateReadiness {
    if (this.bm25Index) return this.bm25Index.isReady ? 'ready' : 'initializing';
    return this.vectorStore && this.embeddingProvider ? 'ready' : 'unavailable';
  }

  private async waitForIndexReadiness(signal?: AbortSignal): Promise<void> {
    if (!this.bm25Index || this.bm25Index.isReady || this.indexReadinessTimeoutMs === 0) return;
    const deadline = Date.now() + this.indexReadinessTimeoutMs;
    while (!this.bm25Index.isReady && Date.now() < deadline) {
      await waitForQueryDelay(
        Math.min(INDEX_READINESS_POLL_MS, Math.max(1, deadline - Date.now())),
        signal,
      );
      throwIfQueryAborted(signal);
    }
  }

  private async resolveQueryEmbedding(
    question: string,
    options: RAGQueryOptions,
  ): Promise<QueryEmbeddingResolution> {
    throwIfQueryAborted(options.signal);
    const startedAt = performance.now();
    const elapsed = (): number => performance.now() - startedAt;
    const embeddingProvider = this.embeddingProvider;
    if (!embeddingProvider) {
      return {
        vector: [],
        status: 'skipped',
        durationMs: elapsed(),
        readiness: 'cold',
        estimatedCost: 'free',
        skippedReason: 'embedding-unavailable',
      };
    }
    if (options.excludedProviderIds?.includes('query-embedding') === true) {
      return {
        vector: [],
        status: 'skipped',
        durationMs: elapsed(),
        readiness: 'degraded',
        estimatedCost: 'free',
        skippedReason: 'previous-attempt-failed',
      };
    }
    if (Date.now() < this.queryEmbeddingCooldownUntil) {
      return {
        vector: [],
        status: 'skipped',
        durationMs: elapsed(),
        readiness: 'degraded',
        estimatedCost: 'medium',
        skippedReason: 'embedding-cooldown',
      };
    }

    const abortController = new AbortController();
    const detachAbort = forwardAbortSignal(options.signal, abortController);
    try {
      throwIfQueryAborted(options.signal);
      const operation = embeddingProvider.embed(question, { signal: abortController.signal });
      const vector = await withQueryEmbeddingDeadline(
        operation,
        this.queryEmbeddingTimeoutMs,
        abortController,
        options.signal,
      );
      throwIfQueryAborted(options.signal);
      if (vector.length === 0) {
        throw new Error('Query embedding provider returned an empty vector.');
      }
      this.consecutiveQueryEmbeddingTimeouts = 0;
      this.queryEmbeddingCooldownUntil = 0;
      return {
        vector,
        status: 'ok',
        durationMs: elapsed(),
        readiness: 'ready',
        estimatedCost: 'medium',
      };
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('RAG query cancelled', 'AbortError');
      }
      const durationMs = elapsed();
      if (error instanceof QueryEmbeddingTimeoutError) {
        this.consecutiveQueryEmbeddingTimeouts++;
        if (this.consecutiveQueryEmbeddingTimeouts >= QUERY_EMBEDDING_TIMEOUT_THRESHOLD) {
          this.queryEmbeddingCooldownUntil = Date.now() + this.queryEmbeddingCooldownMs;
        }
        appLogger.warn('Query embedding timed out; continuing with lexical retrieval.', {
          source: 'rag.query',
          data: {
            timeoutMs: this.queryEmbeddingTimeoutMs,
            durationMs,
            consecutiveTimeouts: this.consecutiveQueryEmbeddingTimeouts,
          },
        });
        return {
          vector: [],
          status: 'timeout',
          durationMs,
          readiness: 'degraded',
          estimatedCost: 'medium',
          skippedReason: 'embedding-timeout',
        };
      }
      this.consecutiveQueryEmbeddingTimeouts = 0;
      appLogger.warn('Query embedding failed; continuing with lexical retrieval.', {
        source: 'rag.query',
        data: { durationMs },
        error,
      });
      return {
        vector: [],
        status: 'error',
        durationMs,
        readiness: 'degraded',
        estimatedCost: 'medium',
        skippedReason: 'query-embedding-failed',
        error: formatQueryError(error),
      };
    } finally {
      detachAbort();
    }
  }

  private async filterCurrentCandidates(
    candidates: RetrievalCandidate[],
  ): Promise<RetrievalCandidate[]> {
    if (!this.corpusStore) return candidates;
    const entries = await this.corpusStore.getEntriesByIds(candidates.map(({ entry }) => entry.id));
    const currentById = new Map(entries.map((entry) => [entry.id, entry]));
    return candidates.filter(({ entry }) => {
      const current = currentById.get(entry.id);
      return (
        current !== undefined &&
        isSourceRevisionCurrentRust(
          {
            filePath: entry.metadata.filePath,
            sourceMtime: entry.metadata.sourceMtime ?? -1,
            sourceSize: entry.metadata.sourceSize ?? -1,
            contentHash: entry.metadata.contentHash ?? '',
          },
          {
            filePath: current.metadata.filePath,
            sourceMtime: current.metadata.sourceMtime ?? -1,
            sourceSize: current.metadata.sourceSize ?? -1,
            contentHash: current.metadata.contentHash ?? '',
          },
        )
      );
    });
  }

  async getIndexReadiness(
    files: readonly RAGIndexFileSnapshot[],
  ): Promise<RetrievalProviderReadiness | null> {
    const plans: RustRagStatusPlan[] = [];
    if (this.vectorStore) {
      const records = await this.vectorStore.getFileIndexRecords();
      const contractRecord = records.find(
        (record) => record.embeddingProvider && record.embeddingModel,
      );
      const plan = planRagStatusRust({
        includedFiles: files,
        records,
        totalVaultFiles: files.length,
        embeddingProvider: this.embeddingProviderId ?? contractRecord?.embeddingProvider ?? '',
        embeddingModel: this.embeddingModel ?? contractRecord?.embeddingModel ?? '',
        reasons: INDEX_READINESS_REASONS,
      });
      if (plan) plans.push(plan);
    }
    if (this.bm25Index?.isReady) {
      const documents = await this.bm25Index.getCorpusDocumentsBySourcePaths(
        files.map((file) => file.path),
      );
      const recordsByPath = new Map<
        string,
        {
          document: (typeof documents)[number];
          vectorCount: number;
        }
      >();
      for (const document of documents) {
        const existing = recordsByPath.get(document.sourcePath);
        if (existing) {
          existing.vectorCount++;
        } else {
          recordsByPath.set(document.sourcePath, { document, vectorCount: 1 });
        }
      }
      const plan = planRagStatusRust({
        includedFiles: files,
        records: [...recordsByPath.values()].map(({ document, vectorCount }) => {
          const hasCompleteMetadata =
            document.sourceMtime !== undefined &&
            document.sourceSize !== undefined &&
            document.indexedAt !== undefined &&
            document.contentHash !== undefined;
          return {
            filePath: document.sourcePath,
            sourceMtime: document.sourceMtime,
            sourceSize: document.sourceSize,
            contentHash: document.contentHash,
            indexedAt: document.indexedAt,
            embeddingProvider: hasCompleteMetadata ? 'bm25' : undefined,
            embeddingModel: hasCompleteMetadata ? 'bm25' : undefined,
            hasCompleteMetadata,
            vectorCount,
          };
        }),
        totalVaultFiles: files.length,
        embeddingProvider: 'bm25',
        embeddingModel: 'bm25',
        reasons: INDEX_READINESS_REASONS,
      });
      if (plan) plans.push(plan);
    }
    if (plans.length === 0) return null;
    if (plans.some((plan) => plan.staleDocuments > 0 || plan.unknownDocuments > 0)) {
      return {
        readiness: 'stale',
        estimatedCost: 'low',
        reason: 'Current vault metadata differs from indexed file metadata.',
      };
    }
    if (plans.some((plan) => plan.updateRequiredDocuments.length === 0)) {
      return { readiness: 'ready', estimatedCost: 'low' };
    }
    const healthyDocuments = plans.reduce((total, plan) => total + plan.healthyDocuments, 0);
    return {
      readiness: healthyDocuments > 0 ? 'partial' : 'cold',
      estimatedCost: 'low',
      reason: 'The current vault contains files not covered by a healthy index.',
    };
  }

  private isEntryCompatible(
    entry: VectorEntry,
    queryVector: readonly number[],
    filePathPrefixes?: readonly string[],
  ): boolean {
    if (queryVector.length > 0 && entry.vector.length > 0) {
      if (entry.vector.length !== queryVector.length) return false;
      if (
        this.embeddingProviderId &&
        entry.metadata.embeddingProvider &&
        entry.metadata.embeddingProvider !== this.embeddingProviderId
      ) {
        return false;
      }
      if (
        this.embeddingModel &&
        entry.metadata.embeddingModel &&
        entry.metadata.embeddingModel !== this.embeddingModel
      ) {
        return false;
      }
    }
    return this.isEntryInQueryScope(entry, filePathPrefixes);
  }

  private isEntryInQueryScope(
    entry: VectorEntry,
    filePathPrefixes: readonly string[] | undefined,
  ): boolean {
    return this.isEntryInPathScope(entry, filePathPrefixes);
  }

  private isEntryInPathScope(
    entry: VectorEntry,
    filePathPrefixes: readonly string[] | undefined,
  ): boolean {
    if (!filePathPrefixes || filePathPrefixes.length === 0) return true;
    return filePathPrefixes.some((rawPrefix) => {
      const prefix = rawPrefix.trim().replace(/\/+$/, '');
      return (
        prefix.length > 0 &&
        (entry.metadata.filePath === prefix || entry.metadata.filePath.startsWith(`${prefix}/`))
      );
    });
  }

  async queryWithContext(question: string, topK = 5): Promise<string> {
    const results = await this.query(question, topK);
    if (results.length === 0) {
      return '';
    }
    return results
      .map(
        (r, i) =>
          `[Source ${i + 1}: ${r.entry.metadata.filePath}${r.entry.metadata.heading ? ` # ${r.entry.metadata.heading}` : ''}]\n${r.entry.metadata.text}`,
      )
      .join('\n\n---\n\n');
  }
}

function countKeywordMatches(queryTokens: string[], text: string): number {
  return countKeywordMatchesRust(queryTokens, text) ?? 0;
}

function selectRelevantResults(
  results: readonly QueryResult[],
  threshold: number,
  hasBm25: boolean,
): QueryResult[] {
  const indexes = selectRelevantResultIndicesRust(
    results.map((result) => ({
      score: result.score,
      vectorScore: result.vectorScore,
      bm25Score: result.bm25Score,
      keywordMatches: result.keywordMatches,
      retrievalSources: result.retrievalSources ?? [],
      sourceEvidenceScore: result.sourceEvidenceScore ?? 0,
      bestEvidenceRank: result.bestEvidenceRank,
    })),
    threshold,
    hasBm25,
  );
  if (indexes === null) return [];
  return selectByRustIndices(results, indexes, { dedupe: true });
}

function selectDiverseResults(results: QueryResult[], topK: number): QueryResult[] {
  if (topK <= 0 || results.length <= topK) return results.slice(0, topK);

  const indexes = planDiverseResultIndicesRust(
    results.map((result) => ({
      score: result.score,
      vector: result.entry.vector,
      sourcePath: result.sourcePath,
      heading: result.entry.metadata.heading,
    })),
    topK,
  );
  if (indexes === null || indexes.length === 0) return [];
  return selectByRustIndices(results, indexes, { dedupe: true });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function waitForQueryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfQueryAborted(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('RAG query cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function withQueryEmbeddingDeadline(
  operation: Promise<number[]>,
  timeoutMs: number,
  abortController: AbortController,
  signal?: AbortSignal,
): Promise<number[]> {
  let timeoutId: number | undefined;
  let removeAbortListener = (): void => undefined;
  const operations: Promise<number[]>[] = [operation];
  operations.push(
    new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        abortController.abort();
        reject(new QueryEmbeddingTimeoutError(timeoutMs));
      }, timeoutMs);
    }),
  );
  if (signal) {
    operations.push(
      new Promise<never>((_, reject) => {
        const abort = (): void => {
          reject(new DOMException('RAG query cancelled', 'AbortError'));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', abort);
      }),
    );
  }

  return Promise.race(operations).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    removeAbortListener();
  });
}

function forwardAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => undefined;
  const abort = (): void => controller.abort();
  if (signal.aborted) {
    abort();
    return () => undefined;
  }
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function normalizePositiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function normalizeNonNegativeDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function formatQueryError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class QueryEmbeddingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super('Query embedding timed out after ' + String(timeoutMs) + 'ms.');
    this.name = 'QueryEmbeddingTimeoutError';
  }
}

function throwIfQueryAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('RAG query cancelled', 'AbortError');
}
