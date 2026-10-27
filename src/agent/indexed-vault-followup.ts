import { t } from '../i18n';
import type { ChatMessage, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import { pageIndexedDiscoveryRust, planModelContextRust, planIndexedFollowupRust, scopeIndexedDiscoveryRust } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import type { IndexedVaultReviewOptions, IndexedVaultSearchResult } from './indexed-vault-review';

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
  runSearch: (queries: readonly string[], paths: readonly string[]) => Promise<IndexedVaultSearchResult | null>,
  onUsage?: (usage: TokenUsage) => void,
  onRequest?: () => void,
): Promise<IndexedFollowupResult> {
  const { getFollowupPaths, discoveryCandidates, discoveryPaths } = options;
  if (!getFollowupPaths || !discoveryCandidates || !discoveryPaths ||
    options.isCurrent?.() === false) {
    return { status: 'skipped' };
  }
  const check = () => options.signal?.throwIfAborted();
  const collectDiscovery = async () => {
    check();
    const allowedPaths = await getFollowupPaths();
    check();
    if (options.isCurrent?.() === false) return null;
    const paths = new Set<string>();
    const clues: { path: string; startLine?: number; endLine?: number; state: string; verification: 'unverified' }[] = [];
    const firstClues: typeof clues = [];
    let offset = 0;
    let nextOffset: number | null = null;
    do {
      check();
      const page = pageIndexedDiscoveryRust({
        candidates: discoveryCandidates, originalPaths: discoveryPaths,
        originalScopes: options.scopes, allowedPaths, scopes: options.scopes,
        reviewedPaths: base.coverage.plannedPaths,
        selectedPaths: base.evidence.map((item) => item.path), failedPaths: [],
        offset, limit: 96,
      });
      if (!page) return null;
      for (const item of page.items) {
        paths.add(item.path);
        const clue = { path: item.path, startLine: item.startLine, endLine: item.endLine,
          state: item.state, verification: item.verification };
        clues.push(clue);
        if (offset === 0) firstClues.push(clue);
      }
      if (offset === 0) nextOffset = page.nextOffset;
      if (page.nextOffset === null) return { paths: [...paths], clues, firstClues, nextOffset };
      if (page.nextOffset <= offset) return null;
      offset = page.nextOffset;
    } while (offset > 0);
    return null;
  };
  try {
    const discovery = await collectDiscovery();
    if (!discovery) return { status: 'failed' };
    if (!discovery.paths.length) return { status: 'skipped' };
    const allowed = new Set(discovery.paths);
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) return { status: 'failed' };
    const messages = (clues: typeof discovery.clues, nextOffset: number | null): ChatMessage[] => [
      { role: 'system', content: [t('llmEvidenceDataBoundary'), t('llmIndexedReviewFollowup')].join('\n\n') },
      { role: 'user', content: JSON.stringify({
        question: options.question,
        candidatePassages: base.evidence.filter((item) => allowed.has(item.path)).map((item) => ({
          quote: item.quote, verification: 'unverified',
        })),
        discoveredDocuments: discovery.paths.length,
        discovery: clues,
        discoveryNextOffset: nextOffset,
      }) },
    ];
    let prepared: ReturnType<typeof prepareProviderRequest>;
    try {
      prepared = prepareProviderRequest(messages(discovery.clues, null), undefined, budget.inputBytes);
    } catch {
      // 단서의 전달 예산과 전체 발견·검색 범위를 분리합니다. 나머지는 원장과 새 질의의 전체 범위에 남습니다.
      appLogger.debug('Paging discovery clues to fit the follow-up request budget.', {
        source: 'chat.indexed-followup',
        data: { discoveredDocuments: discovery.paths.length, sentClues: discovery.firstClues.length },
      });
      prepared = prepareProviderRequest(messages(discovery.firstClues, discovery.nextOffset), undefined, budget.inputBytes);
    }
    let response = '';
    onRequest?.();
    await options.provider.streamChat(prepared.messages, (chunk) => {
      if (!options.signal?.aborted && response.length <= 8192) response += chunk.content ?? '';
    }, 0.2, undefined, { signal: options.signal, toolChoice: 'none', onUsage });
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const plan = planIndexedFollowupRust(options.question, response);
    if (!plan) return { status: 'failed' };
    if (!plan.variants.length) return { status: 'skipped', enumerate: plan.enumerate };
    // 계획 생성 중 바뀐 제외·접근 범위를 검색 직전에 다시 적용한다.
    check();
    const allowedPaths = await getFollowupPaths();
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const currentPaths = scopeIndexedDiscoveryRust({
      originalPaths: discoveryPaths, originalScopes: options.scopes,
      allowedPaths, scopes: options.scopes,
    });
    if (!currentPaths) return { status: 'failed' };
    if (!currentPaths.length) return { status: 'skipped' };
    const search = await runSearch(plan.variants, currentPaths);
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    return search ? { status: 'searched', search, queries: plan.variants, enumerate: plan.enumerate }
      : { status: 'failed', enumerate: plan.enumerate };
  } catch (error) {
    check();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    appLogger.warn('Follow-up search unavailable; retaining the base evidence.', {
      source: 'chat.indexed-followup', error,
    });
    return { status: 'failed' };
  }
}
