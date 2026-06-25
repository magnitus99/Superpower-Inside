import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import type { GraphRagStatusSummary } from './graph/status';
import type { RagStatusSummary } from './rag/status';
import {
  buildSettingsOverviewSnapshot,
  type SettingsOverviewRuntimeState,
} from './settings-overview';
import { DEFAULT_SETTINGS, type SuperpowerInsideSettings } from './settings';

function buildSettings(
  override: Partial<SuperpowerInsideSettings> = {},
): SuperpowerInsideSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...override,
    openai: { ...DEFAULT_SETTINGS.openai, ...override.openai },
    claude: { ...DEFAULT_SETTINGS.claude, ...override.claude },
    ollama: { ...DEFAULT_SETTINGS.ollama, ...override.ollama },
    ollamaCloud: { ...DEFAULT_SETTINGS.ollamaCloud, ...override.ollamaCloud },
    openRouter: { ...DEFAULT_SETTINGS.openRouter, ...override.openRouter },
    rag: { ...DEFAULT_SETTINGS.rag, ...override.rag },
    chat: { ...DEFAULT_SETTINGS.chat, ...override.chat },
    customOpenAIProviders:
      override.customOpenAIProviders ?? DEFAULT_SETTINGS.customOpenAIProviders,
    mcpServers: override.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
  };
}

function buildRuntime(
  override: Partial<SettingsOverviewRuntimeState> = {},
): SettingsOverviewRuntimeState {
  return {
    ragStatus: null,
    graphRagStatus: null,
    mcpConnectionState: 'idle',
    mcpServers: [],
    isRagIndexing: false,
    isGraphRagIndexing: false,
    hasGraphRagRunner: false,
    ...override,
  };
}

function buildRagStatus(
  override: Partial<RagStatusSummary> = {},
): RagStatusSummary {
  return {
    totalDocuments: 12,
    healthyDocuments: 12,
    missingDocuments: 0,
    staleDocuments: 0,
    unknownDocuments: 0,
    excludedDocuments: 3,
    totalVectors: 48,
    lastCalculatedAt: 1_780_371_000_000,
    updateRequiredDocuments: [],
    ...override,
  };
}

function buildGraphStatus(
  override: Partial<GraphRagStatusSummary> = {},
): GraphRagStatusSummary {
  return {
    state: 'ready',
    totalCandidateFiles: 12,
    graphEvidenceCount: 24,
    rejectedFactCount: 0,
    failedFileCount: 0,
    pendingMergeCount: 0,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun: 50,
    ...override,
  };
}

