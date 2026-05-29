import type { LLMProvider } from '../llm/providers';
import type { OntologySchema } from '../ontology/schema';
import { createContentHash } from '../rag/hash';
import type { VectorEntry, VectorStore } from '../rag/store';
import { GraphExtractionIndexer } from './extraction';
import type { EntityResolverOptions } from './entity-resolver';
import type { GraphRejectedFactRecord, KnowledgeGraphStore } from './store';

export interface GraphRagIndexingRunnerOptions {
  vectorStore: VectorStore;
  graphStore: KnowledgeGraphStore;
  provider: LLMProvider;
  ontologySchema: OntologySchema;
  extractionModelKey: string;
  maxFilesPerRun: number;
  entityResolverOptions?: EntityResolverOptions;
}

export interface GraphRagRunOptions {
  signal?: AbortSignal;
  onlyFailedFiles?: boolean;
  onlyStaleFiles?: boolean;
  staleFilePaths?: readonly string[];
}

export interface GraphRagIndexingResult {
  totalCandidateFiles: number;
  selectedFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  processedChunks: number;
  skippedChunks: number;
  failedChunks: number;
  cancelled: boolean;
  startedAt: number;
  finishedAt: number;
}

export interface GraphRagIndexingProgress {
  currentFile: string | null;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedFiles: number;
}

export class GraphRagIndexingRunner {
  private readonly vectorStore: VectorStore;
  private readonly graphStore: KnowledgeGraphStore;
  private readonly indexer: GraphExtractionIndexer;
  private readonly ontologySchema: OntologySchema;
  private readonly extractionModelKey: string;
  private readonly maxFilesPerRun: number;
  private failedFilePaths = new Set<string>();
  private running = false;
  private progress: GraphRagIndexingProgress = {
    currentFile: null,
    processedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    selectedFiles: 0,
  };
  private lastResult: GraphRagIndexingResult | null = null;

