import { describe, expect, it } from 'vitest';
import {
  createToolExecutionPolicy,
  normalizeToolResult,
  shouldAutoExecuteToolCall,
} from './mcp-tools';
import type { ToolCallRecord, ToolExecutionPolicy } from './types';

describe('MCP 도구 자동 승인 안전 경계', () => {
  it.each([
    'create_file',
    'update_issue',
    'insert_row',
    'send_email',
    'publish_post',
    'upload_asset',
    'apply_patch',
  ])('mentioned-auto는 쓰기 또는 외부 행동성 도구 %s를 승인 대기로 둔다', (name) => {
    const policy = createToolExecutionPolicy('mentioned-auto');

    expect(shouldAutoExecuteToolCall(createToolCall(name), policy, ['workspace'])).toBe(false);
  });

  it.each(['get_file', 'list_files', 'search_notes', 'read_document'])(
    'mentioned-auto는 멘션된 서버의 읽기 도구 %s를 자동 승인한다',
    (name) => {
      const policy = createToolExecutionPolicy('mentioned-auto');

      expect(shouldAutoExecuteToolCall(createToolCall(name), policy, ['workspace'])).toBe(true);
    },
  );

  it.each(['list_created_files', 'search_updates', 'read_movement', 'get_writer'])(
    '행동 단어의 일부만 포함한 읽기 도구 %s를 쓰기 도구로 오인하지 않는다',
    (name) => {
      const policy = createToolExecutionPolicy('mentioned-auto');

      expect(shouldAutoExecuteToolCall(createToolCall(name), policy, ['workspace'])).toBe(true);
    },
  );

  it('호출자가 제공한 위험 이름 패턴 override를 그대로 적용한다', () => {
    const policy: ToolExecutionPolicy = {
      mode: 'mentioned-auto',
      manualApproval: false,
      dangerousToolNamePatterns: ['^search_notes$'],
    };

    expect(shouldAutoExecuteToolCall(createToolCall('search_notes'), policy, ['workspace'])).toBe(
      false,
    );
    expect(shouldAutoExecuteToolCall(createToolCall('create_file'), policy, ['workspace'])).toBe(
      true,
    );
  });
});

describe('MCP 도구 결과 전송 상한', () => {
  it('Rust 정상화 결과의 표시/모델 텍스트를 각각 32KiB/64KiB로 절단한다', () => {
    const result = normalizeToolResult({
      content: [{ type: 'text', text: '😀'.repeat(20_000) }],
    });

    expectUtf8Bounded(result.displayText, 32 * 1024);
    expectUtf8Bounded(result.modelText, 64 * 1024);
  });

  it('TS fallback 정상화 결과에도 동일한 표시/모델 텍스트 상한을 적용한다', () => {
    const result = normalizeToolResult({
      content: [{ type: 'text', text: '😀'.repeat(20_000) }],
      nonSerializable: 1n,
    });

    expectUtf8Bounded(result.displayText, 32 * 1024);
    expectUtf8Bounded(result.modelText, 64 * 1024);
  });
});

function createToolCall(name: string): ToolCallRecord {
  return {
    id: `tc-${name}`,
    name,
    arguments: '{}',
    status: 'running',
    serverName: 'workspace',
  };
}

function expectUtf8Bounded(value: string, maxBytes: number): void {
  expect(new TextEncoder().encode(value).byteLength).toBeLessThanOrEqual(maxBytes);
  expect(value).toContain('[Superpower Inside: output truncated]');
  expect(value).not.toContain('\u{fffd}');
}
