import { describe, expect, it } from 'vitest';
import type { ChatMessageWithMeta } from '../chat/types';
import {
  CHAT_DEBUG_TRACE_HEADING,
  buildChatDebugTrace,
  extractChatDebugTrace,
  formatChatDebugTraceSection,
  redactTraceText,
  shouldRecordChatTrace,
  type ChatTraceConfigSnapshot,
} from './chat-trace';

const config: ChatTraceConfigSnapshot = {
  rag: {
    chunkSize: 1000,
    overlap: 100,
    embeddingProvider: 'ternlight',
    embeddingModel: 'ternlight-base',
    minScore: 0.3,
    enableBM25: true,
    bm25Weight: 0.3,
    annEnabled: true,
    structuralGraphEnabled: true,
  },
  chat: {
    mcpToolExecutionPolicy: 'always-auto',
    mcpServerCount: 1,
    pluginAwareEnabled: false,
    autoSaveEnabled: true,
  },
};

function createMessage(overrides: Partial<ChatMessageWithMeta> = {}): ChatMessageWithMeta {
  const now = '2026-05-16T00:00:00.000Z';
  return {
    id: 'msg-trace',
    role: 'assistant',
    content: '합성 답변',
    timestamp: Date.parse(now),
    createdAt: now,
    updatedAt: now,
    status: 'complete',
    ...overrides,
  };
}

