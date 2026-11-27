import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFolder, type DataAdapter, type TFile, type Vault } from 'obsidian';
import { t } from '../i18n';
import * as rustCore from '../rag/rust-core';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  disposeRagFileEligibilityCache,
  getRagIndexingManifest,
  getRagFileInventory,
  getSettledRagIndexingInventory,
  recordRagIndexingVerdict,
  beginRagPreparedSourceProbe,
  getRagPreparedSourceRevision,
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  getRagFileTypeSummary,
  getFrontmatterExcludedFiles,
  isRagCandidateFile,
  isRagFileExcluded,
  countFilesByExtensions,
  isExcludedExt,
  isExcludedPath,
  getExcludePathMetadata,
  writeJsonToVault,
} from './vault';

vi.mock('obsidian', () => {
  // 테스트에서는 설치된 YAML 파서와 폴더 클래스를 호스트 API 대신 사용합니다.
  const yaml = createRequire(import.meta.url)('js-yaml') as { load: (source: string) => unknown };
  class MockTFolder {}
  return {
    TFolder: MockTFolder,
    getFrontMatterInfo: (content: string) => {
      const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
      return { exists: match !== null, frontmatter: match?.[1] ?? '' };
    },
    parseYaml: yaml.load,
  };
});

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
  enableBM25: true,
  bm25Weight: 0.3,
  performanceTuningMode: 'auto',
  performanceGuardEnabled: true,
  maxEmbeddingBatchSize: 32,
  indexingYieldMs: 25,
  slowEventLoopThresholdMs: 150,
  slowBatchThresholdMs: 3000,
};

