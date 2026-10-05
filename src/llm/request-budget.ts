import { t } from '../i18n';
import { boundToolTranscript } from '../chat/tool-execution';
import { planChatRequestRust } from '../rag/rust-core';
import type { ChatMessage, ToolDefinition } from './providers';

/** 토큰 한도를 알 수 없는 provider에도 적용하는 공통 UTF-8 입력 상한입니다. */
export const MAX_PROVIDER_INPUT_BYTES = 256 * 1024;

/** 자료·대화·도구 정의를 함께 계산하고 필수 입력을 몰래 잘라내지 않습니다. */
export function prepareProviderRequest(
  messages: readonly ChatMessage[],
  tools?: readonly ToolDefinition[],
  maxBytes = MAX_PROVIDER_INPUT_BYTES,
): { messages: ChatMessage[]; usedBytes: number } {
  const reservedBytes = new TextEncoder().encode(JSON.stringify({ tools: tools ?? [] })).byteLength;
  const bounded = boundToolTranscript(messages, Math.max(0, maxBytes - reservedBytes));
  const plan = planChatRequestRust({ messages: bounded, reservedBytes, maxBytes });
  if (!plan) throw new Error(t('chatInputBudgetExceeded'));
  return {
    messages: plan.indices.flatMap((index) => (bounded[index] ? [bounded[index]] : [])),
    usedBytes: plan.usedBytes,
  };
}
