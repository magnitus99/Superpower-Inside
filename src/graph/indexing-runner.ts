import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider } from '../llm/providers';
import type { OntologySchema } from '../ontology/schema';
import { createContentHash } from '../rag/hash';
import {
  planGraphRagRunFileSelectionRust,
  planGraphRagUnsupportedPrunePathsRust,
  type RustGraphRagRunFilePathInput,
  type RustGraphRagRunFileSelectionMode,
  type RustGraphRagRunFileSelectionPlan,
} from '../rag/rust-core';
import type { VectorEntry, VectorStore } from '../rag/store';
import { buildEdges, detectCommunities } from './community-detector';
import { CommunitySummarizer } from './community-summarizer';
import { GraphExtractionIndexer } from './extraction';
import type { EntityResolverOptions } from './entity-resolver';
import {
  isProcessableGraphRagFilePath,
  type GraphRagFilePathPredicate,
} from './file-paths';
import type { GraphRagIndexingPhase, GraphRagIndexingProgress } from './indexing-progress';
import type { GraphRejectedFactRecord, KnowledgeGraphStore } from './store';

export type { GraphRagIndexingPhase, GraphRagIndexingProgress } from './indexing-progress';

export interface GraphRagIndexingRunnerOptions {
  vectorStore: VectorStore;
  graphStore: KnowledgeGraphStore;
  provider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  ontologySchema: OntologySchema;
  extractionModelKey: string;
  maxFilesPerRun: number;
  entityResolverOptions?: EntityResolverOptions;
  isProcessableFilePath?: GraphRagFilePathPredicate;
  onProgress?: (progress: GraphRagIndexingProgress) => void;
}

