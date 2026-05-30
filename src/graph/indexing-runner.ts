import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider } from '../llm/providers';
import type { OntologySchema } from '../ontology/schema';
import { createContentHash } from '../rag/hash';
import type { VectorEntry, VectorStore } from '../rag/store';
import { buildEdges, detectCommunities } from './community-detector';
import { CommunitySummarizer } from './community-summarizer';
import { GraphExtractionIndexer } from './extraction';
import type { EntityResolverOptions } from './entity-resolver';
import type { GraphRejectedFactRecord, KnowledgeGraphStore } from './store';

export interface GraphRagIndexingRunnerOptions {
  vectorStore: VectorStore;
  graphStore: KnowledgeGraphStore;
  provider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  ontologySchema: OntologySchema;
  extractionModelKey: string;
  maxFilesPerRun: number;
  entityResolverOptions?: EntityResolverOptions;
  onProgress?: (progress: GraphRagIndexingProgress) => void;
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

export interface GraphRagCommunityBuildResult {
  communityCount: number;
  entityCount: number;
  modularity: number;
  durationMs: number;
}

export class GraphRagIndexingRunner {
  private readonly vectorStore: VectorStore;
  private readonly graphStore: KnowledgeGraphStore;
  private readonly indexer: GraphExtractionIndexer;
  private readonly summarizer: CommunitySummarizer;
  private readonly ontologySchema: OntologySchema;
  private readonly extractionModelKey: string;
  private readonly maxFilesPerRun: number;
  private failedFilePaths = new Set<string>();
  private running = false;
  private communityBuildRunning = false;
  private lastCommunityResult: GraphRagCommunityBuildResult | null = null;
  private progress: GraphRagIndexingProgress = {
    currentFile: null,
    processedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    selectedFiles: 0,
  };
  private lastResult: GraphRagIndexingResult | null = null;

  private readonly onProgress: ((progress: GraphRagIndexingProgress) => void) | undefined;

  constructor(options: GraphRagIndexingRunnerOptions) {
    this.vectorStore = options.vectorStore;
    this.graphStore = options.graphStore;
    this.ontologySchema = options.ontologySchema;
    this.extractionModelKey = options.extractionModelKey;
    this.maxFilesPerRun = Math.max(1, Math.floor(options.maxFilesPerRun));
    this.onProgress = options.onProgress;
    this.indexer = new GraphExtractionIndexer({
      provider: options.provider,
      store: options.graphStore,
      entityResolverOptions: options.entityResolverOptions,
    });
    this.summarizer = new CommunitySummarizer({
      provider: options.provider,
      embeddingProvider: options.embeddingProvider,
      store: options.graphStore,
      ontologySchemaId: options.ontologySchema.id,
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  isCommunityBuildRunning(): boolean {
    return this.communityBuildRunning;
  }

  getProgress(): GraphRagIndexingProgress {
    return { ...this.progress };
  }

  getLastResult(): GraphRagIndexingResult | null {
    return this.lastResult ? { ...this.lastResult } : null;
  }

  getLastCommunityResult(): GraphRagCommunityBuildResult | null {
    return this.lastCommunityResult ? { ...this.lastCommunityResult } : null;
  }

  getFailedFileCount(): number {
    return this.failedFilePaths.size;
  }

  async buildCommunities(signal?: AbortSignal): Promise<GraphRagCommunityBuildResult> {
    if (this.communityBuildRunning) {
      throw new Error('Community build is already running.');
    }
    this.communityBuildRunning = true;
    const startedAt = Date.now();

    try {
      const [entities, relations] = await Promise.all([
        this.graphStore.getEntities(),
        this.graphStore.getRelations(),
      ]);

      const edges = buildEdges(entities, relations);
      const { communities, communityIds, modularity } = detectCommunities(edges);

      if (communityIds.length === 0 || signal?.aborted) {
        return {
          communityCount: 0,
          entityCount: entities.length,
          modularity: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      const records = await this.summarizer.summarizeCommunities(
        communities,
        communityIds,
        signal,
      );

      await this.summarizer.storeCommunities(records);

      const result: GraphRagCommunityBuildResult = {
        communityCount: records.length,
        entityCount: entities.length,
        modularity,
        durationMs: Date.now() - startedAt,
      };
      this.lastCommunityResult = result;
      return result;
    } finally {
      this.communityBuildRunning = false;
    }
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
        this.onProgress?.(this.getProgress());
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
      if (!result.cancelled && (result.processedChunks > 0 || result.processedFiles > 0) && !options.signal?.aborted) {
        await this.buildCommunities(options.signal);
      }
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
    const CONCURRENCY_LIMIT = 5;
    const result = { processedChunks: 0, skippedChunks: 0, failedChunks: 0, cancelled: false };

    for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
      if (signal?.aborted) {
        result.cancelled = true;
        break;
      }
      const batch = entries.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async (entry): Promise<{ skipped: boolean; processed: boolean; failed: boolean }> => {
          if (signal?.aborted) {
            return { skipped: false, processed: false, failed: false };
          }
          const contentHash = entry.metadata.contentHash ?? createContentHash(entry.metadata.text);
          const cacheKey = {
            entryId: entry.id,
            contentHash,
            extractionModelKey: this.extractionModelKey,
            ontologySchemaId: this.ontologySchema.id,
            ontologyVersion: this.ontologySchema.version,
          };
          try {
            if (await this.graphStore.isExtractionCached(cacheKey)) {
              return { skipped: true, processed: false, failed: false };
            }
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
            return { skipped: false, processed: true, failed: false };
          } catch (error) {
            await this.graphStore.addRejectedFact(createChunkFailureRecord(filePath, entry, error));
            return { skipped: false, processed: false, failed: true };
          }
        }),
      );

      for (const r of batchResults) {
        if (r.skipped) result.skippedChunks += 1;
        if (r.processed) result.processedChunks += 1;
        if (r.failed) result.failedChunks += 1;
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
