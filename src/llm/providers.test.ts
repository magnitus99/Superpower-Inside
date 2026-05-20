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

function parseRequestUrlBody(): Record<string, unknown> {
  const call = requestUrlMock.mock.calls[0]?.[0];
  if (typeof call === 'string' || call === undefined) {
    throw new Error('requestUrl should be called with RequestUrlParam');
  }
  if (typeof call.body !== 'string') {
    throw new Error('requestUrl body should be a JSON string');
  }
  return JSON.parse(call.body) as Record<string, unknown>;
}

function createStreamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${line}\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
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

describe('provider reasoning stream normalization', () => {
  it('OpenAI 호환 SSE의 reasoning_content와 content 내부 think 태그를 분리한다', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        createStreamResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"구조화 생각"}}]}',
          'data: {"choices":[{"delta":{"content":"<think>태그 생각</think>최종"}}]}',
          'data: [DONE]',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'openai',
      { apiKey: 'test-key', enabled: true, models: ['gpt-test'] },
      'gpt-test',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk);

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      content: '',
      done: false,
      reasoning: '구조화 생각',
    });
    expect(onChunk).toHaveBeenNthCalledWith(2, {
      content: '최종',
      done: false,
      reasoning: '태그 생각',
    });
  });

  it('OpenRouter SSE의 reasoning 필드를 reasoning chunk로 분리한다', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        createStreamResponse([
          'data: {"choices":[{"delta":{"reasoning":"openrouter 생각","content":"답변"}}]}',
          'data: [DONE]',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'openRouter',
      { apiKey: 'test-key', enabled: true, models: ['openrouter-test'] },
      'openrouter-test',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk);

    expect(onChunk).toHaveBeenCalledWith({
      content: '답변',
      done: false,
      reasoning: 'openrouter 생각',
    });
  });

  it('Claude thinking_delta는 reasoning으로, text_delta는 content로 전달한다', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        createStreamResponse([
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"claude 생각"}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude 답변"}}',
          'data: {"type":"message_stop"}',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'claude',
      { apiKey: 'test-key', enabled: true, models: ['claude-test'] },
      'claude-test',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk);

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      content: '',
      done: false,
      reasoning: 'claude 생각',
    });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: 'claude 답변', done: false });
    expect(onChunk).toHaveBeenNthCalledWith(3, { content: '', done: true });
  });
});

describe('Ollama streamChat transport', () => {
  it('Ollama Cloud 스트리밍은 브라우저 fetch 대신 requestUrl 비스트리밍 요청을 사용한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '{"message":{"content":"cloud answer"},"done":true}',
      json: { message: { content: 'cloud answer' }, done: true },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const provider = createProvider(
      'ollamaCloud',
      { apiKey: 'test-key', enabled: true, models: ['deepseek-v4-pro'] },
      'deepseek-v4-pro',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk, 0.3, [createTool()]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestUrlMock).toHaveBeenCalledOnce();
    const call = requestUrlMock.mock.calls[0]?.[0];
    if (typeof call === 'string' || call === undefined) {
      throw new Error('requestUrl should be called with RequestUrlParam');
    }
    expect(call.url).toBe('https://ollama.com/api/chat');
    expect(call.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });
    const body = parseRequestUrlBody();
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      options: { temperature: 0.3 },
      stream: false,
      think: true,
      tools: [createTool()],
    });
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'cloud answer', done: false });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: '', done: true });
  });

  it('Ollama Local 스트리밍은 기존처럼 fetch 기반 NDJSON 스트림을 사용한다', async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('{"message":{"content":"local "},"done":false}\n'),
              );
              controller.enqueue(
                encoder.encode('{"message":{"content":"answer"},"done":true}\n'),
              );
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'ollama',
      { apiKey: '', enabled: true, models: ['llama3.1'] },
      'llama3.1',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk, 0.5);

    expect(requestUrlMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = parseFetchBody(fetchMock);
    expect(body).toMatchObject({
      model: 'llama3.1',
      options: { temperature: 0.5 },
      stream: true,
      think: true,
    });
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'local ', done: false });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: 'answer', done: false });
    expect(onChunk).toHaveBeenNthCalledWith(3, { content: '', done: true });
  });

  it('Ollama thinking 필드와 content 내부 think 태그를 reasoning으로 분리한다', async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  '{"message":{"thinking":"ollama 생각","content":"<think>태그 생각</think>답변"},"done":false}\n',
                ),
              );
              controller.enqueue(encoder.encode('{"done":true}\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider(
      'ollama',
      { apiKey: '', enabled: true, models: ['llama3.1'] },
      'llama3.1',
    );
    const onChunk = vi.fn();

    await provider.streamChat([{ role: 'user', content: 'Hello' }], onChunk);

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      content: '답변',
      done: false,
      reasoning: 'ollama 생각\n\n태그 생각',
    });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: '', done: true });
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