  constructor(options: GraphRagIndexingRunnerOptions) {
    this.vectorStore = options.vectorStore;
    this.graphStore = options.graphStore;
    this.ontologySchema = options.ontologySchema;
    this.extractionModelKey = options.extractionModelKey;
    this.maxFilesPerRun = Math.max(1, Math.floor(options.maxFilesPerRun));
    this.indexer = new GraphExtractionIndexer({
      provider: options.provider,
      store: options.graphStore,
      entityResolverOptions: options.entityResolverOptions,
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getProgress(): GraphRagIndexingProgress {
    return { ...this.progress };
  }

  getLastResult(): GraphRagIndexingResult | null {
    return this.lastResult ? { ...this.lastResult } : null;
  }

  getFailedFileCount(): number {
    return this.failedFilePaths.size;
  }

  resumeFailed(options: Omit<GraphRagRunOptions, 'onlyFailedFiles' | 'onlyStaleFiles' | 'staleFilePaths'> = {}): Promise<GraphRagIndexingResult> {
    return this.run({ ...options, onlyFailedFiles: true });
  }

  async run(options: GraphRagRunOptions = {}): Promise<GraphRagIndexingResult> {
    if (this.running) {
      throw new Error('GraphRAG indexing is already running.');
    }
    if (options.onlyFailedFiles === true && options.onlyStaleFiles === true) {
      throw new Error('onlyFailedFiles and onlyStaleFiles cannot be true at the same time.');
    }

    this.running = true;
    const startedAt = Date.now();
    const candidateFilePaths = await this.getCandidateFilePaths(options);
    const selectedFilePaths = candidateFilePaths.slice(0, this.maxFilesPerRun);
    const result = createEmptyResult(startedAt, candidateFilePaths.length, selectedFilePaths.length);
    this.progress = {
      currentFile: null,
      processedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      selectedFiles: selectedFilePaths.length,
    };

    try {
      for (const filePath of selectedFilePaths) {
        if (options.signal?.aborted) {
          result.cancelled = true;
          break;
        }
        this.progress.currentFile = filePath;
        const entries = await this.vectorStore.getEntriesByFilePaths([filePath]);
        const fileResult = await this.processFile(filePath, entries, options.signal);
        result.processedChunks += fileResult.processedChunks;
        result.skippedChunks += fileResult.skippedChunks;
        result.failedChunks += fileResult.failedChunks;
        if (fileResult.cancelled) {
          result.cancelled = true;
          break;
        }
        if (fileResult.failedChunks > 0) {
          result.failedFiles += 1;
          this.failedFilePaths.add(filePath);
          this.progress.failedFiles = result.failedFiles;
        } else if (fileResult.processedChunks > 0) {
          result.processedFiles += 1;
          this.failedFilePaths.delete(filePath);
          this.progress.processedFiles = result.processedFiles;
        } else {
          result.skippedFiles += 1;
          this.progress.skippedFiles = result.skippedFiles;
        }
      }
    } finally {
      this.progress.currentFile = null;
      this.running = false;
      result.finishedAt = Date.now();
      this.lastResult = { ...result };
    }

    return result;
  }

  private async getCandidateFilePaths(options: GraphRagRunOptions): Promise<string[]> {
    if (options.onlyFailedFiles === true) {
      return [...this.failedFilePaths].sort();
    }
    if (options.onlyStaleFiles === true && options.staleFilePaths) {
      return [...options.staleFilePaths].sort();
    }
    const records = await this.vectorStore.getFileIndexRecords();
    if (records.length > 0) {
      return records.map((record) => record.filePath).sort();
    }
    return this.vectorStore.getIndexedFilePaths();
  }

  private async processFile(
    filePath: string,
    entries: readonly VectorEntry[],
    signal?: AbortSignal,
  ): Promise<{
    processedChunks: number;
    skippedChunks: number;
    failedChunks: number;
    cancelled: boolean;
  }> {
    const result = { processedChunks: 0, skippedChunks: 0, failedChunks: 0, cancelled: false };
    for (const entry of entries) {
      if (signal?.aborted) {
        result.cancelled = true;
        break;
      }
      const contentHash = entry.metadata.contentHash ?? createContentHash(entry.metadata.text);
      const cacheKey = {
        entryId: entry.id,
        contentHash,
        extractionModelKey: this.extractionModelKey,
        ontologySchemaId: this.ontologySchema.id,
        ontologyVersion: this.ontologySchema.version,
      };
      if (await this.graphStore.isExtractionCached(cacheKey)) {
        result.skippedChunks += 1;
        continue;
      }

      try {
        await this.indexer.extractChunk({
          chunkText: entry.metadata.text,
          filePath,
          entryId: entry.id,
          startLine: entry.metadata.startLine,
          endLine: entry.metadata.endLine,
          contentHash,
          extractionModelKey: this.extractionModelKey,
          ontologySchema: this.ontologySchema,
        });
        result.processedChunks += 1;
      } catch (error) {
        result.failedChunks += 1;
        await this.graphStore.addRejectedFact(createChunkFailureRecord(filePath, entry, error));
      }
    }
    return result;
  }
}

function createEmptyResult(
  startedAt: number,
  totalCandidateFiles: number,
  selectedFiles: number,
): GraphRagIndexingResult {
  return {
    totalCandidateFiles,
    selectedFiles,
    processedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    processedChunks: 0,
    skippedChunks: 0,
    failedChunks: 0,
    cancelled: false,
    startedAt,
    finishedAt: startedAt,
  };
}

function createChunkFailureRecord(
  filePath: string,
  entry: VectorEntry,
  error: unknown,
): GraphRejectedFactRecord {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `rejected:${entry.id}:extraction-error:${createContentHash(message)}`,
    filePath,
    entryId: entry.id,
    reason: 'extraction-error',
    rawFact: message,
    updatedAt: Date.now(),
  };
}