describe('chat debug trace', () => {
  it('런타임 스냅샷을 함께 기록한다', () => {
    const trace = buildChatDebugTrace({
      message: createMessage(),
      config,
      runtime: { indexing: { running: false }, mcp: [{ name: 'files', status: 'ready' }] },
    });
    expect(trace.runtime).toEqual({
      indexing: { running: false },
      mcp: [{ name: 'files', status: 'ready' }],
    });
  });

  it('배포 빌드에서는 설정이 켜져 있어도 기록하지 않는다', () => {
    expect(shouldRecordChatTrace(true, false)).toBe(false);
    expect(shouldRecordChatTrace(false, true)).toBe(false);
    expect(shouldRecordChatTrace(true, true)).toBe(true);
  });

  it('입력·검색 후보·도구·근거를 한 문서로 모은다', () => {
    const question = createMessage({ id: 'msg-user', role: 'user', content: '질의 본문' });
    const answer = createMessage({
      content: '근거 있는 답변',
      stopReason: 'complete',
      model: 'synthetic-model',
      retrievalTrace: [
        {
          query: '질의 본문',
          diagnostics: [
            {
              providerId: 'bm25',
              source: 'bm25',
              status: 'ok',
              readiness: 'ready',
              durationMs: 12.4,
              candidateCount: 3,
              estimatedCost: 'free',
            },
          ],
          results: [{ filePath: 'Notes/A.md', line: 4, bm25Score: 2.5, selectionReason: 'keyword' }],
        },
      ],
      toolCalls: [
        {
          id: 'call-1',
          name: 'search',
          arguments: '{"q":"합성"}',
          status: 'success',
          result: '결과 본문',
          executionKind: 'native',
        },
      ],
      citations: [
        { id: 'source-1', filePath: 'Notes/A.md', line: 4, preview: '합성 근거', status: 'verified' },
      ],
      indexedReviewNotice: '검토 범위 문서 3개',
      usageSnapshot: {
        requests: 2,
        reportedRequests: 2,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    });

    const trace = buildChatDebugTrace({
      message: answer,
      previousUserMessage: question,
      config,
      session: { filePath: 'Chats/합성.md', title: '합성 세션' },
      now: Date.parse('2026-05-16T01:00:00.000Z'),
    });

    expect(trace.version).toBe(1);
    expect(trace.input.question).toBe('질의 본문');
    expect(trace.config.rag.embeddingProvider).toBe('ternlight');
    expect(trace.retrieval.queries[0]?.diagnostics[0]?.durationMs).toBe(12);
    expect(trace.retrieval.providerSummary).toHaveLength(1);
    expect(trace.tools[0]?.name).toBe('search');
    expect(trace.tools[0]?.resultChars).toBe(5);
    expect(trace.llm.usage?.totalTokens).toBe(120);
    expect(trace.answerBasis.noCitations).toBe(false);
    expect(trace.answerBasis.hasCoverageNotice).toBe(true);
    expect(trace.generatedAt).toBe('2026-05-16T01:00:00.000Z');
  });

  it('후보 0건의 원인을 리뷰 진단과 함께 남긴다', () => {
    const phases = {
      inventory: { durationMs: 1, requests: 0, reportedRequests: 0 },
      search: { durationMs: 9, requests: 0, reportedRequests: 0 },
      map: { durationMs: 0, requests: 0, reportedRequests: 0 },
      screen: { durationMs: 0, requests: 0, reportedRequests: 0 },
      extract: { durationMs: 0, requests: 0, reportedRequests: 0 },
      reduce: { durationMs: 0, requests: 0, reportedRequests: 0 },
      answer: { durationMs: 0, requests: 0, reportedRequests: 0 },
    };
    const trace = buildChatDebugTrace({
      message: createMessage({
        indexedReviewDiagnostics: {
          phases,
          counts: {
            candidateSegments: 0,
            screenAcceptedSegments: 0,
            extractedSegments: 0,
            screenRetries: 0,
            extractRetries: 0,
            splitBatches: 0,
            reduceRequests: 0,
            cacheHits: 0,
          },
          outcome: 'no-evidence',
          search: {
            candidateDepth: 0,
            candidateDocuments: 0,
            candidateChunks: 0,
            selectedDocuments: 0,
            selectedChunks: 0,
            truncated: false,
            droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
            unmatchedTerms: Array.from({ length: 60 }, (_, index) => `합성토큰${index}`),
            missingCandidatePaths: 0,
            zeroHitReason: 'no-lexical-match',
          },
        },
      }),
      config,
    });

    expect(trace.review?.outcome).toBe('no-evidence');
    expect(trace.review?.search?.zeroHitReason).toBe('no-lexical-match');
    expect(trace.review?.search?.unmatchedTerms).toHaveLength(40);
    expect(trace.review?.search?.droppedDocuments.filtered).toBe(0);
  });

  it('인용이 없으면 근거 없음 신호를 남긴다', () => {
    const trace = buildChatDebugTrace({ message: createMessage(), config });
    expect(trace.answerBasis.noCitations).toBe(true);
    expect(trace.input.question).toBeUndefined();
    expect(trace.retrieval.queries).toEqual([]);
  });

  it('비밀값 패턴을 지운다', () => {
    const redacted = redactTraceText(
      'key sk-abcdefghijk123 token: abcdefgh12345 Authorization: Bearer abcdefghijklmnop',
    );
    expect(redacted).not.toContain('sk-abcdefghijk123');
    expect(redacted).not.toContain('abcdefghijklmnop');
    expect(redacted).toContain('[redacted]');
  });

  it('저장 형식에서 같은 문서를 다시 읽는다', () => {
    const trace = buildChatDebugTrace({ message: createMessage(), config });
    const section = formatChatDebugTraceSection(trace);
    expect(section[1]).toBe(CHAT_DEBUG_TRACE_HEADING);
    const parsed = extractChatDebugTrace(section.join('\n'));
    expect(parsed?.version).toBe(trace.version);
    expect(parsed?.turn.messageId).toBe('msg-trace');
  });

  it('펜스를 닫는 백틱이 본문에 있어도 추적 문서를 다시 읽는다', () => {
    const trace = buildChatDebugTrace({
      message: createMessage({
        toolCalls: [
          {
            id: 'call-2',
            name: 'shell',
            arguments: '{}',
            status: 'success',
            resultSummary: '```json\n{}\n```',
          },
        ],
      }),
      config,
    });
    const content = formatChatDebugTraceSection(trace).join('\n');
    const parsed = extractChatDebugTrace(content);
    expect(parsed?.tools[0]?.resultSummary).toBe('```json\n{}\n```');
  });

  it('추적이 없으면 null을 돌려준다', () => {
    expect(extractChatDebugTrace('본문만 있는 문서')).toBeNull();
  });
});
