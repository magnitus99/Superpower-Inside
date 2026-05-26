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

export function resolveRagPerformanceSettings(
  rag: RagPerformanceConfig,
): RagPerformanceSettings {
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

export function normalizeRagPerformanceTuningMode(
  value: unknown,
): RagPerformanceTuningMode {
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
  return [
    'JSON File은 볼트 내부의 .superpower-inside/vectors.json에 저장되어 Obsidian Sync, Git, 파일 백업에 포함하기 쉽지만, 벡터가 커질수록 파일 읽기/쓰기와 동기화 충돌 부담이 커집니다.',
    'IndexedDB는 Obsidian/Electron의 로컬 브라우저 DB에 저장되어 대용량 구조화 데이터와 인덱스 조회에 더 적합하고 볼트 파일을 변경하지 않지만, 장치별 로컬 데이터라 볼트 동기화나 Git 백업에 자동 포함되지 않습니다.',
  ].join(' ');
}

export function getVectorStoreTransferNotice(
  selectedType: VectorStoreType,
  jsonVectorCount: number,
  indexedDbVectorCount: number,
): string | null {
  if (selectedType === 'indexeddb' && indexedDbVectorCount === 0 && jsonVectorCount > 0) {
    return 'IndexedDB는 기존 JSON 벡터를 자동 복사하지 않습니다. 전체 재인덱싱을 실행하거나 JSON File 저장소로 되돌리세요.';
  }
  if (selectedType === 'json' && jsonVectorCount === 0 && indexedDbVectorCount > 0) {
    return 'JSON File은 기존 IndexedDB 벡터를 자동 복사하지 않습니다. 전체 재인덱싱을 실행하거나 IndexedDB 저장소로 되돌리세요.';
  }
  return null;
}

export function getChatFolderExcludeDescription(saveFolder: string): string {
  const folder = saveFolder.trim() || '미설정';
  return `채팅 저장 폴더를 RAG 인덱싱 대상에서 자동으로 제외합니다. 현재 제외 대상: ${folder}`;
}

export function shouldShowProviderApiKey(key: string): boolean {
  return key !== 'ollama' && key !== 'other';
}

export function getRagIndexingControlState(
  input: RagIndexingControlStateInput,
): RagIndexingControlState {
  const setupReason = input.hasIndexer ? null : 'RAG 인덱서가 초기화되지 않았습니다.';
  const runningReason = input.isIndexing ? '인덱싱이 이미 실행 중입니다.' : null;
  const pauseReason =
    input.guardRemainingPauseMs !== null && input.guardRemainingPauseMs > 0
      ? `성능 보호 대기 중입니다. 약 ${Math.ceil(input.guardRemainingPauseMs / 1000)}초 후 다시 시도할 수 있습니다.`
      : null;
  const noUpdatesReason =
    input.updateRequiredCount === 0 ? '업데이트가 필요한 문서가 없습니다.' : null;
  const noDocumentsReason = input.totalDocuments === 0 ? 'RAG 대상 문서가 없습니다.' : null;

  return {
    updatePending: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noUpdatesReason),
    reindexAll: toButtonState(setupReason ?? runningReason ?? pauseReason ?? noDocumentsReason),
    cancel: toButtonState(input.isIndexing ? null : '실행 중인 인덱싱이 없습니다.'),
    resume: toButtonState(
      input.guardRemainingPauseMs !== null && input.guardRemainingPauseMs > 0
        ? null
        : '성능 보호 대기 상태가 아닙니다.',
    ),
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
      label: `${preset.name} (${preset.dimensions}차원)`,
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
      description: 'Providers 탭의 모델 목록에서 가져온 임베딩 모델입니다.',
      source: 'provider',
    });
  }

  const selected = currentModel.trim();
  if (selected && !options.has(selected)) {
    options.set(selected, {
      id: selected,
      label: `${selected} (현재 선택됨)`,
      description:
        '현재 선택된 모델입니다. Providers 탭의 모델 목록이나 기본 프리셋에는 없지만 설정 손실을 막기 위해 유지합니다.',
      source: 'current',
    });
  }

  return Array.from(options.values());
}
