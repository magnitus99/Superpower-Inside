import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
vi.mock('../utils/desktop-stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/desktop-stream')>();
  const { providerStreamFixture } = await import('../test/provider-stream-fixture');
  return { ...actual, desktopFetch: providerStreamFixture };
});

import { requestUrl } from 'obsidian';
import { connectTestChatGPT, completedChatGPTResponse } from '../test/chatgpt';
import {
  createProviderForStrategy,
  type ChatMessage,
  type StreamChunk,
  type ToolDefinition,
} from '../llm/providers';
import type { ProviderStrategyKey } from '../settings';
import { planNativeToolCompatibilityFallbackRust } from '../rag/rust-core';
import { createToolEvidencePrompt, parseCompatibilityToolTurn } from './tool-protocol';
import { appendAssistantToolRound } from './tool-execution';
import { executeMcpToolCalls, prepareToolCallsForExecution } from './mcp-tool-execution';
import { createToolExecutionPolicy, shouldAutoExecuteToolCall } from './mcp-tools';
import type { ToolCallRecord } from './types';

// 각 계약은 10점입니다. 합성 provider 응답으로 호스트 계약을 평가하며 모델 품질 점수가 아닙니다.
const strategies: ProviderStrategyKey[] = [
  'openai',
  'openAIChatGPT',
  'opencode',
  'gemini',
  'claude',
  'ollama',
  'ollamaCloud',
  'openRouter',
  'openAICompatible',
];
const tool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_plan',
    description: 'Read the current release plan.',
    parameters: { type: 'object', properties: { project: { type: 'string' } } },
  },
};
const requestMock = vi.mocked(requestUrl);
const fact = '2031-04-17';

beforeEach(() => {
  requestMock.mockReset();
  connectTestChatGPT();
});

function provider(strategy: ProviderStrategyKey) {
  return createProviderForStrategy(strategy, {
    id: 'profile',
    name: 'Test',
    enabled: true,
    apiKey: 'test-only',
    models: ['selected-model'],
    baseUrl: 'http://localhost:1234/v1',
    capabilityOverrides: { toolCalling: true },
  });
}

function respond(text: string, status = 200, json: unknown = {}) {
  requestMock.mockResolvedValueOnce({
    status,
    text,
    json,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
  });
}

