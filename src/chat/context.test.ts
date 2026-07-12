import { TFile, TFolder, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { GraphEntityRecord, GraphRelationRecord, KnowledgeGraphStore } from '../graph/store';
import type { MCPRegistry } from '../mcp/registry';
import { createContentHash } from '../rag/hash';
import type { QueryResult } from '../rag/query';
import { buildChatContext, type RagQueryLike } from './context';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  class MockTFolder {}
  return { TFile: MockTFile, TFolder: MockTFolder };
});

describe('buildChatContext RAG 출처 검증', () => {
  it('존재하지 않는 파일 후보는 Vault Context에 넣지 않는다', async () => {
    const app = createApp(new Map());
    const ragEngine = createRagEngine([createResult('missing.md', '없는 문서', 'hash')]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toBeNull();
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'missing.md', status: 'missing' }),
    );
    expect(context.attachments[0]).toEqual(expect.objectContaining({ status: 'low-relevance' }));
  });

  it('stale 후보는 citation 경고로만 남기고 프롬프트 컨텍스트에서 제외한다', async () => {
    const file = createFile('note.md', '현재 내용', 2000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = createRagEngine([createResult('note.md', '이전 내용', 'old-hash')]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toBeNull();
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'note.md', status: 'stale' }),
    );
  });

  it('검증된 후보만 Vault Context에 포함한다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = createRagEngine([
      createResult('note.md', '현재 내용', createContentHash('현재 내용')),
    ]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toContain('[Vault Context Rules]');
    expect(context.systemPrompt).toContain('[Source rag-1: note.md]');
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'note.md', status: 'verified' }),
    );
  });

  it('RAG provider diagnostic 요약을 attachment detail에 표시한다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = {
      query: () =>
        Promise.resolve([createResult('note.md', '현재 내용', createContentHash('현재 내용'))]),
      getLastRetrievalDiagnostics: () => [
        {
          providerId: 'exact-vector',
          source: 'vector',
          status: 'ok',
          durationMs: 12,
          candidateCount: 5,
          readiness: 'ready',
          estimatedCost: 'low',
        },
        {
          providerId: 'bm25',
          source: 'bm25',
          status: 'timeout',
          durationMs: 80,
          candidateCount: 0,
          readiness: 'ready',
          estimatedCost: 'free',
        },
      ],
    } satisfies RagQueryLike & {
      getLastRetrievalDiagnostics: () => Array<{
        providerId: string;
        source: string;
        status: string;
        durationMs: number;
        candidateCount: number;
        readiness: string;
        estimatedCost: string;
      }>;
    };

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.attachments[0]?.detail).toContain(
      'exact-vector ok/ready 5개, bm25 timeout/ready 0개',
    );
  });

  it('GraphRAG community 후보는 vault 파일이 없어도 Vault Context에 포함한다', async () => {
    const app = createApp(new Map());
    const graphResult = createResult(
        'graph://community/community::mission',
        'Paul and Barnabas missionary conflict',
        'graph-hash',
      );
    graphResult.retrievalSources = ['graph-global'];
    const ragEngine = createRagEngine([graphResult]);

    const context = await buildChatContext('반복되는 핵심 주제는?', { app, ragEngine });

    expect(context.systemPrompt).toContain('[Vault Context Rules]');
    expect(context.systemPrompt).toContain('[Source rag-1: graph://community/community::mission]');
    expect(context.systemPrompt).toContain('Paul and Barnabas missionary conflict');
    expect(context.citations[0]).toEqual(
      expect.objectContaining({
        filePath: 'graph://community/community::mission',
        status: 'verified',
        graphType: 'community',
      }),
    );
    expect(context.attachments[0]).toEqual(
      expect.objectContaining({ type: 'rag', status: 'attached', sourceIds: ['rag-1'] }),
    );
    expect(context.attachments[1]).toEqual(
      expect.objectContaining({
        type: 'graph-rag',
        status: 'attached',
        detail: '1개 출처가 문서 간 연결을 통해 보강되었습니다.',
      }),
    );
  });

  it('자연어의 한글 표기와 가까운 영문 폴더에서 번역된 키워드로 원문을 직접 찾는다', async () => {
    const bible = createFile('bible/revelation.md', '성경 계시록', 1000);
    const neville = createFile('neville/revelation.txt', 'Neville on Revelation', 1000, 'txt');
    const app = createApp(
      new Map([
        [bible.path, bible],
        [neville.path, neville],
      ]),
    );
    const calls: Array<{ minScore?: number; pathPrefixes?: readonly string[] }> = [];
    const ragEngine: RagQueryLike = {
      query: (_question, _topK, minScore, pathPrefixes) => {
        calls.push({ minScore, pathPrefixes });
        return Promise.resolve(
          pathPrefixes?.includes('neville')
            ? [createResult(neville.path, neville.content, createContentHash(neville.content))]
            : [createResult(bible.path, bible.content, createContentHash(bible.content))],
        );
      },
    };

    const context = await buildChatContext('네빌 고다드는 요한 계시록을 어떻게 해석했어?', {
      app,
      ragEngine,
      queryExpander: () => Promise.resolve('Neville Goddard Revelation Apocalypse'),
    });

    expect(calls).toEqual([]);
    expect(context.citations.map((citation) => citation.filePath)).toEqual([
      'neville/revelation.txt',
    ]);
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'folder:auto:neville',
          status: 'attached',
          sourceIds: ['folder-auto-1'],
        }),
      ]),
    );
  });

  it('검증된 local Graph 근거만 연결 근거 attachment로 표시한다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const app = createApp(new Map([['note.md', file]]));
    const graphResult = createResult('note.md', '현재 내용', createContentHash('현재 내용'));
    graphResult.retrievalSources = ['vector', 'graph-local'];

    const context = await buildChatContext('관계를 알려줘', {
      app,
      ragEngine: createRagEngine([graphResult]),
    });

    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'graph-rag',
          status: 'attached',
          sourceIds: ['rag-1'],
        }),
      ]),
    );
  });

  it('entity mention은 GraphRAG entity와 relation context를 첨부한다', async () => {
    const app = createApp(new Map());
    const graphStore = createGraphStore(
      [
        createEntity('entity::paul', 'Paul', ['Apostle'], '사도 바울'),
        createEntity('entity::barnabas', 'Barnabas', [], '동역자'),
        createEntity('entity::mark', 'Mark', [], '마가'),
      ],
      [
        createRelation(
          'relation::paul-barnabas',
          'entity::paul',
          'entity::barnabas',
          'worked_with',
        ),
        createRelation(
          'relation::mark-barnabas',
          'entity::mark',
          'entity::barnabas',
          'worked_with',
        ),
      ],
    );

    const context = await buildChatContext('@[entity: Apostle] 관계를 알려줘', {
      app,
      knowledgeGraphStore: graphStore,
    });

    expect(context.systemPrompt).toContain('[Graph Knowledge Context]');
    expect(context.systemPrompt).toContain('- [person] Paul (aka Apostle)');
    expect(context.systemPrompt).toContain('- Paul → [worked_with] → Barnabas');
    expect(context.systemPrompt).not.toContain('Mark → [worked_with] → Barnabas');
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'graph-rag',
          status: 'attached',
          sourceIds: ['graph-1'],
        }),
      ]),
    );
    expect(context.citations).toEqual([
      expect.objectContaining({
        id: 'graph-1',
        filePath: 'graph://entities',
        graphType: 'entity',
      }),
    ]);
  });
});

