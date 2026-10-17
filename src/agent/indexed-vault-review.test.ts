import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider } from '../llm/providers';
import type { NativeVaultToolRuntimeLike } from './native-vault-tool';
import { reviewIndexedVault } from './indexed-vault-review';

function fixture(count: number) {
  const files = new Map(
    Array.from({ length: count }, (_, index) => [
      `Synthetic/Source-${index}.txt`,
      index === count - 1
        ? 'Quartz restarts only after two cooling cycles.'
        : `Delivery schedule ${index}.`,
    ]),
  );
  const execute = vi.fn<NativeVaultToolRuntimeLike['execute']>((raw) => {
    const request = JSON.parse(raw) as {
      action: string;
      path?: string;
      cursor?: number;
      limit?: number;
    };
    const paths = [...files.keys()];
    const cursor = request.cursor ?? 0;
    const end = Math.min(paths.length, cursor + (request.limit ?? 100));
    const payload =
      request.action === 'list'
        ? {
            action: 'list',
            files: paths.slice(cursor, end).map((path) => ({ path })),
            total: paths.length,
            nextCursor: end < paths.length ? end : null,
          }
        : request.action === 'search'
          ? { action: 'search', hits: [{ path: paths[0] }], totalHits: 1 }
          : {
              action: 'read',
              path: request.path,
              content: files.get(request.path ?? ''),
              startLine: 1,
              endLine: 1,
              totalLines: 1,
              truncated: false,
            };
    return Promise.resolve({ displayText: '', modelText: JSON.stringify(payload), citations: [] });
  });
  const reviewed: string[] = [];
  const reviewedText: string[] = [];
  const streamChat = vi.fn(
    (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      const body = messages.at(-1)?.content ?? '';
      let packet:
        | { segments?: { id: string; path: string; text: string }[]; evidence?: string[] }
        | undefined;
      try {
        packet = JSON.parse(body) as typeof packet;
      } catch {
        /* 최종 합성은 JSON 입력이 아닙니다. */
      }
      if (packet?.segments) {
        reviewed.push(...packet.segments.map((row) => row.path));
        reviewedText.push(...packet.segments.map((row) => row.text));
        consume({
          content: JSON.stringify({
            decisions: packet.segments.map((row) => ({
              id: row.id,
              relevant: row.text.includes('Quartz'),
              reason: row.text.includes('Quartz')
                ? 'Restart condition.'
                : 'Only a delivery schedule.',
              findings: row.text.includes('Quartz')
                ? [{ claim: 'Wait two cooling cycles.', quote: 'two cooling cycles' }]
                : [],
            })),
          }),
        });
      } else {
        const sources = (packet?.evidence ?? []).flatMap((text) => {
          try {
            return (JSON.parse(text) as { sourceId: string }[]).map((row) => row.sourceId);
          } catch {
            return [];
          }
        });
        consume({
          content: JSON.stringify({
            paragraphs: [
              {
                text: '두 번 냉각한 뒤 재시작합니다.',
                sources: sources.slice(-1),
              },
            ],
          }),
        });
      }
      return Promise.resolve();
    },
  );
  return {
    files,
    execute,
    reviewed,
    reviewedText,
    streamChat,
    nativeTool: { execute, isNativeTool: () => true },
  };
}

