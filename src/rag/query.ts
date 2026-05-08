import type { EmbeddingProvider } from '../llm/embedding';
import type { VectorStore, VectorEntry } from './store';

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

  constructor(vectorStore: VectorStore, embeddingProvider: EmbeddingProvider) {
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
  }

  async query(question: string, topK = 5): Promise<QueryResult[]> {
    const qVector = await this.embeddingProvider.embed(question);
    const entries = await this.vectorStore.query(qVector, topK);
    return entries.map((e) => ({
      entry: e,
      score: cosineSimilarity(qVector, e.vector),
    }));
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
