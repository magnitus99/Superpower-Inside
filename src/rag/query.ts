import type { EmbeddingProvider } from '../llm/embedding';
import type { VectorStore, VectorEntry } from './store';
import { JsonFileBM25Index } from './bm25';

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
    const entries = await this.vectorStore.query(qVector, topK * 3);

    let bm25Scores = new Map<string, number>();
    if (this.bm25Index?.isReady) {
      bm25Scores = this.bm25Index.search(question);
    }
    const maxBm25 = Math.max(...bm25Scores.values(), 1);

    return entries
      .map((e) => {
        const cosineScore = cosineSimilarity(qVector, e.vector);
        const fileKey = e.id.replace(/::\d+$/, '');
        const bm25 = (bm25Scores.get(fileKey) ?? 0) / maxBm25;
        const combined =
          this.bm25Index?.isReady
            ? (1 - this.bm25Weight) * cosineScore + this.bm25Weight * bm25
            : cosineScore;
        return { entry: e, score: combined };
      })
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
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
