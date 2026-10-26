import { t } from '../i18n';
import type { ChatMessage, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import { pageIndexedDiscoveryRust, planModelContextRust, planVaultQueryExpansionRust } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import type { IndexedVaultReviewOptions, IndexedVaultSearchResult } from './indexed-vault-review';

export interface IndexedFollowupResult {
  status: 'skipped' | 'searched' | 'failed';
  search?: IndexedVaultSearchResult;
  queries?: readonly string[];
}

/** 기본 발견을 대체하지 않고 보존한 단서 안에서 한 번만 추가 질의를 실행한다. */
export async function searchIndexedFollowup(
  options: IndexedVaultReviewOptions,
  base: IndexedVaultSearchResult,
  runSearch: (queries: readonly string[], paths: readonly string[]) => Promise<IndexedVaultSearchResult | null>,
  onUsage?: (usage: TokenUsage) => void,
  onRequest?: () => void,
): Promise<IndexedFollowupResult> {
  const { getFollowupPaths, discoveryCandidates, discoveryPaths } = options;
  if (options.deferAnswer || options.filters || !getFollowupPaths ||
    !discoveryCandidates || !discoveryPaths || options.isCurrent?.() === false) {
    return { status: 'skipped' };
  }
  const check = () => options.signal?.throwIfAborted();
  const collectPaths = async (): Promise<string[] | null> => {
    check();
    const allowedPaths = await getFollowupPaths();
    check();
    if (options.isCurrent?.() === false) return null;
    const paths = new Set<string>();
    let offset = 0;
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
      for (const item of page.items) paths.add(item.path);
      if (page.nextOffset === null) return [...paths];
      if (page.nextOffset <= offset) return null;
      offset = page.nextOffset;
    } while (offset > 0);
    return null;
  };
  try {
    const paths = await collectPaths();
    if (!paths?.length) return { status: 'skipped' };
    const allowed = new Set(paths);
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) return { status: 'failed' };
    const messages: ChatMessage[] = [
      { role: 'system', content: [t('llmEvidenceDataBoundary'), t('llmIndexedReviewFollowup')].join('\n\n') },
      { role: 'user', content: JSON.stringify({
        question: options.question,
        candidatePassages: base.evidence.filter((item) => allowed.has(item.path)).map((item) => ({
          quote: item.quote, verification: 'unverified',
        })),
        discoveredDocuments: paths.length,
      }) },
    ];
    const prepared = prepareProviderRequest(messages, undefined, budget.inputBytes);
    let response = '';
    onRequest?.();
    await options.provider.streamChat(prepared.messages, (chunk) => {
      if (!options.signal?.aborted && response.length <= 8192) response += chunk.content ?? '';
    }, 0.2, undefined, { signal: options.signal, toolChoice: 'none', onUsage });
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const plan = planVaultQueryExpansionRust(options.question, response);
    if (!plan?.variants.length) return { status: 'skipped' };
    // 계획 생성 중 바뀐 제외·접근 범위를 검색 직전에 다시 적용한다.
    const currentPaths = await collectPaths();
    if (!currentPaths?.length) return { status: 'skipped' };
    const search = await runSearch(plan.variants, currentPaths);
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    return search ? { status: 'searched', search, queries: plan.variants } : { status: 'failed' };
  } catch (error) {
    check();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    appLogger.warn('Follow-up search unavailable; retaining the base evidence.', {
      source: 'chat.indexed-followup', error,
    });
    return { status: 'failed' };
  }
}
