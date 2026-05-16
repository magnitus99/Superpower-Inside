import { requestUrl } from 'obsidian';
import type { CustomOpenAIProviderConfig, ProviderConfig } from '../settings';
import { REASONING_EXTRACTORS, type ReasoningExtractor } from './reasoning';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434';
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  toolCalls?: ToolCallInfo[];
  reasoning?: string;
  name?: string;
}

/** LLM이 호출한 툴 정보 (스트리밍 중 점진적 누적) */
export interface ToolCallInfo {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** StreamChunk에 전달되는 툴 호출 델타 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
  reasoning?: string;
  toolCalls?: ToolCallDelta[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChatOptions {
  signal?: AbortSignal;
}

/* ---------- Message Normalizers ---------- */

function toolCallToFn(tc: ToolCallInfo): { name: string; arguments: string } {
  return tc.function;
}

function parseToolArgs(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** OpenAI/OpenRouter/custom 호환: toolCalls → tool_calls(snake_case), content → null */
export function normalizeForOpenAI(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const msg: Record<string, unknown> = { role: m.role };
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      msg.content = null;
      msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: toolCallToFn(tc),
      }));
    } else {
      msg.content = m.content;
    }
    if (m.role === 'tool') {
      msg.tool_call_id = m.tool_call_id;
      msg.name = m.name;
    }
    return msg;
  });
}

/** Anthropic Claude: flat role → content block format (tool_use/tool_result) */
export function normalizeForClaude(
  messages: ChatMessage[],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parseToolArgs(tc.function.arguments),
        });
      }
      result.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      result.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
      });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

/** Ollama: toolCalls → Ollama tool_calls (id/type 제거, arguments 객체 변환) */
export function normalizeForOllama(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, name: m.name ?? 'unknown_tool' };
    }
    const normalized: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      normalized.tool_calls = m.toolCalls.map((tc) => ({
        function: {
          name: tc.function.name,
          arguments: parseToolArgs(tc.function.arguments),
        },
      }));
    }
    return normalized;
  });
}

export interface LLMProvider {
  chat(messages: ChatMessage[], temperature?: number): Promise<string>;
  streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature?: number,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void>;
}

/* ---------- OpenAI / OpenRouter Compatible ---------- */

class OpenAICompatibleProvider implements LLMProvider {
  protected config: ProviderConfig;
  protected endpoint: string;
  protected modelOverride?: string;
  protected reasoningExtractor: ReasoningExtractor;
  protected useRequestUrl: boolean;

  constructor(
    config: ProviderConfig,
    endpointOverride?: string,
    modelOverride?: string,
    reasoningExtractor?: ReasoningExtractor,
    useRequestUrl = false,
  ) {
    this.config = config;
    this.endpoint = endpointOverride ?? OPENAI_CHAT_COMPLETIONS_URL;
    this.modelOverride = modelOverride;
    this.reasoningExtractor = reasoningExtractor ?? REASONING_EXTRACTORS.default;
    this.useRequestUrl = useRequestUrl;
  }

