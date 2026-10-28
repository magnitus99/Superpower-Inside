import { requestUrl } from 'obsidian';
import { desktopFetch, consumeDesktopStream, streamHeaders } from '../utils/desktop-stream';
import { ChatGPTProvider } from './chatgpt-provider';
import {
  createGeminiApiKeyProvider,
  createGeminiCompatibleProvider,
  createGeminiOAuthProvider,
} from './gemini-provider';
import { prepareProviderRequest } from './request-budget';
import { normalizeProviderUsageRust, planChatGPTRust } from '../rag/rust-core';
import type {
  CustomOpenAIProviderConfig,
  ProviderApiFormat,
  ProviderConfig,
  ProviderStrategyKey,
} from '../settings';
import {
  buildOpenCodeEndpoint,
  buildProviderApiEndpoint,
  isLocalOllamaBaseUrl,
  normalizeProviderApiFormat,
} from './provider-api-format';
import {
  REASONING_EXTRACTORS,
  createStreamingReasoningSink,
  type ReasoningExtractor,
} from './reasoning';
import {
  resolveProviderCapability,
  type ProviderCapabilitySnapshot,
} from './provider-capabilities';

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
  tool_result_is_error?: boolean;
}

/** LLM이 호출한 툴 정보 (스트리밍 중 점진적 누적) */
export interface ToolCallInfo {
  id: string;
  type: 'function';
  /** Gemini thought signature. 다른 provider는 무시합니다. */
  thoughtSignature?: string;
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
  thoughtSignature?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  reasoning?: string;
  toolCalls?: ToolCallDelta[];
  usage?: TokenUsage;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolChoice = 'auto' | 'required' | 'none';

export interface ChatOptions {
  onUsage?: (usage: TokenUsage) => void;
  inputBudgetBytes?: number;
  maxOutputTokens?: number;
  contextTokens?: number;
  signal?: AbortSignal;
  toolChoice?: ToolChoice;
}

export type StreamChatOptions = ChatOptions;

export class LLMProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LLMProviderHttpError';
  }
}

function createProviderHttpError(
  prefix: string,
  response: { status: number; text: string; headers?: Record<string, string> },
): LLMProviderHttpError {
  const rawRetryAfter = response.headers?.['retry-after'] ?? response.headers?.['Retry-After'];
  const retryAfterSeconds = rawRetryAfter === undefined ? Number.NaN : Number(rawRetryAfter);
  const retryAfterMs = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, retryAfterSeconds * 1_000)
    : undefined;
  return new LLMProviderHttpError(
    `${prefix}: ${response.status} ${response.text}`,
    response.status,
    retryAfterMs,
  );
}

async function requestProviderStream(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await desktopFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw createProviderHttpError('LLM stream failed', {
      status: response.status,
      text: await response.text(),
      headers: streamHeaders(response.headers),
    });
  }
  return response;
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

function isToolResultContentBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).type === 'tool_result';
}

function throwIfChatAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('LLM request cancelled', 'AbortError');
  }
}

