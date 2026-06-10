import type { DataAdapter } from 'obsidian';
import { readJsonFromVault, writeJsonToVault } from '../utils/vault';
import { tokenizeRust } from './rust-core';

interface InvertedEntry {
  [docId: string]: number;
}

interface BM25Data {
  tokenizerVersion: number;
  inverted: Record<string, InvertedEntry>;
  docLengths: Record<string, number>;
  docSources: Record<string, string>;
  totalDocs: number;
  avgDocLength: number;
}

export interface BM25DocumentInput {
  id: string;
  text: string;
  sourcePath?: string;
}

export function tokenize(text: string): string[] {
  const rustTokens = tokenizeRust(text);
  if (rustTokens !== null) return rustTokens;

  const tokens: string[] = [];
  const parts = text.match(/[\p{L}\p{N}_\-/\\@.]+/gu) ?? [];
  for (const part of parts) {
    tokens.push(...tokenizePart(part));
  }
  return tokens;
}

function tokenizePart(part: string): string[] {
  const trimmed = part.trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return [];

  const localTokens: string[] = [];
  const normalized = normalizeToken(trimmed);
  pushToken(localTokens, normalized);

  if (isAscii(trimmed)) {
    tokenizeAsciiPart(trimmed, localTokens);
  } else {
    tokenizeUnicodePart(normalized, localTokens);
  }

  return [...new Set(localTokens)];
}

function tokenizeAsciiPart(part: string, tokens: string[]): void {
  const segments = part.split(/[_\-/\\@.]+/u).filter(Boolean);
  if (segments.length > 1) {
    pushToken(tokens, segments.join('').toLowerCase());
  }

  for (const segment of segments) {
    const camelParts = splitAsciiIdentifier(segment);
    if (camelParts.length > 1) {
      pushToken(tokens, camelParts.join('').toLowerCase());
    }
    for (const camelPart of camelParts) {
      pushToken(tokens, camelPart.toLowerCase());
    }
  }
}

function tokenizeUnicodePart(part: string, tokens: string[]): void {
  const compact = part.replace(/[^\p{L}\p{N}]+/gu, '');
  pushToken(tokens, compact);

  const groups =
    compact.match(
      /\p{Script=Hangul}+|\p{Script=Han}+|\p{Script=Hiragana}+|\p{Script=Katakana}+|\p{N}+|[a-zA-Z]+/gu,
    ) ?? [];
  for (const group of groups) {
    pushToken(tokens, group.toLowerCase());
  }

  const chars = [...compact];
  for (const size of [2, 3]) {
    for (let i = 0; i <= chars.length - size; i++) {
      pushToken(tokens, chars.slice(i, i + size).join(''));
    }
  }
}

function splitAsciiIdentifier(segment: string): string[] {
  const parts = segment.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) ?? [];
  return parts.length > 0 ? parts : [segment];
}

function normalizeToken(token: string): string {
  return token
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();
}

function pushToken(tokens: string[], token: string): void {
  const normalized = normalizeToken(token);
  if (normalized.length < 2) return;
  tokens.push(normalized);
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return false;
  }
  return true;
}

const K1 = 1.2;
const B = 0.75;
const TOKENIZER_VERSION = 2;

export class JsonFileBM25Index {
  private data: BM25Data;
  private adapter: DataAdapter;
  private path: string;
  private loaded: boolean;
  private batchDepth: number;
  private batchDirty: boolean;

  constructor(adapter: DataAdapter, path = '.superpower-inside/bm25-index.json') {
    this.adapter = adapter;
    this.path = path;
    this.data = createEmptyData();
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
  }

  async load(): Promise<void> {
    const raw = await readJsonFromVault(this.adapter, this.path);
    if (raw && typeof raw === 'object' && 'inverted' in (raw as Record<string, unknown>)) {
      const parsed = raw as Partial<BM25Data>;
      const docLengths = parsed.docLengths ?? {};
      this.data = {
        tokenizerVersion: typeof parsed.tokenizerVersion === 'number' ? parsed.tokenizerVersion : 0,
        inverted: parsed.inverted ?? {},
        docLengths,
        docSources:
          parsed.docSources ??
          Object.fromEntries(Object.keys(docLengths).map((docId) => [docId, docId])),
        totalDocs: parsed.totalDocs ?? Object.keys(docLengths).length,
        avgDocLength: parsed.avgDocLength ?? 1,
      };
    }
    this.loaded = true;
  }

  async persist(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    await this.persistNow();
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await operation();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchDirty) {
        await this.persistNow();
      }
    }
  }

  private async persistNow(): Promise<void> {
    await writeJsonToVault(this.adapter, this.path, this.data);
    this.batchDirty = false;
  }

  async clear(): Promise<void> {
    this.data = createEmptyData();
    await this.persist();
  }

  async rebuild(documents: readonly BM25DocumentInput[]): Promise<void> {
    await this.withBatch(async () => {
      await this.clear();
      for (const document of documents) {
        this.addDocument(document.id, document.text, document.sourcePath);
      }
      await this.persist();
    });
  }

  addDocument(docId: string, text: string, sourcePath = docId): void {
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
    this.data.docSources[docId] = sourcePath;
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
    delete this.data.docSources[docId];
    this.data.totalDocs = Object.keys(this.data.docLengths).length;
    const totalLen = Object.values(this.data.docLengths).reduce((a, b) => a + b, 0);
    this.data.avgDocLength = this.data.totalDocs > 0 ? totalLen / this.data.totalDocs : 1;
  }

  removeDocumentsBySource(sourcePath: string): void {
    const docIds = Object.entries(this.data.docSources)
      .filter(([, source]) => source === sourcePath)
      .map(([docId]) => docId);
    for (const docId of docIds) {
      this.removeDocument(docId);
    }
  }

  search(query: string): Map<string, number> {
    const queryTokens = [...new Set(tokenize(query))];
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
        const score =
          idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / this.data.avgDocLength))));
        scores.set(docId, (scores.get(docId) ?? 0) + score);
      }
    }
    return scores;
  }

  get isReady(): boolean {
    return this.loaded && this.data.totalDocs > 0;
  }

  get isTokenizerCurrent(): boolean {
    return this.data.tokenizerVersion === TOKENIZER_VERSION;
  }

  get totalDocs(): number {
    return this.data.totalDocs;
  }

  getDocumentSource(docId: string): string | undefined {
    return this.data.docSources[docId];
  }
}

function createEmptyData(): BM25Data {
  return {
    tokenizerVersion: TOKENIZER_VERSION,
    inverted: {},
    docLengths: {},
    docSources: {},
    totalDocs: 0,
    avgDocLength: 1,
  };
}