  private normalizeMessages(messages: ChatMessage[]): Record<string, unknown>[] {
    return normalizeForOpenAI(messages);
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      options: { temperature },
      stream: false,
      think: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    if (this.useRequestUrl) {
      const res = await requestUrl({
        url: this.endpoint,
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status >= 400) {
        throw new Error(`LLM chat failed: ${res.status} ${res.text}`);
      }
      const data = res.json as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      temperature,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    if (this.useRequestUrl) {
      const res = await requestUrl({
        url: this.endpoint,
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status >= 400) {
        throw new Error(`LLM stream failed: ${res.status} ${res.text}`);
      }
      const lines = res.text.split('\n');
      for (const line of lines) {
        if (options?.signal?.aborted) {
          onChunk({ content: '', done: true });
          return;
        }
        if (this.processSSELine(line, onChunk)) return;
      }
      onChunk({ content: '', done: true });
      return;
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (options?.signal?.aborted) {
        onChunk({ content: '', done: true });
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (this.processSSELine(line, onChunk)) return;
      }
    }
    onChunk({ content: '', done: true });
  }

  protected buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }

  private processSSELine(
    line: string,
    onChunk: (chunk: StreamChunk) => void,
  ): boolean {
    if (!line.startsWith('data: ')) return false;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return true;
    if (!data) return false;
    try {
      const chunk = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content ?? '';
      const reasoning = this.reasoningExtractor.extract(delta ?? {});
      const toolCalls = delta?.tool_calls?.map(
        (tc): ToolCallDelta => ({
          index: tc.index,
          id: tc.id,
          type: tc.type as 'function' | undefined,
          function: tc.function
            ? { name: tc.function.name, arguments: tc.function.arguments }
            : undefined,
        }),
      );
      if (content || reasoning || (toolCalls && toolCalls.length > 0)) {
        onChunk({
          content,
          done: false,
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        });
      }
    } catch {
      // malformed SSE line — skip
    }
    return false;
  }
}

/* ---------- Claude (Anthropic Messages API) ---------- */

class ClaudeProvider implements LLMProvider {
  private config: ProviderConfig;
  private modelOverride?: string;

  constructor(config: ProviderConfig, modelOverride?: string) {
    this.config = config;
    this.modelOverride = modelOverride;
  }

  private normalizeMessages(messages: ChatMessage[]): Record<string, unknown>[] {
    return normalizeForClaude(messages);
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      max_tokens: 4096,
      temperature,
      messages: this.normalizeMessages(messages),
      system: messages.find((m) => m.role === 'system')?.content,
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Claude chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      max_tokens: 4096,
      temperature,
      stream: true,
      messages: this.normalizeMessages(messages),
      system: messages.find((m) => m.role === 'system')?.content,
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!res.ok) {
      throw new Error(`Claude stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (options?.signal?.aborted) {
        onChunk({ content: '', done: true });
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data) as {
            type: string;
            content_block?: { type: string; id?: string; name?: string };
            index?: number;
            delta?: {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            };
          };
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const toolCall: ToolCallDelta = {
              index: event.index ?? 0,
              id: event.content_block.id ?? '',
              type: 'function',
              function: { name: event.content_block.name ?? '', arguments: '' },
            };
            onChunk({ content: '', done: false, toolCalls: [toolCall] });
          } else if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'thinking_delta'
          ) {
            onChunk({ content: '', done: false, reasoning: event.delta.thinking ?? '' });
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            onChunk({ content: event.delta.text ?? '', done: false });
          } else if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'input_json_delta'
          ) {
            const toolCall: ToolCallDelta = {
              index: event.index ?? 0,
              function: { arguments: event.delta.partial_json ?? '' },
            };
            onChunk({ content: '', done: false, toolCalls: [toolCall] });
          } else if (event.type === 'content_block_delta' && !event.delta?.type) {
            onChunk({ content: event.delta?.text ?? '', done: false });
          } else if (event.type === 'message_stop') {
            onChunk({ content: '', done: true });
            return;
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
    onChunk({ content: '', done: true });
  }
}

/* ---------- Ollama (Local) ---------- */

class OllamaProvider implements LLMProvider {
  private config: ProviderConfig;
  private modelOverride?: string;

  constructor(config: ProviderConfig, modelOverride?: string) {
    this.config = config;
    this.modelOverride = modelOverride;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    if (baseUrl !== OLLAMA_LOCAL_BASE_URL && this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }

  private normalizeMessages(messages: ChatMessage[]): Record<string, unknown>[] {
    return normalizeForOllama(messages);
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
  ): Promise<string> {
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    const targetUrl = `${baseUrl}/api/chat`;
    console.log(
      '[SuperObsidian] Ollama chat URL:',
      targetUrl,
      'original baseUrl:',
      this.config.baseUrl,
    );
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      options: { temperature },
      stream: false,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    const res = await requestUrl({
      url: targetUrl,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status >= 400) {
      throw new Error(`Ollama chat failed: ${res.status} ${res.text}`);
    }
    const data = res.json as { message?: { content?: string } };
    return data.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      onChunk({ content: '', done: true });
      return;
    }
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    const targetUrl = `${baseUrl}/api/chat`;
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      options: { temperature },
      stream: true,
      think: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (options?.signal?.aborted) {
        onChunk({ content: '', done: true });
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as {
            message?: {
              content?: string;
              thinking?: string;
              tool_calls?: Array<{
                index?: number;
                function?: { name?: string; arguments?: unknown };
              }>;
            };
            done?: boolean;
            error?: string;
          };
          if (data.error) {
            throw new Error(`Ollama chat failed: ${data.error}`);
          }
          const content = data.message?.content ?? '';
          const thinking = data.message?.thinking;
          const toolCalls = data.message?.tool_calls?.map(
            (tc, index): ToolCallDelta => ({
              index: tc.index ?? index,
              type: 'function' as const,
              function: {
                name: tc.function?.name,
                arguments: stringifyToolArguments(tc.function?.arguments),
              },
            }),
          );
          if (content || thinking || (toolCalls && toolCalls.length > 0)) {
            onChunk({
              content,
              done: false,
              ...(thinking ? { reasoning: thinking } : {}),
              ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
            });
          }
          if (data.done) {
            onChunk({ content: '', done: true });
            return;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    onChunk({ content: '', done: true });
  }
}

function stringifyToolArguments(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args === undefined) return '';
  if (args === null) return 'null';
  if (typeof args === 'number' || typeof args === 'boolean' || typeof args === 'bigint') {
    return String(args);
  }
  if (typeof args === 'symbol') return args.description ?? '';
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url.replace(/\/+$/, '');
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -17);
  }
  if (!url.endsWith('/v1')) {
    url = `${url}/v1`;
  }
  return url.replace(/\/+$/, '');
}

/* ---------- Provider Factory ---------- */

export type ProviderKey = 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter';

export function createProvider(
  key: ProviderKey,
  config: ProviderConfig,
  modelOverride?: string,
): LLMProvider {
  switch (key) {
    case 'openai':
      return new OpenAICompatibleProvider(
        config, OPENAI_CHAT_COMPLETIONS_URL, modelOverride, REASONING_EXTRACTORS.openai,
      );
    case 'claude':
      return new ClaudeProvider(config, modelOverride);
    case 'ollama':
      return new OllamaProvider({ ...config, baseUrl: OLLAMA_LOCAL_BASE_URL }, modelOverride);
    case 'ollamaCloud':
      return new OllamaProvider({ ...config, baseUrl: OLLAMA_CLOUD_BASE_URL }, modelOverride);
    case 'openRouter':
      return new OpenAICompatibleProvider(
        config, OPENROUTER_CHAT_COMPLETIONS_URL, modelOverride, REASONING_EXTRACTORS.openRouter,
      );
    default:
      throw new Error(`Unknown provider: ${String(key)}`);
  }
}

export function createCustomOpenAIProvider(
  config: CustomOpenAIProviderConfig,
  modelOverride?: string,
): LLMProvider {
  if (!config.baseUrl?.trim()) {
    throw new Error('Custom OpenAI-compatible provider requires a base URL.');
  }
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl ?? '');
  return new OpenAICompatibleProvider(
    config, `${baseUrl}/chat/completions`, modelOverride, REASONING_EXTRACTORS.openRouter,
    config.useRequestUrl ?? true,
  );
}
