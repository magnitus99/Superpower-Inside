import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import { requestUrl } from 'obsidian';
import type { ChatMessage, ToolCallInfo } from './providers';
import {
  createCustomOpenAIProvider,
  createProvider,
  normalizeForClaude,
  normalizeForOllama,
  normalizeForOpenAI,
  type ToolDefinition,
} from './providers';

const requestUrlMock = vi.mocked(requestUrl);

function tc(
  id: string,
  name: string,
  args: string,
): ToolCallInfo {
  return { id, type: 'function', function: { name, arguments: args } };
}

function createTool(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search notes',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
      },
    },
  };
}

function parseFetchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
  if (typeof init.body !== 'string') {
    throw new Error('fetch body should be a JSON string');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeForOpenAI', () => {
  it('plain user/assistant messages pass through unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = normalizeForOpenAI(messages);
    expect(result).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('assistant with toolCalls → tool_calls and content: null', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'List files.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('call_1', 'list_directory', '{"path":"/test"}')],
      },
    ];
    const result = normalizeForOpenAI(messages);
    expect(result).toEqual([
      { role: 'user', content: 'List files.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_directory', arguments: '{"path":"/test"}' },
          },
        ],
      },
    ]);
  });

  it('assistant with text + toolCalls → content null, tool_calls has snake_case key', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Let me check...',
        toolCalls: [tc('call_2', 'read_file', '{"path":"/test/file.md"}')],
      },
    ];
    const result = normalizeForOpenAI(messages);
    const assistantMsg = result[0];
    expect(assistantMsg.content).toBeNull();
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.toolCalls).toBeUndefined();
  });

  it('tool role preserves tool_call_id and name', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [tc('call_3', 'list_directory', '{}')] },
      { role: 'tool', content: '[FILE] test.md', tool_call_id: 'call_3', name: 'list_directory' },
    ];
    const result = normalizeForOpenAI(messages);
    expect(result[1]).toEqual({
      role: 'tool',
      content: '[FILE] test.md',
      tool_call_id: 'call_3',
      name: 'list_directory',
    });
  });

  it('the exact bug scenario: tool result after assistant tool call', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '@filesystem ~/ 경로 요약해줘.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('call_x', 'list_allowed_directories', '{}')],
      },
      {
        role: 'tool',
        content: 'Allowed directories:\n/Users/test',
        tool_call_id: 'call_x',
        name: 'list_allowed_directories',
      },
    ];
    const result = normalizeForOpenAI(messages);
    expect(result[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_x', type: 'function', function: { name: 'list_allowed_directories', arguments: '{}' } },
      ],
    });
    expect(result[3]).toEqual({
      role: 'tool',
      content: 'Allowed directories:\n/Users/test',
      tool_call_id: 'call_x',
      name: 'list_allowed_directories',
    });
  });
});

describe('OpenAI-compatible chat request body', () => {
  it('OpenAI 비스트리밍 chat 요청은 Ollama 전용 options/think 필드를 보내지 않는다', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'openai',
      { apiKey: 'test-key', enabled: true, models: ['gpt-test'] },
      'gpt-override',
    );

    await provider.chat([{ role: 'user', content: 'Hello' }], 0.4, [createTool()]);

    const body = parseFetchBody(fetchMock);
    expect(body).toMatchObject({
      model: 'gpt-override',
      temperature: 0.4,
      stream: false,
      tools: [createTool()],
    });
    expect(body.options).toBeUndefined();
    expect(body.think).toBeUndefined();
  });

  it('OpenRouter 비스트리밍 chat 요청도 OpenAI 호환 필드만 보낸다', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'openRouter',
      { apiKey: 'test-key', enabled: true, models: ['openrouter-test'] },
      'openrouter-override',
    );

    await provider.chat([{ role: 'user', content: 'Hello' }], 0.2);

    const body = parseFetchBody(fetchMock);
    expect(body.temperature).toBe(0.2);
    expect(body.stream).toBe(false);
    expect(body.options).toBeUndefined();
    expect(body.think).toBeUndefined();
  });

  it('Custom OpenAI requestUrl 경로도 options/think 없이 JSON body를 보낸다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: 'ok',
      json: { choices: [{ message: { content: 'ok' } }] },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const provider = createCustomOpenAIProvider(
      {
        id: 'custom',
        name: 'Custom',
        apiKey: 'test-key',
        baseUrl: 'http://localhost:1234/v1',
        enabled: true,
        models: ['custom-test'],
        useRequestUrl: true,
      },
      'custom-override',
    );

    await provider.chat([{ role: 'user', content: 'Hello' }], 0.1);

    const call = requestUrlMock.mock.calls[0]?.[0];
    if (typeof call === 'string' || call === undefined) {
      throw new Error('requestUrl should be called with RequestUrlParam');
    }
    if (typeof call.body !== 'string') {
      throw new Error('requestUrl body should be a JSON string');
    }
    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(body.temperature).toBe(0.1);
    expect(body.stream).toBe(false);
    expect(body.options).toBeUndefined();
    expect(body.think).toBeUndefined();
  });
});

