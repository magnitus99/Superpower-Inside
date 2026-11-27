import { t } from '../i18n';
import type { ChatMessage, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import { pageIndexedDiscoveryRust, planModelContextRust, planIndexedFollowupRust, scopeIndexedDiscoveryRust } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import type { IndexedVaultReviewOptions, IndexedVaultSearchResult } from './indexed-vault-review';

const FOLLOWUP_TIMEOUT_MS = 12_000;

export interface IndexedFollowupResult {
  status: 'skipped' | 'searched' | 'failed';
  search?: IndexedVaultSearchResult;
  queries?: readonly string[];
  enumerate?: boolean;
}

/** 기본 발견을 대체하지 않고 보존한 단서를 바탕으로 한 번만 추가 질의를 실행한다. */
export async function searchIndexedFollowup(
  options: IndexedVaultReviewOptions,
  base: IndexedVaultSearchResult,
  runSearch: (queries: readonly string[], paths: readonly string[], signal?: AbortSignal) => Promise<IndexedVaultSearchResult | null>,
  onUsage?: (usage: TokenUsage) => void,
  onRequest?: () => void,
): Promise<IndexedFollowupResult> {
  if (options.executionMode === 'engine-only') return { status: 'skipped' };
  const { getFollowupPaths, discoveryCandidates, discoveryPaths } = options;
  if (!getFollowupPaths || !discoveryCandidates || !discoveryPaths ||
    options.isCurrent?.() === false) {
    return { status: 'skipped' };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timerHost = typeof window === 'undefined' ? globalThis : window;
  const deadline = timerHost.setTimeout(abort, FOLLOWUP_TIMEOUT_MS);
  const { signal } = controller;
  const check = () => signal.throwIfAborted();
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Indexed follow-up aborted.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  try {
    check();
    const allowedPaths = await wait(getFollowupPaths());
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    // 원장 전체는 로컬에 유지합니다. 계획 모델에는 첫 주소 페이지와 집계만 전달합니다.
    const page = pageIndexedDiscoveryRust({
      candidates: discoveryCandidates, originalPaths: discoveryPaths,
      originalScopes: options.scopes, allowedPaths, scopes: options.scopes,
      reviewedPaths: base.coverage.plannedPaths,
      selectedPaths: base.evidence.map((item) => item.path), failedPaths: [],
      offset: 0, limit: 96,
    });
    if (!page) return { status: 'failed' };
    if (!page.items.length) return { status: 'skipped' };
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) return { status: 'failed' };
    const messages: ChatMessage[] = [
      { role: 'system', content: [t('llmEvidenceDataBoundary'), t('llmIndexedReviewFollowup')].join('\n\n') },
      { role: 'user', content: JSON.stringify({
        question: options.question,
        discoveredDocuments: page.summary.discoveredDocuments,
        discovery: page.items.map(({ path, startLine, endLine, state, verification }) => ({ path, startLine, endLine, state, verification })),
        discoveryNextOffset: page.nextOffset,
      }) },
    ];
    const prepared = prepareProviderRequest(messages, undefined, budget.inputBytes);
    let response = '';
    onRequest?.();
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    await wait(options.provider.streamChat(prepared.messages, (chunk) => {
      if (!signal.aborted && response.length <= 8192) response += chunk.content ?? '';
    }, 0.2, undefined, { signal, toolChoice: 'none', onUsage: (usage) => { if (!signal.aborted) onUsage?.(usage); } }));
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const plan = planIndexedFollowupRust(options.question, response);
    if (!plan) return { status: 'failed' };
    if (!plan.variants.length) return { status: 'skipped', enumerate: plan.enumerate };
    // 계획 생성 중 바뀐 제외·접근 범위를 검색 직전에 다시 적용한다.
    check();
    const livePaths = await wait(getFollowupPaths());
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const currentPaths = scopeIndexedDiscoveryRust({
      originalPaths: discoveryPaths, originalScopes: options.scopes,
      allowedPaths: livePaths, scopes: options.scopes,
    });
    if (!currentPaths) return { status: 'failed' };
    if (!currentPaths.length) return { status: 'skipped' };
    // 중단 신호는 다음 corpus I/O를 막고 이미 시작된 읽기는 lease 해제 전에 정착시킵니다.
    const search = await runSearch(plan.variants, currentPaths, signal);
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    return search ? { status: 'searched', search, queries: plan.variants, enumerate: plan.enumerate }
      : { status: 'failed', enumerate: plan.enumerate };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (signal.aborted) return { status: 'failed' };
    if (error instanceof Error && error.name === 'AbortError') throw error;
    appLogger.warn('Follow-up search unavailable; retaining the base evidence.', {
      source: 'chat.indexed-followup',
    });
    return { status: 'failed' };
  } finally {
    timerHost.clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abort);
  }
}