describe('buildChatContext 참조 문서 확장', () => {
  it('폴더 멘션 파일 선택과 partial 여부는 Rust folder plan을 따른다', async () => {
    const folder = createFolder('제품문서');
    const first = createFile('제품문서/a.md', '첫 문서', 1000);
    const second = createFile('제품문서/nested/b.md', '둘째 문서', 1000);
    const outside = createFile('제품문서-extra/c.md', '외부 문서', 1000);
    const app = createApp(
      new Map([
        [first.path, first],
        [second.path, second],
        [outside.path, outside],
      ]),
      new Map([[folder.path, folder]]),
    );

    const context = await buildChatContext('@[제품문서] 정리', {
      app,
      maxFolderFiles: 1,
    });

    expect(context.systemPrompt).toContain('[Folder File: 제품문서/a.md]');
    expect(context.systemPrompt).toContain('첫 문서');
    expect(context.systemPrompt).not.toContain('둘째 문서');
    expect(context.systemPrompt).not.toContain('외부 문서');
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'folder',
          name: '제품문서',
          status: 'partial',
          sourceIds: ['folder-1'],
        }),
      ]),
    );
  });

  it('명시 파일 안의 wikilink 참조 문서를 Vault Context에 포함한다', async () => {
    const source = createFile(
      '제품문서/고객 입장에서의 제품/데모 및 제품 기획.md',
      '핵심 기획입니다.\n[[제품 개념 정리]]',
      1000,
    );
    const reference = createFile(
      '제품문서/고객 입장에서의 제품/제품 개념 정리.md',
      '제품 개념 참조 내용',
      1000,
    );
    const app = createApp(
      new Map([
        [source.path, source],
        [reference.path, reference],
      ]),
    );

    const context = await buildChatContext(
      '@[제품문서/고객 입장에서의 제품/데모 및 제품 기획.md] 이 파일에 따라 도와줘',
      { app },
    );

    expect(context.systemPrompt).toContain(
      '[File: 제품문서/고객 입장에서의 제품/데모 및 제품 기획.md]',
    );
    expect(context.systemPrompt).toContain(
      '[Reference File: 제품문서/고객 입장에서의 제품/제품 개념 정리.md]',
    );
    expect(context.systemPrompt).toContain('제품 개념 참조 내용');
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reference',
          name: reference.path,
          status: 'attached',
        }),
      ]),
    );
  });

  it('직접 멘션 문서를 자동 RAG보다 먼저 컨텍스트에 배치한다', async () => {
    const source = createFile('제품문서/데모 및 제품 기획.md', '직접 멘션 내용', 1000);
    const ragFile = createFile('RAG.md', 'RAG 내용', 1000);
    const app = createApp(
      new Map([
        [source.path, source],
        [ragFile.path, ragFile],
      ]),
    );
    const ragEngine = createRagEngine([
      createResult('RAG.md', 'RAG 내용', createContentHash('RAG 내용')),
    ]);

    const context = await buildChatContext('@[제품문서/데모 및 제품 기획.md] 질문', {
      app,
      ragEngine,
    });

    expect(context.systemPrompt?.indexOf('[File: 제품문서/데모 및 제품 기획.md]')).toBeLessThan(
      context.systemPrompt?.indexOf('[Source rag-') ?? Number.POSITIVE_INFINITY,
    );
  });

  it('참조 문서가 컨텍스트 예산 때문에 잘리면 partial attachment로 표시한다', async () => {
    const source = createFile('제품문서/데모 및 제품 기획.md', '[[제품 개념 정리]]', 1000);
    const reference = createFile('제품문서/제품 개념 정리.md', '참조 내용이 매우 깁니다.', 1000);
    const app = createApp(
      new Map([
        [source.path, source],
        [reference.path, reference],
      ]),
    );

    const context = await buildChatContext('@[제품문서/데모 및 제품 기획.md] 질문', {
      app,
      maxContextChars: 42,
    });

    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reference',
          name: reference.path,
          status: 'partial',
        }),
      ]),
    );
  });
});

