import { describe, expect, it } from 'vitest';
import type { AssistantQuestion } from './types';
import { formatAssistantQuestionAnswer } from './assistant-question';

describe('formatAssistantQuestionAnswer', () => {
  const question: AssistantQuestion = {
    prompt: '어떤 범위를 진행할까요?',
    choices: [
      { id: 'choice-1', label: '전체' },
      { id: 'choice-2', label: '변경분만' },
    ],
    selectionMode: 'single',
    allowFreeText: true,
    source: 'answer',
  };

  it('단일 선택 답변을 Markdown 메시지로 포맷한다', () => {
    expect(formatAssistantQuestionAnswer(question, ['전체'], '')).toBe(
      ['질문: 어떤 범위를 진행할까요?', '선택한 항목:', '- 전체'].join('\n'),
    );
  });

  it('다중 선택 답변을 Markdown 목록으로 포맷한다', () => {
    expect(formatAssistantQuestionAnswer(question, ['전체', '변경분만'], '')).toBe(
      ['질문: 어떤 범위를 진행할까요?', '선택한 항목:', '- 전체', '- 변경분만'].join('\n'),
    );
  });

  it('자유입력 답변을 함께 포맷한다', () => {
    expect(formatAssistantQuestionAnswer(question, ['전체'], '테스트도 포함해 주세요.')).toBe(
      [
        '질문: 어떤 범위를 진행할까요?',
        '선택한 항목:',
        '- 전체',
        '추가 입력:',
        '테스트도 포함해 주세요.',
      ].join('\n'),
    );
  });

  it('선택과 입력이 모두 비어 있으면 메시지를 만들지 않는다', () => {
    expect(formatAssistantQuestionAnswer(question, [], '   ')).toBeNull();
  });
});
