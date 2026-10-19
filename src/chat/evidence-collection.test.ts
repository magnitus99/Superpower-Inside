import { describe, expect, it, vi } from 'vitest';
import type { NativeVaultToolRuntimeLike } from '../agent/native-vault-tool';
import { createNativeVaultToolDefinitions } from '../agent/native-vault-tool';
import { appendAssistantToolRound, collectToolCitations } from './tool-execution';
import { collectVaultEvidence, finalizeEvidenceAnswer } from './evidence-collection';

function runtime(empty = false) {
  return {
    isNativeTool: () => true,
    execute: vi.fn((raw: string, _signal?: AbortSignal, name?: string) => {
      const args = JSON.parse(raw) as {
        query?: string;
        path: string;
        start_line?: number;
        end_line?: number;
      };
      const action = name?.replace('superpower_inside_', '');
      const paths = empty
        ? []
        : args.query?.includes('rare failure')
          ? ['Research/Exception.md']
          : args.query?.includes('glass') && !args.query.includes('copper')
            ? ['Research/Glass.md']
            : ['Research/Copper.md', 'Research/Copper-alt.md'];
      const citations =
        action === 'read'
          ? [
              {
                id: `vault:${args.path}:1-20`,
                filePath: args.path,
                line: 1,
                endLine: 20,
                preview: '합성 원문과 조건·예외',
                status: 'verified' as const,
              },
            ]
          : [];
      return Promise.resolve({
        displayText: '합성 도구 결과',
        modelText: JSON.stringify(
          action === 'read'
            ? {
                action,
                citations,
                path: args.path,
                startLine: 1,
                endLine: 20,
                totalLines: 20,
                content: '합성 원문과 조건·예외',
                truncated: false,
              }
            : {
                action,
                citations,
                query: args.query ?? 'synthetic',
                queries: [args.query ?? 'synthetic'],
                path: args.path ?? '',
                match: 'any',
                scannedFiles: paths.length,
                unreadableFiles: 0,
                totalHits: paths.length,
                hits: paths.map((path) => ({
                  path,
                  startLine: 12,
                  endLine: 14,
                  preview: '합성 검색 원문',
                  citationStatus: 'verified',
                })),
                truncated: true,
              },
        ),
        citations,
      });
    }),
  };
}

function collect(nativeTool: NativeVaultToolRuntimeLike, signal?: AbortSignal) {
  let sequence = 0;
  return collectVaultEvidence({
    question: 'Compare copper storage and glass queue latency',
    scopes: ['Research'],
    nativeTool,
    createId: () => `evidence-${++sequence}`,
    signal,
  });
}

