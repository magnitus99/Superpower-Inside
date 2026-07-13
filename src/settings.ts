import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  setIcon,
  type EventRef,
  type Events,
} from 'obsidian';
import { validateMcpJson, formatMcpJson } from './utils/mcp-json';
import type { MCPRegistry } from './mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  type MCPConnectionState,
  type MCPServerConnectionStatus,
} from './mcp/connection-state';
import { isMcpStdioAvailable } from './mcp/platform';
import { RefreshAction } from './utils/refresh-action';
import { runActionWithFeedback } from './utils/action-feedback';
import { confirmWithModal } from './utils/modal-prompts';
import type { VectorStore } from './rag/store';
import { isIndexingCancelledError, type IndexingResult } from './rag/indexer';
import type { RAGIndexingScheduler, RagIndexingSchedulerStatus } from './rag/indexing-scheduler';
import type { PerformanceGuardState } from './rag/performance-guard';
import { calculateRagStatus, type RagDocumentUpdate, type RagStatusSummary } from './rag/status';
import type { GraphRagCommunityBuildResult, GraphRagIndexingResult } from './graph/indexing-runner';
import {
  buildEmbeddingModelOptions,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  resolveRagPerformanceSettings,
  resolveProviderReadiness,
  selectInitialEmbeddingModel,
  type RagPerformanceTuningMode,
  shouldRequireProviderApiKey,
  shouldShowProviderApiKey,
  buildGraphRagActionGroups,
  getGraphRagStatusPresentation,
  getGraphRagStatusLabel,
  getGraphRagLiveStatusPresentation,
  getGraphRagControlState,
  getGraphRagIndexingResultNotice,
  estimateGraphRagIndexingCost,
  type GraphRagActionId,
  type GraphRagActionDefinition,
  type GraphRagIndexingResultNoticeScope,
  type ModelCapabilitySnapshot,
  type ModelCapabilityStatus,
  type ProviderValidationSnapshot,
} from './rag/settings-display';
import {
  createDefaultPromptEntry,
  createPromptEntry,
  getActivePromptEntry,
  type PromptLibraryEntry,
} from './chat/prompt-library';
import { openPromptLibraryModal } from './chat/prompt-library-modal';
import {
  isRecommendableExcludeExtension,
  validateExcludeExtensionInput,
  validateExcludePathInput,
  type ExcludeValidationIssue,
  type ExcludeValidationResult,
} from './utils/rag-exclude-validation';
import { countFilesByExtensions, getRagFileTypeSummary } from './utils/vault';
import { type Language, t } from './i18n';
import {
  normalizeProviderCapabilityOverrides,
  type ProviderCapabilityOverrides,
} from './llm/provider-capabilities';
import type { TernlightRuntimeOptions } from './llm/ternlight-runtime';
import {
  createDefaultContext7McpServer,
  shouldShowPluginAwareContext7Warning,
} from './mcp/context7';
import {
  buildSettingsOverviewSnapshot,
  type SettingsOverviewRuntimeState,
} from './settings-overview';
import { type AppLogger, type LoggerConfig } from './utils/logger';
interface StandardMcpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
interface StandardMcpConfig {
  mcpServers: Record<string, StandardMcpServerEntry>;
}
export function internalToStandard(servers: MCPServerConfig[]): StandardMcpConfig {
  const mcpServers: Record<string, StandardMcpServerEntry> = {};
  for (const s of servers) {
    const entry: StandardMcpServerEntry = { command: s.command };
    if (s.args !== undefined && s.args.length > 0) entry.args = s.args;
    if (s.env !== undefined && Object.keys(s.env).length > 0) entry.env = s.env;
    mcpServers[s.name] = entry;
  }
  return { mcpServers };
}
export function buildMcpJsonEditorValue(servers: MCPServerConfig[]): string {
  return JSON.stringify(internalToStandard(servers), null, 2);
}
function standardToInternal(standard: StandardMcpConfig): MCPServerConfig[] {
  const result: MCPServerConfig[] = [];
  for (const [name, cfg] of Object.entries(standard.mcpServers)) {
    result.push({
      name,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
    });
  }
  return result;
}
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
}
export interface CustomOpenAIProviderConfig extends ProviderConfig {
  id: string;
  name: string;
  useRequestUrl?: boolean;
  capabilityOverrides?: ProviderCapabilityOverrides;
}
export const PROVIDER_KEYS = ['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'] as const;
/** 채팅 모델 선택에 표시할 프로바이더 키 (ollama 계열만) */
export const CHAT_PROVIDER_KEYS: readonly ProviderKey[] = PROVIDER_KEYS;
export const PROVIDER_LABELS: Record<(typeof PROVIDER_KEYS)[number], string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  ollama: 'Ollama (Local)',
  ollamaCloud: 'Ollama (Cloud)',
  openRouter: 'OpenRouter',
};
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
export type ProviderStrategyKey = ProviderKey | 'openAICompatible' | 'ternlight';
export type ProviderModelKind = 'general' | 'embedding';
export interface ProviderModelVerification {
  chatStatus: ModelCapabilityStatus;
  embeddingStatus: ModelCapabilityStatus;
  lastCheckedAt?: number;
  lastError?: string;
}
export interface ProviderModelConfig {
  id: string;
  kind: ProviderModelKind;
  verification: ProviderModelVerification;
}
export interface ProviderProfileConfig {
  id: string;
  name: string;
  strategy: ProviderStrategyKey;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  models: ProviderModelConfig[];
  useRequestUrl?: boolean;
  capabilityOverrides?: ProviderCapabilityOverrides;
}
export type ParsedProviderModelRef =
  | {
      kind: 'profile';
      profileId: string;
      modelId: string;
    }
  | {
      kind: 'legacy';
      providerKey: ProviderKey;
      modelId: string;
    }
  | {
      kind: 'legacy-custom-openai';
      providerId: string;
      modelId: string;
    }
  | {
      kind: 'invalid';
      raw: string;
    };

export function buildProviderModelRef(profileId: string, modelId: string): string {
  return `profile:${profileId}:${modelId}`;
}

export function parseProviderModelRef(value: string): ParsedProviderModelRef {
  const raw = value.trim();
  const parts = raw.split(':');
  if (parts[0] === 'profile') {
    const profileId = parts[1] ?? '';
    const modelId = parts.slice(2).join(':');
    if (profileId && modelId) return { kind: 'profile', profileId, modelId };
    return { kind: 'invalid', raw };
  }
  if (parts[0] === 'customOpenAI') {
    const providerId = parts[1] ?? '';
    const modelId = parts.slice(2).join(':');
    if (providerId && modelId) return { kind: 'legacy-custom-openai', providerId, modelId };
    return { kind: 'invalid', raw };
  }
  if (PROVIDER_KEYS.includes(parts[0] as ProviderKey)) {
    const modelId = parts.slice(1).join(':');
    if (modelId) return { kind: 'legacy', providerKey: parts[0] as ProviderKey, modelId };
  }
  return { kind: 'invalid', raw };
}

export function upsertProviderProfileModel(
  models: readonly ProviderModelConfig[],
  candidate: ProviderModelConfig,
): ProviderModelConfig[] {
  const id = candidate.id.trim();
  if (!id) return [...models];
  const existing = models.find((model) => model.id === id);
  const kind: ProviderModelKind =
    existing?.kind === 'embedding' || candidate.kind === 'embedding' ? 'embedding' : 'general';
  const merged: ProviderModelConfig = {
    id,
    kind,
    verification: {
      chatStatus:
        candidate.verification.chatStatus ?? existing?.verification.chatStatus ?? 'unknown',
      embeddingStatus:
        candidate.verification.embeddingStatus ??
        existing?.verification.embeddingStatus ??
        'unknown',
      ...(candidate.verification.lastCheckedAt !== undefined
        ? { lastCheckedAt: candidate.verification.lastCheckedAt }
        : existing?.verification.lastCheckedAt !== undefined
          ? { lastCheckedAt: existing.verification.lastCheckedAt }
          : {}),
      ...(candidate.verification.lastError
        ? { lastError: candidate.verification.lastError }
        : existing?.verification.lastError
          ? { lastError: existing.verification.lastError }
          : {}),
    },
  };
  return [...models.filter((model) => model.id !== id), merged];
}

function createProviderModel(
  id: string,
  kind: ProviderModelKind,
  verification: Partial<ProviderModelVerification> = {},
): ProviderModelConfig {
  return {
    id,
    kind,
    verification: {
      chatStatus: verification.chatStatus ?? 'unknown',
      embeddingStatus: verification.embeddingStatus ?? 'unknown',
      ...(verification.lastCheckedAt !== undefined
        ? { lastCheckedAt: verification.lastCheckedAt }
        : {}),
      ...(verification.lastError ? { lastError: verification.lastError } : {}),
    },
  };
}

export const PROVIDER_STRATEGY_LABELS: Record<ProviderStrategyKey, string> = {
  ...PROVIDER_LABELS,
  openAICompatible: 'OpenAI-Compatible',
  ternlight: 'Ternlight (Local)',
};

const LEGACY_PROFILE_IDS: Record<ProviderKey, string> = {
  openai: 'openai',
  claude: 'claude',
  ollama: 'ollama',
  ollamaCloud: 'ollama-cloud',
  openRouter: 'openrouter',
};
const TERNLIGHT_PROFILE_ID = 'ternlight';
const TERNLIGHT_MODEL_ID = 'ternlight-base';
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export type BuiltInEmbeddingProviderKey =
  | 'ternlight'
  | 'openai'
  | 'ollama'
  | 'openRouter'
  | 'other';
export type CustomOpenAIEmbeddingProviderKey = `customOpenAI:${string}`;
export type EmbeddingProviderKey = BuiltInEmbeddingProviderKey | CustomOpenAIEmbeddingProviderKey;
export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimensions: number;
  description: string;
}
export function buildEmbeddingModels(): Record<BuiltInEmbeddingProviderKey, EmbeddingModelInfo[]> {
  return {
    ternlight: [
      {
        id: 'ternlight-base',
        name: '@ternlight/base',
        dimensions: 384,
        description: t('settingsAuto006'),
      },
    ],
    openai: [
      {
        id: 'text-embedding-3-small',
        name: 'text-embedding-3-small',
        dimensions: 1536,
        description: t('settingsAuto001'),
      },
      {
        id: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        dimensions: 3072,
        description: t('settingsAuto002'),
      },
    ],
    openRouter: [
      {
        id: 'openai/text-embedding-3-small',
        name: 'OpenAI text-embedding-3-small (via OpenRouter)',
        dimensions: 1536,
        description: t('settingsAuto003'),
      },
      {
        id: 'baai/bge-m3',
        name: 'BAAI bge-m3',
        dimensions: 1024,
        description: t('settingsAuto004'),
      },
      {
        id: 'qwen/qwen3-embedding-8b',
        name: 'Qwen3 Embedding 8B',
        dimensions: 1024,
        description: t('settingsAuto005'),
      },
    ],
    ollama: [],
    other: [],
  };
}
export const EMBEDDING_PROVIDER_LABELS: Record<BuiltInEmbeddingProviderKey, string> = {
  ternlight: 'Ternlight (Local)',
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  openRouter: 'OpenRouter',
  other: 'Other (Custom)',
};
export interface EmbeddingProviderOption {
  value: EmbeddingProviderKey;
  label: string;
}
export function isCustomOpenAIEmbeddingProviderKey(
  providerKey: string,
): providerKey is CustomOpenAIEmbeddingProviderKey {
  return providerKey.startsWith('customOpenAI:') && providerKey.length > 'customOpenAI:'.length;
}
export function getCustomOpenAIEmbeddingProviderId(
  providerKey: CustomOpenAIEmbeddingProviderKey,
): string {
  return providerKey.slice('customOpenAI:'.length);
}
export function buildEmbeddingProviderOptions(
  customProviders: readonly CustomOpenAIProviderConfig[],
): EmbeddingProviderOption[] {
  const options: EmbeddingProviderOption[] = Object.entries(EMBEDDING_PROVIDER_LABELS).map(
    ([value, label]) => ({
      value: value as BuiltInEmbeddingProviderKey,
      label,
    }),
  );
  for (const provider of customProviders) {
    if (!provider.enabled || !provider.baseUrl?.trim()) continue;
    options.push({
      value: `customOpenAI:${provider.id}`,
      label: provider.name.trim() || 'Custom OpenAI-Compatible',
    });
  }
  return options;
}
export interface RAGConfig {
  excludePaths: string[];
  excludeExts: string[];
  excludeChatFolder: boolean;
  chunkSize: number;
  overlap: number;
  embeddingProvider: EmbeddingProviderKey;
  embeddingModel: string;
  embeddingModelRef?: string;
  autoUpdateEnabled: boolean;
  autoUpdateIntervalMin: number;
  minScore: number;
  enableBM25: boolean;
  bm25Weight: number;
  performanceTuningMode: RagPerformanceTuningMode;
  performanceGuardEnabled: boolean;
  maxEmbeddingBatchSize: number;
  indexingYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
  structuralGraphEnabled: boolean;
  graphRagEnabled: boolean;
  graphRagModel: string;
  graphRagMaxFilesPerRun: number;
  graphRagMaxConcurrentRequests: number;
  graphRagQueryMode: 'auto' | 'local' | 'global' | 'hybrid';
  graphRagAutoSyncEnabled: boolean;
  graphRagAutoSyncIntervalMin: number;
  entityAutoMergeThreshold: number;
  entityPendingMergeThreshold: number;
  annEnabled: boolean;
  annClusterCount: number;
  annProbeCount: number;
}
export interface ChatConfig {
  saveFolder: string;
  defaultModel: string;
  systemPrompt?: string;
  promptLibrary: PromptLibraryEntry[];
  activePromptId?: string;
  mcpToolExecutionPolicy: 'mentioned-auto' | 'always-manual' | 'always-auto';
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  enforceMcpTools: boolean;
}
export const DEFAULT_CHAT_SAVE_FOLDER = 'SuperpowerInsideChats';
export function normalizeChatSaveFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value;
}
export interface AgentDiagnosticsSettings {
  enabled: boolean;
}
export function normalizeAgentDiagnosticsSettings(value: unknown): AgentDiagnosticsSettings {
  const raw =
    typeof value === 'object' && value !== null
      ? (value as Partial<AgentDiagnosticsSettings>)
      : undefined;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : false,
  };
}
export interface SuperpowerInsideSettings {
  openai: ProviderConfig;
  claude: ProviderConfig;
  ollama: ProviderConfig;
  ollamaCloud: ProviderConfig;
  openRouter: ProviderConfig;
  customOpenAIProviders: CustomOpenAIProviderConfig[];
  providerProfiles: ProviderProfileConfig[];
  providerValidation: Record<string, ProviderValidationSnapshot>;
  rag: RAGConfig;
  mcpServers: MCPServerConfig[];
  mcpPath: string;
  mcpIncludeWslPath: boolean;
  chat: ChatConfig;
  pluginAwareEnabled: boolean;
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  language: Language;
  logging: LoggerConfig;
  agentDiagnostics: AgentDiagnosticsSettings;
}
export const DEFAULT_SETTINGS: SuperpowerInsideSettings = {
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o-mini'],
    enabled: false,
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet-20241022'],
    enabled: false,
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    models: ['llama3.1'],
    enabled: false,
  },
  ollamaCloud: {
    apiKey: '',
    baseUrl: 'https://ollama.com',
    models: ['llama3.1'],
    enabled: false,
  },
  openRouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    models: ['openrouter/auto'],
    enabled: false,
  },
  customOpenAIProviders: [],
  providerProfiles: [],
  providerValidation: {},
  rag: {
    excludePaths: ['.git', 'node_modules', 'attachments'],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    excludeChatFolder: true,
    chunkSize: 1000,
    overlap: 100,
    embeddingProvider: 'ternlight',
    embeddingModel: 'ternlight-base',
    embeddingModelRef: '',
    autoUpdateEnabled: false,
    autoUpdateIntervalMin: 5,
    minScore: 0.5,
    enableBM25: true,
    bm25Weight: 0.3,
    performanceTuningMode: 'auto',
    performanceGuardEnabled: true,
    maxEmbeddingBatchSize: 32,
    indexingYieldMs: 25,
    slowEventLoopThresholdMs: 150,
    slowBatchThresholdMs: 3000,
    structuralGraphEnabled: true,
    graphRagEnabled: false,
    graphRagModel: '',
    graphRagMaxFilesPerRun: 50,
    graphRagMaxConcurrentRequests: 1,
    graphRagQueryMode: 'auto',
    graphRagAutoSyncEnabled: false,
    graphRagAutoSyncIntervalMin: 30,
    entityAutoMergeThreshold: 0.85,
    entityPendingMergeThreshold: 0.7,
    annEnabled: true,
    annClusterCount: 0,
    annProbeCount: 4,
  },
  mcpServers: [createDefaultContext7McpServer()],
  mcpPath: '',
  mcpIncludeWslPath: false,
  chat: {
    saveFolder: DEFAULT_CHAT_SAVE_FOLDER,
    defaultModel: '',
    systemPrompt: '',
    promptLibrary: [createDefaultPromptEntry()],
    activePromptId: 'default-obsidian-knowledge-work',
    mcpToolExecutionPolicy: 'mentioned-auto',
    autoSaveEnabled: true,
    autoSaveDebounceMs: 3000,
    enforceMcpTools: true,
  },
  pluginAwareEnabled: false,
  autoSaveEnabled: true,
  autoSaveDebounceMs: 1000,
  language: 'ko',
  logging: {
    minLevel: 'info',
    maxEntries: 1000,
    mirrorToConsole: true,
  },
  agentDiagnostics: {
    enabled: false,
  },
};

function sameStringList(left: readonly string[] = [], right: readonly string[] = []): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b, 'en'));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b, 'en'));
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function hasLegacyProviderTrace(key: ProviderKey, config: ProviderConfig): boolean {
  const defaults = DEFAULT_SETTINGS[key];
  return (
    config.enabled ||
    config.apiKey.trim().length > 0 ||
    (config.baseUrl ?? '') !== (defaults.baseUrl ?? '') ||
    !sameStringList(config.models, defaults.models)
  );
}

function normalizeProviderProfileModel(value: unknown): ProviderModelConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) return null;
  const kind: ProviderModelKind = source.kind === 'embedding' ? 'embedding' : 'general';
  const verificationSource =
    typeof source.verification === 'object' &&
    source.verification !== null &&
    !Array.isArray(source.verification)
      ? (source.verification as Partial<ProviderModelVerification>)
      : {};
  return createProviderModel(id, kind, verificationSource);
}

function normalizeProviderProfile(
  value: unknown,
  fallbackIndex: number,
): ProviderProfileConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id =
    typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : `profile-${fallbackIndex + 1}`;
  const strategy = PROVIDER_KEYS.includes(source.strategy as ProviderKey)
    ? (source.strategy as ProviderKey)
    : source.strategy === 'openAICompatible'
      ? 'openAICompatible'
      : source.strategy === 'ternlight'
        ? 'ternlight'
      : null;
  if (!strategy) return null;
  const rawModels = Array.isArray(source.models) ? source.models : [];
  const models = rawModels.reduce<ProviderModelConfig[]>((acc, model) => {
    const normalized = normalizeProviderProfileModel(model);
    return normalized ? upsertProviderProfileModel(acc, normalized) : acc;
  }, []);
  const capabilityOverrides = normalizeProviderCapabilityOverrides(source.capabilityOverrides);
  return {
    id,
    name:
      typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : PROVIDER_STRATEGY_LABELS[strategy],
    strategy,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl.trim() : undefined,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : false,
    models,
    ...(typeof source.useRequestUrl === 'boolean' ? { useRequestUrl: source.useRequestUrl } : {}),
    ...(capabilityOverrides ? { capabilityOverrides } : {}),
  };
}

function legacyProfileIdForCustomOpenAI(
  provider: Pick<CustomOpenAIProviderConfig, 'id'>,
  existingIds: ReadonlySet<string>,
): string {
  if (!existingIds.has(provider.id)) return provider.id;
  return `custom-${provider.id}`;
}

function ensureTernlightProviderProfile(profiles: ProviderProfileConfig[]): string {
  const existingIndex = profiles.findIndex((profile) => profile.strategy === 'ternlight');
  const model = createProviderModel(TERNLIGHT_MODEL_ID, 'embedding', {
    embeddingStatus: 'success',
  });
  if (existingIndex >= 0) {
    const existing = profiles[existingIndex];
    profiles[existingIndex] = {
      ...existing,
      name: 'Ternlight',
      strategy: 'ternlight',
      apiKey: '',
      baseUrl: '',
      enabled: true,
      models: upsertProviderProfileModel(existing.models, model),
    };
    return existing.id;
  }

  const existingIds = new Set(profiles.map((profile) => profile.id));
  let profileId = TERNLIGHT_PROFILE_ID;
  let suffix = 2;
  while (existingIds.has(profileId)) {
    profileId = `${TERNLIGHT_PROFILE_ID}-${suffix}`;
    suffix += 1;
  }
  profiles.push({
    id: profileId,
    name: 'Ternlight',
    strategy: 'ternlight',
    apiKey: '',
    baseUrl: '',
    enabled: true,
    models: [model],
  });
  return profileId;
}

function findProfileForParsedRef(
  profiles: readonly ProviderProfileConfig[],
  parsed: ParsedProviderModelRef,
): ProviderProfileConfig | undefined {
  if (parsed.kind === 'profile') {
    return profiles.find((profile) => profile.id === parsed.profileId);
  }
  if (parsed.kind === 'legacy') {
    const profileId = LEGACY_PROFILE_IDS[parsed.providerKey];
    return profiles.find((profile) => profile.id === profileId);
  }
  if (parsed.kind === 'legacy-custom-openai') {
    return profiles.find(
      (profile) =>
        profile.id === parsed.providerId ||
        (profile.id === `custom-${parsed.providerId}` && profile.strategy === 'openAICompatible'),
    );
  }
  return undefined;
}

function migrateModelRef(
  profiles: readonly ProviderProfileConfig[],
  value: string,
  requiredKind: ProviderModelKind,
): string {
  const parsed = parseProviderModelRef(value);
  const profile = findProfileForParsedRef(profiles, parsed);
  const modelId =
    parsed.kind === 'profile' || parsed.kind === 'legacy' || parsed.kind === 'legacy-custom-openai'
      ? parsed.modelId
      : '';
  if (!profile || !modelId) return '';
  const model = profile.models.find((item) => item.id === modelId);
  if (!model || model.kind !== requiredKind) return '';
  return buildProviderModelRef(profile.id, modelId);
}

export interface ResolvedProviderModelRef {
  profile: ProviderProfileConfig;
  model: ProviderModelConfig;
  modelId: string;
}

export function resolveProviderModelRef(
  settings: SuperpowerInsideSettings,
  value: string,
  requiredKind: ProviderModelKind,
): ResolvedProviderModelRef | null {
  const parsed = parseProviderModelRef(value);
  const profile = findProfileForParsedRef(settings.providerProfiles, parsed);
  const modelId =
    parsed.kind === 'profile' || parsed.kind === 'legacy' || parsed.kind === 'legacy-custom-openai'
      ? parsed.modelId
      : '';
  if (!profile || !modelId) return null;
  const model = profile.models.find((item) => item.id === modelId);
  if (!model || model.kind !== requiredKind) return null;
  return { profile, model, modelId };
}

export function migrateLegacyProviderProfiles(
  settings: SuperpowerInsideSettings,
): SuperpowerInsideSettings {
  const normalizedProfiles =
    settings.providerProfiles.length > 0
      ? settings.providerProfiles.reduce<ProviderProfileConfig[]>((acc, profile, index) => {
          const normalized = normalizeProviderProfile(profile, index);
          return normalized ? [...acc, normalized] : acc;
        }, [])
      : [];

  const profiles = normalizedProfiles;
  if (profiles.length === 0) {
    const embeddingProvider = settings.rag.embeddingProvider;
    const embeddingModel = settings.rag.embeddingModel.trim();
    const embeddingSelectionChanged =
      embeddingProvider !== DEFAULT_SETTINGS.rag.embeddingProvider ||
      embeddingModel !== DEFAULT_SETTINGS.rag.embeddingModel;
    const legacyRefs = [settings.chat.defaultModel, settings.rag.graphRagModel]
      .map((value) => parseProviderModelRef(value))
      .filter((parsed): parsed is Exclude<ParsedProviderModelRef, { kind: 'invalid' }> => {
        return parsed.kind !== 'invalid';
      });

    const existingIds = new Set<string>();
    for (const key of PROVIDER_KEYS) {
      const config = settings[key];
      const profileId = LEGACY_PROFILE_IDS[key];
      const hasProviderTrace = hasLegacyProviderTrace(key, config);
      const referenced = legacyRefs.some((ref) => ref.kind === 'legacy' && ref.providerKey === key);
      const isEmbeddingProvider =
        embeddingProvider === key &&
        embeddingModel.length > 0 &&
        (hasProviderTrace || embeddingSelectionChanged);
      if (!hasProviderTrace && !referenced && !isEmbeddingProvider) continue;
      existingIds.add(profileId);
      let models = config.models.reduce<ProviderModelConfig[]>((acc, model) => {
        if (!model.trim()) return acc;
        const kind: ProviderModelKind =
          isEmbeddingProvider && model === embeddingModel ? 'embedding' : 'general';
        return upsertProviderProfileModel(
          acc,
          createProviderModel(model, kind, {
            chatStatus: kind === 'general' ? 'unknown' : 'unknown',
            embeddingStatus: kind === 'embedding' ? 'success' : 'unknown',
          }),
        );
      }, []);
      if (isEmbeddingProvider && !models.some((model) => model.id === embeddingModel)) {
        models = upsertProviderProfileModel(
          models,
          createProviderModel(embeddingModel, 'embedding', { embeddingStatus: 'success' }),
        );
      }
      profiles.push({
        id: profileId,
        name: PROVIDER_LABELS[key],
        strategy: key,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        enabled: config.enabled,
        models,
      });
    }

    for (const provider of settings.customOpenAIProviders) {
      const profileId = legacyProfileIdForCustomOpenAI(provider, existingIds);
      existingIds.add(profileId);
      const embeddingKey = `customOpenAI:${provider.id}`;
      const isEmbeddingProvider = embeddingProvider === embeddingKey && embeddingModel.length > 0;
      let models = provider.models.reduce<ProviderModelConfig[]>((acc, model) => {
        if (!model.trim()) return acc;
        const kind: ProviderModelKind =
          isEmbeddingProvider && model === embeddingModel ? 'embedding' : 'general';
        return upsertProviderProfileModel(
          acc,
          createProviderModel(model, kind, {
            embeddingStatus: kind === 'embedding' ? 'success' : 'unknown',
          }),
        );
      }, []);
      if (isEmbeddingProvider && !models.some((model) => model.id === embeddingModel)) {
        models = upsertProviderProfileModel(
          models,
          createProviderModel(embeddingModel, 'embedding', { embeddingStatus: 'success' }),
        );
      }
      profiles.push({
        id: profileId,
        name: provider.name.trim() || 'OpenAI-Compatible',
        strategy: 'openAICompatible',
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        models,
        useRequestUrl: provider.useRequestUrl ?? true,
        ...(provider.capabilityOverrides
          ? { capabilityOverrides: provider.capabilityOverrides }
          : {}),
      });
    }
  }

  const ternlightProfileId = ensureTernlightProviderProfile(profiles);
  const currentEmbeddingModelRef = migrateModelRef(
    profiles,
    settings.rag.embeddingModelRef?.trim() ?? '',
    'embedding',
  );

  const nextRag = {
    ...settings.rag,
    embeddingModelRef:
      currentEmbeddingModelRef ||
      migrateModelRef(
        profiles,
        settings.rag.embeddingProvider === 'other'
          ? ''
          : settings.rag.embeddingProvider === 'ternlight'
            ? buildProviderModelRef(ternlightProfileId, settings.rag.embeddingModel)
            : `${settings.rag.embeddingProvider}:${settings.rag.embeddingModel}`,
        'embedding',
      ),
  };
  const nextChat = {
    ...settings.chat,
    defaultModel: migrateModelRef(profiles, settings.chat.defaultModel, 'general'),
  };

  return {
    ...settings,
    providerProfiles: profiles,
    rag: nextRag,
    chat: nextChat,
  };
}

export interface PluginLike {
  app: App;
  manifest?: { id?: string; version?: string };
  settings: SuperpowerInsideSettings;
  graphRagStatus: import('./graph/status').GraphRagStatusSummary | null;
  knowledgeGraphStore: import('./graph/store').KnowledgeGraphStore | null;
  vectorStore: import('./rag/store').VectorStore | null;
  getRagRuntimeState(): {
    ragStatus: RagStatusSummary | null;
    graphRagStatus: import('./graph/status').GraphRagStatusSummary | null;
    vectorStore: VectorStore | null;
    embeddingProvider: { clearCache(): Promise<void> } | null;
    ragIndexingScheduler: RAGIndexingScheduler | null;
    ragIndexingStatus: RagIndexingSchedulerStatus | null;
    hasIndexer: boolean;
    nextAutoUpdateAt: number | null;
    lastAutoUpdateSkippedReason: string | null;
    lastAutoUpdateResult: IndexingResult | null;
    lastInitError: string | null;
    lastInitSkippedReason: string | null;
  };
  saveSettings(options?: { reinitRag?: boolean; reinitMcp?: boolean }): Promise<{
    success: boolean;
    mcpErrors?: string[];
  }>;
  saveSettingsLight(): Promise<void>;
  reconnectMCP(): Promise<string[]>;
  setupAutoUpdate(): void;
  isGraphRagIndexing(): boolean;
  cancelGraphRagIndexing(): void;
  runGraphRagIndexing(): Promise<GraphRagIndexingResult | null>;
  resumeGraphRagIndexing(): Promise<GraphRagIndexingResult | null>;
  syncStaleGraphRag(): Promise<GraphRagIndexingResult | null>;
  buildGraphRagCommunities(): Promise<GraphRagCommunityBuildResult | null>;
  resetGraphRagData(): Promise<void>;
  resetPluginData(): Promise<void>;
  hasGraphRagRunner(): boolean;
  openGraphRagView(): void;
  openAgentDiagnosticsView(): void;
  getAgentDiagnosticsFilePath(): string;
  getAgentDiagnosticsEventLogPath(): string;
  getAgentDiagnosticsSafeModeFilePath(): string;
  writeAgentDiagnosticsSnapshot(reason: string): Promise<void>;
  clearAgentDiagnosticsDetailedLogging(): Promise<void>;
  enableAgentDiagnosticsSafeMode(): Promise<void>;
  eventDrivenRagStats: import('./rag/status').RagStatusSummary | null;
  initRAG(): Promise<void>;
  ensureRagRuntimeInitialized(): Promise<boolean>;
  prepareRagForChat(): Promise<boolean>;
  isRagIndexing(): boolean;
  cancelRagIndexing(): void;
  runRagIndexing<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null>;
  resumeRagIndexing(): void;
  getRagPerformanceGuardState(): PerformanceGuardState | null;
  createIndexedDbName(kind: string): string;
  mcpRegistry: MCPRegistry | null;
  mcpConnectionState?: MCPConnectionState;
  mcpLastErrors?: string[];
  nextAutoUpdateAt?: number | null;
  lastAutoUpdateSkippedReason?: string | null;
  lastAutoUpdateResult?: IndexingResult | null;
  refreshBus: import('./utils/refresh-bus').RefreshBus;
  logger: AppLogger;
}
// 탭 타입 및 설정
type SettingsTabId = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced';
export function buildSettingsTabs(): {
  id: SettingsTabId;
  label: string;
}[] {
  return [
    { id: 'general', label: t('tabGeneral') },
    { id: 'providers', label: t('tabProviders') },
    { id: 'rag', label: t('tabRag') },
    { id: 'chat', label: t('tabChat') },
    { id: 'mcp', label: t('tabMcp') },
    { id: 'advanced', label: t('tabAdvanced') },
  ];
}
interface ProviderValidationCache {
  [key: string]: {
    valid: boolean;
    models: string[];
    error?: string;
  };
}
interface SettingsSaveOptions {
  reinitRag: boolean;
  reinitMcp: boolean;
}
type ProviderSettingsTarget =
  | {
      kind: 'fixed';
      key: ProviderKey;
      label: string;
      config: ProviderConfig;
    }
  | {
      kind: 'custom';
      key: string;
      label: string;
      config: CustomOpenAIProviderConfig;
    };
