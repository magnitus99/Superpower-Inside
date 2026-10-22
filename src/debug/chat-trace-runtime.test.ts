import { describe, expect, it } from 'vitest';
import { buildChatTraceRuntimeSnapshot } from './chat-trace-runtime';

describe('buildChatTraceRuntimeSnapshot', () => {
  it('색인 진행과 마지막 결과를 축약한다', () => {
    const snapshot = buildChatTraceRuntimeSnapshot({
      manifest: { version: '3.3.1' },
      ragIndexingStatus: {
        running: true,
        phase: 'indexing',
        queuedFiles: 12,
        lastResult: { indexed: 40, vectors: 400 },
      },
      bm25Index: { isReady: true },
    });
    expect(snapshot.pluginVersion).toBe('3.3.1');
    expect(snapshot.indexing).toEqual({
      running: true,
      phase: 'indexing',
      queuedFiles: 12,
      lastIndexed: 40,
      lastVectors: 400,
    });
    expect(snapshot.bm25).toEqual({ ready: true });
  });

  it('상태가 없으면 실행 중이 아닌 빈 색인 상태를 남긴다', () => {
    const snapshot = buildChatTraceRuntimeSnapshot({});
    expect(snapshot.indexing.running).toBe(false);
    expect(snapshot.indexing.lastIndexed).toBeUndefined();
    expect(snapshot.bm25).toBeUndefined();
    expect(snapshot.mcp).toEqual([]);
  });

  it('MCP 연결 상태를 읽고, 알 수 없으면 unknown으로 남긴다', () => {
    const snapshot = buildChatTraceRuntimeSnapshot({
      settings: { mcpServers: [{ name: 'files' }, { name: 'web' }] },
      mcpRegistry: { getConnectionStatus: (name) => (name === 'files' ? 'ready' : 'error') },
    });
    expect(snapshot.mcp).toEqual([
      { name: 'files', status: 'ready' },
      { name: 'web', status: 'error' },
    ]);
    const withoutRegistry = buildChatTraceRuntimeSnapshot({
      settings: { mcpServers: [{ name: 'files' }] },
    });
    expect(withoutRegistry.mcp).toEqual([{ name: 'files', status: 'unknown' }]);
  });

  it('MCP 서버는 20개까지만 기록한다', () => {
    const servers = Array.from({ length: 25 }, (_, index) => ({ name: `server-${index}` }));
    const snapshot = buildChatTraceRuntimeSnapshot({ settings: { mcpServers: servers } });
    expect(snapshot.mcp).toHaveLength(20);
  });
});
