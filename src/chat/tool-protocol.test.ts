import { describe, expect, it } from 'vitest';
import { createNativeVaultToolDefinition } from '../agent/native-vault-tool';
import { createCompatibilityToolPrompt, parseCompatibilityToolResponse } from './tool-protocol';

describe('모델 중립 도구 프로토콜', () => {
  it('function calling 미지원 모델에도 네이티브 도구 schema와 단일 JSON 형식을 알려준다', () => {
    const prompt = createCompatibilityToolPrompt([createNativeVaultToolDefinition()]);

    expect(prompt).toContain('<tool_call>{"name":"tool_name","arguments":{}}</tool_call>');
    expect(prompt).toContain('superpower_inside');
    expect(prompt).toContain('Do not guess file contents.');
  });

  it('Rust가 검증한 tool_call을 숨기고 실행 record로 변환한다', () => {
    const result = parseCompatibilityToolResponse(
      '조사 중\n<tool_call>{"name":"superpower_inside","arguments":{"action":"search","query":"고객 문제"}}</tool_call>',
      (index) => `compat-${index}`,
    );

    expect(result.visibleContent).toBe('조사 중');
    expect(result.toolCalls).toEqual([
      {
        id: 'compat-0',
        name: 'superpower_inside',
        arguments: '{"action":"search","query":"고객 문제"}',
        status: 'running',
      },
    ]);
  });
});
