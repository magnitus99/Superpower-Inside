import type { SuperpowerInsideSettings } from '../settings';
import type { ChatTraceConfigSnapshot } from './chat-trace';

/** 설정에서 추적에 남길 검색·채팅 구성만 뽑아 스냅샷을 만듭니다. */
export function buildChatTraceConfigSnapshot(
  settings: SuperpowerInsideSettings,
): ChatTraceConfigSnapshot {
  return {
    rag: {
      chunkSize: settings.rag.chunkSize,
      overlap: settings.rag.overlap,
      embeddingProvider: settings.rag.embeddingProvider,
      embeddingModel: settings.rag.embeddingModel,
      minScore: settings.rag.minScore,
      enableBM25: settings.rag.enableBM25,
      bm25Weight: settings.rag.bm25Weight,
      annEnabled: settings.rag.annEnabled,
      structuralGraphEnabled: settings.rag.structuralGraphEnabled,
    },
    chat: {
      mcpToolExecutionPolicy: settings.chat.mcpToolExecutionPolicy,
      mcpServerCount: settings.mcpServers.length,
      pluginAwareEnabled: settings.pluginAwareEnabled,
      autoSaveEnabled: settings.chat.autoSaveEnabled,
    },
  };
}
