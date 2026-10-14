import { describe, expect, it } from 'vitest';
import { createStreamingReasoningSink } from './reasoning';
import type { StreamChunk } from './providers';

describe('추론 스트리밍의 델타 경계', () => {
  it.each(['think', 'thinking', 'reasoning', 'thought'])(
    '%s 태그의 모든 분할 지점에서 공백·본문·추론을 보존한다',
    (tag) => {
      const text = ` 앞 <${tag}>한글 😀 생각</${tag}> 뒤 `;
    const characters = Array.from(text);
    for (let split = 1; split < characters.length; split++) {
        const chunks: StreamChunk[] = [];
        const consume = createStreamingReasoningSink((chunk) => chunks.push(chunk));
      consume({ content: characters.slice(0, split).join(''), done: false });
      consume({ content: characters.slice(split).join(''), done: false });
        consume({ content: '', done: true });
        expect(chunks.map((chunk) => chunk.content).join('')).toBe(' 앞  뒤 ');
        expect(chunks.map((chunk) => chunk.reasoning ?? '').join('')).toBe('한글 😀 생각');
        expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
      }
    },
  );

  it('일반 Markdown·미완성 태그·구조화 추론·도구 델타를 손실 없이 전달한다', () => {
    const chunks: StreamChunk[] = [];
    const consume = createStreamingReasoningSink((chunk) => chunks.push(chunk));
    const call = { index: 0, function: { arguments: '{' } };
    consume({
      content: ' <b>본문</b> <thi',
      reasoning: 'structured ',
      done: false,
      toolCalls: [call],
    });
    consume({ content: '', done: true });
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(' <b>본문</b> <thi');
    expect(chunks[0]?.reasoning).toBe('structured ');
    expect(chunks[0]?.toolCalls).toEqual([call]);
  });
});
