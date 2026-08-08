import { describe, expect, it, vi } from 'vitest';

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

import type { GraphRagStatusSummary } from '../graph/status';
import type { RagStatusSummary } from '../rag/status';
import { DEFAULT_SETTINGS, type SuperpowerInsideSettings } from '../settings';
import { createLogger } from '../utils/logger';
import {
  buildAgentDiagnosticsProviderSnapshot,
  buildAgentDiagnosticsSnapshot,
  getAgentDiagnosticsFilePath,
  type AgentDiagnosticsRuntimeState,
  type AgentDiagnosticsSessionState,
} from './snapshot';

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
    agentDiagnostics: {
      ...DEFAULT_SETTINGS.agentDiagnostics,
      ...override.agentDiagnostics,
    },
    customOpenAIProviders: override.customOpenAIProviders ?? DEFAULT_SETTINGS.customOpenAIProviders,
    mcpServers: override.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
  };
}

function buildRagStatus(): RagStatusSummary {
  return {
    totalDocuments: 7,
    healthyDocuments: 5,
    missingDocuments: 1,
    staleDocuments: 1,
    unknownDocuments: 0,
    excludedDocuments: 2,
    totalVectors: 23,
    lastCalculatedAt: 1_780_371_100_000,
    updateRequiredDocuments: [
      { path: 'a.md', status: 'stale', reason: 'modified', mtime: 1, size: 2 },
    ],
  };
}

function buildGraphStatus(): GraphRagStatusSummary {
  return {
    state: 'partial',
    totalCandidateFiles: 7,
    graphEvidenceCount: 11,
    rejectedFactCount: 1,
    failedFileCount: 2,
    pendingMergeCount: 3,
    staleFileCount: 1,
    staleFilePaths: ['a.md'],
    maxFilesPerRun: 50,
  };
}

function buildRuntime(): AgentDiagnosticsRuntimeState {
  return {
    ragStatus: buildRagStatus(),
    graphRagStatus: buildGraphStatus(),
    mcpConnectionState: 'partial-error',
    mcpServers: [
      {
        name: 'filesystem',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'plain-secret', PATH: 'C:/tools' },
        status: 'error',
        error: 'spawn failed with Bearer abcdefgh',
      },
    ],
    isRagIndexing: true,
    isGraphRagIndexing: false,
    hasGraphRagRunner: true,
    ragIndexingStatus: {
      running: true,
      phase: 'pending',
      queuedFiles: 4,
      lastResult: null,
      progress: null,
    },
    performanceGuardState: {
      mode: 'throttled',
      currentBatchSize: 2,
      currentYieldMs: 100,
      reason: 'slow batch',
      pauseUntilMs: null,
      remainingPauseMs: null,
      lastSlowReason: 'slow event loop',
    },
    nextAutoUpdateAt: 1_780_371_200_000,
    lastAutoUpdateSkippedReason: 'already running',
    lastAutoUpdateResult: null,
    ragRuntimeInit: {
      running: true,
      currentStage: 'legacy-vector-import',
      lastError: 'previous init timeout',
      lastSkippedReason: null,
      lastStartedAt: 1_780_371_100_000,
      lastFinishedAt: null,
    },
    runtimeFlags: {
      vectorStoreReady: true,
      knowledgeGraphStoreReady: true,
      ragEngineReady: true,
      providerReady: true,
    },
  };
}

function buildSession(): AgentDiagnosticsSessionState {
  return {
    id: 'diag-1',
    status: 'running',
    startedAt: 1_780_371_000_000,
    endedAt: null,
    endReason: null,
  };
}

