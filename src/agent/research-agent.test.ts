import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../llm/providers';
import { setLanguage } from '../i18n';
import type {
  NativeVaultToolExecutionResult,
  NativeVaultToolRuntimeLike,
} from './native-vault-tool';
import type { VaultResearchCache, VaultResearchCacheKey } from './research-cache';
import {
  VaultResearchAgent,
  getVaultResearchPhaseLabel,
  isWholeVaultResearchRequest,
  type VaultResearchModel,
} from './research-agent';

describe('계층형 Vault Research Agent', () => {
  it('내부 phase 이름을 사용자 작업 언어로 표시한다', () => {
    setLanguage('ko');
    expect(getVaultResearchPhaseLabel('inventory')).toBe('문서 확인');
    expect(getVaultResearchPhaseLabel('map')).toBe('문서 읽기');
    expect(getVaultResearchPhaseLabel('reduce')).toBe('내용 종합');
    setLanguage('en');
    expect(getVaultResearchPhaseLabel('map')).toBe('Reading documents');
    setLanguage('ko');
  });

  it('명시적인 볼트 전체 요약과 전수 조사를 research workflow로 분류한다', () => {
    expect(isWholeVaultResearchRequest('이 옵시디언 볼트를 요약해줘')).toBe(true);
    expect(
      isWholeVaultResearchRequest('볼트 내에서 genesis와 관련된 모든 것들을 조사하면 되지 않아?'),
    ).toBe(true);
    expect(isWholeVaultResearchRequest('Alpha 노트의 고객 문제는 뭐야?')).toBe(false);
  });

  it('모든 문서를 읽어 개별 요약 후 최종 답변과 출처를 만든다', async () => {
    const execute = vi.fn((argumentsText: string) => executeVaultTool(argumentsText));
    const runtime: NativeVaultToolRuntimeLike = {
      isNativeTool: () => true,
      execute,
    };
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve('볼트 전체 요약 [vault:Alpha.md:1-1]');
      }
      if (prompt.includes('Alpha 내용')) return Promise.resolve('Alpha 핵심 [vault:Alpha.md:1-1]');
      return Promise.resolve('Beta 핵심 [vault:Beta.md:1-1]');
    });
    const model: VaultResearchModel = { chat };
    const progress = vi.fn();

    const result = await new VaultResearchAgent(model, runtime).run({
      question: '이 볼트를 요약해줘',
      onProgress: progress,
    });

    const readCalls = execute.mock.calls
      .map(([argumentsText]) => JSON.parse(argumentsText) as { action?: string; path?: string })
      .filter((request) => request.action === 'read');
    expect(readCalls).toEqual([
      expect.objectContaining({ path: 'Alpha.md' }),
      expect.objectContaining({ path: 'Beta.md' }),
    ]);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('볼트 전체 요약');
    expect(result.citations.map((citation) => citation.filePath)).toEqual(['Alpha.md']);
    expect(result).toMatchObject({ processedFiles: 2, totalFiles: 2, failedFiles: [] });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'complete', completedFiles: 2, totalFiles: 2 }),
    );
  });

  it('개별 문서 읽기 실패를 격리하고 답변에 누락 범위를 강제로 표시한다', async () => {
    setLanguage('ko');
    const execute = vi.fn((argumentsText: string) => {
      const request = JSON.parse(argumentsText) as { action?: string; path?: string };
      if (request.action === 'read' && request.path === 'Beta.md') {
        return Promise.reject(new Error('adapter read failure'));
      }
      return executeVaultTool(argumentsText);
    });
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      return Promise.resolve(
        prompt.includes('Write the final answer')
          ? '읽은 문서의 최종 요약 [vault:Alpha.md:1-1]'
          : 'Alpha 핵심 [vault:Alpha.md:1-1]',
      );
    });

    const result = await new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute },
    ).run({ question: '볼트 전체를 요약해줘' });

    expect(result).toMatchObject({
      processedFiles: 1,
      totalFiles: 2,
      failedFiles: ['Beta.md'],
    });
    expect(result.content).toContain('전체 2개 문서 중 1개를 읽었습니다');
    expect(chat.mock.calls.at(-1)?.[0].at(-1)?.content).toContain('Coverage gaps: Beta.md');
  });

  it('일시적인 provider 실패를 제한적으로 재시도한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    let failed = false;
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      if (!failed) {
        failed = true;
        return Promise.reject(createProviderError('rate limited', 429, 25));
      }
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve('최종 요약 [vault:Alpha.md:1-1]');
      }
      return Promise.resolve('문서 요약 [vault:Alpha.md:1-1]');
    });

    const result = await new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute: executeVaultTool },
      { wait },
    ).run({ question: '볼트 전체를 요약해줘' });

    expect(result.processedFiles).toBe(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait.mock.calls[0]?.[0]).toBe(500);
    expect(wait.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('인증 오류는 재시도하지 않고 즉시 전달한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const chat = vi.fn(() =>
      Promise.reject(createProviderError('invalid api key', 401)),
    );
    const agent = new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute: executeVaultTool },
      { wait },
    );

    await expect(agent.run({ question: '볼트 전체를 요약해줘' })).rejects.toMatchObject({
      status: 401,
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it('동일 문서·질문·모델의 파일 요약은 캐시에서 출처와 함께 재사용한다', async () => {
    const execute = vi.fn((argumentsText: string) => executeVaultTool(argumentsText));
    const values = new Map<string, { content: string; citations: NativeVaultToolExecutionResult['citations'] }>();
    const cache: VaultResearchCache = {
      get: (key) => Promise.resolve(values.get(cacheKey(key)) ?? null),
      put: (key, value) => {
        values.set(cacheKey(key), value);
        return Promise.resolve();
      },
      close: () => undefined,
    };
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      return Promise.resolve(
        prompt.includes('Write the final answer')
          ? '최종 요약 [vault:Alpha.md:1-1]'
          : '문서 요약 [vault:Alpha.md:1-1]',
      );
    });
    const agent = new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute },
      { cache },
    );

    await agent.run({ question: '볼트를 요약해줘', cacheNamespace: 'openai:gpt' });
    await agent.run({ question: '볼트를 요약해줘', cacheNamespace: 'openai:gpt' });

    const readCalls = execute.mock.calls.filter(([argumentsText]) => {
      const request = JSON.parse(argumentsText) as { action?: string };
      return request.action === 'read';
    });
    expect(readCalls).toHaveLength(2);
    expect(chat).toHaveBeenCalledTimes(4);
  });

  it('문서 map 요청은 최대 2개까지만 동시에 실행한다', async () => {
    let active = 0;
    let maxActive = 0;
    const paths = ['Alpha.md', 'Beta.md', 'Gamma.md', 'Delta.md'];
    const execute = (argumentsText: string): Promise<NativeVaultToolExecutionResult> => {
      const request = JSON.parse(argumentsText) as { action: string; path?: string };
      if (request.action === 'stats') {
        return Promise.resolve(result({ action: 'stats', fileCount: 4, citations: [] }));
      }
      if (request.action === 'list') {
        return Promise.resolve(
          result({
            action: 'list',
            files: paths.map((path) => ({ path, modifiedAt: 1, size: 10 })),
            nextCursor: null,
            total: 4,
            citations: [],
          }),
        );
      }
      return executeVaultTool(argumentsText);
    };
    const chat = vi.fn(async (messages: ChatMessage[]) => {
      const prompt = messages.at(-1)?.content ?? '';
      if (prompt.includes('Write the final answer')) return '최종 요약';
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return '문서 요약';
    });

    await new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute },
    ).run({ question: '볼트를 요약해줘' });

    expect(maxActive).toBe(2);
  });

  it('취소 신호가 이미 중단됐으면 도구나 모델을 호출하지 않는다', async () => {
    const execute = vi.fn(() => Promise.reject(new Error('호출되면 안 됨')));
    const chat = vi.fn(() => Promise.reject(new Error('호출되면 안 됨')));
    const controller = new AbortController();
    controller.abort();
    const agent = new VaultResearchAgent(
      { chat },
      { isNativeTool: () => true, execute },
    );

    await expect(
      agent.run({ question: '볼트 전체를 요약해줘', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
});

function executeVaultTool(argumentsText: string): Promise<NativeVaultToolExecutionResult> {
  const request = JSON.parse(argumentsText) as {
    action: string;
    path?: string;
    cursor?: number;
  };
  if (request.action === 'stats') {
    return Promise.resolve(result({ action: 'stats', fileCount: 2, totalBytes: 20, citations: [] }));
  }
  if (request.action === 'list') {
    return Promise.resolve(
      result({
        action: 'list',
        path: '',
        files: [
          { path: 'Alpha.md', modifiedAt: 1, size: 10 },
          { path: 'Beta.md', modifiedAt: 1, size: 10 },
        ],
        nextCursor: null,
        total: 2,
        citations: [],
      }),
    );
  }
  const path = request.path ?? '';
  const citation = {
    id: `vault:${path}:1-1`,
    filePath: path,
    line: 1,
    endLine: 1,
    preview: `${path} 내용`,
    status: 'verified' as const,
  };
  return Promise.resolve(
    result({
      action: 'read',
      path,
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      truncated: false,
      content: path === 'Alpha.md' ? 'Alpha 내용' : 'Beta 내용',
      citations: [citation],
    }),
  );
}

function result<T extends { citations: NativeVaultToolExecutionResult['citations'] }>(
  payload: T,
): NativeVaultToolExecutionResult {
  return {
    displayText: 'ok',
    modelText: JSON.stringify(payload),
    citations: payload.citations,
  };
}

function createProviderError(message: string, status: number, retryAfterMs?: number): Error {
  return Object.assign(new Error(message), { status, retryAfterMs });
}

function cacheKey(key: VaultResearchCacheKey): string {
  return JSON.stringify(key);
}
