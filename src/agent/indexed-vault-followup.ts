import { t } from '../i18n';
import type { ChatMessage, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import { pageIndexedDiscoveryRust, planModelContextRust, planIndexedFollowupRust, scopeIndexedDiscoveryRust } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import type { IndexedVaultReviewOptions, IndexedVaultSearchResult } from './indexed-vault-review';

import { parseFacetRetrieval, type RetrievalSubject } from './facet-retrieval';

const FOLLOWUP_TIMEOUT_MS = 12_000;

type FollowupPhase = 'scope' | 'discovery-page' | 'request-budget' | 'provider' | 'plan' | 'scope-recheck' | 'search';
export type FollowupFailure = FollowupPhase | `timeout-${FollowupPhase}` | 'merge';

export interface IndexedFollowupResult {
  failure?: FollowupFailure;
  status: 'skipped' | 'searched' | 'failed';
  search?: IndexedVaultSearchResult;
  queries?: readonly string[];
  enumerate?: boolean;
  rankedPaths?: readonly (readonly string[])[];
  subjects?: RetrievalSubject[];
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
  if (!getFollowupPaths || !discoveryCandidates?.length || !discoveryPaths?.length ||
    options.isCurrent?.() === false) {
    return { status: 'skipped' };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timerHost = typeof window === 'undefined' ? globalThis : window;
  const expiresAt = performance.now() + FOLLOWUP_TIMEOUT_MS;
  const deadline = timerHost.setTimeout(abort, FOLLOWUP_TIMEOUT_MS);
  const { signal } = controller;
  const check = () => {
    if (performance.now() >= expiresAt) abort();
    signal.throwIfAborted();
  };
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
  let phase: FollowupPhase = 'scope';
  const failed = (): IndexedFollowupResult => ({ status: 'failed', failure: signal.aborted ? `timeout-${phase}` : phase });
  try {
    check();
    const allowedPaths = await wait(getFollowupPaths());
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    // 원장 전체는 로컬에 유지합니다. 계획 모델에는 첫 주소 페이지와 집계만 전달합니다.
    phase = 'discovery-page';
    const page = pageIndexedDiscoveryRust({
      candidates: discoveryCandidates, originalPaths: discoveryPaths,
      originalScopes: options.scopes, allowedPaths, scopes: options.scopes,
      reviewedPaths: base.coverage.plannedPaths,
      selectedPaths: base.evidence.map((item) => item.path), failedPaths: [],
      offset: 0, limit: 96,
    });
    check();
    if (!page) return failed();
    if (!page.items.length) return { status: 'skipped' };
    phase = 'request-budget';
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) return failed();
    const compare = !!options.rankFollowup && options.searchPlan?.mode === 'comparison';
    const allowed = new Set(allowedPaths);
    // Aggregate script signal only. Never send unverified index excerpts to the planner.
    const scripts = { latin: 0, hangul: 0, han: 0, other: 0 };
    for (const item of base.evidence) {
      if (!allowed.has(item.path)) continue;
      const sample = item.quote.slice(0, 1024);
      const latin = /[A-Za-z]/u.test(sample), hangul = /[가-힣]/u.test(sample), han = /\p{Script=Han}/u.test(sample);
      if (latin) scripts.latin++;
      if (hangul) scripts.hangul++;
      if (han) scripts.han++;
      if (!latin && !hangul && !han) scripts.other++;
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: [t('llmEvidenceDataBoundary'), compare ? t('llmIndexedFacetRetrieval') : t('llmIndexedReviewFollowup')].join('\n\n') },
      { role: 'user', content: JSON.stringify({
        question: options.question,
        sourcePassagesByScript: scripts,
        discoveredDocuments: page.summary.discoveredDocuments,
        discovery: page.items.map(({ path, startLine, endLine, state, verification }) => ({ path, startLine, endLine, state, verification })),
        discoveryNextOffset: page.nextOffset,
      }) },
    ];
    const prepared = prepareProviderRequest(messages, undefined, budget.inputBytes);
    let response = '';
    check();
    phase = 'provider';
    onRequest?.();
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    await wait(options.provider.streamChat(prepared.messages, (chunk) => {
      if (!signal.aborted && response.length <= 8192) response += chunk.content ?? '';
    }, 0.2, undefined, { signal, toolChoice: 'none', onUsage: (usage) => { if (!signal.aborted) onUsage?.(usage); } }));
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    phase = 'plan';
    const subjects = compare ? parseFacetRetrieval(options.question, response) : null;
    if (compare && !subjects) return failed();
    const plan = planIndexedFollowupRust(options.question, subjects ? JSON.stringify({ queries: subjects.map(s => s.query), enumerate: false }) : response);
    check();
    if (!plan) return failed();
    if (!plan.variants.length) return { status: 'skipped', enumerate: plan.enumerate };
    // 계획 생성 중 바뀐 제외·접근 범위를 검색 직전에 다시 적용한다.
    check();
    phase = 'scope-recheck';
    const livePaths = await wait(getFollowupPaths());
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    const currentPaths = scopeIndexedDiscoveryRust({
      originalPaths: discoveryPaths, originalScopes: options.scopes,
      allowedPaths: livePaths, scopes: options.scopes,
    });
    check();
    if (!currentPaths) return failed();
    if (!currentPaths.length) return { status: 'skipped' };
    // 신호를 받지 않는 corpus 읽기의 소유권은 source가 정착까지 보존합니다. 늦은 결과는 병합하지 않습니다.
    phase = 'search';
    if (options.rankFollowup) {
      if (subjects && (subjects.length !== plan.variants.length || subjects.some((s,i) => s.query !== plan.variants[i]))) return failed();
      const ranked = await wait(options.rankFollowup(subjects?.map(s => s.discoveryQuery) ?? plan.variants, currentPaths, signal));
      check();
      if (!ranked || ranked.length !== plan.variants.length || options.isCurrent?.() === false) return failed();
      const allowed = new Set(currentPaths);
      return { status: 'searched', queries: plan.variants, enumerate: plan.enumerate,
        rankedPaths: ranked.map(group => group.filter(path => allowed.has(path)).slice(0, 8)), subjects: subjects ?? undefined };
    }
    const search = await wait(runSearch(plan.variants, currentPaths, signal));
    check();
    if (options.isCurrent?.() === false) return { status: 'skipped' };
    return search ? { status: 'searched', search, queries: plan.variants, enumerate: plan.enumerate }
      : { ...failed(), enumerate: plan.enumerate };
  } catch {
    options.signal?.throwIfAborted();
    if (signal.aborted) return failed();
    appLogger.warn('Follow-up search unavailable; retaining the base evidence.', {
      source: 'chat.indexed-followup',
    });
    return failed();
  } finally {
    timerHost.clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abort);
  }
}
