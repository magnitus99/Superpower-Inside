import { t } from '../i18n';

export type VectorStoreType = 'json' | 'indexeddb';
export type RagPerformanceTuningMode = 'auto' | 'custom';
export type ProviderApiKeyVisibilityKey =
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
}

export interface RagIndexingControlStateInput {
  hasIndexer: boolean;
  isIndexing: boolean;
  totalDocuments: number | null;
  updateRequiredCount: number | null;
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
}

export interface RagPerformanceConfig {
  embeddingProvider: string;
  performanceTuningMode?: RagPerformanceTuningMode;
  performanceGuardEnabled: boolean;
  maxEmbeddingBatchSize: number;
  indexingYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
}

export interface RagPerformanceSettings {
  enabled: boolean;
  maxEmbeddingBatchSize: number;
  indexingYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
}

export interface GraphRagStatusLabelInput {
  enabled: boolean;
  hasGraphIndex: boolean;
  isRunning: boolean;
  isStale: boolean;
  partialFailureCount: number;
  schemaError?: boolean;
}

export interface GraphRagControlStateInput {
  enabled: boolean;
  hasProvider: boolean;
  hasModel: boolean;
  isRunning: boolean;
  totalCandidateFiles: number;
  failedFileCount: number;
}

export interface GraphRagControlState {
  start: RagIndexingButtonState;
  cancel: RagIndexingButtonState;
  resume: RagIndexingButtonState;
}

export type GraphRagActionId =
  | 'start'
  | 'cancel'
  | 'resumeFailed'
  | 'syncStale'
  | 'buildCommunities'
  | 'openExplorer';

export interface GraphRagActionDefinition {
  id: GraphRagActionId;
  groupId: 'extract' | 'maintain' | 'inspect';
  groupLabel: string;
  label: string;
  description: string;
  iconName: string;
  state: RagIndexingButtonState;
  tone: 'primary' | 'normal' | 'danger';
}

export interface GraphRagActionGroup {
  id: GraphRagActionDefinition['groupId'];
  label: string;
  actions: GraphRagActionDefinition[];
}

export interface GraphRagActionGroupInput {
  controls: GraphRagControlState;
  syncStale: RagIndexingButtonState;
  buildCommunities: RagIndexingButtonState;
  openExplorer: RagIndexingButtonState;
  totalCandidateFiles: number;
  maxFilesPerRun: number;
  failedFileCount: number;
  staleFileCount: number;
}

export interface GraphRagIndexingCostInput {
  totalCandidateFiles: number;
  maxFilesPerRun: number;
  averageChunksPerFile: number;
  averageTokensPerChunk: number;
  providerKind: 'local' | 'remote';
}

export interface GraphRagIndexingCostEstimate {
  estimatedFiles: number;
  estimatedCalls: number;
  estimatedInputTokens: number;
  costLabel: string;
}

export function resolveRagPerformanceSettings(rag: RagPerformanceConfig): RagPerformanceSettings {
  if (normalizeRagPerformanceTuningMode(rag.performanceTuningMode) === 'custom') {
    return {
      enabled: rag.performanceGuardEnabled,
      maxEmbeddingBatchSize: clampInteger(rag.maxEmbeddingBatchSize, 1, 128),
      indexingYieldMs: clampInteger(rag.indexingYieldMs, 0, 1000),
      slowEventLoopThresholdMs: clampInteger(rag.slowEventLoopThresholdMs, 16, 5000),
      slowBatchThresholdMs: clampInteger(rag.slowBatchThresholdMs, 100, 60000),
    };
  }

  return {
    enabled: true,
    maxEmbeddingBatchSize: rag.embeddingProvider === 'ollama' ? 1 : 32,
    indexingYieldMs: rag.embeddingProvider === 'ollama' ? 50 : 25,
    slowEventLoopThresholdMs: 150,
    slowBatchThresholdMs: 3000,
  };
}

