import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
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

  it('GraphRAG community 후보는 vault 파일이 없어도 Vault Context에 포함한다', async () => {
    const app = createApp(new Map());
    const ragEngine = createRagEngine([
      createResult(
        'graph://community/community::mission',
        'Paul and Barnabas missionary conflict',
        'graph-hash',
      ),
    ]);

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
  });
});

describe('buildChatContext 참조 문서 확장', () => {
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

    expect(context.systemPrompt).toContain('[File: 제품문서/고객 입장에서의 제품/데모 및 제품 기획.md]');
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
    const ragEngine = createRagEngine([createResult('RAG.md', 'RAG 내용', createContentHash('RAG 내용'))]);

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

function createFile(path: string, content: string, mtime: number): TFile & { content: string } {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
    content,
    stat: {
      ctime: mtime,
      mtime,
      size: content.length,
    },
  }) as TFile & { content: string };
}

function createApp(files: Map<string, TFile & { content: string }>): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: (file: TFile & { content: string }) => Promise.resolve(file.content),
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
