import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import {
  buildEmbeddingModelOptions,
  getChatFolderExcludeDescription,
  getVectorStoreTransferNotice,
  getVectorStoreDescription,
  getVectorStoreLabel,
  shouldShowProviderApiKey,
} from './rag/settings-display';
import { DEFAULT_SETTINGS, normalizeChatSaveFolder } from './settings';

describe('RAG 설정 표시 헬퍼', () => {
  it('선택된 벡터 저장소 라벨을 반환한다', () => {
    expect(getVectorStoreLabel('json')).toBe('JSON File');
    expect(getVectorStoreLabel('indexeddb')).toBe('IndexedDB');
  });

  it('JSON File과 IndexedDB의 장단점 설명을 포함한다', () => {
    const description = getVectorStoreDescription();

    expect(description).toContain('Obsidian Sync');
    expect(description).toContain('Git');
    expect(description).toContain('동기화 충돌');
    expect(description).toContain('로컬 브라우저 DB');
    expect(description).toContain('자동 포함되지 않습니다');
  });

  it('선택한 벡터 저장소가 비어 있고 반대 저장소에 벡터가 있을 때만 전환 안내를 반환한다', () => {
    expect(getVectorStoreTransferNotice('indexeddb', 10, 0)).toContain('전체 재인덱싱');
    expect(getVectorStoreTransferNotice('indexeddb', 10, 5)).toBeNull();
    expect(getVectorStoreTransferNotice('json', 0, 10)).toContain('전체 재인덱싱');
    expect(getVectorStoreTransferNotice('json', 0, 0)).toBeNull();
    expect(getVectorStoreTransferNotice('indexeddb', 10, 10)).toBeNull();
  });

  it('채팅 저장 폴더 제외 설명에 현재 폴더를 표시한다', () => {
    expect(getChatFolderExcludeDescription('CustomChats')).toContain('현재 제외 대상: CustomChats');
    expect(getChatFolderExcludeDescription('')).toContain('현재 제외 대상: 미설정');
  });

  it('Ollama Local만 API Key 입력을 숨긴다', () => {
    expect(shouldShowProviderApiKey('ollama')).toBe(false);
    expect(shouldShowProviderApiKey('ollamaCloud')).toBe(true);
    expect(shouldShowProviderApiKey('openai')).toBe(true);
    expect(shouldShowProviderApiKey('customOpenAI')).toBe(true);
  });

  it('RAG 임베딩 모델 옵션은 preset, provider 모델, 현재 선택 모델을 보존해 병합한다', () => {
    const options = buildEmbeddingModelOptions(
      [
        {
          id: 'text-embedding-3-small',
          name: 'OpenAI Small',
          dimensions: 1536,
          description: 'preset',
        },
      ],
      ['text-embedding-3-small', 'custom-embedding'],
      'legacy-selected',
    );

    expect(options.map((option) => option.id)).toEqual([
      'text-embedding-3-small',
      'custom-embedding',
      'legacy-selected',
    ]);
    expect(options.find((option) => option.id === 'text-embedding-3-small')?.source).toBe(
      'preset',
    );
    expect(options.find((option) => option.id === 'custom-embedding')?.source).toBe('provider');
    expect(options.find((option) => option.id === 'legacy-selected')?.label).toContain(
      '현재 선택됨',
    );
  });

  it('채팅 저장 폴더 값은 레거시 이름이어도 저장된 값을 그대로 보존한다', () => {
    expect(normalizeChatSaveFolder('SuperObsidianByAI')).toBe('SuperObsidianByAI');
    expect(normalizeChatSaveFolder('SuperObsidianByAIChats')).toBe('SuperObsidianByAIChats');
    expect(normalizeChatSaveFolder('SuperpowerInside')).toBe('SuperpowerInside');
    expect(normalizeChatSaveFolder('CustomChats')).toBe('CustomChats');
    expect(normalizeChatSaveFolder(undefined)).toBeNull();
  });

  it('기본 RAG 제외 경로에는 채팅 저장 폴더명을 하드코딩하지 않는다', () => {
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInsideChats');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInside');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAI');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAIChats');
  });

  it('설정 자동 저장 기본 debounce는 1초다', () => {
    expect(DEFAULT_SETTINGS.autoSaveDebounceMs).toBe(1000);
  });
});
