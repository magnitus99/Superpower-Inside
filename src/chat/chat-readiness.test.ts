import { describe, expect, it } from 'vitest';
import { createChatReadinessSnapshot } from './chat-readiness';

describe('chat readiness contract', () => {
  it('provider/model이 없으면 전송 차단 상태를 계산한다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 0,
      availableModelCount: 0,
      selectedModel: '',
      ragEnabled: true,
      ragReady: false,
      ragIndexing: false,
      configuredMcpServerCount: 1,
      connectedMcpServerCount: 0,
      saveFolderConfigured: true,
    });

    expect(snapshot).toMatchObject({
      status: 'blocked',
      blocksSend: true,
      primaryText: 'Provider 설정 필요',
    });
    expect(snapshot.items.find((item) => item.kind === 'provider')).toMatchObject({
      severity: 'blocking',
      action: 'configure-provider',
    });
  });

  it('RAG/MCP/save folder 문제는 degraded 상태로 묶는다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'ollama:llama3.1',
      ragEnabled: true,
      ragReady: false,
      ragIndexing: false,
      configuredMcpServerCount: 2,
      connectedMcpServerCount: 1,
      saveFolderConfigured: false,
    });

    expect(snapshot.status).toBe('degraded');
    expect(snapshot.blocksSend).toBe(false);
    expect(snapshot.items.map((item) => item.kind)).toEqual(['rag', 'mcp', 'save-folder']);
  });
});
