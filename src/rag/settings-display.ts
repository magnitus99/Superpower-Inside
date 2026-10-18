import { t } from '../i18n';
import type { PerformanceGuardMode } from './performance-guard';
import type { ProviderStrategyKey } from '../settings';

export type RagPerformanceTuningMode = 'auto' | 'custom';
export type ProviderApiKeyVisibilityKey =
  | 'ternlight'
  | 'openai'
  | 'claude'
  | 'ollama'
  | 'ollamaCloud'
  | 'openRouter'
  | 'customOpenAI';

export interface EmbeddingModelPreset {
  id: string;
  name: string;
  dimensions: number;
  description: string;
}

export interface EmbeddingModelOption {
  id: string;
  label: string;
  description: string;
  source: 'preset' | 'provider' | 'current';
  chatStatus?: ModelCapabilityStatus;
  embeddingStatus?: ModelCapabilityStatus;
}

export type ModelCapabilityStatus = 'unknown' | 'success' | 'failed';

export interface ModelCapabilitySnapshot {
  chatStatus: ModelCapabilityStatus;
  embeddingStatus: ModelCapabilityStatus;
  lastCheckedAt?: number;
  lastError?: string;
}

export interface ProviderValidationSnapshot {
  providerFingerprint?: string;
  modelsFetched?: boolean;
  connectionTested?: boolean;
  generationTested?: boolean;
  authenticated?: boolean;
  serverReachable?: boolean;
  lastCheckedAt?: number;
  lastError?: string;
  modelCapabilities?: Record<string, ModelCapabilitySnapshot>;
}

export type ProviderReadinessTone = 'ready' | 'needs-key' | 'needs-models' | 'disabled';

export interface ProviderReadinessInput {
  enabled: boolean;
  modelCount: number;
  apiKeyRequired: boolean;
  hasApiKey: boolean;
  validation?: Pick<
    ProviderValidationSnapshot,
    'authenticated' | 'serverReachable' | 'modelsFetched' | 'connectionTested' | 'generationTested'
  >;
}

export interface ProviderReadinessState {
  tone: ProviderReadinessTone;
  validationAccepted: boolean;
}

export interface RagIndexingControlStateInput {
  hasIndexer: boolean;
  isIndexing: boolean;
  totalDocuments: number | null;
  updateRequiredCount: number | null;
  guardMode: PerformanceGuardMode | null;
  guardRemainingPauseMs: number | null;
}

export interface RagIndexingButtonState {
  disabled: boolean;
  reason: string | null;
}

export interface RagIndexingControlState {
  updatePending: RagIndexingButtonState;
  reindexAll: RagIndexingButtonState;
  cancel: RagIndexingButtonState;
  resume: RagIndexingButtonState;
  reset: RagIndexingButtonState;
}

export type RagPerformanceSettings =
  | {
      enabled: true;
      maxEmbeddingBatchSize: number;
      indexingYieldMs: number;
      slowEventLoopThresholdMs: number;
      slowBatchThresholdMs: number;
    }
  | {
      enabled: false;
    };

/** 내장 Ternlight는 전용 Web Worker에서 계산하므로 런타임 페이싱이 필요하지 않습니다. */
export function resolveRagPerformanceSettings(
  embeddingStrategy: ProviderStrategyKey,
  modelId?: string,
): RagPerformanceSettings {
  if (embeddingStrategy === 'ternlight' && modelId !== 'embeddinggemma-300m') {
    return { enabled: false };
  }
  return {
    enabled: true,
    maxEmbeddingBatchSize:
      modelId === 'embeddinggemma-300m' ? 4 : embeddingStrategy === 'ollama' ? 1 : 32,
    indexingYieldMs: 0,
    slowEventLoopThresholdMs: 24,
    slowBatchThresholdMs: 1500,
  };
}

export function normalizeRagPerformanceTuningMode(value: unknown): RagPerformanceTuningMode {
  return value === 'custom' ? 'custom' : 'auto';
}

export function getChatFolderExcludeDescription(saveFolder: string): string {
  const folder = saveFolder.trim() || t('unsetLabel');
  return t('chatFolderExcludeCurrentDesc', { folder });
}

export function shouldShowProviderApiKey(key: string): boolean {
  return key !== 'ollama' && key !== 'ternlight';
}

export function shouldRequireProviderApiKey(key: string): boolean {
  return shouldShowProviderApiKey(key) && key !== 'customOpenAI';
}

