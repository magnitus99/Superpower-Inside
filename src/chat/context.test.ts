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
  } as unknown as App;
}
