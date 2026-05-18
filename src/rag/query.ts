import type { EmbeddingProvider } from '../llm/embedding';
import type { VectorStore, VectorEntry } from './store';
import { JsonFileBM25Index, tokenize } from './bm25';

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

export class RAGQueryEngine {
  private vectorStore: VectorStore;
  private embeddingProvider: EmbeddingProvider;
  private bm25Index: JsonFileBM25Index | undefined;
  private bm25Weight: number;
  private minScore: number;

  constructor(
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    bm25Index?: JsonFileBM25Index,
    bm25Weight = 0.3,
    minScore = 0.5,
  ) {
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.bm25Index = bm25Index;
    this.bm25Weight = bm25Weight;
    this.minScore = minScore;
  }

  async query(question: string, topK = 5, minScore?: number): Promise<QueryResult[]> {
    const threshold = minScore ?? this.minScore;
    const qVector = await this.embeddingProvider.embed(question);
    const vectorEntries = await this.vectorStore.query(qVector, topK * 8);

    let bm25Scores = new Map<string, number>();
    if (this.bm25Index?.isReady) {
      bm25Scores = this.bm25Index.search(question);
    }
    const maxBm25 = Math.max(...bm25Scores.values(), 1);
    const bm25FilePaths = new Set(bm25Scores.keys());
    const allEntries = bm25FilePaths.size > 0 ? await this.vectorStore.getEntries() : [];
    const entriesById = new Map<string, VectorEntry>();
    for (const entry of vectorEntries) {
      entriesById.set(entry.id, entry);
    }
    for (const entry of allEntries) {
      if (bm25FilePaths.has(entry.metadata.filePath)) {
        entriesById.set(entry.id, entry);
      }
    }
    const queryTokens = [...new Set(tokenize(question))];

    const scored = [...entriesById.values()]
      .map((e) => {
        const cosineScore = cosineSimilarity(qVector, e.vector);
        const bm25 = (bm25Scores.get(e.metadata.filePath) ?? 0) / maxBm25;
        const combined = this.bm25Index?.isReady
          ? (1 - this.bm25Weight) * cosineScore + this.bm25Weight * bm25
          : cosineScore;
        return {
          entry: e,
          score: combined,
          vectorScore: cosineScore,
          bm25Score: bm25,
          combinedScore: combined,
          sourcePath: e.metadata.filePath,
          chunkRange: {
            startLine: e.metadata.startLine,
            endLine: e.metadata.endLine,
          },
          keywordMatches: countKeywordMatches(queryTokens, e.metadata.text),
        };
      })
      .sort((a, b) => b.score - a.score);

    const bestScore = scored[0]?.score ?? 0;
    const relativeThreshold = Math.max(threshold, bestScore - 0.18);

    return scored
      .filter((r) => isRelevantResult(r, relativeThreshold, this.bm25Index?.isReady ?? false))
      .slice(0, topK);
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
