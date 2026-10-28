import type {
  ProviderApiFormat,
  ProviderModelConfig,
  ProviderStrategyKey,
} from '../settings';

export const OPENCODE_DEFAULT_BASE_URL = 'https://opencode.ai/inference';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go';

const API_FORMAT_PRIORITY: Record<ProviderApiFormat, number> = {
  responses: 0,
  chat: 1,
  messages: 2,
  gemini: 3,
};

export function normalizeProviderApiFormat(value: unknown): ProviderApiFormat | undefined {
  return value === 'responses' || value === 'chat' || value === 'messages' || value === 'gemini'
    ? value
    : undefined;
}

/** OpenCode는 보조 요청까지 안정적인 대화 세션 ID를 요구합니다. */
export function buildOpenCodeSessionHeaders(profileId?: string): Record<string, string> {
  const session =
    (profileId ?? 'profile').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'profile';
  return { 'x-opencode-session': `ses_${session}` };
}

/** 모델 목록이 wire 형식을 알려 주는 provider에서만 형식 배지를 표시합니다. */
export function showsProviderModelApiFormat(strategy: ProviderStrategyKey): boolean {
  return strategy === 'opencode' || strategy === 'openAICompatible';
}

/** 붙여 넣은 전체 endpoint의 경로에서 wire 형식을 추론합니다. */
export function inferProviderApiFormatFromBaseUrl(
  baseUrl?: string,
): ProviderApiFormat | undefined {
  const url = baseUrl?.trim().toLowerCase() ?? '';
  if (!url) return undefined;
  if (url.includes('/anthropic/') || url.endsWith('/messages')) return 'messages';
  if (url.includes('/responses')) return 'responses';
  if (url.includes('/google/') || url.includes('/v1beta')) return 'gemini';
  if (url.includes('/chat/completions')) return 'chat';
  return undefined;
}

/**
 * 프로필에서 고른 값이 아니라 provider와 모델이 선언한 정보로 wire 형식을 정합니다.
 * OpenCode 모델 목록에는 형식이 없지만 모든 텍스트 모델을 Responses로 변환합니다.
 */
export function resolveAutomaticProviderApiFormat(
  strategy: ProviderStrategyKey,
  baseUrl: string | undefined,
  model?: Pick<ProviderModelConfig, 'apiFormat' | 'supportedApiFormats'>,
): ProviderApiFormat | undefined {
  if (
    strategy === 'openRouter' ||
    strategy === 'openai' ||
    strategy === 'ollama' ||
    strategy === 'ollamaCloud'
  ) {
    return 'chat';
  }
  if (strategy === 'claude') return 'messages';
  if (strategy === 'gemini') return 'gemini';
  const supported = model?.supportedApiFormats?.filter(
    (format): format is ProviderApiFormat => normalizeProviderApiFormat(format) !== undefined,
  );
  if (supported && supported.length > 0) {
    return [...supported].sort((a, b) => API_FORMAT_PRIORITY[a] - API_FORMAT_PRIORITY[b])[0];
  }
  if (model?.apiFormat) return model.apiFormat;
  if (strategy === 'opencode') return 'responses';
  if (strategy === 'openAICompatible') {
    return inferProviderApiFormatFromBaseUrl(baseUrl) ?? 'chat';
  }
  return undefined;
}

/** 사용자가 붙여 넣은 전체 엔드포인트를 API 루트로 줄입니다. */
export function normalizeProviderApiRoot(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!url) return '';
  for (const suffix of ['/chat/completions', '/responses', '/messages', '/models']) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }
  if (!url) return '';
  if (!url.endsWith('/v1')) url = `${url}/v1`;
  return url.replace(/\/+$/, '');
}

export function normalizeGeminiApiRoot(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!url) return '';
  const modelRoute = url.indexOf('/models/');
  if (modelRoute >= 0) url = url.slice(0, modelRoute);
  for (const suffix of [':generateContent', ':streamGenerateContent']) {
    if (url.endsWith(suffix)) url = url.slice(0, -suffix.length);
  }
  if (!url.endsWith('/v1beta') && !url.endsWith('/v1')) url = `${url}/v1beta`;
  return url.replace(/\/+$/, '');
}

export function buildProviderApiEndpoint(
  baseUrl: string,
  format: ProviderApiFormat,
  model = '',
  stream = false,
): string {
  if (format === 'gemini') {
    const root = normalizeGeminiApiRoot(baseUrl);
    if (!root || !model) return '';
    return `${root}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  const root = normalizeProviderApiRoot(baseUrl);
  if (!root) return '';
  if (format === 'responses') return `${root}/responses`;
  if (format === 'messages') return `${root}/messages`;
  return `${root}/chat/completions`;
}

/** OpenCode Zen/Console base URL을 정규화합니다. Go 플랜의 /go 접미사는 유지합니다. */
export function normalizeOpenCodeBaseUrl(baseUrl?: string): string {
  let url = (baseUrl?.trim() || OPENCODE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!url) return OPENCODE_DEFAULT_BASE_URL;
  // Zen pay-as-you-go and Go/Go Plus are different bases. Older Go clients use `/zen/go/v1`.
  if (url === 'https://opencode.ai/zen/v1' || url.startsWith('https://opencode.ai/zen/v1/')) {
    url = url.replace('https://opencode.ai/zen/v1', OPENCODE_DEFAULT_BASE_URL);
  } else if (
    url === 'https://opencode.ai/zen/go' ||
    url === 'https://opencode.ai/zen/go/v1' ||
    url.startsWith('https://opencode.ai/zen/go/')
  ) {
    url = url.replace(/^https:\/\/opencode\.ai\/zen\/go(?:\/v1)?/, OPENCODE_GO_BASE_URL);
  }
  const geminiRoute = url.indexOf('/google/v1beta');
  if (geminiRoute >= 0) url = url.slice(0, geminiRoute);
  for (const suffix of [
    '/openai/v1/responses',
    '/openai/v1/chat/completions',
    '/openai/v1',
    '/anthropic/v1/messages',
    '/anthropic/v1',
    '/v1/models',
    '/models',
    '/v1',
  ]) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }
  return url || OPENCODE_DEFAULT_BASE_URL;
}

/** OpenCode base URL을 Zen/Console 또는 Go/Go Plus 두 플랜으로만 구분합니다. */
export function resolveOpenCodePlan(baseUrl?: string): 'zen' | 'go' {
  return normalizeOpenCodeBaseUrl(baseUrl) === OPENCODE_GO_BASE_URL ? 'go' : 'zen';
}

export function buildOpenCodeEndpoint(
  baseUrl: string | undefined,
  format: ProviderApiFormat,
  model = '',
  stream = false,
): string {
  const base = normalizeOpenCodeBaseUrl(baseUrl);
  if (format === 'responses') return `${base}/openai/v1/responses`;
  if (format === 'messages') return `${base}/anthropic/v1/messages`;
  if (format === 'gemini' && model) {
    return `${base}/google/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  return `${base}/openai/v1/chat/completions`;
}

export function buildOpenCodeModelsUrl(baseUrl?: string): string {
  return `${normalizeOpenCodeBaseUrl(baseUrl)}/v1/models`;
}

export function providerStrategyUsesEditableBaseUrl(strategy: ProviderStrategyKey): boolean {
  return strategy !== 'openAIChatGPT' && strategy !== 'ternlight' && strategy !== 'opencode';
}

export function isLocalOllamaBaseUrl(baseUrl: string | undefined): boolean {
  const value = baseUrl?.trim();
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}