describe('buildChatContext UX reason metadata', () => {
  it('server-only mentions skip auto RAG with an explicit reason', async () => {
    const app = createApp(new Map());
    const query = vi.fn(() => Promise.resolve([]));
    const ragEngine = { query } satisfies RagQueryLike;

    const context = await buildChatContext('@web search latest docs', {
      app,
      ragEngine,
      mcpRegistry: createMcpRegistry('web'),
    });

    expect(query).not.toHaveBeenCalled();
    const autoRagAttachment = context.attachments.find(
      (attachment) => attachment.id === 'rag:auto',
    );
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rag:auto',
          type: 'rag',
          status: 'missing',
          autoRagReason: 'server-only',
        }),
        expect.objectContaining({
          id: 'mcp:web',
          type: 'mcp-server',
          status: 'attached',
        }),
      ]),
    );
    expect(typeof autoRagAttachment?.detail).toBe('string');
  });

  it('folder mention exposes max-files as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const first = createFile('docs/a.md', 'first', 1000);
    const second = createFile('docs/b.md', 'second', 1000);
    const app = createApp(
      new Map([
        [first.path, first],
        [second.path, second],
      ]),
      new Map([[folder.path, folder]]),
    );

    const context = await buildChatContext('@[docs] summarize', {
      app,
      maxFolderFiles: 1,
    });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        filteredCount: 1,
        folderLimitReason: 'max-files',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });

  it('folder mention은 RAG가 인덱싱하는 txt 파일도 첨부한다', async () => {
    const folder = createFolder('neville');
    const textFile = createFile('neville/lecture.txt', 'Neville lecture', 1000, 'txt');
    const app = createApp(new Map([[textFile.path, textFile]]), new Map([[folder.path, folder]]));

    const context = await buildChatContext('@neville 요약', { app });

    expect(context.citations).toEqual([
      expect.objectContaining({ filePath: 'neville/lecture.txt', status: 'verified' }),
    ]);
    expect(context.attachments).toEqual([
      expect.objectContaining({ id: 'folder:neville', status: 'attached', fileCount: 1 }),
    ]);
  });

  it('folder mention exposes budget as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const first = createFile(
      'docs/a.md',
      'This document is intentionally longer than the budget.',
      1000,
    );
    const app = createApp(new Map([[first.path, first]]), new Map([[folder.path, folder]]));

    const context = await buildChatContext('@[docs] summarize', {
      app,
      maxContextChars: 12,
    });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        folderLimitReason: 'budget',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });

  it('folder mention exposes read errors as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const unreadable = createFile('docs/a.md', 'unreadable', 1000);
    const readable = createFile('docs/b.md', 'readable', 1000);
    const app = createApp(
      new Map([
        [unreadable.path, unreadable],
        [readable.path, readable],
      ]),
      new Map([[folder.path, folder]]),
      new Set([unreadable.path]),
    );

    const context = await buildChatContext('@[docs] summarize', { app });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        folderLimitReason: 'read-error',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });
});

