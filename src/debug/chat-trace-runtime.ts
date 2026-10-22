/** 추적에 남기는 런타임 상태 스냅샷입니다. 검색이 왜 비었는지 판단하는 데 씁니다. */
export interface ChatTraceRuntimeSnapshot {
  pluginVersion?: string;
  indexing: {
    running: boolean;
    phase?: string;
    queuedFiles?: number;
    lastIndexed?: number;
    lastVectors?: number;
  };
  bm25?: { ready: boolean };
  mcp: { name: string; status: string }[];
}

interface RuntimeIndexingStatus {
  running?: boolean;
  phase?: string;
  queuedFiles?: number;
  lastResult?: { indexed?: number; vectors?: number } | null;
}

/** 플러그인이 노출하는 런타임 상태만 읽습니다. 없으면 해당 항목을 비웁니다. */
export interface ChatTraceRuntimePluginLike {
  manifest?: { version?: string };
  ragIndexingStatus?: RuntimeIndexingStatus | null;
  bm25Index?: { isReady?: boolean } | null;
  settings?: { mcpServers?: readonly { name: string }[] } | null;
  mcpRegistry?: { getConnectionStatus?: (name: string) => string } | null;
}

const MAX_MCP_SERVERS = 20;

/** 저장 시점의 색인·연결 상태를 추적용으로 축약합니다. */
export function buildChatTraceRuntimeSnapshot(
  plugin: ChatTraceRuntimePluginLike,
): ChatTraceRuntimeSnapshot {
  const status = plugin.ragIndexingStatus ?? {};
  const lastResult = status.lastResult ?? {};
  const servers = (plugin.settings?.mcpServers ?? []).slice(0, MAX_MCP_SERVERS);
  return {
    pluginVersion: plugin.manifest?.version,
    indexing: {
      running: status.running === true,
      phase: status.phase,
      queuedFiles: status.queuedFiles,
      lastIndexed: lastResult.indexed,
      lastVectors: lastResult.vectors,
    },
    bm25: plugin.bm25Index ? { ready: plugin.bm25Index.isReady === true } : undefined,
    mcp: servers.map((server) => ({
      name: server.name,
      status: plugin.mcpRegistry?.getConnectionStatus?.(server.name) ?? 'unknown',
    })),
  };
}
