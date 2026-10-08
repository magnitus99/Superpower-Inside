import { describe, expect, it, vi } from 'vitest';
import { buildPluginAwareDocumentation } from './plugin-aware-docs';
import type { MCPToolClientLike } from './mcp-tool-execution';

const plugins = [{ id: 'sample-query', name: 'Sample Query', version: '1.2.3' }];
const resolved = {
  content: [
    {
      type: 'text',
      text: '- Title: Sample Query\n- Context7-compatible library ID: /author/sample-query\n- Description: Obsidian query plugin',
    },
  ],
};
const docs = {
  content: [{ type: 'text', text: 'Source: https://example.com/docs\nSAMPLE_QUERY scope="notes"' }],
};
function options() {
  const client = {
    listTools: vi.fn().mockResolvedValue([{ name: 'resolve-library-id' }, { name: 'query-docs' }]),
    callTool: vi
      .fn<MCPToolClientLike['callTool']>()
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce(docs),
  };
  return {
    enabled: true,
    question: 'Sample Query로 목록을 만들어줘',
    previousQuestions: [],
    plugins,
    registry: {
      getEnabledServers: () => [{ name: 'context7', command: 'npx' }],
      getConnectionStatus: () => 'connected' as const,
      getClient: () => client,
    },
    client,
    approve: vi.fn().mockResolvedValue(true),
    executionMode: 'mentioned-auto' as const,
  };
}

describe('모델에 의존하지 않는 플러그인 문서 준비', () => {
  it('모델 호출 전에 resolve와 문서 조회를 순서대로 실행하고 근거를 제공한다', async () => {
    const input = options();
    const result = await buildPluginAwareDocumentation(input);
    expect(input.client.callTool.mock.calls.map((call) => call[0])).toEqual([
      'resolve-library-id',
      'query-docs',
    ]);
    expect(input.client.callTool.mock.calls[1]?.[1]).toMatchObject({
      libraryId: '/author/sample-query',
    });
    expect(result?.prompt).toContain('SAMPLE_QUERY');
    expect(result?.prompt).toContain('1.2.3');
    expect(result?.attachments[0]?.status).toBe('attached');
    expect(result?.serverNames).toEqual(['context7']);
  });

  it('토글 꺼짐과 일반 볼트 질문은 서버 조회도 하지 않는다', async () => {
    const input = options();
    expect(await buildPluginAwareDocumentation({ ...input, enabled: false })).toBeNull();
    expect(
      await buildPluginAwareDocumentation({ ...input, question: '개발 회의를 요약해줘' }),
    ).toBeNull();
    expect(input.client.listTools).not.toHaveBeenCalled();
  });

  it('플러그인을 생략한 템플릿 후속 요청에도 직전 플러그인을 유지한다', async () => {
    const input = options();
    const result = await buildPluginAwareDocumentation({
      ...input,
      question: '그 템플릿을 수정해줘',
      previousQuestions: [input.question],
    });
    expect(result?.prompt).toContain('SAMPLE_QUERY');
  });

  it('다른 라이브러리만 반환되면 문법 조회를 하지 않는다', async () => {
    const input = options();
    input.client.callTool.mockReset().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '- Title: React\n- Context7-compatible library ID: /facebook/react',
        },
      ],
    });
    const result = await buildPluginAwareDocumentation(input);
    expect(input.client.callTool).toHaveBeenCalledTimes(1);
    expect(result?.attachments[0]?.status).toBe('missing');
    expect(result?.prompt).not.toContain('SAMPLE_QUERY');
  });

  it('수동 승인 거절은 조회를 막고 제한 상태를 전달한다', async () => {
    const input = options();
    const result = await buildPluginAwareDocumentation({
      ...input,
      executionMode: 'always-manual',
      approve: () => Promise.resolve(false),
    });
    expect(input.client.callTool).not.toHaveBeenCalled();
    expect(result?.attachments[0]?.status).toBe('missing');
  });

  it('연결 실패와 MCP 오류를 성공 문서로 취급하지 않는다', async () => {
    const input = options();
    const disconnected = await buildPluginAwareDocumentation({
      ...input,
      registry: { ...input.registry, getConnectionStatus: () => 'error' },
    });
    expect(disconnected?.attachments[0]?.status).toBe('error');
    input.client.callTool
      .mockReset()
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'rate limited' }] });
    const result = await buildPluginAwareDocumentation(input);
    expect(result?.attachments[0]?.status).toBe('error');
    expect(result?.prompt).not.toContain('rate limited');
  });

  it('취소 후 결과는 모델 근거로 반환하지 않는다', async () => {
    const input = options();
    const controller = new AbortController();
    input.client.callTool.mockReset().mockImplementation(() => {
      controller.abort();
      return Promise.resolve(resolved);
    });
    await expect(
      buildPluginAwareDocumentation({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('빈 문서는 생성을 차단하고 긴 문서는 예산 안에서 제공한다', async () => {
    const input = options();
    input.client.callTool
      .mockReset()
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce({ content: [] });
    expect((await buildPluginAwareDocumentation(input))?.failureMessage).toBeTruthy();
    input.client.callTool
      .mockReset()
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '문서'.repeat(10000) }] });
    const result = await buildPluginAwareDocumentation(input);
    expect(result?.failureMessage).toBeUndefined();
    expect(result?.attachments[0]?.status).toBe('partial');
    expect(result?.attachments[0]?.actualChars).toBeLessThan(8192);
  });

  it('조회 상한을 넘으면 일부 플러그인을 조용히 누락하지 않는다', async () => {
    const input = options();
    const result = await buildPluginAwareDocumentation({
      ...input,
      question: '활성 플러그인으로 코드를 만들어줘',
      plugins: Array.from({ length: 4 }, (_, index) => ({ id: `sample-${index}` })),
    });
    expect(result?.failureMessage).toBeTruthy();
    expect(input.client.callTool).not.toHaveBeenCalled();
  });

  it('오류 플래그가 없는 조회 한도 응답도 생성을 차단하고 원인을 표시한다', async () => {
    const input = options();
    input.client.callTool
      .mockReset()
      .mockResolvedValue({ content: [{ type: 'text', text: 'Monthly quota exceeded.' }] });
    const result = await buildPluginAwareDocumentation(input);
    expect(result?.failureMessage).toBeTruthy();
    expect(result?.attachments[0]?.detail).toContain('Monthly quota exceeded.');
    expect(input.client.callTool).toHaveBeenCalledTimes(1);
  });

  it('구조화된 라이브러리 검색 결과도 문서 조회에 사용한다', async () => {
    const input = options();
    input.client.callTool
      .mockReset()
      .mockResolvedValueOnce({
        structuredContent: {
          results: [
            { title: 'Sample Query for Obsidian', id: '/author/sample-query' },
            { title: 'Sample Query', id: '/websites/sample-query' },
          ],
        },
      })
      .mockResolvedValueOnce(docs);
    const result = await buildPluginAwareDocumentation(input);
    expect(result?.failureMessage).toBeUndefined();
    expect(input.client.callTool.mock.calls[1]?.[1]).toMatchObject({
      libraryId: '/author/sample-query',
    });
  });

  it('취소를 무시하는 서버도 시간 초과 후 생성을 차단한다', async () => {
    vi.useFakeTimers();
    try {
      const input = options();
      input.client.callTool.mockReset().mockImplementation(() => new Promise(() => undefined));
      const pending = buildPluginAwareDocumentation(input);
      await vi.advanceTimersByTimeAsync(10001);
      expect((await pending)?.failureMessage).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
