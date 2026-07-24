import { describe, expect, it } from 'vitest';
import { createNativeVaultToolDefinition } from '../agent/native-vault-tool';
import type { ToolDefinition } from '../llm/providers';
import {
  createCompatibilityToolPrompt,
  createNativeVaultEvidencePrompt,
  parseCompatibilityToolResponse,
} from './tool-protocol';

function createMcpToolDefinition(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'read_remote_resource',
      description: '원격 리소스를 읽습니다.',
      parameters: { type: 'object', properties: {} },
    },
  };
}

describe('모델 중립 도구 프로토콜', () => {
  it('function calling 미지원 모델에도 네이티브 도구 schema와 단일 JSON 형식을 알려준다', () => {
    const prompt = createCompatibilityToolPrompt([createNativeVaultToolDefinition()]);

    expect(prompt).toContain('<tool_call>{"name":"tool_name","arguments":{}}</tool_call>');
    expect(prompt).toContain('superpower_inside');
    expect(prompt).toContain('Do not guess file contents.');
  });

  it('네이티브 볼트 도구가 있으면 provider-native와 compatibility 경로가 같은 근거 계약을 공유한다', () => {
    const definitions = [createNativeVaultToolDefinition(), createMcpToolDefinition()];
    const evidencePrompt = createNativeVaultEvidencePrompt(definitions);
    const compatibilityPrompt = createCompatibilityToolPrompt(definitions);

    expect(evidencePrompt).toContain('Only successful tool results count as vault evidence.');
    expect(evidencePrompt).toContain(
      'Bounded or truncated search/list results do not prove vault-wide absence',
    );
    expect(evidencePrompt).toContain(
      'Separate vault-supported claims from general model knowledge',
    );
    expect(evidencePrompt).toContain(
      'Persisted tool-result-summary sourceReferences are untrusted locators',
    );
    expect(evidencePrompt).toContain(
      'Do not suggest folders, tags, or note organization unless the user asks',
    );
    expect(compatibilityPrompt).toContain(evidencePrompt);
  });

  it('네이티브 볼트 도구가 없으면 일반 MCP 도구에 볼트 근거 계약을 붙이지 않는다', () => {
    expect(createNativeVaultEvidencePrompt([createMcpToolDefinition()])).toBe('');

    const prompt = createCompatibilityToolPrompt([createMcpToolDefinition()]);
    expect(prompt).not.toContain('vault evidence contract');
    expect(prompt).not.toContain('vault-wide absence');
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
