import type { ChatMessage, ChatOptions, ToolDefinition } from '../llm/providers';
import {
  isWholeVaultResearchIntentRust,
  planResearchRequestFailureRust,
  planResearchSummaryBatchesRust,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';
import type { NativeVaultToolRuntimeLike } from './native-vault-tool';
import { selectAnswerCitations } from './citation-selection';
import type { VaultResearchCache, VaultResearchCacheValue } from './research-cache';

const LIST_PAGE_SIZE = 100;
const REDUCE_MAX_ITEMS = 20;
const REDUCE_MAX_CHARS = 80_000;
const MAP_CONCURRENCY = 2;

export interface VaultResearchModel {
  chat(
    messages: ChatMessage[],
    temperature?: number,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string>;
}

export type VaultResearchPhase = 'inventory' | 'map' | 'reduce' | 'complete';

export interface VaultResearchProgress {
  phase: VaultResearchPhase;
  completedFiles: number;
  totalFiles: number;
  currentPath?: string;
}

export interface VaultResearchRunOptions {
  question: string;
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
  cacheNamespace?: string;
}

export interface VaultResearchResult {
  content: string;
  citations: SourceCitation[];
  processedFiles: number;
  totalFiles: number;
  failedFiles: string[];
}

export interface VaultResearchAgentDependencies {
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  cache?: VaultResearchCache;
}

interface VaultFileInventoryItem {
  path: string;
  modifiedAt: number;
  size: number;
}

interface VaultListPayload {
  action: 'list';
  files: VaultFileInventoryItem[];
  nextCursor: number | null;
  total: number;
}

interface VaultReadPayload {
  action: 'read';
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  content: string;
}

interface ResearchSummary {
  label: string;
  content: string;
}

export function isWholeVaultResearchRequest(question: string): boolean {
  return isWholeVaultResearchIntentRust(question) === true;
}

export function getVaultResearchPhaseLabel(phase: VaultResearchPhase): string {
  switch (phase) {
    case 'inventory':
      return t('vaultResearchPhaseInventory');
    case 'map':
      return t('vaultResearchPhaseMap');
    case 'reduce':
      return t('vaultResearchPhaseReduce');
    case 'complete':
      return t('vaultResearchPhaseComplete');
  }
}

export class VaultResearchAgent {
  private readonly wait: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly cache: VaultResearchCache | undefined;

  constructor(
    private readonly model: VaultResearchModel,
    private readonly vaultTool: NativeVaultToolRuntimeLike,
    dependencies: VaultResearchAgentDependencies = {},
  ) {
    this.wait = dependencies.wait ?? waitForDelay;
    this.cache = dependencies.cache;
  }

  async run(options: VaultResearchRunOptions): Promise<VaultResearchResult> {
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: 'inventory', completedFiles: 0, totalFiles: 0 });
    const stats = await this.vaultTool.execute(JSON.stringify({ action: 'stats' }), options.signal);
    const files = await this.listAllFiles(options.signal);
    const citationsById = new Map<string, SourceCitation>();
    const { summaries: fileSummaries, failedFiles } = await this.mapFiles(
      files,
      options,
      citationsById,
    );

    options.onProgress?.({
      phase: 'reduce',
      completedFiles: files.length,
      totalFiles: files.length,
    });
    const reduced = await this.reduceToBoundedSummaries(
      fileSummaries,
      options.question,
      options.signal,
    );
    const generatedContent = await this.requestModel(
      [
        'Write the final answer to the user question.',
        'State whole-vault coverage and distinguish key themes, important connections, uncertainty, and omissions.',
        'Explicitly state that unreadable files were omitted when the coverage gaps list is not empty.',
        'Preserve supplied [vault:...] source IDs on evidence-backed statements.',
        `Question: ${options.question}`,
        `Vault statistics: ${stats.modelText}`,
        `Coverage: ${fileSummaries.length} of ${files.length} files were read successfully.`,
        `Coverage gaps: ${failedFiles.length > 0 ? failedFiles.join(', ') : 'none'}`,
        'Hierarchical summaries:',
        ...reduced.map((summary) => `[${summary.label}]\n${summary.content}`),
      ].join('\n\n'),
      options.signal,
    );
    const content =
      failedFiles.length > 0
        ? `${t('vaultResearchCoverageWarning', {
            processed: fileSummaries.length,
            total: files.length,
            failed: failedFiles.length,
          })}\n\n${generatedContent}`
        : generatedContent;
    options.onProgress?.({
      phase: 'complete',
      completedFiles: files.length,
      totalFiles: files.length,
    });
    return {
      content,
      citations: selectAnswerCitations(content, [...citationsById.values()]),
      processedFiles: fileSummaries.length,
      totalFiles: files.length,
      failedFiles,
    };
  }

  private async listAllFiles(signal?: AbortSignal): Promise<VaultFileInventoryItem[]> {
    const files: VaultFileInventoryItem[] = [];
    let cursor = 0;
    while (true) {
      throwIfAborted(signal);
      const result = await this.vaultTool.execute(
        JSON.stringify({ action: 'list', cursor, limit: LIST_PAGE_SIZE }),
        signal,
      );
      const payload = parseListPayload(result.modelText);
      files.push(...payload.files);
      if (payload.nextCursor === null) return files;
      if (payload.nextCursor <= cursor) throw new Error(t('vaultResearchListStalled'));
      cursor = payload.nextCursor;
    }
  }

  private async mapFiles(
    files: readonly VaultFileInventoryItem[],
    options: VaultResearchRunOptions,
    citationsById: Map<string, SourceCitation>,
  ): Promise<{ summaries: ResearchSummary[]; failedFiles: string[] }> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const summaries = new Array<ResearchSummary | undefined>(files.length);
    const failedFiles = new Array<string | undefined>(files.length);
    let nextIndex = 0;
    let completedFiles = 0;
    let fatalError: unknown;
    const worker = async (): Promise<void> => {
      while (true) {
        throwIfAborted(controller.signal);
        const index = nextIndex++;
        if (index >= files.length) return;
        const file = files[index];
        if (!file) continue;
        options.onProgress?.({
          phase: 'map',
          completedFiles,
          totalFiles: files.length,
          currentPath: file.path,
        });
        try {
          const summary = await this.getOrCreateFileSummary(
            file,
            options.question,
            controller.signal,
            options.cacheNamespace ?? 'default',
          );
          for (const citation of summary.citations) citationsById.set(citation.id, citation);
          summaries[index] = { label: file.path, content: summary.content };
        } catch (error) {
          if (error instanceof VaultResearchFileReadError) {
            failedFiles[index] = file.path;
          } else {
            fatalError ??= error;
            controller.abort();
            throw error;
          }
        } finally {
          completedFiles++;
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(MAP_CONCURRENCY, files.length) }, () => worker()),
      );
    } catch (error) {
      throw fatalError ?? error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
    return {
      summaries: summaries.filter((summary): summary is ResearchSummary => summary !== undefined),
      failedFiles: failedFiles.filter((path): path is string => path !== undefined),
    };
  }

  private async summarizeFile(
    path: string,
    question: string,
    signal: AbortSignal | undefined,
  ): Promise<VaultResearchCacheValue> {
    const segmentSummaries: ResearchSummary[] = [];
    const citationsById = new Map<string, SourceCitation>();
    let startLine = 1;
    while (true) {
      throwIfAborted(signal);
      let result;
      let payload: VaultReadPayload;
      try {
        result = await this.vaultTool.execute(
          JSON.stringify({ action: 'read', path, start_line: startLine }),
          signal,
        );
        payload = parseReadPayload(result.modelText);
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new VaultResearchFileReadError(path, error);
      }
      for (const citation of result.citations) citationsById.set(citation.id, citation);
      const sourceIds = result.citations.map((citation) => citation.id).join(', ');
      const content = await this.requestModel(
        [
          'Summarize the following vault document segment factually.',
          'Preserve claims, decisions, tasks, relationships, contradictions, and uncertainty relevant to the question.',
          'Attach the supplied [vault:...] source IDs to the relevant statements.',
          `Question: ${question}`,
          `Document: ${payload.path} (lines ${payload.startLine}-${payload.endLine})`,
          `Source IDs: ${sourceIds}`,
          payload.content,
        ].join('\n\n'),
        signal,
      );
      segmentSummaries.push({
        label: `${path}:${payload.startLine}-${payload.endLine}`,
        content,
      });
      if (!payload.truncated || payload.endLine >= payload.totalLines) break;
      startLine = payload.endLine + 1;
    }
    if (segmentSummaries.length === 1) {
      return {
        content: segmentSummaries[0]?.content ?? '',
        citations: [...citationsById.values()],
      };
    }
    const reduced = await this.reduceToBoundedSummaries(segmentSummaries, question, signal);
    return {
      content: await this.requestModel(
        [
          `Merge the segment summaries for ${path} into one document summary.`,
          'Preserve source IDs and remove only duplication.',
          ...reduced.map((summary) => `[${summary.label}]\n${summary.content}`),
        ].join('\n\n'),
        signal,
      ),
      citations: [...citationsById.values()],
    };
  }

  private async getOrCreateFileSummary(
    file: VaultFileInventoryItem,
    question: string,
    signal: AbortSignal | undefined,
    namespace: string,
  ): Promise<VaultResearchCacheValue> {
    const cacheKey = {
      path: file.path,
      modifiedAt: file.modifiedAt,
      size: file.size,
      question,
      namespace,
    };
    try {
      const cached = await this.cache?.get(cacheKey);
      if (cached) return cached;
    } catch {
      // 캐시는 최적화 계층이므로 읽기 실패가 전체 조사를 중단하지 않습니다.
    }
    const summary = await this.summarizeFile(file.path, question, signal);
    try {
      await this.cache?.put(cacheKey, summary);
    } catch {
      // 캐시 저장 실패 시에도 현재 조사 결과는 그대로 사용합니다.
    }
    return summary;
  }

  private async reduceToBoundedSummaries(
    summaries: ResearchSummary[],
    question: string,
    signal?: AbortSignal,
  ): Promise<ResearchSummary[]> {
    let current = [...summaries];
    while (
      current.length > REDUCE_MAX_ITEMS ||
      current.reduce((total, summary) => total + summary.content.length, 0) > REDUCE_MAX_CHARS
    ) {
      throwIfAborted(signal);
      const batches = planResearchSummaryBatchesRust(
        current.map((summary) => summary.content.length),
        REDUCE_MAX_ITEMS,
        REDUCE_MAX_CHARS,
      );
      if (!batches || batches.length === 0 || batches.length >= current.length) {
        throw new Error(t('vaultResearchBatchPlanFailed'));
      }
      const next: ResearchSummary[] = [];
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex] ?? [];
        const selected = batch.flatMap((index) => {
          const summary = current[index];
          return summary ? [summary] : [];
        });
        const content = await this.requestModel(
          [
            'Compress the following research summary batch without losing evidence.',
            'Preserve facts, relationships, contradictions, uncertainty, and source IDs directly relevant to the question.',
            `Question: ${question}`,
            ...selected.map((summary) => `[${summary.label}]\n${summary.content}`),
          ].join('\n\n'),
          signal,
        );
        next.push({ label: `reduce-${batchIndex + 1}`, content });
      }
      current = next;
    }
    return current;
  }

  private async requestModel(prompt: string, signal?: AbortSignal): Promise<string> {
    for (let failedAttempt = 0; ; failedAttempt++) {
      throwIfAborted(signal);
      try {
        const content = await this.model.chat(
          [
            {
              role: 'system',
              content:
                'You are the internal research engine for an Obsidian vault. Use only supplied evidence, preserve source IDs, and never invent coverage.',
            },
            { role: 'user', content: prompt },
          ],
          0.2,
          undefined,
          { signal },
        );
        if (!content.trim()) throw new Error(t('vaultResearchEmptySummary'));
        return content.trim();
      } catch (error) {
        if (isAbortError(error)) throw error;
        const plan = planResearchRequestFailureRust({
          message: error instanceof Error ? error.message : String(error),
          status: getNumericErrorField(error, 'status'),
          failedAttempt,
          retryAfterMs: getNumericErrorField(error, 'retryAfterMs'),
        });
        if (!plan) throw new Error(t('vaultResearchFailurePlanFailed'));
        if (!plan.retryable) throw error;
        await this.wait(plan.retryDelayMs, signal);
      }
    }
  }
}