describe('모델과 독립적인 원문 수집', () => {
  it('엔진 계획만으로 원문 수집을 끝내고 모델 판정 필드를 만들지 않는다', async () => {
    const result = await collect(runtime());
    expect(result.plan.done).toBe(true);
    expect(['exhausted', 'no-progress', 'no-evidence']).toContain(result.plan.reason);
    expect(result.plan.coverage).toBe('unreviewed');
    expect(result.plan.verifiedSources).toBeGreaterThan(0);
    expect('reviewRequests' in result).toBe(false);
    expect(result.toolCalls.length).toBeLessThanOrEqual(result.plan.maxCalls);
  });

  it('응답하지 않는 도구도 전체 시간 한도에서 닫고 늦은 결과를 무시한다', async () => {
    vi.useFakeTimers();
    try {
      const tool = runtime();
      tool.execute = vi.fn(() => new Promise(() => {}));
      const pending = collect(tool);
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;
      expect(result.plan.reason).toBe('time-budget');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].status).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('모델 호출 없이 비교 구절별 검색과 양쪽 원문의 주변 문맥을 확보한다', async () => {
    const first = await collect(runtime());
    const second = await collect(runtime());
    expect(first.toolCalls.map(({ name, arguments: args }) => [name, args])).toEqual(
      second.toolCalls.map(({ name, arguments: args }) => [name, args]),
    );
    const reads = first.toolCalls.filter((call) => call.name.endsWith('_read'));
    expect(reads.map((call) => (JSON.parse(call.arguments) as { path: string }).path)).toContain(
      'Research/Glass.md',
    );
    expect(reads.map((call) => (JSON.parse(call.arguments) as { path: string }).path)).toContain(
      'Research/Copper.md',
    );
    expect(JSON.parse(reads[0].arguments)).toMatchObject({ start_line: 4, end_line: 30 });
    expect(first.toolCalls.every((call) => call.executionKind === 'native' && call.approved)).toBe(
      true,
    );
    expect(first.plan.verifiedSources).toBe(3);
    expect(collectToolCitations([], first.toolCalls)).toHaveLength(3);
    for (const protocol of ['native', 'compatibility'] as const) {
      const messages = appendAssistantToolRound(
        [{ role: 'user', content: '합성 질문' }],
        '',
        first.toolCalls,
        protocol,
      );
      // 새 plan 계약은 원문을 읽은 뒤 범위 검색으로 관련 출처를 더 찾을 수 있으므로,
      // 마지막 메시지가 아니라 라운드 안에 검증된 원문 내용이 전달됐는지 확인한다.
      expect(messages.some((message) => message.content.includes('합성 원문과 조건·예외'))).toBe(
        true,
      );
    }
  });

  it('빈 검색을 모델에게 무한 재시도시키지 않는다', async () => {
    const tool = runtime(true);
    const result = await collect(tool);
    expect(result.plan.reason).toBe('no-evidence');
    expect(result.plan.verifiedSources).toBe(0);
    expect(result.toolCalls.length).toBeLessThanOrEqual(4);
    expect(result.toolCalls.every((call) => call.name.endsWith('_search'))).toBe(true);
  });

  it('실패가 연속되면 수집을 닫고 성공한 근거로 세지 않는다', async () => {
    const tool = runtime();
    tool.execute = vi.fn().mockRejectedValue(new Error('합성 읽기 오류'));
    const result = await collect(tool);
    expect(result.plan.reason).toBe('failed');
    expect(result.plan.verifiedSources).toBe(0);
    expect(result.toolCalls).toHaveLength(2);
  });

  it('취소되면 다음 검색을 실행하지 않는다', async () => {
    const tool = runtime();
    const controller = new AbortController();
    controller.abort();
    await expect(collect(tool, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('잘못된 범위는 I/O 전에 실패한다', async () => {
    const tool = runtime();
    await expect(
      collectVaultEvidence({
        question: '합성 연구',
        scopes: ['../Outside'],
        nativeTool: tool,
        createId: () => 'unused',
      }),
    ).rejects.toThrow();
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('원문 연결을 빠뜨린 답변은 같은 provider로 한 번만 교정한다', async () => {
    const evidence = await collect(runtime());
    const streamChat = vi.fn<
      Parameters<typeof finalizeEvidenceAnswer>[0]['provider']['streamChat']
    >((_messages, onChunk) => {
      onChunk({
        content: '두 원문 비교 [vault:Research/Copper.md:1-20] [vault:Research/Glass.md:1-20]',
        done: true,
      });
      return Promise.resolve();
    });
    const result = await finalizeEvidenceAnswer({
      question: 'Compare copper storage and glass queue latency',
      content: '일반 지식만으로 작성한 답변',
      reasoning: '',
      contextAttachments: [
        { id: 'rag:auto', type: 'rag', name: 'auto', label: 'RAG', status: 'attached' },
      ],
      toolDefinitions: createNativeVaultToolDefinitions(),
      toolCalls: evidence.toolCalls,
      messages: appendAssistantToolRound(
        [{ role: 'user', content: '합성 질문' }],
        '',
        evidence.toolCalls,
      ),
      provider: { streamChat },
    });
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(streamChat.mock.calls[0]?.[4]).toMatchObject({ toolChoice: 'none' });
    expect(result.content).toContain('Research/Glass.md');
    expect(result.warnings).toEqual([]);
  });

  it('교정이 근거 연결을 복구하지 못해도 재귀 호출하지 않고 검토 필요를 남긴다', async () => {
    const evidence = await collect(runtime());
    const streamChat = vi.fn<
      Parameters<typeof finalizeEvidenceAnswer>[0]['provider']['streamChat']
    >((_messages, onChunk) => {
      onChunk({ content: '여전히 출처를 연결하지 못한 답변', done: true });
      return Promise.resolve();
    });
    const result = await finalizeEvidenceAnswer({
      question: '내 볼트에서 두 방식의 차이',
      content: '첫 답변',
      reasoning: '',
      contextAttachments: [],
      toolDefinitions: [
        {
          type: 'function',
          function: { name: 'superpower_inside_search', description: '', parameters: {} },
        },
      ],
      toolCalls: evidence.toolCalls,
      messages: [],
      provider: { streamChat },
    });
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.label).toBe('내 볼트에서 두 방식의 차이');
  });
});
