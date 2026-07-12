import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider } from '../llm/providers';
import type { VectorStore, VectorEntry } from './store';
import type { IndexedDbBM25Index } from './bm25';
import { GraphRagCandidateProvider, type GraphRagQueryEngine } from '../graph/query-engine';
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
} from './retrieval-pipeline';
import {
  countKeywordMatchesRust,
  cosineSimilarityRust,
  planDiverseResultIndicesRust,
  planQueryResultScoreRust,
  planRerankMessagesRust,
  selectRelevantResultIndicesRust,
  planRerankResponseWithStatusRust,
  planRerankResultOrderRust,
  tokenizeRust,
  type RustRerankStatus,
  type RustSourceSelectionReason,
} from './rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';

const QUERY_SCORE_YIELD_INTERVAL = 512;
const DEFAULT_RERANK_CANDIDATE_LIMIT = 32;
const DEFAULT_RERANK_TIMEOUT_MS = 2500;

export interface RAGResultReranker {
  rerank(
    question: string,
    results: readonly QueryResult[],
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
  getLastRerankStatus?(): RustRerankStatus | null;
}

export interface QueryResult {
  entry: VectorEntry;
  score: number;
  vectorScore: number;
  bm25Score: number;
  combinedScore: number;
  retrievalSources?: string[];
  sourceEvidenceScore?: number;
  bestEvidenceRank?: number;
  hasGraphOrStructuralEvidence?: boolean;
  hasStrongGraphOrStructuralEvidence?: boolean;
  selectionReason?: RustSourceSelectionReason;
  sourcePath: string;
  chunkRange: {
    startLine: number;
    endLine?: number;
  };
  keywordMatches: number;
}

export interface RAGQueryEngineOptions {
  annEnabled?: boolean;
  annClusterCount?: number;
  annProbeCount?: number;
  annMinEntryCount?: number;
  structuralGraphEnabled?: boolean;
  structuralMetadataContext?: StructuralMetadataContext;
  graphRagEnabled?: boolean;
  graphRagQueryEngine?: GraphRagQueryEngine;
  graphRagReadiness?: () => RetrievalProviderReadiness;
  reranker?: RAGResultReranker;
  rerankCandidateLimit?: number;
  embeddingModel?: string;
}

export class RAGQueryEngine {
  private embeddingProvider: EmbeddingProvider;
  private bm25Index: IndexedDbBM25Index | undefined;
  private bm25Weight: number;
  private minScore: number;
  private retrievalPipeline: RagRetrievalPipeline;
  private reranker: RAGResultReranker | undefined;
  private rerankCandidateLimit: number;
  private embeddingModel: string | undefined;
  private lastRetrievalDiagnostics: RetrievalProviderDiagnostic[] = [];

  constructor(
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    bm25Index?: IndexedDbBM25Index,
    bm25Weight = 0.3,
    minScore = 0.5,
    options: RAGQueryEngineOptions = {},
  ) {
    this.embeddingProvider = embeddingProvider;
    this.bm25Index = bm25Index;
    this.bm25Weight = bm25Weight;
    this.minScore = minScore;
    this.reranker = options.reranker;
    this.embeddingModel = options.embeddingModel;
    this.rerankCandidateLimit = Math.max(
      1,
      Math.floor(options.rerankCandidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT),
    );
    const providers: CandidateProvider[] = [
      options.annEnabled === true
        ? new IvfVectorCandidateProvider(vectorStore, {
            minEntryCount: options.annMinEntryCount ?? 500,
            clusterCount: options.annClusterCount ?? 0,
            probeCount: options.annProbeCount ?? 4,
          })
        : new ExactVectorCandidateProvider(vectorStore),
    ];
    if (bm25Index) {
      providers.push(new BM25CandidateProvider(vectorStore, bm25Index));
    }
    if (options.structuralGraphEnabled === true && options.structuralMetadataContext) {
      providers.push(
        new StructuralGraphCandidateProvider(vectorStore, options.structuralMetadataContext),
      );
    }
    if (options.graphRagEnabled === true && options.graphRagQueryEngine) {
      providers.push(
        new GraphRagCandidateProvider(
          options.graphRagQueryEngine,
          options.graphRagReadiness ?? defaultGraphRagReadiness,
        ),
      );
    }
    this.retrievalPipeline = new RagRetrievalPipeline(providers);
  }