type ProviderVisualTone = 'ready' | 'needs-key' | 'needs-models' | 'disabled';
interface ProviderVisualState {
  tone: ProviderVisualTone;
  iconName: string;
  statusLabel: string;
  summary: string;
  keyLabel: string;
  modelLabel: string;
  typeLabel: string;
}
const HIDDEN_CLASS = 'superpower-inside-hidden';

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.toggleClass(HIDDEN_CLASS, hidden);
}

function createProviderValidationFingerprint(
  config: ProviderConfig | CustomOpenAIProviderConfig,
): string {
  return JSON.stringify({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? '',
    enabled: config.enabled,
    models: [...config.models].sort((a, b) => a.localeCompare(b, 'en')),
    useRequestUrl:
      'useRequestUrl' in config && typeof config.useRequestUrl === 'boolean'
        ? config.useRequestUrl
        : undefined,
  });
}

function getFreshProviderValidation(
  state: Record<string, ProviderValidationSnapshot>,
  providerKey: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): ProviderValidationSnapshot | undefined {
  const validation = state[providerKey];
  if (!validation) return undefined;
  if (validation.providerFingerprint !== createProviderValidationFingerprint(config)) {
    return undefined;
  }
  return validation;
}

function mergeModelCapability(
  current: ModelCapabilitySnapshot | undefined,
  patch: Partial<ModelCapabilitySnapshot>,
  checkedAt: number,
): ModelCapabilitySnapshot {
  return {
    chatStatus: current?.chatStatus ?? 'unknown',
    embeddingStatus: current?.embeddingStatus ?? 'unknown',
    ...patch,
    lastCheckedAt: checkedAt,
  };
}

function createLightSaveOptions(): SettingsSaveOptions {
  return { reinitRag: false, reinitMcp: false };
}

function normalizeSaveOptions(options: Partial<SettingsSaveOptions>): SettingsSaveOptions {
  return {
    reinitRag: options.reinitRag ?? false,
    reinitMcp: options.reinitMcp ?? false,
  };
}

function mergeSaveOptions(
  current: SettingsSaveOptions,
  next: SettingsSaveOptions,
): SettingsSaveOptions {
  return {
    reinitRag: current.reinitRag || next.reinitRag,
    reinitMcp: current.reinitMcp || next.reinitMcp,
  };
}

interface ProviderModelImportCandidate {
  id: string;
  name?: string;
  contextLength?: number;
}

class ProviderModelImportModal extends Modal {
  private readonly candidates: ProviderModelImportCandidate[];
  private readonly existingIds: ReadonlySet<string>;
  private readonly selectedIds = new Set<string>();
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private addButton: HTMLButtonElement | null = null;
  private query = '';

  constructor(
    app: App,
    options: {
      providerName: string;
      candidates: readonly ProviderModelImportCandidate[];
      existingIds: ReadonlySet<string>;
      onSubmit: (modelIds: string[]) => void;
    },
  ) {
    super(app);
    this.candidates = [...options.candidates]
      .filter((model) => model.id.trim() && !options.existingIds.has(model.id))
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    this.existingIds = options.existingIds;
    this.onSubmit = options.onSubmit;
    this.providerName = options.providerName;
  }

  private readonly providerName: string;
  private readonly onSubmit: (modelIds: string[]) => void;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('superpower-inside-provider-import-modal');
    contentEl.createDiv({
      cls: 'superpower-inside-provider-import-title',
      text: t('providerImportModelsTitle'),
    });
    contentEl.createDiv({
      cls: 'superpower-inside-provider-import-desc',
      text: t('providerImportModelsDesc', { v0: this.providerName }),
    });

    const searchRow = contentEl.createDiv({ cls: 'superpower-inside-provider-import-search-row' });
    const searchInput = searchRow.createEl('input', {
      cls: 'superpower-inside-provider-import-search',
      attr: { type: 'text', placeholder: t('providerImportSearchPlaceholder') },
    });
    this.countEl = searchRow.createDiv({ cls: 'superpower-inside-provider-import-count' });
    searchInput.addEventListener('input', () => {
      this.query = searchInput.value.trim().toLowerCase();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: 'superpower-inside-provider-import-list' });
    const footer = contentEl.createDiv({ cls: 'superpower-inside-provider-import-footer' });
    const cancelButton = footer.createEl('button', {
      text: t('cancel'),
      attr: { type: 'button' },
    });
    cancelButton.addEventListener('click', () => this.close());
    this.addButton = footer.createEl('button', {
      cls: 'mod-cta',
      text: t('providerImportAddSelected'),
      attr: { type: 'button' },
    });
    this.addButton.addEventListener('click', () => {
      if (this.selectedIds.size === 0) return;
      this.onSubmit([...this.selectedIds]);
      this.close();
    });

