import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = document.createElement('div');
    open(): void {}
    close(): void {}
  },
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));
import { setLanguage, t } from './i18n';
import type { RagStatusSummary } from './rag/status';
import {
  buildSettingsOverviewSnapshot,
  resolveSettingsRetrievalReadiness,
  type SettingsOverviewRuntimeState,
} from './settings-overview';
import { DEFAULT_SETTINGS, type SuperpowerInsideSettings } from './settings';

function buildSettings(override: Partial<SuperpowerInsideSettings> = {}): SuperpowerInsideSettings {
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
    customOpenAIProviders: override.customOpenAIProviders ?? DEFAULT_SETTINGS.customOpenAIProviders,
    mcpServers: override.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
  };
}

function buildRuntime(
  override: Partial<SettingsOverviewRuntimeState> = {},
): SettingsOverviewRuntimeState {
  return {
    ragStatus: null,
    mcpConnectionState: 'idle',
    mcpServers: [],
    isRagIndexing: false,
    retrievalReadiness: 'ready',
    ...override,
  };
}

function buildRagStatus(override: Partial<RagStatusSummary> = {}): RagStatusSummary {
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

describe('resolveSettingsRetrievalReadiness', () => {
  it.each([
    ['preparing', false, 'ready'],
    ['preparing', true, 'preparing'],
    ['degraded', false, 'degraded'],
  ] as const)('%s + started=%s -> %s', (readiness, started, expected) => {
    expect(resolveSettingsRetrievalReadiness(readiness, started)).toBe(expected);
  });
});

describe('설정 Overview snapshot', () => {
  beforeEach(() => {
    setLanguage('ko');
  });

  it('Provider metric과 사용자 지정 fallback 이름을 현재 UI 언어로 표시한다', () => {
    const settings = buildSettings({
      customOpenAIProviders: [
        {
          id: 'local',
          name: '',
          apiKey: '',
          baseUrl: 'http://localhost:1234/v1',
          models: ['local-model'],
          enabled: true,
          useRequestUrl: true,
        },
      ],
    });

    const korean = buildSettingsOverviewSnapshot({ settings, runtime: buildRuntime() });
    setLanguage('en');
    const english = buildSettingsOverviewSnapshot({ settings, runtime: buildRuntime() });

    expect(korean.metrics.find((metric) => metric.id === 'providers')?.label).toBe('AI 연결');
    expect(korean.providerRows.find((row) => row.id === 'provider-custom-local')?.label).toBe(
      '사용자 지정 OpenAI 호환',
    );
    expect(english.metrics.find((metric) => metric.id === 'providers')?.label).toBe(
      'AI connections',
    );
    expect(english.providerRows.find((row) => row.id === 'provider-custom-local')?.label).toBe(
      'Custom OpenAI-compatible',
    );
  });

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

  it('임베딩 전용 Ternlight는 일반 프로바이더 집계에서 제외한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        providerProfiles: [
          {
            id: 'ternlight',
            name: 'Ternlight',
            strategy: 'ternlight',
            apiKey: '',
            enabled: true,
            models: [
              {
                id: 'ternlight-base',
                kind: 'embedding',
                verification: { chatStatus: 'unknown', embeddingStatus: 'success' },
              },
            ],
          },
          {
            id: 'chat',
            name: 'Chat provider',
            strategy: 'openAICompatible',
            apiKey: '',
            baseUrl: 'https://example.com/v1',
            enabled: true,
            models: [
              {
                id: 'auto',
                kind: 'general',
                verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
              },
            ],
          },
        ],
      }),
      runtime: buildRuntime(),
    });

    expect(snapshot.providerRows.map((row) => row.id)).toEqual(['provider-profile-chat']);
    expect(snapshot.metrics.find((metric) => metric.id === 'providers')?.value).toBe('1/1');
  });

  it('OpenAI 호환 프로필의 빈 URL과 마지막 검증 실패를 준비됨으로 표시하지 않는다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        providerProfiles: [
          {
            id: 'missing-url',
            name: 'Missing URL',
            strategy: 'openAICompatible',
            apiKey: '',
            baseUrl: '',
            enabled: true,
            models: [
              {
                id: 'auto',
                kind: 'general',
                verification: { chatStatus: 'unknown', embeddingStatus: 'unknown' },
              },
            ],
          },
          {
            id: 'failed',
            name: 'Failed provider',
            strategy: 'openRouter',
            apiKey: 'test-key',
            enabled: true,
            models: [
              {
                id: 'model',
                kind: 'general',
                verification: { chatStatus: 'failed', embeddingStatus: 'unknown' },
              },
            ],
          },
        ],
      }),
      runtime: buildRuntime(),
    });

    expect(snapshot.providerRows).toEqual([
      expect.objectContaining({ id: 'provider-profile-missing-url', tone: 'danger' }),
      expect.objectContaining({ id: 'provider-profile-failed', tone: 'danger' }),
    ]);
    expect(snapshot.providerRows.map((row) => row.statusLabel)).not.toContain('준비됨');
    expect(snapshot.attentionItems.map((item) => item.id)).toEqual([
      'provider-profile-missing-url-base-url',
      'provider-profile-failed-validation',
      'chat-default-model-unavailable',
    ]);
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
        mcpServers: [{ name: 'context7', command: 'npx', args: [], env: {} }],
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
    expect(snapshot.attentionItems.map((item) => item.actionLabel)).toEqual([
      '프로바이더 설정',
      '프로바이더 설정',
      '검색 설정',
      'MCP 설정',
    ]);
  });

  it('검색 준비 중과 제한 상태를 RAG 최신 상태보다 우선한다', () => {
    const preparing = buildSettingsOverviewSnapshot({
      settings: buildSettings(),
      runtime: buildRuntime({
        ragStatus: buildRagStatus(),
        isRagIndexing: true,
        retrievalReadiness: 'preparing',
      }),
    });

    expect(preparing.retrievalReadiness).toBe('preparing');
    expect(preparing.rag).toMatchObject({
      value: t('chatReadinessRagIndexing'),
      statusLabel: t('chatReadinessRagIndexing'),
      detail: t('chatReadinessRagIndexingDetail'),
      tone: 'neutral',
      target: 'rag',
    });
    expect(preparing.rag.value).not.toBe(t('overviewLatest'));
    expect(preparing.attentionItems.map((item) => item.id)).not.toContain(
      'rag-retrieval-degraded',
    );

    const degraded = buildSettingsOverviewSnapshot({
      settings: buildSettings(),
      runtime: buildRuntime({
        ragStatus: buildRagStatus(),
        isRagIndexing: true,
        retrievalReadiness: 'degraded',
      }),
    });

    expect(degraded.retrievalReadiness).toBe('degraded');
    expect(degraded.rag).toMatchObject({
      value: t('chatReadinessRagNotReady'),
      statusLabel: t('chatReadinessRagNotReady'),
      detail: t('chatReadinessRagNotReadyDetail'),
      tone: 'danger',
      target: 'rag',
    });
    expect(degraded.rag.value).not.toBe(t('overviewLatest'));
    expect(degraded.attentionItems).toContainEqual({
      id: 'rag-retrieval-degraded',
      label: t('chatReadinessRagNotReady'),
      detail: t('chatReadinessRagNotReadyDetail'),
      tone: 'danger',
      target: 'rag',
      actionLabel: t('overviewOpenRag'),
    });
  });

  it('선택할 채팅 모델이 없는 첫 사용은 연결 설정으로 안내한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings(),
      runtime: buildRuntime(),
    });
    const attention = snapshot.attentionItems.find(
      (item) => item.id === 'chat-default-model-unavailable',
    );
    expect(attention?.target).toBe('providers');
    expect(attention?.actionLabel).toBe('프로바이더 설정');
  });

  it('provider profile의 활성 일반 모델을 기본 채팅 모델로 인식한다', () => {
    const snapshot = buildSettingsOverviewSnapshot({
      settings: buildSettings({
        providerProfiles: [
          {
            id: 'freellmapi',
            name: 'FreeLLMAPI',
            strategy: 'openAICompatible',
            apiKey: '',
            baseUrl: 'http://localhost:35010/v1',
            enabled: true,
            models: [
              {
                id: 'auto',
                kind: 'general',
                verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
              },
            ],
          },
        ],
        chat: { ...DEFAULT_SETTINGS.chat, defaultModel: 'profile:freellmapi:auto' },
      }),
      runtime: buildRuntime(),
    });

    expect(snapshot.chat).toMatchObject({
      statusLabel: '준비됨',
      detail: '기본 모델 FreeLLMAPI / auto',
      tone: 'success',
    });
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      'chat-default-model-unavailable',
    );
  });
});
