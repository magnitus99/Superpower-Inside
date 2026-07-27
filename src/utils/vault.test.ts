import { describe, expect, it } from 'vitest';
import type { DataAdapter, TFile, Vault } from 'obsidian';
import { t } from '../i18n';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  getRagFileTypeSummary,
  isRagCandidateFile,
  countFilesByExtensions,
  isExcludedExt,
  isExcludedPath,
  writeJsonToVault,
} from './vault';

const baseRagConfig: RAGConfig = {
  excludePaths: ['Archive'],
  excludeExts: [],
  excludeChatFolder: true,
  chunkSize: 1000,
  overlap: 100,
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
  minScore: 0.5,
  annEnabled: true,
  annClusterCount: 0,
  annProbeCount: 4,
  structuralGraphEnabled: true,
  entityAutoMergeThreshold: 0.88,
  entityPendingMergeThreshold: 0.72,
  graphRagEnabled: false,
  graphRagModel: '',
  graphRagMaxFilesPerRun: 50,
  graphRagMaxConcurrentRequests: 1,
  graphRagQueryMode: 'auto',
  enableBM25: true,
  bm25Weight: 0.3,
  performanceTuningMode: 'auto',
  performanceGuardEnabled: true,
  maxEmbeddingBatchSize: 32,
  indexingYieldMs: 25,
  slowEventLoopThresholdMs: 150,
  slowBatchThresholdMs: 3000,
  graphRagAutoSyncEnabled: false,
  graphRagAutoSyncIntervalMin: 30,
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
    expect(getEffectiveExcludePaths(baseRagConfig, baseChatConfig, '.config/obsidian')).toEqual([
      '.superpower-inside',
      '.git',
      'node_modules',
      'attachments',
      '.venv',
      '__pycache__',
      '.codegraph',
      '.pytest_cache',
      '.mypy_cache',
      '.ruff_cache',
      '.playwright-mcp',
      '.playwright-cli',
      '.config/obsidian',
      'Archive',
      'CustomChats',
    ]);
  });

  it('채팅 폴더 자동 제외가 꺼져 있으면 수동 제외 경로만 사용한다', () => {
    const ragConfig = { ...baseRagConfig, excludeChatFolder: false };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig, '.config/obsidian')).toEqual([
      '.superpower-inside',
      '.git',
      'node_modules',
      'attachments',
      '.venv',
      '__pycache__',
      '.codegraph',
      '.pytest_cache',
      '.mypy_cache',
      '.ruff_cache',
      '.playwright-mcp',
      '.playwright-cli',
      '.config/obsidian',
      'Archive',
    ]);
  });

  it('채팅 폴더가 이미 수동 제외 경로에 있으면 중복 추가하지 않는다', () => {
    const ragConfig = { ...baseRagConfig, excludePaths: ['Archive', 'CustomChats'] };

    expect(getEffectiveExcludePaths(ragConfig, baseChatConfig, '.config/obsidian')).toEqual([
      '.superpower-inside',
      '.git',
      'node_modules',
      'attachments',
      '.venv',
      '__pycache__',
      '.codegraph',
      '.pytest_cache',
      '.mypy_cache',
      '.ruff_cache',
      '.playwright-mcp',
      '.playwright-cli',
      '.config/obsidian',
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
      createFile('.superpower-inside/bm25-index.json'),
      createFile('Archive/old.txt'),
      createFile('image.png'),
    ]);
    const ragConfig = { ...baseRagConfig, excludeExts: ['png'] };

    const files = await getRagCandidateFiles(vault, ragConfig, baseChatConfig);

    expect(files.map((file) => file.path)).toEqual(['note.md', 'src/main.ts']);
  });

  it('가상환경과 개발 캐시 폴더는 사용자 설정 없이 기본 제외한다', async () => {
    const vault = createVault([
      createFile('note.md'),
      createFile('project/.venv/lib/python3.12/site-packages/pkg/module.py'),
      createFile('project/__pycache__/module.pyc'),
      createFile('project/.codegraph/index.sqlite'),
      createFile('project/.pytest_cache/v/cache/nodeids'),
      createFile('project/.mypy_cache/3.12/module.data.json'),
      createFile('project/.ruff_cache/content'),
      createFile('.playwright-mcp/session.json'),
      createFile('.playwright-cli/session.json'),
    ]);

    const files = await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig);

    expect(files.map((file) => file.path)).toEqual(['note.md']);
  });

  it('내용이 없는 텍스트 파일은 후보에서 제외한다', async () => {
    const vault = createVault(
      [createFile('note.md'), createFile('package.egg-info/dependency_links.txt', 0)],
      new Map([
        ['note.md', '# Note'],
        ['package.egg-info/dependency_links.txt', ''],
      ]),
    );

    const files = await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig);

    expect(files.map((file) => file.path)).toEqual(['note.md']);
  });

  it('단일 파일 판정도 전체 후보와 같은 경로·확장자·민감 파일 정책을 적용한다', async () => {
    const source = createFile('src/main.ts');
    const archived = createFile('Archive/old.txt');
    const excludedExtension = createFile('logs/debug.log');
    const sensitive = createFile('secrets.json');
    const vault = createVault([source, archived, excludedExtension, sensitive]);
    const ragConfig = { ...baseRagConfig, excludeExts: ['log'] };

    await expect(isRagCandidateFile(vault, source, ragConfig, baseChatConfig)).resolves.toBe(true);
    await expect(isRagCandidateFile(vault, archived, ragConfig, baseChatConfig)).resolves.toBe(
      false,
    );
    await expect(
      isRagCandidateFile(vault, excludedExtension, ragConfig, baseChatConfig),
    ).resolves.toBe(false);
    await expect(isRagCandidateFile(vault, sensitive, ragConfig, baseChatConfig)).resolves.toBe(
      false,
    );
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
    expect(summary.excludeRecommendations).toEqual([]);
  });

  it('비어 있는 파일은 확장자와 관계없이 제외 추천에 올리지 않는다', async () => {
    const vault = createVault(
      [createFile('empty.md', 0), createFile('empty.markdown', 0), createFile('empty.txt', 0)],
      new Map([
        ['empty.md', ''],
        ['empty.markdown', ''],
        ['empty.txt', ''],
      ]),
    );

    const summary = await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig);

    expect(summary.excludeRecommendations).toEqual([]);
  });

  it('알려진 바이너리 확장자는 자동 제외되므로 제외 추천에 올리지 않는다', async () => {
    const vault = createVault(
      [createFile('empty.md', 0), createFile('empty.markdown', 0), createFile('image.png')],
      new Map([
        ['empty.md', ''],
        ['empty.markdown', ''],
        ['image.png', '\u0000binary'],
      ]),
    );

    const summary = await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig);

    expect(summary.excludeRecommendations).toEqual([]);
  });

  it('읽을 수 없거나 너무 큰 미확인 확장자만 제외 추천에 올린다', async () => {
    const vault = createVault(
      [createFile('broken.weird'), createFile('large.opaque', 512 * 1024 + 1)],
      new Map([
        ['broken.weird', '\u0000binary'],
        ['large.opaque', 'text'],
      ]),
    );

    const summary = await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig);

    expect(summary.excludeRecommendations).toEqual([
      {
        extension: 'opaque',
        label: '.opaque',
        count: 1,
        reason: t('ragExcludeTooLargeReason'),
      },
      {
        extension: 'weird',
        label: '.weird',
        count: 1,
        reason: t('ragExcludeUnreadableReason'),
      },
    ]);
  });
});