export interface GraphRagRunOptions {
  signal?: AbortSignal;
  onlyFailedFiles?: boolean;
  onlyStaleFiles?: boolean;
  failedFilePaths?: readonly string[];
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
  runId: number;
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
  private readonly isProcessableFilePath: GraphRagFilePathPredicate | undefined;
  private runSequence = 0;
  private lastRunId = 0;
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
    runId: 0,
    phase: 'idle',
  };
  private lastResult: GraphRagIndexingResult | null = null;

  private readonly onProgress: ((progress: GraphRagIndexingProgress) => void) | undefined;

  constructor(options: GraphRagIndexingRunnerOptions) {
    this.vectorStore = options.vectorStore;
    this.graphStore = options.graphStore;
    this.ontologySchema = options.ontologySchema;
    this.extractionModelKey = options.extractionModelKey;
    this.maxFilesPerRun = Math.max(1, Math.floor(options.maxFilesPerRun));
    this.isProcessableFilePath = options.isProcessableFilePath;
    this.onProgress = options.onProgress;
    this.indexer = new GraphExtractionIndexer({
      provider: options.provider,
      store: options.graphStore,
      entityResolverOptions: {
        autoMergeThreshold: options.entityResolverOptions?.autoMergeThreshold ?? 0.88,
        pendingMergeThreshold: options.entityResolverOptions?.pendingMergeThreshold ?? 0.72,
        embeddingProvider: options.embeddingProvider,
      },
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

  getLastRunId(): number {
    return this.lastRunId;
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

  resetState(): void {
    this.failedFilePaths.clear();
    this.lastResult = null;
    this.lastCommunityResult = null;
    this.lastRunId = 0;
    this.runSequence = 0;
    this.progress = {
      currentFile: null,
      processedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      selectedFiles: 0,
      runId: 0,
      phase: 'idle',
    };
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

      if (signal?.aborted) {
        return {
          communityCount: 0,
          entityCount: entities.length,
          modularity: 0,
          durationMs: Date.now() - startedAt,
        };
      }
      if (communityIds.length === 0) {
        await this.graphStore.replaceCommunities(this.ontologySchema.id, []);
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
      if (signal?.aborted) {
        return {
          communityCount: 0,
          entityCount: entities.length,
          modularity: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      await this.graphStore.replaceCommunities(this.ontologySchema.id, records);

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

  resumeFailed(
    options: Omit<GraphRagRunOptions, 'onlyFailedFiles' | 'onlyStaleFiles' | 'staleFilePaths'> = {},
  ): Promise<GraphRagIndexingResult> {
    return this.run({ ...options, onlyFailedFiles: true });
  }

  async run(options: GraphRagRunOptions = {}): Promise<GraphRagIndexingResult> {
    if (this.running) {
      throw new Error('GraphRAG indexing is already running.');
    }
    if (options.onlyFailedFiles === true && options.onlyStaleFiles === true) {
      throw new Error('onlyFailedFiles and onlyStaleFiles cannot be true at the same time.');
    }

    const runId = ++this.runSequence;
    this.lastRunId = runId;

    this.running = true;
    const startedAt = Date.now();
    this.progress = createEmptyProgress(runId, 0, 'selecting-files');
    this.emitProgress();
    await this.pruneUnsupportedGraphFiles();
    const fileSelection = await this.getFileSelection(options);
    const candidateFilePaths = fileSelection.candidateFilePaths;
    const selectedFilePaths = fileSelection.selectedFilePaths;
    const result = createEmptyResult(startedAt, candidateFilePaths.length, selectedFilePaths.length, runId);
    this.updateProgress({
      selectedFiles: selectedFilePaths.length,
      phase: selectedFilePaths.length > 0 ? 'checking-cache' : 'completed',
    });

    try {
      for (const filePath of selectedFilePaths) {
        if (options.signal?.aborted) {
          result.cancelled = true;
          break;
        }
        this.updateProgress({ currentFile: filePath, phase: 'checking-cache' });
        const entries = this.isProcessable(filePath)
          ? await this.vectorStore.getEntriesByFilePaths([filePath])
          : [];
        const fileResult = await this.processFile(
          filePath,
          entries,
          options.signal,
          options.onlyFailedFiles === true,
        );
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
          this.updateProgress({ failedFiles: result.failedFiles, phase: 'file-completed' });
        } else if (fileResult.processedChunks > 0) {
          result.processedFiles += 1;
          this.failedFilePaths.delete(filePath);
          this.updateProgress({ processedFiles: result.processedFiles, phase: 'file-completed' });
        } else {
          result.skippedFiles += 1;
          this.updateProgress({ skippedFiles: result.skippedFiles, phase: 'file-completed' });
        }
      }
    } finally {
      const shouldBuildCommunities =
        !result.cancelled &&
        (result.processedChunks > 0 || result.processedFiles > 0) &&
        !options.signal?.aborted;
      this.updateProgress({
        currentFile: null,
        phase:
          result.cancelled || options.signal?.aborted
            ? 'cancelled'
            : shouldBuildCommunities
              ? 'building-communities'
              : 'completed',
      });
      this.running = false;
      result.finishedAt = Date.now();
      this.lastResult = { ...result };
      if (shouldBuildCommunities) {
        await this.buildCommunities(options.signal);
      }
      this.updateProgress({
        currentFile: null,
        phase: result.cancelled || options.signal?.aborted ? 'cancelled' : 'completed',
      });
    }

    return result;
  }

  private updateProgress(patch: Partial<GraphRagIndexingProgress>): void {
    this.progress = { ...this.progress, ...patch };
    this.emitProgress();
  }

  private updateProgressPhase(phase: GraphRagIndexingPhase): void {
    this.updateProgress({ phase });
  }

  private emitProgress(): void {
    this.onProgress?.(this.getProgress());
  }

  private async getFileSelection(
    options: GraphRagRunOptions,
  ): Promise<RustGraphRagRunFileSelectionPlan> {
    const mode = getGraphRagRunFileSelectionMode(options);
    const failedFilePaths =
      mode === 'failed'
        ? await this.getFailedFilePaths(options.failedFilePaths)
        : [...this.failedFilePaths];
    const recordFilePaths: RustGraphRagRunFilePathInput[] = [];
    const indexedFilePaths: RustGraphRagRunFilePathInput[] = [];

    if (mode === 'full') {
      const records = await this.vectorStore.getFileIndexRecords();
      if (records.length > 0) {
        recordFilePaths.push(
          ...records.map((record) => this.toGraphRagRunFilePathInput(record.filePath)),
        );
      } else {
        indexedFilePaths.push(
          ...(await this.vectorStore.getIndexedFilePaths()).map((filePath) =>
            this.toGraphRagRunFilePathInput(filePath),
          ),
        );
      }
    }

    return (
      planGraphRagRunFileSelectionRust({
        mode,
        failedFilePaths,
        staleFilePaths: options.staleFilePaths ?? [],
        recordFilePaths,
        indexedFilePaths,
        maxFilesPerRun: this.maxFilesPerRun,
      }) ?? { candidateFilePaths: [], selectedFilePaths: [] }
    );
  }

  private toGraphRagRunFilePathInput(filePath: string): RustGraphRagRunFilePathInput {
    return {
      filePath,
      processable: this.isProcessableFilePath?.(filePath) ?? true,
    };
  }

  private toGraphRagUnsupportedFilePathInput(filePath: string): RustGraphRagRunFilePathInput {
    return {
      filePath,
      processable: this.isProcessable(filePath),
    };
  }

  private isProcessable(filePath: string): boolean {
    return isProcessableGraphRagFilePath(filePath, this.isProcessableFilePath);
  }

  private async getFailedFilePaths(explicitFilePaths: readonly string[] = []): Promise<string[]> {
    if (explicitFilePaths.length > 0) {
      return [...new Set(explicitFilePaths)];
    }
    const rejectedFacts = await this.graphStore.getRejectedFacts();
    return [
      ...new Set([
        ...this.failedFilePaths,
        ...explicitFilePaths,
        ...rejectedFacts.map((fact) => fact.filePath),
      ]),
    ];
  }

  private async processFile(
    filePath: string,
    entries: readonly VectorEntry[],
    signal?: AbortSignal,
    forceReprocess = false,
  ): Promise<{
    processedChunks: number;
    skippedChunks: number;
    failedChunks: number;
    cancelled: boolean;
  }> {
    const CONCURRENCY_LIMIT = 5;
    const result = { processedChunks: 0, skippedChunks: 0, failedChunks: 0, cancelled: false };
    const preparedEntries: Array<{ entry: VectorEntry; contentHash: string; cached: boolean }> = [];

    if (entries.length === 0) {
      this.updateProgressPhase('storing-results');
      await this.graphStore.pruneByFilePaths([filePath]);
      return result;
    }

    this.updateProgressPhase('checking-cache');
    for (const entry of entries) {
      if (signal?.aborted) {
        result.cancelled = true;
        return result;
      }
      const contentHash = entry.metadata.contentHash ?? createContentHash(entry.metadata.text);
      const cacheKey = {
        entryId: entry.id,
        contentHash,
        extractionModelKey: this.extractionModelKey,
        ontologySchemaId: this.ontologySchema.id,
        ontologyVersion: this.ontologySchema.version,
      };
      if (!forceReprocess && await this.graphStore.isExtractionCached(cacheKey)) {
        preparedEntries.push({ entry, contentHash, cached: true });
      } else {
        preparedEntries.push({ entry, contentHash, cached: false });
      }
    }

    if (preparedEntries.every((item) => item.cached)) {
      result.skippedChunks = preparedEntries.length;
      return result;
    }

    this.updateProgressPhase('storing-results');
    await this.graphStore.pruneByFilePaths([filePath]);

    for (let i = 0; i < preparedEntries.length; i += CONCURRENCY_LIMIT) {
      if (signal?.aborted) {
        result.cancelled = true;
        break;
      }
      const batch = preparedEntries.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async ({ entry, contentHash }): Promise<{
          processed: boolean;
          failed: boolean;
          cancelled: boolean;
        }> => {
          if (signal?.aborted) {
            return { processed: false, failed: false, cancelled: true };
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
              signal,
              onPhase: (phase) => this.updateProgressPhase(phase),
            });
            return { processed: true, failed: false, cancelled: false };
          } catch (error) {
            if (signal?.aborted || isAbortError(error)) {
              return { processed: false, failed: false, cancelled: true };
            }
            await this.graphStore.addRejectedFact(createChunkFailureRecord(filePath, entry, error));
            return { processed: false, failed: true, cancelled: false };
          }
        }),
      );

      for (const r of batchResults) {
        if (r.processed) result.processedChunks += 1;
        if (r.failed) result.failedChunks += 1;
        if (r.cancelled) result.cancelled = true;
      }
      if (result.cancelled) break;
    }
    return result;
  }

  private async pruneUnsupportedGraphFiles(): Promise<void> {
    const [evidence, rejectedFacts] = await Promise.all([
      this.graphStore.getEvidence(),
      this.graphStore.getRejectedFacts(),
    ]);
    const unsupportedFilePaths =
      planGraphRagUnsupportedPrunePathsRust(
        evidence.map((record) => this.toGraphRagUnsupportedFilePathInput(record.filePath)),
        rejectedFacts.map((record) => this.toGraphRagUnsupportedFilePathInput(record.filePath)),
      ) ?? [];
    if (unsupportedFilePaths.length === 0) return;
    await this.graphStore.pruneByFilePaths(unsupportedFilePaths);
  }
}

function createEmptyResult(
  startedAt: number,
  totalCandidateFiles: number,
  selectedFiles: number,
  runId: number,
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
    runId,
  };
}

function createEmptyProgress(
  runId: number,
  selectedFiles: number,
  phase: GraphRagIndexingPhase,
): GraphRagIndexingProgress {
  return {
    currentFile: null,
    processedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    selectedFiles,
    runId,
    phase,
  };
}

function getGraphRagRunFileSelectionMode(
  options: GraphRagRunOptions,
): RustGraphRagRunFileSelectionMode {
  if (options.onlyFailedFiles === true) return 'failed';
  if (options.onlyStaleFiles === true) return 'stale';
  return 'full';
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
