import { t } from '../i18n';
import type { GraphRagIndexingPhase } from '../graph/indexing-progress';
import type { PerformanceGuardMode } from './performance-guard';

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
  | 'resetGraphRag'
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

export type GraphRagIndexingResultNoticeScope = Extract<
  GraphRagActionId,
  'start' | 'resumeFailed' | 'syncStale'
>;

export interface GraphRagIndexingResultNoticeInput {
  totalCandidateFiles: number;
  selectedFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  processedChunks: number;
  skippedChunks: number;
  failedChunks: number;
  cancelled: boolean;
  startedAt: number;
  finishedAt: number;
  runId: number;
}

export interface GraphRagActionGroupInput {
  controls: GraphRagControlState;
  syncStale: RagIndexingButtonState;
  buildCommunities: RagIndexingButtonState;
  resetGraphRag: RagIndexingButtonState;
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

export function getGraphRagIndexingResultNotice(
  result: GraphRagIndexingResultNoticeInput | null,
  scope: GraphRagIndexingResultNoticeScope = 'start',
): string {
  if (!result) {
    return t('settingsAuto072');
  }
  if (result.cancelled) {
    return t('settingsAuto073');
  }
  if (result.selectedFiles === 0) {
    switch (scope) {
      case 'syncStale':
        return t('graphRagStaleSyncNoopNotice');
      case 'resumeFailed':
        return t('graphRagFailedRetryNoopNotice');
      case 'start':
        return t('graphRagRunNoopNotice');
    }
  }
  return t('settingsAuto074', {
    v0: String(result.processedFiles),
    v1: String(result.skippedFiles),
    v2: String(result.failedFiles),
  });
}

export interface GraphRagLiveStatusInput {
  isRunning: boolean;
  phase: GraphRagIndexingPhase | null | undefined;
  currentFile: string | null;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedFiles: number;
  processedChunks: number;
  skippedChunks: number;
  failedChunks: number;
  storedEvidence: number;
  storedEntities: number;
  storedRelations: number;
  storedClaims: number;
  storedRejectedFacts: number;
  cachedChunks: number;
}

export interface GraphRagLiveStatusPresentation {
  active: boolean;
  title: string;
  phaseLabel: string;
  detail: string;
  chunkDetail: string | null;
  storageDetail: string | null;
}

export function resolveRagPerformanceSettings(rag: RagPerformanceConfig): RagPerformanceSettings {
  if (normalizeRagPerformanceTuningMode(rag.performanceTuningMode) === 'custom') {
    return {
      enabled: true,
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

export function resolveProviderReadiness(
  input: ProviderReadinessInput,
): ProviderReadinessState {
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
    resume: toButtonState(
      input.guardMode === 'paused'
        ? null
        : t('ragNotPerformancePaused'),
    ),
  };
}

export function getGraphRagStatusLabel(input: GraphRagStatusLabelInput): string {
  if (!input.enabled) return t('graphRagStatusDisabledLabel');
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
    default:
      return { label: state, description: '', tone: 'neutral' };
  }
}

export function getGraphRagLiveStatusPresentation(
  input: GraphRagLiveStatusInput,
): GraphRagLiveStatusPresentation {
  const phase = input.phase ?? 'idle';
  if (!input.isRunning) {
    return {
      active: false,
      title: t('graphRagLiveStatusIdleTitle'),
      phaseLabel: getGraphRagPhaseLabel(phase),
      detail: t('graphRagLiveStatusIdleDetail'),
      chunkDetail: null,
      storageDetail: null,
    };
  }

  const done = Math.max(0, input.processedFiles + input.skippedFiles + input.failedFiles);
  const selected = Math.max(0, input.selectedFiles);
  const pct = selected > 0 ? Math.round((done / selected) * 100) : 0;
  const fileInfo = getGraphRagCurrentFileLabel(input.currentFile);
  const processedChunks = Math.max(0, input.processedChunks);
  const failedChunks = Math.max(0, input.failedChunks);
  const storedEvidence = Math.max(0, input.storedEvidence);
  const storedEntities = Math.max(0, input.storedEntities);
  const storedRelations = Math.max(0, input.storedRelations);
  const storedClaims = Math.max(0, input.storedClaims);
  const storedRejectedFacts = Math.max(0, input.storedRejectedFacts);
  const storedTotal =
    storedEvidence + storedEntities + storedRelations + storedClaims + storedRejectedFacts;
  return {
    active: true,
    title: t('graphRagLiveStatusRunningTitle'),
    phaseLabel: getGraphRagPhaseLabel(phase),
    detail: t('settingsAuto067', {
      v0: String(done),
      v1: String(selected),
      v2: fileInfo,
      v3: String(pct),
    }),
    chunkDetail:
      processedChunks > 0 || failedChunks > 0
        ? failedChunks > 0
          ? t('graphRagLiveChunkDetailWithFailed', {
              processed: String(processedChunks),
              failed: String(failedChunks),
            })
          : t('graphRagLiveChunkDetail', { processed: String(processedChunks) })
        : null,
    storageDetail:
      storedTotal > 0
        ? t('graphRagLiveStorageDetail', {
            evidence: String(storedEvidence),
            entities: String(storedEntities),
            relations: String(storedRelations),
            claims: String(storedClaims),
            rejected: String(storedRejectedFacts),
          })
        : null,
  };
}

function getGraphRagPhaseLabel(phase: GraphRagIndexingPhase): string {
  switch (phase) {
    case 'selecting-files':
      return t('graphRagPhaseSelectingFiles');
    case 'checking-cache':
      return t('graphRagPhaseCheckingCache');
    case 'api-waiting':
      return t('graphRagPhaseApiWaiting');
    case 'api-response-received':
      return t('graphRagPhaseApiResponseReceived');
    case 'api-response-normalizing':
      return t('graphRagPhaseApiResponseNormalizing');
    case 'storing-results':
      return t('graphRagPhaseStoringResults');
    case 'file-completed':
      return t('graphRagPhaseFileCompleted');
    case 'building-communities':
      return t('graphRagPhaseBuildingCommunities');
    case 'completed':
      return t('graphRagPhaseCompleted');
    case 'cancelled':
      return t('graphRagPhaseCancelled');
    case 'idle':
      return t('graphRagPhaseIdle');
  }
}

function getGraphRagCurrentFileLabel(currentFile: string | null): string {
  if (!currentFile) return '';
  const fileName = currentFile.split('/').pop()?.trim();
  return fileName ? ` (${fileName})` : '';
}

export function getGraphRagControlState(input: GraphRagControlStateInput): GraphRagControlState {
  const disabledReason = input.enabled ? null : t('graphRagDisabledReason');
  const modelReason = input.hasModel ? null : t('graphRagModelMissingReason');
  const providerReason = input.hasProvider ? null : t('graphRagProviderMissingReason');
  const runningReason = input.isRunning ? t('graphRagAlreadyRunningReason') : null;
  const noFilesReason = input.totalCandidateFiles > 0 ? null : t('graphRagNoFilesReason');

  return {
    start: toButtonState(
      disabledReason ?? modelReason ?? providerReason ?? runningReason ?? noFilesReason,
    ),
    cancel: toButtonState(input.isRunning ? null : t('graphRagNoRunningReason')),
    resume: toButtonState(
      disabledReason ??
        modelReason ??
        providerReason ??
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
          {
            id: 'resetGraphRag',
            groupId: 'maintain',
            groupLabel: t('graphRagMaintain'),
            label: t('graphRagResetData'),
            description: t('graphRagResetDataDesc'),
            iconName: 'trash-2',
            state: input.resetGraphRag,
            tone: 'danger',
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
