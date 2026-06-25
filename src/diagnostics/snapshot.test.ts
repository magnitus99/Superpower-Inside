import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
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
  buildAgentDiagnosticsSnapshot,
  getAgentDiagnosticsFilePath,
  type AgentDiagnosticsRuntimeState,
  type AgentDiagnosticsSessionState,
} from './snapshot';

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
    agentDiagnostics: {
      ...DEFAULT_SETTINGS.agentDiagnostics,
      ...override.agentDiagnostics,
    },
    customOpenAIProviders:
      override.customOpenAIProviders ?? DEFAULT_SETTINGS.customOpenAIProviders,
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
        openai: {
          ...DEFAULT_SETTINGS.openai,
          enabled: true,
          apiKey: 'sk-secretsecretsecret',
          models: ['gpt-4.1-mini'],
        },
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
      logs: logger.getEntries(),
      fileWrite: {
        path: '.obsidian/plugins/superpower-inside/agent-diagnostics.json',
        lastAttemptAt: 1_780_371_003_000,
        lastSuccessAt: 1_780_371_003_001,
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
        id: 'openai',
        enabled: true,
        apiKeyConfigured: true,
        modelCount: 1,
      }),
    );
    expect(snapshot.rag.status?.totalDocuments).toBe(7);
    expect(snapshot.graphRag.status?.state).toBe('partial');
    expect(snapshot.mcp.servers[0]?.env).toEqual({
      API_KEY: '[REDACTED]',
      PATH: 'C:/tools',
    });
    expect(snapshot.refreshEvents[0]?.domain).toBe('rag');
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