export function normalizeRagPerformanceTuningMode(value: unknown): RagPerformanceTuningMode {
  return value === 'custom' ? 'custom' : 'auto';
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function getVectorStoreLabel(type: VectorStoreType): string {
  return type === 'indexeddb' ? 'IndexedDB' : 'JSON File';
}

export function getVectorStoreDescription(): string {
  return [t('vectorStoreDescriptionJson'), t('vectorStoreDescriptionIndexedDb')].join(' ');
}

export function getVectorStoreTransferNotice(
  selectedType: VectorStoreType,
  jsonVectorCount: number,
  indexedDbVectorCount: number,
): string | null {
  if (selectedType === 'indexeddb' && indexedDbVectorCount === 0 && jsonVectorCount > 0) {
    return t('vectorStoreTransferToIndexedDb');
  }
  if (selectedType === 'json' && jsonVectorCount === 0 && indexedDbVectorCount > 0) {
    return t('vectorStoreTransferToJson');
  }
  return null;
}

export function getChatFolderExcludeDescription(saveFolder: string): string {
  const folder = saveFolder.trim() || t('unsetLabel');
  return t('chatFolderExcludeCurrentDesc', { folder });
}

export function shouldShowProviderApiKey(key: string): boolean {
  return key !== 'ollama';
}

export function shouldRequireProviderApiKey(key: string): boolean {
  return shouldShowProviderApiKey(key) && key !== 'customOpenAI';
}

export function getRagIndexingControlState(
  input: RagIndexingControlStateInput,
): RagIndexingControlState {
  const setupReason = input.hasIndexer ? null : t('ragIndexerNotInitializedBase');
  const runningReason = input.isIndexing ? t('ragAutoUpdateAlreadyRunning') : null;
  const pauseReason =
    input.guardRemainingPauseMs !== null && input.guardRemainingPauseMs > 0
      ? t('ragAutoUpdatePausedRetry', { seconds: Math.ceil(input.guardRemainingPauseMs / 1000) })
      : null;
  const noUpdatesReason = input.updateRequiredCount === 0 ? t('ragNoUpdates') : null;
  const noDocumentsReason = input.totalDocuments === 0 ? t('ragNoDocuments') : null;

  return {
    updatePending: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noUpdatesReason),
    reindexAll: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noDocumentsReason),
    cancel: toButtonState(input.isIndexing ? null : t('ragNoRunningIndexing')),
    resume: toButtonState(
      input.guardRemainingPauseMs !== null && input.guardRemainingPauseMs > 0
        ? null
        : t('ragNotPerformancePaused'),
    ),
  };
}

export function getGraphRagStatusLabel(input: GraphRagStatusLabelInput): string {
  if (!input.enabled) return t('graphRagStatusDisabledLabel');
  if (input.schemaError === true) return 'schema-error';
  if (input.isRunning) return 'building';
  if (!input.hasGraphIndex) return 'not-built';
  if (input.isStale) return 'stale';
  if (input.partialFailureCount > 0) return 'partial';
  return 'ready';
}

