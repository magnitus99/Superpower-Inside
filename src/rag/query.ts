import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider } from '../llm/providers';
import type { VectorStore, VectorEntry } from './store';
import { JsonFileBM25Index, tokenize } from './bm25';
import {
  GraphRagCandidateProvider,
  type GraphRagQueryEngine,
} from '../graph/query-engine';
import {
  BM25CandidateProvider,
  ExactVectorCandidateProvider,
  IvfVectorCandidateProvider,
  RagRetrievalPipeline,
  StructuralGraphCandidateProvider,
  type CandidateProvider,
  type RetrievalProviderDiagnostic,
  type StructuralMetadataContext,
} from './retrieval-pipeline';

const QUERY_SCORE_YIELD_INTERVAL = 512;
const RRF_K = 60;
const VECTOR_SCORE_WEIGHT = 0.35;
const RRF_SCORE_WEIGHT = 0.55;
const SOURCE_PRIOR_WEIGHT = 0.1;
const MMR_RELEVANCE_WEIGHT = 0.72;
const SAME_FILE_DIVERSITY_PENALTY = 0.12;
const SAME_HEADING_DIVERSITY_PENALTY = 0.06;
const DEFAULT_RERANK_CANDIDATE_LIMIT = 32;
const DEFAULT_RERANK_TIMEOUT_MS = 2500;

