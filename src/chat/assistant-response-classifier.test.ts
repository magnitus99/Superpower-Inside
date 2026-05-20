import { describe, expect, it } from 'vitest';
import { classifyAssistantResponse } from './assistant-response-classifier';

describe('classifyAssistantResponse', () => {
  it('선택지가 있는 단일 선택 질문을 감지한다', () => {
    expect(
      classifyAssistantResponse({
        content: '어떤 방식으로 진행할까요?\n1. 빠른 요약\n2. 자세한 분석',
        reasoning: '',
      }),
    ).toEqual({
      type: 'question',
      content: '',
      reasoning: '',
      question: {
        prompt: '어떤 방식으로 진행할까요?',
        choices: [
          { id: 'choice-1', label: '빠른 요약' },
          { id: 'choice-2', label: '자세한 분석' },
        ],
        selectionMode: 'single',
        allowFreeText: true,
        source: 'answer',
      },
    });
  });

  it('다중 선택 질문을 감지한다', () => {
    const result = classifyAssistantResponse({
      content: '해당되는 항목을 모두 선택해 주세요.\n- 성능\n- 보안\n- UI',
      reasoning: '',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question.selectionMode).toBe('multiple');
    expect(result.question.choices.map((choice) => choice.label)).toEqual(['성능', '보안', 'UI']);
  });

  it('여러 선택지 표기 방식을 모두 감지한다', () => {
    const result = classifyAssistantResponse({
      content: ['선택해 주세요.', '1. 숫자 점', '2) 숫자 괄호', 'A. 알파벳 점', 'B) 알파벳 괄호', '* 별표', '• 불릿'].join(
        '\n',
      ),
      reasoning: '',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question.choices.map((choice) => choice.label)).toEqual([
      '숫자 점',
      '숫자 괄호',
      '알파벳 점',
      '알파벳 괄호',
      '별표',
      '불릿',
    ]);
  });

  it('영어 다중 선택 표현을 multiple로 감지한다', () => {
    const result = classifyAssistantResponse({
      content: 'Select all that apply.\nA) Performance\nB) Security\nC) UX',
      reasoning: '',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question.selectionMode).toBe('multiple');
  });

  it('선택지 없는 자유입력 질문을 감지한다', () => {
    const result = classifyAssistantResponse({
      content: '어떤 문서를 기준으로 정리할까요?',
      reasoning: '',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question).toEqual({
      prompt: '어떤 문서를 기준으로 정리할까요?',
      choices: [],
      selectionMode: 'single',
      allowFreeText: true,
      source: 'answer',
    });
  });

  it('일반 답변 끝의 후속 제안 질문은 일반 답변으로 유지한다', () => {
    expect(
      classifyAssistantResponse({
        content: '요약하면 설정 문제입니다. 원하면 더 자세히 설명해드릴까요?',
        reasoning: '',
      }).type,
    ).toBe('answer');
  });

  it('질문 신호가 없는 일반 bullet list는 답변으로 유지한다', () => {
    expect(
      classifyAssistantResponse({
        content: '변경 내용입니다.\n- 성능 개선\n- 보안 점검',
        reasoning: '',
      }).type,
    ).toBe('answer');
  });

  it('선택지가 있는 명시 질문은 후속 제안 문구보다 질문 카드 승격을 우선한다', () => {
    const result = classifyAssistantResponse({
      content: '필요하면 다음 중 하나를 선택해 주세요.\n1. 요약만\n2. 테스트까지',
      reasoning: '',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question.choices.map((choice) => choice.label)).toEqual(['요약만', '테스트까지']);
  });

  it('reasoning에만 있는 질문은 reasoning leak 질문으로 승격한다', () => {
    const result = classifyAssistantResponse({
      content: '',
      reasoning: '사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\nA) 전체\nB) 변경분만',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question).toEqual({
      prompt: '어떤 범위를 분석할까요?',
      choices: [
        { id: 'choice-1', label: '전체' },
        { id: 'choice-2', label: '변경분만' },
      ],
      selectionMode: 'single',
      allowFreeText: true,
      source: 'reasoning-leak',
    });
  });

  it('reasoning leak 질문의 선택지를 보존한다', () => {
    const result = classifyAssistantResponse({
      content: '',
      reasoning: '질문이 필요하다.\nSelect all that apply.\n- Docs\n- Tests',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.question).toMatchObject({
      source: 'reasoning-leak',
      selectionMode: 'multiple',
      choices: [
        { id: 'choice-1', label: 'Docs' },
        { id: 'choice-2', label: 'Tests' },
      ],
    });
  });
});