export interface GraphRagStatusPresentation {
  label: string;
  description: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export function getGraphRagStatusPresentation(state: string): GraphRagStatusPresentation {
  switch (state) {
    case 'disabled':
      return {
        label: t('graphRagStatusDisabledLabel'),
        description: t('graphRagStatusDisabledDesc'),
        tone: 'neutral',
      };
    case 'not-built':
      return {
        label: t('graphRagStatusNotBuiltLabel'),
        description: t('graphRagStatusNotBuiltDesc'),
        tone: 'neutral',
      };
    case 'building':
      return {
        label: t('graphRagStatusBuildingLabel'),
        description: t('graphRagStatusBuildingDesc'),
        tone: 'neutral',
      };
    case 'ready':
      return {
        label: t('graphRagStatusReadyLabel'),
        description: t('graphRagStatusReadyDesc'),
        tone: 'success',
      };
    case 'stale':
      return {
        label: t('graphRagStatusStaleLabel'),
        description: t('graphRagStatusStaleDesc'),
        tone: 'warning',
      };
    case 'partial':
      return {
        label: t('graphRagStatusPartialLabel'),
        description: t('graphRagStatusPartialDesc'),
        tone: 'warning',
      };
    case 'schema-error':
      return {
        label: t('graphRagStatusSchemaErrorLabel'),
        description: t('graphRagStatusSchemaErrorDesc'),
        tone: 'danger',
      };
    default:
      return { label: state, description: '', tone: 'neutral' };
  }
}

export function getGraphRagControlState(input: GraphRagControlStateInput): GraphRagControlState {
  const disabledReason = input.enabled ? null : t('graphRagDisabledReason');
  const providerReason = input.hasProvider ? null : t('graphRagProviderMissingReason');
  const modelReason = input.hasModel ? null : t('graphRagModelMissingReason');
  const runningReason = input.isRunning ? t('graphRagAlreadyRunningReason') : null;
  const noFilesReason = input.totalCandidateFiles > 0 ? null : t('graphRagNoFilesReason');

  return {
    start: toButtonState(
      disabledReason ?? providerReason ?? modelReason ?? runningReason ?? noFilesReason,
    ),
    cancel: toButtonState(input.isRunning ? null : t('graphRagNoRunningReason')),
    resume: toButtonState(
      disabledReason ??
        providerReason ??
        modelReason ??
        runningReason ??
        (input.failedFileCount > 0 ? null : t('graphRagNoFailedReason')),
    ),
  };
}

export function buildGraphRagActionGroups(input: GraphRagActionGroupInput): GraphRagActionGroup[] {
  const runLimit = Math.min(input.totalCandidateFiles, input.maxFilesPerRun);
  const startScope =
    runLimit > 0
      ? t('graphRagStartScopeLimited', { total: input.totalCandidateFiles, limit: runLimit })
      : t('graphRagStartScopeAll');

  const groups: GraphRagActionGroup[] = [
    {
      id: 'extract',
      label: t('graphRagActionExtract'),
      actions: [
        {
          id: 'start',
          groupId: 'extract',
          groupLabel: t('graphRagActionExtract'),
          label: t('graphRagStartAll'),
          description: t('graphRagStartDescription', { scope: startScope }),
          iconName: 'play',
          state: input.controls.start,
          tone: 'primary',
        },
        {
          id: 'cancel',
          groupId: 'extract',
          groupLabel: t('graphRagActionExtract'),
          label: t('graphRagCancel'),
          description: t('graphRagCancelDesc'),
          iconName: 'square',
          state: input.controls.cancel,
          tone: 'danger',
        },
        {
          id: 'resumeFailed',
          groupId: 'extract',
          groupLabel: t('graphRagActionExtract'),
          label:
            input.failedFileCount > 0
              ? t('graphRagResumeFailedWithCount', { count: input.failedFileCount })
              : t('graphRagResumeFailed'),
          description: t('graphRagResumeFailedDesc'),
          iconName: 'skip-forward',
          state: input.controls.resume,
          tone: 'normal',
        },
        {
          id: 'syncStale',
          groupId: 'extract',
          groupLabel: t('graphRagActionExtract'),
          label:
            input.staleFileCount > 0
              ? t('graphRagSyncStaleWithCount', { count: input.staleFileCount })
              : t('graphRagSyncStale'),
          description: t('graphRagSyncStaleDesc'),
          iconName: 'refresh-cw',
          state: input.syncStale,
          tone: 'normal',
        },
      ],
    },
    {
      id: 'maintain',
      label: t('graphRagMaintain'),
      actions: [
        {
          id: 'buildCommunities',
          groupId: 'maintain',
          groupLabel: t('graphRagMaintain'),
          label: t('graphRagBuildCommunities'),
          description: t('graphRagBuildCommunitiesDesc'),
          iconName: 'git-fork',
          state: input.buildCommunities,
          tone: 'normal',
        },
      ],
    },
    {
      id: 'inspect',
      label: t('graphRagInspect'),
      actions: [
        {
          id: 'openExplorer',
          groupId: 'inspect',
          groupLabel: t('graphRagInspect'),
          label: t('graphRagOpenExplorer'),
          description: t('graphRagOpenExplorerDesc'),
          iconName: 'search',
          state: input.openExplorer,
          tone: 'normal',
        },
      ],
    },
  ];

  return groups;
}

export function estimateGraphRagIndexingCost(
  input: GraphRagIndexingCostInput,
): GraphRagIndexingCostEstimate {
  const estimatedFiles = clampInteger(input.maxFilesPerRun, 1, 100000);
  const cappedFiles = Math.min(input.totalCandidateFiles, estimatedFiles);
  const chunksPerFile = clampInteger(input.averageChunksPerFile, 1, 100000);
  const tokensPerChunk = clampInteger(input.averageTokensPerChunk, 1, 100000);
  const estimatedCalls = cappedFiles * chunksPerFile;
  return {
    estimatedFiles: cappedFiles,
    estimatedCalls,
    estimatedInputTokens: estimatedCalls * tokensPerChunk,
    costLabel: input.providerKind === 'local' ? t('graphRagCostLocal') : t('graphRagCostRemote'),
  };
}

function toButtonState(reason: string | null): RagIndexingButtonState {
  return { disabled: reason !== null, reason };
}

export function buildEmbeddingModelOptions(
  presets: EmbeddingModelPreset[],
  providerModels: string[],
  currentModel: string,
): EmbeddingModelOption[] {
  const options = new Map<string, EmbeddingModelOption>();

  for (const preset of presets) {
    options.set(preset.id, {
      id: preset.id,
      label: t('embeddingDimensionsLabel', { name: preset.name, dimensions: preset.dimensions }),
      description: preset.description,
      source: 'preset',
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
    });
  }

  const selected = currentModel.trim();
  if (selected && !options.has(selected)) {
    options.set(selected, {
      id: selected,
      label: t('embeddingCurrentLabel', { model: selected }),
      description: t('embeddingCurrentDesc'),
      source: 'current',
    });
  }

  return Array.from(options.values());
}