export interface RAGResultReranker {
  rerank(
    question: string,
    results: readonly QueryResult[],
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
}

function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface QueryResult {
  entry: VectorEntry;
  score: number;
  vectorScore: number;
  bm25Score: number;
  combinedScore: number;
  retrievalSources?: string[];
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
  reranker?: RAGResultReranker;
  rerankCandidateLimit?: number;
  embeddingModel?: string;
}

export class RAGQueryEngine {
  private embeddingProvider: EmbeddingProvider;
  private bm25Index: JsonFileBM25Index | undefined;
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
    bm25Index?: JsonFileBM25Index,
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
      providers.push(new StructuralGraphCandidateProvider(vectorStore, options.structuralMetadataContext));
    }
    if (options.graphRagEnabled === true && options.graphRagQueryEngine) {
      providers.push(new GraphRagCandidateProvider(options.graphRagQueryEngine));
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
      isEntryCompatible: this.embeddingModel
        ? (entry) => this.isEntryCompatible(entry, qVector)
        : undefined,
    });
    this.lastRetrievalDiagnostics = retrieval.diagnostics;
    const queryTokens = [...new Set(tokenize(question))];

    const scored: QueryResult[] = [];
    for (let index = 0; index < retrieval.candidates.length; index++) {
      const candidate = retrieval.candidates[index];
      const entry = candidate.entry;
      const cosineScore = cosineSimilarity(qVector, entry.vector);
      if (cosineScore === null) {
        continue;
      }
      const bm25 = candidate.sourceScores.bm25 ?? 0;
      const combinedBase = this.bm25Index?.isReady
        ? (1 - this.bm25Weight) * cosineScore + this.bm25Weight * bm25
        : cosineScore;
      const rrfScore = calculateRrfScore(candidate.sourceRanks, this.bm25Weight);
      const sourcePrior = getRetrievalSourcePrior(candidate.sourceScores);
      const combined =
        VECTOR_SCORE_WEIGHT * combinedBase +
        RRF_SCORE_WEIGHT * rrfScore +
        SOURCE_PRIOR_WEIGHT * sourcePrior;
      scored.push({
        entry,
        score: combined,
        vectorScore: cosineScore,
        bm25Score: bm25,
        combinedScore: combined,
        retrievalSources: [...candidate.sources],
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
    scored.sort((a, b) => b.score - a.score);

    const bestScore = scored[0]?.score ?? 0;
    const relativeThreshold = Math.max(threshold, bestScore - 0.18);

    const relevantResults = scored.filter((r) => {
      const sourceAwareThreshold = hasGraphOrStructuralEvidence(r)
        ? Math.max(threshold, bestScore - 0.45)
        : relativeThreshold;
      return isRelevantResult(r, sourceAwareThreshold, this.bm25Index?.isReady ?? false);
    });
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
    try {
      const rankedIds = await this.reranker.rerank(question, candidates);
      return applyRerankOrder(results, rankedIds);
    } catch {
      return [...results];
    }
  }
}

export class LLMRAGResultReranker implements RAGResultReranker {
  constructor(
    private readonly provider: LLMProvider,
    private readonly timeoutMs = DEFAULT_RERANK_TIMEOUT_MS,
  ) {}

  async rerank(
    question: string,
    results: readonly QueryResult[],
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    if (results.length === 0) return [];
    const response = await withTimeout(
      this.provider.chat(buildRerankMessages(question, results), 0),
      this.timeoutMs,
      signal,
    );
    return parseRerankResponse(response, new Set(results.map((result) => result.entry.id)));
  }
}

function countKeywordMatches(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const haystack = text.toLowerCase();
  return queryTokens.filter((token) => haystack.includes(token.toLowerCase())).length;
}

function applyRerankOrder(
  results: readonly QueryResult[],
  rankedIds: readonly string[],
): QueryResult[] {
  if (rankedIds.length === 0) return [...results];

  const byId = new Map(results.map((result) => [result.entry.id, result]));
  const seen = new Set<string>();
  const ordered: QueryResult[] = [];

  for (const id of rankedIds) {
    const result = byId.get(id);
    if (!result || seen.has(id)) continue;
    ordered.push(result);
    seen.add(id);
  }

  if (ordered.length === 0) return [...results];
  for (const result of results) {
    if (!seen.has(result.entry.id)) ordered.push(result);
  }
  return ordered;
}

function buildRerankMessages(question: string, results: readonly QueryResult[]) {
  const candidates = results.map((result, index) => ({
    id: result.entry.id,
    index,
    sourcePath: result.sourcePath,
    heading: result.entry.metadata.heading ?? '',
    text: truncateForRerank(result.entry.metadata.text, 700),
  }));

  return [
    {
      role: 'system' as const,
      content:
        'You rerank retrieval candidates for an Obsidian RAG answer. Return JSON only: {"rankedIds":["candidate-id"]}. Rank candidates by direct usefulness as answer evidence. Do not invent ids.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({ question, candidates }),
    },
  ];
}

function parseRerankResponse(response: string, allowedIds: ReadonlySet<string>): string[] {
  const parsed = parseJsonObject(response);
  const rankedIds = Array.isArray(parsed?.rankedIds) ? parsed.rankedIds : [];
  return rankedIds.filter((id): id is string => typeof id === 'string' && allowedIds.has(id));
}

function parseJsonObject(response: string): Record<string, unknown> | null {
  const trimmed = response.trim();
  const jsonText =
    trimmed.startsWith('{') && trimmed.endsWith('}')
      ? trimmed
      : trimmed.match(/\{[\s\S]*\}/u)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function truncateForRerank(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}...`;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (timeoutMs <= 0 && !signal) return promise;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
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
      timeoutId = setTimeout(() => {
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

function isRelevantResult(result: QueryResult, threshold: number, hasBm25: boolean): boolean {
  if (!Number.isFinite(result.combinedScore) || !Number.isFinite(result.vectorScore)) {
    return false;
  }
  if (result.combinedScore < threshold) return false;
  if (hasGraphOrStructuralEvidence(result)) return true;
  if (!hasBm25) return result.vectorScore >= Math.max(0.62, threshold);
  if (result.bm25Score > 0 && result.keywordMatches > 0) return true;
  return result.vectorScore >= Math.max(0.62, threshold + 0.08);
}

function hasGraphOrStructuralEvidence(result: QueryResult): boolean {
  const sources = result.retrievalSources ?? [];
  return sources.some(
    (source) =>
      source === 'structural' ||
      source === 'graph-local' ||
      source === 'graph-global' ||
      source === 'evidence',
  );
}

function calculateRrfScore(
  sourceRanks: Partial<Record<string, number>>,
  bm25Weight: number,
): number {
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [source, rank] of Object.entries(sourceRanks)) {
    if (typeof rank !== 'number' || rank < 1) continue;
    const weight = getRrfSourceWeight(source, bm25Weight);
    weightedScore += weight * (1 / (RRF_K + rank));
    totalWeight += weight * (1 / (RRF_K + 1));
  }

  if (totalWeight === 0) return 0;
  return weightedScore / totalWeight;
}

function getRrfSourceWeight(source: string, bm25Weight: number): number {
  if (source === 'bm25') return Math.max(0.05, bm25Weight);
  if (source === 'vector' || source === 'ann') return Math.max(0.05, 1 - bm25Weight);
  if (source === 'graph-local' || source === 'graph-global' || source === 'evidence') return 0.2;
  if (source === 'structural') return 0.12;
  return 0.05;
}

function getRetrievalSourcePrior(
  sourceScores: Partial<Record<string, number>>,
): number {
  const graphScore = Math.max(
    sourceScores['graph-local'] ?? 0,
    sourceScores['graph-global'] ?? 0,
    sourceScores.evidence ?? 0,
  );
  const graphPrior = graphScore > 0 ? Math.min(0.35, 0.12 + graphScore * 0.2) : 0;
  const structuralPrior =
    typeof sourceScores.structural === 'number' ? Math.min(0.18, sourceScores.structural * 0.12) : 0;
  const annPrior = typeof sourceScores.ann === 'number' ? Math.min(0.08, sourceScores.ann * 0.05) : 0;
  return Math.max(graphPrior, structuralPrior, annPrior);
}

function selectDiverseResults(results: QueryResult[], topK: number): QueryResult[] {
  if (topK <= 0 || results.length <= topK) return results.slice(0, topK);

  const selected: QueryResult[] = [];
  const remaining = [...results];

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = 0;
    let bestSelectionScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const diversityPenalty = calculateDiversityPenalty(candidate, selected);
      const maxSimilarity = selected.reduce(
        (max, selectedResult) =>
          Math.max(max, cosineSimilarity(candidate.entry.vector, selectedResult.entry.vector) ?? 0),
        0,
      );
      const selectionScore =
        MMR_RELEVANCE_WEIGHT * candidate.score -
        (1 - MMR_RELEVANCE_WEIGHT) * maxSimilarity -
        diversityPenalty;
      if (selectionScore > bestSelectionScore) {
        bestSelectionScore = selectionScore;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    selected.push(next);
  }

  return selected;
}

function calculateDiversityPenalty(candidate: QueryResult, selected: readonly QueryResult[]): number {
  let penalty = 0;
  for (const selectedResult of selected) {
    if (candidate.sourcePath !== selectedResult.sourcePath) continue;
    penalty = Math.max(penalty, SAME_FILE_DIVERSITY_PENALTY);
    if (
      candidate.entry.metadata.heading &&
      candidate.entry.metadata.heading === selectedResult.entry.metadata.heading
    ) {
      penalty = Math.max(penalty, SAME_FILE_DIVERSITY_PENALTY + SAME_HEADING_DIVERSITY_PENALTY);
    }
  }
  return penalty;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