const baseChatConfig: ChatConfig = {
  saveFolder: 'CustomChats',
  defaultModel: '',
  promptLibrary: [],
  mcpToolExecutionPolicy: 'mentioned-auto',
  autoSaveEnabled: true,
  autoSaveDebounceMs: 1000,
  mcpMentionOnly: false,
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
  it('큰 무확장자·미확인 확장자와 혼합 binary 확장자의 실제 텍스트도 바이트로 판정한다', async () => {
    const paths = [
      'README-CUSTOM',
      'large.opaque',
      'mesh.obj',
      'mesh.stl',
      'mesh.dxf',
      'scene.gltf',
      'records.dat',
    ];
    const body = 'synthetic text 42\n'.repeat(40_000);
    const files = paths.map((path) => createFile(path, new TextEncoder().encode(body).length));
    const vault = createVault(files, new Map(paths.map((path) => [path, body])));
    const cachedRead = vi.spyOn(vault, 'cachedRead');
    expect(await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).toEqual(files);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('UTF-16 NUL을 이진으로 오인하지 않고 txt·plist의 바이너리 위장은 차단한다', async () => {
    const files = [createFile('unicode.opaque'), createFile('fake.txt'), createFile('fake.plist')];
    const vault = createVault(files);
    vi.spyOn(vault, 'readBinary').mockImplementation((file) =>
      Promise.resolve(
        file.path === 'unicode.opaque'
          ? new Uint8Array([0xff, 0xfe, 72, 0, 105, 0]).buffer
          : new TextEncoder().encode(
              file.extension === 'plist' ? 'bplist00\u0000fake' : 'PK\u0003\u0004fake',
            ).buffer,
      ),
    );
    expect(await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).toEqual([files[0]]);
  });

  it('민감·경로·확장자 제외는 읽기 전에 적용하며 전체 byte read 큐는 한 번에 하나만 실행한다', async () => {
    const files = [
      '.env',
      'credentials.json',
      'Archive/skip.txt',
      'skip.log',
      'first.dat',
      'second.png',
      'third.txt',
    ].map((path) => createFile(path));
    const vault = createVault(files);
    let active = 0;
    let maximum = 0;
    const paths: string[] = [];
    vi.spyOn(vault, 'readBinary').mockImplementation(async (file) => {
      paths.push(file.path);
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return new TextEncoder().encode('plain content').buffer;
    });
    expect(
      (
        await getRagCandidateFiles(
          vault,
          { ...baseRagConfig, excludeExts: ['log'] },
          baseChatConfig,
        )
      ).map((file) => file.path),
    ).toEqual(['first.dat', 'second.png', 'third.txt']);
    expect(paths).toEqual(['first.dat', 'second.png', 'third.txt']);
    expect(maximum).toBe(1);
  });

  it('YAML 제외 목록은 경로 제외 문서도 표시하며 본문을 변경하지 않는다', async () => {
    const files = [
      createFile('hidden.md'),
      createFile('Archive/hidden.md'),
      createFile('visible.md'),
    ];
    const contents = new Map(
      files.map((file) => [file.path, '---\nsuperpower-inside-exclude: true\n---\nsecret']),
    );
    contents.set('visible.md', '---\nsuperpower-inside-exclude: false\n---\npublic');
    const vault = createVault(files, contents);
    expect((await getFrontmatterExcludedFiles(vault)).map((file) => file.path)).toEqual([
      'hidden.md',
      'Archive/hidden.md',
    ]);
    expect(contents.get('hidden.md')).toContain('superpower-inside-exclude: true');
  });
  it('최상위 속성은 false 외에 모두 제외하고 변경·해제는 캐시 갱신 없이 반영한다', async () => {
    const hidden = createFile('hidden.md');
    const contents = new Map([
      ['hidden.md', '---\n"superpower-inside-exclude": true # 비공개\n---\nsecret'],
      ['visible.md', '---\nsuperpower-inside-exclude: false\n---\npublic'],
      ['quoted.md', '---\nsuperpower-inside-exclude: "true"\n---\npublic'],
      ['body.md', '# 본문\nsuperpower-inside-exclude: true'],
    ]);
    const vault = createVault(
      [hidden, ...['visible.md', 'quoted.md', 'body.md'].map((path) => createFile(path))],
      contents,
    );
    expect(
      (await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).map((file) => file.path),
    ).toEqual(['visible.md', 'body.md']);
    await expect(isRagCandidateFile(vault, hidden, baseRagConfig, baseChatConfig)).resolves.toBe(
      false,
    );
    contents.set(hidden.path, '---\nsuperpower-inside-exclude: false\n---\npublic');
    await expect(isRagCandidateFile(vault, hidden, baseRagConfig, baseChatConfig)).resolves.toBe(
      true,
    );
  });
  it.each(['true', '"true"', '0', '1', '트루', '""', 'null', '', '[]', '{}'])(
    'YAML 값 %s는 설정 목록·전체 후보·개별 파일 정책에서 함께 제외한다',
    async (value) => {
      const hidden = createFile('hidden.md');
      const visible = createFile('visible.md');
      const contents = new Map([
        [hidden.path, `---\nsuperpower-inside-exclude: ${value}\n---\nsecret`],
        [visible.path, '---\nnested:\n  superpower-inside-exclude: true\n---\npublic'],
      ]);
      const vault = createVault([hidden, visible], contents);
      expect(await getFrontmatterExcludedFiles(vault)).toEqual([hidden]);
      expect(await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).toEqual([visible]);
      expect(await isRagFileExcluded(vault, hidden, baseRagConfig, baseChatConfig)).toBe(true);
      contents.set(hidden.path, 'public');
      expect(await getFrontmatterExcludedFiles(vault)).toEqual([]);
      expect(await isRagCandidateFile(vault, hidden, baseRagConfig, baseChatConfig)).toBe(true);
    },
  );
  it.each(['false', '"false"'])(
    '값 %s는 설정 목록에서 빠지고 후보 목록과 개별 파일 정책에서 허용한다',
    async (value) => {
      const file = createFile('visible.md');
      const vault = createVault(
        [file],
        new Map([[file.path, `---\nsuperpower-inside-exclude: ${value}\n---\npublic`]]),
      );
      expect(await getFrontmatterExcludedFiles(vault)).toEqual([]);
      expect(await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).toEqual([file]);
      expect(await isRagFileExcluded(vault, file, baseRagConfig, baseChatConfig)).toBe(false);
    },
  );
  it('YAML을 읽을 수 없는 문서는 후보와 개별 인덱싱에서 함께 차단한다', async () => {
    const file = createFile('private.md');
    const vault = createVault([file]);
    vault.readBinary = () => Promise.reject(new Error('unreadable'));
    expect(await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).toEqual([]);
    expect(await isRagCandidateFile(vault, file, baseRagConfig, baseChatConfig)).toBe(false);
    expect(await isRagFileExcluded(vault, file, baseRagConfig, baseChatConfig)).toBe(true);
  });
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

  it.each(['planRagFileTypeSummaryRust', 'planRagFileContentProbeIndicesRust'] as const)(
    '%s 부재를 빈 집계나 검증된 평문으로 표시하지 않는다', async (planner) => {
      const spy = vi.spyOn(rustCore, planner).mockReturnValueOnce(null);
      try {
        await expect(getRagFileTypeSummary(createVault([createFile('note.md')]), baseRagConfig, baseChatConfig)).rejects.toThrow();
      } finally { spy.mockRestore(); }
    },
  );

  it('두 원장이 빈 원본과 정책 제외를 분리하고 XLSX·XLTX 원본 예산을 읽기 전에 적용한다', async () => {
    const limit = 128 * 1024 * 1024;
    const files = [createFile('empty.txt', 0), createFile('Archive/private.txt', 0), createFile('allowed.xlsx', limit),
      createFile('allowed.xltx', limit), createFile('large.xlsx', limit + 1), createFile('large.xltx', limit + 1)];
    const vault = createVault(files);
    const reads = vi.spyOn(vault, 'readBinary');
    for (const inventory of [getRagIndexingManifest(vault, baseRagConfig, baseChatConfig), await getRagFileInventory(vault, baseRagConfig, baseChatConfig)]) {
      expect(inventory.candidates).toEqual(files.slice(2, 4));
      expect(inventory.policyExcluded).toEqual([files[1]]);
      expect(inventory.emptyFiles).toEqual([files[0]]);
      expect(inventory.failures).toEqual(files.slice(4).map((file) => ({ file, reason: 'memory-budget' })));
    }
    expect(reads).not.toHaveBeenCalled();
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

  it('읽을 수 없거나 너무 큰 미확인 확장자만 제외 추천에 올리고 평문·지원 확장자는 제외 추천하지 않는다', async () => {
    const vault = createVault(
      [
        createFile('broken.weird'),
        createFile('large.opaque', 64 * 1024 * 1024 + 1),
        createFile('large.patch', 2 * 1024 * 1024),
        createFile('large.snapshot', 2 * 1024 * 1024),
        createFile('large.jsonl', 4 * 1024 * 1024),
        createFile('note.mdown', 120),
        createFile('deck.odp', 1024),
        createFile('sheet.ods', 1024),
        createFile('template.dotx', 1024),
        createFile('slide.potx', 1024),
        createFile('show.ppsx', 1024),
        createFile('table.xltx', 1024),
        createFile('data.parquet', 4096),
      ],
      new Map([
        ['broken.weird', '\u0000binary'],
        ['large.opaque', 'text'],
        ['large.patch', 'diff --git a/a b/a'],
        ['large.snapshot', 'exports[`test`] = `snap`;'],
        ['large.jsonl', '{"ok":true}'],
        ['note.mdown', '# Markdown variant'],
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
    // 지원 확장자는 크기와 무관하게 대상 형식으로 집계되고, 바이너리는 양쪽 어디에도 남지 않는다.
    const target = new Map(summary.targetTypes.map((item) => [item.extension, item.count]));
    expect(target.get('patch')).toBe(1);
    expect(target.get('snapshot')).toBe(1);
    expect(target.get('jsonl')).toBe(1);
    expect(target.get('mdown')).toBe(1);
    expect(target.has('parquet')).toBe(false);
    expect(summary.excludeRecommendations.some((item) => item.extension === 'parquet')).toBe(false);
  });

  it('제외 키가 없는 문서라도 YAML 구문을 해석할 수 없으면 후보에서 차단한다', async () => {
    const broken = createFile('broken-frontmatter.md');
    const valid = createFile('valid.md');
    const vault = createVault(
      [broken, valid],
      new Map([
        ['broken-frontmatter.md', '---\ntitle: [unclosed\n---\nprivate body'],
        ['valid.md', '---\ntitle: note\n---\npublic body'],
      ]),
    );

    expect(
      (await getRagCandidateFiles(vault, baseRagConfig, baseChatConfig)).map((file) => file.path),
    ).toEqual(['valid.md']);
    expect(await isRagFileExcluded(vault, broken, baseRagConfig, baseChatConfig)).toBe(true);
    expect(await isRagFileExcluded(vault, valid, baseRagConfig, baseChatConfig)).toBe(false);
  });
});

describe('RAG 후보 판정 캐시', () => {
  const vaults: Vault[] = [];
  beforeEach(() => {
    // 생성물 부재를 지연 fixture timeout으로 숨기지 않고 실제 decoder 전제에서 즉시 실패한다.
    expect(
      rustCore.decodeSourceBytesRust(new Uint8Array()),
      '새 generated Rust decoder가 필요하다',
    ).toMatchObject({ ok: true });
  });
  afterEach(() => {
    for (const vault of vaults.splice(0)) disposeRagFileEligibilityCache(vault);
    vi.restoreAllMocks();
  });
  function fixture(paths = ['note.md']) {
    const files = paths.map((path) => createFile(path));
    const contents = new Map(files.map((file) => [file.path, 'public body']));
    const fixture = createEventVault(files, contents);
    vaults.push(fixture.vault);
    return { ...fixture, files, contents, read: vi.spyOn(fixture.vault, 'readBinary') };
  }
  const candidates = (vault: Vault, config = baseRagConfig) =>
    getRagCandidateFiles(vault, config, baseChatConfig);

  it('명시 metadata-only manifest는 후보의 byte 판정을 꾸미지 않고 민감·경로 제외를 선행한다', () => {
    const { vault, files, read } = fixture(['public.md', 'image.png', '.env', 'Archive/private.txt']);
    const manifest = getRagIndexingManifest(vault, baseRagConfig, baseChatConfig);
    expect(read).not.toHaveBeenCalled();
    expect(manifest.verification).toBe('metadata-only');
    expect(manifest.candidates).toEqual(files.slice(0, 2));
    expect(manifest.unsupported).toEqual([]);
    expect(manifest.failures).toEqual([]);
    expect(manifest.policyExcluded).toEqual(files.slice(2));
    expect(getSettledRagIndexingInventory(manifest)).toBeNull();
  });

  it('현재 준비된 body·metadata hash만 원문 없이 읽고 같은 stat의 event에서도 폐기한다', () => {
    const { vault, files, read, emit } = fixture(['public.md']);
    const file = files[0];
    expect(getRagPreparedSourceRevision(vault, file)).toBeNull();
    beginRagPreparedSourceProbe(vault, file)({ text: 'prepared', contentHash: '11111111', sourceMetadataHash: 'aaaaaaaa' });
    expect(getRagPreparedSourceRevision(vault, file)).toEqual({ filePath: file.path, sourceMtime: file.stat.mtime, sourceSize: file.stat.size, contentHash: '11111111', sourceMetadataHash: 'aaaaaaaa' });
    const stale = beginRagPreparedSourceProbe(vault, file);
    emit('modify', file);
    expect(getRagPreparedSourceRevision(vault, file)).toBeNull();
    stale({ text: 'late', contentHash: '22222222', sourceMetadataHash: 'bbbbbbbb' });
    expect(getRagPreparedSourceRevision(vault, file)).toBeNull();
    beginRagPreparedSourceProbe(vault, file)({ text: 'prepared again', contentHash: '22222222', sourceMetadataHash: 'bbbbbbbb' });
    expect(getRagPreparedSourceRevision(vault, file)?.sourceMetadataHash).toBe('bbbbbbbb');
    file.stat.mtime++;
    expect(getRagPreparedSourceRevision(vault, file)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('다른 파일의 저장은 현재 원문 두 hash의 늦은 게시를 무효화하지 않는다', () => {
    const { vault, files, emit } = fixture(['public.md', 'Archive/chat.md']);
    const publish = beginRagPreparedSourceProbe(vault, files[0]);
    emit('modify', files[1]);
    publish({ text: 'synthetic current body', contentHash: '11111111', sourceMetadataHash: 'aaaaaaaa' });
    expect(getRagPreparedSourceRevision(vault, files[0])?.sourceMetadataHash).toBe('aaaaaaaa');
  });

  it('eligibility만 판정한 cache는 준비된 source hash 증명으로 승격하지 않는다', async () => {
    const { vault, files } = fixture(['public.md']);
    await candidates(vault);
    expect(getRagPreparedSourceRevision(vault, files[0])).toBeNull();
  });

  it('같은 owner의 준비 verdict만 일반 검증 cache에 재사용하고 modify 뒤 늦은 게시를 거절한다', async () => {
    const { vault, files, read, emit } = fixture(['public.md', 'binary.png']);
    beginRagPreparedSourceProbe(vault, files[0])({ text: 'prepared current body' });
    beginRagPreparedSourceProbe(vault, files[1])({ reason: 'binary' });
    const inventory = await getRagFileInventory(vault, baseRagConfig, baseChatConfig);
    expect(inventory.candidates).toEqual([files[0]]);
    expect(inventory.unsupported).toEqual([files[1]]);
    expect(read).not.toHaveBeenCalled();
    const stale = beginRagPreparedSourceProbe(vault, files[0]);
    emit('modify', files[0]);
    stale({ text: 'must not cache stale owner' });
    await candidates(vault);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each(['read-failed', 'ambiguous-encoding', 'frontmatter-unreadable'])(
    '준비 중 %s는 이전 positive verdict를 남겨 재시도를 가리지 않는다', async (reason) => {
      const { vault, files, read } = fixture(['public.md']);
      beginRagPreparedSourceProbe(vault, files[0])({ text: 'previous success' });
      beginRagPreparedSourceProbe(vault, files[0])({ reason });
      expect(await candidates(vault)).toEqual(files);
      expect(read).toHaveBeenCalledOnce();
    },
  );

  it('정상·실패 ledger가 모두 채워져야 settled inventory이고 새 변경은 완료 proof를 무효화한다', () => {
    const { vault, files, emit } = fixture(['good.txt', 'broken.txt']);
    const manifest = getRagIndexingManifest(vault, baseRagConfig, baseChatConfig);
    recordRagIndexingVerdict(manifest, files[0], { kind: 'candidate' });
    expect(getSettledRagIndexingInventory(manifest)).toBeNull();
    recordRagIndexingVerdict(manifest, files[1], { kind: 'failed', reason: 'ambiguous-encoding' });
    expect(getSettledRagIndexingInventory(manifest)).toMatchObject({ candidates: [files[0]], failures: [{ file: files[1], reason: 'ambiguous-encoding' }] });
    emit('modify', files[0]);
    expect(getSettledRagIndexingInventory(manifest)).toBeNull();
    recordRagIndexingVerdict(manifest, files[0], { kind: 'candidate' });
    expect(getSettledRagIndexingInventory(manifest)).toBeNull();
  });

  it('두 번째 동일 후보·집계는 추가 byte read 0이며 본문을 plan/cache wire에 남기지 않는다', async () => {
    const { vault, files, contents, read } = fixture(['note.md', 'other.dat']);
    const body = 'independent synthetic body sentinel';
    contents.set(files[0].path, `---\ntitle: example\n---\n${body}`);
    const planner = vi.spyOn(rustCore, 'planRagFileIndexabilityRust');
    expect(await candidates(vault)).toEqual(files);
    read.mockClear();
    expect(await candidates(vault)).toEqual(files);
    expect(
      (await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig)).totalTargetFiles,
    ).toBe(2);
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(planner.mock.calls)).not.toContain(body);
    expect(
      planner.mock.calls.flatMap((call) => call[3]).every((probe) => probe.sample === ''),
    ).toBe(true);
    // 현재 원문 검증은 후보 판정을 재사용하지 않고 반드시 fresh 바이트를 읽는다.
    contents.set(files[0].path, '---\nsuperpower-inside-exclude: true\n---\nprivate body');
    expect(await isRagFileExcluded(vault, files[0], baseRagConfig, baseChatConfig)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('동일 snapshot 동시 호출은 파일당 read 1이고 전체 큐도 1이다', async () => {
    const { vault, files, read } = fixture(['a.txt', 'b.txt']);
    let active = 0;
    let maximum = 0;
    read.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return new TextEncoder().encode('public body').buffer;
    });
    expect(await Promise.all([candidates(vault), candidates(vault)])).toEqual([files, files]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(maximum).toBe(1);
  });

  it('같은 mtime:size modify 직후 YAML 제외는 후보·집계에서 누출되지 않는다', async () => {
    const { vault, files, contents, emit, read } = fixture();
    expect(await candidates(vault)).toEqual(files);
    contents.set(files[0].path, '---\nsuperpower-inside-exclude: true\n---\nprivate body');
    emit('modify', files[0]);
    expect(await candidates(vault)).toEqual([]);
    expect(
      (await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig)).totalTargetFiles,
    ).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('일반 rag 속성은 제품 제외 키로 재해석하지 않는다', async () => {
    const { vault, files, contents, emit, read } = fixture();
    expect(await candidates(vault)).toEqual(files);
    contents.set(files[0].path, '---\nrag: false\n---\npublic body');
    emit('modify', files[0]);
    expect(await candidates(vault)).toEqual(files);
    expect(
      (await getRagFileTypeSummary(vault, baseRagConfig, baseChatConfig)).totalTargetFiles,
    ).toBe(1);
    expect(await isRagFileExcluded(vault, files[0], baseRagConfig, baseChatConfig)).toBe(false);
    expect(await getFrontmatterExcludedFiles(vault)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('정책은 매번 Rust에서 적용하며 제외·해제는 캐시 읽기 없이 반영한다', async () => {
    const { vault, files, read } = fixture(['note.txt']);
    expect(await candidates(vault)).toEqual(files);
    expect(await candidates(vault, { ...baseRagConfig, excludePaths: ['note.txt'] })).toEqual([]);
    const config = { ...baseRagConfig, excludeExts: ['txt'] };
    expect(await candidates(vault, config)).toEqual([]);
    expect((await getRagFileTypeSummary(vault, config, baseChatConfig)).totalTargetFiles).toBe(0);
    expect(await candidates(vault)).toEqual(files);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rename·delete·create는 이전 경로와 새 identity 판정을 무효화한다', async () => {
    const { vault, files, contents, emit, read } = fixture(['note.txt']);
    const file = files[0];
    await candidates(vault);
    Object.assign(file, createFile('renamed.md'));
    contents.set(file.path, '---\nsuperpower-inside-exclude: true\n---\nprivate body');
    emit('rename', file, 'note.txt');
    expect(await candidates(vault)).toEqual([]);
    emit('delete', file);
    files.splice(0);
    expect(await candidates(vault)).toEqual([]);
    const replacement = createFile('note.txt');
    files.push(replacement);
    emit('create', replacement);
    expect(await candidates(vault)).toEqual([replacement]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('이벤트 없이 identity·extension·mtime·size가 바뀌어도 다시 probe한다', async () => {
    const { vault, files, read } = fixture(['note.txt']);
    await candidates(vault);
    files[0] = createFile('note.txt');
    await candidates(vault);
    files[0].extension = 'md';
    await candidates(vault);
    files[0].stat.mtime++;
    await candidates(vault);
    files[0].stat.size++;
    await candidates(vault);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it.each(['read', 'decode', 'yaml'] as const)(
    '%s 실패는 영구 negative cache 없이 복구 후 재시도한다',
    async (failure) => {
      const { vault, files, contents, read } = fixture();
      if (failure === 'read') read.mockRejectedValueOnce(new Error('synthetic unavailable'));
      if (failure === 'decode') contents.set(files[0].path, '\u0000binary');
      if (failure === 'yaml') contents.set(files[0].path, '---\ntitle: [unclosed\n---\nbody');
      expect(await candidates(vault)).toEqual([]);
      contents.set(files[0].path, 'public body');
      expect(await candidates(vault)).toEqual(files);
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it('읽기 중 같은 stat modify의 늦은 probe는 새 epoch나 반환 결과를 덮지 못한다', async () => {
    const { vault, files, emit, contents, read } = fixture();
    let release!: (bytes: ArrayBuffer) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    read.mockImplementationOnce(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
    });
    const old = candidates(vault);
    await reading;
    contents.set(files[0].path, '---\nsuperpower-inside-exclude: true\n---\nprivate body');
    emit('modify', files[0]);
    const current = candidates(vault);
    release(new TextEncoder().encode('old public body').buffer);
    expect(await current).toEqual([]);
    expect(await old).toEqual([]);
    expect(await candidates(vault)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('뒤 파일 읽기 중 앞 파일 modify도 전체 판정 게시 전에 다시 검증한다', async () => {
    const { vault, files, contents, emit, read } = fixture(['a.md', 'b.md']);
    let release!: (bytes: ArrayBuffer) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    read.mockResolvedValueOnce(new TextEncoder().encode('public a').buffer);
    read.mockImplementationOnce(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
    });
    const pending = candidates(vault);
    await reading;
    contents.set(files[0].path, '---\nsuperpower-inside-exclude: true\n---\nprivate a');
    emit('modify', files[0]);
    release(new TextEncoder().encode('public b').buffer);
    expect(await pending).toEqual([files[1]]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('읽기 중 정책 변경도 이전 허용 범위로 게시하지 않는다', async () => {
    const { vault, read } = fixture(['note.txt']);
    const config = { ...baseRagConfig, excludeExts: [] as string[] };
    let release!: (bytes: ArrayBuffer) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    read.mockImplementationOnce(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
    });
    const pending = candidates(vault, config);
    await reading;
    config.excludeExts = ['txt'];
    release(new TextEncoder().encode('public body').buffer);
    expect(await pending).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('decoder wire 실패 후 복구는 같은 stat에서도 재시도한다', async () => {
    const { vault, files, read } = fixture();
    const decode = rustCore.decodeSourceBytesRust;
    let broken = true;
    vi.spyOn(rustCore, 'decodeSourceBytesRust').mockImplementation((bytes, ...args) =>
      broken && bytes.byteLength > 0 ? null : decode(bytes, ...args),
    );
    expect(await candidates(vault)).toEqual([]);
    broken = false;
    expect(await candidates(vault)).toEqual(files);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('이벤트 API가 없는 vault도 동시 동일 snapshot I/O만 합친다', async () => {
    const { vault, files, read } = fixture(['note.txt']);
    Reflect.deleteProperty(vault, 'on');
    Reflect.deleteProperty(vault, 'offref');
    expect(await Promise.all([candidates(vault), candidates(vault)])).toEqual([files, files]);
    expect(read).toHaveBeenCalledTimes(1);
    await candidates(vault);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('다른 vault는 같은 파일 object/path/stat도 공유하지 않는다', async () => {
    const { vault, files } = fixture();
    const other = createEventVault(
      files,
      new Map([[files[0].path, '---\nsuperpower-inside-exclude: true\n---\nbody']]),
    );
    vaults.push(other.vault);
    expect(await candidates(vault)).toEqual(files);
    expect(await candidates(other.vault)).toEqual([]);
  });

  it('dispose는 구독을 한 번씩 해제하고 다음 호출은 새 캐시를 만든다', async () => {
    const { vault, files, offref, listeners, read } = fixture();
    await candidates(vault);
    expect(listeners.size).toBe(4);
    disposeRagFileEligibilityCache(vault);
    disposeRagFileEligibilityCache(vault);
    expect(offref).toHaveBeenCalledTimes(4);
    expect(listeners.size).toBe(0);
    expect(await candidates(vault)).toEqual(files);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('dispose 중 늦은 read는 후속 파일의 재구독·I/O·캐시 게시를 만들지 않는다', async () => {
    const { vault, read, listeners } = fixture(['a.txt', 'b.txt']);
    let release!: (bytes: ArrayBuffer) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    read.mockImplementationOnce(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
    });
    const pending = candidates(vault);
    await reading;
    disposeRagFileEligibilityCache(vault);
    release(new TextEncoder().encode('public body').buffer);
    expect(await pending).toEqual([]);
    expect(listeners.size).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['on', 'offref', 'both'] as const)(
    '이벤트 API %s 부재 모의도 fresh로 안전하게 동작한다',
    async (missing) => {
      const { vault, files, contents, read } = fixture();
      if (missing === 'on' || missing === 'both') Reflect.deleteProperty(vault, 'on');
      if (missing === 'offref' || missing === 'both') Reflect.deleteProperty(vault, 'offref');
      expect(await candidates(vault)).toEqual(files);
      contents.set(files[0].path, '---\nsuperpower-inside-exclude: true\n---\nbody');
      expect(await candidates(vault)).toEqual([]);
      expect(read).toHaveBeenCalledTimes(2);
    },
  );
});

function createEventVault(files: TFile[], contents: Map<string, string>) {
  type Listener = (file: TFile, oldPath?: string) => void;
  const listeners = new Map<object, { name: string; callback: Listener }>();
  const offref = vi.fn((ref: object) => {
    listeners.delete(ref);
  });
  const vault = Object.assign(createVault(files, contents), {
    on: vi.fn((name: string, callback: Listener) => {
      const ref = {};
      listeners.set(ref, { name, callback });
      return ref;
    }),
    offref,
  });
  return {
    vault,
    offref,
    listeners,
    emit: (name: string, file: TFile, oldPath?: string) => {
      for (const listener of listeners.values()) {
        if (listener.name === name) listener.callback(file, oldPath);
      }
    },
  };
}

describe('RAG 제외 확장자 판정', () => {
  it('경로 제외와 겹치는 파일은 확장자 제외 개수에 중복 집계하지 않는다', () => {
    const vault = createVault([createFile('Code/main.ts'), createFile('notes/main.ts')]);
    expect(countFilesByExtensions(vault, ['ts'], ['./Code/'])).toEqual({ ts: 1 });
  });
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

describe('제외 경로 메타데이터', () => {
  it('folder 항목은 정규화한 실제 폴더 표기로 하위 일치 파일을 집계한다', () => {
    const vault = createVault(
      [
        createFile('Archive/a.md', 10),
        createFile('Archive/Sub/b.md', 20),
        createFile('Archive.md', 30),
        createFile('Notes/c.md', 40),
      ],
      new Map(),
      [createFolder('Archive'), createFolder('Notes')],
    );

    expect(getExcludePathMetadata(vault, ' ./Archive/ ')).toEqual({
      entry: ' ./Archive/ ',
      kind: 'folder',
      displayPath: 'Archive',
      exists: true,
      matches: [{ path: 'Archive', fileCount: 2, sizeBytes: 30, latestMtimeMs: 1000 }],
      matchCount: 1,
      totalFileCount: 2,
      totalSizeBytes: 30,
      latestMtimeMs: 1000,
    });
  });

  it('folder 항목은 대소문자가 다르면 실제 표기 폴더 경로로 폴백한다', () => {
    const file = createFile('Archive/a.md', 10);
    file.stat.mtime = 2000;
    const vault = createVault([file], new Map(), [createFolder('Archive')]);

    const metadata = getExcludePathMetadata(vault, 'archive');

    expect(metadata.displayPath).toBe('archive');
    expect(metadata.matches).toEqual([
      { path: 'Archive', fileCount: 1, sizeBytes: 10, latestMtimeMs: 2000 },
    ]);
  });

  it('pattern 항목은 일치 폴더를 중복 없이 경로 오름차순으로 집계한다', () => {
    const atlasFile = createFile('Projects/Atlas/drafts/a.md', 20);
    atlasFile.stat.mtime = 2000;
    const nestedFile = createFile('Projects/Atlas/drafts/nested/b.md', 30);
    nestedFile.stat.mtime = 3000;
    const vault = createVault(
      [
        atlasFile,
        nestedFile,
        createFile('Projects/Zeta/drafts/z.md', 10),
        createFile('Projects/Atlas/notes/c.md', 40),
      ],
      new Map(),
      [
        createFolder('Projects/Atlas/drafts/nested'),
        createFolder('Projects/Zeta/drafts'),
        createFolder('Projects/Atlas/drafts'),
        createFolder('Projects/Atlas/notes'),
      ],
    );

    const metadata = getExcludePathMetadata(vault, '**/drafts/**');

    expect(metadata.kind).toBe('pattern');
    expect(metadata.displayPath).toBe('**/drafts/**');
    expect(metadata.exists).toBe(true);
    expect(metadata.matches).toEqual([
      { path: 'Projects/Atlas/drafts', fileCount: 2, sizeBytes: 50, latestMtimeMs: 3000 },
      { path: 'Projects/Zeta/drafts', fileCount: 1, sizeBytes: 10, latestMtimeMs: 1000 },
    ]);
    expect(metadata.matchCount).toBe(2);
    expect(metadata.totalFileCount).toBe(3);
    expect(metadata.totalSizeBytes).toBe(60);
    expect(metadata.latestMtimeMs).toBe(3000);
  });

  it('일치가 없으면 예외 없이 빈 메타데이터를 돌려준다', () => {
    const vault = createVault([createFile('Notes/a.md')], new Map(), [createFolder('Notes')]);

    expect(getExcludePathMetadata(vault, 'Missing')).toEqual({
      entry: 'Missing',
      kind: 'folder',
      displayPath: 'Missing',
      exists: false,
      matches: [],
      matchCount: 0,
      totalFileCount: 0,
      totalSizeBytes: 0,
      latestMtimeMs: null,
    });
    expect(getExcludePathMetadata(vault, '**/drafts/**')).toMatchObject({
      kind: 'pattern',
      exists: false,
      matches: [],
      totalFileCount: 0,
      totalSizeBytes: 0,
      latestMtimeMs: null,
    });
  });

  it('일치 폴더에 파일이 없어도 존재로 집계한다', () => {
    const vault = createVault([], new Map(), [createFolder('Projects/Atlas/drafts')]);

    expect(getExcludePathMetadata(vault, '**/drafts/**')).toEqual({
      entry: '**/drafts/**',
      kind: 'pattern',
      displayPath: '**/drafts/**',
      exists: true,
      matches: [{ path: 'Projects/Atlas/drafts', fileCount: 0, sizeBytes: 0, latestMtimeMs: null }],
      matchCount: 1,
      totalFileCount: 0,
      totalSizeBytes: 0,
      latestMtimeMs: null,
    });
  });

  it('볼트가 비어 있으면 빈 메타데이터를 돌려준다', () => {
    const vault = createVault([], new Map(), []);

    expect(getExcludePathMetadata(vault, 'Archive')).toEqual({
      entry: 'Archive',
      kind: 'folder',
      displayPath: 'Archive',
      exists: false,
      matches: [],
      matchCount: 0,
      totalFileCount: 0,
      totalSizeBytes: 0,
      latestMtimeMs: null,
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

function createFolder(path: string): TFolder {
  return Object.assign(Object.create(TFolder.prototype), { path }) as TFolder;
}

function createVault(
  files: TFile[],
  contents = new Map<string, string>(),
  folders: TFolder[] = [],
): Vault {
  return {
    configDir: '.config/obsidian',
    getFiles: () => files,
    getAllLoadedFiles: () => [...files, ...folders],
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? 'text'),
    readBinary: (file: TFile) =>
      Promise.resolve(
        new TextEncoder().encode(
          contents.get(file.path) ?? (file.extension === 'parquet' ? 'PAR1\u0000binary' : 'text'),
        ).buffer,
      ),
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
