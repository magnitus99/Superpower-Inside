import { planResearchCandidateSelectionRust, planVaultQueryExpansionRust } from '../rag/rust-core';
import type { LLMProvider } from '../llm/providers';
import { t } from '../i18n';
import { appLogger } from '../utils/logger';

const MAX_EXPANDED_QUERY_CHARS = 500;

/** 선택된 채팅 모델로 검색 개념만 번역하며 볼트 본문은 전송하지 않습니다. */
export async function expandVaultSearchPlan(
  question: string,
  provider: LLMProvider | undefined,
  previousUserQuestions: readonly string[] = [],
  signal?: AbortSignal,
): Promise<{ query: string; variants: string[] }> {
  const fallback = expandVaultSearchQueryLocally(question, previousUserQuestions);
  if (!provider || !planVaultQueryExpansionRust(question)?.needsTranslation)
    return { query: question, variants: fallback === question ? [] : [fallback] };
  if (signal?.aborted) throw new DOMException('Search expansion cancelled.', 'AbortError');
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timeout: number | undefined;
  try {
    const response = await Promise.race([
      provider.chat(
        [
          { role: 'system', content: t('vaultQueryExpansionPrompt') },
          { role: 'user', content: JSON.stringify({ question }) },
        ],
        undefined,
        undefined,
        { signal: controller.signal },
      ),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort();
          reject(new Error('Search expansion timed out.'));
        }, 12_000);
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Search expansion cancelled.', 'AbortError')),
          { once: true },
        );
      }),
    ]);
    const plan = planVaultQueryExpansionRust(question, response);
    return plan
      ? { query: plan.query, variants: plan.variants }
      : { query: question, variants: [] };
  } catch (error) {
    if (signal?.aborted) throw error;
    appLogger.warn('Search query expansion unavailable; using local terms.', {
      source: 'chat.query-expansion',
      error,
    });
    return { query: question, variants: fallback === question ? [] : [fallback] };
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** 레거시 문자열 호출부도 구절 경계를 잃지 않도록 JSON 배열로 전달한다. */
export async function expandVaultSearchQuery(
  question: string,
  provider: LLMProvider | undefined,
  previousUserQuestions: readonly string[] = [],
  signal?: AbortSignal,
): Promise<string> {
  const plan = await expandVaultSearchPlan(question, provider, previousUserQuestions, signal);
  return plan.variants.length ? JSON.stringify([plan.query, ...plan.variants]) : plan.query;
}

export function expandVaultSearchQueryLocally(
  question: string,
  previousUserQuestions: readonly string[] = [],
): string {
  const plan = planResearchCandidateSelectionRust({
    currentQuestion: question,
    previousUserQuestions,
    paths: [],
    samples: [],
  });
  if (!plan) return question;

  const normalizedQuestion = question.toLocaleLowerCase();
  const additionalTerms = plan.terms.filter(
    (term) => !normalizedQuestion.includes(term.toLocaleLowerCase()),
  );
  return [question, ...additionalTerms]
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_EXPANDED_QUERY_CHARS);
}
