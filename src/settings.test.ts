import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingModelOptions,
  getChatFolderExcludeDescription,
  getIndexedDbReindexNotice,
  getVectorStoreDescription,
  getVectorStoreLabel,
  shouldShowProviderApiKey,
} from './rag/settings-display';

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

  it('IndexedDB 선택 시 재인덱싱 안내를 반환한다', () => {
    expect(getIndexedDbReindexNotice('json')).toBeNull();
    expect(getIndexedDbReindexNotice('indexeddb')).toContain('전체 재인덱싱');
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
});
