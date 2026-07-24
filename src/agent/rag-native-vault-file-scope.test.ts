import type { App, TFile, Vault } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { ChatConfig, RAGConfig } from '../settings';
import { RagNativeVaultFileScope } from './rag-native-vault-file-scope';

const chatConfig: ChatConfig = {
  saveFolder: 'CustomChats',
  defaultModel: '',
  promptLibrary: [],
  mcpToolExecutionPolicy: 'mentioned-auto',
  autoSaveEnabled: true,
  autoSaveDebounceMs: 1000,
  enforceMcpTools: false,
};

const baseRagConfig: RAGConfig = {
  excludePaths: ['Archive'],
  excludeExts: ['log'],
  excludeChatFolder: true,
  chunkSize: 1000,
  overlap: 100,
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
  minScore: 0.5,
  enableBM25: true,
  bm25Weight: 0.15,
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
  entityAutoMergeThreshold: 0.88,
  entityPendingMergeThreshold: 0.72,
  annEnabled: true,
  annClusterCount: 0,
  annProbeCount: 4,
};

describe('RAG 기반 네이티브 Vault 파일 범위', () => {
  it('전체 목록과 단일 파일 판정에 현재 RAG 설정을 동일하게 적용한다', async () => {
    const note = createFile('Notes/Overview.md');
    const source = createFile('src/main.ts');
    const excludedExtension = createFile('Logs/debug.log');
    const sensitive = createFile('secrets.json');
    const archived = createFile('Archive/old.txt');
    const savedChat = createFile('CustomChats/session.md');
    const app = createApp([note, source, excludedExtension, sensitive, archived, savedChat]);
    let ragConfig = baseRagConfig;
    const scope = new RagNativeVaultFileScope(
      app,
      () => ragConfig,
      () => chatConfig,
    );

    await expect(scope.listCandidateFiles()).resolves.toEqual([note, source]);
    await expect(scope.isCandidateFile(source)).resolves.toBe(true);
    await expect(scope.isCandidateFile(excludedExtension)).resolves.toBe(false);
    await expect(scope.isCandidateFile(sensitive)).resolves.toBe(false);
    expect(scope.isPathVisible('CustomChats')).toBe(false);
    expect(scope.isPathVisible('.obsidian/plugins/example/data.json')).toBe(false);

    ragConfig = { ...baseRagConfig, excludeExts: ['log', 'ts'] };

    await expect(scope.listCandidateFiles()).resolves.toEqual([note]);
    await expect(scope.isCandidateFile(source)).resolves.toBe(false);
  });
});

function createFile(path: string): TFile {
  const name = path.split('/').at(-1) ?? path;
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : '';
  return {
    path,
    name,
    basename: extension ? name.slice(0, -(extension.length + 1)) : name,
    extension,
    stat: { ctime: 1, mtime: 2, size: 16 },
  } as unknown as TFile;
}

function createApp(files: readonly TFile[]): App {
  const vault = {
    configDir: '.obsidian',
    getFiles: () => [...files],
    cachedRead: () => Promise.resolve('text'),
  } as unknown as Vault;
  return { vault } as unknown as App;
}
