import type {
  ProviderApiFormat,
  ProviderModelConfig,
  ProviderStrategyKey,
} from '../settings';

/** 프로바이더가 실제로 보내는 wire 형식입니다. */
export const PROVIDER_API_FORMATS = ['responses', 'chat', 'messages', 'gemini'] as const;

export const OPENCODE_DEFAULT_BASE_URL = 'https://opencode.ai/inference';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go';

const DEFAULT_API_FORMATS: Partial<Record<ProviderStrategyKey, ProviderApiFormat>> = {
  openAIChatGPT: 'responses',
  gemini: 'gemini',
  opencode: 'responses',
  claude: 'messages',
  openai: 'chat',
  openRouter: 'chat',
  openAICompatible: 'chat',
  ollama: 'chat',
  ollamaCloud: 'chat',
};

export function normalizeProviderApiFormat(value: unknown): ProviderApiFormat | undefined {
  return value === 'responses' || value === 'chat' || value === 'messages' || value === 'gemini'
    ? value
    : undefined;
}

export function getDefaultProviderApiFormat(
  strategy: ProviderStrategyKey,
): ProviderApiFormat | undefined {
  return DEFAULT_API_FORMATS[strategy];
}

/** 형식 선택 UI를 노출할 전략인지 확인합니다. */
export function supportsProviderApiFormatSelection(strategy: ProviderStrategyKey): boolean {
  return strategy === 'opencode' || strategy === 'openAICompatible';
}

/**
 * 프로필 기본 형식과 모델이 선언한 지원 형식을 함께 사용합니다.
 * 모델이 지원 목록을 제공하면 사용자가 고른 형식이 그 안에 있을 때만 유지합니다.
 */
export function resolveProviderModelApiFormat(
  profileFormat: ProviderApiFormat | undefined,
  model?: Pick<ProviderModelConfig, 'apiFormat' | 'supportedApiFormats'>,
): ProviderApiFormat | undefined {
  const supported = model?.supportedApiFormats?.filter(
    (format): format is ProviderApiFormat => normalizeProviderApiFormat(format) !== undefined,
  );
  if (supported && supported.length > 0) {
    if (profileFormat && supported.includes(profileFormat)) return profileFormat;
    return supported[0];
  }
  return model?.apiFormat ?? profileFormat;
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
  return strategy !== 'openAIChatGPT' && strategy !== 'ternlight';
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
