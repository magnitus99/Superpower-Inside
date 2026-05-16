import type { DataAdapter } from 'obsidian';
import { readJsonFromVault, writeJsonToVault } from '../utils/vault';

interface InvertedEntry {
  [docId: string]: number;
}

interface BM25Data {
  inverted: Record<string, InvertedEntry>;
  docLengths: Record<string, number>;
  totalDocs: number;
  avgDocLength: number;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const parts = text.split(/[\s,.!?;:()[\]]{}"'「」『』【】《》]+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^[a-zA-Z0-9_\-/\\@.]+$/.test(trimmed)) {
      tokens.push(trimmed.toLowerCase());
    } else {
      const chars = [...trimmed];
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return tokens;
}

const K1 = 1.2;
const B = 0.75;

export class JsonFileBM25Index {
  private data: BM25Data;
  private adapter: DataAdapter;
  private path: string;
  private loaded: boolean;

  constructor(adapter: DataAdapter, path = '.superpower-inside/bm25-index.json') {
    this.adapter = adapter;
    this.path = path;
    this.data = { inverted: {}, docLengths: {}, totalDocs: 0, avgDocLength: 1 };
    this.loaded = false;
  }

  async load(): Promise<void> {
    const raw = await readJsonFromVault(this.adapter, this.path);
    if (raw && typeof raw === 'object' && 'inverted' in (raw as Record<string, unknown>)) {
      this.data = raw as BM25Data;
    }
    this.loaded = true;
  }

  async persist(): Promise<void> {
    await writeJsonToVault(this.adapter, this.path, this.data);
  }

  addDocument(docId: string, text: string): void {
    const tokens = tokenize(text);
    const freq: Record<string, number> = {};
    for (const token of tokens) {
      freq[token] = (freq[token] ?? 0) + 1;
    }

    this.removeDocument(docId);

    for (const [term, tf] of Object.entries(freq)) {
      if (!this.data.inverted[term]) this.data.inverted[term] = {};
      this.data.inverted[term][docId] = tf;
    }
    this.data.docLengths[docId] = tokens.length;
    this.data.totalDocs = Object.keys(this.data.docLengths).length;
    const totalLen = Object.values(this.data.docLengths).reduce((a, b) => a + b, 0);
    this.data.avgDocLength = this.data.totalDocs > 0 ? totalLen / this.data.totalDocs : 1;
  }

  removeDocument(docId: string): void {
    for (const term of Object.keys(this.data.inverted)) {
      delete this.data.inverted[term][docId];
      if (Object.keys(this.data.inverted[term]).length === 0) {
        delete this.data.inverted[term];
      }
    }
    delete this.data.docLengths[docId];
    this.data.totalDocs = Object.keys(this.data.docLengths).length;
    const totalLen = Object.values(this.data.docLengths).reduce((a, b) => a + b, 0);
    this.data.avgDocLength = this.data.totalDocs > 0 ? totalLen / this.data.totalDocs : 1;
  }

  search(query: string): Map<string, number> {
    const queryTokens = tokenize(query);
    const scores = new Map<string, number>();
    const totalDocs = this.data.totalDocs;
    if (totalDocs === 0) return scores;

    for (const rawToken of queryTokens) {
      const token = rawToken;
      const posting = this.data.inverted[token];
      if (!posting) continue;
      const df = Object.keys(posting).length;
      if (df === 0) continue;

      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

      for (const [docId, tf] of Object.entries(posting)) {
        const docLen = this.data.docLengths[docId] ?? 1;
        const score = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / this.data.avgDocLength))));
        scores.set(docId, (scores.get(docId) ?? 0) + score);
      }
    }
    return scores;
  }

  get isReady(): boolean {
    return this.loaded && this.data.totalDocs > 0;
  }

  get totalDocs(): number {
    return this.data.totalDocs;
  }
}