describe('agent diagnostics snapshot', () => {
  it('프로바이더 진단은 Ternlight를 일반 연결 수에서 제외하고 endpoint 비밀값을 제거한다', () => {
    const providers = buildAgentDiagnosticsProviderSnapshot(
      buildSettings({
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
            id: 'primary',
            name: 'Primary',
            strategy: 'openAICompatible',
            apiKey: 'secret',
            baseUrl: 'https://user:password@example.com/v1?token=secret#private',
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
    );

    expect(providers.enabledCount).toBe(1);
    expect(providers.rows).toEqual([
      expect.objectContaining({
        id: 'profile:primary',
        baseUrl: 'https://example.com/v1',
      }),
    ]);
    expect(JSON.stringify(providers)).not.toContain('password');
    expect(JSON.stringify(providers)).not.toContain('token=secret');
  });

  it('프로필이 없는 레거시 설정도 프로바이더 진단에 유지한다', () => {
    const providers = buildAgentDiagnosticsProviderSnapshot(
      buildSettings({
        providerProfiles: [],
        openai: {
          enabled: true,
          apiKey: 'secret',
          baseUrl: 'https://api.openai.com/v1?key=secret',
          models: ['gpt-4.1-mini'],
        },
      }),
    );

    expect(providers.rows).toContainEqual(
      expect.objectContaining({
        id: 'openai',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
      }),
    );
  });

  it('builds a redacted machine-readable snapshot of plugin runtime state', () => {
    const logger = createLogger({ minLevel: 'trace', maxEntries: 10, mirrorToConsole: false });
    logger.error('provider failed', {
      source: 'llm',
      data: { apiKey: 'sk-secretsecretsecret', nested: { token: 'github_pat_secretsecret' } },
      error: new Error('Authorization failed: Bearer abcdefgh'),
    });

    const snapshot = buildAgentDiagnosticsSnapshot({
      manifest: {
        id: 'superpower-inside',
        name: 'Superpower Inside',
        version: '1.3.7',
      },
      vault: {
        name: 'UnitVault',
        configDir: '.obsidian',
        adapterBasePath: 'D:/Vault',
      },
      settings: buildSettings({
        providerProfiles: [
          {
            id: 'primary',
            name: 'Primary OpenAI',
            strategy: 'openAICompatible',
            enabled: true,
            apiKey: 'sk-secretsecretsecret',
            baseUrl: 'https://example.com/v1',
            models: [
              {
                id: 'gpt-4.1-mini',
                kind: 'general',
                verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
              },
            ],
          },
        ],
        agentDiagnostics: { enabled: true },
        mcpServers: [
          {
            name: 'filesystem',
            command: 'node',
            args: ['server.js'],
            env: { API_KEY: 'plain-secret', PATH: 'C:/tools' },
          },
        ],
      }),
      runtime: buildRuntime(),
      session: buildSession(),
      previousSession: {
        id: 'diag-previous',
        status: 'running',
        startedAt: 1_780_370_000_000,
        endedAt: null,
        endReason: null,
        lastGeneratedAt: 1_780_370_100_000,
        lastHeartbeat: {
          lastStartedAt: 1_780_370_099_000,
          lastFinishedAt: 1_780_370_099_010,
          lastLagMs: 10,
          maxLagMs: 10,
          tickCount: 1,
        },
        lastActiveOperation: {
          id: 9,
          phase: 'rag.runtime',
          detail: 'bm25-load',
          startedAt: 1_780_370_099_000,
          lastUpdatedAt: 1_780_370_099_000,
        },
        suspectedUncleanShutdown: true,
      },
      heartbeat: {
        lastStartedAt: 1_780_371_001_000,
        lastFinishedAt: 1_780_371_001_013,
        lastLagMs: 13,
        maxLagMs: 42,
        tickCount: 3,
      },
      refreshEvents: [
        {
          id: 1,
          timestamp: 1_780_371_002_000,
          domain: 'rag',
          status: 'partial',
          detail: 'indexing',
        },
      ],
      breadcrumbs: [
        {
          id: 1,
          timestamp: 1_780_371_002_500,
          phase: 'rag.runtime',
          action: 'enter',
          detail: 'bm25-load',
          data: { authorization: 'Bearer abcdefgh', fileCount: 7 },
        },
      ],
      activeOperations: [
        {
          id: 2,
          timestamp: 1_780_371_002_700,
          phase: 'rag.indexing',
          action: 'enter',
          detail: 'file-index',
          data: { currentFile: 'a.md' },
        },
      ].map((entry) => ({
        id: entry.id,
        phase: entry.phase,
        detail: entry.detail,
        startedAt: entry.timestamp,
        lastUpdatedAt: entry.timestamp,
        data: entry.data,
      })),
      logs: logger.getEntries(),
      fileWrite: {
        path: '.obsidian/plugins/superpower-inside/agent-diagnostics.json',
        lastAttemptAt: 1_780_371_003_000,
        lastSuccessAt: 1_780_371_003_001,
        lastError: null,
      },
      eventLog: {
        path: '.obsidian/plugins/superpower-inside/agent-diagnostics.ndjson',
        lastAppendAt: 1_780_371_003_100,
        lastError: null,
      },
      now: 1_780_371_004_000,
    });

    expect(snapshot.manifest).toEqual({
      id: 'superpower-inside',
      name: 'Superpower Inside',
      version: '1.3.7',
    });
    expect(snapshot.providers.enabledCount).toBe(1);
    expect(snapshot.providers.rows).toContainEqual(
      expect.objectContaining({
        id: 'profile:primary',
        label: 'Primary OpenAI',
        enabled: true,
        apiKeyConfigured: true,
        modelCount: 1,
      }),
    );
    expect(snapshot.rag.status?.totalDocuments).toBe(7);
    expect(snapshot.rag.init).toEqual(
      expect.objectContaining({
        running: true,
        currentStage: 'legacy-vector-import',
      }),
    );
    expect(snapshot.graphRag.status?.state).toBe('partial');
    expect(snapshot.mcp.servers[0]?.env).toEqual({
      API_KEY: '[REDACTED]',
      PATH: 'C:/tools',
    });
    expect(snapshot.refreshEvents[0]?.domain).toBe('rag');
    expect(snapshot.previousSession?.suspectedUncleanShutdown).toBe(true);
    expect(snapshot.diagnosticFile.eventLogPath).toBe(
      '.obsidian/plugins/superpower-inside/agent-diagnostics.ndjson',
    );
    expect(snapshot.diagnosticFile.safeModeFlagPath).toBe(
      '.obsidian/plugins/superpower-inside/agent-diagnostics-safe-mode.json',
    );
    expect(snapshot.diagnosis.status).toBe('unclean-shutdown');
    expect(snapshot.diagnosis.lastActiveOperation?.phase).toBe('rag.indexing');
    expect(snapshot.diagnosis.recommendedActions[0]?.id).toBe('disable-rag-startup-work');
    expect(snapshot.breadcrumbs[0]).toEqual(
      expect.objectContaining({
        phase: 'rag.runtime',
        action: 'enter',
        data: { authorization: '[REDACTED]', fileCount: 7 },
      }),
    );
    expect(snapshot.logs[0]?.source).toBe('llm');
    expect(snapshot.heartbeat.maxLagMs).toBe(42);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('sk-secretsecretsecret');
    expect(serialized).not.toContain('plain-secret');
    expect(serialized).not.toContain('github_pat_secretsecret');
    expect(serialized).not.toContain('Bearer abcdefgh');
  });

  it('uses the vault config directory and plugin id for the diagnostics file path', () => {
    expect(getAgentDiagnosticsFilePath('.config/obsidian', 'superpower-inside')).toBe(
      '.config/obsidian/plugins/superpower-inside/agent-diagnostics.json',
    );
  });
});
