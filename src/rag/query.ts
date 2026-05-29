import type { EmbeddingProvider } from '../llm/embedding';
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

export interface QueryResult {
  entry: VectorEntry;
  score: number;
  vectorScore: number;
  bm25Score: number;
  combinedScore: number;
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
}

export class RAGQueryEngine {
  private embeddingProvider: EmbeddingProvider;
  private bm25Index: JsonFileBM25Index | undefined;
  private bm25Weight: number;
  private minScore: number;
  private retrievalPipeline: RagRetrievalPipeline;
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
    });
    this.lastRetrievalDiagnostics = retrieval.diagnostics;
    const queryTokens = [...new Set(tokenize(question))];

    const scored: QueryResult[] = [];
    for (let index = 0; index < retrieval.candidates.length; index++) {
      const candidate = retrieval.candidates[index];
      const entry = candidate.entry;
      const cosineScore = cosineSimilarity(qVector, entry.vector);
      const bm25 = candidate.sourceScores.bm25 ?? 0;
      const retrievalScore = getRetrievalSourceBoost(candidate.sourceScores);
      const combinedBase = this.bm25Index?.isReady
        ? (1 - this.bm25Weight) * cosineScore + this.bm25Weight * bm25
        : cosineScore;
      const combined = Math.max(combinedBase, retrievalScore);
      scored.push({
        entry,
        score: combined,
        vectorScore: cosineScore,
        bm25Score: bm25,
        combinedScore: combined,
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

    return scored
      .filter((r) => isRelevantResult(r, relativeThreshold, this.bm25Index?.isReady ?? false))
      .slice(0, topK);
  }

  getLastRetrievalDiagnostics(): RetrievalProviderDiagnostic[] {
    return [...this.lastRetrievalDiagnostics];
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
  if (queryTokens.length === 0) return 0;
  const haystack = text.toLowerCase();
  return queryTokens.filter((token) => haystack.includes(token.toLowerCase())).length;
}

function isRelevantResult(result: QueryResult, threshold: number, hasBm25: boolean): boolean {
  if (result.combinedScore < threshold) return false;
  if (!hasBm25) return true;
  if (result.bm25Score > 0 && result.keywordMatches > 0) return true;
  return result.vectorScore >= Math.max(0.62, threshold + 0.08);
}

function getRetrievalSourceBoost(
  sourceScores: Partial<Record<string, number>>,
): number {
  const graphScore = Math.max(
    sourceScores['graph-local'] ?? 0,
    sourceScores['graph-global'] ?? 0,
    sourceScores.evidence ?? 0,
  );
  if (graphScore > 0) return Math.max(0.68, graphScore);
  return Math.max(sourceScores.structural ?? 0, sourceScores.ann ?? 0);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
