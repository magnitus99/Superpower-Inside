import { planResearchCandidateSelectionRust, planVaultQueryExpansionRust } from '../rag/rust-core';
import type { LLMProvider } from '../llm/providers';
import { t } from '../i18n';
import { appLogger } from '../utils/logger';

const MAX_EXPANDED_QUERY_CHARS = 500;

/** 선택된 채팅 모델로 검색 개념만 번역하며 볼트 본문은 전송하지 않습니다. */
export async function expandVaultSearchQuery(
  question: string,
  provider: LLMProvider | undefined,
  previousUserQuestions: readonly string[] = [],
  signal?: AbortSignal,
): Promise<string> {
  const fallback = expandVaultSearchQueryLocally(question, previousUserQuestions);
  if (!provider || !planVaultQueryExpansionRust(question)?.needsTranslation) return fallback;
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
    return planVaultQueryExpansionRust(question, response)?.query ?? fallback;
  } catch (error) {
    if (signal?.aborted) throw error;
    appLogger.warn('Search query expansion unavailable; using local terms.', {
      source: 'chat.query-expansion',
      error,
    });
    return fallback;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
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