/** OpenAI/OpenRouter/custom 호환: toolCalls → tool_calls(snake_case), content → null */
export function normalizeForOpenAI(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const msg: Record<string, unknown> = { role: m.role };
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      msg.content = m.content || null;
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
export function normalizeForClaude(messages: ChatMessage[]): Record<string, unknown>[] {
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
      const block: Record<string, unknown> = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content,
        ...(m.tool_result_is_error === true ? { is_error: true } : {}),
      };
      const previous = result.at(-1);
      if (
        previous?.role === 'user' &&
        Array.isArray(previous.content) &&
        (previous.content as unknown[]).every(isToolResultContentBlock)
      ) {
        previous.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
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
      return { role: 'tool', content: m.content, tool_name: m.name ?? 'unknown_tool' };
    }
    const normalized: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.role === 'assistant' && m.reasoning) normalized.thinking = m.reasoning;
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
  readonly contextBudget?: import('../rag/rust-core').ModelContextBudget;
  readonly capability: ProviderCapabilitySnapshot;
  getObservedModel?(): string | undefined;
  chat(
    messages: ChatMessage[],
    temperature?: number,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string>;
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
  readonly capability: ProviderCapabilitySnapshot;
  private observedModel: string | undefined;

  getObservedModel(): string | undefined {
    return this.observedModel;
  }
  protected config: ProviderConfig;
  protected endpoint: string;
  protected modelOverride?: string;
  protected reasoningExtractor: ReasoningExtractor;
  private extraHeaders: Record<string, string>;

  constructor(
    config: ProviderConfig,
    endpointOverride?: string,
    modelOverride?: string,
    reasoningExtractor?: ReasoningExtractor,
    useRequestUrl = false,
    capability?: ProviderCapabilitySnapshot,
    extraHeaders: Record<string, string> = {},
  ) {
    this.config = config;
    this.endpoint = endpointOverride ?? OPENAI_CHAT_COMPLETIONS_URL;
    this.modelOverride = modelOverride;
    this.reasoningExtractor = reasoningExtractor ?? REASONING_EXTRACTORS.default;
    this.extraHeaders = extraHeaders;
    this.capability =
      capability ??
      resolveProviderCapability({
        providerKey: 'openai',
        model: this.modelOverride ?? this.config.models[0] ?? '',
        useRequestUrl,
      });
  }

  private normalizeMessages(messages: ChatMessage[]): Record<string, unknown>[] {
    return normalizeForOpenAI(messages);
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string> {
    throwIfChatAborted(options?.signal);
    const body = this.buildChatBody(messages, temperature, false, tools, options);
    const res = await requestUrl({
      url: this.endpoint,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status >= 400) {
      throw createProviderHttpError('LLM chat failed', res);
    }
    const data = res.json as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    this.observedModel = data.model?.trim() || this.observedModel;
    throwIfChatAborted(options?.signal);
    const usage = normalizeProviderUsageRust('openai', data);
    if (usage) options?.onUsage?.(usage);
    return data.choices?.[0]?.message?.content ?? '';
  }

  private buildChatBody(
    messages: ChatMessage[],
    temperature: number,
    stream: boolean,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Record<string, unknown> {
    messages = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      temperature,
      stream,
      ...(stream && ['openai', 'openRouter'].includes(this.capability.providerKey)
        ? { stream_options: { include_usage: true } }
        : {}),
      ...(options?.maxOutputTokens
        ? this.capability.providerKey === 'openai'
          ? { max_completion_tokens: options.maxOutputTokens }
          : { max_tokens: options.maxOutputTokens }
        : {}),
    };
    if (this.capability.toolCalling && tools && tools.length > 0) {
      body.tools = tools;
      if (options?.toolChoice) body.tool_choice = options.toolChoice;
    }
    return body;
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    throwIfChatAborted(options?.signal);
    const body = this.buildChatBody(messages, temperature, true, tools, options);
    onChunk = createStreamingReasoningSink(onChunk);
    const res = await requestProviderStream(
      this.endpoint,
      this.buildHeaders(),
      body,
      options?.signal,
    );
    await consumeDesktopStream(
      res,
      'sse',
      (data) => this.processSSELine(`data: ${data}`, onChunk, options),
      options?.signal,
    );
  }

  protected buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }

  private processSSELine(
    line: string,
    onChunk: (chunk: StreamChunk) => void,
    options?: ChatOptions,
  ): boolean {
    if (!line.startsWith('data: ')) return false;
    const data = line.slice(6).trim();
    if (data === '[DONE]') {
      onChunk({ content: '', done: true });
      return true;
    }
    if (!data) return false;

    const chunk = JSON.parse(data) as {
      error?: { message?: string; code?: number; status?: number };
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
    if (chunk.error) {
      throw new LLMProviderHttpError(
        chunk.error.message ?? 'LLM stream failed',
        chunk.error.status ?? chunk.error.code ?? 502,
      );
    }
    const usage = normalizeProviderUsageRust('openai', chunk);
    if (usage) options?.onUsage?.(usage);
    const delta = chunk.choices?.[0]?.delta;
    const normalized = {
      content: delta?.content ?? '',
      reasoning: this.reasoningExtractor.extract(delta ?? {}),
    };
    const content = normalized.content;
    const reasoning = normalized.reasoning;
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
    if (content || reasoning || usage || (toolCalls && toolCalls.length > 0)) {
      onChunk({
        content,
        done: false,
        ...(usage ? { usage } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    return false;
  }
}

/* ---------- OpenAI Responses API ---------- */

class OpenAIResponsesProvider implements LLMProvider {
  readonly capability: ProviderCapabilitySnapshot;
  private observedModel: string | undefined;

  getObservedModel(): string | undefined {
    return this.observedModel;
  }

  constructor(
    private readonly config: ProviderConfig,
    private readonly endpoint: string,
    private readonly modelOverride?: string,
    capability?: ProviderCapabilitySnapshot,
    private readonly extraHeaders: Record<string, string> = {},
  ) {
    this.capability =
      capability ??
      resolveProviderCapability({
        providerKey: 'openai',
        model: this.modelOverride ?? this.config.models[0] ?? '',
      });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  private buildBody(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Record<string, unknown> {
    messages = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const body = planChatGPTRust<Record<string, unknown>>({
      operation: 'request',
      api: 'responses',
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages,
      tools: this.capability.toolCalling ? (tools ?? []) : [],
      toolChoice: this.capability.toolCalling ? (options?.toolChoice ?? 'auto') : 'none',
      ...(options?.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    });
    if (!body) throw new Error('Responses request could not be prepared');
    return body;
  }

  async chat(
    messages: ChatMessage[],
    _temperature = 0.7,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string> {
    throwIfChatAborted(options?.signal);
    const res = await requestUrl({
      url: this.endpoint,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(messages, tools, options)),
      throw: false,
    });
    if (res.status >= 400) throw createProviderHttpError('Responses chat failed', res);
    const result = planChatGPTRust<StreamChunk & { model?: string }>({
      operation: 'response',
      text: res.text,
    });
    if (!result?.content) throw new Error('Responses chat returned no text');
    this.observedModel = result.model ?? this.observedModel;
    throwIfChatAborted(options?.signal);
    return result.content;
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    _temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    throwIfChatAborted(options?.signal);
    const res = await requestProviderStream(
      this.endpoint,
      this.buildHeaders(),
      this.buildBody(messages, tools, options),
      options?.signal,
    );
    let content = '';
    let reasoning = '';
    let raw = '';
    await consumeDesktopStream(
      res,
      'sse',
      (data) => {
        raw += `data: ${data}\n\n`;
        const chunk = planChatGPTRust<StreamChunk & { error?: boolean }>({
          operation: 'stream-event',
          data,
        });
        if (!chunk || chunk.error) throw new Error('Responses stream failed');
        if (chunk.content || chunk.reasoning) {
          content += chunk.content;
          reasoning += chunk.reasoning ?? '';
          onChunk(chunk);
        }
        return chunk.done;
      },
      options?.signal,
    );
    const result = planChatGPTRust<StreamChunk & { model?: string }>({
      operation: 'stream-tail',
      text: raw,
      content,
      reasoning,
    });
    if (!result) throw new Error('Responses stream could not be reconciled');
    this.observedModel = result.model ?? this.observedModel;
    if (result.content || result.reasoning || (result.toolCalls?.length ?? 0) > 0) {
      onChunk({ ...result, done: false });
    }
    onChunk({ content: '', done: true });
  }
}

/* ---------- Anthropic Messages API ---------- */

class AnthropicMessagesProvider implements LLMProvider {
  readonly capability: ProviderCapabilitySnapshot;
  private observedModel: string | undefined;

  getObservedModel(): string | undefined {
    return this.observedModel;
  }

  constructor(
    private readonly config: ProviderConfig,
    private readonly endpoint: string,
    private readonly headers: Record<string, string>,
    private readonly modelOverride?: string,
    capability?: ProviderCapabilitySnapshot,
  ) {
    this.capability =
      capability ??
      resolveProviderCapability({
        providerKey: 'claude',
        model: this.modelOverride ?? this.config.models[0] ?? '',
      });
  }

  private buildHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...this.headers };
  }

  private buildBody(
    messages: ChatMessage[],
    temperature: number,
    stream: boolean,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      max_tokens: options?.maxOutputTokens ?? 4096,
      temperature,
      ...(stream ? { stream: true } : {}),
      messages: normalizeForClaude(
        prepareProviderRequest(
          messages,
          this.capability.toolCalling ? tools : undefined,
          options?.inputBudgetBytes,
        ).messages,
      ),
      system: messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n'),
    };
    if (this.capability.toolCalling && tools && tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
      if (options?.toolChoice) {
        body.tool_choice = mapClaudeToolChoice(options.toolChoice);
      }
    }
    return body;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string> {
    throwIfChatAborted(options?.signal);
    const res = await requestUrl({
      url: this.endpoint,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(messages, temperature, false, tools, options)),
      throw: false,
    });
    if (res.status >= 400) throw createProviderHttpError('Messages chat failed', res);
    const data = res.json as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    this.observedModel = data.model?.trim() || this.observedModel;
    throwIfChatAborted(options?.signal);
    const usage = normalizeProviderUsageRust('claude', data);
    if (usage) options?.onUsage?.(usage);
    return data.content?.find((part) => part.type === 'text')?.text ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    throwIfChatAborted(options?.signal);
    const res = await requestProviderStream(
      this.endpoint,
      this.buildHeaders(),
      this.buildBody(messages, temperature, true, tools, options),
      options?.signal,
    );
    await consumeDesktopStream(
      res,
      'sse',
      (data) => {
        if (!data) return false;

        const event = JSON.parse(data) as {
          type: string;
          error?: { type?: string; message?: string };
          content_block?: { type: string; id?: string; name?: string };
          index?: number;
          delta?: {
            type?: string;
            text?: string;
            thinking?: string;
            partial_json?: string;
          };
        };
        if (event.type === 'error') {
          throw new LLMProviderHttpError(
            event.error?.message ?? 'Messages stream failed',
            event.error?.type === 'overloaded_error' ? 529 : 502,
          );
        }
        const usage = normalizeProviderUsageRust('claude', event);
        if (usage) {
          options?.onUsage?.(usage);
          onChunk({ content: '', done: false, usage });
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const toolCall: ToolCallDelta = {
            index: event.index ?? 0,
            id: event.content_block.id ?? '',
            type: 'function',
            function: { name: event.content_block.name ?? '', arguments: '' },
          };
          onChunk({ content: '', done: false, toolCalls: [toolCall] });
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
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
          return true;
        }

        return false;
      },
      options?.signal,
    );
  }
}

function mapClaudeToolChoice(toolChoice: ToolChoice): { type: 'auto' | 'any' | 'none' } {
  return {
    type: toolChoice === 'required' ? 'any' : toolChoice,
  };
}

/* ---------- Ollama (Local) ---------- */

class OllamaProvider implements LLMProvider {
  readonly capability: ProviderCapabilitySnapshot;
  private observedModel: string | undefined;

  getObservedModel(): string | undefined {
    return this.observedModel;
  }
  private config: ProviderConfig;
  private modelOverride?: string;

  constructor(
    config: ProviderConfig,
    modelOverride?: string,
    useRequestUrlForStreaming = false,
    capability?: ProviderCapabilitySnapshot,
  ) {
    this.config = config;
    this.modelOverride = modelOverride;
    this.capability =
      capability ??
      resolveProviderCapability({
        providerKey: useRequestUrlForStreaming ? 'ollamaCloud' : 'ollama',
        model: this.modelOverride ?? this.config.models[0] ?? '',
        useRequestUrl: useRequestUrlForStreaming,
      });
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    if (!isLocalOllamaBaseUrl(baseUrl) && this.config.apiKey) {
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
    options?: ChatOptions,
  ): Promise<string> {
    throwIfChatAborted(options?.signal);
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    const targetUrl = `${baseUrl}/api/chat`;
    messages = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      options: {
        temperature,
        ...(options?.contextTokens ? { num_ctx: options.contextTokens } : {}),
        ...(options?.maxOutputTokens ? { num_predict: options.maxOutputTokens } : {}),
      },
      stream: false,
    };
    if (this.capability.toolCalling && tools && tools.length > 0) {
      body.tools = tools;
    }
    const res = await requestUrl({
      url: targetUrl,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status >= 400) {
      throw createProviderHttpError('Ollama chat failed', res);
    }
    const data = res.json as { model?: string; message?: { content?: string } };
    this.observedModel = data.model?.trim() || this.observedModel;
    throwIfChatAborted(options?.signal);
    const usage = normalizeProviderUsageRust('ollama', data);
    if (usage) options?.onUsage?.(usage);
    return data.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<void> {
    throwIfChatAborted(options?.signal);
    const baseUrl = normalizeOllamaBaseUrl(this.config.baseUrl ?? OLLAMA_LOCAL_BASE_URL);
    const targetUrl = `${baseUrl}/api/chat`;
    messages = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const body: Record<string, unknown> = {
      model: this.modelOverride ?? this.config.models[0] ?? '',
      messages: this.normalizeMessages(messages),
      options: {
        temperature,
        ...(options?.contextTokens ? { num_ctx: options.contextTokens } : {}),
        ...(options?.maxOutputTokens ? { num_predict: options.maxOutputTokens } : {}),
      },
      stream: true,
      think: true,
    };
    onChunk = createStreamingReasoningSink(onChunk);
    if (this.capability.toolCalling && tools && tools.length > 0) {
      body.tools = tools;
    }
    const res = await requestProviderStream(targetUrl, this.buildHeaders(), body, options?.signal);
    await consumeDesktopStream(
      res,
      'ndjson',
      (line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;

        const data = JSON.parse(trimmed) as OllamaChatResponse;
        if (data.error) {
          throw new Error(`Ollama chat failed: ${data.error}`);
        }
        const usage = normalizeProviderUsageRust('ollama', data);
        if (usage) {
          options?.onUsage?.(usage);
          onChunk({ content: '', done: false, usage });
        }
        const chunk = toOllamaStreamChunk(data);
        if (chunk) {
          onChunk(chunk);
        }
        if (data.done) {
          onChunk({ content: '', done: true });
          return true;
        }

        return false;
      },
      options?.signal,
    );
  }
}

interface OllamaChatResponse {
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
}

function toOllamaStreamChunk(data: OllamaChatResponse): StreamChunk | null {
  const normalized = {
    content: data.message?.content ?? '',
    reasoning: data.message?.thinking,
  };
  const content = normalized.content;
  const thinking = normalized.reasoning;
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
  if (!content && !thinking && (!toolCalls || toolCalls.length === 0)) {
    return null;
  }
  // Ollama Cloud에서 content가 비고 thinking만 오는 경우에도 content를 폴백
  const finalContent = content || thinking || '';
  return {
    content: finalContent,
    done: false,
    ...(thinking ? { reasoning: thinking } : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
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

/* ---------- Provider Factory ---------- */

export type ProviderKey = 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter';

function buildCompatAnthropicHeaders(config: ProviderConfig): Record<string, string> {
  const apiKey = config.apiKey.trim();
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey } : {}),
    'anthropic-version': '2023-06-01',
  };
}

function buildOpenCodeSessionHeader(profileId: string): Record<string, string> {
  const session = profileId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'profile';
  return { 'x-opencode-session': `ses_${session}` };
}

function createOpenCodeProvider(
  config: ProviderConfig,
  modelOverride: string | undefined,
  profileId: string,
): LLMProvider {
  const format = normalizeProviderApiFormat(config.apiFormat) ?? 'responses';
  const model = modelOverride ?? config.models[0] ?? '';
  const capability = resolveProviderCapability({ providerKey: 'opencode', model });
  const sessionHeaders = buildOpenCodeSessionHeader(profileId);
  if (format === 'messages') {
    return new AnthropicMessagesProvider(
      config,
      buildOpenCodeEndpoint(config.baseUrl, 'messages'),
      { ...buildCompatAnthropicHeaders(config), ...sessionHeaders },
      modelOverride,
      capability,
    );
  }
  if (format === 'responses') {
    return new OpenAIResponsesProvider(
      config,
      buildOpenCodeEndpoint(config.baseUrl, 'responses'),
      modelOverride,
      capability,
      sessionHeaders,
    );
  }
  if (format === 'gemini') {
    return createGeminiCompatibleProvider({
      model,
      apiKey: config.apiKey,
      endpointBuilder: (stream) =>
        buildOpenCodeEndpoint(config.baseUrl, 'gemini', model, stream),
      extraHeaders: sessionHeaders,
      capability,
    });
  }
  return new OpenAICompatibleProvider(
    config,
    buildOpenCodeEndpoint(config.baseUrl, 'chat'),
    modelOverride,
    REASONING_EXTRACTORS.openRouter,
    false,
    capability,
    sessionHeaders,
  );
}

function createCustomProviderWithFormat(
  config: CustomOpenAIProviderConfig,
  format: ProviderApiFormat,
  modelOverride?: string,
): LLMProvider {
  const endpoint = buildProviderApiEndpoint(config.baseUrl ?? '', format);
  if (!endpoint) {
    throw new Error('Custom endpoint provider requires a base URL.');
  }
  const useRequestUrl = config.useRequestUrl ?? true;
  const model = modelOverride ?? config.models[0] ?? '';
  const capability = resolveProviderCapability({
    providerKey: `customOpenAI:${config.id}`,
    model,
    useRequestUrl,
    overrides: config.capabilityOverrides,
  });
  if (format === 'messages') {
    return new AnthropicMessagesProvider(
      config,
      endpoint,
      buildCompatAnthropicHeaders(config),
      modelOverride,
      capability,
    );
  }
  if (format === 'responses') {
    return new OpenAIResponsesProvider(config, endpoint, modelOverride, capability);
  }
  if (format === 'gemini') {
    return createGeminiCompatibleProvider({
      model,
      apiKey: config.apiKey,
      endpointBuilder: (stream) =>
        buildProviderApiEndpoint(config.baseUrl ?? '', 'gemini', model, stream),
      capability,
    });
  }
  return new OpenAICompatibleProvider(
    config,
    endpoint,
    modelOverride,
    REASONING_EXTRACTORS.openRouter,
    useRequestUrl,
    capability,
  );
}

export function createProvider(
  key: ProviderKey,
  config: ProviderConfig,
  modelOverride?: string,
): LLMProvider {
  const model = modelOverride ?? config.models[0] ?? '';
  const capability = resolveProviderCapability({ providerKey: key, model });
  switch (key) {
    case 'openai':
      return new OpenAICompatibleProvider(
        config,
        config.baseUrl?.trim()
          ? buildProviderApiEndpoint(config.baseUrl, 'chat')
          : OPENAI_CHAT_COMPLETIONS_URL,
        modelOverride,
        REASONING_EXTRACTORS.openai,
        false,
        capability,
      );
    case 'claude':
      return new AnthropicMessagesProvider(
        config,
        config.baseUrl?.trim()
          ? buildProviderApiEndpoint(config.baseUrl, 'messages')
          : ANTHROPIC_MESSAGES_URL,
        {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        modelOverride,
        capability,
      );
    case 'ollama':
      return new OllamaProvider(config, modelOverride, false, capability);
    case 'ollamaCloud':
      return new OllamaProvider(
        { ...config, baseUrl: OLLAMA_CLOUD_BASE_URL },
        modelOverride,
        true,
        capability,
      );
    case 'openRouter':
      return new OpenAICompatibleProvider(
        config,
        config.baseUrl?.trim()
          ? buildProviderApiEndpoint(config.baseUrl, 'chat')
          : OPENROUTER_CHAT_COMPLETIONS_URL,
        modelOverride,
        REASONING_EXTRACTORS.openRouter,
        false,
        capability,
      );
    default:
      throw new Error(`Unknown provider: ${String(key)}`);
  }
}

export function createCustomOpenAIProvider(
  config: CustomOpenAIProviderConfig,
  modelOverride?: string,
): LLMProvider {
  const format = normalizeProviderApiFormat(config.apiFormat) ?? 'chat';
  return createCustomProviderWithFormat(config, format, modelOverride);
}

export function createProviderForStrategy(
  key: ProviderStrategyKey,
  config: ProviderConfig & Partial<CustomOpenAIProviderConfig>,
  modelOverride?: string,
  profileId = 'profile',
): LLMProvider {
  if (key === 'ternlight') {
    throw new Error('Ternlight is an embedding-only provider.');
  }
  if (key === 'openAIChatGPT') {
    return new ChatGPTProvider(
      config.id ?? profileId,
      modelOverride ?? config.models[0] ?? '',
      config.capabilityOverrides,
    );
  }
  if (key === 'opencode') {
    return createOpenCodeProvider(config, modelOverride, config.id ?? profileId);
  }
  if (key === 'gemini') {
    const model = modelOverride ?? config.models[0] ?? '';
    const capability = resolveProviderCapability({ providerKey: 'gemini', model });
    return config.geminiAuthMode === 'oauth'
      ? createGeminiOAuthProvider(model, config.id ?? profileId, capability)
      : createGeminiApiKeyProvider(model, config.apiKey, capability, config.baseUrl);
  }
  if (key === 'openAICompatible') {
    return createCustomOpenAIProvider(
      {
        ...config,
        id: config.id ?? profileId,
        name: config.name ?? 'Custom endpoint',
        useRequestUrl: config.useRequestUrl ?? true,
      },
      modelOverride,
    );
  }
  return createProvider(key, config, modelOverride);
}