describe('설정 Overview snapshot', () => {
  it('Provider enabled/model/key 상태를 조밀한 행으로 요약한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        openai: { enabled: true, apiKey: '', models: ['gpt-4.1'] },
        claude: { enabled: true, apiKey: 'anthropic-key', models: [] },
        ollama: { enabled: true, apiKey: '', models: ['llama3.1'] },
      }),
      runtime: buildRuntime(),
    });

    expect(snapshot.providerRows).toContainEqual(
      expect.objectContaining({
        id: 'provider-openai',
        label: 'OpenAI',
        statusLabel: '키 필요',
        tone: 'danger',
      }),
    );
    expect(snapshot.providerRows).toContainEqual(
      expect.objectContaining({
        id: 'provider-claude',
        label: 'Claude',
        statusLabel: '모델 없음',
        tone: 'warning',
      }),
    );
    expect(snapshot.providerRows).toContainEqual(
      expect.objectContaining({
        id: 'provider-ollama',
        label: 'Ollama Local',
        statusLabel: '준비됨',
        tone: 'success',
      }),
    );
  });

  it('Custom OpenAI-compatible provider는 빈 API 키만으로 주의 항목이 되지 않는다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        customOpenAIProviders: [
          {
            id: 'local',
            name: 'Local Provider',
            apiKey: '',
            baseUrl: 'http://localhost:1234/v1',
            models: ['local-model'],
            enabled: true,
            useRequestUrl: true,
          },
        ],
      }),
      runtime: buildRuntime(),
    });

    expect(snapshot.providerRows).toContainEqual(
      expect.objectContaining({
        id: 'provider-custom-local',
        label: 'Local Provider',
        statusLabel: '준비됨',
        tone: 'success',
      }),
    );
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      'provider-custom-local-api-key',
    );
  });

  it('RAG stale/empty/ready 상태와 GraphRAG 상태를 요약한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        rag: {
          ...DEFAULT_SETTINGS.rag,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          graphRagEnabled: true,
          graphRagModel: 'claude:claude-3-5-sonnet-latest',
        },
      }),
      runtime: buildRuntime({
        ragStatus: buildRagStatus({
          healthyDocuments: 8,
          staleDocuments: 3,
          missingDocuments: 1,
          updateRequiredDocuments: [
            { path: 'a.md', status: 'stale', reason: '수정됨', mtime: 1, size: 1 },
            { path: 'b.md', status: 'missing', reason: '누락', mtime: 1, size: 1 },
          ],
        }),
        graphRagStatus: buildGraphStatus({ state: 'stale', staleFileCount: 2 }),
        hasGraphRagRunner: true,
      }),
    });

    expect(snapshot.rag.statusLabel).toBe('동기화 필요');
    expect(snapshot.rag.tone).toBe('warning');
    expect(snapshot.rag.detail).toContain('2개 문서');
    expect(snapshot.graphRag.statusLabel).toBe('동기화 필요');
    expect(snapshot.graphRag.tone).toBe('warning');
  });

  it('GraphRAG 빌드 허용이 꺼져 있어도 준비된 인덱스는 일반 채팅 보강 상태로 표시한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        rag: {
          ...DEFAULT_SETTINGS.rag,
          graphRagEnabled: false,
          graphRagModel: '',
        },
      }),
      runtime: buildRuntime({
        graphRagStatus: buildGraphStatus({ state: 'ready', graphEvidenceCount: 7 }),
        hasGraphRagRunner: false,
      }),
    });

    expect(snapshot.graphRag.statusLabel).toBe('최신');
    expect(snapshot.graphRag.detail).toContain('7');
    expect(snapshot.graphRag.tone).toBe('success');
  });

  it('MCP connected/error/disconnected 상태를 서버 행과 요약 metric으로 표시한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        mcpServers: [
          { name: 'context7', command: 'npx', args: [], env: {} },
          { name: 'filesystem', command: 'node', args: [], env: {} },
        ],
      }),
      runtime: buildRuntime({
        mcpConnectionState: 'partial-error',
        mcpServers: [
          { name: 'context7', status: 'connected' },
          { name: 'filesystem', status: 'error', error: 'spawn failed' },
        ],
      }),
    });

    expect(snapshot.mcp.statusLabel).toBe('부분 오류');
    expect(snapshot.mcp.value).toBe('1/2');
    expect(snapshot.mcpRows).toEqual([
      expect.objectContaining({ label: 'context7', statusLabel: '연결됨', tone: 'success' }),
      expect.objectContaining({ label: 'filesystem', statusLabel: '오류', tone: 'danger' }),
    ]);
  });

  it('주의 필요 항목을 Provider, 모델, RAG, MCP 우선순위로 계산한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        openai: { enabled: true, apiKey: '', models: ['gpt-4.1'] },
        chat: { ...DEFAULT_SETTINGS.chat, defaultModel: 'openai:missing-model' },
        mcpServers: [
          { name: 'context7', command: 'npx', args: [], env: {} },
        ],
      }),
      runtime: buildRuntime({
        ragStatus: buildRagStatus({
          staleDocuments: 1,
          updateRequiredDocuments: [
            { path: 'stale.md', status: 'stale', reason: '수정됨', mtime: 1, size: 1 },
          ],
        }),
        mcpConnectionState: 'error',
        mcpServers: [{ name: 'context7', status: 'error', error: 'spawn failed' }],
      }),
    });

    expect(snapshot.attentionItems.map((item) => item.id)).toEqual([
      'provider-openai-api-key',
      'chat-default-model-unavailable',
      'rag-update-required',
      'mcp-errors',
    ]);
  });
});
