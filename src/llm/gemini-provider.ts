import { requestUrl } from 'obsidian';
import { t } from '../i18n';
import { planGeminiRust } from '../rag/rust-core';
import { consumeDesktopStream, desktopFetch } from '../utils/desktop-stream';
import { prepareProviderRequest } from './request-budget';
import { buildProviderApiEndpoint } from './provider-api-format';
import {
  LLMProviderHttpError,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type StreamChunk,
  type ToolDefinition,
} from './providers';
import {
  resolveProviderCapability,
  type ProviderCapabilitySnapshot,
} from './provider-capabilities';
import { googleGeminiOAuth } from './google-gemini-oauth';

const GOOGLE_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const CODE_ASSIST_ROOT = 'https://cloudcode-pa.googleapis.com/v1internal';
const CODE_ASSIST_HEADERS = {
  'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'X-Goog-Api-Client': 'gl-node/22.17.0',
  'Client-Metadata': JSON.stringify({
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Gemini request cancelled', 'AbortError');
}

function googleEndpoint(model: string, stream: boolean, codeAssist: boolean): string {
  if (codeAssist) {
    return `${CODE_ASSIST_ROOT}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  return `${GOOGLE_API_ROOT}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
}

export interface GeminiProviderConfig {
  model: string;
  apiMode: 'public' | 'codeAssist';
  auth: 'apiKey' | 'oauth';
  profileId?: string;
  apiKey?: string;
  baseUrl?: string;
  endpointBuilder?: (stream: boolean) => string;
  extraHeaders?: Record<string, string>;
  authStyle?: 'apiKey' | 'bearer';
  capability?: ProviderCapabilitySnapshot;
}

interface GeminiStreamChunk {
  content: string;
  done: boolean;
  reasoning?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
  toolCallCount?: number;
  error?: boolean;
  finishReason?: string;
}

/** Gemini 네이티브 GenerateContent 연결. 공개 API와 Code Assist를 같은 매핑으로 다룬다. */
export class GeminiProvider implements LLMProvider {
  readonly capability: ProviderCapabilitySnapshot;
  private observedModel: string | undefined;

  constructor(private readonly config: GeminiProviderConfig) {
    this.capability =
      config.capability ??
      resolveProviderCapability({
        providerKey: 'gemini',
        model: config.model,
      });
  }

  getObservedModel(): string | undefined {
    return this.observedModel;
  }

  private endpoint(stream: boolean): string {
    return (
      this.config.endpointBuilder?.(stream) ??
      (this.config.baseUrl
        ? buildProviderApiEndpoint(this.config.baseUrl, 'gemini', this.config.model, stream)
        : googleEndpoint(this.config.model, stream, this.config.apiMode === 'codeAssist'))
    );
  }

  private async authHeaders(): Promise<{
    headers: Record<string, string>;
    projectId?: string;
  }> {
    if (this.config.auth === 'oauth') {
      if (!this.config.profileId) throw new Error(t('geminiOAuthRequired'));
      const credentials = await googleGeminiOAuth.credentials(this.config.profileId);
      return {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          ...CODE_ASSIST_HEADERS,
          ...(this.config.extraHeaders ?? {}),
        },
        projectId: credentials.projectId,
      };
    }
    const apiKey = this.config.apiKey?.trim();
    const authStyle = this.config.authStyle ?? 'apiKey';
    return {
      headers: {
        ...(apiKey
          ? authStyle === 'bearer'
            ? { Authorization: `Bearer ${apiKey}` }
            : { 'x-goog-api-key': apiKey }
          : {}),
        ...(this.config.apiMode === 'codeAssist' ? CODE_ASSIST_HEADERS : {}),
        ...(this.config.extraHeaders ?? {}),
      },
    };
  }

  private body(
    messages: ChatMessage[],
    temperature: number,
    tools: ToolDefinition[] | undefined,
    options: ChatOptions | undefined,
    projectId?: string,
  ): Record<string, unknown> {
    const prepared = prepareProviderRequest(
      messages,
      this.capability.toolCalling ? tools : undefined,
      options?.inputBudgetBytes,
    ).messages;
    const request = planGeminiRust<Record<string, unknown>>({
      operation: 'request',
      api: this.config.apiMode === 'codeAssist' ? 'codeAssist' : 'public',
      ...(this.config.apiMode === 'codeAssist' ? { project: projectId } : {}),
      model: this.config.model,
      messages: prepared,
      tools: this.capability.toolCalling ? (tools ?? []) : [],
      toolChoice: this.capability.toolCalling ? (options?.toolChoice ?? 'auto') : 'none',
      temperature,
      ...(options?.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    });
    if (!request) throw new Error(t('geminiResponseInvalid'));
    return request;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string> {
    throwIfAborted(options?.signal);
    const auth = await this.authHeaders();
    const response = await requestUrl({
      url: this.endpoint(false),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(this.body(messages, temperature, tools, options, auth.projectId)),
      throw: false,
    });
    if (response.status >= 400) {
      throw new LLMProviderHttpError(
        `${t('geminiRequestFailed')}: ${response.status} ${response.text}`,
        response.status,
      );
    }
    const result = planGeminiRust<{ content?: string; model?: string; error?: boolean }>({
      operation: 'response',
      text: response.text,
    });
    if (!result || result.error) throw new Error(t('geminiResponseInvalid'));
    this.observedModel = result.model ?? this.observedModel;
    throwIfAborted(options?.signal);
    return result.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal);
    const auth = await this.authHeaders();
    const response = await desktopFetch(this.endpoint(true), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...auth.headers,
      },
      body: JSON.stringify(this.body(messages, temperature, tools, options, auth.projectId)),
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new LLMProviderHttpError(
        `${t('geminiRequestFailed')}: ${response.status} ${await response.text()}`,
        response.status,
        Number(response.headers.get('retry-after')) * 1000 || undefined,
      );
    }
    let nextToolIndex = 0;
    await consumeDesktopStream(
      response,
      'sse',
      (data) => {
        const chunk = planGeminiRust<GeminiStreamChunk>({
          operation: 'stream-event',
          data,
          toolCallIndexBase: nextToolIndex,
        });
        if (!chunk || chunk.error) throw new Error(t('geminiResponseInvalid'));
        nextToolIndex += chunk.toolCallCount ?? 0;
        if (chunk.content || chunk.reasoning || chunk.toolCalls?.length) {
          onChunk({
            content: chunk.content ?? '',
            done: false,
            ...(chunk.reasoning ? { reasoning: chunk.reasoning } : {}),
            ...(chunk.toolCalls?.length ? { toolCalls: chunk.toolCalls } : {}),
          });
        }
        return chunk.done;
      },
      options?.signal,
    );
    onChunk({ content: '', done: true });
  }
}

export function createGeminiApiKeyProvider(
  model: string,
  apiKey: string,
  capability?: ProviderCapabilitySnapshot,
  baseUrl?: string,
): GeminiProvider {
  return new GeminiProvider({
    model,
    apiMode: 'public',
    auth: 'apiKey',
    apiKey,
    baseUrl,
    capability,
  });
}

export function createGeminiOAuthProvider(
  model: string,
  profileId: string,
  capability?: ProviderCapabilitySnapshot,
): GeminiProvider {
  return new GeminiProvider({
    model,
    apiMode: 'codeAssist',
    auth: 'oauth',
    profileId,
    capability,
  });
}

export function createGeminiCompatibleProvider(input: {
  model: string;
  apiKey: string;
  endpointBuilder: (stream: boolean) => string;
  extraHeaders?: Record<string, string>;
  authStyle?: 'apiKey' | 'bearer';
  capability?: ProviderCapabilitySnapshot;
}): GeminiProvider {
  return new GeminiProvider({
    model: input.model,
    apiMode: 'public',
    auth: 'apiKey',
    apiKey: input.apiKey,
    endpointBuilder: input.endpointBuilder,
    extraHeaders: input.extraHeaders,
    authStyle: 'bearer',
    capability: input.capability,
  });
}
