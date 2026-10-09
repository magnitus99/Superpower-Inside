import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import {
  NativeVaultToolRuntime,
  type NativeVaultToolPort,
  type NativeVaultToolResult,
} from '../agent/native-vault-tool';
import { VaultResearchAgent } from '../agent/research-agent';
import { selectDisplayedAnswerCitations } from '../agent/citation-selection';
import {
  appendAssistantToolRound,
  collectToolCitations,
  executeAssistantToolCalls,
  prepareAssistantToolCalls,
} from '../chat/tool-execution';
import type { ToolCallRecord } from '../chat/types';
import { parseCompatibilityToolResponse } from '../chat/tool-protocol';
import {
  normalizeForClaude,
  normalizeForOllama,
  normalizeForOpenAI,
  type ChatMessage,
} from '../llm/providers';
import { IndexedDbBM25Index } from '../rag/bm25';
import { RAGQueryEngine } from '../rag/query';

const dbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
});

describe('유료 제품 핵심 사용자 여정', () => {
  it('전체 볼트 요약은 모든 문서를 읽고 근거 출처가 있는 최종 답변을 만든다', async () => {
    const runtime = new NativeVaultToolRuntime(createVaultPort());
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve(
          '제품 전략은 고객 문제와 안정성 개선을 함께 추진한다. [vault:Strategy.md:1-2] [vault:Incidents.md:1-2]',
        );
      }
      if (prompt.includes('Strategy.md')) {
        return Promise.resolve('고객 문제를 우선한다. [vault:Strategy.md:1-2]');
      }
      return Promise.resolve('검색 안정성 개선이 필요하다. [vault:Incidents.md:1-2]');
    });

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '이 옵시디언 볼트를 요약해줘',
    });

    expect(result).toMatchObject({ processedFiles: 2, totalFiles: 2, failedFiles: [] });
    expect(result.citations.map((citation) => citation.filePath).sort()).toEqual([
      'Incidents.md',
      'Strategy.md',
    ]);
    expect(result.content).toContain('고객 문제와 안정성 개선');
  });

  it('모델이 검색→읽기를 반복한 뒤 provider별 유효한 이력과 검증 출처를 만든다', async () => {
    const runtime = new NativeVaultToolRuntime(createVaultPort());
    let messages: ChatMessage[] = [
      { role: 'user', content: '최근 검색 장애의 원인을 근거로 설명해줘.' },
    ];
    const allCalls: ToolCallRecord[] = [];

    const searchCalls = await executeRound(runtime, [
      createCall('search-1', '{"action":"search","query":"검색 장애"}'),
    ]);
    allCalls.push(...searchCalls);
    messages = appendAssistantToolRound(messages, '관련 문서를 찾겠습니다.', searchCalls);

    const readCalls = await executeRound(runtime, [
      createCall('read-1', '{"action":"read","path":"Incidents.md"}'),
    ]);
    allCalls.push(...readCalls);
    messages = appendAssistantToolRound(messages, '장애 기록을 확인하겠습니다.', readCalls);

    const finalAnswer = '원인은 인덱스 전체 스캔으로 인한 지연이었다. [vault:Incidents.md:1-2]';
    const toolCitations = collectToolCitations([], allCalls);
    const citations = selectDisplayedAnswerCitations(finalAnswer, toolCitations);

    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(normalizeForOpenAI(messages).at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'read-1',
    });
    expect(normalizeForClaude(messages).at(-1)).toMatchObject({ role: 'user' });
    expect(normalizeForOllama(messages).at(-1)).toMatchObject({
      role: 'tool',
      tool_name: 'superpower_inside',
    });
    expect(citations).toEqual([
      expect.objectContaining({ filePath: 'Incidents.md', status: 'verified' }),
    ]);
    expect(selectDisplayedAnswerCitations('출처 표기가 없는 최종 답변', toolCitations)).toEqual([]);
  });

  it('function calling이 없는 모델도 compatibility JSON으로 네이티브 조사 도구를 실행한다', async () => {
    const runtime = new NativeVaultToolRuntime(createVaultPort());
    const parsed = parseCompatibilityToolResponse(
      '<tool_call>{"name":"superpower_inside","arguments":{"action":"read","path":"Incidents.md"}}</tool_call>',
      () => 'compat-read',
    );

    const executed = await executeRound(runtime, parsed.toolCalls);

    expect(parsed.visibleContent).toBe('');
    expect(executed[0]).toMatchObject({
      id: 'compat-read',
      status: 'success',
      executionKind: 'native',
    });
    expect(executed[0]?.citations).toEqual([
      expect.objectContaining({ filePath: 'Incidents.md', status: 'verified' }),
    ]);
  });

  it('임베딩 provider가 없어도 BM25 corpus만으로 관련 문서와 본문을 반환한다', async () => {
    const dbName = `journey-bm25-${crypto.randomUUID()}`;
    dbNames.add(dbName);
    const index = new IndexedDbBM25Index(dbName, createAdapter());
    await index.load();
    index.addDocument(
      'Strategy.md::0',
      '고객 문제를 먼저 해결하고 온보딩 마찰을 줄인다.',
      'Strategy.md',
    );
    index.addDocument(
      'Incidents.md::0',
      '검색 장애는 인덱스 전체 스캔과 타임아웃 때문에 발생했다.',
      'Incidents.md',
    );
    await index.persist();
    const engine = new RAGQueryEngine(null, null, index, 1, 0);

    const results = await engine.query('검색 장애 타임아웃 원인', 3, 0);

    expect(results[0]).toMatchObject({ sourcePath: 'Incidents.md', vectorScore: 0 });
    expect(results[0]?.entry.metadata.text).toContain('인덱스 전체 스캔');
    index.close();
  });
});