    this.renderList();
    searchInput.focus();
  }

  private renderList(): void {
    if (!this.listEl || !this.countEl) return;
    this.listEl.empty();
    const filtered = this.candidates.filter((model) => {
      if (!this.query) return true;
      return (
        model.id.toLowerCase().includes(this.query) ||
        (model.name?.toLowerCase().includes(this.query) ?? false)
      );
    });
    const visible = filtered.slice(0, 150);
    this.countEl.setText(
      t('providerImportCount', {
        v0: String(this.selectedIds.size),
        v1: String(filtered.length),
      }),
    );
    if (this.addButton) {
      this.addButton.disabled = this.selectedIds.size === 0;
    }
    if (this.candidates.length === 0) {
      this.listEl.createDiv({
        cls: 'superpower-inside-provider-import-empty',
        text: t('providerImportNoNewModels'),
      });
      return;
    }
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'superpower-inside-provider-import-empty',
        text: t('providerImportNoMatches'),
      });
      return;
    }
    for (const model of visible) {
      const row = this.listEl.createEl('label', {
        cls: 'superpower-inside-provider-import-row',
      });
      const checkbox = row.createEl('input', {
        attr: { type: 'checkbox' },
      });
      checkbox.checked = this.selectedIds.has(model.id);
      checkbox.disabled = this.existingIds.has(model.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedIds.add(model.id);
        } else {
          this.selectedIds.delete(model.id);
        }
        this.renderList();
      });
      const copy = row.createSpan({ cls: 'superpower-inside-provider-import-row-copy' });
      copy.createSpan({ cls: 'superpower-inside-provider-import-model-id', text: model.id });
      const metaParts = [
        model.name && model.name !== model.id ? model.name : '',
        model.contextLength ? t('providerImportContext', { v0: String(model.contextLength) }) : '',
      ].filter(Boolean);
      if (metaParts.length > 0) {
        copy.createSpan({
          cls: 'superpower-inside-provider-import-model-meta',
          text: metaParts.join(' / '),
        });
      }
    }
    if (filtered.length > visible.length) {
      this.listEl.createDiv({
        cls: 'superpower-inside-provider-import-empty',
        text: t('providerImportMoreResults', { v0: String(filtered.length - visible.length) }),
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SuperpowerInsideSettingTab extends PluginSettingTab {
  private plugin: PluginLike;
  private mcpStatusEventRef: EventRef | null = null;
  private activeTab: SettingsTabId = 'general';
  private tabButtons: Map<SettingsTabId, HTMLButtonElement> = new Map();
  private tabPanels: Map<SettingsTabId, HTMLDivElement> = new Map();
  private builtTabPanelIds: Set<SettingsTabId> = new Set();
  private validationCache: ProviderValidationCache = {};
  private saveTimeout: number | null = null;
  private pendingSave = false;
  private pendingSaveOptions: SettingsSaveOptions = createLightSaveOptions();
  private pendingEmbeddingProvider: EmbeddingProviderKey | null = null;
  private pendingEmbeddingModel: string | null = null;
  private isRebuildingEmbeddingSection = false;
  private defaultModelDropdownEl: HTMLSelectElement | null = null;
  private generalStatusBody: HTMLElement | null = null;
  // RefreshAction 인스턴스 (생명주기 == 탭 활성화 기간)
  private mcpStatusRefresh: RefreshAction | null = null;
  private excludeCountRenderer: (() => void) | null = null;
  // RAG 상태 패널의 DOM 참조 (부분 업데이트용)
  private ragStatusGrid: HTMLElement | null = null;
  private ragStatusTimestamp: HTMLElement | null = null;
  private ragStatusAction: HTMLElement | null = null;
  private ragStatusDetails: HTMLElement | null = null;
  private ragControlsHint: HTMLElement | null = null;
  private updatePendingButton: HTMLButtonElement | null = null;
  private reindexAllButton: HTMLButtonElement | null = null;
  private cancelIndexingButton: HTMLButtonElement | null = null;
  private resumeIndexingButton: HTMLButtonElement | null = null;
  // GraphRAG 상태 패널의 DOM 참조 (부분 업데이트용)
  private graphRagSummaryBanner: HTMLElement | null = null;
  private graphRagStatusGrid: HTMLElement | null = null;
  private graphRagActionsGroup: HTMLElement | null = null;
  private graphRagSectionContainer: HTMLElement | null = null;
  private graphRagOverviewContainer: HTMLElement | null = null;
  private graphRagProgressBanner: HTMLElement | null = null;
  private graphRagModelSelectEl: HTMLSelectElement | null = null;
  // RefreshBus 구독 해제 함수들
  private refreshBusUnsubscribers: (() => void)[] = [];
  private expandedProviderProfileId: string | null = null;
  constructor(app: App, plugin: PluginLike) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }
  debouncedSave(options: Partial<SettingsSaveOptions> = {}): void {
    this.pendingSaveOptions = mergeSaveOptions(
      this.pendingSaveOptions,
      normalizeSaveOptions(options),
    );
    if (!this.plugin.settings.autoSaveEnabled) {
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
      return;
    }
    this.pendingSave = true;
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      this.pendingSave = false;
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
    }, this.plugin.settings.autoSaveDebounceMs);
  }
  private debouncedRagSave(): void {
    this.debouncedSave({ reinitRag: true });
  }
  flushSave(): void {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.pendingSave) {
      this.pendingSave = false;
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
    }
  }
  private consumePendingSaveOptions(): SettingsSaveOptions {
    const options = this.pendingSaveOptions;
    this.pendingSaveOptions = createLightSaveOptions();
    return options;
  }
  private async saveSettingsWithFeedback(options: SettingsSaveOptions): Promise<void> {
    try {
      await this.plugin.saveSettings(options);
      new Notice(t('autoSaveSuccessNotice'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('autoSaveFailedNotice', { message }), 7000);
    }
  }
  hide(): void {
    this.unregisterMcpStatusEvent();
    // RefreshAction 인스턴스 정리
    this.mcpStatusRefresh?.detach();
    this.mcpStatusRefresh = null;
    this.excludeCountRenderer = null;
    this.unregisterRefreshBusSubscriptions();
    this.resetRagDomReferences();
    if (this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null) {
      this.pendingEmbeddingProvider = null;
      this.pendingEmbeddingModel = null;
      new Notice(t('settingsAuto007'));
    }
    this.flushSave();
    super.hide();
  }
  private resetRagDomReferences(): void {
    this.generalStatusBody = null;
    this.ragStatusGrid = null;
    this.ragStatusTimestamp = null;
    this.ragStatusAction = null;
    this.ragStatusDetails = null;
    this.ragControlsHint = null;
    this.updatePendingButton = null;
    this.reindexAllButton = null;
    this.cancelIndexingButton = null;
    this.resumeIndexingButton = null;
    this.graphRagSummaryBanner = null;
    this.graphRagStatusGrid = null;
    this.graphRagActionsGroup = null;
    this.graphRagSectionContainer = null;
    this.graphRagOverviewContainer = null;
    this.graphRagProgressBanner = null;
    this.graphRagModelSelectEl = null;
  }
  display(): void {
    this.renderSettingsView();
  }

  private renderSettingsView(): void {
    const { containerEl } = this;
    this.unregisterRefreshBusSubscriptions();
    this.resetRagDomReferences();
    this.tabButtons.clear();
    this.tabPanels.clear();
    this.builtTabPanelIds.clear();
    containerEl.empty();
    // RefreshBus 구독: 이벤트 수신 시 부분 업데이트
    const bus = this.plugin.refreshBus;
    if (bus) {
      this.refreshBusUnsubscribers.push(
        bus.on('rag', (result) => {
          this.updateRagStats(result.detail);
          this.updateGraphRagStats();
          this.refreshStatsGrid();
          this.refreshFileTypeSummary();
          this.refreshGeneralStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('graph-progress', () => {
          this.updateGraphRagStats();
          this.refreshGeneralStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('models', () => {
          this.refreshRagTab();
          this.refreshGeneralStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('mcp', () => {
          this.refreshMcpStatusSection();
          this.refreshGeneralStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('graph-data', () => {
          this.updateGraphRagStats();
          this.refreshGeneralStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('exclude-counts', () => {
          this.excludeCountRenderer?.();
        }),
      );
    }
    containerEl.addClass('superpower-inside-settings-root');
    // 헤더
    new Setting(containerEl).setName(t('settingsTitle')).setHeading();
    // 보안 경고
    const warning = containerEl.createDiv({
      cls: 'superpower-inside-settings-warning',
    });
    warning.setText(t('securityWarning'));
    // 탭 바
    const tabBar = containerEl.createDiv({ cls: 'superpower-inside-settings-tabs' });
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', t('settingsTitle'));
    const tabs = buildSettingsTabs();
    tabs.forEach((tab, index) => {
      const tabId = `superpower-inside-settings-tab-${tab.id}`;
      const panelId = `superpower-inside-settings-panel-${tab.id}`;
      const button = tabBar.createEl('button', {
        text: tab.label,
        cls: 'superpower-inside-settings-tab',
        attr: {
          id: tabId,
          type: 'button',
          role: 'tab',
          'aria-controls': panelId,
          'aria-selected': 'false',
          tabindex: '-1',
        },
      });
      this.tabButtons.set(tab.id, button);
      button.addEventListener('click', () => this.switchTab(tab.id));
      button.addEventListener('keydown', (event) => {
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        this.switchTab(nextTab.id);
        this.tabButtons.get(nextTab.id)?.focus();
      });
    });
    // 탭 콘텐츠 패널
    const tabContentContainer = containerEl.createDiv({
      cls: 'superpower-inside-settings-tab-panels',
    });
    tabs.forEach((tab) => {
      const panel = tabContentContainer.createDiv({
        cls: 'superpower-inside-settings-tab-content',
        attr: {
          id: `superpower-inside-settings-panel-${tab.id}`,
          role: 'tabpanel',
          'aria-labelledby': `superpower-inside-settings-tab-${tab.id}`,
          tabindex: '0',
        },
      });
      panel.hidden = true;
      this.tabPanels.set(tab.id, panel);
    });
    // 첫 번째 탭을 활성 상태로 초기화
    this.switchTab(this.activeTab);
  }
  private unregisterRefreshBusSubscriptions(): void {
    for (const unsub of this.refreshBusUnsubscribers) {
      unsub();
    }
    this.refreshBusUnsubscribers = [];
  }
  private buildTabPanel(tabId: SettingsTabId): void {
    if (this.builtTabPanelIds.has(tabId)) return;
    const panel = this.tabPanels.get(tabId);
    if (!panel) return;
    panel.empty();
    switch (tabId) {
      case 'general':
        this.buildGeneralTab(panel);
        break;
      case 'providers':
        this.buildProvidersTab(panel);
        break;
      case 'rag':
        this.buildRAGTab(panel);
        break;
      case 'chat':
        this.buildChatTab(panel);
        break;
      case 'mcp':
        this.buildMCPTab(panel);
        break;
      case 'advanced':
        this.buildAdvancedTab(panel);
        break;
    }
    this.builtTabPanelIds.add(tabId);
  }
  private switchTab(tabId: SettingsTabId): void {
    // 활성 탭 업데이트
    this.activeTab = tabId;
    this.buildTabPanel(tabId);
    // 버튼 클래스 토글
    this.tabButtons.forEach((button, id) => {
      if (id === tabId) {
        button.classList.add('is-active');
        button.setAttribute('aria-selected', 'true');
        button.tabIndex = 0;
      } else {
        button.classList.remove('is-active');
        button.setAttribute('aria-selected', 'false');
        button.tabIndex = -1;
      }
    });
    // 패널 클래스 토글
    this.tabPanels.forEach((panel, id) => {
      if (id === tabId) {
        panel.classList.add('is-active');
        panel.hidden = false;
      } else {
        panel.classList.remove('is-active');
        panel.hidden = true;
      }
    });
    if (tabId === 'general') {
      this.refreshGeneralTab();
    } else if (tabId === 'rag') {
      this.refreshRagTab();
    }
  }
  private refreshGeneralTab(): void {
    this.refreshGeneralStatusSection();
    this.repopulateDefaultModelDropdown();
  }
  private refreshGeneralStatusSection(): void {
    const statusBody = this.generalStatusBody;
    if (!statusBody || !statusBody.isConnected) return;
    this.renderGeneralStatus(statusBody);
  }
  /** General 탭의 기본 모델 dropdown만 다시 채웁니다 (full rebuild 대신). */
  private repopulateDefaultModelDropdown(): void {
    const dropdown = this.defaultModelDropdownEl;
    if (!dropdown) return;
    const allModels = buildChatModelOptions(this.plugin.settings, {
      currentModel: this.plugin.settings.chat.defaultModel,
    });
    if (this.plugin.settings.providerProfiles.length === 0) {
      for (const key of CHAT_PROVIDER_KEYS) {
        const conf = this.plugin.settings[key];
        if (!conf.enabled) continue;
        for (const model of conf.models) {
          allModels.push({ value: `${key}:${model}`, label: `${PROVIDER_LABELS[key]} — ${model}` });
        }
      }
      for (const provider of this.plugin.settings.customOpenAIProviders) {
        if (!provider.enabled) continue;
        const label = provider.name.trim() || 'Custom OpenAI-Compatible';
        for (const model of provider.models) {
          allModels.push({
            value: `customOpenAI:${provider.id}:${model}`,
            label: `${label} — ${model}`,
          });
        }
      }
      allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    }
    const defaultModel = this.plugin.settings.chat.defaultModel;
    dropdown.empty();
    if (allModels.length === 0) {
      const opt = dropdown.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      dropdown.disabled = true;
    } else {
      for (const m of allModels) {
        const opt = dropdown.createEl('option');
        opt.value = m.value;
        opt.text = m.label;
      }
      dropdown.value =
        defaultModel && allModels.some((m) => m.value === defaultModel)
          ? defaultModel
          : allModels[0].value;
      dropdown.disabled = false;
    }
    this.plugin.refreshBus.emit('models', { status: 'success' });
  }
  private refreshRagTab(): void {
    const ragPanel = this.tabPanels.get('rag');
    if (!ragPanel) return;
    if (this.graphRagModelSelectEl) {
      const modelOptions = buildChatModelOptions(this.plugin.settings, {
        currentModel: this.plugin.settings.rag.graphRagModel,
        includeEmpty: true,
        emptyLabel: t('settingsAuto008'),
      });
      this.graphRagModelSelectEl.empty();
      for (const option of modelOptions) {
        const opt = this.graphRagModelSelectEl.createEl('option');
        opt.value = option.value;
        opt.text = option.label;
      }
      const selectedModel = this.plugin.settings.rag.graphRagModel.trim();
      this.graphRagModelSelectEl.value = modelOptions.some(
        (option) => option.value === selectedModel,
      )
        ? selectedModel
        : '';
    }
  }
  private createSettingsSection(
    containerEl: HTMLElement,
    titleText: string,
    options: {
      description?: string;
      className?: string;
      variantClass?: string;
    } = {},
  ): { section: HTMLElement; body: HTMLElement } {
    const variantClass = options.variantClass;
    const section = containerEl.createDiv({
      cls: [
        'superpower-inside-settings-section',
        variantClass,
        options.className,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    });
    const header = section.createDiv({
      cls: [
        'superpower-inside-settings-section-header',
        variantClass ? `${variantClass}-header` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    const copy = header.createDiv({
      cls: [
        'superpower-inside-settings-section-copy',
        variantClass ? `${variantClass}-copy` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    copy.createDiv({
      cls: [
        'superpower-inside-settings-section-title',
        variantClass ? `${variantClass}-title` : '',
      ]
        .filter(Boolean)
        .join(' '),
      text: titleText,
    });
    if (options.description) {
      copy.createDiv({
        cls: [
          'superpower-inside-settings-section-description',
          variantClass ? `${variantClass}-description` : '',
        ]
          .filter(Boolean)
          .join(' '),
        text: options.description,
      });
    }
    const body = section.createDiv({
      cls: [
        'superpower-inside-settings-section-body',
        variantClass ? `${variantClass}-body` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    return { section, body };
  }
  private createSettingsStatusRow(
    containerEl: HTMLElement,
    options: {
      label: string;
      value: string;
      statusLabel: string;
      detail: string;
      tone: 'neutral' | 'success' | 'warning' | 'danger';
      onActivate?: () => void;
    },
  ): HTMLElement {
    const className = `superpower-inside-settings-row superpower-inside-settings-status-row is-${options.tone}`;
    const row = options.onActivate
      ? containerEl.createEl('button', { cls: className, attr: { type: 'button' } })
      : containerEl.createDiv({ cls: className });
    if (options.onActivate) row.addEventListener('click', options.onActivate);
    const copy = row.createDiv({ cls: 'superpower-inside-settings-status-copy' });
    copy.createDiv({ cls: 'superpower-inside-settings-status-label', text: options.label });
    copy.createDiv({ cls: 'superpower-inside-settings-status-detail', text: options.detail });
    const meta = row.createDiv({ cls: 'superpower-inside-settings-status-meta' });
    meta.createDiv({ cls: 'superpower-inside-settings-status-state', text: options.statusLabel });
    if (options.value !== options.statusLabel) {
      meta.createDiv({ cls: 'superpower-inside-settings-status-value', text: options.value });
    }
    return row;
  }
  private createSettingsActionRow(
    containerEl: HTMLElement,
    options: {
      label: string;
      detail: string;
      actionLabel: string;
      tone: 'warning' | 'danger';
      onActivate: () => void;
    },
  ): HTMLElement {
    const row = containerEl.createDiv({
      cls: `superpower-inside-settings-row superpower-inside-settings-action-row is-${options.tone}`,
    });
    const copy = row.createDiv({ cls: 'superpower-inside-settings-action-copy' });
    copy.createDiv({ cls: 'superpower-inside-settings-action-label', text: options.label });
    copy.createDiv({ cls: 'superpower-inside-settings-action-detail', text: options.detail });
    const button = row.createEl('button', {
      cls: 'mod-cta superpower-inside-settings-primary-action',
      attr: { type: 'button' },
      text: options.actionLabel,
    });
    button.addEventListener('click', options.onActivate);
    return row;
  }
  private createSettingsNotice(
    containerEl: HTMLElement,
    options: {
      text: string;
      tone: 'info' | 'warning' | 'danger';
      icon: string;
    },
  ): HTMLElement {
    const notice = containerEl.createDiv({
      cls: `superpower-inside-settings-notice is-${options.tone}`,
    });
    const icon = notice.createSpan({ cls: 'superpower-inside-settings-notice-icon' });
    setIcon(icon, options.icon);
    notice.createSpan({ cls: 'superpower-inside-settings-notice-text', text: options.text });
    return notice;
  }
  private createSettingsDisclosure(
    containerEl: HTMLElement,
    id: string,
    titleText: string,
    description?: string,
    options: {
      className?: string;
      idPrefix?: string;
    } = {},
  ): { button: HTMLButtonElement; content: HTMLElement } {
    const idPrefix = options.idPrefix ?? 'superpower-inside-settings-disclosure';
    const contentId = `${idPrefix}-${id}`;
    const variantClass = options.className;
    const disclosure = containerEl.createDiv({
      cls: ['superpower-inside-settings-disclosure', variantClass].filter(Boolean).join(' '),
    });
    const button = disclosure.createEl('button', {
      cls: [
        'superpower-inside-settings-disclosure-button',
        variantClass ? `${variantClass}-button` : '',
      ]
        .filter(Boolean)
        .join(' '),
      attr: {
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': contentId,
      },
    });
    const copy = button.createSpan({
      cls: [
        'superpower-inside-settings-disclosure-copy',
        variantClass ? `${variantClass}-copy` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    copy.createSpan({
      cls: [
        'superpower-inside-settings-disclosure-title',
        variantClass ? `${variantClass}-title` : '',
      ]
        .filter(Boolean)
        .join(' '),
      text: titleText,
    });
    if (description) {
      copy.createSpan({
        cls: [
          'superpower-inside-settings-disclosure-description',
          variantClass ? `${variantClass}-description` : '',
        ]
          .filter(Boolean)
          .join(' '),
        text: description,
      });
    }
    const icon = button.createSpan({
      cls: [
        'superpower-inside-settings-disclosure-icon',
        variantClass ? `${variantClass}-icon` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    setIcon(icon, 'chevron-right');
    const content = disclosure.createDiv({
      cls: [
        'superpower-inside-settings-disclosure-content',
        variantClass ? `${variantClass}-content` : '',
        'is-collapsed',
      ]
        .filter(Boolean)
        .join(' '),
      attr: { id: contentId },
    });
    button.addEventListener('click', () => {
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!isOpen));
      disclosure.toggleClass('is-open', !isOpen);
      content.toggleClass('is-collapsed', isOpen);
    });
    return { button, content };
  }
  private createRagSection(
    containerEl: HTMLElement,
    titleText: string,
    options: {
      description?: string;
      className?: string;
    } = {},
  ): { section: HTMLElement; body: HTMLElement } {
    return this.createSettingsSection(containerEl, titleText, {
      ...options,
      variantClass: 'superpower-inside-rag-section',
    });
  }
  private createRagGroup(
    containerEl: HTMLElement,
    titleText: string,
    description?: string,
    className?: string,
  ): HTMLElement {
    const group = containerEl.createDiv({
      cls: `superpower-inside-rag-group${className ? ` ${className}` : ''}`,
    });
    group.createDiv({ cls: 'superpower-inside-rag-group-title', text: titleText });
    if (description) {
      group.createDiv({ cls: 'superpower-inside-rag-group-description', text: description });
    }
    return group;
  }
  private createRagDisclosure(
    containerEl: HTMLElement,
    id: string,
    titleText: string,
    description?: string,
  ): { button: HTMLButtonElement; content: HTMLElement } {
    return this.createSettingsDisclosure(containerEl, id, titleText, description, {
      className: 'superpower-inside-rag-disclosure',
      idPrefix: 'superpower-inside-rag-disclosure',
    });
  }
  private buildGeneralTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const workspace = containerEl.createDiv({ cls: 'superpower-inside-settings-workspace' });
    this.buildGeneralStatusSection(workspace);
    this.buildGeneralBasicsSection(workspace);
    this.buildAgentDiagnosticsSection(workspace);
    this.buildGeneralAdvancedSection(workspace);
  }
  private buildGeneralStatusSection(containerEl: HTMLElement): void {
    const section = this.createSettingsSection(containerEl, t('generalStatusTitle'), {
      description: t('generalStatusDesc'),
      className: 'superpower-inside-general-status-section',
    });
    section.body.setAttribute('role', 'status');
    section.body.setAttribute('aria-live', 'polite');
    this.generalStatusBody = section.body;
    this.renderGeneralStatus(section.body);
  }
  private renderGeneralStatus(containerEl: HTMLElement): void {
    containerEl.empty();
    const snapshot = buildSettingsOverviewSnapshot({
      settings: this.plugin.settings,
      runtime: this.buildOverviewRuntimeState(),
    });
    const primaryAttention = snapshot.attentionItems[0];
    if (primaryAttention) {
      this.createSettingsActionRow(containerEl, {
        label: primaryAttention.label,
        detail: primaryAttention.detail,
        actionLabel: primaryAttention.actionLabel,
        tone: primaryAttention.tone,
        onActivate: () => this.switchTab(primaryAttention.target),
      });
    } else {
      this.createSettingsNotice(containerEl, {
        text: t('generalAllReady'),
        tone: 'info',
        icon: 'check-circle-2',
      });
    }
    const statusList = containerEl.createDiv({ cls: 'superpower-inside-settings-status-list' });
    for (const metric of snapshot.metrics) {
      this.createSettingsStatusRow(statusList, {
        label: metric.label,
        value: metric.value,
        statusLabel: metric.statusLabel,
        detail: metric.detail,
        tone: metric.tone,
        onActivate: () => this.switchTab(metric.target),
      });
    }
  }
  private buildGeneralBasicsSection(containerEl: HTMLElement): void {
    const section = this.createSettingsSection(containerEl, t('generalBasicsTitle'), {
      description: t('generalBasicsDesc'),
      className: 'superpower-inside-general-basics-section',
    });
    new Setting(section.body)
      .setName(t('language'))
      .setDesc(t('languageDesc'))
      .addDropdown((dropdown) => {
        dropdown.addOption('ko', t('langKo'));
        dropdown.addOption('en', t('langEn'));
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          const newLang = value as Language;
          const currentLang = this.plugin.settings.language;
          if (newLang === currentLang) {
            return;
          }
          const confirmed = await confirmWithModal(this.app, t('languageChangeConfirm'));
          if (!confirmed) {
            dropdown.setValue(currentLang);
            return;
          }
          this.plugin.settings.language = newLang;
          await this.plugin.saveSettings();
          window.location.reload();
        });
      });
    new Setting(section.body)
      .setName(t('autoSaveSettings'))
      .setDesc(t('autoSaveSettingsDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSaveEnabled).onChange(async (value) => {
          this.plugin.settings.autoSaveEnabled = value;
          await this.plugin.saveSettingsLight();
        }),
      );
    const allModels = buildChatModelOptions(this.plugin.settings, {
      currentModel: this.plugin.settings.chat.defaultModel,
    });
    if (this.plugin.settings.providerProfiles.length === 0) {
      for (const key of CHAT_PROVIDER_KEYS) {
        const conf = this.plugin.settings[key];
        if (!conf.enabled) continue;
        for (const model of conf.models) {
          allModels.push({ value: `${key}:${model}`, label: `${PROVIDER_LABELS[key]} — ${model}` });
        }
      }
      for (const provider of this.plugin.settings.customOpenAIProviders) {
        if (!provider.enabled) continue;
        const label = provider.name.trim() || 'Custom OpenAI-Compatible';
        for (const model of provider.models) {
          allModels.push({
            value: `customOpenAI:${provider.id}:${model}`,
            label: `${label} — ${model}`,
          });
        }
      }
      allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    }
    new Setting(section.body)
      .setName(t('defaultModel'))
      .setDesc(t('defaultModelDesc'))
      .addDropdown((dropdown) => {
        this.defaultModelDropdownEl = dropdown.selectEl;
        if (allModels.length === 0) {
          dropdown.addOption('', t('noModelsEnabled'));
          dropdown.setDisabled(true);
        } else {
          for (const opt of allModels) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.plugin.settings.chat.defaultModel);
          dropdown.setDisabled(false);
        }
        dropdown.onChange((value) => {
          this.plugin.settings.chat.defaultModel = value;
          this.debouncedSave();
        });
      });
  }

  private buildAgentDiagnosticsSection(containerEl: HTMLElement): void {
    const section = this.createSettingsSection(containerEl, t('generalDiagnosticsTitle'), {
      description: t('generalDiagnosticsDesc'),
      className: 'superpower-inside-general-diagnostics-section',
    });
    const statusContainer = section.body.createDiv({
      cls: 'superpower-inside-general-diagnostics-status',
    });
    const renderStatus = (): void => {
      statusContainer.empty();
      const enabled = this.plugin.settings.agentDiagnostics.enabled;
      this.createSettingsStatusRow(statusContainer, {
        label: t('agentDiagnosticsToggle'),
        value: enabled ? t('overviewReady') : t('overviewDisabled'),
        statusLabel: enabled ? t('overviewReady') : t('overviewDisabled'),
        detail: enabled
          ? t('agentDiagnosticsEnabledStatus', {
              path: this.plugin.getAgentDiagnosticsFilePath(),
            })
          : t('agentDiagnosticsDisabledStatus'),
        tone: enabled ? 'success' : 'neutral',
      });
    };
    renderStatus();
    const disclosure = this.createSettingsDisclosure(
      section.body,
      'general-diagnostics',
      t('generalDiagnosticsDisclosureTitle'),
      t('generalDiagnosticsDisclosureDesc'),
    );
    new Setting(disclosure.content)
      .setName(t('agentDiagnosticsToggle'))
      .setDesc(t('agentDiagnosticsToggleDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.agentDiagnostics.enabled).onChange(async (value) => {
          this.plugin.settings.agentDiagnostics.enabled = value;
          await this.plugin.saveSettingsLight();
          if (value) {
            await this.plugin.writeAgentDiagnosticsSnapshot('settings-toggle');
          }
          renderStatus();
        }),
      );
    new Setting(disclosure.content)
      .setName(t('agentDiagnosticsOpenView'))
      .setDesc(t('agentDiagnosticsOpenViewDesc'))
      .addButton((button) =>
        button
          .setButtonText(t('agentDiagnosticsOpenViewButton'))
          .onClick(() => this.plugin.openAgentDiagnosticsView()),
      );
    disclosure.content.createDiv({
      cls: 'superpower-inside-agent-diagnostics-path',
      text: t('agentDiagnosticsFilePath', { path: this.plugin.getAgentDiagnosticsFilePath() }),
    });
    new Setting(disclosure.content)
      .setName(t('agentDiagnosticsWriteSnapshot'))
      .setDesc(t('agentDiagnosticsWriteSnapshotDesc'))
      .addButton((button) =>
        button.setButtonText(t('agentDiagnosticsWriteButton')).onClick(() => {
          void this.plugin.writeAgentDiagnosticsSnapshot('settings-write');
        }),
      );
    new Setting(disclosure.content)
      .setName(t('agentDiagnosticsClearDetailedLogging'))
      .setDesc(t('agentDiagnosticsClearDetailedLoggingDesc'))
      .addButton((button) =>
        button.setButtonText(t('agentDiagnosticsClearButton')).onClick(() => {
          void this.plugin.clearAgentDiagnosticsDetailedLogging();
        }),
      );
  }
  private buildGeneralAdvancedSection(containerEl: HTMLElement): void {
    const section = this.createSettingsSection(containerEl, t('generalAdvancedTitle'), {
      description: t('generalAdvancedDesc'),
      className: 'superpower-inside-general-advanced-section',
    });
    const saveDisclosure = this.createSettingsDisclosure(
      section.body,
      'general-auto-save-details',
      t('generalAutoSaveDisclosureTitle'),
      t('generalAutoSaveDisclosureDesc'),
    );
    new Setting(saveDisclosure.content)
      .setName(t('autoSaveDelay'))
      .setDesc(t('autoSaveDelayDesc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.plugin.settings.autoSaveDebounceMs));
        text.inputEl.parentElement?.createSpan({
          cls: 'superpower-inside-delay-unit',
          text: ` ${t('delayMs')}`,
        });
        text.onChange((value) => {
          const num = parseInt(value, 10);
          if (!Number.isNaN(num) && num >= 0 && num <= 5000) {
            this.plugin.settings.autoSaveDebounceMs = num;
            this.debouncedSave();
          }
        });
      });
    const dangerDisclosure = this.createSettingsDisclosure(
      section.body,
      'general-danger-zone',
      t('pluginDataResetTitle'),
      t('generalDangerDisclosureDesc'),
    );
    dangerDisclosure.button.addClass('is-danger');
    this.buildPluginDataResetSection(dangerDisclosure.content);
  }
  private buildPluginDataResetSection(containerEl: HTMLElement): void {
    this.createSettingsNotice(containerEl, {
      text: t('pluginDataResetWarning'),
      tone: 'danger',
      icon: 'triangle-alert',
    });
    containerEl.createDiv({
      cls: 'superpower-inside-settings-danger-scope',
      text: t('pluginDataResetScope'),
    });
    const actions = containerEl.createDiv({ cls: 'superpower-inside-settings-danger-actions' });
    const button = actions.createEl('button', {
      cls: 'superpower-inside-settings-danger-button',
      attr: { type: 'button' },
    });
    setIcon(button, 'trash-2');
    button.createSpan({ text: t('pluginDataResetButton') });
    button.addEventListener('click', () => {
      void this.handlePluginDataReset(button);
    });
  }

  private async handlePluginDataReset(button: HTMLButtonElement): Promise<void> {
    const result = await runActionWithFeedback({
      button,
      loadingText: t('pluginDataResetRunning'),
      refreshBus: this.plugin.refreshBus,
      refreshDomains: ['rag', 'mcp', 'models', 'graph-data'],
      action: async () => {
        if (!(await confirmWithModal(this.app, t('pluginDataResetConfirm')))) {
          return { status: 'noop', detail: t('actionCancelledNotice') };
        }
        if (!(await confirmWithModal(this.app, t('pluginDataResetSecondConfirm')))) {
          return { status: 'noop', detail: t('actionCancelledNotice') };
        }
        try {
          await this.plugin.resetPluginData();
          return { status: 'success', detail: t('pluginDataResetDone') };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            status: 'error',
            detail: message,
            notice: t('pluginDataResetFailed', { message }),
          };
        }
      },
    });
    if (result.status === 'success') {
      this.renderSettingsView();
    }
  }

  private buildOverviewRuntimeState(): SettingsOverviewRuntimeState {
    const runtime = this.plugin.getRagRuntimeState();
    const registry = this.plugin.mcpRegistry;
    return {
      ragStatus: runtime.ragStatus,
      graphRagStatus: runtime.graphRagStatus,
      mcpConnectionState: this.plugin.mcpConnectionState ?? 'idle',
      mcpServers: this.plugin.settings.mcpServers.map((server) => ({
        name: server.name,
        status: registry?.getConnectionStatus(server.name) ?? 'disconnected',
        error: registry?.getLastError(server.name),
      })),
      isRagIndexing: this.plugin.isRagIndexing(),
      isGraphRagIndexing: this.plugin.isGraphRagIndexing(),
      hasGraphRagRunner: this.plugin.hasGraphRagRunner(),
    };
  }
  private buildProvidersTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const workspace = containerEl.createDiv({
      cls: 'superpower-inside-settings-workspace superpower-inside-provider-workspace',
    });
    const profiles = this.plugin.settings.providerProfiles.filter(
      (profile) => profile.strategy !== 'ternlight',
    );
    this.buildProviderStatusSection(workspace, profiles);
    this.buildProviderConnectionsSection(workspace, profiles);
  }
  private buildRAGTab(containerEl: HTMLElement): void {
    const workspace = containerEl.createDiv({
      cls: 'superpower-inside-settings-workspace superpower-inside-rag-workspace',
    });
    this.buildRagStatusPanel(workspace);
    this.buildRagFoundationSection(workspace);
    this.buildGraphRagSection(workspace);
    this.buildRagAdvancedSection(workspace);
  }
  private buildRagFoundationSection(containerEl: HTMLElement): void {
    const section = this.createRagSection(containerEl, t('ragFoundationTitle'), {
      description: t('ragFoundationDescription'),
      className: 'superpower-inside-rag-foundation-section',
    });
    this.buildEmbeddingProviderSection(section.body);
    this.buildExcludeOptionsSection(section.body);
  }
  private buildGraphRagSection(containerEl: HTMLElement): void {
    const section = this.createRagSection(containerEl, t('graphRagOverviewTitle'), {
      description: t('ragGraphSectionDescription'),
      className: 'superpower-inside-rag-graph-section',
    });
    this.buildGraphRagOverview(section.body);
    const disclosure = this.createRagDisclosure(
      section.body,
      'graph-operations',
      t('ragGraphDisclosureTitle'),
      t('ragGraphDisclosureDescription'),
    );
    this.buildGraphRagOperationsSection(disclosure.content);
  }
  private buildRagAdvancedSection(containerEl: HTMLElement): void {
    const section = this.createRagSection(containerEl, t('ragDiagnosticsTitle'), {
      description: t('ragDiagnosticsDescription'),
      className: 'superpower-inside-rag-diagnostics-section',
    });
    const disclosure = this.createRagDisclosure(
      section.body,
      'diagnostics',
      t('ragDiagnosticsDisclosureTitle'),
    );
    this.buildIndexingOptionsSection(disclosure.content);
    this.buildSearchQualitySection(disclosure.content);
    this.buildStatsSection(disclosure.content);
    this.buildTargetFileTypesSection(disclosure.content);
    this.buildUpdateRequiredDocumentsSection(disclosure.content);
  }
  private buildRagStatusPanel(containerEl: HTMLElement): void {
    const section = this.createRagSection(containerEl, t('settingsAuto027'), {
      description: t('ragStatusSectionDescription'),
      className: 'superpower-inside-rag-status-panel',
    });
    const statusGrid = section.body.createDiv({ cls: 'superpower-inside-rag-status-grid' });
    const actionEl = section.body.createDiv({ cls: 'superpower-inside-rag-status-action' });
    const detailsEl = section.body.createDiv({ cls: 'superpower-inside-rag-status-details' });
    const timestampEl = section.body.createDiv({
      cls: 'superpower-inside-rag-status-timestamp',
      text: t('settingsAuto028'),
    });
    this.buildControlsSection(section.body);
    // DOM 참조 저장 (부분 업데이트용)
    this.ragStatusGrid = statusGrid;
    this.ragStatusAction = actionEl;
    this.ragStatusDetails = detailsEl;
    this.ragStatusTimestamp = timestampEl;
    // 자동 갱신은 백그라운드 타이머/이벤트에서 처리
    void this.updateRagStats();
  }
  private createRagStatusItem(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({
      cls: 'superpower-inside-rag-row superpower-inside-rag-status-item',
    });
    item.createDiv({ cls: 'superpower-inside-rag-status-label', text: label });
    item.createDiv({ cls: 'superpower-inside-rag-status-value', text: value });
  }
  private createRagStatusItemWithDesc(
    containerEl: HTMLElement,
    label: string,
    value: string,
    description: string,
    tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral',
  ): void {
    const item = containerEl.createDiv({
      cls: 'superpower-inside-rag-row superpower-inside-rag-status-item',
    });
    item.createDiv({ cls: 'superpower-inside-rag-status-label', text: label });
    const valueEl = item.createDiv({ cls: 'superpower-inside-rag-status-value', text: value });
    if (tone !== 'neutral') {
      valueEl.addClass(`is-${tone}`);
    }
    if (description) {
      item.createDiv({ cls: 'superpower-inside-rag-status-description', text: description });
    }
  }
  private buildGraphRagOverview(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-row superpower-inside-rag-overview-row superpower-inside-graph-rag-overview',
    });
    this.graphRagOverviewContainer = section;
    this.renderGraphRagOverview(section);
  }

  private renderGraphRagOverview(containerEl: HTMLElement): void {
    containerEl.empty();
    const rag = this.plugin.settings.rag;
    const runtime = this.plugin.getRagRuntimeState();
    const graphState = runtime.graphRagStatus;
    const statusLabel =
      graphState?.state ??
      getGraphRagStatusLabel({
        enabled: rag.graphRagEnabled,
        hasGraphIndex: false,
        isRunning: this.plugin.isGraphRagIndexing(),
        isStale: false,
        partialFailureCount: 0,
      });
    const presentation = getGraphRagStatusPresentation(statusLabel);
    const total = graphState?.totalCandidateFiles ?? runtime.ragStatus?.totalDocuments ?? 0;
    const stale = graphState?.staleFileCount ?? 0;
    const failed = graphState?.failedFileCount ?? 0;
    const done = graphState?.graphEvidenceCount ?? 0;
    const copy = containerEl.createDiv({ cls: 'superpower-inside-rag-overview-copy' });
    copy.createDiv({
      cls: 'superpower-inside-rag-overview-title',
      text: t('ragStatusCurrentState'),
    });
    const status = copy.createDiv({
      cls: `superpower-inside-rag-overview-status is-${presentation.tone}`,
      text: presentation.label,
    });
    status.setAttribute('role', 'status');
    copy.createDiv({
      cls: 'superpower-inside-rag-overview-detail',
      text: t('graphRagOverviewDetail', {
        total: String(total),
        done: String(done),
        stale: String(stale),
        failed: String(failed),
      }),
    });

    const actions = containerEl.createDiv({ cls: 'superpower-inside-rag-overview-actions' });
    const controls = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles: total,
      failedFileCount: failed,
    });
    const syncStale = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles: stale,
      failedFileCount: 0,
    }).start;
    const enabledState = {
      disabled: !rag.graphRagEnabled || this.plugin.isGraphRagIndexing(),
      reason: null,
    };
    const availableState = { disabled: done === 0, reason: null };
    const groups = buildGraphRagActionGroups({
      controls,
      syncStale,
      buildCommunities: enabledState,
      resetGraphRag: enabledState,
      openExplorer: availableState,
      totalCandidateFiles: total,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      failedFileCount: failed,
      staleFileCount: stale,
    });
    const recommendedActionId: GraphRagActionId | null = this.plugin.isGraphRagIndexing()
      ? 'cancel'
      : stale > 0
        ? 'syncStale'
        : failed > 0
          ? 'resumeFailed'
          : statusLabel === 'not-built' && total > 0
            ? 'start'
            : null;
    const recommendedAction = groups
      .flatMap((group) => group.actions)
      .find((action) => action.id === recommendedActionId && !action.state.disabled);
    const cost = estimateGraphRagIndexingCost({
      totalCandidateFiles: recommendedActionId === 'syncStale' ? stale : total,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      averageChunksPerFile: 3,
      averageTokensPerChunk: 900,
      providerKind: rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')
        ? 'local'
        : 'remote',
    });
    if (recommendedAction) {
      const button = actions.createEl('button', {
        cls: 'mod-cta superpower-inside-rag-overview-primary',
        attr: { type: 'button' },
      });
      setIcon(button, recommendedAction.iconName);
      button.createSpan({ text: recommendedAction.label });
      button.addEventListener('click', () => {
        void this.handleGraphRagAction(recommendedAction, cost);
      });
    }
    if (done > 0) {
      const explorerButton = actions.createEl('button', {
        text: t('graphRagOpenExplorer'),
        attr: { type: 'button' },
      });
      explorerButton.addEventListener('click', () => this.plugin.openGraphRagView());
    }
  }

  private buildGraphRagOperationsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-graph-operations',
    });
    this.graphRagSectionContainer = section;
    const rag = this.plugin.settings.rag;
    const runtime = this.plugin.getRagRuntimeState();
    const graphState = runtime.graphRagStatus;
    const statusLabel =
      graphState?.state ??
      getGraphRagStatusLabel({
        enabled: rag.graphRagEnabled,
        hasGraphIndex: false,
        isRunning: this.plugin.isGraphRagIndexing(),
        isStale: false,
        partialFailureCount: 0,
      });
    const presentation = getGraphRagStatusPresentation(statusLabel);
    const cost = estimateGraphRagIndexingCost({
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? runtime.ragStatus?.totalDocuments ?? 0,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      averageChunksPerFile: 3,
      averageTokensPerChunk: 900,
      providerKind: rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')
        ? 'local'
        : 'remote',
    });
    const controls = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? runtime.ragStatus?.totalDocuments ?? 0,
      failedFileCount: graphState?.failedFileCount ?? 0,
    });
    // 진행 중 배너 (기본 숨김)
    const progressBanner = section.createDiv({
      cls: 'superpower-inside-rag-graph-progress-banner superpower-inside-hidden',
    });
    const spinner = progressBanner.createDiv({ cls: 'superpower-inside-spinner' });
    spinner.setAttr('aria-hidden', 'true');
    const progressBody = progressBanner.createDiv({
      cls: 'superpower-inside-rag-graph-progress-body',
    });
    const progressTitle = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-title',
      text: '',
    });
    progressTitle.id = 'superpower-inside-graph-progress-title';
    const progressPhase = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-phase',
      text: '',
    });
    progressPhase.id = 'superpower-inside-graph-progress-phase';
    const progressText = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-detail',
      text: '',
    });
    progressText.id = 'superpower-inside-graph-progress-text';
    const progressChunks = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-detail',
      text: '',
    });
    progressChunks.id = 'superpower-inside-graph-progress-chunks';
    const progressStorage = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-detail',
      text: '',
    });
    progressStorage.id = 'superpower-inside-graph-progress-storage';
    this.graphRagProgressBanner = progressBanner;
    this.renderGraphRagProgressBanner();
    // 요약 배너
    const total = graphState?.totalCandidateFiles ?? 0;
    const done = graphState?.graphEvidenceCount ?? 0;
    const failed = graphState?.failedFileCount ?? 0;
    const stale = graphState?.staleFileCount ?? 0;
    const summaryText =
      total > 0
        ? t('settingsAuto030', {
            v0: String(total),
            v1: String(done),
            v2: String(failed > 0 ? t('settingsAuto031', { v0: String(failed) }) : ''),
            v3: String(stale > 0 ? t('settingsAuto032', { v0: String(stale) }) : ''),
          })
        : t('settingsAuto033');
    const banner = section.createDiv({ cls: 'superpower-inside-rag-graph-summary-banner' });
    this.graphRagSummaryBanner = banner;
    banner.setText(summaryText);
    // 상태 그리드
    const grid = section.createDiv({ cls: 'superpower-inside-rag-status-grid' });
    this.graphRagStatusGrid = grid;
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto034'),
      presentation.label,
      presentation.description,
      presentation.tone,
    );
    this.createRagStatusItem(grid, t('settingsAuto035'), String(total));
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto036'),
      String(done),
      t('settingsAuto036Desc'),
      'success',
    );
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto037'),
      String(failed),
      failed > 0 ? t('settingsAuto038') : t('settingsAuto039'),
    );
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto040'),
      String(stale),
      stale > 0 ? t('settingsAuto041') : t('settingsAuto042'),
      stale > 0 ? 'warning' : 'success',
    );
    this.createRagStatusItem(grid, t('settingsAuto043'), cost.costLabel);
    const runnerRef = (
      this.plugin as unknown as {
        graphRagIndexingRunner?: {
          getLastCommunityResult(): {
            communityCount: number;
            modularity: number;
          } | null;
        } | null;
      }
    ).graphRagIndexingRunner;
    const lastCommunity = runnerRef?.getLastCommunityResult();
    if (lastCommunity) {
      this.createRagStatusItemWithDesc(
        grid,
        t('settingsAuto044'),
        String(lastCommunity.communityCount),
        `modularity ${lastCommunity.modularity.toFixed(3)}`,
      );
    }
    // 비용 상세는 같은 disclosure 언어로 점진적으로 공개
    const costDetail = this.createRagDisclosure(
      section,
      'graph-cost',
      t('settingsAuto045'),
    ).content;
    costDetail.addClass('superpower-inside-rag-graph-cost-detail');
    this.createRagStatusItem(costDetail, t('settingsAuto047'), String(cost.estimatedFiles));
    this.createRagStatusItem(costDetail, t('settingsAuto048'), String(cost.estimatedCalls));
    this.createRagStatusItem(costDetail, t('settingsAuto049'), String(cost.estimatedInputTokens));
    this.createRagStatusItem(
      costDetail,
      t('graphRagPendingMergeLabel'),
      String(graphState?.pendingMergeCount ?? 0),
    );
    // 기본 설정
    new Setting(section)
      .setName(t('settingsAuto050'))
      .setDesc(t('settingsAuto051'))
      .addToggle((toggle) =>
        toggle.setValue(rag.graphRagEnabled).onChange((value) => {
          this.plugin.settings.rag.graphRagEnabled = value;
          this.renderSettingsView();
          this.debouncedRagSave();
        }),
      );
    const renderGraphRagModelOptions = (selectEl: HTMLSelectElement): void => {
      const modelOptions = buildChatModelOptions(this.plugin.settings, {
        currentModel: this.plugin.settings.rag.graphRagModel,
        includeEmpty: true,
        emptyLabel: t('settingsAuto008'),
      });
      selectEl.empty();
      for (const option of modelOptions) {
        const opt = selectEl.createEl('option');
        opt.value = option.value;
        opt.text = option.label;
      }
      const selectedModel = this.plugin.settings.rag.graphRagModel.trim();
      selectEl.value = modelOptions.some((option) => option.value === selectedModel)
        ? selectedModel
        : '';
    };
    new Setting(section)
      .setName(t('settingsAuto052'))
      .setDesc(t('settingsAuto053'))
      .addDropdown((dropdown) => {
        this.graphRagModelSelectEl = dropdown.selectEl;
        renderGraphRagModelOptions(dropdown.selectEl);
        dropdown.onChange((value) => {
          this.plugin.settings.rag.graphRagModel = value.trim();
          this.debouncedRagSave();
        });
      });
    new Setting(section)
      .setName(t('settingsAuto054'))
      .setDesc(t('settingsAuto055'))
      .addText((text) => {
        text
          .setValue(String(rag.graphRagMaxFilesPerRun))
          .setPlaceholder('50')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 10000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.graphRagMaxFilesPerRun = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '10000';
      });
    const concurrencySetting = new Setting(section)
      .setName(t('graphRagConcurrentRequestsLabel'))
      .setDesc(t('graphRagConcurrentRequestsDesc'));
    const concurrencyValue = concurrencySetting.controlEl.createSpan({
      cls: 'superpower-inside-graph-concurrency-value',
      text: String(rag.graphRagMaxConcurrentRequests),
    });
    concurrencySetting.addSlider((slider) =>
      slider
        .setLimits(1, 10, 1)
        .setValue(rag.graphRagMaxConcurrentRequests)
        .setDynamicTooltip()
        .onChange((value) => {
          concurrencyValue.setText(String(value));
          this.plugin.settings.rag.graphRagMaxConcurrentRequests = value;
          this.debouncedRagSave();
        }),
    );
    new Setting(section)
      .setName(t('graphRagQueryModeLabel'))
      .setDesc(t('settingsAuto056'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', t('graphRagQueryAutoLabel'))
          .addOption('local', t('graphRagQueryLocalLabel'))
          .addOption('global', t('graphRagQueryGlobalLabel'))
          .addOption('hybrid', t('graphRagQueryHybridLabel'))
          .setValue(rag.graphRagQueryMode)
          .onChange((value) => {
            this.plugin.settings.rag.graphRagQueryMode =
              value === 'local' || value === 'global' || value === 'hybrid' ? value : 'auto';
            this.debouncedRagSave();
          }),
      );
    new Setting(section)
      .setName(t('graphRagMergeThresholdLabel'))
      .setDesc(t('settingsAuto057'))
      .addText((text) => {
        text.setValue(String(rag.entityAutoMergeThreshold)).onChange((value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 0 || num > 1) return;
          this.plugin.settings.rag.entityAutoMergeThreshold = num;
          this.debouncedRagSave();
        });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.01';
      })
      .addText((text) => {
        text.setValue(String(rag.entityPendingMergeThreshold)).onChange((value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 0 || num > 1) return;
          this.plugin.settings.rag.entityPendingMergeThreshold = num;
          this.debouncedRagSave();
        });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.01';
      });
    // 자동 동기화 설정
    new Setting(section)
      .setName(t('settingsAuto058'))
      .setDesc(t('settingsAuto059'))
      .addToggle((toggle) =>
        toggle.setValue(rag.graphRagAutoSyncEnabled).onChange((value) => {
          this.plugin.settings.rag.graphRagAutoSyncEnabled = value;
          this.debouncedSave();
        }),
      );
    new Setting(section)
      .setName(t('settingsAuto060'))
      .setDesc(t('settingsAuto061'))
      .addText((text) => {
        text
          .setValue(String(rag.graphRagAutoSyncIntervalMin))
          .setPlaceholder('30')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 1440 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.graphRagAutoSyncIntervalMin = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '1440';
      });
    // 실행 버튼 그룹
    const actions = section.createDiv({ cls: 'superpower-inside-rag-action-groups' });
    this.graphRagActionsGroup = actions;
    const syncButtonState = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles: graphState?.staleFileCount ?? 0,
      failedFileCount: 0,
    }).start;
    const communityButtonState = {
      disabled:
        !rag.graphRagEnabled ||
        !this.plugin.hasGraphRagRunner() ||
        !rag.graphRagModel.trim() ||
        this.plugin.isGraphRagIndexing(),
      reason: !rag.graphRagEnabled
        ? t('settingsAuto062')
        : !rag.graphRagModel.trim()
          ? t('settingsAuto064')
          : !this.plugin.hasGraphRagRunner()
            ? t('settingsAuto063')
            : this.plugin.isGraphRagIndexing()
              ? t('settingsAuto065')
              : null,
    };
    const hasData = done > 0;
    const detailButtonState = { disabled: !hasData, reason: hasData ? null : t('settingsAuto066') };
    const resetGraphRagState = {
      disabled: !rag.graphRagEnabled || this.plugin.isGraphRagIndexing(),
      reason: !rag.graphRagEnabled
        ? t('settingsAuto062')
        : this.plugin.isGraphRagIndexing()
          ? t('settingsAuto065')
          : null,
    };
    this.renderGraphRagActions(actions, {
      controls,
      syncButtonState,
      communityButtonState,
      detailButtonState,
      resetGraphRag: resetGraphRagState,
      cost,
      totalCandidateFiles: total,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      failedFileCount: failed,
      staleFileCount: stale,
    });
  }

  private renderGraphRagProgressBanner(): void {
    if (!this.graphRagProgressBanner) return;
    const runner = (
      this.plugin as unknown as {
        graphRagIndexingRunner?: {
          getProgress(): {
            processedFiles: number;
            skippedFiles: number;
            failedFiles: number;
            selectedFiles: number;
            currentFile: string | null;
            phase?: import('./graph/indexing-progress').GraphRagIndexingPhase;
            processedChunks: number;
            skippedChunks: number;
            failedChunks: number;
            storedEvidence: number;
            storedEntities: number;
            storedRelations: number;
            storedClaims: number;
            storedRejectedFacts: number;
            cachedChunks: number;
          };
        } | null;
      }
    ).graphRagIndexingRunner;
    const progress = runner?.getProgress();
    const presentation = getGraphRagLiveStatusPresentation({
      isRunning: this.plugin.isGraphRagIndexing() && progress !== undefined,
      phase: progress?.phase ?? null,
      currentFile: progress?.currentFile ?? null,
      processedFiles: progress?.processedFiles ?? 0,
      skippedFiles: progress?.skippedFiles ?? 0,
      failedFiles: progress?.failedFiles ?? 0,
      selectedFiles: progress?.selectedFiles ?? 0,
      processedChunks: progress?.processedChunks ?? 0,
      skippedChunks: progress?.skippedChunks ?? 0,
      failedChunks: progress?.failedChunks ?? 0,
      storedEvidence: progress?.storedEvidence ?? 0,
      storedEntities: progress?.storedEntities ?? 0,
      storedRelations: progress?.storedRelations ?? 0,
      storedClaims: progress?.storedClaims ?? 0,
      storedRejectedFacts: progress?.storedRejectedFacts ?? 0,
      cachedChunks: progress?.cachedChunks ?? 0,
    });
    const titleEl = this.graphRagProgressBanner.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-title',
    );
    const phaseEl = this.graphRagProgressBanner.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-phase',
    );
    const detailEl = this.graphRagProgressBanner.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-text',
    );
    const chunksEl = this.graphRagProgressBanner.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-chunks',
    );
    const storageEl = this.graphRagProgressBanner.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-storage',
    );
    titleEl?.setText(presentation.title);
    phaseEl?.setText(presentation.phaseLabel);
    detailEl?.setText(presentation.detail);
    chunksEl?.setText(presentation.chunkDetail ?? '');
    storageEl?.setText(presentation.storageDetail ?? '');
    setHidden(chunksEl, presentation.chunkDetail === null);
    setHidden(storageEl, presentation.storageDetail === null);
    setHidden(this.graphRagProgressBanner, !presentation.active);
  }

  /** GraphRAG 대시보드를 부분 업데이트합니다. */
  updateGraphRagStats(): void {
    if (this.graphRagOverviewContainer) {
      this.renderGraphRagOverview(this.graphRagOverviewContainer);
    }
    if (!this.graphRagSectionContainer) return;
    this.renderGraphRagProgressBanner();
    const runtime = this.plugin.getRagRuntimeState();
    const graphState = runtime.graphRagStatus;
    const rag = this.plugin.settings.rag;
    const statusLabel =
      graphState?.state ??
      getGraphRagStatusLabel({
        enabled: rag.graphRagEnabled,
        hasGraphIndex: false,
        isRunning: this.plugin.isGraphRagIndexing(),
        isStale: false,
        partialFailureCount: 0,
      });
    const presentation = getGraphRagStatusPresentation(statusLabel);
    const cost = estimateGraphRagIndexingCost({
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? runtime.ragStatus?.totalDocuments ?? 0,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      averageChunksPerFile: 3,
      averageTokensPerChunk: 900,
      providerKind: rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')
        ? 'local'
        : 'remote',
    });
    const controls = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? runtime.ragStatus?.totalDocuments ?? 0,
      failedFileCount: graphState?.failedFileCount ?? 0,
    });
    const total = graphState?.totalCandidateFiles ?? 0;
    const done = graphState?.graphEvidenceCount ?? 0;
    const failed = graphState?.failedFileCount ?? 0;
    const stale = graphState?.staleFileCount ?? 0;
    if (this.graphRagSummaryBanner) {
      const summaryText =
        total > 0
          ? t('settingsAuto030', {
              v0: String(total),
              v1: String(done),
              v2: String(failed > 0 ? t('settingsAuto031', { v0: String(failed) }) : ''),
              v3: String(stale > 0 ? t('settingsAuto032', { v0: String(stale) }) : ''),
            })
          : t('settingsAuto033');
      this.graphRagSummaryBanner.setText(summaryText);
    }
    if (this.graphRagStatusGrid) {
      this.graphRagStatusGrid.empty();
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto034'),
        presentation.label,
        presentation.description,
        presentation.tone,
      );
      this.createRagStatusItem(this.graphRagStatusGrid, t('settingsAuto035'), String(total));
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto036'),
        String(done),
        t('settingsAuto036Desc'),
        'success',
      );
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto037'),
        String(failed),
        failed > 0 ? t('settingsAuto038') : t('settingsAuto039'),
      );
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto040'),
        String(stale),
        stale > 0 ? t('settingsAuto041') : t('settingsAuto042'),
        stale > 0 ? 'warning' : 'success',
      );
      this.createRagStatusItem(this.graphRagStatusGrid, t('settingsAuto043'), cost.costLabel);
      const runnerInfo = (
        this.plugin as unknown as {
          graphRagIndexingRunner?: {
            getLastCommunityResult(): {
              communityCount: number;
              modularity: number;
            } | null;
          } | null;
        }
      ).graphRagIndexingRunner;
      const lastCommunity = runnerInfo?.getLastCommunityResult();
      if (lastCommunity) {
        this.createRagStatusItemWithDesc(
          this.graphRagStatusGrid,
          t('settingsAuto044'),
          String(lastCommunity.communityCount),
          t('graphRagModularityDetail', { value: lastCommunity.modularity.toFixed(3) }),
        );
      }
    }
    if (this.graphRagActionsGroup) {
      const syncButtonState = getGraphRagControlState({
        enabled: rag.graphRagEnabled,
        hasProvider: this.plugin.hasGraphRagRunner(),
        hasModel: rag.graphRagModel.trim().length > 0,
        isRunning: this.plugin.isGraphRagIndexing(),
        totalCandidateFiles: stale,
        failedFileCount: 0,
      }).start;
      const communityButtonState = {
        disabled:
          !rag.graphRagEnabled ||
          !this.plugin.hasGraphRagRunner() ||
          !rag.graphRagModel.trim() ||
          this.plugin.isGraphRagIndexing(),
        reason: !rag.graphRagEnabled
          ? t('settingsAuto062')
          : !rag.graphRagModel.trim()
            ? t('settingsAuto064')
            : !this.plugin.hasGraphRagRunner()
              ? t('settingsAuto063')
              : this.plugin.isGraphRagIndexing()
                ? t('settingsAuto065')
                : null,
      };
      const hasDetailData = done > 0;
      const detailState = {
        disabled: !hasDetailData,
        reason: hasDetailData ? null : t('settingsAuto066'),
      };
      const resetGraphRagState = {
        disabled: !rag.graphRagEnabled || this.plugin.isGraphRagIndexing(),
        reason: !rag.graphRagEnabled
          ? t('settingsAuto062')
          : this.plugin.isGraphRagIndexing()
            ? t('settingsAuto065')
            : null,
      };
      this.renderGraphRagActions(this.graphRagActionsGroup, {
        controls,
        syncButtonState,
        communityButtonState,
        detailButtonState: detailState,
        resetGraphRag: resetGraphRagState,
        cost,
        totalCandidateFiles: total,
        maxFilesPerRun: rag.graphRagMaxFilesPerRun,
        failedFileCount: failed,
        staleFileCount: stale,
      });
    }
  }
  private renderGraphRagActions(
    containerEl: HTMLElement,
    input: {
      controls: ReturnType<typeof getGraphRagControlState>;
      syncButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      resetGraphRag: {
        disabled: boolean;
        reason: string | null;
      };
      communityButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      detailButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      cost: {
        costLabel: string;
      };
      totalCandidateFiles: number;
      maxFilesPerRun: number;
      failedFileCount: number;
      staleFileCount: number;
    },
  ): void {
    containerEl.empty();
    const groups = buildGraphRagActionGroups({
      controls: input.controls,
      syncStale: input.syncButtonState,
      buildCommunities: input.communityButtonState,
      resetGraphRag: input.resetGraphRag,
      openExplorer: input.detailButtonState,
      totalCandidateFiles: input.totalCandidateFiles,
      maxFilesPerRun: input.maxFilesPerRun,
      failedFileCount: input.failedFileCount,
      staleFileCount: input.staleFileCount,
    });
    const actions = groups.flatMap((group) => group.actions);
    const unavailableReason = actions.every((action) => action.state.disabled)
      ? actions.find((action) => action.state.reason)?.state.reason
      : null;
    if (unavailableReason) {
      containerEl.createDiv({
        cls: 'superpower-inside-rag-action-availability',
        text: unavailableReason,
      });
    }
    for (const group of groups) {
      const groupEl = containerEl.createDiv({ cls: 'superpower-inside-rag-action-group' });
      groupEl.createDiv({ cls: 'superpower-inside-rag-action-group-title', text: group.label });
      const listEl = groupEl.createDiv({ cls: 'superpower-inside-rag-action-list' });
      for (const action of group.actions) {
        this.createGraphRagActionRow(listEl, action, input.cost);
      }
    }
  }
  private createGraphRagActionRow(
    containerEl: HTMLElement,
    action: GraphRagActionDefinition,
    cost: {
      costLabel: string;
    },
  ): void {
    const item = containerEl.createDiv({
      cls: `superpower-inside-rag-row superpower-inside-rag-action-row is-${action.tone}`,
    });
    const copy = item.createDiv({ cls: 'superpower-inside-rag-action-copy' });
    copy.createDiv({ cls: 'superpower-inside-rag-action-label', text: action.label });
    copy.createDiv({ cls: 'superpower-inside-rag-action-desc', text: action.description });
    const button = item.createEl('button', { attr: { type: 'button' } });
    setIcon(button, action.iconName);
    button.createSpan({ text: action.label });
    button.disabled = action.state.disabled;
    button.title = action.state.reason ?? action.description;
    button.addEventListener('click', () => {
      void this.handleGraphRagAction(action, cost);
    });
  }
  private async handleGraphRagAction(
    action: GraphRagActionDefinition,
    cost: {
      costLabel: string;
    },
  ): Promise<void> {
    switch (action.id) {
      case 'start': {
        if (!(await this.confirmGraphRagRemoteRun(cost))) return;
        const result = await this.plugin.runGraphRagIndexing();
        this.showGraphRagResult(result, 'start');
        this.updateGraphRagStats();
        return;
      }
      case 'cancel':
        this.plugin.cancelGraphRagIndexing();
        new Notice(t('settingsAuto068'));
        this.updateGraphRagStats();
        return;
      case 'resumeFailed': {
        if (!(await this.confirmGraphRagRemoteRun(cost))) return;
        const result = await this.plugin.resumeGraphRagIndexing();
        this.showGraphRagResult(result, 'resumeFailed');
        this.updateGraphRagStats();
        return;
      }
      case 'syncStale': {
        if (!(await this.confirmGraphRagRemoteRun(cost))) return;
        const result = await this.plugin.syncStaleGraphRag();
        this.showGraphRagResult(result, 'syncStale');
        this.updateGraphRagStats();
        return;
      }
      case 'buildCommunities': {
        if (!(await this.confirmGraphRagRemoteRun(cost))) return;
        const result = await this.plugin.buildGraphRagCommunities();
        if (result) {
          new Notice(
            t('settingsAuto069', {
              v0: String(result.communityCount),
              v1: String(result.modularity.toFixed(3)),
              v2: String((result.durationMs / 1000).toFixed(1)),
            }),
          );
        }
        this.updateGraphRagStats();
        return;
      }
      case 'openExplorer':
        this.plugin.openGraphRagView();
        return;
      case 'resetGraphRag': {
        if (!(await this.confirmGraphRagReset())) {
          return;
        }
        try {
          await this.plugin.resetGraphRagData();
          new Notice(t('graphRagResetDataDone'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(t('graphRagResetDataFailed', { v0: message }));
        }
        this.updateGraphRagStats();
        return;
      }
    }
  }
  private async confirmGraphRagRemoteRun(cost: { costLabel: string }): Promise<boolean> {
    if (cost.costLabel !== t('settingsAuto070')) return true;
    return confirmWithModal(this.app, t('settingsAuto071'));
  }

  private confirmGraphRagReset(): Promise<boolean> {
    return confirmWithModal(this.app, t('graphRagResetDataConfirm'));
  }
  private showGraphRagResult(
    result: GraphRagIndexingResult | null,
    scope: GraphRagIndexingResultNoticeScope,
  ): void {
    new Notice(getGraphRagIndexingResultNotice(result, scope));
  }
  /** RefreshBus 'rag' 이벤트 수신 시 인덱스 통계 그리드를 갱신합니다. */
  private refreshStatsGrid(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const grid = ragTab.querySelector<HTMLElement>('.superpower-inside-stats-grid');
    if (!grid) return;
    void this.renderStats(grid);
  }
  /** RefreshBus 'rag' 이벤트 수신 시 파일 형식 요약을 갱신합니다. */
  private refreshFileTypeSummary(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const contentEl = ragTab.querySelector<HTMLElement>('.superpower-inside-rag-file-types');
    if (!contentEl) return;
    void (async () => {
      contentEl.empty();
      contentEl.setText(t('settingsAuto075'));
      try {
        const summary = await getRagFileTypeSummary(
          this.app.vault,
          this.plugin.settings.rag,
          this.plugin.settings.chat,
        );
        contentEl.empty();
        this.renderTargetFileTypeCounts(contentEl, summary.targetTypes);
        this.renderExcludeRecommendations(contentEl, summary.excludeRecommendations);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        contentEl.setText(t('settingsAuto076', { v0: String(msg) }));
      }
    })();
  }
  /** RefreshBus 'mcp' 이벤트 수신 시 MCP 상태 섹션을 갱신합니다. */
  private refreshMcpStatusSection(): void {
    const mcpTab = this.tabPanels.get('mcp');
    if (!mcpTab) return;
    const statusSection = mcpTab.querySelector<HTMLElement>('.superpower-inside-mcp-status');
    if (!statusSection) return;
    this.renderMCPStatus(statusSection);
  }
  private getIndexingStatusLabel(): string {
    const status = this.plugin.getRagRuntimeState().ragIndexingStatus;
    if (!status) return this.plugin.isRagIndexing() ? t('settingsAuto077') : t('settingsAuto078');
    if (status.running) {
      return this.formatRunningRagIndexingStatus(status);
    }
    if (status.lastResult) {
      return t('settingsAuto080', {
        v0: String(status.lastResult.indexed),
        v1: String(status.lastResult.vectors),
      });
    }
    return t('settingsAuto078');
  }
  private formatRunningRagIndexingStatus(status: RagIndexingSchedulerStatus): string {
    const progress = status.progress;
    const phase = this.formatRagIndexingPhase(status.phase);
    if (!progress || progress.totalFiles <= 0) {
      return t('settingsAuto079', { v0: phase, v1: String(status.queuedFiles) });
    }
    const completed = Math.min(progress.completedFiles, progress.totalFiles);
    const eta = progress.eta;
    const etaReason = this.formatRagEtaConfidenceReason(
      eta?.etaConfidenceReason ?? eta?.confidenceReason,
    );
    if (
      !eta ||
      eta.remainingMs === null ||
      eta.confidence === 'calculating' ||
      eta.confidence === 'low'
    ) {
      return t('ragIndexingRunningEtaCalculatingReason', {
        phase,
        completed: String(completed),
        total: String(progress.totalFiles),
        reason: etaReason,
      });
    }
    if (eta.confidence === 'medium') {
      return t('ragIndexingRunningWithApproxEtaReason', {
        phase,
        completed: String(completed),
        total: String(progress.totalFiles),
        eta: this.formatEtaDuration(eta.remainingMs),
        reason: etaReason,
      });
    }
    return t('ragIndexingRunningWithEtaReason', {
      phase,
      completed: String(completed),
      total: String(progress.totalFiles),
      eta: this.formatEtaDuration(eta.remainingMs),
      reason: etaReason,
    });
  }
  private formatRagIndexingPhase(phase: RagIndexingSchedulerStatus['phase']): string {
    if (phase === 'file') return t('ragPhaseFile');
    if (phase === 'pending') return t('ragPhasePending');
    if (phase === 'all') return t('ragPhaseAll');
    return t('ragPhaseIdle');
  }
  private formatEtaDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
      return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  private formatRagEtaConfidenceReason(reason: string | undefined): string {
    switch (reason) {
      case 'complete':
        return t('ragEtaReasonComplete');
      case 'planned-stable':
        return t('ragEtaReasonPlannedStable');
      case 'planned-variable-rate':
        return t('ragEtaReasonPlannedVariableRate');
      case 'planned-partial':
        return t('ragEtaReasonPlannedPartial');
      case 'insufficient-samples':
        return t('ragEtaReasonInsufficientSamples');
      case 'calibration-variable':
        return t('ragEtaReasonCalibrationVariable');
      case 'calibrated-estimate':
        return t('ragEtaReasonCalibratedEstimate');
      case 'batch-rate-only':
        return t('ragEtaReasonBatchRateOnly');
      case 'elapsed-rate-only':
        return t('ragEtaReasonElapsedRateOnly');
      default:
        return t('ragEtaReasonInsufficientSamples');
    }
  }
  private buildEmbeddingProviderSection(containerEl: HTMLElement): void {
    const ANCHOR_CLS = 'si-embedding-anchor';
    const WARNING_CLS = 'si-embedding-warning';
    const MODEL_DESC_CLS = 'si-embedding-model-desc';
    // Phase 1: anchor-based position preservation — stay between Controls and Exclude
    const existingAnchor = containerEl.querySelector(`:scope > .${ANCHOR_CLS}`);
    let section: HTMLElement;
    if (existingAnchor) {
      section = this.createRagGroup(
        containerEl,
        t('settingsAuto081'),
        undefined,
        'superpower-inside-rag-embedding-panel',
      );
      const oldSection = existingAnchor.previousElementSibling;
      if (oldSection?.classList.contains('superpower-inside-rag-group')) {
        oldSection.remove();
      }
      existingAnchor.replaceWith(section);
    } else {
      section = this.createRagGroup(
        containerEl,
        t('settingsAuto081'),
        undefined,
        'superpower-inside-rag-embedding-panel',
      );
    }
    // Place new anchor after section for future rebuilds
    const newAnchor = createDiv({ cls: ANCHOR_CLS });
    section.after(newAnchor);
    {
      const ragConfig = this.plugin.settings.rag;
      const effectiveModelRef = this.pendingEmbeddingModel ?? ragConfig.embeddingModelRef ?? '';
      const profileModelOptions = buildEmbeddingProfileModelOptions(this.plugin.settings, {
        currentModel: effectiveModelRef,
        includeEmpty: true,
        emptyLabel: t('settingsAuto008'),
      });
      const isProfilePending = this.pendingEmbeddingModel !== null;
      const profileNotice = section.createDiv({ cls: 'superpower-inside-model-description' });
      profileNotice.setText(t('settingsAuto087'));
      if (isProfilePending) {
        const warningEl = section.createDiv({
          cls: `${WARNING_CLS} superpower-inside-settings-warning superpower-inside-embedding-pending-warning`,
        });
        warningEl.setText(t('settingsAuto083'));
      }
      new Setting(section)
        .setName(t('embeddingModel'))
        .setDesc(t('settingsAuto087'))
        .addDropdown((dropdown) => {
          for (const option of profileModelOptions) {
            dropdown.addOption(option.value, option.label);
          }
          dropdown.setValue(effectiveModelRef);
          dropdown.onChange((value) => {
            if (this.isRebuildingEmbeddingSection) return;
            this.pendingEmbeddingModel = value;
            this.isRebuildingEmbeddingSection = true;
            try {
              this.buildEmbeddingProviderSection(containerEl);
            } finally {
              this.isRebuildingEmbeddingSection = false;
            }
          });
        });
      const localNote = section.createDiv({ cls: 'superpower-inside-rag-local-embedding-note' });
      const icon = localNote.createSpan({ cls: 'superpower-inside-rag-local-embedding-icon' });
      setIcon(icon, 'shield-check');
      const copy = localNote.createDiv({ cls: 'superpower-inside-rag-local-embedding-copy' });
      copy.createDiv({
        cls: 'superpower-inside-rag-local-embedding-title',
        text: t('ragLocalEmbeddingTitle'),
      });
      copy.createDiv({
        cls: 'superpower-inside-rag-local-embedding-detail',
        text: t('ragLocalEmbeddingDetail'),
      });
      if (isProfilePending) {
        const btnRow = section.createDiv({
          cls: 'superpower-inside-rag-controls superpower-inside-embedding-pending-actions',
        });
        const saveBtn = btnRow.createEl('button', { text: t('settingsAuto088') });
        saveBtn.addEventListener('click', () => {
          void (async () => {
            if (this.isRebuildingEmbeddingSection) return;
            const nextRef = this.pendingEmbeddingModel ?? '';
            const resolved = resolveProviderModelRef(this.plugin.settings, nextRef, 'embedding');
            ragConfig.embeddingModelRef = nextRef;
            if (resolved) {
              ragConfig.embeddingModel = resolved.modelId;
              ragConfig.embeddingProvider =
                resolved.profile.strategy === 'openAICompatible'
                  ? `customOpenAI:${resolved.profile.id}`
                  : (resolved.profile.strategy as EmbeddingProviderKey);
            }
            this.pendingEmbeddingModel = null;
            await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false });
            this.isRebuildingEmbeddingSection = true;
            try {
              this.buildEmbeddingProviderSection(containerEl);
            } finally {
              this.isRebuildingEmbeddingSection = false;
            }
          })();
        });
        const cancelBtn = btnRow.createEl('button', { text: t('settingsAuto092') });
        cancelBtn.addEventListener('click', () => {
          if (this.isRebuildingEmbeddingSection) return;
          this.pendingEmbeddingModel = null;
          this.isRebuildingEmbeddingSection = true;
          try {
            this.buildEmbeddingProviderSection(containerEl);
            new Notice(t('settingsAuto093'));
          } finally {
            this.isRebuildingEmbeddingSection = false;
          }
        });
      }
      const statusEl = section.createDiv({ cls: 'superpower-inside-connection-status' });
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      new Setting(section)
        .setName(t('settingsAuto099'))
        .setDesc(t('settingsAuto100'))
        .addButton((button) => {
          button.setButtonText(t('settingsAuto099'));
          button.onClick(async () => {
            await runActionWithFeedback({
              button,
              loadingText: t('testing'),
              action: async () => {
                statusEl.setText(t('testing'));
                const resolved = resolveProviderModelRef(
                  this.plugin.settings,
                  effectiveModelRef,
                  'embedding',
                );
                if (!resolved) {
                  const detail = t('ragIndexerSelectEmbeddingModel');
                  statusEl.setText(detail);
                  return { status: 'noop', detail };
                }
                try {
                  const { testEmbeddingGenerationForStrategy } = await import('./llm/validation');
                  const result = await testEmbeddingGenerationForStrategy(
                    resolved.profile.strategy,
                    resolved.modelId,
                    {
                      ...resolved.profile,
                      models: resolved.profile.models.map((model) => model.id),
                    },
                    this.getTernlightRuntimeOptions(),
                  );
                  if (result.valid) {
                    resolved.profile.models = upsertProviderProfileModel(
                      resolved.profile.models,
                      createProviderModel(resolved.modelId, 'embedding', {
                        embeddingStatus: 'success',
                        lastCheckedAt: Date.now(),
                      }),
                    );
                    await this.plugin.saveSettingsLight();
                    const detail = t('settingsAuto101', { v0: String(resolved.modelId) });
                    statusEl.setText(detail);
                    return { status: 'success', detail };
                  }
                  resolved.profile.models = upsertProviderProfileModel(
                    resolved.profile.models,
                    createProviderModel(resolved.modelId, 'embedding', {
                      embeddingStatus: 'failed',
                      lastError: String(result.error),
                      lastCheckedAt: Date.now(),
                    }),
                  );
                  await this.plugin.saveSettingsLight();
                  const detail = t('settingsAuto102', { v0: String(result.error) });
                  statusEl.setText(detail);
                  return { status: 'error', detail: String(result.error), notice: detail };
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  const detail = t('settingsAuto098', { v0: String(msg) });
                  statusEl.setText(detail);
                  return { status: 'error', detail: msg, notice: detail };
                }
              },
            });
          });
        });
      return;
    }
    const rag = this.plugin.settings.rag;
    const effectiveProvider = this.pendingEmbeddingProvider ?? rag.embeddingProvider;
    const effectiveModel = this.pendingEmbeddingModel ?? rag.embeddingModel;
    const builtInProvider = isCustomOpenAIEmbeddingProviderKey(effectiveProvider)
      ? null
      : effectiveProvider;
    const embeddingModels = buildEmbeddingModels();
    const modelsForProvider =
      builtInProvider === null
        ? []
        : embeddingModels[builtInProvider as BuiltInEmbeddingProviderKey];
    const isOther = effectiveProvider === 'other';
    const embeddingValidationConfig = isOther
      ? null
      : this.getEmbeddingProviderConfig(effectiveProvider);
    const providerModels =
      isOther || effectiveProvider === null
        ? []
        : this.getEmbeddingProviderModels(effectiveProvider);
    const modelCapabilities =
      !isOther && effectiveProvider !== null && embeddingValidationConfig
        ? this.getProviderModelCapabilities(
            effectiveProvider,
            embeddingValidationConfig as ProviderConfig | CustomOpenAIProviderConfig,
          )
        : {};
    const modelOptions = isOther
      ? []
      : buildEmbeddingModelOptions(
          modelsForProvider,
          providerModels,
          effectiveModel,
          modelCapabilities,
        );
    const isPending = this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null;
    const providerNotice = section.createDiv({ cls: 'superpower-inside-model-description' });
    providerNotice.setText(t('settingsAuto082'));
    if (effectiveProvider === 'ternlight') {
      const localNote = section.createDiv({ cls: 'superpower-inside-rag-local-embedding-note' });
      const icon = localNote.createSpan({ cls: 'superpower-inside-rag-local-embedding-icon' });
      setIcon(icon, 'shield-check');
      const copy = localNote.createDiv({ cls: 'superpower-inside-rag-local-embedding-copy' });
      copy.createDiv({
        cls: 'superpower-inside-rag-local-embedding-title',
        text: t('ragLocalEmbeddingTitle'),
      });
      copy.createDiv({
        cls: 'superpower-inside-rag-local-embedding-detail',
        text: t('ragLocalEmbeddingDetail'),
      });
    }
    if (isPending) {
      const warningEl = section.createDiv({
        cls: `${WARNING_CLS} superpower-inside-settings-warning superpower-inside-embedding-pending-warning`,
      });
      warningEl.setText(t('settingsAuto083'));
    }
    new Setting(section)
      .setName(t('embeddingProvider'))
      .setDesc(t('settingsAuto084'))
      .addDropdown((dropdown) => {
        for (const option of buildEmbeddingProviderOptions(
          this.plugin.settings.customOpenAIProviders,
        )) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(effectiveProvider);
        dropdown.onChange((value) => {
          if (this.isRebuildingEmbeddingSection) return;
          const nextProvider = value as EmbeddingProviderKey;
          this.pendingEmbeddingProvider = nextProvider;
          if (nextProvider === 'other') {
            this.pendingEmbeddingModel = '';
          } else {
            const nextBuiltInProvider = isCustomOpenAIEmbeddingProviderKey(nextProvider)
              ? null
              : nextProvider;
            const nextModels = buildEmbeddingModelOptions(
              nextBuiltInProvider ? embeddingModels[nextBuiltInProvider] : [],
              this.getEmbeddingProviderModels(nextProvider),
              '',
              (() => {
                const nextConfig = this.getEmbeddingProviderConfig(nextProvider);
                return nextConfig
                  ? this.getProviderModelCapabilities(nextProvider, nextConfig)
                  : {};
              })(),
            );
            this.pendingEmbeddingModel = selectInitialEmbeddingModel(nextModels);
          }
          this.isRebuildingEmbeddingSection = true;
          try {
            this.buildEmbeddingProviderSection(containerEl);
          } finally {
            this.isRebuildingEmbeddingSection = false;
          }
        });
      });
    if (isOther) {
      new Setting(section)
        .setName(t('embeddingModelId'))
        .setDesc(t('settingsAuto085'))
        .addText((text) =>
          text
            .setValue(effectiveModel)
            .setPlaceholder(t('settingsAuto086'))
            .onChange((value) => {
              if (this.isRebuildingEmbeddingSection) return;
              this.pendingEmbeddingModel = value.trim();
            }),
        );
    } else if (modelOptions.length > 0) {
      new Setting(section)
        .setName(t('embeddingModel'))
        .setDesc(t('settingsAuto087'))
        .addDropdown((dropdown) => {
          for (const model of modelOptions) {
            dropdown.addOption(model.id, model.label);
          }
          dropdown.setValue(effectiveModel);
          dropdown.onChange((value) => {
            if (this.isRebuildingEmbeddingSection) return;
            this.pendingEmbeddingModel = value;
            // Partial update: model description only
            const descEl = section.querySelector(`.${MODEL_DESC_CLS}`);
            const selectedModel = modelOptions.find((m) => m.id === value);
            if (descEl) {
              descEl.setText(selectedModel?.description ?? '');
            }
            // Show pending UI if not already visible
            if (!section.querySelector(`.${WARNING_CLS}`)) {
              this.isRebuildingEmbeddingSection = true;
              try {
                this.buildEmbeddingProviderSection(containerEl);
              } finally {
                this.isRebuildingEmbeddingSection = false;
              }
            }
          });
        });
      const selectedModel = modelOptions.find((m) => m.id === effectiveModel);
      const descEl = section.createDiv({
        cls: `superpower-inside-model-description ${MODEL_DESC_CLS}`,
      });
      descEl.setText(selectedModel?.description ?? '');
    }
    if (isPending) {
      const btnRow = section.createDiv({
        cls: 'superpower-inside-rag-controls superpower-inside-embedding-pending-actions',
      });
      const saveBtn = btnRow.createEl('button', { text: t('settingsAuto088') });
      saveBtn.addEventListener('click', () => {
        void (async () => {
          if (this.isRebuildingEmbeddingSection) return;
          saveBtn.disabled = true;
          saveBtn.setText(t('settingsAuto089'));
          try {
            if (this.pendingEmbeddingProvider !== null) {
              rag.embeddingProvider = this.pendingEmbeddingProvider;
            }
            if (this.pendingEmbeddingModel !== null) {
              rag.embeddingModel = this.pendingEmbeddingModel;
            }
            this.pendingEmbeddingProvider = null;
            this.pendingEmbeddingModel = null;
            await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false });
            new Notice(t('settingsAuto090'));
          } catch (err) {
            new Notice(
              t('settingsAuto091', {
                v0: String(err instanceof Error ? err.message : String(err)),
              }),
              6000,
            );
          } finally {
            saveBtn.disabled = false;
            saveBtn.setText(t('settingsAuto088'));
            this.isRebuildingEmbeddingSection = true;
            try {
              this.buildEmbeddingProviderSection(containerEl);
            } finally {
              this.isRebuildingEmbeddingSection = false;
            }
          }
        })();
      });
      const cancelBtn = btnRow.createEl('button', { text: t('settingsAuto092') });
      cancelBtn.addEventListener('click', () => {
        if (this.isRebuildingEmbeddingSection) return;
        this.pendingEmbeddingProvider = null;
        this.pendingEmbeddingModel = null;
        this.isRebuildingEmbeddingSection = true;
        try {
          this.buildEmbeddingProviderSection(containerEl);
          new Notice(t('settingsAuto093'));
        } finally {
          this.isRebuildingEmbeddingSection = false;
        }
      });
    }
    const statusEl = section.createDiv({ cls: 'superpower-inside-connection-status' });
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    const getEmbeddingValidationConfig = (): ProviderConfig | CustomOpenAIProviderConfig =>
      effectiveProvider === 'other'
        ? { apiKey: '', models: [], enabled: false }
        : (this.getEmbeddingProviderConfig(effectiveProvider) ?? {
            apiKey: '',
            models: [],
            enabled: false,
          });
    new Setting(section)
      .setName(t('settingsAuto094'))
      .setDesc(t('settingsAuto095'))
      .addButton((button) => {
        button.setButtonText(t('testConnection'));
        button.onClick(async () => {
          await runActionWithFeedback({
            button,
            loadingText: t('testing'),
            action: async () => {
              statusEl.setText(t('testing'));
              try {
                const { validateEmbeddingConnection } = await import('./llm/validation');
                const result = await validateEmbeddingConnection(
                  effectiveProvider,
                  effectiveModel,
                  getEmbeddingValidationConfig(),
                  this.getTernlightRuntimeOptions(),
                );
                if (result.valid) {
                  if (effectiveProvider !== 'other') {
                    await this.recordProviderValidation(
                      effectiveProvider,
                      getEmbeddingValidationConfig(),
                      {
                        connectionTested: true,
                        serverReachable: true,
                        lastError: undefined,
                      },
                    );
                  }
                  const detail = t('settingsAuto096', { v0: String(result.models.length) });
                  statusEl.setText(detail);
                  return { status: 'success', detail };
                }
                if (effectiveProvider !== 'other') {
                  await this.recordProviderValidation(
                    effectiveProvider,
                    getEmbeddingValidationConfig(),
                    {
                      connectionTested: false,
                      lastError: String(result.error),
                    },
                  );
                }
                const detail = t('settingsAuto097', { v0: String(result.error) });
                statusEl.setText(detail);
                return { status: 'error', detail: String(result.error), notice: detail };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const detail = t('settingsAuto098', { v0: String(msg) });
                statusEl.setText(detail);
                return { status: 'error', detail: msg, notice: detail };
              }
            },
          });
        });
      });
    new Setting(section)
      .setName(t('settingsAuto099'))
      .setDesc(t('settingsAuto100'))
      .addButton((button) => {
        button.setButtonText(t('settingsAuto099'));
        button.onClick(async () => {
          await runActionWithFeedback({
            button,
            loadingText: t('testing'),
            action: async () => {
              statusEl.setText(t('testing'));
              try {
                const { testEmbeddingGeneration } = await import('./llm/validation');
                const result = await testEmbeddingGeneration(
                  effectiveProvider,
                  effectiveModel,
                  getEmbeddingValidationConfig(),
                  this.getTernlightRuntimeOptions(),
                );
                if (result.valid) {
                  if (effectiveProvider !== 'other') {
                    await this.recordModelCapability(
                      effectiveProvider,
                      getEmbeddingValidationConfig(),
                      effectiveModel,
                      'embeddingStatus',
                      'success',
                    );
                  }
                  const detail = t('settingsAuto101', { v0: String(effectiveModel) });
                  statusEl.setText(detail);
                  return { status: 'success', detail };
                }
                if (effectiveProvider !== 'other') {
                  await this.recordModelCapability(
                    effectiveProvider,
                    getEmbeddingValidationConfig(),
                    effectiveModel,
                    'embeddingStatus',
                    'failed',
                    String(result.error),
                  );
                }
                const detail = t('settingsAuto102', { v0: String(result.error) });
                statusEl.setText(detail);
                return { status: 'error', detail: String(result.error), notice: detail };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const detail = t('settingsAuto098', { v0: String(msg) });
                statusEl.setText(detail);
                return { status: 'error', detail: msg, notice: detail };
              }
            },
          });
        });
      });
  }
  private buildStatsSection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(containerEl, t('settingsAuto103'));
    const grid = section.createDiv({ cls: 'superpower-inside-stats-grid' });
    // 통계 비동기 로드
    this.renderStats(grid).catch(() => {
      grid.setText(t('settingsAuto104'));
    });
  }
  private async renderStats(gridEl: HTMLElement): Promise<void> {
    const status = await this.getRagStatus();
    gridEl.empty();
    if (!status) {
      gridEl.setText(t('settingsAuto105'));
      return;
    }
    const stats = [
      {
        value: String(status.totalDocuments),
        label: t('settingsAuto106'),
        desc: t('settingsAuto107'),
      },
      {
        value: String(status.healthyDocuments),
        label: t('settingsAuto108'),
        desc: t('settingsAuto109'),
      },
      {
        value: String(status.updateRequiredDocuments.length),
        label: t('settingsAuto110'),
        desc: t('settingsAuto111'),
      },
      {
        value: String(status.totalVectors),
        label: t('settingsAuto112'),
        desc: t('settingsAuto113'),
      },
    ];
    for (const stat of stats) {
      const item = gridEl.createDiv({ cls: 'superpower-inside-rag-metric' });
      item.createDiv({ cls: 'superpower-inside-stat-value', text: stat.value });
      item.createDiv({ cls: 'superpower-inside-stat-label', text: stat.label });
      item.createDiv({ cls: 'superpower-inside-stat-desc', text: stat.desc });
    }
  }
  private buildTargetFileTypesSection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(
      containerEl,
      t('targetFileTypes'),
      t('targetFileTypesDesc'),
    );
    const contentEl = section.createDiv({ cls: 'superpower-inside-rag-file-types' });
    void (async () => {
      contentEl.setText(t('settingsAuto075'));
      try {
        const summary = await getRagFileTypeSummary(
          this.app.vault,
          this.plugin.settings.rag,
          this.plugin.settings.chat,
        );
        contentEl.empty();
        this.renderTargetFileTypeCounts(contentEl, summary.targetTypes);
        this.renderExcludeRecommendations(contentEl, summary.excludeRecommendations);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        contentEl.setText(t('settingsAuto076', { v0: String(msg) }));
      }
    })();
  }
  private renderTargetFileTypeCounts(
    containerEl: HTMLElement,
    targetTypes: {
      extension: string;
      label: string;
      count: number;
    }[],
  ): void {
    if (targetTypes.length === 0) {
      containerEl.createDiv({
        cls: 'superpower-inside-rag-empty-state',
        text: t('targetFileTypesEmpty'),
      });
      return;
    }
    const grid = containerEl.createDiv({ cls: 'superpower-inside-rag-file-type-grid' });
    for (const item of targetTypes) {
      const row = grid.createDiv({ cls: 'superpower-inside-rag-file-type-row' });
      row.createDiv({ cls: 'superpower-inside-rag-file-type-label', text: item.label });
      row.createDiv({
        cls: 'superpower-inside-rag-file-type-count',
        text: t('settingsAuto022', { v0: String(item.count) }),
      });
    }
  }
  private renderExcludeRecommendations(
    containerEl: HTMLElement,
    recommendations: {
      extension: string;
      label: string;
      count: number;
      reason: string;
    }[],
  ): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-recommendations' });
    section.createDiv({
      cls: 'superpower-inside-rag-recommendations-title',
      text: t('excludeRecommendations'),
    });
    if (recommendations.length === 0) {
      section.createDiv({
        cls: 'superpower-inside-rag-empty-state',
        text: t('excludeRecommendationEmpty'),
      });
      return;
    }
    for (const item of recommendations) {
      const row = section.createDiv({ cls: 'superpower-inside-rag-recommendation-row' });
      const body = row.createDiv({ cls: 'superpower-inside-rag-recommendation-body' });
      body.createDiv({
        cls: 'superpower-inside-rag-recommendation-label',
        text: t('settingsAuto114', { v0: String(item.label), v1: String(item.count) }),
      });
      body.createDiv({ cls: 'superpower-inside-rag-recommendation-reason', text: item.reason });
      if (item.extension === '(none)' || !isRecommendableExcludeExtension(item.extension)) continue;
      const button = row.createEl('button', {
        cls: 'superpower-inside-rag-recommendation-add',
        text: t('addExcludeExtension'),
        attr: { type: 'button' },
      });
      button.addEventListener('click', () => {
        const normalized = item.extension.trim().toLowerCase();
        if (!this.plugin.settings.rag.excludeExts.includes(normalized)) {
          this.plugin.settings.rag.excludeExts.push(normalized);
          this.debouncedRagSave();
        }
        new Notice(`${item.label} ${t('addExcludeExtensionDone')}`);
        this.updateRagStats();
      });
    }
  }
  /**
   * RefreshBus에서 rag 이벤트 수신 시 RAG 상태 패널 일부만 업데이트합니다.
   * (전체 rebuild 대신 statusGrid, timestamp, updateList 등만 갱신)
   */
  updateRagStats(indexingDetail?: string): void {
    const statusGrid = this.ragStatusGrid;
    const timestampEl = this.ragStatusTimestamp;
    const actionEl = this.ragStatusAction;
    const detailsEl = this.ragStatusDetails;
    if (!statusGrid || !timestampEl || !actionEl || !detailsEl || !timestampEl.isConnected) return;
    const isCurrentView = (): boolean =>
      timestampEl.isConnected &&
      this.ragStatusGrid === statusGrid &&
      this.ragStatusTimestamp === timestampEl &&
      this.ragStatusAction === actionEl &&
      this.ragStatusDetails === detailsEl;
    void (async () => {
      timestampEl.setText(
        indexingDetail
          ? t('settingsAuto115', { v0: String(indexingDetail) })
          : t('settingsAuto028'),
      );
      try {
        const setupWarning = this.getRagSetupWarning();
        if (setupWarning) {
          this.renderRagUnavailableState(setupWarning);
          this.updateRagControlStates(null);
          return;
        }
        const status = await this.getRagStatus();
        if (!isCurrentView()) return;
        if (status) {
          this.renderRagStatusSummary(status, indexingDetail);
          timestampEl.setText(
            indexingDetail
              ? t('settingsAuto116', {
                  v0: String(indexingDetail),
                  v1: String(new Date(status.lastCalculatedAt).toLocaleString()),
                })
              : t('settingsAuto117', {
                  v0: String(new Date(status.lastCalculatedAt).toLocaleString()),
                }),
          );
        }
        this.updateRagControlStates(status ?? null);
        // RAG 통계 섹션도 부분 업데이트
        this.updateRagStatsSection();
        this.updateRagUpdateList();
      } catch (error) {
        if (!isCurrentView()) return;
        const detail = error instanceof Error ? error.message : this.diagnoseRAGInitFailure();
        this.renderRagUnavailableState(detail);
        this.updateRagControlStates(null);
        timestampEl.setText(t('settingsAuto104'));
      }
    })();
  }
  private renderRagUnavailableState(detail: string): void {
    if (!this.ragStatusGrid || !this.ragStatusAction || !this.ragStatusDetails) return;
    this.ragStatusGrid.empty();
    const row = this.ragStatusGrid.createDiv({
      cls: 'superpower-inside-rag-row superpower-inside-rag-overview-row',
    });
    const copy = row.createDiv({ cls: 'superpower-inside-rag-overview-copy' });
    copy.createDiv({ cls: 'superpower-inside-rag-overview-title', text: t('ragOverviewTitle') });
    const statusEl = copy.createDiv({
      cls: 'superpower-inside-rag-overview-status is-danger',
      text: t('ragOverviewUnavailable'),
    });
    statusEl.setAttribute('role', 'status');
    copy.createDiv({ cls: 'superpower-inside-rag-overview-detail', text: detail });

    const actions = row.createDiv({ cls: 'superpower-inside-rag-overview-actions' });
    const resolved = resolveProviderModelRef(
      this.plugin.settings,
      this.plugin.settings.rag.embeddingModelRef ?? '',
      'embedding',
    );
    const action = actions.createEl('button', {
      cls: 'mod-cta',
      text: resolved ? t('ragOverviewCheckProvider') : t('ragOverviewFixEmbedding'),
      attr: { type: 'button' },
    });
    action.addEventListener('click', () => {
      if (resolved) {
        this.switchTab('providers');
        return;
      }
      const embeddingPanel = this.tabPanels
        .get('rag')
        ?.querySelector<HTMLElement>('.superpower-inside-rag-embedding-panel');
      embeddingPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      embeddingPanel?.querySelector<HTMLSelectElement>('select')?.focus();
    });
    this.ragStatusAction.empty();
    this.ragStatusDetails.empty();
  }
  private renderRagStatusSummary(status: RagStatusSummary, indexingDetail?: string): void {
    if (!this.ragStatusGrid || !this.ragStatusAction || !this.ragStatusDetails) return;
    const guardState = this.plugin.getRagPerformanceGuardState();
    const updateCount = status.updateRequiredDocuments.length;
    const healthyCount = Math.max(0, status.totalDocuments - updateCount);
    const isRunning = this.plugin.isRagIndexing();
    const isPaused = guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0;
    const tone = isPaused ? 'danger' : isRunning || updateCount > 0 ? 'warning' : 'success';
    const statusLabel = isRunning
      ? (indexingDetail ?? this.getIndexingStatusLabel())
      : isPaused
        ? t('ragPerformancePaused')
        : updateCount > 0
          ? t('ragOverviewNeedsUpdate', { count: String(updateCount) })
          : status.totalDocuments > 0
            ? t('ragOverviewReady')
            : t('ragOverviewEmpty');
    this.ragStatusGrid.empty();
    const row = this.ragStatusGrid.createDiv({
      cls: 'superpower-inside-rag-row superpower-inside-rag-overview-row',
    });
    const copy = row.createDiv({ cls: 'superpower-inside-rag-overview-copy' });
    copy.createDiv({ cls: 'superpower-inside-rag-overview-title', text: t('ragOverviewTitle') });
    const statusEl = copy.createDiv({
      cls: `superpower-inside-rag-overview-status is-${tone}`,
      text: statusLabel,
    });
    statusEl.setAttribute('role', 'status');
    copy.createDiv({
      cls: 'superpower-inside-rag-overview-detail',
      text: t('ragOverviewDetail', {
        healthy: String(healthyCount),
        total: String(status.totalDocuments),
        auto: this.getAutoUpdateLabel(),
      }),
    });
    this.ragStatusAction.empty();
    this.ragStatusAction.setText(this.getRagActionMessage(status, guardState));
    this.ragStatusDetails.empty();
  }
  private getRagActionMessage(
    status: RagStatusSummary,
    guardState: PerformanceGuardState | null,
  ): string {
    if (this.plugin.isRagIndexing()) {
      return t('settingsAuto130');
    }
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      return t('settingsAuto131', {
        v0: String(guardState.lastSlowReason ?? guardState.reason ?? t('settingsAuto132')),
      });
    }
    const updateCount = status.updateRequiredDocuments.length;
    if (updateCount > 0) return t('settingsAuto133', { v0: String(updateCount) });
    if (status.totalDocuments > 0) return t('settingsAuto134');
    return t('settingsAuto135');
  }
  private getAutoUpdateLabel(): string {
    if (!this.plugin.settings.rag.autoUpdateEnabled) return t('settingsAuto136');
    const runtime = this.plugin.getRagRuntimeState();
    if (runtime.lastAutoUpdateSkippedReason)
      return t('settingsAuto137', { v0: String(runtime.lastAutoUpdateSkippedReason) });
    return t('settingsAuto138');
  }
  /** RAG 통계 섹션을 부분 업데이트합니다. */
  private updateRagStatsSection(): void {
    const panel = this.ragStatusGrid?.closest('.superpower-inside-rag-status-panel');
    if (!panel) return;
    const statsEl = panel.querySelector('.superpower-inside-rag-stats');
    if (statsEl) {
      const ragTab = this.tabPanels.get('rag');
      if (ragTab) {
        const existingStats = ragTab.querySelector('.superpower-inside-rag-stats');
        if (existingStats) {
          const parent = existingStats.parentElement;
          if (parent) {
            existingStats.remove();
            const tempDiv = parent.ownerDocument.createElement('div');
            tempDiv.className = 'superpower-inside-rag-stats';
            parent.appendChild(tempDiv);
            this.buildUpdateRequiredDocumentsSection(parent);
          }
        }
      }
    }
  }
  /** 업데이트가 필요한 문서 목록을 부분 업데이트합니다. */
  private updateRagUpdateList(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const updateList = ragTab.querySelector<HTMLElement>('.superpower-inside-rag-update-list');
    if (updateList) {
      updateList.setText(t('settingsAuto146'));
      void this.getRagStatus().then((status) => {
        updateList.empty();
        if (!status) {
          updateList.setText(t('settingsAuto147'));
          return;
        }
        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          updateList.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: t('settingsAuto148'),
          });
          return;
        }
        updateList.createDiv({
          cls: 'superpower-inside-rag-update-summary',
          text: this.formatRagUpdateSummary(documents),
        });
        for (const document of documents.slice(0, 10)) {
          this.renderRagUpdateDocument(updateList, document);
        }
      });
    }
  }
  private buildUpdateRequiredDocumentsSection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(containerEl, t('settingsAuto149'));
    const listEl = section.createDiv({ cls: 'superpower-inside-rag-update-list' });
    listEl.setText(t('settingsAuto146'));
    void this.getRagStatus()
      .then((status) => {
        listEl.empty();
        if (!status) {
          listEl.setText(t('settingsAuto147'));
          return;
        }
        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          listEl.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: t('settingsAuto148'),
          });
          return;
        }
        listEl.createDiv({
          cls: 'superpower-inside-rag-update-summary',
          text: this.formatRagUpdateSummary(documents),
        });
        for (const document of documents.slice(0, 10)) {
          this.renderRagUpdateDocument(listEl, document);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        listEl.setText(t('settingsAuto150', { v0: String(msg) }));
      });
  }
  private formatRagUpdateSummary(documents: RagDocumentUpdate[]): string {
    const missingCount = documents.filter((document) => document.status === 'missing').length;
    const staleCount = documents.filter((document) => document.status === 'stale').length;
    const unknownCount = documents.filter((document) => document.status === 'unknown').length;
    return t('settingsAuto151', {
      v0: String(documents.length),
      v1: String(missingCount),
      v2: String(staleCount),
      v3: String(unknownCount),
    });
  }
  private renderRagUpdateDocument(containerEl: HTMLElement, document: RagDocumentUpdate): void {
    const row = containerEl.createDiv({ cls: 'superpower-inside-rag-update-row' });
    row.createSpan({
      cls: `superpower-inside-rag-update-badge ${document.status}`,
      text: this.getRagStatusLabel(document.status),
    });
    const body = row.createDiv({ cls: 'superpower-inside-rag-update-body' });
    body.createDiv({ cls: 'superpower-inside-rag-update-path', text: document.path });
    body.createDiv({ cls: 'superpower-inside-rag-update-reason', text: document.reason });
  }
  private getRagStatusLabel(status: RagDocumentUpdate['status']): string {
    if (status === 'missing') return t('settingsAuto152');
    if (status === 'stale') return t('settingsAuto153');
    return t('settingsAuto154');
  }
  private async getRagStatus(signal?: AbortSignal): Promise<RagStatusSummary | null> {
    const runtime = this.plugin.getRagRuntimeState();
    // 캐시된 eventDrivenRagStats가 있으면 우선 사용 (백그라운드 타이머가 자동 갱신)
    if (runtime.ragStatus) {
      return runtime.ragStatus;
    }
    if (!runtime.vectorStore) {
      const initialized = await this.plugin.ensureRagRuntimeInitialized();
      if (!initialized) {
        return this.plugin.getRagRuntimeState().ragStatus;
      }
    }
    const latestRuntime = this.plugin.getRagRuntimeState();
    const vectorStore = latestRuntime.vectorStore;
    if (vectorStore) {
      return calculateRagStatus(
        this.plugin.app.vault,
        vectorStore,
        this.plugin.settings.rag,
        this.plugin.settings.chat,
        signal,
      );
    }
    return latestRuntime.ragStatus;
  }
  private getEmbeddingProviderConfig(
    providerKey: EmbeddingProviderKey,
  ): ProviderConfig | CustomOpenAIProviderConfig | null {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      return (
        this.plugin.settings.customOpenAIProviders.find((provider) => provider.id === providerId) ??
        null
      );
    }
    if (providerKey === 'other') {
      return null;
    }
    if (providerKey === 'ternlight') {
      return {
        apiKey: '',
        baseUrl: '',
        models: buildEmbeddingModels().ternlight.map((model) => model.id),
        enabled: true,
      };
    }
    return this.plugin.settings[providerKey];
  }
  private getEmbeddingProviderModels(providerKey: EmbeddingProviderKey): string[] {
    return this.getEmbeddingProviderConfig(providerKey)?.models ?? [];
  }
  private getEmbeddingProviderLabel(providerKey: EmbeddingProviderKey): string {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      const provider = this.plugin.settings.customOpenAIProviders.find(
        (item) => item.id === providerId,
      );
      return provider?.name.trim() || 'Custom OpenAI-Compatible';
    }
    return EMBEDDING_PROVIDER_LABELS[providerKey];
  }
  private getRagSetupWarning(): string | null {
    const rag = this.plugin.settings.rag;
    const resolved = resolveProviderModelRef(
      this.plugin.settings,
      rag.embeddingModelRef ?? '',
      'embedding',
    );
    if (!resolved) return t('ragIndexerSelectEmbeddingModel');
    const label =
      resolved.profile.name.trim() || PROVIDER_STRATEGY_LABELS[resolved.profile.strategy];
    if (!resolved.profile.enabled) {
      return t('ragIndexerEnableProvider', { provider: label });
    }
    if (
      shouldRequireProviderApiKey(this.getProfileApiKeyVisibilityKey(resolved.profile)) &&
      !resolved.profile.apiKey.trim()
    ) {
      return t('settingsAuto156', { v0: label });
    }
    return null;
  }
  private diagnoseRAGInitFailure(): string {
    const runtime = this.plugin.getRagRuntimeState();
    if (runtime.lastInitError) {
      return t('ragIndexerLastInitError', { message: runtime.lastInitError });
    }
    if (runtime.lastInitSkippedReason) {
      return t('ragIndexerLastInitSkipped', { reason: runtime.lastInitSkippedReason });
    }
    const rag = this.plugin.settings.rag;
    const providerKey = rag.embeddingProvider;
    if (providerKey !== 'other') {
      const config = this.getEmbeddingProviderConfig(providerKey);
      const label = this.getEmbeddingProviderLabel(providerKey);
      if (!config?.enabled) {
        return t('settingsAuto158', { v0: String(label) });
      }
      const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
        ? 'customOpenAI'
        : providerKey;
      if (shouldRequireProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
        return t('settingsAuto159', { v0: String(label) });
      }
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return t('settingsAuto160');
      }
    } else {
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return t('settingsAuto161');
      }
    }
    return t('settingsAuto162', {
      v0: String(this.getEmbeddingProviderLabel(providerKey)),
      v1: String(rag.embeddingModel),
    });
  }
  private getRagRuntimeAccess(): {
    vectorStore?: VectorStore;
    embeddingProvider?: {
      clearCache(): Promise<void>;
    };
    ragIndexingScheduler?: RAGIndexingScheduler;
    hasIndexer: boolean;
  } {
    const runtime = this.plugin.getRagRuntimeState();
    return {
      vectorStore: runtime.vectorStore ?? undefined,
      embeddingProvider: runtime.embeddingProvider ?? undefined,
      ragIndexingScheduler: runtime.ragIndexingScheduler ?? undefined,
      hasIndexer: runtime.hasIndexer,
    };
  }
  private async ensureRagRuntimeAccess(): Promise<ReturnType<typeof this.getRagRuntimeAccess>> {
    const current = this.getRagRuntimeAccess();
    if (current.hasIndexer) {
      return current;
    }
    await this.plugin.ensureRagRuntimeInitialized();
    return this.getRagRuntimeAccess();
  }
  private buildControlsSection(containerEl: HTMLElement): void {
    const controls = containerEl.createDiv({ cls: 'superpower-inside-rag-primary-actions' });
    const runtime = this.getRagRuntimeAccess();
    const hasIndexer = runtime.hasIndexer;
    const isIndexing = this.plugin.isRagIndexing();
    const primaryControls = controls.createDiv({ cls: 'superpower-inside-rag-controls-group' });
    primaryControls.createEl('button', { text: t('settingsAuto127') }, (btn) => {
      this.updatePendingButton = btn;
      btn.disabled = true;
      void this.getRagStatus().then((status) => {
        this.updateRagControlStates(status);
      });
      btn.addEventListener('click', () => {
        void runActionWithFeedback({
          button: btn,
          loadingText: t('indexingStarted'),
          refreshBus: this.plugin.refreshBus,
          refreshDomains: ['rag'],
          action: async () => {
            const latestRuntime = await this.ensureRagRuntimeAccess();
            if (!latestRuntime.hasIndexer || !latestRuntime.ragIndexingScheduler) {
              return {
                status: 'error',
                notice: t('settingsAuto164') + this.diagnoseRAGInitFailure(),
              };
            }
            const status = await this.getRagStatus();
            if (!status || status.updateRequiredDocuments.length === 0) {
              this.updateRagStats();
              return { status: 'noop', detail: t('ragNoPendingUpdatesNotice') };
            }
            new Notice(t('settingsAuto165', { v0: String(status.updateRequiredDocuments.length) }));
            try {
              const result = await latestRuntime.ragIndexingScheduler.indexPending();
              this.updateRagStats();
              return {
                status: 'success',
                detail: t('settingsAuto166', {
                  v0: String(result.indexed),
                  v1: String(result.skipped),
                }),
              };
            } catch (err) {
              if (isIndexingCancelledError(err)) {
                this.updateRagStats();
                return { status: 'partial', detail: t('settingsAuto167') };
              }
              const msg = err instanceof Error ? err.message : String(err);
              return {
                status: 'error',
                detail: msg,
                notice: t('settingsAuto168', { v0: String(msg) }),
              };
            }
          },
        });
      });
    });
    const recoveryControls = this.createRagDisclosure(
      controls,
      'recovery',
      t('ragRecoverySummary'),
      t('ragRecoveryDescription'),
    ).content;
    recoveryControls.createEl('button', { text: t('settingsAuto169') }, (btn) => {
      this.reindexAllButton = btn;
      btn.disabled = isIndexing || !hasIndexer;
      btn.addEventListener('click', () => {
        void runActionWithFeedback({
          button: btn,
          loadingText: t('reindexingStarted'),
          refreshBus: this.plugin.refreshBus,
          refreshDomains: ['rag'],
          action: async () => {
            const latestRuntime = await this.ensureRagRuntimeAccess();
            if (!latestRuntime.hasIndexer || !latestRuntime.ragIndexingScheduler) {
              return {
                status: 'error',
                notice: t('settingsAuto164') + this.diagnoseRAGInitFailure(),
              };
            }
            const status = await this.getRagStatus();
            if (!status || status.totalDocuments === 0) {
              this.updateRagStats();
              return { status: 'noop', detail: t('ragNoDocumentsNotice') };
            }
            new Notice(t('settingsAuto170'));
            try {
              const result = await latestRuntime.ragIndexingScheduler.reindexAll();
              this.updateRagStats();
              return {
                status: 'success',
                detail: t('settingsAuto171', { v0: String(result.indexed) }),
              };
            } catch (err) {
              if (isIndexingCancelledError(err)) {
                this.updateRagStats();
                return { status: 'partial', detail: t('settingsAuto167') };
              }
              const msg = err instanceof Error ? err.message : String(err);
              return {
                status: 'error',
                detail: msg,
                notice: t('settingsAuto172', { v0: String(msg) }),
              };
            }
          },
        });
      });
    });
    primaryControls.createEl('button', { text: t('settingsAuto173') }, (btn) => {
      this.cancelIndexingButton = btn;
      btn.disabled = !isIndexing;
      btn.addEventListener('click', () => {
        void runActionWithFeedback({
          button: btn,
          refreshBus: this.plugin.refreshBus,
          refreshDomains: ['rag'],
          action: () => {
            if (!this.plugin.isRagIndexing()) {
              return { status: 'noop', detail: t('ragNoRunningIndexing') };
            }
            this.plugin.cancelRagIndexing();
            this.updateRagStats();
            return { status: 'success', detail: t('ragIndexCancelRequestedNotice') };
          },
        });
      });
    });
    primaryControls.createEl('button', { text: t('settingsAuto174') }, (btn) => {
      this.resumeIndexingButton = btn;
      btn.disabled = true;
      btn.addEventListener('click', () => {
        void runActionWithFeedback({
          button: btn,
          refreshBus: this.plugin.refreshBus,
          refreshDomains: ['rag'],
          action: () => {
            if (!this.plugin.getRagPerformanceGuardState()?.remainingPauseMs) {
              return { status: 'noop', detail: t('ragNotPerformancePaused') };
            }
            this.plugin.resumeRagIndexing();
            this.updateRagStats();
            return { status: 'success', detail: t('ragIndexResumeRequestedNotice') };
          },
        });
      });
    });
    this.ragControlsHint = recoveryControls.createDiv({
      cls: 'superpower-inside-rag-controls-hint',
      text: t('settingsAuto175'),
    });
    const dangerControls = recoveryControls.createDiv({
      cls: 'superpower-inside-rag-controls-group is-danger',
    });
    dangerControls.createEl('button', { text: t('settingsAuto176') }, (btn) => {
      btn.disabled = isIndexing;
      btn.addEventListener('click', () => {
        void runActionWithFeedback({
          button: btn,
          refreshBus: this.plugin.refreshBus,
          refreshDomains: ['rag'],
          action: async () => {
            if (!(await confirmWithModal(this.app, t('settingsAuto177')))) {
              return { status: 'noop', detail: t('actionCancelledNotice') };
            }
            try {
              const latestRuntime = this.getRagRuntimeAccess();
              if (latestRuntime.vectorStore) {
                await latestRuntime.vectorStore.clear();
              }
              if (latestRuntime.embeddingProvider) {
                await latestRuntime.embeddingProvider.clearCache();
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return {
                status: 'error',
                detail: msg,
                notice: t('settingsAuto179', { v0: String(msg) }),
              };
            }
            this.updateRagStats();
            return { status: 'success', detail: t('settingsAuto178') };
          },
        });
      });
    });
    void this.getRagStatus().then((status) => this.updateRagControlStates(status));
  }
  private updateRagControlStates(status: RagStatusSummary | null): void {
    const runtime = this.plugin.getRagRuntimeState();
    const state = getRagIndexingControlState({
      hasIndexer: runtime.hasIndexer,
      isIndexing: this.plugin.isRagIndexing(),
      totalDocuments: status?.totalDocuments ?? null,
      updateRequiredCount: status?.updateRequiredDocuments.length ?? null,
      guardRemainingPauseMs: this.plugin.getRagPerformanceGuardState()?.remainingPauseMs ?? null,
    });
    this.applyButtonState(this.updatePendingButton, state.updatePending);
    this.applyButtonState(this.reindexAllButton, state.reindexAll);
    this.applyButtonState(this.cancelIndexingButton, state.cancel);
    this.applyButtonState(this.resumeIndexingButton, state.resume);
    if (this.updatePendingButton) {
      this.updatePendingButton.hidden = state.updatePending.disabled;
    }
    if (this.cancelIndexingButton) {
      this.cancelIndexingButton.hidden = state.cancel.disabled;
    }
    if (this.resumeIndexingButton) {
      this.resumeIndexingButton.hidden = state.resume.disabled;
    }
    const firstReason = state.updatePending.reason ?? state.reindexAll.reason;
    if (this.ragControlsHint) {
      this.ragControlsHint.setText(firstReason ?? t('settingsAuto180'));
    }
  }
  private applyButtonState(
    button: HTMLButtonElement | null,
    state: {
      disabled: boolean;
      reason: string | null;
    },
  ): void {
    if (!button) return;
    button.disabled = state.disabled;
    button.title = state.reason ?? '';
  }
  private buildExcludeListSetting(input: {
    containerEl: HTMLElement;
    name: string;
    description: string;
    placeholder: string;
    values: string[];
    validate: (value: string, existingValues: readonly string[]) => ExcludeValidationResult;
    onChange: (values: string[]) => void;
    countMeta?: {
      getCounts: () => Record<string, number>;
      getItemLabel: (count: number) => string;
      getSummaryLabel: (count: number) => string;
      refreshLabel: string;
    };
  }): void {
    const setting = new Setting(input.containerEl).setName(input.name).setDesc(input.description);
    const editor = setting.controlEl.createDiv({ cls: 'superpower-inside-exclude-editor' });
    const inputRow = editor.createDiv({ cls: 'superpower-inside-exclude-input-row' });
    const textInput = inputRow.createEl('input', {
      cls: 'superpower-inside-exclude-input',
      attr: { type: 'text', placeholder: input.placeholder },
    });
    const addButton = inputRow.createEl('button', {
      cls: 'superpower-inside-exclude-add-btn',
      text: t('excludeListAdd'),
      attr: { type: 'button' },
    });
    const feedbackEl = editor.createDiv({ cls: 'superpower-inside-exclude-feedback' });
    const countMetaEl = input.countMeta
      ? editor.createDiv({ cls: 'superpower-inside-exclude-count-meta' })
      : null;
    const listEl = editor.createDiv({ cls: 'superpower-inside-exclude-list' });
    let itemCounts = input.countMeta?.getCounts() ?? {};
    const getExistingWithoutIndex = (index: number): string[] =>
      input.values.filter((_, itemIndex) => itemIndex !== index);
    const renderIssues = (
      container: HTMLElement,
      issues: readonly ExcludeValidationIssue[],
    ): void => {
      container.empty();
      for (const issue of issues) {
        container.createDiv({
          cls: `superpower-inside-exclude-message is-${issue.level}`,
          text: this.getExcludeIssueText(issue),
        });
      }
    };
    const renderInputValidation = (): ExcludeValidationResult => {
      const result = input.validate(textInput.value, input.values);
      renderIssues(feedbackEl, textInput.value.length > 0 ? result.issues : []);
      addButton.disabled = !result.valid || result.normalized.length === 0;
      return result;
    };
    const renderList = (): void => {
      listEl.empty();
      if (countMetaEl && input.countMeta) {
        countMetaEl.empty();
        const totalCount = input.values.reduce(
          (sum, value) => sum + (itemCounts[value.trim().toLowerCase()] ?? 0),
          0,
        );
        countMetaEl.createDiv({
          cls: 'superpower-inside-exclude-count-summary',
          text: input.countMeta.getSummaryLabel(totalCount),
        });
        const countMeta = input.countMeta;
        this.excludeCountRenderer = () => {
          itemCounts = countMeta.getCounts();
          renderList();
        };
      }
      if (input.values.length === 0) {
        listEl.createDiv({
          cls: 'superpower-inside-exclude-empty',
          text: t('excludeListEmpty'),
        });
        return;
      }
      input.values.forEach((value, index) => {
        const item = listEl.createDiv({ cls: 'superpower-inside-exclude-item' });
        const content = item.createDiv({ cls: 'superpower-inside-exclude-item-content' });
        const valueRow = content.createDiv({ cls: 'superpower-inside-exclude-value-row' });
        valueRow.createDiv({ cls: 'superpower-inside-exclude-value', text: value });
        if (input.countMeta) {
          const count = itemCounts[value.trim().toLowerCase()] ?? 0;
          valueRow.createDiv({
            cls: 'superpower-inside-exclude-count-badge',
            text: input.countMeta.getItemLabel(count),
          });
        }
        const itemIssues = input.validate(value, getExistingWithoutIndex(index)).issues;
        if (itemIssues.length > 0) {
          const itemFeedback = content.createDiv({
            cls: 'superpower-inside-exclude-item-feedback',
          });
          renderIssues(itemFeedback, itemIssues);
        }
        const removeButton = item.createEl('button', {
          cls: 'superpower-inside-exclude-remove-btn',
          text: t('excludeListRemove'),
          attr: { type: 'button' },
        });
        removeButton.addEventListener('click', () => {
          input.values.splice(index, 1);
          input.onChange([...input.values]);
          renderInputValidation();
          renderList();
        });
      });
    };
    const addValue = (): void => {
      const result = renderInputValidation();
      if (!result.valid || !result.normalized) return;
      input.values.push(result.normalized);
      input.onChange([...input.values]);
      itemCounts = input.countMeta?.getCounts() ?? itemCounts;
      textInput.value = '';
      renderInputValidation();
      renderList();
    };
    textInput.addEventListener('input', () => renderInputValidation());
    textInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addValue();
    });
    addButton.addEventListener('click', addValue);
    renderInputValidation();
    renderList();
  }
  private getExcludeIssueText(issue: ExcludeValidationIssue): string {
    switch (issue.code) {
      case 'empty':
        return t('excludeInputEmpty');
      case 'trimmed':
        return t('excludeInputTrimmed');
      case 'duplicate':
        return t('excludeInputDuplicate');
      case 'comma':
        return t('excludeInputComma');
      case 'path-backslash':
        return t('excludePathBackslash');
      case 'path-leading-slash':
        return t('excludePathLeadingSlash');
      case 'path-missing':
        return t('excludePathMissingWarning');
      case 'extension-leading-dot':
        return t('excludeExtLeadingDot');
      case 'extension-invalid':
        return t('excludeExtInvalid');
      case 'extension-protected-document':
        return t('excludeExtProtectedDocument');
    }
  }
  private buildExcludeOptionsSection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(containerEl, t('settingsAuto181'));
    this.buildExcludeListSetting({
      containerEl: section,
      name: t('excludePaths'),
      description: t('excludePathsDesc'),
      placeholder: t('excludePathPlaceholder'),
      values: this.plugin.settings.rag.excludePaths,
      validate: (value, existingValues) =>
        validateExcludePathInput(
          value,
          existingValues,
          (path) => path.includes('*') || this.app.vault.getAbstractFileByPath(path) !== null,
        ),
      onChange: (values) => {
        this.plugin.settings.rag.excludePaths = values;
        this.debouncedRagSave();
      },
    });
    new Setting(section)
      .setName(t('excludeChatFolder'))
      .setDesc(getChatFolderExcludeDescription(this.plugin.settings.chat.saveFolder))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.excludeChatFolder).onChange((value) => {
          this.plugin.settings.rag.excludeChatFolder = value;
          this.debouncedRagSave();
        }),
      );
    this.buildExcludeListSetting({
      containerEl: section,
      name: t('excludeExts'),
      description: t('excludeExtsDesc'),
      placeholder: t('excludeExtPlaceholder'),
      values: this.plugin.settings.rag.excludeExts,
      validate: validateExcludeExtensionInput,
      onChange: (values) => {
        this.plugin.settings.rag.excludeExts = values;
        this.debouncedRagSave();
      },
      countMeta: {
        getCounts: () =>
          countFilesByExtensions(this.app.vault, this.plugin.settings.rag.excludeExts),
        getItemLabel: (count) => t('excludeExtFileCount').replace('{count}', String(count)),
        getSummaryLabel: (count) => t('excludeExtTotalFileCount').replace('{count}', String(count)),
        refreshLabel: t('refresh'),
      },
    });
  }
  private buildIndexingOptionsSection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(containerEl, t('settingsAuto182'));
    // 자동 업데이트 토글
    new Setting(section)
      .setName(t('settingsAuto120'))
      .setDesc(t('settingsAuto183'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.autoUpdateEnabled).onChange(async (value) => {
          this.plugin.settings.rag.autoUpdateEnabled = value;
          await this.plugin.saveSettingsLight();
          this.plugin.setupAutoUpdate();
        }),
      );
    // 자동 업데이트 간격 (분)
    new Setting(section)
      .setName(t('autoUpdateInterval'))
      .setDesc(t('autoUpdateIntervalDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.autoUpdateIntervalMin))
          .setPlaceholder('5')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 99 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.autoUpdateIntervalMin = num;
            this.debouncedSave();
            this.plugin.setupAutoUpdate();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '99';
      });
    new Setting(section)
      .setName(t('settingsAuto184'))
      .setDesc(t('settingsAuto185'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', t('settingsAuto186'))
          .addOption('custom', t('settingsAuto187'))
          .setValue(this.plugin.settings.rag.performanceTuningMode)
          .onChange((value) => {
            this.plugin.settings.rag.performanceTuningMode = value === 'custom' ? 'custom' : 'auto';
            this.debouncedRagSave();
            section.remove();
            this.buildIndexingOptionsSection(containerEl);
          }),
      );
    if (this.plugin.settings.rag.performanceTuningMode !== 'custom') {
      const performanceSettings = resolveRagPerformanceSettings(this.plugin.settings.rag);
      section.createDiv({
        cls: 'superpower-inside-rag-performance-summary',
        text: t('settingsAuto188', {
          v0: String(performanceSettings.maxEmbeddingBatchSize),
          v1: String(performanceSettings.indexingYieldMs),
          v2: String(performanceSettings.slowEventLoopThresholdMs),
          v3: String(performanceSettings.slowBatchThresholdMs),
        }),
      });
    }
    if (this.plugin.settings.rag.performanceTuningMode === 'custom') {
      new Setting(section)
        .setName(t('settingsAuto189'))
        .setDesc(t('settingsAuto190'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.rag.performanceGuardEnabled).onChange((value) => {
            this.plugin.settings.rag.performanceGuardEnabled = value;
            this.debouncedRagSave();
          }),
        );
      new Setting(section)
        .setName(t('settingsAuto191'))
        .setDesc(t('settingsAuto192'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.maxEmbeddingBatchSize))
            .setPlaceholder(this.plugin.settings.rag.embeddingProvider === 'ollama' ? '1' : '32')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 1 || num > 128 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.maxEmbeddingBatchSize = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text.inputEl.max = '128';
        });
      new Setting(section)
        .setName(t('settingsAuto193'))
        .setDesc(t('settingsAuto194'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.indexingYieldMs))
            .setPlaceholder('25')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 0 || num > 1000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.indexingYieldMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.max = '1000';
        });
      new Setting(section)
        .setName(t('settingsAuto195'))
        .setDesc(t('settingsAuto196'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.slowEventLoopThresholdMs))
            .setPlaceholder('150')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 16 || num > 5000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.slowEventLoopThresholdMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '16';
          text.inputEl.max = '5000';
        })
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.slowBatchThresholdMs))
            .setPlaceholder('3000')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 100 || num > 60000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.slowBatchThresholdMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '100';
          text.inputEl.max = '60000';
        });
    }
    // 청크 크기
    const chunkSizeSetting = new Setting(section)
      .setName(t('chunkSize'))
      .setDesc(t('chunkSizeDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.chunkSize))
          .setPlaceholder('100')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 100 || num > 5000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.chunkSize = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '100';
        text.inputEl.max = '5000';
      });
    // Ollama 임베딩 모델 컨텍스트 길이 경고
    if (this.plugin.settings.rag.embeddingProvider === 'ollama') {
      const warnEl = chunkSizeSetting.descEl.createEl('div', {
        cls: 'superpower-inside-settings-warning',
      });
      warnEl.setText(t('ragChunkSizeOllamaWarning'));
    }
  }
  private buildSearchQualitySection(containerEl: HTMLElement): void {
    const section = this.createRagGroup(containerEl, t('settingsAuto198'));
    section.createDiv({
      cls: 'superpower-inside-rag-guidance',
      text: t('bm25Guidance'),
    });
    new Setting(section)
      .setName(t('minScore'))
      .setDesc(t('minScoreDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.minScore))
          .setPlaceholder('0.5')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 0 || num > 1) return;
            this.plugin.settings.rag.minScore = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.05';
      });
    new Setting(section)
      .setName(t('enableBM25'))
      .setDesc(t('enableBM25Desc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.enableBM25).onChange((value) => {
          this.plugin.settings.rag.enableBM25 = value;
          void this.plugin.saveSettings({ reinitRag: true, reinitMcp: false });
        }),
      );
    new Setting(section)
      .setName(t('bm25Weight'))
      .setDesc(t('bm25WeightDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.bm25Weight))
          .setPlaceholder('0.3')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 0 || num > 1) return;
            this.plugin.settings.rag.bm25Weight = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.05';
      });
  }
  private buildChatTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const workspace = containerEl.createDiv({
      cls: 'superpower-inside-settings-workspace superpower-inside-chat-settings-workspace',
    });
    this.buildChatStatusSection(workspace);
    this.buildChatPromptSection(workspace);
    this.buildChatStorageSection(workspace);
    this.buildChatToolsSection(workspace);
  }
  private buildChatStatusSection(containerEl: HTMLElement): void {
    const { body } = this.createSettingsSection(containerEl, t('chatStatusTitle'), {
      description: t('chatStatusDesc'),
    });
    const activePrompt = getActivePromptEntry(this.plugin.settings);
    this.createSettingsStatusRow(body, {
      label: t('systemPrompt'),
      value: activePrompt.title,
      statusLabel: t('chatActiveStatus'),
      detail: t('chatStatusPromptDetail'),
      tone: 'success',
    });
    const autoSaveEnabled = this.plugin.settings.chat.autoSaveEnabled;
    this.createSettingsStatusRow(body, {
      label: t('chatAutoSave'),
      value: this.plugin.settings.chat.saveFolder,
      statusLabel: autoSaveEnabled ? t('chatEnabledStatus') : t('chatDisabledStatus'),
      detail: autoSaveEnabled ? t('chatStatusAutosaveOnDetail') : t('chatStatusAutosaveOffDetail'),
      tone: autoSaveEnabled ? 'success' : 'neutral',
    });
    this.createSettingsStatusRow(body, {
      label: t('mcpToolExecutionPolicy'),
      value: this.getChatToolPolicyLabel(),
      statusLabel: t('chatSelectedStatus'),
      detail: t('chatStatusToolsDetail'),
      tone: this.plugin.settings.chat.mcpToolExecutionPolicy === 'always-auto' ? 'warning' : 'neutral',
    });
  }
  private buildChatPromptSection(containerEl: HTMLElement): void {
    const { body } = this.createSettingsSection(containerEl, t('chatPromptSectionTitle'), {
      description: t('chatPromptSectionDesc'),
    });
    new Setting(body)
      .setName(t('promptLibraryOpen'))
      .setDesc(t('chatPromptLibraryDesc'))
      .addButton((button) => {
        button.setButtonText(t('promptLibraryOpen')).setCta();
        button.onClick(() => {
          openPromptLibraryModal({
            containerEl: body,
            plugin: this.plugin,
            currentSessionPrompt: null,
            selectedModel: this.plugin.settings.chat.defaultModel,
            onClose: () => this.refreshChatTab(),
          });
        });
      });
    new Setting(body)
      .setName(t('systemPrompt'))
      .setDesc(t('systemPromptDesc'))
      .addTextArea((text) => {
        const activePrompt = getActivePromptEntry(this.plugin.settings);
        text.inputEl.rows = 6;
        text.setValue(activePrompt.content);
        text.setPlaceholder(t('systemPromptPlaceholder'));
        text.onChange((value) => {
          const active = getActivePromptEntry(this.plugin.settings);
          const existing = this.plugin.settings.chat.promptLibrary.find(
            (entry) => entry.id === active.id,
          );
          if (existing) {
            existing.content = value;
            existing.updatedAt = new Date().toISOString();
          }
          this.plugin.settings.chat.systemPrompt = value;
          this.debouncedSave();
        });
      });
    const shortcuts = this.createSettingsDisclosure(
      body,
      'chat-prompt-shortcuts',
      t('chatPromptShortcutsTitle'),
      t('chatPromptShortcutsDesc'),
    );
    const presetList = shortcuts.content.createDiv({ cls: 'superpower-inside-chat-preset-list' });
    for (const preset of this.getChatPromptPresets()) {
      const row = presetList.createDiv({ cls: 'superpower-inside-chat-preset-row' });
      const copy = row.createDiv({ cls: 'superpower-inside-chat-preset-copy' });
      copy.createDiv({ cls: 'superpower-inside-chat-preset-label', text: preset.label });
      copy.createDiv({ cls: 'superpower-inside-chat-preset-description', text: preset.description });
      const button = row.createEl('button', {
        text: t('chatApplyPreset'),
        attr: { type: 'button', title: preset.description },
      });
      button.addEventListener('click', () => this.applyChatPromptPreset(preset));
    }
    new Setting(shortcuts.content)
      .setName(t('resetToDefault'))
      .setDesc(t('chatPromptResetDesc'))
      .addButton((button) =>
        button.setButtonText(t('resetToDefault')).onClick(() => {
          this.plugin.settings.chat.systemPrompt = '';
          this.plugin.settings.chat.activePromptId = 'default-obsidian-knowledge-work';
          this.debouncedSave();
          this.refreshChatTab();
          new Notice(t('settingsAuto220'));
        }),
      );
  }
  private getChatPromptPresets(): {
    label: string;
    description: string;
    prompt: string;
  }[] {
    return [
      {
        label: t('settingsAuto204'),
        description: t('settingsAuto205'),
        prompt: t('settingsAuto206'),
      },
      {
        label: t('settingsAuto207'),
        description: t('settingsAuto208'),
        prompt: t('settingsAuto209'),
      },
      {
        label: t('settingsAuto210'),
        description: t('settingsAuto211'),
        prompt: t('settingsAuto212'),
      },
      {
        label: t('settingsAuto213'),
        description: t('settingsAuto214'),
        prompt: t('settingsAuto215'),
      },
      {
        label: t('settingsAuto216'),
        description: t('settingsAuto217'),
        prompt: t('settingsAuto218'),
      },
    ];
  }
  private applyChatPromptPreset(preset: {
      label: string;
      description: string;
      prompt: string;
  }): void {
    const entry = createPromptEntry({
      title: preset.label,
      description: preset.description,
      content: preset.prompt,
      source: 'user',
    });
    this.plugin.settings.chat.promptLibrary = [entry, ...this.plugin.settings.chat.promptLibrary];
    this.plugin.settings.chat.activePromptId = entry.id;
    this.plugin.settings.chat.systemPrompt = preset.prompt;
    this.debouncedSave();
    this.refreshChatTab();
    new Notice(t('settingsAuto219', { v0: String(preset.label) }));
  }
  private buildChatStorageSection(containerEl: HTMLElement): void {
    const { body } = this.createSettingsSection(containerEl, t('chatStorageSectionTitle'), {
      description: t('chatStorageSectionDesc'),
    });
    new Setting(body)
      .setName(t('chatSaveFolder'))
      .setDesc(t('chatSaveFolderDesc'))
      .addText((text) =>
        text.setValue(this.plugin.settings.chat.saveFolder).onChange((value) => {
          this.plugin.settings.chat.saveFolder = value.trim();
          this.debouncedRagSave();
        }),
      );
    new Setting(body)
      .setName(t('chatAutoSave'))
      .setDesc(t('chatAutoSaveDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chat.autoSaveEnabled).onChange((value) => {
          this.plugin.settings.chat.autoSaveEnabled = value;
          this.debouncedSave();
        }),
      );
    const details = this.createSettingsDisclosure(
      body,
      'chat-storage-details',
      t('chatStorageDetailsTitle'),
      t('chatStorageDetailsDesc'),
    );
    new Setting(details.content)
      .setName(t('chatAutoSaveDelay'))
      .setDesc(t('chatAutoSaveDelayDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.chat.autoSaveDebounceMs))
          .setPlaceholder('3000')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 1000 || num > 10000 || !Number.isInteger(num)) return;
            this.plugin.settings.chat.autoSaveDebounceMs = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1000';
        text.inputEl.max = '10000';
        text.inputEl.step = '500';
      });
  }
  private buildChatToolsSection(containerEl: HTMLElement): void {
    const { body } = this.createSettingsSection(containerEl, t('chatToolsSectionTitle'), {
      description: t('chatToolsSectionDesc'),
    });
    if (this.plugin.settings.chat.mcpToolExecutionPolicy === 'always-auto') {
      this.createSettingsNotice(body, {
        text: t('chatAlwaysAutoWarning'),
        tone: 'warning',
        icon: 'shield-alert',
      });
    }
    new Setting(body)
      .setName(t('mcpToolExecutionPolicy'))
      .setDesc(t('mcpToolExecutionPolicyDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('mentioned-auto', t('mcpToolExecutionMentionedAuto'))
          .addOption('always-manual', t('mcpToolExecutionAlwaysManual'))
          .addOption('always-auto', t('mcpToolExecutionAlwaysAuto'))
          .setValue(this.plugin.settings.chat.mcpToolExecutionPolicy)
          .onChange((value) => {
            this.plugin.settings.chat.mcpToolExecutionPolicy =
              value as ChatConfig['mcpToolExecutionPolicy'];
            this.debouncedSave();
            this.refreshChatTab();
          }),
      );
    const details = this.createSettingsDisclosure(
      body,
      'chat-tool-details',
      t('chatToolDetailsTitle'),
      t('chatToolDetailsDesc'),
    );
    new Setting(details.content)
      .setName(t('enforceMcpTools'))
      .setDesc(t('enforceMcpToolsDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chat.enforceMcpTools).onChange((value) => {
          this.plugin.settings.chat.enforceMcpTools = value;
          this.debouncedSave();
        }),
      );
  }
  private getChatToolPolicyLabel(): string {
    const value = this.plugin.settings.chat.mcpToolExecutionPolicy;
    if (value === 'always-manual') return t('mcpToolExecutionAlwaysManual');
    if (value === 'always-auto') return t('mcpToolExecutionAlwaysAuto');
    return t('mcpToolExecutionMentionedAuto');
  }
  private refreshChatTab(): void {
    const chatPanel = this.tabPanels.get('chat');
    if (chatPanel?.isConnected) this.buildChatTab(chatPanel);
  }
  private buildMCPTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const workspace = containerEl.createDiv({
      cls: 'superpower-inside-settings-workspace superpower-inside-mcp-settings-workspace',
    });
    const statusSection = this.createSettingsSection(workspace, t('mcpStatusSectionTitle'), {
      description: t('mcpStatusSectionDesc'),
    });
    const serversSection = this.createSettingsSection(workspace, t('mcpServersSectionTitle'), {
      description: t('mcpServersSectionDesc'),
    });
    const environmentSection = this.createSettingsSection(
      workspace,
      t('mcpEnvironmentSectionTitle'),
      { description: t('mcpEnvironmentSectionDesc') },
    );
    const environmentDetails = this.createSettingsDisclosure(
      environmentSection.body,
      'mcp-environment-details',
      t('mcpEnvironmentDetailsTitle'),
      t('mcpEnvironmentDetailsDesc'),
    );
    const pathContent = environmentDetails.content;
    if (Platform.isWin) {
      new Setting(pathContent)
        .setName(t('mcpIncludeWslPath'))
        .setDesc(t('mcpIncludeWslPathDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.mcpIncludeWslPath).onChange((value) => {
            this.plugin.settings.mcpIncludeWslPath = value;
            this.debouncedSave();
          }),
        );
    }
    const pathRow = pathContent.createDiv({
      cls: 'superpower-inside-mcp-path-row superpower-inside-settings-row',
    });
    const pathText = pathRow.createEl('textarea', {
      cls: 'superpower-inside-mcp-json-editor',
      attr: { placeholder: t('mcpPathPlaceholder'), rows: '3' },
    });
    pathText.value = this.plugin.settings.mcpPath;
    const pathActions = pathRow.createDiv({ cls: 'superpower-inside-mcp-path-actions' });
    const fetchBtn = pathActions.createEl('button', { text: t('mcpPathFetch') });
    fetchBtn.addEventListener('click', () => {
      void (async () => {
        const originalText = fetchBtn.textContent;
        fetchBtn.setText(t('mcpPathFetching'));
        fetchBtn.disabled = true;
        try {
          if (!isMcpStdioAvailable(Platform)) {
            throw new Error(t('settingsAuto224'));
          }
          const { getDesktopLoginShellPath } = await import('./mcp/path');
          const output = getDesktopLoginShellPath({
            platform: Platform,
            includeWslPath: this.plugin.settings.mcpIncludeWslPath,
          });
          pathText.value = output;
          this.plugin.settings.mcpPath = output;
          await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
          new Notice(t('mcpPathFetchSuccess'));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`${t('mcpPathFetchError')}: ${msg}\n${t('mcpPathFetchErrorHelp')}`, 10000);
        } finally {
          fetchBtn.setText(originalText);
          fetchBtn.disabled = false;
        }
      })();
    });
    const saveBtn = pathActions.createEl('button', { text: t('save') });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        this.plugin.settings.mcpPath = pathText.value.trim();
        await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
        new Notice(t('mcpJsonSaved'));
      })();
    });
    const statusBody = statusSection.body.createDiv({
      cls: 'superpower-inside-mcp-status superpower-inside-settings-status-list',
    });
    this.renderMCPStatus(statusBody);
    this.unregisterMcpStatusEvent();
    this.mcpStatusEventRef = (this.app.workspace as unknown as Events).on(
      MCP_STATUS_CHANGE_EVENT,
      () => {
        this.renderMCPStatus(statusBody);
      },
    );
    const editorPanel = serversSection.body;
    const lintStatus = editorPanel.createDiv({ cls: 'superpower-inside-mcp-lint-status' });
    lintStatus.setText('');
    const defaultJson = buildMcpJsonEditorValue(this.plugin.settings.mcpServers);
    const jsonTextArea = editorPanel.createEl('textarea', {
      cls: 'superpower-inside-mcp-json-editor',
    });
    jsonTextArea.value = defaultJson;
    let lintTimeout: number | null = null;
    let autoSaveTimeout: number | null = null;
    const runLint = () => {
      lintStatus.setText(t('mcpJsonLinting'));
      lintStatus.removeClass('success');
      lintStatus.removeClass('error');
      if (lintTimeout) {
        window.clearTimeout(lintTimeout);
        lintTimeout = null;
      }
      if (autoSaveTimeout) {
        window.clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      lintTimeout = window.setTimeout(() => {
        lintTimeout = null;
        const result = validateMcpJson(jsonTextArea.value);
        if (result.valid) {
          lintStatus.setText('✅ ' + t('mcpJsonLintOk'));
          lintStatus.addClass('success');
          lintStatus.removeClass('error');
          autoSaveTimeout = window.setTimeout(() => {
            autoSaveTimeout = null;
            this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
            void (async () => {
              const saveResult = await this.plugin.saveSettings({
                reinitRag: false,
                reinitMcp: true,
              });
              if (saveResult.success) {
                lintStatus.setText('✅ ' + t('mcpJsonSaved'));
              } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
                lintStatus.setText(
                  t('settingsAuto225', { v0: String(saveResult.mcpErrors.length) }),
                );
                lintStatus.addClass('error');
                lintStatus.removeClass('success');
              }
            })();
          }, 1000);
        } else {
          lintStatus.setText(`❌ ${t('mcpJsonLintError', { error: result.error ?? '' })}`);
          lintStatus.addClass('error');
          lintStatus.removeClass('success');
        }
      }, 1000);
    };
    jsonTextArea.addEventListener('input', () => {
      runLint();
    });
    jsonTextArea.addEventListener('blur', () => {
      const formatted = formatMcpJson(jsonTextArea.value);
      if (formatted !== null) {
        jsonTextArea.value = formatted;
      }
    });
    jsonTextArea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = jsonTextArea.selectionStart;
        const end = jsonTextArea.selectionEnd;
        const indent = '  ';
        jsonTextArea.setRangeText(indent, start, end, 'end');
        runLint();
      }
    });
    new Setting(editorPanel).addButton((btn) =>
      btn.setButtonText(t('save')).onClick(async () => {
        const result = validateMcpJson(jsonTextArea.value);
        if (result.valid) {
          this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
          const saveResult = await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
          if (saveResult.success) {
            lintStatus.setText('✅ ' + t('mcpJsonSaved'));
            lintStatus.addClass('success');
            lintStatus.removeClass('error');
            new Notice(t('mcpJsonSaved'));
            jsonTextArea.value = JSON.stringify(result.data, null, 2);
          } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
            lintStatus.setText(t('settingsAuto226', { v0: String(saveResult.mcpErrors.length) }));
            lintStatus.addClass('error');
            lintStatus.removeClass('success');
            const errorDetails = saveResult.mcpErrors.map((err) => `• ${err}`).join('\n');
            new Notice(t('settingsAuto227', { v0: String(errorDetails) }), 10000);
          }
          statusBody.empty();
          this.renderMCPStatus(statusBody);
        } else {
          const detailedError = this.buildDetailedMcpError(result.error ?? '');
          lintStatus.setText(`❌ ${detailedError.short}`);
          lintStatus.addClass('error');
          lintStatus.removeClass('success');
          new Notice(detailedError.full, 10000);
        }
      }),
    );
  }
  private buildDetailedMcpError(rawError: string): {
    short: string;
    full: string;
  } {
    if (rawError.includes(t('mcpJsonInvalidObject'))) {
      return {
        short: t('settingsAuto228'),
        full: t('settingsAuto229', { v0: String(t('mcpJsonInvalidObject')) }),
      };
    }
    if (rawError.includes(t('mcpJsonMissingMcpServers'))) {
      return {
        short: t('settingsAuto230'),
        full: t('settingsAuto231', { v0: String(t('mcpJsonMissingMcpServers')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidMcpServers'))) {
      return {
        short: t('settingsAuto232'),
        full: t('settingsAuto233', { v0: String(t('mcpJsonInvalidMcpServers')) }),
      };
    }
    if (rawError.includes(t('mcpJsonServerNeedsCommand'))) {
      return {
        short: t('settingsAuto234'),
        full: t('settingsAuto235', { v0: String(t('mcpJsonServerNeedsCommand')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidArgs'))) {
      return {
        short: t('settingsAuto236'),
        full: t('settingsAuto237', { v0: String(t('mcpJsonInvalidArgs')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidEnv'))) {
      return {
        short: t('settingsAuto238'),
        full: t('settingsAuto239', { v0: String(t('mcpJsonInvalidEnv')) }),
      };
    }
    if (rawError.includes('Unexpected token') || rawError.includes('JSON')) {
      return {
        short: t('settingsAuto240'),
        full: t('settingsAuto241', { v0: String(rawError) }),
      };
    }
    return {
      short: rawError,
      full: t('settingsAuto098', { v0: String(rawError) }),
    };
  }
  private buildAdvancedTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const workspace = containerEl.createDiv({
      cls: 'superpower-inside-settings-workspace superpower-inside-advanced-settings-workspace',
    });
    const { body } = this.createSettingsSection(workspace, t('advancedPluginAwareTitle'), {
      description: t('advancedPluginAwareDesc'),
    });
    const enabled = this.plugin.settings.pluginAwareEnabled;
    this.createSettingsStatusRow(body, {
      label: t('pluginAwareGeneration'),
      value: enabled ? t('advancedEnabledStatus') : t('advancedDisabledStatus'),
      statusLabel: enabled ? t('advancedEnabledStatus') : t('advancedDisabledStatus'),
      detail: enabled ? t('advancedPluginAwareOnDetail') : t('advancedPluginAwareOffDetail'),
      tone: enabled ? 'success' : 'neutral',
    });
    if (
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: enabled,
        servers: this.plugin.settings.mcpServers,
      })
    ) {
      this.createSettingsNotice(body, {
        text: t('pluginAwareContext7MissingWarning'),
        tone: 'warning',
        icon: 'triangle-alert',
      });
    }
    new Setting(body)
      .setName(t('pluginAwareGeneration'))
      .setDesc(t('pluginAwareGenerationDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pluginAwareEnabled).onChange((value) => {
          this.plugin.settings.pluginAwareEnabled = value;
          this.debouncedSave();
          this.buildAdvancedTab(containerEl);
        }),
      );
    this.createSettingsNotice(body, {
      text: t('pluginAwareGenerationLimitNotice'),
      tone: 'info',
      icon: 'info',
    });
  }
  private buildProviderStatusSection(
    containerEl: HTMLElement,
    profiles: readonly ProviderProfileConfig[],
  ): void {
    const readyCount = profiles.filter(
      (profile) => this.getProviderProfileTone(profile) === 'ready',
    ).length;
    const enabledCount = profiles.filter((profile) => profile.enabled).length;
    const attentionCount = profiles.filter((profile) => {
      const tone = this.getProviderProfileTone(profile);
      return tone === 'needs-key' || tone === 'needs-models';
    }).length;
    const firstAttention = profiles.find((profile) => {
      const tone = this.getProviderProfileTone(profile);
      return tone === 'needs-key' || tone === 'needs-models';
    });
    const firstAttentionName = firstAttention
      ? firstAttention.name.trim() || PROVIDER_STRATEGY_LABELS[firstAttention.strategy]
      : '';
    const section = this.createSettingsSection(containerEl, t('providerStatusSectionTitle'), {
      description: t('providerStatusSectionDesc'),
    });
    this.createSettingsStatusRow(section.body, {
      label: t('providerConnectionTitle'),
      value: `${readyCount}/${enabledCount}`,
      statusLabel:
        profiles.length === 0
          ? t('providerStatusNone')
          : attentionCount > 0
            ? t('providerStatusNeedsSetup', { count: attentionCount })
            : enabledCount === 0
              ? t('providerStatusOff')
              : t('providerStatusReady'),
      detail:
        profiles.length === 0
          ? t('providerSummaryNoProfiles')
          : t('providerStatusSummaryDetail', {
              total: profiles.length,
              enabled: enabledCount,
              ready: readyCount,
            }),
      tone:
        attentionCount > 0 ? 'warning' : readyCount > 0 ? 'success' : 'neutral',
    });
    if (firstAttention) {
      const tone = this.getProviderProfileTone(firstAttention);
      this.createSettingsActionRow(section.body, {
        label: t('providerAttentionTitle', { provider: firstAttentionName }),
        detail:
          tone === 'needs-key'
            ? t('providerSummaryNeedsKey')
            : t('providerSummaryNeedsModels'),
        actionLabel: t('providerContinueSetup'),
        tone: 'warning',
        onActivate: () => {
          this.expandedProviderProfileId = firstAttention.id;
          this.refreshProvidersTab();
        },
      });
    }
    new Setting(section.body)
      .setName(t('providerAddTitle'))
      .setDesc(t('providerAddDesc'))
      .addButton((button) => {
        button.setButtonText(t('settingsAuto268'));
        if (!firstAttention) button.setCta();
        button.onClick(() => this.createProviderProfile());
      });
  }

  private buildProviderConnectionsSection(
    containerEl: HTMLElement,
    profiles: readonly ProviderProfileConfig[],
  ): void {
    const section = this.createSettingsSection(containerEl, t('providerConnectionsSectionTitle'), {
      description: t('providerConnectionsSectionDesc'),
    });
    if (profiles.length === 0) {
      this.createSettingsNotice(section.body, {
        text: t('providerConnectionsEmpty'),
        tone: 'info',
        icon: 'plug-zap',
      });
      return;
    }
    const list = section.body.createDiv({ cls: 'superpower-inside-provider-connection-list' });
    for (const profile of profiles) {
      this.buildProviderProfileDisclosure(list, profile);
    }
  }

  private buildProviderProfileDisclosure(
    containerEl: HTMLElement,
    profile: ProviderProfileConfig,
  ): void {
    const tone = this.getProviderProfileTone(profile);
    const disclosure = this.createSettingsDisclosure(
      containerEl,
      `provider-${profile.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      profile.name.trim() || PROVIDER_STRATEGY_LABELS[profile.strategy],
      t('providerModelCountLine', {
        provider: PROVIDER_STRATEGY_LABELS[profile.strategy],
        general: String(profile.models.filter((model) => model.kind === 'general').length),
        embedding: String(profile.models.filter((model) => model.kind === 'embedding').length),
      }),
      { idPrefix: 'superpower-inside-provider-disclosure' },
    );
    const root = disclosure.button.parentElement;
    root?.addClass('superpower-inside-provider-disclosure');
    root?.setAttribute('data-provider-key', profile.id);
    const icon = disclosure.button.querySelector('.superpower-inside-settings-disclosure-icon');
    const status = disclosure.button.createSpan({
      cls: `superpower-inside-provider-disclosure-status is-${tone}`,
      text: this.getProviderProfileStatusLabel(tone),
    });
    status.setAttribute('aria-live', 'polite');
    if (icon) disclosure.button.insertBefore(status, icon);
    disclosure.content.addClass('superpower-inside-provider-profile-content');
    const detailContext = disclosure.content.createDiv({
      cls: 'superpower-inside-provider-detail-context',
    });
    const detailContextIcon = detailContext.createSpan({
      cls: 'superpower-inside-provider-detail-context-icon',
    });
    setIcon(detailContextIcon, 'settings-2');
    detailContext.createSpan({ text: t('providerDetailContextLabel') });
    disclosure.button.addEventListener('click', () => {
      this.expandedProviderProfileId =
        this.expandedProviderProfileId === profile.id ? null : profile.id;
      this.refreshProviderProfileDisclosures(containerEl);
    });
    if (this.expandedProviderProfileId === profile.id) {
      disclosure.button.setAttribute('aria-expanded', 'true');
      root?.addClass('is-open');
      disclosure.content.removeClass('is-collapsed');
    }
    if (tone === 'needs-key' || tone === 'needs-models') {
      this.createSettingsNotice(disclosure.content, {
        text: tone === 'needs-key' ? t('providerSummaryNeedsKey') : t('providerSummaryNeedsModels'),
        tone: 'warning',
        icon: tone === 'needs-key' ? 'key-round' : 'list-plus',
      });
    }
    this.buildProviderConnectionSettings(disclosure.content, profile);
    if (profile.strategy !== 'ternlight') {
      this.buildProviderProfileModelSection(
        disclosure.content,
        profile,
        'general',
        this.getProviderStatusElement(disclosure.content),
      );
    }
    this.buildProviderProfileModelSection(
      disclosure.content,
      profile,
      'embedding',
      this.getProviderStatusElement(disclosure.content),
    );
    const danger = this.createSettingsDisclosure(
      disclosure.content,
      'provider-danger',
      t('providerDangerTitle'),
      t('providerDangerDesc'),
      { idPrefix: `superpower-inside-provider-${profile.id}` },
    );
    danger.button.addClass('is-danger');
    const profileName = profile.name.trim() || PROVIDER_STRATEGY_LABELS[profile.strategy];
    this.createSettingsNotice(danger.content, {
      text: t('providerRemoveWarning', { provider: profileName }),
      tone: 'danger',
      icon: 'triangle-alert',
    });
    const dangerActions = danger.content.createDiv({
      cls: 'superpower-inside-settings-danger-actions',
    });
    const removeButton = dangerActions.createEl('button', {
      cls: 'superpower-inside-settings-danger-button',
      attr: { type: 'button' },
    });
    setIcon(removeButton, 'trash-2');
    removeButton.createSpan({ text: t('settingsAuto267') });
    removeButton.addEventListener('click', () => {
      void this.removeProviderProfile(profile, removeButton);
    });
  }

  private buildProviderConnectionSettings(
    containerEl: HTMLElement,
    profile: ProviderProfileConfig,
  ): void {
    const group = containerEl.createDiv({ cls: 'superpower-inside-provider-connection-group' });
    group.createDiv({
      cls: 'superpower-inside-provider-group-title',
      text: t('providerConnectionSection'),
    });
    new Setting(group).setName(t('enabled')).addToggle((toggle) =>
      toggle.setValue(profile.enabled).onChange((value) => {
        profile.enabled = value;
        this.debouncedSave();
        this.renderSettingsView();
      }),
    );
    new Setting(group).setName(t('settingsAuto244')).addText((text) =>
      text
        .setPlaceholder(t('settingsAuto245'))
        .setValue(profile.name)
        .onChange((value) => {
          profile.name = value.trim();
          this.debouncedSave();
        }),
    );
    this.buildProviderStrategySelector(group, profile);
    if (shouldShowProviderApiKey(this.getProfileApiKeyVisibilityKey(profile))) {
      let apiKeyInput: HTMLInputElement | null = null;
      new Setting(group)
        .setName(t('apiKey'))
        .addText((text) => {
          apiKeyInput = text.inputEl;
          text.inputEl.type = 'password';
          text.inputEl.autocomplete = 'off';
          text.inputEl.setAttribute('aria-label', t('apiKey'));
          text
            .setPlaceholder('sk-...')
            .setValue(profile.apiKey)
            .onChange((value) => {
              profile.apiKey = value.trim();
              this.debouncedSave();
            });
        })
        .addExtraButton((button) => {
          button.setIcon('eye').setTooltip(t('providerApiKeyShow'));
          button.onClick(() => {
            if (!apiKeyInput) return;
            const isVisible = apiKeyInput.type === 'text';
            apiKeyInput.type = isVisible ? 'password' : 'text';
            button
              .setIcon(isVisible ? 'eye' : 'eye-off')
              .setTooltip(isVisible ? t('providerApiKeyShow') : t('providerApiKeyHide'));
          });
        });
    }
    if (profile.strategy !== 'ternlight') {
      new Setting(group).setName(t('providerBaseUrl')).addText((text) =>
        text
          .setPlaceholder(this.getProviderStrategyDefaultBaseUrl(profile.strategy))
          .setValue(profile.baseUrl ?? '')
          .onChange((value) => {
            profile.baseUrl = value.trim();
            this.debouncedSave();
          }),
      );
    }
  }

  private getProviderStatusElement(containerEl: HTMLElement): HTMLElement {
    const existing = containerEl.querySelector<HTMLElement>(
      '.superpower-inside-provider-validation-status',
    );
    if (existing) return existing;
    const status = containerEl.createDiv({ cls: 'superpower-inside-provider-validation-status' });
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
  }

  private getProviderProfileTone(
    profile: ProviderProfileConfig,
  ): 'ready' | 'needs-key' | 'needs-models' | 'disabled' {
    if (!profile.enabled) return 'disabled';
    if (
      shouldRequireProviderApiKey(this.getProfileApiKeyVisibilityKey(profile)) &&
      !profile.apiKey.trim()
    ) {
      return 'needs-key';
    }
    if (profile.models.length === 0) return 'needs-models';
    return 'ready';
  }

  private getProviderProfileStatusLabel(
    tone: 'ready' | 'needs-key' | 'needs-models' | 'disabled',
  ): string {
    if (tone === 'ready') return t('providerStatusReady');
    if (tone === 'needs-key') return t('providerStatusNeedsKey');
    if (tone === 'needs-models') return t('providerStatusNeedsModels');
    return t('providerStatusOff');
  }

  private refreshProviderProfileDisclosures(containerEl: HTMLElement): void {
    const list = containerEl.closest('.superpower-inside-provider-connection-list');
    if (!list) return;
    const disclosures = Array.from(
      list.querySelectorAll<HTMLElement>('.superpower-inside-provider-disclosure'),
    );
    for (const disclosure of disclosures) {
      const key = disclosure.dataset.providerKey ?? '';
      const expanded = key === this.expandedProviderProfileId;
      disclosure.toggleClass('is-open', expanded);
      disclosure
        .querySelector<HTMLElement>('.superpower-inside-settings-disclosure-button')
        ?.setAttribute('aria-expanded', String(expanded));
      disclosure
        .querySelector<HTMLElement>('.superpower-inside-settings-disclosure-content')
        ?.toggleClass('is-collapsed', !expanded);
    }
  }

  private createProviderProfile(): void {
    const id = this.createProviderProfileId();
    this.plugin.settings.providerProfiles.push({
      id,
      name: t('providerNewName'),
      strategy: 'openAICompatible',
      apiKey: '',
      baseUrl: '',
      enabled: false,
      models: [],
      useRequestUrl: true,
    });
    this.expandedProviderProfileId = id;
    this.debouncedSave();
    this.refreshProvidersTab();
  }

  private refreshProvidersTab(): void {
    const panel = this.tabPanels.get('providers');
    if (panel?.isConnected) this.buildProvidersTab(panel);
  }

  private async removeProviderProfile(
    profile: ProviderProfileConfig,
    button: HTMLButtonElement,
  ): Promise<void> {
    const profileName = profile.name.trim() || PROVIDER_STRATEGY_LABELS[profile.strategy];
    await runActionWithFeedback({
      button,
      action: async () => {
        if (!(await confirmWithModal(this.app, t('providerRemoveConfirm', { provider: profileName })))) {
          return { status: 'noop', detail: t('actionCancelledNotice') };
        }
        this.plugin.settings.providerProfiles = this.plugin.settings.providerProfiles.filter(
          (item) => item.id !== profile.id,
        );
        if (this.expandedProviderProfileId === profile.id) {
          this.expandedProviderProfileId = null;
        }
        await this.plugin.saveSettingsLight();
        return { status: 'success', detail: t('providerRemoved', { provider: profileName }) };
      },
    });
    this.refreshProvidersTab();
  }

  private buildProviderStrategySelector(
    containerEl: HTMLElement,
    profile: ProviderProfileConfig,
  ): void {
    new Setting(containerEl)
      .setName(t('providerStrategyLabel'))
      .setDesc(t('providerStrategyDesc'))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(PROVIDER_STRATEGY_LABELS)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(profile.strategy).onChange((value) => {
          const strategy = value as ProviderStrategyKey;
          if (profile.strategy === strategy) return;
          const previousDefault = this.getProviderStrategyDefaultBaseUrl(profile.strategy);
          const nextDefault = this.getProviderStrategyDefaultBaseUrl(strategy);
          if (!profile.baseUrl?.trim() || profile.baseUrl === previousDefault) {
            profile.baseUrl = nextDefault;
          }
          profile.strategy = strategy;
          delete this.plugin.settings.providerValidation[`profile:${profile.id}`];
          this.debouncedSave();
          this.renderSettingsView();
        });
      });
  }

  private buildProviderProfileModelSection(
    containerEl: HTMLElement,
    profile: ProviderProfileConfig,
    kind: ProviderModelKind,
    statusEl: HTMLElement,
  ): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-provider-model-group superpower-inside-provider-profile-model-section',
    });
    const header = section.createDiv({
      cls: 'superpower-inside-provider-model-group-header',
    });
    header.createDiv({
      cls: 'superpower-inside-provider-group-title',
      text: kind === 'embedding' ? t('providerEmbeddingModels') : t('providerGeneralModels'),
    });
    const toolbar = header.createDiv({ cls: 'superpower-inside-provider-model-actions' });
    if (kind === 'general') {
      const fetchButton = toolbar.createEl('button', {
        cls: 'superpower-inside-provider-model-fetch-btn',
        attr: { type: 'button', 'aria-label': t('fetchModels'), title: t('fetchModels') },
      });
      setIcon(fetchButton, 'download');
      fetchButton.createSpan({ text: t('fetchModels') });
      fetchButton.addEventListener('click', () => {
        void runActionWithFeedback({
          button: fetchButton,
          action: async () => {
            const { fetchProviderModelsForStrategy } = await import('./llm/validation');
            const result = await fetchProviderModelsForStrategy(profile.strategy, {
              ...profile,
              models: profile.models.map((model) => model.id),
            });
            if (!result.valid) {
              const detail = String(result.error);
              statusEl.setText(detail);
              return { status: 'error', detail, notice: detail };
            }
            const candidates =
              result.modelDetails && result.modelDetails.length > 0
                ? result.modelDetails
                : result.models.map((id) => ({ id }));
            this.openProviderModelImportModal(profile, candidates, statusEl);
            return { status: 'success', detail: String(candidates.length) };
          },
        });
      });
    }
    const addRow = section.createDiv({ cls: 'superpower-inside-provider-model-add-row' });
    const input = addRow.createEl('input', {
      type: 'text',
      placeholder: kind === 'embedding' ? 'text-embedding-3-small' : 'gpt-4o-mini',
      cls: 'superpower-inside-provider-model-add-input',
    });
    const addButton = addRow.createEl('button', {
      cls: 'superpower-inside-provider-model-add-btn',
      attr: {
        type: 'button',
        'aria-label':
          kind === 'embedding' ? t('providerAddEmbeddingModel') : t('providerAddGeneralModel'),
        title: kind === 'embedding' ? t('providerAddEmbeddingModel') : t('providerAddGeneralModel'),
      },
    });
    setIcon(addButton, 'plus');
    const updateAddButtonState = (): void => {
      addButton.disabled = !input.value.trim();
    };
    const addModel = (): void => {
      const id = input.value.trim();
      if (!id) return;
      profile.models = upsertProviderProfileModel(
        profile.models,
        createProviderModel(id, kind, {
          chatStatus: kind === 'general' ? 'unknown' : 'unknown',
          embeddingStatus: kind === 'embedding' ? 'unknown' : 'unknown',
        }),
      );
      input.value = '';
      this.debouncedSave();
      this.renderSettingsView();
    };
    addButton.addEventListener('click', addModel);
    input.addEventListener('input', updateAddButtonState);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !input.value.trim()) return;
      event.preventDefault();
      addModel();
    });
    updateAddButtonState();
    const list = section.createDiv({
      cls: 'superpower-inside-settings-model-list superpower-inside-provider-model-list',
    });
    const models = profile.models.filter((model) => model.kind === kind);
    if (models.length === 0) {
      list.createDiv({ cls: 'superpower-inside-provider-empty-models', text: t('noModelsFound') });
      return;
    }
    for (const model of models) {
      const item = list.createDiv({ cls: 'superpower-inside-settings-model-item' });
      item.createSpan({ cls: 'superpower-inside-provider-model-name', text: model.id });
      const capabilityRow = item.createSpan({
        cls: 'superpower-inside-provider-model-capabilities',
      });
      const status =
        kind === 'embedding' ? model.verification.embeddingStatus : model.verification.chatStatus;
      capabilityRow.createSpan({
        cls: `superpower-inside-provider-model-capability is-${status}`,
        text: this.getCapabilityLabel(kind === 'embedding' ? 'embedding' : 'chat', status),
      });
      const actions = item.createSpan({ cls: 'superpower-inside-provider-model-actions' });
      const verifyButton = actions.createEl('button', {
        cls: 'superpower-inside-provider-model-action-btn',
        attr: {
          type: 'button',
          'aria-label':
            kind === 'embedding' ? t('providerTestEmbeddingModel') : t('providerTestChatModel'),
        },
      });
      setIcon(verifyButton, kind === 'embedding' ? 'scan-search' : 'sparkles');
      verifyButton.addEventListener('click', () => {
        void this.verifyProviderProfileModel(profile, model.id, kind, verifyButton, statusEl);
      });
      const removeButton = actions.createEl('button', {
        cls: 'superpower-inside-provider-model-action-btn',
        attr: { type: 'button', 'aria-label': t('settingsAuto267') },
      });
      setIcon(removeButton, 'x');
      removeButton.addEventListener('click', () => {
        profile.models = profile.models.filter((itemModel) => itemModel.id !== model.id);
        this.debouncedSave();
        this.renderSettingsView();
      });
    }
  }

  private openProviderModelImportModal(
    profile: ProviderProfileConfig,
    candidates: readonly ProviderModelImportCandidate[],
    statusEl: HTMLElement,
  ): void {
    const modal = new ProviderModelImportModal(this.app, {
      providerName: profile.name.trim() || PROVIDER_STRATEGY_LABELS[profile.strategy],
      candidates,
      existingIds: new Set(profile.models.map((model) => model.id)),
      onSubmit: (modelIds) => {
        for (const modelId of modelIds) {
          profile.models = upsertProviderProfileModel(
            profile.models,
            createProviderModel(modelId, 'general'),
          );
        }
        statusEl.setText(t('providerImportAdded', { v0: String(modelIds.length) }));
        void this.plugin.saveSettingsLight();
        this.renderSettingsView();
      },
    });
    modal.open();
  }

  private async verifyProviderProfileModel(
    profile: ProviderProfileConfig,
    modelId: string,
    kind: ProviderModelKind,
    button: HTMLButtonElement,
    statusEl: HTMLElement,
  ): Promise<void> {
    await runActionWithFeedback({
      button,
      loadingText: t('testing'),
      action: async () => {
        const validationConfig = { ...profile, models: profile.models.map((model) => model.id) };
        if (kind === 'embedding') {
          const { testEmbeddingGenerationForStrategy } = await import('./llm/validation');
          const result = await testEmbeddingGenerationForStrategy(
            profile.strategy,
            modelId,
            validationConfig,
            this.getTernlightRuntimeOptions(),
          );
          profile.models = upsertProviderProfileModel(
            profile.models,
            createProviderModel(modelId, 'embedding', {
              embeddingStatus: result.valid ? 'success' : 'failed',
              lastError: result.valid ? undefined : String(result.error),
              lastCheckedAt: Date.now(),
            }),
          );
          await this.plugin.saveSettingsLight();
          const detail = result.valid
            ? t('settingsAuto101', { v0: String(modelId) })
            : t('settingsAuto102', { v0: String(result.error) });
          statusEl.setText(detail);
          return result.valid
            ? { status: 'success' as const, detail }
            : { status: 'error' as const, detail: String(result.error), notice: detail };
        }
        const { testProviderGenerationForStrategy } = await import('./llm/validation');
        const result = await testProviderGenerationForStrategy(
          profile.strategy,
          validationConfig,
          modelId,
        );
        const existing = profile.models.find((model) => model.id === modelId);
        profile.models = upsertProviderProfileModel(
          profile.models,
          createProviderModel(modelId, existing?.kind === 'embedding' ? 'embedding' : 'general', {
            chatStatus: result.valid ? 'success' : 'failed',
            lastError: result.valid ? undefined : String(result.error),
            lastCheckedAt: Date.now(),
          }),
        );
        await this.plugin.saveSettingsLight();
        const detail = result.valid
          ? t('settingsAuto264', { v0: String(modelId) })
          : t('settingsAuto265', { v0: String(result.error) });
        statusEl.setText(detail);
        return result.valid
          ? { status: 'success' as const, detail }
          : { status: 'error' as const, detail: String(result.error), notice: detail };
      },
    });
    this.renderSettingsView();
  }

  private getProfileApiKeyVisibilityKey(
    profile: ProviderProfileConfig,
  ): 'ternlight' | 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter' | 'customOpenAI' {
    return profile.strategy === 'openAICompatible' ? 'customOpenAI' : profile.strategy;
  }

  private getTernlightRuntimeOptions(): TernlightRuntimeOptions {
    return {
      app: this.plugin.app,
      pluginId: this.plugin.manifest?.id ?? 'superpower-inside',
      pluginVersion: this.plugin.manifest?.version ?? 'development',
    };
  }

  private getProviderStrategyDefaultBaseUrl(strategy: ProviderStrategyKey): string {
    switch (strategy) {
      case 'openai':
        return 'https://api.openai.com';
      case 'claude':
        return 'https://api.anthropic.com';
      case 'ollama':
        return 'http://localhost:11434';
      case 'ollamaCloud':
        return 'https://ollama.com';
      case 'openRouter':
        return 'https://openrouter.ai/api';
      case 'openAICompatible':
        return 'http://localhost:1234/v1';
      case 'ternlight':
        return '';
      default:
        return '';
    }
  }

  private createProviderProfileId(): string {
    const existing = new Set(this.plugin.settings.providerProfiles.map((profile) => profile.id));
    let index = this.plugin.settings.providerProfiles.length + 1;
    let id = `profile-${index}`;
    while (existing.has(id)) {
      index += 1;
      id = `profile-${index}`;
    }
    return id;
  }

  private getFreshProviderValidation(
    providerKey: string,
    config: ProviderConfig | CustomOpenAIProviderConfig,
  ): ProviderValidationSnapshot | undefined {
    return getFreshProviderValidation(this.plugin.settings.providerValidation, providerKey, config);
  }
  private getProviderModelCapabilities(
    providerKey: string,
    config: ProviderConfig | CustomOpenAIProviderConfig,
  ): Record<string, ModelCapabilitySnapshot> {
    return this.getFreshProviderValidation(providerKey, config)?.modelCapabilities ?? {};
  }
  private async recordProviderValidation(
    providerKey: string,
    config: ProviderConfig | CustomOpenAIProviderConfig,
    patch: Partial<ProviderValidationSnapshot>,
  ): Promise<void> {
    const checkedAt = Date.now();
    const current =
      this.getFreshProviderValidation(providerKey, config) ??
      ({
        providerFingerprint: createProviderValidationFingerprint(config),
        modelCapabilities: {},
      } satisfies ProviderValidationSnapshot);
    this.plugin.settings.providerValidation[providerKey] = {
      ...current,
      ...patch,
      providerFingerprint: createProviderValidationFingerprint(config),
      lastCheckedAt: checkedAt,
      modelCapabilities: current.modelCapabilities ?? {},
    };
    await this.plugin.saveSettingsLight();
  }
  private async recordModelCapability(
    providerKey: string,
    config: ProviderConfig | CustomOpenAIProviderConfig,
    modelId: string,
    capability: 'chatStatus' | 'embeddingStatus',
    status: ModelCapabilityStatus,
    error?: string,
  ): Promise<void> {
    const checkedAt = Date.now();
    const current =
      this.getFreshProviderValidation(providerKey, config) ??
      ({
        providerFingerprint: createProviderValidationFingerprint(config),
        modelCapabilities: {},
      } satisfies ProviderValidationSnapshot);
    const modelCapabilities = { ...(current.modelCapabilities ?? {}) };
    modelCapabilities[modelId] = mergeModelCapability(
      modelCapabilities[modelId],
      {
        [capability]: status,
        ...(error ? { lastError: error } : { lastError: undefined }),
      },
      checkedAt,
    );
    this.plugin.settings.providerValidation[providerKey] = {
      ...current,
      providerFingerprint: createProviderValidationFingerprint(config),
      serverReachable: status === 'success' || current.serverReachable,
      authenticated:
        capability === 'chatStatus' && status === 'success' ? true : current.authenticated,
      generationTested:
        capability === 'chatStatus' && status === 'success' ? true : current.generationTested,
      lastCheckedAt: checkedAt,
      lastError: error,
      modelCapabilities,
    };
    await this.plugin.saveSettingsLight();
  }
  private getEmbeddingValidationKeyForTarget(
    target: ProviderSettingsTarget,
  ): EmbeddingProviderKey | null {
    if (target.kind === 'custom') {
      return `customOpenAI:${target.config.id}`;
    }
    if (target.key === 'openai' || target.key === 'openRouter' || target.key === 'ollama') {
      return target.key;
    }
    return null;
  }
  private getCapabilityLabel(
    kind: 'chat' | 'embedding',
    status: ModelCapabilityStatus | undefined,
  ): string {
    if (kind === 'chat') {
      if (status === 'success') return t('providerModelChatVerified');
      if (status === 'failed') return t('providerModelChatFailed');
      return t('providerModelChatUnknown');
    }
    if (status === 'success') return t('providerModelEmbeddingVerified');
    if (status === 'failed') return t('providerModelEmbeddingFailed');
    return t('providerModelEmbeddingUnknown');
  }
  private getProviderVisualState(target: ProviderSettingsTarget): ProviderVisualState {
    const { config } = target;
    const apiKeyVisibilityKey = target.kind === 'custom' ? 'customOpenAI' : target.key;
    const apiKeyRequired = shouldRequireProviderApiKey(apiKeyVisibilityKey);
    const hasApiKey = !apiKeyRequired || config.apiKey.trim().length > 0;
    const modelCount = config.models.length;
    const validation = this.getFreshProviderValidation(target.key, config);
    const readiness = resolveProviderReadiness({
      enabled: config.enabled,
      modelCount,
      apiKeyRequired,
      hasApiKey,
      validation,
    });
    const modelLabel =
      modelCount > 0
        ? t('providerModelsSelected', { v0: String(modelCount) })
        : t('providerNoModelsShort');
    const keyLabel = apiKeyRequired
      ? hasApiKey
        ? t('providerKeyReady')
        : t('providerKeyMissing')
      : t('providerKeyNotRequired');
    const typeLabel = target.kind === 'custom' ? t('providerTypeCustom') : t('providerTypeBuiltIn');

    if (!config.enabled) {
      return {
        tone: 'disabled',
        iconName: 'power-off',
        statusLabel: t('providerStatusOff'),
        summary: t('providerSummaryOff'),
        keyLabel,
        modelLabel,
        typeLabel,
      };
    }
    if (readiness.tone === 'needs-key') {
      return {
        tone: 'needs-key',
        iconName: 'key-round',
        statusLabel: t('providerStatusNeedsKey'),
        summary: t('providerSummaryNeedsKey'),
        keyLabel,
        modelLabel,
        typeLabel,
      };
    }
    if (readiness.tone === 'needs-models') {
      return {
        tone: 'needs-models',
        iconName: 'list-plus',
        statusLabel: t('providerStatusNeedsModels'),
        summary: t('providerSummaryNeedsModels'),
        keyLabel,
        modelLabel,
        typeLabel,
      };
    }
    return {
      tone: 'ready',
      iconName: 'badge-check',
      statusLabel: t('providerStatusReady'),
      summary: t('providerSummaryReady', { v0: String(modelCount) }),
      keyLabel,
      modelLabel,
      typeLabel,
    };
  }
  private buildProviderSettings(containerEl: HTMLElement, target: ProviderSettingsTarget): void {
    const { config, label } = target;
    const cacheKey = target.key;
    const initialState = this.getProviderVisualState(target);
    const startsExpanded = initialState.tone !== 'disabled' || target.kind === 'custom';
    const section = containerEl.createDiv({
      cls: `superpower-inside-provider-shell superpower-inside-provider-card is-${initialState.tone}`,
    });
    section.toggleClass('is-expanded', startsExpanded);
    section.toggleClass('is-collapsed', !startsExpanded);
    section.setAttribute('data-provider-key', cacheKey);

    const hero = section.createEl('button', {
      cls: 'superpower-inside-provider-hero',
      attr: { type: 'button', 'aria-expanded': String(startsExpanded) },
    });
    const brandIcon = hero.createSpan({ cls: 'superpower-inside-provider-brand-icon' });
    const titleCopy = hero.createSpan({ cls: 'superpower-inside-provider-title-copy' });
    titleCopy.createSpan({ cls: 'superpower-inside-provider-title-text', text: label });
    const summaryText = titleCopy.createSpan({ cls: 'superpower-inside-provider-subtitle' });
    const statusToken = hero.createSpan({ cls: 'superpower-inside-provider-status-token' });
    const modelPreview = hero.createSpan({ cls: 'superpower-inside-provider-model-preview' });
    const chevron = hero.createSpan({ cls: 'superpower-inside-provider-chevron' });
    setIcon(chevron, 'chevron-right');

    const body = section.createDiv({ cls: 'superpower-inside-provider-body' });
    const quickRow = body.createDiv({ cls: 'superpower-inside-provider-quick-row' });

    const renderProviderHeader = (): void => {
      const visualState = this.getProviderVisualState(target);
      section.classList.remove('is-ready', 'is-needs-key', 'is-needs-models', 'is-disabled');
      section.classList.add(`is-${visualState.tone}`);
      brandIcon.empty();
      setIcon(brandIcon, visualState.iconName);
      summaryText.setText(visualState.summary);
      statusToken.className = `superpower-inside-provider-status-token is-${visualState.tone}`;
      statusToken.setText(visualState.statusLabel);
      modelPreview.empty();
      if (config.models.length === 0) {
        modelPreview.createSpan({
          cls: 'superpower-inside-provider-preview-empty',
          text: t('providerNoModelsShort'),
        });
      } else {
        for (const model of config.models.slice(0, 2)) {
          modelPreview.createSpan({ cls: 'superpower-inside-provider-preview-chip', text: model });
        }
        if (config.models.length > 2) {
          modelPreview.createSpan({
            cls: 'superpower-inside-provider-preview-more',
            text: `+${config.models.length - 2}`,
          });
        }
      }
      quickRow.empty();
      const quickFacts = [
        { iconName: 'key-round', label: t('providerQuickKey'), value: visualState.keyLabel },
        { iconName: 'boxes', label: t('providerQuickModels'), value: visualState.modelLabel },
        { iconName: 'route', label: t('providerQuickType'), value: visualState.typeLabel },
      ];
      for (const fact of quickFacts) {
        const item = quickRow.createDiv({ cls: 'superpower-inside-provider-quick-fact' });
        const icon = item.createSpan({ cls: 'superpower-inside-provider-quick-icon' });
        setIcon(icon, fact.iconName);
        const copy = item.createSpan({ cls: 'superpower-inside-provider-quick-copy' });
        copy.createSpan({ cls: 'superpower-inside-provider-quick-label', text: fact.label });
        copy.createSpan({ cls: 'superpower-inside-provider-quick-value', text: fact.value });
      }
    };

    hero.addEventListener('click', () => {
      const expanded = section.hasClass('is-collapsed');
      section.toggleClass('is-expanded', expanded);
      section.toggleClass('is-collapsed', !expanded);
      hero.setAttribute('aria-expanded', String(expanded));
    });

    const connectionSection = body.createDiv({
      cls: 'superpower-inside-provider-section superpower-inside-provider-connection-panel',
    });
    connectionSection.createDiv({
      cls: 'superpower-inside-provider-section-title',
      text: t('providerConnectionSection'),
    });
    new Setting(connectionSection).setName(t('enabled')).addToggle((toggle) =>
      toggle.setValue(config.enabled).onChange((value) => {
        config.enabled = value;
        renderProviderHeader();
        this.debouncedSave();
      }),
    );
    const apiKeyVisibilityKey = target.kind === 'custom' ? 'customOpenAI' : target.key;
    if (shouldShowProviderApiKey(apiKeyVisibilityKey)) {
      new Setting(connectionSection).setName(t('apiKey')).addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(config.apiKey)
          .onChange((value) => {
            config.apiKey = value.trim();
            renderProviderHeader();
            this.debouncedSave();
          }),
      );
    }
    if (target.kind === 'custom') {
      new Setting(connectionSection).setName(t('settingsAuto244')).addText((text) =>
        text
          .setPlaceholder(t('settingsAuto245'))
          .setValue(target.config.name)
          .onChange((value) => {
            target.config.name = value.trim();
            this.debouncedSave();
          }),
      );
      new Setting(connectionSection).setName('OpenAI v1 Base URL').addText((text) =>
        text
          .setPlaceholder(t('settingsAuto246'))
          .setValue(target.config.baseUrl ?? '')
          .onChange((value) => {
            target.config.baseUrl = value.trim();
            this.debouncedSave();
          }),
      );
      const useRequestUrl = target.config.useRequestUrl ?? true;
      new Setting(connectionSection)
        .setName(t('settingsAuto247'))
        .setDesc(t('settingsAuto248') + t('settingsAuto249'))
        .addToggle((toggle) =>
          toggle.setValue(useRequestUrl).onChange((value) => {
            target.config.useRequestUrl = value;
            this.debouncedSave();
          }),
        );
      const capabilityOverrides = target.config.capabilityOverrides ?? {};
      const updateCapabilityOverride = <K extends keyof ProviderCapabilityOverrides>(
        key: K,
        value: ProviderCapabilityOverrides[K],
      ): void => {
        target.config.capabilityOverrides = {
          ...(target.config.capabilityOverrides ?? {}),
          [key]: value,
        };
        this.debouncedSave();
      };
      new Setting(connectionSection)
        .setName(t('providerCapabilityToolCalling'))
        .setDesc(t('providerCapabilityToolCallingDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.toolCalling ?? false).onChange((value) => {
            updateCapabilityOverride('toolCalling', value);
          }),
        );
      new Setting(connectionSection)
        .setName(t('providerCapabilityReasoning'))
        .setDesc(t('providerCapabilityReasoningDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.reasoning ?? false).onChange((value) => {
            updateCapabilityOverride('reasoning', value);
          }),
        );
      new Setting(connectionSection)
        .setName(t('providerCapabilityLiveStreaming'))
        .setDesc(t('providerCapabilityLiveStreamingDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.streaming ?? !useRequestUrl).onChange((value) => {
            updateCapabilityOverride('streaming', value);
          }),
        );
      const defaultAbort = useRequestUrl ? 'best-effort' : 'native';
      new Setting(connectionSection)
        .setName(t('providerCapabilityNativeAbort'))
        .setDesc(t('providerCapabilityNativeAbortDesc'))
        .addToggle((toggle) =>
          toggle
            .setValue((capabilityOverrides.abort ?? defaultAbort) === 'native')
            .onChange((value) => {
              updateCapabilityOverride('abort', value ? 'native' : 'best-effort');
            }),
        );
      new Setting(connectionSection)
        .setName(t('providerCapabilityMaxToolRounds'))
        .setDesc(t('providerCapabilityMaxToolRoundsDesc'))
        .addText((text) =>
          text
            .setPlaceholder('0')
            .setValue(String(capabilityOverrides.maxToolRounds ?? 0))
            .onChange((value) => {
              const parsed = Number(value.trim());
              updateCapabilityOverride(
                'maxToolRounds',
                Number.isInteger(parsed) && parsed >= 0 ? parsed : 0,
              );
            }),
        );
    }

    const modelSection = body.createDiv({
      cls: 'superpower-inside-provider-section superpower-inside-provider-model-shell',
    });
    modelSection.createDiv({
      cls: 'superpower-inside-provider-section-title',
      text: t('providerModelsSection'),
    });
    const controls = modelSection.createDiv({ cls: 'superpower-inside-provider-model-controls' });
    const searchInput = controls.createEl('input', {
      type: 'search',
      placeholder: t('settingsAuto250'),
      cls: 'superpower-inside-provider-model-search',
    });
    const selectedOnlyLabel = controls.createEl('label', {
      cls: 'superpower-inside-provider-selected-only',
    });
    const selectedOnlyInput = selectedOnlyLabel.createEl('input', { type: 'checkbox' });
    selectedOnlyLabel.createSpan({ text: t('selectedOnly') });
    const modelListContainer = modelSection.createDiv({
      cls: 'superpower-inside-settings-model-list superpower-inside-provider-model-list',
    });
    const statusContainer = body.createDiv({
      cls: 'superpower-inside-provider-validation-status',
    });
    statusContainer.setAttribute('role', 'status');
    statusContainer.setAttribute('aria-live', 'polite');
    let filterText = '';
    let selectedOnly = false;
    let availableModels = this.getInitialProviderModels(cacheKey, config);
    const renderModelList = () => {
      modelListContainer.empty();
      renderProviderHeader();
      if (availableModels.length === 0) {
        modelListContainer.createDiv({
          cls: 'superpower-inside-provider-empty-models',
          text: t('noModelsFound'),
        });
        return;
      }
      const normalizedFilter = filterText.trim().toLowerCase();
      const sortedModels = [...availableModels].sort((a, b) => a.localeCompare(b, 'en'));
      const visibleModels = sortedModels.filter((model) => {
        if (selectedOnly && !config.models.includes(model)) return false;
        if (!normalizedFilter) return true;
        return model.toLowerCase().includes(normalizedFilter);
      });
      const header = modelListContainer.createDiv({
        cls: 'superpower-inside-settings-model-list-header',
      });
      header.textContent = t('settingsAuto253', {
        v0: String(visibleModels.length),
        v1: String(sortedModels.length),
      });
      if (visibleModels.length === 0) {
        modelListContainer.createDiv({
          cls: 'superpower-inside-provider-empty-models',
          text: t('settingsAuto254'),
        });
        return;
      }
      visibleModels.forEach((model) => {
        const item = modelListContainer.createDiv({ cls: 'superpower-inside-settings-model-item' });
        const checkbox = item.createEl('input', { type: 'checkbox' });
        checkbox.checked = config.models.includes(model);
        item.createSpan({ text: model });
        const capability = this.getProviderModelCapabilities(cacheKey, config)[model];
        const capabilityRow = item.createSpan({
          cls: 'superpower-inside-provider-model-capabilities',
        });
        const chatStatus = capabilityRow.createSpan({
          cls: `superpower-inside-provider-model-capability is-${capability?.chatStatus ?? 'unknown'}`,
          text: this.getCapabilityLabel('chat', capability?.chatStatus),
        });
        chatStatus.setAttribute('title', capability?.lastError ?? '');
        const embeddingStatus = capabilityRow.createSpan({
          cls: `superpower-inside-provider-model-capability is-${capability?.embeddingStatus ?? 'unknown'}`,
          text: this.getCapabilityLabel('embedding', capability?.embeddingStatus),
        });
        embeddingStatus.setAttribute('title', capability?.lastError ?? '');
        const modelActions = item.createSpan({
          cls: 'superpower-inside-provider-model-actions',
        });
        const chatTestButton = modelActions.createEl('button', {
          cls: 'superpower-inside-provider-model-action-btn',
          attr: { type: 'button', 'aria-label': t('providerTestChatModel') },
        });
        setIcon(chatTestButton, 'sparkles');
        chatTestButton.addEventListener('click', () => {
          void runActionWithFeedback({
            button: chatTestButton,
            action: async () => {
              statusContainer.setText('');
              try {
                const { testProviderGeneration } = await import('./llm/validation');
                const result =
                  target.kind === 'fixed'
                    ? await testProviderGeneration(target.key, config, model)
                    : await testProviderGeneration('customOpenAI', target.config, model);
                if (result.valid) {
                  await this.recordModelCapability(
                    cacheKey,
                    config,
                    model,
                    'chatStatus',
                    'success',
                  );
                  const detail = t('settingsAuto264', { v0: String(model) });
                  statusContainer.setText(detail);
                  renderModelList();
                  return { status: 'success', detail };
                }
                await this.recordModelCapability(
                  cacheKey,
                  config,
                  model,
                  'chatStatus',
                  'failed',
                  String(result.error),
                );
                const detail = t('settingsAuto265', { v0: String(result.error) });
                statusContainer.setText(detail);
                renderModelList();
                return { status: 'error', detail: String(result.error), notice: detail };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const detail = `${t('error')}: ${msg}`;
                statusContainer.setText(detail);
                return { status: 'error', detail: msg, notice: detail };
              }
            },
          });
        });
        const embeddingTestButton = modelActions.createEl('button', {
          cls: 'superpower-inside-provider-model-action-btn',
          attr: { type: 'button', 'aria-label': t('providerTestEmbeddingModel') },
        });
        setIcon(embeddingTestButton, 'scan-search');
        const embeddingProviderKey = this.getEmbeddingValidationKeyForTarget(target);
        if (embeddingProviderKey === null) {
          embeddingTestButton.disabled = true;
          embeddingTestButton.setAttribute('title', t('providerEmbeddingUnsupported'));
        } else {
          embeddingTestButton.addEventListener('click', () => {
            void runActionWithFeedback({
              button: embeddingTestButton,
              action: async () => {
                statusContainer.setText('');
                try {
                  const { testEmbeddingGeneration } = await import('./llm/validation');
                  const result = await testEmbeddingGeneration(embeddingProviderKey, model, config);
                  if (result.valid) {
                    await this.recordModelCapability(
                      cacheKey,
                      config,
                      model,
                      'embeddingStatus',
                      'success',
                    );
                    const detail = t('settingsAuto101', { v0: String(model) });
                    statusContainer.setText(detail);
                    renderModelList();
                    return { status: 'success', detail };
                  }
                  await this.recordModelCapability(
                    cacheKey,
                    config,
                    model,
                    'embeddingStatus',
                    'failed',
                    String(result.error),
                  );
                  const detail = t('settingsAuto102', { v0: String(result.error) });
                  statusContainer.setText(detail);
                  renderModelList();
                  return { status: 'error', detail: String(result.error), notice: detail };
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  const detail = `${t('error')}: ${msg}`;
                  statusContainer.setText(detail);
                  return { status: 'error', detail: msg, notice: detail };
                }
              },
            });
          });
        }
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            config.models.push(model);
          } else {
            config.models = config.models.filter((m) => m !== model);
          }
          this.debouncedSave();
          renderModelList();
        });
      });
    };
    searchInput.addEventListener('input', () => {
      filterText = searchInput.value;
      renderModelList();
    });
    selectedOnlyInput.addEventListener('change', () => {
      selectedOnly = selectedOnlyInput.checked;
      renderModelList();
    });

    const actionRail = body.createDiv({ cls: 'superpower-inside-provider-action-rail' });
    const createActionButton = (
      labelText: string,
      iconName: string,
      onClick: (button: HTMLButtonElement) => Promise<void>,
    ): void => {
      const button = actionRail.createEl('button', {
        cls: 'superpower-inside-provider-action-btn',
        attr: { type: 'button' },
      });
      setIcon(button, iconName);
      button.createSpan({ text: labelText });
      button.addEventListener('click', () => {
        void onClick(button);
      });
    };
    createActionButton(t('fetchModels'), 'download', async (button) => {
      await runActionWithFeedback({
        button,
        refreshBus: this.plugin.refreshBus,
        refreshDomains: ['models'],
        action: async () => {
          statusContainer.setText('');
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { fetchProviderModels } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await fetchProviderModels(target.key, config)
                : await fetchProviderModels('customOpenAI', target.config);
            if (result.valid) {
              availableModels = this.mergeModels(config.models, result.models);
              this.validationCache[cacheKey] = result;
              await this.recordProviderValidation(cacheKey, config, {
                modelsFetched: true,
                serverReachable: true,
                lastError: undefined,
              });
              const detail = t('settingsAuto258', { v0: String(result.models.length) });
              statusContainer.setText(detail);
              renderModelList();
              return { status: 'success', detail };
            }
            const detail = t('settingsAuto259', { v0: String(result.error) });
            statusContainer.setText(detail);
            this.validationCache[cacheKey] = {
              valid: false,
              models: this.validationCache[cacheKey]?.models ?? [],
              error: result.error,
            };
            await this.recordProviderValidation(cacheKey, config, {
              modelsFetched: false,
              lastError: String(result.error),
            });
            return { status: 'error', detail: String(result.error), notice: detail };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const detail = `${t('error')}: ${msg}`;
            statusContainer.setText(detail);
            return { status: 'error', detail: msg, notice: detail };
          } finally {
            spinner.remove();
          }
        },
      });
    });
    createActionButton(t('testConnection'), 'plug-zap', async (button) => {
      await runActionWithFeedback({
        button,
        refreshBus: this.plugin.refreshBus,
        refreshDomains: ['models'],
        action: async () => {
          statusContainer.setText('');
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { validateProviderConnection } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await validateProviderConnection(target.key, config)
                : await validateProviderConnection('customOpenAI', target.config);
            if (result.valid) {
              availableModels = this.mergeModels(config.models, result.models);
              const detail = t('settingsAuto260', { v0: String(result.models.length) });
              statusContainer.setText(detail);
              this.validationCache[cacheKey] = result;
              await this.recordProviderValidation(cacheKey, config, {
                connectionTested: true,
                serverReachable: true,
                lastError: undefined,
              });
              renderModelList();
              return { status: 'success', detail };
            }
            const detail = t('settingsAuto097', { v0: String(result.error) });
            statusContainer.setText(detail);
            this.validationCache[cacheKey] = {
              valid: false,
              models: this.validationCache[cacheKey]?.models ?? [],
              error: result.error,
            };
            await this.recordProviderValidation(cacheKey, config, {
              connectionTested: false,
              lastError: String(result.error),
            });
            return { status: 'error', detail: String(result.error), notice: detail };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const detail = `${t('error')}: ${msg}`;
            statusContainer.setText(detail);
            return { status: 'error', detail: msg, notice: detail };
          } finally {
            spinner.remove();
          }
        },
      });
    });
    createActionButton(t('testGeneration'), 'sparkles', async (button) => {
      await runActionWithFeedback({
        button,
        action: async () => {
          statusContainer.setText('');
          const model = config.models[0];
          if (!model) {
            const detail = t('settingsAuto263');
            statusContainer.setText(detail);
            return { status: 'noop', detail };
          }
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { testProviderGeneration } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await testProviderGeneration(target.key, config, model)
                : await testProviderGeneration('customOpenAI', target.config, model);
            if (result.valid) {
              await this.recordProviderValidation(cacheKey, config, {
                generationTested: true,
                authenticated: true,
                serverReachable: true,
                lastError: undefined,
              });
              await this.recordModelCapability(cacheKey, config, model, 'chatStatus', 'success');
              const detail = t('settingsAuto264', { v0: String(model) });
              statusContainer.setText(detail);
              this.validationCache[cacheKey] = result;
              renderModelList();
              return { status: 'success', detail };
            }
            await this.recordProviderValidation(cacheKey, config, {
              generationTested: false,
              lastError: String(result.error),
            });
            await this.recordModelCapability(
              cacheKey,
              config,
              model,
              'chatStatus',
              'failed',
              String(result.error),
            );
            const detail = t('settingsAuto265', { v0: String(result.error) });
            statusContainer.setText(detail);
            this.validationCache[cacheKey] = {
              valid: false,
              models: this.validationCache[cacheKey]?.models ?? [],
              error: result.error,
            };
            return { status: 'error', detail: String(result.error), notice: detail };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const detail = `${t('error')}: ${msg}`;
            statusContainer.setText(detail);
            return { status: 'error', detail: msg, notice: detail };
          } finally {
            spinner.remove();
          }
        },
      });
    });
    renderModelList();
  }
  private getInitialProviderModels(cacheKey: string, config: ProviderConfig): string[] {
    const cached = this.validationCache[cacheKey];
    const models = new Set<string>(config.models);
    if (cached && cached.valid && cached.models.length > 0) {
      cached.models.forEach((m) => models.add(m));
    }
    return Array.from(models).sort((a, b) => a.localeCompare(b, 'en'));
  }
  private mergeModels(selectedModels: string[], fetchedModels: string[]): string[] {
    const models = new Set<string>(selectedModels);
    fetchedModels.forEach((model) => models.add(model));
    return Array.from(models).sort((a, b) => a.localeCompare(b, 'en'));
  }
  buildCustomOpenAIProvidersSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-provider-custom-dock',
    });
    const header = section.createDiv({ cls: 'superpower-inside-provider-custom-header' });
    const title = header.createDiv({ cls: 'superpower-inside-provider-custom-title' });
    title.createDiv({
      cls: 'superpower-inside-provider-custom-heading',
      text: t('providerCustomDockTitle'),
    });
    title.createDiv({
      cls: 'superpower-inside-provider-custom-desc',
      text: t('providerCustomDockDesc'),
    });
    const addButton = header.createEl('button', {
      cls: 'superpower-inside-provider-add-btn',
      attr: { type: 'button' },
    });
    setIcon(addButton, 'plus');
    addButton.createSpan({ text: t('settingsAuto268') });
    const customGrid = section.createDiv({
      cls: 'superpower-inside-provider-grid superpower-inside-provider-custom-grid',
    });
    for (const provider of this.plugin.settings.customOpenAIProviders) {
      const slot = customGrid.createDiv({ cls: 'superpower-inside-custom-provider-slot' });
      this.buildProviderSettings(slot, {
        kind: 'custom',
        key: `customOpenAI:${provider.id}`,
        label: provider.name.trim() || 'Custom OpenAI-Compatible',
        config: provider,
      });
      const removeButton = slot.createEl('button', {
        cls: 'superpower-inside-provider-remove-btn',
        attr: { type: 'button', 'aria-label': t('settingsAuto267') },
      });
      setIcon(removeButton, 'trash-2');
      removeButton.createSpan({ text: t('settingsAuto267') });
      removeButton.addEventListener('click', () => {
        this.plugin.settings.customOpenAIProviders =
          this.plugin.settings.customOpenAIProviders.filter((item) => item.id !== provider.id);
        this.debouncedSave();
        this.renderSettingsView();
      });
    }
    addButton.addEventListener('click', () => {
      const id = this.createCustomProviderId();
      this.plugin.settings.customOpenAIProviders.push({
        id,
        name: 'Custom OpenAI-Compatible',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        models: [],
        enabled: false,
        useRequestUrl: true,
      });
      this.debouncedSave();
      this.renderSettingsView();
    });
  }
  private createCustomProviderId(): string {
    const existing = new Set(
      this.plugin.settings.customOpenAIProviders.map((provider) => provider.id),
    );
    let index = this.plugin.settings.customOpenAIProviders.length + 1;
    let id = `custom-${index}`;
    while (existing.has(id)) {
      index += 1;
      id = `custom-${index}`;
    }
    return id;
  }
  private renderMCPStatus(containerEl: HTMLElement): void {
    containerEl.empty();
    const plugin = this.plugin as unknown as {
      mcpRegistry: import('./mcp/registry').MCPRegistry | null;
      mcpConnectionState?: MCPConnectionState;
      mcpLastErrors?: string[];
      reconnectMCP?(): Promise<string[]>;
    };
    const registry = plugin.mcpRegistry;
    const servers = this.plugin.settings.mcpServers;
    const totalCount = servers.length;
    const connectedCount = registry?.getConnectedCount() ?? 0;
    const state = plugin.mcpConnectionState ?? 'idle';
    const overallTone =
      state === 'error'
        ? 'danger'
        : state === 'connecting' || state === 'partial-error'
          ? 'warning'
          : totalCount > 0 && connectedCount === totalCount
            ? 'success'
            : 'neutral';
    const overallLabel =
      totalCount === 0
        ? t('mcpNoActiveServers')
        : state === 'connecting'
          ? t('mcpStatusConnecting')
          : state === 'error'
            ? t('mcpConnectionFailed')
            : state === 'partial-error'
              ? t('mcpPartialError')
              : connectedCount === totalCount
                ? t('mcpStatusConnected')
                : t('mcpStatusDisconnected');
    this.createSettingsStatusRow(containerEl, {
      label: t('mcpConnectionHealth'),
      value: `${connectedCount}/${totalCount}`,
      statusLabel: overallLabel,
      detail:
        totalCount === 0
          ? t('mcpStatusNoServersDetail')
          : t('mcpStatusSummaryDetail', { connected: connectedCount, total: totalCount }),
      tone: overallTone,
    });
    const reconnectSetting = new Setting(containerEl)
      .setName(t('mcpReconnect'))
      .setDesc(t('mcpReconnectDesc'));
    let refreshBtn: HTMLButtonElement | null = null;
    reconnectSetting.addButton((button) => {
      button.setButtonText(t('mcpReconnect')).setCta();
      refreshBtn = button.buttonEl;
    });
    if (!refreshBtn) return;
    this.mcpStatusRefresh = new RefreshAction({
      action: async (_signal) => {
        if (plugin.reconnectMCP) {
          const errors = await plugin.reconnectMCP();
          containerEl.empty();
          this.renderMCPStatus(containerEl);
          if (errors.length > 0) {
            const errorDetails = errors.map((err) => `• ${err}`).join('\n');
            new Notice(t('settingsAuto227', { v0: String(errorDetails) }), 10000);
            return {
              status: 'partial',
              detail: t('settingsAuto270', { v0: String(errors.length) }),
            };
          }
          this.plugin.refreshBus.emit('mcp', { status: 'success' });
          return { status: 'success' };
        }
        return { status: 'error', detail: t('settingsAuto271') };
      },
      loadingText: t('settingsAuto272'),
      spinnerClass: 'spinning',
      successNotice: t('settingsAuto273'),
      errorNotice: false,
    });
    this.mcpStatusRefresh.attach(refreshBtn);
    if (totalCount > 0) {
      const list = containerEl.createDiv({ cls: 'superpower-inside-settings-status-list' });
      for (const server of servers) {
        let status: MCPServerConnectionStatus = 'disconnected';
        if (registry) {
          status = registry.getConnectionStatus(server.name);
        }
        const labelText =
          status === 'connected'
            ? t('mcpStatusConnected')
            : status === 'connecting'
              ? t('mcpStatusConnecting')
              : status === 'error'
                ? t('mcpStatusError')
                : t('mcpStatusDisconnected');
        const error = registry?.getLastError(server.name);
        this.createSettingsStatusRow(list, {
          label: server.name,
          value: server.command,
          statusLabel: labelText,
          detail: error ?? t('mcpStatusServerDetail'),
          tone:
            status === 'connected'
              ? 'success'
              : status === 'error'
                ? 'danger'
                : status === 'connecting'
                  ? 'warning'
                  : 'neutral',
        });
      }
    }
  }
  private unregisterMcpStatusEvent(): void {
    if (!this.mcpStatusEventRef) return;
    this.app.workspace.offref(this.mcpStatusEventRef);
    this.mcpStatusEventRef = null;
  }
}
export interface ChatModelOption {
  value: string;
  label: string;
}

function buildProfileModelOptions(
  settings: SuperpowerInsideSettings,
  kind: ProviderModelKind,
  currentModel: string,
): ChatModelOption[] {
  const result: ChatModelOption[] = [];
  for (const profile of settings.providerProfiles) {
    if (!profile.enabled) continue;
    const profileLabel = profile.name.trim() || PROVIDER_STRATEGY_LABELS[profile.strategy];
    for (const model of profile.models) {
      if (model.kind !== kind) continue;
      result.push({
        value: buildProviderModelRef(profile.id, model.id),
        label: `${profileLabel} / ${model.id}`,
      });
    }
  }
  result.sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const current = currentModel.trim();
  if (current && !result.some((option) => option.value === current)) {
    result.push({ value: current, label: t('settingsAuto274', { v0: String(current) }) });
  }
  return result;
}

export function buildEmbeddingProfileModelOptions(
  settings: SuperpowerInsideSettings,
  options: {
    currentModel: string;
    includeEmpty?: boolean;
    emptyLabel?: string;
  },
): ChatModelOption[] {
  const result: ChatModelOption[] = [];
  if (options.includeEmpty) {
    result.push({ value: '', label: options.emptyLabel ?? t('settingsAuto008') });
  }
  return [...result, ...buildProfileModelOptions(settings, 'embedding', options.currentModel)];
}

export function buildChatModelOptions(
  settings: SuperpowerInsideSettings,
  options: {
    currentModel: string;
    includeEmpty?: boolean;
    emptyLabel?: string;
  },
): ChatModelOption[] {
  const result: ChatModelOption[] = [];
  if (options.includeEmpty) {
    result.push({ value: '', label: options.emptyLabel ?? t('settingsAuto008') });
  }
  if (settings.providerProfiles.length > 0) {
    return [...result, ...buildProfileModelOptions(settings, 'general', options.currentModel)];
  }
  const providers = [
    { key: 'openai', prefix: 'openai', label: PROVIDER_LABELS.openai, config: settings.openai },
    { key: 'claude', prefix: 'claude', label: PROVIDER_LABELS.claude, config: settings.claude },
    { key: 'ollama', prefix: 'ollama', label: PROVIDER_LABELS.ollama, config: settings.ollama },
    {
      key: 'ollamaCloud',
      prefix: 'ollamaCloud',
      label: PROVIDER_LABELS.ollamaCloud,
      config: settings.ollamaCloud,
    },
    {
      key: 'openRouter',
      prefix: 'openRouter',
      label: PROVIDER_LABELS.openRouter,
      config: settings.openRouter,
    },
  ] as const;
  for (const { prefix, label, config } of providers) {
    if (!config.enabled) continue;
    for (const model of config.models) {
      const value = `${prefix}:${model}`;
      result.push({ value, label: `${label} / ${model}` });
    }
  }
  for (const provider of settings.customOpenAIProviders) {
    if (!provider.enabled) continue;
    const providerLabel = provider.name.trim() || 'Custom OpenAI-Compatible';
    for (const model of provider.models) {
      const value = `customOpenAI:${provider.id}:${model}`;
      result.push({ value, label: `${providerLabel} / ${model}` });
    }
  }
  const current = options.currentModel.trim();
  if (current && !result.some((o) => o.value === current)) {
    result.push({ value: current, label: t('settingsAuto274', { v0: String(current) }) });
  }
  return result;
}
