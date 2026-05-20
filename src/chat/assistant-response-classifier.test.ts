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
      originalContent: '어떤 방식으로 진행할까요?\n1. 빠른 요약\n2. 자세한 분석',
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

  it('긴 분석 답변 안의 결정 사항과 체크리스트는 질문 카드로 승격하지 않는다', () => {
    const content = [
      '# Monithub 데모·홍보·마케팅·브랜딩 전략 검토',
      '',
      '## 1. 현황 진단',
      '',
      '| 영역 | 현재 상태 |',
      '| --- | --- |',
      '| 고객 정의 | 소규모 운영팀 |',
      '',
      '## 2. 전략 제안',
      '',
      '데모는 단순한 무료 체험이 아니라 Lock-in의 첫 단계여야 합니다.',
      '고객이 어떤 흐름을 선택해야 하는지 명확히 설명할 필요가 있습니다.',
      '',
      '#### 결정 사항',
      '',
      '- 데모는 기간 제한 무료 체험이 아닌 기능 제한 무료 플랜으로 설계',
      '- 데모 사용자가 쌓은 운영 데이터는 유료 전환 시 그대로 유지',
      '- [ ] 데모 온보딩 플로우 설계',
      '',
      '#### 다음 행동',
      '',
      '- 데모 → 유료 전환율',
      '- NPS',
    ].join('\n');

    const result = classifyAssistantResponse({ content, reasoning: '' });

    expect(result).toEqual({ type: 'answer', content, reasoning: '' });
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

  it('질문으로 분류할 때 원본 content를 originalContent로 보존한다', () => {
    const original = '어떤 방식으로 진행할까요?\n1. 빠른 요약\n2. 자세한 분석';
    const result = classifyAssistantResponse({
      content: original,
      reasoning: '생각 중',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.originalContent).toBe(original);
    expect(result.content).toBe('');
    expect(result.reasoning).toBe('생각 중');
  });

  it('reasoning leak 질문일 때도 원본 content를 originalContent로 보존한다', () => {
    const result = classifyAssistantResponse({
      content: '',
      reasoning: '사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\nA) 전체\nB) 변경분만',
    });

    expect(result.type).toBe('question');
    if (result.type !== 'question') throw new Error('질문으로 분류되어야 합니다.');
    expect(result.originalContent).toBe('');
    expect(result.question.source).toBe('reasoning-leak');
  });
