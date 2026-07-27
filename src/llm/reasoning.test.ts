import { describe, expect, it } from 'vitest';
import {
  extractStructuredReasoning,
  splitReasoningTags,
  normalizeReasoningChunk,
} from './reasoning';

describe('reasoning normalization', () => {
  it('구조화 reasoning 필드는 reasoning, reasoning_content, thinking 순서로 추출한다', () => {
    expect(
      extractStructuredReasoning({
        reasoning: 'openrouter 생각',
        reasoning_content: 'deepseek 생각',
        thinking: 'ollama 생각',
      }),
    ).toBe('openrouter 생각');
    expect(extractStructuredReasoning({ reasoning_content: 'deepseek 생각' })).toBe(
      'deepseek 생각',
    );
    expect(extractStructuredReasoning({ thinking: 'ollama 생각' })).toBe('ollama 생각');
  });

  it('문자열이 아닌 reasoning 필드는 건너뛰고 다음 후보를 사용한다', () => {
    expect(
      extractStructuredReasoning({
        reasoning: { text: '객체는 무시' },
        reasoning_content: '문자열 reasoning',
      }),
    ).toBe('문자열 reasoning');
    expect(extractStructuredReasoning({ reasoning: 42, thinking: '' })).toBeUndefined();
  });

  it('content 안의 think 태그를 reasoning과 answer로 분리한다', () => {
    expect(splitReasoningTags('<think>검토 중</think>\n최종 답변')).toEqual({
      reasoning: '검토 중',
      content: '최종 답변',
    });
  });

  it('대소문자와 속성이 섞인 reasoning 태그를 분리한다', () => {
    expect(splitReasoningTags('<THINK data-step="1">계획</THINK>답변')).toEqual({
      reasoning: '계획',
      content: '답변',
    });
  });

  it('일반 텍스트 사이의 reasoning 태그를 제거하고 앞뒤 content를 보존한다', () => {
    expect(splitReasoningTags('앞 문장\n<think>숨길 생각</think>\n뒤 문장')).toEqual({
      reasoning: '숨길 생각',
      content: '앞 문장\n\n뒤 문장',
    });
  });

  it('여러 reasoning 태그를 병합하고 content에서는 모두 제거한다', () => {
    expect(splitReasoningTags('시작<think>첫 생각</think>중간<thought>둘째 생각</thought>끝')).toEqual({
      reasoning: '첫 생각\n\n둘째 생각',
      content: '시작\n\n중간\n\n끝',
    });
  });

  it('깨진 reasoning 태그도 content 오염을 최소화한다', () => {
    expect(splitReasoningTags('계획 중</think>\n답변')).toEqual({
      reasoning: '계획 중',
      content: '답변',
    });
    expect(splitReasoningTags('<thinking>아직 생각 중')).toEqual({
      reasoning: '아직 생각 중',
      content: '',
    });
  });

  it('구조화 reasoning과 fallback 태그 reasoning을 함께 정규화한다', () => {
    expect(normalizeReasoningChunk({ content: '<thought>추가 생각</thought>본문' })).toEqual({
      content: '본문',
      reasoning: '추가 생각',
    });
  });
});

  it('content가 완전히 비어 있어도 normalizeReasoningChunk는 폴백하지 않는다', () => {
    expect(
      normalizeReasoningChunk({ content: '<think>전부 생각</think>', reasoning: '' }),
    ).toEqual({
      content: '',
      reasoning: '전부 생각',
    });
  });

  it('content에 내용이 있으면 그대로 분리한다', () => {
    expect(
      normalizeReasoningChunk({ content: '<think>생각</think>답변', reasoning: '' }),
    ).toEqual({
      content: '답변',
      reasoning: '생각',
    });
  });

  it('구조화 reasoning과 태그 reasoning이 모두 있을 때 content는 비어 있고 reasoning은 병합된다', () => {
    expect(
      normalizeReasoningChunk({
        content: '<thinking>오직 생각</thinking>',
        reasoning: '추가 생각',
      }),
    ).toEqual({
      content: '',
      reasoning: '추가 생각\n\n오직 생각',
    });
  });