async function executeRound(
  runtime: NativeVaultToolRuntime,
  toolCalls: ToolCallRecord[],
): Promise<ToolCallRecord[]> {
  const prepared = await prepareAssistantToolCalls({
    toolCalls,
    nativeTool: runtime,
    registry: null,
    preferredServerNames: [],
    mcpMode: 'always-manual',
  });
  return executeAssistantToolCalls({
    toolCalls: prepared,
    nativeTool: runtime,
    registry: null,
    preferredServerNames: [],
  });
}

function createCall(id: string, argumentsText: string): ToolCallRecord {
  return {
    id,
    name: 'superpower_inside',
    arguments: argumentsText,
    status: 'running',
  };
}

function createVaultPort(): NativeVaultToolPort {
  const notes = new Map([
    ['Strategy.md', '고객 문제를 먼저 해결한다.\n온보딩 마찰을 줄인다.'],
    [
      'Incidents.md',
      '검색 장애는 인덱스 전체 스캔에서 시작됐다.\n타임아웃이 사용자 답변을 막았다.',
    ],
  ]);
  return {
    stats: () =>
      Promise.resolve(withoutCitations({ action: 'stats', fileCount: 2, totalBytes: 100 })),
    list: (request) => {
      const files = [...notes.entries()].map(([path, content]) => ({
        path,
        modifiedAt: 1,
        size: content.length,
      }));
      const selected = files.slice(request.cursor, request.cursor + request.limit);
      const nextCursor = request.cursor + selected.length;
      return Promise.resolve(
        withoutCitations({
          action: 'list',
          path: request.path,
          exists: true,
          files: selected,
          nextCursor: nextCursor < files.length ? nextCursor : null,
          total: files.length,
        }),
      );
    },
    read: (request) => {
      const content = notes.get(request.path);
      if (!content) return Promise.reject(new Error('missing note'));
      const lines = content.split('\n');
      const endLine = Math.min(request.endLine ?? lines.length, lines.length);
      const citation = {
        id: `vault:${request.path}:${request.startLine}-${endLine}`,
        filePath: request.path,
        line: request.startLine,
        endLine,
        preview: lines.slice(request.startLine - 1, endLine).join(' '),
        status: 'verified' as const,
      };
      return Promise.resolve({
        action: 'read',
        path: request.path,
        startLine: request.startLine,
        endLine,
        totalLines: lines.length,
        truncated: endLine < lines.length,
        content: lines.slice(request.startLine - 1, endLine).join('\n'),
        citations: [citation],
      });
    },
    search: (request) => {
      const hits = [...notes.entries()]
        .filter(([, content]) => content.includes('검색') || request.query.includes('검색'))
        .slice(0, request.limit)
        .map(([path, content]) => ({
          path,
          startLine: 1,
          endLine: 2,
          preview: content,
          score: path === 'Incidents.md' ? 1 : 0.5,
        }))
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
      return Promise.resolve({
        action: 'search',
        query: request.query,
        path: request.path,
        match: request.match,
        hits,
        scannedFiles: notes.size,
        unreadableFiles: 0,
        totalHits: hits.length,
        truncated: false,
        citations: hits.map((hit) => ({
          id: `vault:${hit.path}:1-2`,
          filePath: hit.path,
          line: 1,
          endLine: 2,
          preview: hit.preview,
          status: 'verified' as const,
        })),
      });
    },
    related: (request) =>
      Promise.resolve({
        action: 'related',
        path: request.path,
        startLine: request.startLine,
        endLine: request.endLine ?? request.startLine,
        hits: [],
        truncated: false,
        citations: [],
      }),
    links: (request) =>
      Promise.resolve({
        action: 'links',
        path: request.path,
        direction: request.direction,
        outgoing: [],
        incoming: [],
        citations: [],
      }),
  };
}

function withoutCitations<T extends Omit<NativeVaultToolResult, 'citations'>>(
  value: T,
): T & { citations: [] } {
  return { ...value, citations: [] };
}

function createAdapter(): DataAdapter {
  return {
    exists: () => Promise.resolve(false),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
}
