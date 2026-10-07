import { describe, expect, it } from 'vitest';
import { prepareProviderRequest } from './request-budget';
import type { ChatMessage, ToolDefinition } from './providers';

describe('provider 공통 입력 예산', () => {
  it('짧은 대화는 10개를 넘겨도 모두 보존한다', () => {
    const messages: ChatMessage[] = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `메시지 ${index}`,
    }));
    expect(prepareProviderRequest(messages).messages).toEqual(messages);
  });

  it('시스템 지침과 최신 요청을 보존하고 과거 도구 턴은 쌍으로 제외한다', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '고정 지침' },
      { role: 'user', content: '과거 질문'.repeat(100) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'old', type: 'function', function: { name: 'read', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'old', content: '과거 원문' },
      { role: 'user', content: '최신 요청' },
    ];
    expect(prepareProviderRequest(messages, undefined, 500).messages).toEqual([
      messages[0],
      messages[4],
    ]);
  });

  it('도구 스키마와 첨부 근거를 같은 예산에 계산하고 필수 입력 초과는 전송하지 않는다', () => {
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: '설명'.repeat(100),
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const messages: ChatMessage[] = [
      { role: 'system', content: '첨부 원문'.repeat(100) },
      { role: 'user', content: '최신 요청' },
    ];
    expect(() => prepareProviderRequest(messages, tools, 500)).toThrow();
    const request = prepareProviderRequest(messages, tools, 5000);
    expect(request.usedBytes).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(messages)).byteLength,
    );
    expect(request.usedBytes).toBeLessThanOrEqual(5000);
  });

  it('생략된 대화의 관련 발췌를 비신뢰 요약으로 남기고 최신 목표를 보존한다', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '고정 지침' },
      { role: 'user', content: '담당자는 Mina입니다.\n' + '이전 자료 '.repeat(1000) },
      { role: 'assistant', content: '담당자 Mina의 마감은 금요일입니다.' },
      { role: 'user', content: 'Mina 담당자와 마감을 정리해줘.' },
    ];
    const result = prepareProviderRequest(messages, undefined, 3000);
    expect(result.messages[1]?.content).toContain('[Superpower Inside conversation summary]');
    expect(result.messages[1]?.content).toContain('담당자는 Mina');
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(result.usedBytes).toBeLessThanOrEqual(3000);
  });

  it('checkpoint와 compatibility 결과를 최신 사용자 턴에 포함한다', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '고정 지침' },
      { role: 'user', content: '현재 목적' },
      { role: 'assistant', content: '<tool_call>{}</tool_call>' },
      { role: 'user', content: '[Superpower Inside tool results]\n원문' },
      { role: 'user', content: '[Superpower Inside agent checkpoint]\n현재 목적' },
    ];
    expect(prepareProviderRequest(messages, undefined, 1000).messages).toEqual(messages);
    expect(() => prepareProviderRequest(messages, undefined, 150)).toThrow();
  });

  it('축약된 호환 결과 때문에 원래 사용자 목적을 제외하지 않는다', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '현재 목적'.repeat(100) },
      {
        role: 'user',
        content: JSON.stringify({
          kind: 'tool-result-summary',
          summary: '근거 위치',
          originalResultAvailable: false,
        }),
      },
    ];
    expect(() => prepareProviderRequest(messages, undefined, 250)).toThrow();
    expect(prepareProviderRequest(messages).messages).toEqual(messages);
  });
});