export function resolveProviderReadiness(input: ProviderReadinessInput): ProviderReadinessState {
  const validationAccepted = Boolean(
    input.validation?.authenticated ||
    input.validation?.serverReachable ||
    input.validation?.modelsFetched ||
    input.validation?.connectionTested ||
    input.validation?.generationTested,
  );
  if (!input.enabled) {
    return { tone: 'disabled', validationAccepted };
  }
  if (input.apiKeyRequired && !input.hasApiKey && !validationAccepted) {
    return { tone: 'needs-key', validationAccepted };
  }
  if (input.modelCount === 0) {
    return { tone: 'needs-models', validationAccepted };
  }
  return { tone: 'ready', validationAccepted };
}

export function getRagIndexingControlState(
  input: RagIndexingControlStateInput,
): RagIndexingControlState {
  const setupReason = input.hasIndexer ? null : t('ragIndexerNotInitializedBase');
  const runningReason = input.isIndexing ? t('ragAutoUpdateAlreadyRunning') : null;
  const pauseReason =
    input.guardMode !== 'paused'
      ? null
      : input.guardRemainingPauseMs === null
        ? t('ragPerformancePaused')
        : t('ragAutoUpdatePausedRetry', {
            seconds: Math.ceil(input.guardRemainingPauseMs / 1000),
          });
  const noUpdatesReason = input.updateRequiredCount === 0 ? t('ragNoUpdates') : null;
  const noDocumentsReason = input.totalDocuments === 0 ? t('ragNoDocuments') : null;

  return {
    updatePending: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noUpdatesReason),
    reindexAll: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noDocumentsReason),
    cancel: toButtonState(input.isIndexing ? null : t('ragNoRunningIndexing')),
    resume: toButtonState(input.guardMode === 'paused' ? null : t('ragNotPerformancePaused')),
    reset: toButtonState(runningReason),
  };
}

function toButtonState(reason: string | null): RagIndexingButtonState {
  return { disabled: reason !== null, reason };
}

export function buildEmbeddingModelOptions(
  presets: EmbeddingModelPreset[],
  providerModels: string[],
  currentModel: string,
  modelCapabilities: Record<string, Partial<ModelCapabilitySnapshot>> = {},
): EmbeddingModelOption[] {
  const options = new Map<string, EmbeddingModelOption>();

  for (const preset of presets) {
    options.set(preset.id, {
      id: preset.id,
      label: t('embeddingDimensionsLabel', { name: preset.name, dimensions: preset.dimensions }),
      description: preset.description,
      source: 'preset',
      chatStatus: normalizeCapabilityStatus(modelCapabilities[preset.id]?.chatStatus),
      embeddingStatus: normalizeCapabilityStatus(modelCapabilities[preset.id]?.embeddingStatus),
    });
  }

  for (const model of providerModels) {
    const id = model.trim();
    if (!id || options.has(id)) continue;
    options.set(id, {
      id,
      label: id,
      description: t('embeddingProviderModelDesc'),
      source: 'provider',
      chatStatus: normalizeCapabilityStatus(modelCapabilities[id]?.chatStatus),
      embeddingStatus: normalizeCapabilityStatus(modelCapabilities[id]?.embeddingStatus),
    });
  }

  const selected = currentModel.trim();
  if (selected && !options.has(selected)) {
    options.set(selected, {
      id: selected,
      label: t('embeddingCurrentLabel', { model: selected }),
      description: t('embeddingCurrentDesc'),
      source: 'current',
      chatStatus: normalizeCapabilityStatus(modelCapabilities[selected]?.chatStatus),
      embeddingStatus: normalizeCapabilityStatus(modelCapabilities[selected]?.embeddingStatus),
    });
  }

  return Array.from(options.values()).sort(compareEmbeddingModelOptions);
}

export function selectInitialEmbeddingModel(options: readonly EmbeddingModelOption[]): string {
  return options.find((option) => option.embeddingStatus === 'success')?.id ?? '';
}

function normalizeCapabilityStatus(status: unknown): ModelCapabilityStatus {
  return status === 'success' || status === 'failed' ? status : 'unknown';
}

function compareEmbeddingModelOptions(
  left: EmbeddingModelOption,
  right: EmbeddingModelOption,
): number {
  const leftRank = getEmbeddingCapabilityRank(left.embeddingStatus);
  const rightRank = getEmbeddingCapabilityRank(right.embeddingStatus);
  if (leftRank !== rightRank) return leftRank - rightRank;
  return 0;
}

function getEmbeddingCapabilityRank(status: ModelCapabilityStatus | undefined): number {
  if (status === 'success') return 0;
  if (status === 'failed') return 2;
  return 1;
}
