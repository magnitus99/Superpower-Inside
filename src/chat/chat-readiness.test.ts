import { describe, expect, it } from 'vitest';
import {
  createChatReadinessSnapshot,
  resolveChatReadinessActionButtonState,
} from './chat-readiness';

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

describe('chat readiness action button state', () => {
  it('진행 중인 액션은 다시 그려져도 로딩 상태를 유지한다', () => {
    expect(
      resolveChatReadinessActionButtonState({
        action: 'reconnect-mcp',
        pendingAction: 'reconnect-mcp',
        label: '재연결',
        loadingLabel: '재연결 중...',
      }),
    ).toEqual({ text: '재연결 중...', disabled: true, loading: true });
  });

  it('다른 액션이 진행 중이면 해당 버튼은 대기 상태를 유지한다', () => {
    expect(
      resolveChatReadinessActionButtonState({
        action: 'index-rag',
        pendingAction: 'reconnect-mcp',
        label: '문서 준비',
        loadingLabel: '인덱싱 시작',
      }),
    ).toEqual({ text: '문서 준비', disabled: false, loading: false });
  });

  it('진행 중인 액션이 없으면 기본 라벨을 표시한다', () => {
    expect(
      resolveChatReadinessActionButtonState({
        action: 'reconnect-mcp',
        pendingAction: null,
        label: '재연결',
        loadingLabel: '재연결 중...',
      }),
    ).toEqual({ text: '재연결', disabled: false, loading: false });
  });
});
