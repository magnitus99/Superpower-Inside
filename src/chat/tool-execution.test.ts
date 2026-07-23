import { describe, expect, it, vi } from 'vitest';
import type { NativeVaultToolRuntimeLike } from '../agent/native-vault-tool';
import {
  appendAssistantToolRound,
  collectToolCitations,
  executeAssistantToolCalls,
  markRepeatedToolCalls,
  prepareAssistantToolCalls,
} from './tool-execution';
import type { ToolCallRecord } from './types';

describe('LLM 도구 실행 라우터', () => {
  it('네이티브 Vault 도구는 MCP 서버 없이 자동 승인한다', async () => {
    const { runtime: nativeTool } = createNativeTool();

    const prepared = await prepareAssistantToolCalls({
      toolCalls: [createToolCall()],
      nativeTool,
      registry: null,
      preferredServerNames: [],
      mcpMode: 'always-manual',
    });

    expect(prepared[0]).toMatchObject({
      approved: true,
      executionKind: 'native',
      serverName: 'Superpower Inside',
    });
  });

  it('네이티브 결과와 출처를 ToolCallRecord에 함께 보존한다', async () => {
    const { runtime: nativeTool, execute } = createNativeTool();

    const executed = await executeAssistantToolCalls({
      toolCalls: [createToolCall({ approved: true, executionKind: 'native' })],
      nativeTool,
      registry: null,
      preferredServerNames: [],
    });

    expect(execute).toHaveBeenCalledWith('{"action":"stats"}');
    expect(executed[0]).toMatchObject({
      status: 'success',
      result: '볼트 문서 12개',
      normalizedResult: '{"action":"stats","fileCount":12}',
      citations: [expect.objectContaining({ filePath: 'Index.md' })],
    });
  });

  it('초기 컨텍스트와 반복 도구 호출의 출처를 id 기준으로 합친다', () => {
    const citation = createNativeToolCitation();

    expect(
      collectToolCitations([citation], [
        createToolCall({ citations: [citation, { ...citation, id: 'vault:Beta.md:1-1', filePath: 'Beta.md' }] }),
      ]),
    ).toEqual([
      citation,
      expect.objectContaining({ id: 'vault:Beta.md:1-1', filePath: 'Beta.md' }),
    ]);
  });

  it('반복 도구 호출마다 이전 assistant 요청과 tool 결과를 대화 이력에 누적한다', () => {
    const base = [{ role: 'user' as const, content: '볼트에서 근거를 찾아줘.' }];
    const firstRound = appendAssistantToolRound(base, '', [
      createToolCall({
        id: 'search-1',
        arguments: '{"action":"search","query":"Alpha"}',
        status: 'success',
        normalizedResult: '{"action":"search","hits":[{"path":"Alpha.md"}]}',
      }),
    ]);
    const secondRound = appendAssistantToolRound(firstRound, '', [
      createToolCall({
        id: 'read-1',
        arguments: '{"action":"read","path":"Alpha.md"}',
        status: 'success',
        normalizedResult: '{"action":"read","content":"evidence"}',
      }),
    ]);

    expect(secondRound.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(secondRound[2]?.tool_call_id).toBe('search-1');
    expect(secondRound[2]?.content).toContain('Alpha.md');
    expect(secondRound[4]?.tool_call_id).toBe('read-1');
    expect(secondRound[4]?.content).toContain('evidence');
  });

  it('실패한 도구 결과도 모델 대화 이력에 오류로 전달한다', () => {
    const messages = appendAssistantToolRound(
      [{ role: 'user', content: '찾아줘' }],
      '검색을 시도했습니다.',
      [
        createToolCall({
          id: 'failed-search',
          status: 'error',
          result: '검색 인덱스를 읽을 수 없습니다.',
        }),
      ],
    );

    expect(messages[1]).toMatchObject({ role: 'assistant', content: '검색을 시도했습니다.' });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      content: '검색 인덱스를 읽을 수 없습니다.',
      tool_call_id: 'failed-search',
      tool_result_is_error: true,
    });
  });

  it('이미 완료된 도구는 승인 후 다시 실행하지 않는다', async () => {
    const { runtime: nativeTool, execute } = createNativeTool();
    const calls = [
      createToolCall({ id: 'done', status: 'success', approved: true, result: '기존 결과' }),
      createToolCall({ id: 'pending', status: 'running', approved: true }),
    ];

    const executed = await executeAssistantToolCalls({
      toolCalls: calls,
      nativeTool,
      registry: null,
      preferredServerNames: [],
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(executed[0]).toMatchObject({ id: 'done', result: '기존 결과' });
    expect(executed[1]).toMatchObject({ id: 'pending', status: 'success' });
  });

  it('JSON 키 순서가 달라도 세 번째 동일 호출을 차단한다', () => {
    const history = [
      createToolCall({
        id: 'first',
        arguments: '{"action":"search","query":"alpha"}',
        status: 'success',
      }),
      createToolCall({
        id: 'second',
        arguments: '{"query":"alpha","action":"search"}',
        status: 'success',
      }),
    ];
    const candidates = [
      createToolCall({ id: 'third', arguments: '{"action":"search","query":"alpha"}' }),
      createToolCall({ id: 'read', arguments: '{"action":"read","path":"Alpha.md"}' }),
    ];

    const planned = markRepeatedToolCalls(history, candidates);

    expect(planned).toEqual([
      expect.objectContaining({ id: 'third', status: 'error' }),
      expect.objectContaining({ id: 'read', status: 'running' }),
    ]);
    expect(typeof planned[0]?.result).toBe('string');
  });
});

function createNativeTool(): {
  runtime: NativeVaultToolRuntimeLike;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(() =>
    Promise.resolve({
      displayText: '볼트 문서 12개',
      modelText: '{"action":"stats","fileCount":12}',
      citations: [createNativeToolCitation()],
    }),
  );
  return {
    runtime: {
      isNativeTool: (name) => name === 'superpower_inside',
      execute,
    },
    execute,
  };
}

function createNativeToolCitation() {
  return {
    id: 'vault:Index.md:1-1',
    filePath: 'Index.md',
    line: 1,
    endLine: 1,
    preview: 'Index',
    status: 'verified' as const,
  };
}

function createToolCall(patch: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'native-1',
    name: 'superpower_inside',
    arguments: '{"action":"stats"}',
    status: 'running',
    ...patch,
  };
}
