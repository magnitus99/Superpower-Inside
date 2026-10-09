import type { LLMProvider } from '../llm/providers';
import { planSessionTitleRust } from '../rag/rust-core';
import { t } from '../i18n';
import type { ChatMessageWithMeta, SessionState } from './types';

export async function summarizeSessionTitle(
  session: SessionState,
  messages: readonly ChatMessageWithMeta[],
  provider: Pick<LLMProvider, 'chat'>,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (signal.aborted || !isCurrent()) return false;
  const plan = planSessionTitleRust(messages);
  if (!plan) return false;
  const previousTitle = session.title;
  const generated = await provider.chat(
    [
      { role: 'system', content: t('chatSessionTitleInstruction') },
      { role: 'user', content: JSON.stringify(plan.conversation) },
    ],
    undefined,
    undefined,
    { signal },
  );
  if (signal.aborted || !isCurrent() || session.title !== previousTitle) return false;
  const title = planSessionTitleRust(messages, generated)?.title;
  if (!title) return false;
  session.title = title;
  session.isDirty = true;
  return true;
}
