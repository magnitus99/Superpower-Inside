import { t } from '../i18n';
import type { LLMProvider } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  planIndexedReviewInventoryRust,
  planIndexedReviewSegmentsRust,
  planModelContextRust,
  planResearchSummaryBatchesRust,
  renderIndexedReviewAnswerRust,
  validateIndexedReviewRust,
  type IndexedReviewSegment,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { appLogger } from '../utils/logger';
import { selectAnswerCitations } from './citation-selection';
import type {
  NativeVaultListResult,
  NativeVaultReadResult,
  NativeVaultSearchResult,
  NativeVaultToolRuntimeLike,
} from './native-vault-tool';
import type { VaultResearchProgress } from './research-agent';

interface IndexedVaultReviewOptions {
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  nativeTool: NativeVaultToolRuntimeLike;
  provider: Pick<LLMProvider, 'streamChat' | 'contextBudget'>;
  systemPrompt?: string;
  previousUserQuestions?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
  onAnswer?: (content: string) => void;
}

export interface IndexedVaultReviewResult {
  content: string;
  citations: SourceCitation[];
  processedFiles: number;
  totalFiles: number;
  rejectedFiles: number;
  providerTransfer: { sentFiles: number };
}

/** 검색은 읽기 순서만 바꾸며 색인 전체의 명시적 검토가 끝나야 최종 답변을 생성합니다. */
export async function reviewIndexedVault(
  options: IndexedVaultReviewOptions,
): Promise<IndexedVaultReviewResult> {
  const check = () => options.signal?.throwIfAborted();
  const interruptible = <T>(operation: Promise<T>): Promise<T> => {
    const signal = options.signal;
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException(t('cancelledLabel'), 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      void operation
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  };
  const execute = async (request: Record<string, unknown>) => {
    check();
    const result = await interruptible(
      options.nativeTool.execute(JSON.stringify(request), options.signal),
    );
    check();
    return result.modelText;
  };
  options.onProgress?.({ phase: 'inventory', completedFiles: 0, totalFiles: 0 });
  const visiblePaths: string[] = [];
  let cursor = 0;
  while (true) {
    const page = JSON.parse(
      await execute({ action: 'list', cursor, limit: 100 }),
    ) as NativeVaultListResult;
    visiblePaths.push(...page.files.map((file) => file.path));
    if (page.nextCursor === null) break;
    if (page.nextCursor <= cursor) throw new Error(t('vaultResearchListStalled'));
    cursor = page.nextCursor;
  }
  let priorityPaths: string[] = [];
  try {
    const search = JSON.parse(
      await execute({
        action: 'search',
        query: options.question,
        path: '',
        limit: 20,
        mode: 'auto',
        match: 'any',
      }),
    ) as NativeVaultSearchResult;
    priorityPaths = search.hits.map((hit) => hit.path);
  } catch (error) {
    check();
    appLogger.warn('Search prioritization failed; continuing the full indexed review.', {
      source: 'chat.indexed-review',
      error,
    });
  }
  const paths = planIndexedReviewInventoryRust({
    indexedPaths: options.indexedPaths,
    visiblePaths,
    priorityPaths,
    scopes: options.scopes,
  });
  if (!paths) throw new Error(t('vaultResearchContractUnavailable'));
  if (paths.length === 0)
    return {
      content: t('indexedReviewEmpty'),
      citations: [],
      processedFiles: 0,
      totalFiles: 0,
      rejectedFiles: 0,
      providerTransfer: { sentFiles: 0 },
    };

  const budget = options.provider.contextBudget ?? planModelContextRust({});
  if (!budget) throw new Error(t('vaultResearchContractUnavailable'));
  const batchChars = budget.evidenceChars;
  const citations = new Map<string, SourceCitation>();
  const relevantPaths = new Set<string>();
  const reviewedPaths = new Set<string>();
  const completedReads = new Set<string>();
  let unreadableFiles = 0;
  let summaries: string[] = [];
  let pending: IndexedReviewSegment[] = [];

  const request = async (instruction: string, body: string) => {
    check();
    const prepared = prepareProviderRequest(
      [
        { role: 'system', content: [t('llmEvidenceDataBoundary'), instruction].join('\n\n') },
        { role: 'user', content: body },
      ],
      undefined,
      budget.inputBytes,
    );
    let content = '';
    await interruptible(
      options.provider.streamChat(
        prepared.messages,
        (chunk) => {
          if (options.signal?.aborted) return;
          content += chunk.content ?? '';
        },
        0.2,
        undefined,
        { signal: options.signal, toolChoice: 'none' },
      ),
    );
    check();
    if (!content.trim()) throw new Error(t('indexedReviewIncomplete'));
    return content;
  };

  const compact = async () => {
    for (let round = 0; round < 16; round++) {
      const batches = planResearchSummaryBatchesRust(
        summaries.map((text) => text.length + 2),
        8,
        batchChars,
      );
      if (!batches) throw new Error(t('vaultResearchBatchPlanFailed'));
      if (batches.length <= 1 && summaries.join('\n\n').length <= batchChars) return;
      const before = summaries.join('\n\n').length;
      const next: string[] = [];
      for (const batch of batches) {
        next.push(
          await request(
            t('llmIndexedReviewReduce'),
            JSON.stringify({
              question: options.question,
              evidence: batch.map((index) => summaries[index]),
            }),
          ),
        );
      }
      summaries = next;
      if (summaries.join('\n\n').length >= before) throw new Error(t('indexedReviewIncomplete'));
    }
    throw new Error(t('indexedReviewIncomplete'));
  };

  const flush = async () => {
    const batches = planResearchSummaryBatchesRust(
      pending.map((row) => JSON.stringify(row).length),
      8,
      batchChars,
    );
    if (!batches) throw new Error(t('vaultResearchBatchPlanFailed'));
    for (const batch of batches) {
      const rows = batch.flatMap((index) => (pending[index] ? [pending[index]] : []));
      const body = JSON.stringify({
        question: options.question,
        previousUserQuestions: options.previousUserQuestions ?? [],
        segments: rows,
      });
      let review = validateIndexedReviewRust(rows, await request(t('llmIndexedReviewJudge'), body));
      if (!review)
        review = validateIndexedReviewRust(rows, await request(t('llmIndexedReviewJudge'), body));
      if (!review) throw new Error(t('indexedReviewIncomplete'));
      for (const finding of review.findings) {
        relevantPaths.add(finding.path);
        citations.set(finding.sourceId, {
          id: finding.sourceId,
          filePath: finding.path,
          line: finding.startLine,
          endLine: finding.endLine,
          preview: finding.quote,
          status: 'verified',
        });
      }
      summaries.push(...review.findings.map((finding) => JSON.stringify([finding])));
      if (summaries.length >= 8) await compact();
      // 즉시 응답하는 로컬 provider에서도 취소·화면 갱신을 처리할 기회를 줍니다.
      await interruptible(new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)));
    }
    pending = [];
    for (const path of completedReads) reviewedPaths.add(path);
  };

  for (const path of paths) {
    check();
    options.onProgress?.({
      phase: 'map',
      completedFiles: reviewedPaths.size,
      totalFiles: paths.length,
      currentPath: path,
    });
    let startLine = 1;
    let startOffset = 0;
    let readFailed = false;
    while (true) {
      let raw: string;
      try {
        raw = await execute({
          action: 'read',
          path,
          start_line: startLine,
          start_offset: startOffset,
        });
      } catch (error) {
        check();
        unreadableFiles++;
        readFailed = true;
        appLogger.warn('Source read failed; continuing the remaining indexed documents.', {
          source: 'chat.indexed-review',
          error,
        });
        break;
      }
      const rows = planIndexedReviewSegmentsRust(raw, batchChars);
      if (!rows || rows.some((row) => row.path !== path))
        throw new Error(t('indexedReviewIncomplete'));
      for (const row of rows) {
        pending.push(row);
        if (pending.length >= 8) await flush();
      }
      const payload = JSON.parse(raw) as NativeVaultReadResult;
      if (!payload.truncated) break;
      const nextLine = payload.nextStartLine;
      const nextOffset = payload.nextStartOffset ?? 0;
      if (
        nextLine === null ||
        nextLine === undefined ||
        nextLine < startLine ||
        (nextLine === startLine && nextOffset <= startOffset)
      )
        throw new Error(t('indexedReviewIncomplete'));
      startLine = nextLine;
      startOffset = nextOffset;
    }
    if (!readFailed) {
      completedReads.add(path);
      if (pending.length === 0) reviewedPaths.add(path);
    }
    options.onProgress?.({
      phase: 'map',
      completedFiles: reviewedPaths.size,
      totalFiles: paths.length,
      currentPath: path,
    });
  }
  await flush();
  check();
  if (unreadableFiles > 0)
    throw new Error(
      t('indexedReviewReadIncomplete', {
        completed: reviewedPaths.size,
        total: paths.length,
        unreadable: unreadableFiles,
      }),
    );
  await compact();
  if (reviewedPaths.size !== paths.length) throw new Error(t('indexedReviewIncomplete'));
  const rejectedFiles = paths.length - relevantPaths.size;
  const statement = t('indexedReviewCoverage', {
    total: paths.length,
    accepted: relevantPaths.size,
    rejected: rejectedFiles,
  });
  let answer = t('indexedReviewNoEvidence');
  if (summaries.length > 0) {
    options.onProgress?.({
      phase: 'reduce',
      completedFiles: paths.length,
      totalFiles: paths.length,
    });
    const response = await request(
      [options.systemPrompt, t('llmIndexedReviewAnswer')].filter(Boolean).join('\n\n'),
      JSON.stringify({
        question: options.question,
        previousUserQuestions: options.previousUserQuestions ?? [],
        evidence: summaries,
      }),
    );
    const rendered = renderIndexedReviewAnswerRust([...citations.keys()], response);
    if (!rendered) throw new Error(t('indexedReviewIncomplete'));
    answer = rendered;
    options.onAnswer?.(`${statement}\n\n${answer}`);
  }
  options.onProgress?.({
    phase: 'complete',
    completedFiles: paths.length,
    totalFiles: paths.length,
  });
  appLogger.notice('Completed the full indexed document review.', {
    source: 'chat.indexed-review',
    data: { reviewed: paths.length, accepted: relevantPaths.size, rejected: rejectedFiles },
  });
  return {
    content: `${statement}\n\n${answer}`,
    citations: selectAnswerCitations(answer, [...citations.values()], 0),
    totalFiles: paths.length,
    processedFiles: reviewedPaths.size,
    rejectedFiles,
    providerTransfer: { sentFiles: reviewedPaths.size },
  };
}