class VaultResearchFileReadError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Could not read vault file: ${path}`, { cause });
    this.name = 'VaultResearchFileReadError';
  }
}

function parseListPayload(modelText: string): VaultListPayload {
  const parsed: unknown = JSON.parse(modelText);
  if (!isRecord(parsed) || parsed.action !== 'list' || !Array.isArray(parsed.files)) {
    throw new Error(t('vaultResearchInvalidListResult'));
  }
  const files = parsed.files.filter(isVaultFileInventoryItem);
  if (files.length !== parsed.files.length) {
    throw new Error(t('vaultResearchInvalidListItem'));
  }
  if (
    !(parsed.nextCursor === null || isNonNegativeInteger(parsed.nextCursor)) ||
    !isNonNegativeInteger(parsed.total)
  ) {
    throw new Error(t('vaultResearchInvalidListPage'));
  }
  return { action: 'list', files, nextCursor: parsed.nextCursor, total: parsed.total };
}

function parseReadPayload(modelText: string): VaultReadPayload {
  const parsed: unknown = JSON.parse(modelText);
  if (
    !isRecord(parsed) ||
    parsed.action !== 'read' ||
    typeof parsed.path !== 'string' ||
    !isNonNegativeInteger(parsed.startLine) ||
    !isNonNegativeInteger(parsed.endLine) ||
    !isNonNegativeInteger(parsed.totalLines) ||
    typeof parsed.truncated !== 'boolean' ||
    typeof parsed.content !== 'string'
  ) {
    throw new Error(t('vaultResearchInvalidReadResult'));
  }
  return {
    action: 'read',
    path: parsed.path,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    totalLines: parsed.totalLines,
    truncated: parsed.truncated,
    content: parsed.content,
  };
}

function isVaultFileInventoryItem(value: unknown): value is VaultFileInventoryItem {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    isNonNegativeInteger(value.modifiedAt) &&
    isNonNegativeInteger(value.size)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('vaultResearchCancelled'), 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getNumericErrorField(
  error: unknown,
  field: 'status' | 'retryAfterMs',
): number | undefined {
  if (!(error instanceof Error) || !(field in error)) return undefined;
  const value = (error as Error & Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      window.clearTimeout(timeoutId);
      reject(new DOMException(t('vaultResearchCancelled'), 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