function responseText(strategy: ProviderStrategyKey, text: string) {
  if (strategy === 'openAIChatGPT' || strategy === 'opencode') {
    respond(
      completedChatGPTResponse([{ type: 'message', content: [{ type: 'output_text', text }] }]),
    );
  } else if (strategy === 'gemini') {
    respond(
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      })}\n\n`,
    );
  } else if (strategy === 'claude') {
    respond(
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n\ndata: {"type":"message_stop"}\n\n`,
    );
  } else if (strategy === 'ollama' || strategy === 'ollamaCloud') {
    const json = { message: { content: text }, done: true };
    respond(JSON.stringify(json), 200, json);
  } else {
    respond(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n\ndata: [DONE]\n\n`,
    );
  }
}

function responseCall(strategy: ProviderStrategyKey) {
  if (strategy === 'openAIChatGPT' || strategy === 'opencode') {
    respond(
      completedChatGPTResponse([
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'read_plan',
          arguments: '{"project":"alpha"}',
        },
      ]),
    );
  } else if (strategy === 'gemini') {
    respond(
      `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'read_plan', args: { project: 'alpha' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      })}\n\n`,
    );
  } else if (strategy === 'claude') {
    respond(
      [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"read_plan"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"project\\":\\"alpha\\"}"}}',
        'data: {"type":"message_stop"}',
      ].join('\n\n') + '\n\n',
    );
  } else if (strategy === 'ollama' || strategy === 'ollamaCloud') {
    const json = {
      message: {
        tool_calls: [{ function: { name: 'read_plan', arguments: { project: 'alpha' } } }],
      },
      done: true,
    };
    respond(JSON.stringify(json), 200, json);
  } else {
    respond(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_plan","arguments":"{\\"project\\":\\"alpha\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
    );
  }
}

function call(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'call-1',
    name: 'read_plan',
    arguments: '{"project":"alpha"}',
    status: 'success',
    normalizedResult: `Release: ${fact}`,
    serverName: 'plans',
    actualToolName: 'read_plan',
    ...overrides,
  };
}

function registry(
  callTool = vi.fn(() =>
    Promise.resolve({
      content: [{ type: 'text', text: 'Plan loaded.' }],
      structuredContent: { releaseDate: fact },
    }),
  ),
) {
  return {
    getConnectionStatus: () => 'connected' as const,
    getEnabledServers: () => [{ name: 'plans' }],
    getClient: () => ({ listTools: () => Promise.resolve([{ name: 'read_plan' }]), callTool }),
  };
}

async function stream(
  strategy: ProviderStrategyKey,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
) {
  const chunks: StreamChunk[] = [];
  await provider(strategy).streamChat(messages, (chunk) => chunks.push(chunk), 0.7, tools);
  return chunks;
}

function lastBody(): string {
  const request = requestMock.mock.calls.at(-1)?.[0];
  if (!request || typeof request === 'string' || typeof request.body !== 'string')
    throw new Error('요청 본문 없음');
  return request.body;
}

describe.each(strategies)('도구 계약 점수: %s', (strategy) => {
  it('01 네이티브 호출의 이름과 인자를 손실 없이 받는다', async () => {
    responseCall(strategy);
    const chunks = await stream(strategy, [{ role: 'user', content: 'Read alpha.' }], [tool]);
    const deltas = chunks.flatMap((chunk) => chunk.toolCalls ?? []);
    expect(deltas.find((delta) => delta.function?.name)?.function?.name).toBe('read_plan');
    expect(deltas.map((delta) => delta.function?.arguments ?? '').join('')).toBe(
      '{"project":"alpha"}',
    );
    expect(lastBody()).toContain('read_plan');
  });

  it('02 호환 호출은 네이티브 필드 없이 실행 가능한 요청으로 돌아온다', async () => {
    responseText(
      strategy,
      '<tool_call>{"name":"read_plan","arguments":{"project":"alpha"}}</tool_call>',
    );
    const chunks = await stream(strategy, [{ role: 'user', content: 'Read alpha.' }]);
    const parsed = parseCompatibilityToolTurn(
      chunks.map((chunk) => chunk.content).join(''),
      '',
      (_, index) => `compat-${index}`,
    );
    expect(parsed.toolCalls[0]).toMatchObject({
      name: 'read_plan',
      arguments: '{"project":"alpha"}',
    });
    const body = JSON.parse(lastBody()) as Record<string, unknown>;
    expect(body.tools ?? []).toHaveLength(0);
  });

  it('03 MCP 텍스트와 구조화된 사실을 모두 후속 답변 요청으로 전달한다', async () => {
    const executed = await executeMcpToolCalls({
      registry: registry(),
      toolCalls: [call({ status: 'running', approved: true })],
      preferredServerNames: ['plans'],
    });
    const messages = appendAssistantToolRound(
      [{ role: 'user', content: 'When is the release?' }],
      '',
      executed,
    );
    responseText(strategy, `Release: ${fact}`);
    const chunks = await stream(strategy, messages, [tool]);
    expect(lastBody()).toContain('Plan loaded.');
    expect(lastBody()).toContain(fact);
    expect(chunks.map((chunk) => chunk.content).join('')).toContain(fact);
  });

  it('04 후속 호환 전환은 이전 네이티브 이력까지 변환하고 근거를 보존한다', async () => {
    const native = appendAssistantToolRound([{ role: 'user', content: 'Compare plans.' }], '', [
      call(),
    ]);
    const fallback = appendAssistantToolRound(
      native,
      '',
      [call({ id: 'call-2', normalizedResult: 'Second plan verified.' })],
      'compatibility',
    );
    responseText(strategy, 'Compared both plans.');
    await stream(strategy, fallback);
    expect(fallback.every((message) => message.role !== 'tool' && !message.toolCalls)).toBe(true);
    expect(lastBody()).toContain(fact);
    expect(lastBody()).toContain('Second plan verified.');
  });

  it('05 도구 실패는 성공한 근거로 바뀌지 않고 재주입된다', async () => {
    const messages = appendAssistantToolRound([], '', [
      call({ status: 'error', normalizedResult: 'Read denied.' }),
    ]);
    expect(messages.at(-1)).toMatchObject({ tool_result_is_error: true, content: 'Read denied.' });
    responseText(strategy, 'Could not verify.');
    await stream(strategy, messages, [tool]);
    expect(lastBody()).toContain('Read denied.');
    if (strategy === 'claude') expect(lastBody()).toContain('"is_error":true');
  });

  it('06 취소한 요청은 provider나 도구를 호출하지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider(strategy).streamChat([], () => {}, 0.7, [tool], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestMock).not.toHaveBeenCalled();
    const callTool = vi.fn();
    await expect(
      executeMcpToolCalls({
        registry: registry(callTool),
        toolCalls: [call({ status: 'running' })],
        preferredServerNames: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('07 노출하지 않은 도구는 임의로 실행하지 않는다', async () => {
    const callTool = vi.fn();
    const prepared = await prepareToolCallsForExecution(
      [call({ status: 'running' })],
      registry(callTool),
      ['plans'],
      'always-auto',
      new Map(),
    );
    await executeMcpToolCalls({
      registry: registry(callTool),
      toolCalls: prepared,
      preferredServerNames: ['plans'],
    });
    expect(prepared[0]?.status).toBe('error');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('08 변경·외부 행동 도구는 자동 승인하지 않는다', () => {
    expect(
      shouldAutoExecuteToolCall(
        call({ name: 'send_email' }),
        createToolExecutionPolicy('always-auto'),
        ['plans'],
      ),
    ).toBe(false);
    expect(
      shouldAutoExecuteToolCall(call(), createToolExecutionPolicy('mentioned-auto'), ['plans']),
    ).toBe(true);
  });

  it('09 MCP 전용 catalog에도 도구 근거와 최종 답변 계약을 제공한다', () => {
    const prompt = createToolEvidencePrompt([tool]);
    expect(prompt).toMatch(/비신뢰|untrusted/i);
    expect(prompt).toMatch(/최신.*요청|latest.*objective/i);
    expect(prompt).toMatch(/성공.*결과|successful.*results/i);
    expect(prompt).not.toContain('vault-wide absence');
  });

  it('10 provider 오류를 정상 완료로 삼키지 않고 복구 계층에 전달한다', async () => {
    if (strategy === 'openAIChatGPT' || strategy === 'opencode') {
      respond(
        'data: {"type":"response.failed","response":{"status":"failed","error":{"message":"failed"}}}\n\n',
      );
    } else if (strategy === 'gemini') {
      respond('data: {"error":{"message":"failed"}}\n\n');
    } else if (strategy === 'claude') {
      respond(
        'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      );
    } else if (strategy === 'ollama') {
      respond('{"error":"failed"}\n');
    } else if (strategy === 'ollamaCloud') {
      // requestUrl 기본 throw를 그대로 쓰면 host가 HTTP 상태 없는 예외를 던져 downgrade가 불가능합니다.
      requestMock.mockImplementationOnce((request) => {
        if (typeof request === 'string' || request.throw !== false)
          throw new Error('호스트 HTTP 오류');
        return Promise.resolve({
          status: 400,
          text: 'This model does not support tools',
          json: {},
          headers: {},
          arrayBuffer: new ArrayBuffer(0),
        }) as ReturnType<typeof requestUrl>;
      });
    } else {
      respond('data: {"error":{"code":400,"message":"This model does not support tools"}}\n\n');
    }
    const result = provider(strategy).streamChat([], () => {}, 0.7, [tool]);
    if (strategy === 'ollamaCloud') {
      await expect(result).rejects.toMatchObject({ status: 400 });
    } else {
      await expect(result).rejects.toThrow();
    }
    expect(
      planNativeToolCompatibilityFallbackRust({
        status: 400,
        message: 'This model does not support tools',
        nativeAttempted: true,
        compatibilityFallbackAttempted: false,
      })?.retryWithCompatibility,
    ).toBe(true);
  });
});
