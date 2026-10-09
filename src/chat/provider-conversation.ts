import type { ChatMessage } from '../llm/providers';
import {
  appendAssistantToolRound,
  selectProviderReinjectableToolCalls,
  type ToolTranscriptProtocol,
} from './tool-execution';
import type { ChatMessageWithMeta } from './types';

/**
 * 저장된 UI 메시지를 provider가 다시 받을 수 있는 완전한 대화 이력으로 변환합니다.
 * 완료된 호출만 요청/결과 쌍으로 복원하고, 짝을 보장할 수 없는 legacy tool 메시지는 제외합니다.
 */
export function buildProviderConversation(
  messages: readonly ChatMessageWithMeta[],
  protocol: ToolTranscriptProtocol,
): ChatMessage[] {
  let conversation: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'tool') continue;

    const content = getProviderMessageContent(message);
    if (message.role !== 'assistant') {
      conversation.push({
        role: message.role,
        content,
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      });
      continue;
    }

    const completedToolCalls = selectProviderReinjectableToolCalls(message.toolCalls ?? []);
    if (completedToolCalls.length === 0) {
      if (content || message.reasoning) {
        conversation.push({
          role: 'assistant',
          content,
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
        });
      }
      continue;
    }

    conversation = appendAssistantToolRound(conversation, '', completedToolCalls, protocol);
    if (content || message.reasoning) {
      conversation.push({
        role: 'assistant',
        content,
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      });
    }
  }

  return conversation;
}

function getProviderMessageContent(message: ChatMessageWithMeta): string {
  if (message.content) return message.content;
  if (!message.assistantQuestion) return '';
  return [
    message.assistantQuestion.prompt,
    ...message.assistantQuestion.choices.map((choice) => `- ${choice.label}`),
  ].join('\n');
}
