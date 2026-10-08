import { requestUrl } from 'obsidian';
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
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);
    const credentials = await chatGPTOAuth.credentials(profileId, attempt === 1);
    throwIfAborted(signal);
    const response = await requestUrl({
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
    });
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
    const result = await this.generate(messages, tools, options);
    throwIfAborted(options?.signal);
    onChunk({ ...result, done: false });
    onChunk({ content: '', done: true });
  }

  private async generate(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
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
    const response = await authenticatedRequest(
      this.profileId,
      'responses',
      JSON.stringify(body),
      options?.signal,
    );
    const result = planChatGPTRust<StreamChunk & { model?: string }>({
      operation: 'response',
      text: response.text,
    });
    if (!result) throw new Error(t('chatGPTResponseInvalid'));
    this.observedModel = result.model ?? this.observedModel;
    return result;
  }
}