function createRagEngine(results: QueryResult[]): RagQueryLike {
  return {
    query: () => Promise.resolve(results),
  };
}

function createResult(filePath: string, text: string, contentHash: string): QueryResult {
  return {
    entry: {
      id: `${filePath}::0`,
      vector: [1, 0],
      metadata: {
        filePath,
        startLine: 0,
        endLine: 0,
        text,
        sourceMtime: 1000,
        sourceSize: text.length,
        contentHash,
        indexedAt: 1000,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    },
    score: 0.9,
    vectorScore: 0.9,
    bm25Score: 0.1,
    combinedScore: 0.9,
    sourcePath: filePath,
    chunkRange: { startLine: 0, endLine: 0 },
    keywordMatches: 1,
  };
}

function createFile(
  path: string,
  content: string,
  mtime: number,
  extension = 'md',
): TFile & { content: string } {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension,
    content,
    stat: {
      ctime: mtime,
      mtime,
      size: content.length,
    },
  }) as TFile & { content: string };
}

function createFolder(path: string): TFolder & { path: string } {
  return Object.assign(Object.create(TFolder.prototype), {
    path,
    name: path.split('/').pop() ?? path,
  }) as TFolder & { path: string };
}

function createApp(
  files: Map<string, TFile & { content: string }>,
  folders = new Map<string, TFolder & { path: string }>(),
  readErrors = new Set<string>(),
): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
      cachedRead: (file: TFile & { content: string }) =>
        readErrors.has(file.path)
          ? Promise.reject(new Error(`read failed: ${file.path}`))
          : Promise.resolve(file.content),
      getMarkdownFiles: () => [...files.values()],
      getFiles: () => [...files.values()],
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
        const sourceFolder = sourcePath.split('/').slice(0, -1).join('/');
        const candidates = [
          linkpath,
          linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`,
          sourceFolder ? `${sourceFolder}/${linkpath}` : linkpath,
          sourceFolder && !linkpath.endsWith('.md') ? `${sourceFolder}/${linkpath}.md` : '',
        ].filter(Boolean);
        for (const candidate of candidates) {
          const file = files.get(candidate);
          if (file) return file;
        }
        return null;
      },
    },
  } as unknown as App;
}

function createMcpRegistry(...serverNames: string[]): MCPRegistry {
  return {
    getEnabledServers: () => serverNames.map((name) => ({ name })),
    getClient: (name: string) =>
      serverNames.includes(name)
        ? {
            listTools: () => Promise.resolve([]),
          }
        : null,
  } as unknown as MCPRegistry;
}

function createGraphStore(
  entities: GraphEntityRecord[],
  relations: GraphRelationRecord[],
): KnowledgeGraphStore {
  return {
    getEntities: () => Promise.resolve(entities),
    getRelations: () => Promise.resolve(relations),
    getClaims: () => Promise.resolve([]),
    getEvidence: () => Promise.resolve([]),
    getCommunities: () => Promise.resolve([]),
  } as unknown as KnowledgeGraphStore;
}

function createEntity(
  id: string,
  canonicalName: string,
  aliases: string[],
  description: string,
): GraphEntityRecord {
  return {
    id,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'person',
    canonicalName,
    aliases,
    description,
    properties: {},
    confidence: 1,
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createRelation(
  id: string,
  sourceEntityId: string,
  targetEntityId: string,
  relationTypeId: string,
): GraphRelationRecord {
  return {
    id,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId,
    sourceEntityId,
    targetEntityId,
    description: '',
    properties: {},
    confidence: 1,
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