describe('임베딩 문서 전체 검토', () => {
  it('한 문서를 읽지 못해도 나머지 전체를 검토하고 완료 답변은 차단한다', async () => {
    const test = fixture(20);
    const original = test.execute.getMockImplementation()!;
    test.execute.mockImplementation((raw, signal, name) => {
      const request = JSON.parse(raw) as { action: string; path?: string };
      if (request.action === 'read' && request.path === 'Synthetic/Source-0.txt')
        return Promise.reject(new Error('Synthetic read failure.'));
      return original(raw, signal, name);
    });
    await expect(
      reviewIndexedVault({
        question: 'Quartz restart condition',
        indexedPaths: [...test.files.keys()],
        scopes: [],
        nativeTool: test.nativeTool,
        provider: { streamChat: test.streamChat },
      }),
    ).rejects.toThrow();
    const reads = test.execute.mock.calls
      .map(([raw]) => JSON.parse(raw) as { action: string; path?: string })
      .filter((request) => request.action === 'read');
    expect(reads).toHaveLength(20);
    expect(new Set(test.reviewed).size).toBe(19);
    expect(
      test.streamChat.mock.calls.every(([messages]) => {
        const packet: unknown = JSON.parse(messages.at(-1)?.content ?? '{}');
        return packet !== null && typeof packet === 'object' && Object.hasOwn(packet, 'segments');
      }),
    ).toBe(true);
  });

  it('관련 근거가 많은 검토 묶음도 개별 근거로 나눠 문맥 예산 안에서 통합한다', async () => {
    const test = fixture(8);
    const quote = 'Synthetic evidence. '.repeat(40);
    for (const path of test.files.keys()) test.files.set(path, quote);
    const streamChat: LLMProvider['streamChat'] = (messages, consume) => {
      const packet = JSON.parse(messages.at(-1)?.content ?? '{}') as {
        segments?: { id: string; text: string }[];
      };
      const content = packet.segments
        ? JSON.stringify({
            decisions: packet.segments.map((row) => ({
              id: row.id,
              relevant: true,
              reason: '질문과 관련된 합성 근거입니다.',
              findings: Array.from({ length: 8 }, () => ({
                claim: '합성 근거에 명시된 조건입니다. '.repeat(30),
                quote: row.text,
              })),
            })),
          })
        : messages[0]?.content.includes('"paragraphs"')
          ? JSON.stringify({
              paragraphs: [
                {
                  text: '원문에 명시된 조건을 적용합니다.',
                  sources: ['vault:Synthetic/Source-0.txt:1-1'],
                },
              ],
            })
          : '합성 조건 [vault:Synthetic/Source-0.txt:1-1]';
      consume({ content, done: true });
      return Promise.resolve();
    };
    const result = await reviewIndexedVault({
      question: '합성 조건은 무엇인가?',
      indexedPaths: [...test.files.keys()],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat },
    });
    expect(result.processedFiles).toBe(8);
    expect(result.rejectedFiles).toBe(0);
    expect(result.content).toContain('[vault:Synthetic/Source-0.txt:1-1]');
  });

  it('모델 한도를 모를 때도 공통 입력 예산으로 긴 다국어 문서 전체를 나누어 검토한다', async () => {
    const test = fixture(1);
    const lines = Array.from(
      { length: 1000 },
      (_, index) => `합성 고유 기록 ${index}: 배송 일정과 문서 정리 상태입니다.`,
    );
    test.files.set(
      'Synthetic/Source-0.txt',
      lines.join('\n') + '\nQuartz requires two cooling cycles.',
    );
    const result = await reviewIndexedVault({
      question: 'Quartz restart condition',
      indexedPaths: [...test.files.keys()],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat: test.streamChat },
    });
    expect(test.reviewed.length).toBeGreaterThan(1);
    expect(lines.every((line) => test.reviewedText.some((text) => text.includes(line)))).toBe(true);
    expect(result.processedFiles).toBe(1);
    expect(result.citations).toHaveLength(1);
  });
  it('긴 원문의 후반 구간과 한 줄 중간의 이어 읽기를 생략하지 않는다', async () => {
    const test = fixture(1);
    const original = test.execute.getMockImplementation()!;
    test.execute.mockImplementation((raw, signal, name) => {
      const args = JSON.parse(raw) as { action: string; start_offset?: number };
      if (args.action !== 'read') return original(raw, signal, name);
      const continued = args.start_offset === 20000;
      return Promise.resolve({
        displayText: '',
        citations: [],
        modelText: JSON.stringify({
          action: 'read',
          path: 'Synthetic/Source-0.txt',
          startLine: 1,
          endLine: 1,
          startOffset: continued ? 20000 : 0,
          totalLines: 1,
          content: continued
            ? 'Quartz requires two cooling cycles.'
            : 'Unrelated background. '.repeat(1000),
          truncated: !continued,
          nextStartLine: continued ? null : 1,
          nextStartOffset: continued ? null : 20000,
        }),
      });
    });
    const result = await reviewIndexedVault({
      question: 'Quartz restart condition',
      indexedPaths: [...test.files.keys()],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat: test.streamChat },
    });
    expect(test.reviewed.length).toBeGreaterThan(1);
    expect(
      test.execute.mock.calls.some(
        ([raw]) => (JSON.parse(raw) as { start_offset?: number }).start_offset === 20000,
      ),
    ).toBe(true);
    expect(result.content).toContain('[vault:Synthetic/Source-0.txt:1-1]');
  });

  it('관련 문서가 없으면 전체를 제외한 뒤 일반 지식 답변을 생성하지 않는다', async () => {
    const test = fixture(10);
    test.files.set('Synthetic/Source-9.txt', 'Another delivery schedule.');
    const result = await reviewIndexedVault({
      question: 'Quartz restart condition',
      indexedPaths: [...test.files.keys()],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat: test.streamChat },
    });
    expect(result.rejectedFiles).toBe(10);
    expect(result.citations).toEqual([]);
    expect(test.streamChat).toHaveBeenCalledTimes(2);
  });

  it('취소를 무시하는 provider도 중단하고 늦은 응답으로 답변을 만들지 않는다', async () => {
    const test = fixture(1);
    const controller = new AbortController();
    const streamChat = vi.fn<LLMProvider['streamChat']>(() => {
      controller.abort();
      return new Promise<void>(() => {});
    });
    await expect(
      reviewIndexedVault({
        question: 'Quartz restart condition',
        indexedPaths: [...test.files.keys()],
        scopes: [],
        nativeTool: test.nativeTool,
        provider: { streamChat },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('상위 검색에 없는 후반 문서까지 모두 판단한 뒤 원문 인용으로 답한다', async () => {
    const test = fixture(2103);
    const result = await reviewIndexedVault({
      question: 'Quartz restart condition',
      indexedPaths: [...test.files.keys()],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat: test.streamChat },
    });
    expect(new Set(test.reviewed).size).toBe(2103);
    expect(result.processedFiles).toBe(2103);
    expect(result.rejectedFiles).toBe(2102);
    expect(result.content).toContain('[vault:Synthetic/Source-2102.txt:1-1]');
    expect(result.citations).toContainEqual(
      expect.objectContaining({
        filePath: 'Synthetic/Source-2102.txt',
        status: 'verified',
        preview: 'two cooling cycles',
      }),
    );
  });

  it('색인에 없는 파일과 범위 밖 문서는 모델에 보내지 않는다', async () => {
    const test = fixture(4);
    const result = await reviewIndexedVault({
      question: 'Quartz restart condition',
      indexedPaths: ['Synthetic/Source-3.txt'],
      scopes: [],
      nativeTool: test.nativeTool,
      provider: { streamChat: test.streamChat },
    });
    expect(test.reviewed).toEqual(['Synthetic/Source-3.txt']);
    expect(result.totalFiles).toBe(1);
  });

  it('판정 누락이나 가짜 인용을 재검토해도 복구하지 못하면 답변 생성 전에 실패한다', async () => {
    const test = fixture(2);
    const streamChat = vi.fn<LLMProvider['streamChat']>((_messages, consume) => {
      consume({ content: '{"decisions":[]}', done: true });
      return Promise.resolve();
    });
    await expect(
      reviewIndexedVault({
        question: 'Quartz restart condition',
        indexedPaths: [...test.files.keys()],
        scopes: [],
        nativeTool: test.nativeTool,
        provider: { streamChat },
      }),
    ).rejects.toThrow();
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('검토 중 취소하면 남은 문서를 읽거나 최종 답변을 생성하지 않는다', async () => {
    const test = fixture(10);
    const controller = new AbortController();
    const streamChat = vi.fn<LLMProvider['streamChat']>((_messages, consume) => {
      controller.abort();
      consume({ content: '{"decisions":[]}', done: true });
      return Promise.resolve();
    });
    await expect(
      reviewIndexedVault({
        question: 'Quartz restart condition',
        indexedPaths: [...test.files.keys()],
        scopes: [],
        nativeTool: test.nativeTool,
        provider: { streamChat },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(streamChat).toHaveBeenCalledOnce();
  });
});
