export type VectorStoreType = 'json' | 'indexeddb';
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

export function getVectorStoreLabel(type: VectorStoreType): string {
  return type === 'indexeddb' ? 'IndexedDB' : 'JSON File';
}

export function getVectorStoreDescription(): string {
  return [
    'JSON File은 볼트 내부의 .superpower-inside/vectors.json에 저장되어 Obsidian Sync, Git, 파일 백업에 포함하기 쉽지만, 벡터가 커질수록 파일 읽기/쓰기와 동기화 충돌 부담이 커집니다.',
    'IndexedDB는 Obsidian/Electron의 로컬 브라우저 DB에 저장되어 대용량 구조화 데이터와 인덱스 조회에 더 적합하고 볼트 파일을 변경하지 않지만, 장치별 로컬 데이터라 볼트 동기화나 Git 백업에 자동 포함되지 않습니다.',
  ].join(' ');
}

export function getIndexedDbReindexNotice(type: VectorStoreType): string | null {
  if (type !== 'indexeddb') return null;
  return 'IndexedDB는 기존 JSON 벡터를 자동 복사하지 않습니다. 선택 후 전체 재인덱싱을 실행해야 이 저장소에 벡터가 채워집니다.';
}

export function getChatFolderExcludeDescription(saveFolder: string): string {
  const folder = saveFolder.trim() || '미설정';
  return `채팅 저장 폴더를 RAG 인덱싱 대상에서 자동으로 제외합니다. 현재 제외 대상: ${folder}`;
}

export function shouldShowProviderApiKey(key: ProviderApiKeyVisibilityKey): boolean {
  return key !== 'ollama';
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
