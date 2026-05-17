import { describe, expect, it } from 'vitest';
import type { ChatConfig, RAGConfig } from '../settings';
import { getEffectiveExcludePaths } from './vault';

const baseRagConfig: RAGConfig = {
  excludePaths: ['Archive'],
  excludeExts: [],
  excludeChatFolder: true,
  chunkSize: 1000,
  overlap: 100,
  vectorStoreType: 'json',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
  minScore: 0.5,
  enableBM25: true,
  bm25Weight: 0.3,
};

const baseChatConfig: ChatConfig = {
  saveFolder: 'CustomChats',
  defaultModel: '',
  promptLibrary: [],
  mcpToolExecutionPolicy: 'mentioned-auto',
  autoSaveEnabled: true,
  autoSaveDebounceMs: 1000,
  enforceMcpTools: false,
};

describe('RAG 유효 제외 경로', () => {
  it('채팅 폴더 자동 제외는 저장된 채팅 폴더 값을 그대로 사용한다', () => {
    expect(getEffectiveExcludePaths(baseRagConfig, baseChatConfig)).toEqual([
      'Archive',
      'CustomChats',
    ]);
  });

  it('채팅 폴더 자동 제외가 꺼져 있으면 수동 제외 경로만 사용한다', () => {
    const ragConfig = { ...baseRagConfig, excludeChatFolder: false };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig)).toEqual(['Archive']);
  });

  it('채팅 폴더가 이미 수동 제외 경로에 있으면 중복 추가하지 않는다', () => {
    const ragConfig = { ...baseRagConfig, excludePaths: ['Archive', 'CustomChats'] };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig)).toEqual([
      'Archive',
      'CustomChats',
    ]);
  });
});
