import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  getRagFileTypeSummary,
  isExcludedPath,
} from './vault';

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
      '.obsidian',
      '.git',
      'node_modules',
      'attachments',
      'Archive',
      'CustomChats',
    ]);
  });

  it('채팅 폴더 자동 제외가 꺼져 있으면 수동 제외 경로만 사용한다', () => {
    const ragConfig = { ...baseRagConfig, excludeChatFolder: false };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig)).toEqual([
      '.obsidian',
      '.git',
      'node_modules',
      'attachments',
      'Archive',
    ]);
  });

  it('채팅 폴더가 이미 수동 제외 경로에 있으면 중복 추가하지 않는다', () => {
    const ragConfig = { ...baseRagConfig, excludePaths: ['Archive', 'CustomChats'] };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig)).toEqual([
      '.obsidian',
      '.git',
      'node_modules',
      'attachments',
      'Archive',
      'CustomChats',
    ]);
  });
});

describe('RAG 제외 패턴', () => {
  it('폴더명과 glob-like 패턴으로 하위 경로를 제외한다', () => {
    expect(isExcludedPath('.git/config', ['.git'])).toBe(true);
    expect(isExcludedPath('foo/.git/config', ['**/.git'])).toBe(true);
    expect(isExcludedPath('.git/config', ['.git/**'])).toBe(true);
    expect(isExcludedPath('Archive/note.md', ['Archive'])).toBe(true);
    expect(isExcludedPath('Projects/drafts/note.md', ['**/drafts'])).toBe(true);
  });
});

describe('RAG 후보 파일', () => {
  it('마크다운 외 텍스트 파일도 후보에 포함하고 제외 확장자와 경로를 적용한다', async () => {
    const vault = createVault([
      createFile('note.md'),
      createFile('src/main.ts'),
      createFile('Archive/old.txt'),
      createFile('image.png'),
    ]);
    const ragConfig = { ...baseRagConfig, excludeExts: ['png'] };

    const files = await getRagCandidateFiles(vault, ragConfig, baseChatConfig);

    expect(files.map((file) => file.path)).toEqual(['note.md', 'src/main.ts']);
  });

  it('파일 형식별 대상 수와 제외 추천을 계산한다', async () => {
    const vault = createVault(
      [createFile('note.md'), createFile('src/main.ts'), createFile('.env')],
      new Map([
        ['note.md', '# Note'],
        ['src/main.ts', 'const value = 1;'],
        ['.env', 'TOKEN=secret'],
      ]),
    );

    const summary = await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig);

    expect(summary.targetTypes).toEqual([
      { extension: 'md', label: '.md', count: 1 },
      { extension: 'ts', label: '.ts', count: 1 },
    ]);
    expect(summary.excludeRecommendations).toEqual([
      expect.objectContaining({ extension: '(none)', label: '확장자 없음', count: 1 }),
    ]);
  });
});

function createFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  const extension = name.startsWith('.') && name.indexOf('.', 1) === -1
    ? ''
    : name.includes('.') ? (name.split('.').pop() ?? '') : '';
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension,
    stat: {
      ctime: 1000,
      mtime: 1000,
      size: 10,
    },
  } as unknown as TFile;
}

function createVault(files: TFile[], contents = new Map<string, string>()): Vault {
  return {
    getFiles: () => files,
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? 'text'),
  } as unknown as Vault;
}