describe('normalizeForClaude', () => {
  it('plain messages pass through as-is', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = normalizeForClaude(messages);
    expect(result).toEqual([
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('system messages are excluded (handled as top-level field)', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
    ];
    const result = normalizeForClaude(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'Hello!' });
  });

  it('assistant with toolCalls → content block (tool_use)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('toolu_abc', 'list_directory', '{"path":"/test"}')],
      },
    ];
    const result = normalizeForClaude(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_abc', name: 'list_directory', input: { path: '/test' } },
      ],
    });
  });

  it('assistant with text + toolCalls → text block + tool_use block', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'I will check the directory.',
        toolCalls: [tc('toolu_xyz', 'list_directory', '{}')],
      },
    ];
    const result = normalizeForClaude(messages);
    expect(result[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will check the directory.' },
        { type: 'tool_use', id: 'toolu_xyz', name: 'list_directory', input: {} },
      ],
    });
  });

  it('tool role → user message with tool_result content block', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: '[FILE] test.md', tool_call_id: 'toolu_abc', name: 'list_directory' },
    ];
    const result = normalizeForClaude(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_abc', content: '[FILE] test.md' },
      ],
    });
  });

  it('the exact bug scenario: tool result after assistant tool call', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'List files.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('toolu_1', 'list_allowed_directories', '{}')],
      },
      {
        role: 'tool',
        content: 'Allowed directories:\n/Users/test',
        tool_call_id: 'toolu_1',
        name: 'list_allowed_directories',
      },
    ];
    const result = normalizeForClaude(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'user', content: 'List files.' });
    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'list_allowed_directories', input: {} },
      ],
    });
    expect(result[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Allowed directories:\n/Users/test' },
      ],
    });
  });
});

describe('normalizeForOllama', () => {
  it('plain messages pass through with role and content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const result = normalizeForOllama(messages);
    expect(result).toEqual([
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi!' },
    ]);
  });

  it('assistant with toolCalls → Ollama tool_calls format (no id/type)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('call_1', 'list_directory', '{"path":"/test"}')],
      },
    ];
    const result = normalizeForOllama(messages);
    expect(result[0]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { function: { name: 'list_directory', arguments: { path: '/test' } } },
      ],
    });
  });

  it('tool role preserves name, omits id and type', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: '[FILE] test.md', tool_call_id: 'call_1', name: 'list_directory' },
    ];
    const result = normalizeForOllama(messages);
    expect(result[0]).toEqual({
      role: 'tool',
      content: '[FILE] test.md',
      name: 'list_directory',
    });
  });

  it('tool role without name uses fallback', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'result', tool_call_id: 'call_1' },
    ];
    const result = normalizeForOllama(messages);
    expect(result[0]).toEqual({
      role: 'tool',
      content: 'result',
      name: 'unknown_tool',
    });
  });

  it('ToolCallInfo arguments string is parsed to object', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [tc('call_2', 'read_file', '{"path":"/test/file.md"}')],
      },
    ];
    const result = normalizeForOllama(messages);
    const msg = result[0];
    const calls = msg.tool_calls as Array<Record<string, unknown>>;
    const fn = calls[0].function as Record<string, unknown>;
    expect(fn.arguments).toEqual({ path: '/test/file.md' });
  });
});
