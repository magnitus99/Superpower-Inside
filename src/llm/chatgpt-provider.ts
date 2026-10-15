import { requestUrl } from 'obsidian';
import {
  desktopFetch,
  consumeDesktopStream,
  streamHeaders,
  DesktopStreamIncompleteError,
} from '../utils/desktop-stream';
import { appLogger } from '../utils/logger';
import { t } from '../i18n';
import { prepareProviderRequest } from './request-budget';
import { planChatGPTRust, planProviderModelDetailsRust } from '../rag/rust-core';
import type { ProviderModelInfo } from './validation';
import { chatGPTOAuth } from './chatgpt-oauth';
import {
  resolveProviderCapability,
  type ProviderCapabilityOverrides,
} from './provider-capabilities';
import {
  LLMProviderHttpError,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type StreamChunk,
  type ToolDefinition,
} from './providers';

const BASE_URL = 'https://chatgpt.com/backend-api/codex';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('chatGPTOAuthCancelled'), 'AbortError');
}

async function authenticatedRequest(
  profileId: string,
  path: 'responses' | 'models',
  body?: string,
  signal?: AbortSignal,
  onData?: (data: string) => boolean,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);
    const credentials = await chatGPTOAuth.credentials(profileId, attempt === 1);
    throwIfAborted(signal);
    const request = {
      url: `${BASE_URL}/${path}${path === 'models' ? `?${new URLSearchParams({ client_version: chatGPTOAuth.clientVersion })}` : ''}`,
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'ChatGPT-Account-Id': credentials.accountId,
        originator: 'superpower-inside',
        'OpenAI-Beta': 'responses=experimental',
        Accept: body === undefined ? 'application/json' : 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body,
      throw: false,
    };
    let response;
    if (path === 'responses' && onData) {
      const native = await desktopFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        signal,
      });
      if (native.ok) {
        let text = '';
        await consumeDesktopStream(
          native,
          'sse',
          (data) => {
            text += `data: ${data}\n\n`;
            return onData(data);
          },
          signal,
        );
        response = {
          status: native.status,
          text,
          headers: streamHeaders(native.headers),
          json: null,
        };
      } else {
        response = {
          status: native.status,
          text: await native.text(),
          headers: streamHeaders(native.headers),
          json: null,
        };
      }
    } else {
      response = await requestUrl(request);
    }
    throwIfAborted(signal);
    if (response.status === 401 && attempt === 0) continue;
    if (response.status >= 400) {
      const retryAfter = Number(
        response.headers?.['retry-after'] ?? response.headers?.['Retry-After'],
      );
      throw new LLMProviderHttpError(
        t('chatGPTOAuthHttpError', { status: response.status }),
        response.status,
        Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1000) : undefined,
      );
    }
    return response;
  }
  throw new Error(t('chatGPTOAuthRequired'));
}

export async function fetchChatGPTModels(profileId: string): Promise<string[]> {
  return (await fetchChatGPTModelDetails(profileId)).map((model) => model.id);
}

export async function fetchChatGPTModelDetails(profileId: string): Promise<ProviderModelInfo[]> {
  const response = await authenticatedRequest(profileId, 'models');
  const models = planProviderModelDetailsRust('openAIChatGPT', response.json);
  if (!models?.length) throw new Error(t('chatGPTResponseInvalid'));
  return models;
}

export class ChatGPTProvider implements LLMProvider {
  readonly capability;
  private observedModel: string | undefined;

  constructor(
    private readonly profileId: string,
    private readonly model: string,
    overrides?: ProviderCapabilityOverrides,
  ) {
    this.capability = resolveProviderCapability({ providerKey: 'openAIChatGPT', model, overrides });
  }

  getObservedModel(): string | undefined {
    return this.observedModel;
  }

  async chat(
    messages: ChatMessage[],
    _temperature?: number,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string> {
    const result = await this.generate(messages, tools, options);
    return result.content;
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    _temperature?: number,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<void> {
    let content = '';
    let reasoning = '';
    const result = await this.generate(
      messages,
      tools,
      options,
      (data) => {
        const chunk = planChatGPTRust<StreamChunk & { error?: boolean }>({
          operation: 'stream-event',
          data,
        });
        if (!chunk || chunk.error) throw new Error(t('chatGPTResponseInvalid'));
        if (chunk.content || chunk.reasoning) {
          content += chunk.content;
          reasoning += chunk.reasoning ?? '';
          onChunk(chunk);
        }
        return chunk.done;
      },
      () => ({ content, reasoning }),
    );
    throwIfAborted(options?.signal);
    onChunk({ ...result, done: false });
    onChunk({ content: '', done: true });
  }

  private async generate(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
    onData?: (data: string) => boolean,
    emitted?: () => { content: string; reasoning: string },
  ): Promise<StreamChunk> {
    throwIfAborted(options?.signal);
    messages = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const body = planChatGPTRust<Record<string, unknown>>({
      operation: 'request',
      model: this.model,
      messages,
      tools: this.capability.toolCalling ? (tools ?? []) : [],
      toolChoice: this.capability.toolCalling ? options?.toolChoice : 'none',
    });
    if (!body) throw new Error(t('chatGPTResponseInvalid'));
    const send = () =>
      authenticatedRequest(
        this.profileId,
        'responses',
        JSON.stringify(body),
        options?.signal,
        onData,
      );
    let response;
    try {
      response = await send();
    } catch (error) {
      throwIfAborted(options?.signal);
      const partial = emitted?.();
      // 출력 전 EOF만 한 번 재시도합니다. 부분 답변·추론을 중복 전송하지 않습니다.
      if (
        !(error instanceof DesktopStreamIncompleteError) ||
        !partial ||
        partial.content ||
        partial.reasoning
      )
        throw error;
      appLogger.warn('ChatGPT stream ended before output; retrying once.', {
        source: 'llm.chatgpt.stream',
      });
      response = await send();
    }
    const result = planChatGPTRust<StreamChunk & { model?: string }>({
      operation: emitted ? 'stream-tail' : 'response',
      text: response.text,
      ...emitted?.(),
    });
    if (!result) throw new Error(t('chatGPTResponseInvalid'));
    this.observedModel = result.model ?? this.observedModel;
    return result;
  }
}