  async query(question: string, topK = 5, minScore?: number): Promise<QueryResult[]> {
    const threshold = minScore ?? this.minScore;
    const qVector = await this.embeddingProvider.embed(question);
    const retrieval = await this.retrievalPipeline.retrieve({
      question,
      queryVector: qVector,
      candidateLimit: topK * 8,
      vectorFilter: {
        embeddingModel: this.embeddingModel,
        dimension: qVector.length,
      },
      isEntryCompatible: this.embeddingModel
        ? (entry) => this.isEntryCompatible(entry, qVector)
        : undefined,
    });
    this.lastRetrievalDiagnostics = retrieval.diagnostics;
    const queryTokens = tokenizeRust(question) ?? [];

    const scored: QueryResult[] = [];
    for (let index = 0; index < retrieval.candidates.length; index++) {
      const candidate = retrieval.candidates[index];
      const entry = candidate.entry;
      const cosineScore = cosineSimilarityRust(qVector, entry.vector);
      if (cosineScore === null) {
        continue;
      }
      const bm25 = candidate.sourceScores.bm25 ?? 0;
      const scorePlan = planQueryResultScoreRust({
        cosineScore,
        bm25Score: bm25,
        bm25Weight: this.bm25Weight,
        hasBm25: this.bm25Index?.isReady ?? false,
        sourceScores: candidate.sourceScores,
        sourceRanks: candidate.sourceRanks,
        retrievalSources: candidate.sources,
      });
      if (!scorePlan) {
        continue;
      }
      scored.push({
        entry,
        score: scorePlan.combinedScore,
        vectorScore: cosineScore,
        bm25Score: bm25,
        combinedScore: scorePlan.combinedScore,
        retrievalSources: [...candidate.sources],
        sourceEvidenceScore: scorePlan.sourceEvidenceScore,
        bestEvidenceRank: scorePlan.bestEvidenceRank,
        hasGraphOrStructuralEvidence: scorePlan.hasGraphOrStructuralEvidence,
        hasStrongGraphOrStructuralEvidence: scorePlan.hasStrongGraphOrStructuralEvidence,
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
    if (this.reranker && relevantResults.length > 1) {
      const diversePool = selectDiverseResults(
        relevantResults,
        Math.min(relevantResults.length, Math.max(topK, this.rerankCandidateLimit)),
      );
      const rerankedResults = await this.rerankResults(question, diversePool);
      return rerankedResults.slice(0, topK);
    }
    return selectDiverseResults(relevantResults, topK);
  }

  getLastRetrievalDiagnostics(): RetrievalProviderDiagnostic[] {
    return [...this.lastRetrievalDiagnostics];
  }

  private isEntryCompatible(entry: VectorEntry, queryVector: readonly number[]): boolean {
    if (entry.vector.length !== queryVector.length) return false;
    if (
      this.embeddingModel &&
      entry.metadata.embeddingModel &&
      entry.metadata.embeddingModel !== this.embeddingModel
    ) {
      return false;
    }
    return true;
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

  private async rerankResults(
    question: string,
    results: readonly QueryResult[],
  ): Promise<QueryResult[]> {
    if (!this.reranker || results.length <= 1) return [...results];

    const candidates = results.slice(0, this.rerankCandidateLimit);
    const startedAt = Date.now();
    try {
      const rankedIds = await this.reranker.rerank(question, candidates);
      const rerankStatus =
        this.reranker.getLastRerankStatus?.() ??
        (rankedIds.length > 0 ? 'applied' : 'empty-rank-plan');
      const order = planRerankResultOrderRust(
        results.map((result) => result.entry.id),
        rankedIds,
      );
      if (!order || order.length !== results.length) {
        this.recordRerankDiagnostic(rerankStatus, Date.now() - startedAt, candidates.length);
        return [...results];
      }
      const reranked = selectByRustIndices(results, order, { dedupe: true });
      if (reranked.length === results.length) {
        this.recordRerankDiagnostic(rerankStatus, Date.now() - startedAt, candidates.length);
        return reranked;
      }
      this.recordRerankDiagnostic(rerankStatus, Date.now() - startedAt, candidates.length);
      return [...results];
    } catch (error) {
      this.recordRerankDiagnostic('error', Date.now() - startedAt, candidates.length, error);
      return [...results];
    }
  }

  private recordRerankDiagnostic(
    status: RustRerankStatus | 'error',
    durationMs: number,
    candidateCount: number,
    error?: unknown,
  ): void {
    this.lastRetrievalDiagnostics = [
      ...this.lastRetrievalDiagnostics,
      {
        providerId: 'llm-reranker',
        source: 'reranker',
        status: status === 'applied' ? 'ok' : 'error',
        durationMs,
        candidateCount,
        readiness: 'ready',
        estimatedCost: 'medium',
        skippedReason: status,
        ...(error instanceof Error ? { error: error.message } : {}),
      },
    ];
  }
}

function defaultGraphRagReadiness(): RetrievalProviderReadiness {
  return { readiness: 'partial', estimatedCost: 'free' };
}

export class LLMRAGResultReranker implements RAGResultReranker {
  private lastRerankStatus: RustRerankStatus | null = null;

  constructor(
    private readonly provider: LLMProvider,
    private readonly timeoutMs = DEFAULT_RERANK_TIMEOUT_MS,
  ) {}

  async rerank(
    question: string,
    results: readonly QueryResult[],
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    this.lastRerankStatus = null;
    if (results.length === 0) return [];
    const messagePlan = planRerankMessagesRust(
      question,
      results.map((result) => ({
        id: result.entry.id,
        sourcePath: result.sourcePath,
        heading: result.entry.metadata.heading ?? '',
        text: result.entry.metadata.text,
      })),
      700,
    );
    if (!messagePlan) return [];
    const response = await withTimeout(
      this.provider.chat(
        [
          {
            role: 'system' as const,
            content: messagePlan.systemContent,
          },
          {
            role: 'user' as const,
            content: messagePlan.userContent,
          },
        ],
        0,
        undefined,
        { signal },
      ),
      this.timeoutMs,
      signal,
    );
    const responsePlan = planRerankResponseWithStatusRust(
      response,
      results.map((result) => result.entry.id),
    );
    this.lastRerankStatus = responsePlan?.rerankStatus ?? 'invalid-json';
    return responsePlan?.rankedIds ?? [];
  }

  getLastRerankStatus(): RustRerankStatus | null {
    return this.lastRerankStatus;
  }
}

function countKeywordMatches(queryTokens: string[], text: string): number {
  return countKeywordMatchesRust(queryTokens, text) ?? 0;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (timeoutMs <= 0 && !signal) return promise;

  let timeoutId: number | undefined;
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      if (timeoutId) window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new Error('RAG reranking cancelled'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('RAG reranking timed out'));
      }, timeoutMs);
    }
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