describe('RAG 제외 확장자 판정', () => {
  it('확장자 키 정규화를 적용해 파일 경로 확장자를 판정한다', () => {
    expect(isExcludedExt('note.MD', ['MD'])).toBe(true);
    expect(isExcludedExt('notes/asset.PNG', [' .png ', 'jpg'])).toBe(true);
    expect(isExcludedExt('notes/.env', ['env'])).toBe(false);
    expect(isExcludedExt('notes/noext', ['md', 'txt'])).toBe(false);
  });

  it('카운트 집계는 정규화된 키 기준으로 0 카운트까지 보존한다', () => {
    const vault = createVault([
      createFile('note.md'),
      createFile('notes/main.ts'),
      createFile('notes/image.PNG'),
      createFile('notes/.env'),
      createFile('notes/archive.zip'),
    ]);

    expect(countFilesByExtensions(vault, ['MD', ' .png ', 'ts', 'env'])).toEqual({
      md: 1,
      png: 1,
      ts: 1,
      env: 0,
    });
  });
});

describe('Vault JSON 쓰기', () => {
  it('기존 JSON 파일을 삭제 후 재작성하지 않고 temp 파일 rename으로 교체한다', async () => {
    const adapter = new RecordingAdapter();
    adapter.setRaw('.superpower-inside/bm25-index.json', '{"old":true}');

    await writeJsonToVault(adapter.asDataAdapter(), '.superpower-inside/bm25-index.json', {
      ok: true,
    });

    expect(adapter.writePaths).toHaveLength(1);
    expect(adapter.writePaths[0]).toMatch(/^\.superpower-inside\/bm25-index\.json\.tmp\.\d+$/);
    expect(adapter.renamePairs).toEqual([
      [adapter.writePaths[0], '.superpower-inside/bm25-index.json'],
    ]);
    expect(adapter.removePaths).toEqual([]);
    expect(adapter.readRaw('.superpower-inside/bm25-index.json')).toBe('{"ok":true}');
  });
});

function createFile(path: string, size = 10): TFile {
  const name = path.split('/').pop() ?? path;
  const extension =
    name.startsWith('.') && name.indexOf('.', 1) === -1
      ? ''
      : name.includes('.')
        ? (name.split('.').pop() ?? '')
        : '';
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension,
    stat: {
      ctime: 1000,
      mtime: 1000,
      size,
    },
  } as unknown as TFile;
}

function createVault(files: TFile[], contents = new Map<string, string>()): Vault {
  return {
    configDir: '.config/obsidian',
    getFiles: () => files,
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? 'text'),
  } as unknown as Vault;
}

class RecordingAdapter {
  private files = new Map<string, string>();
  writePaths: string[] = [];
  renamePairs: Array<[string, string]> = [];
  removePaths: string[] = [];

  setRaw(path: string, value: string): void {
    this.files.set(path, value);
  }

  readRaw(path: string): string | undefined {
    return this.files.get(path);
  }

  asDataAdapter(): DataAdapter {
    return {
      exists: (path: string) => Promise.resolve(this.files.has(path)),
      read: (path: string) => Promise.resolve(this.files.get(path) ?? ''),
      write: (path: string, data: string) => {
        this.writePaths.push(path);
        this.files.set(path, data);
        return Promise.resolve();
      },
      rename: (path: string, newPath: string) => {
        this.renamePairs.push([path, newPath]);
        const data = this.files.get(path);
        if (data !== undefined) {
          this.files.set(newPath, data);
          this.files.delete(path);
        }
        return Promise.resolve();
      },
      remove: (path: string) => {
        this.removePaths.push(path);
        this.files.delete(path);
        return Promise.resolve();
      },
      mkdir: () => Promise.resolve(),
    } as unknown as DataAdapter;
  }
}
