import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshBus } from '../utils/refresh-bus';
import { createLogger } from '../utils/logger';
import {
  AgentDiagnosticsService,
  type AgentDiagnosticsServiceSnapshotState,
} from './service';

class RecordingAdapter {
  private files = new Map<string, string>();
  readonly writePaths: string[] = [];
  readonly appendPaths: string[] = [];
  readonly renamePairs: Array<[string, string]> = [];
  readonly removePaths: string[] = [];

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  mkdir(_path: string): Promise<void> {
    return Promise.resolve();
  }

  write(path: string, value: string): Promise<void> {
    this.writePaths.push(path);
    this.files.set(path, value);
    return Promise.resolve();
  }

  append(path: string, value: string): Promise<void> {
    this.appendPaths.push(path);
    this.files.set(path, `${this.files.get(path) ?? ''}${value}`);
    return Promise.resolve();
  }

  read(path: string): Promise<string> {
    const value = this.files.get(path);
    return value === undefined ? Promise.reject(new Error('missing file')) : Promise.resolve(value);
  }

  rename(from: string, to: string): Promise<void> {
    this.renamePairs.push([from, to]);
    const value = this.files.get(from);
    if (value === undefined) return Promise.reject(new Error('missing temp file'));
    this.files.set(to, value);
    this.files.delete(from);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.removePaths.push(path);
    this.files.delete(path);
    return Promise.resolve();
  }

  readRaw(path: string): string | undefined {
    return this.files.get(path);
  }

  writeRaw(path: string, value: string): void {
    this.files.set(path, value);
  }

  asDataAdapter(): never {
    return this as never;
  }
}

const diagnosticsPath = '.obsidian/plugins/superpower-inside/agent-diagnostics.json';
const eventLogPath = '.obsidian/plugins/superpower-inside/agent-diagnostics.ndjson';

function createService(options: {
  enabled: boolean;
  adapter?: RecordingAdapter;
  maxBreadcrumbs?: number;
}) {
  const adapter = options.adapter ?? new RecordingAdapter();
  const refreshBus = new RefreshBus();
  const logger = createLogger({ minLevel: 'trace', maxEntries: 10, mirrorToConsole: false });
  const snapshots: AgentDiagnosticsServiceSnapshotState[] = [];
  const service = new AgentDiagnosticsService({
    adapter: adapter.asDataAdapter(),
    filePath: diagnosticsPath,
    eventLogPath,
    refreshBus,
    logger,
    heartbeatIntervalMs: 1000,
    maxRefreshEvents: 2,
    maxLogEntries: 3,
    maxBreadcrumbs: options.maxBreadcrumbs,
    now: () => Date.now(),
    buildSnapshot: (state) => {
      snapshots.push(state);
      return {
        session: state.session,
        previousSession: state.previousSession,
        refreshEvents: state.refreshEvents,
        breadcrumbs: state.breadcrumbs,
        heartbeat: state.heartbeat,
        logs: state.logs,
        fileWrite: state.fileWrite,
        eventLog: state.eventLog,
        activeOperations: state.activeOperations,
      };
    },
  });
  void service.setEnabled(options.enabled);
  return { adapter, refreshBus, logger, service, snapshots };
}

describe('AgentDiagnosticsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'));
  });

  it('does not subscribe or write files while disabled', async () => {
    const { adapter, refreshBus, logger, service } = createService({ enabled: false });

    refreshBus.emit('rag', { status: 'partial', detail: 'indexing' });
    logger.warn('slow batch', { source: 'rag' });
    await service.writeNow('manual');

    expect(adapter.writePaths).toEqual([]);
    expect(service.isRunning()).toBe(false);
  });

  it('records bounded refresh events and writes snapshots while enabled', async () => {
    const { adapter, refreshBus, logger, service } = createService({ enabled: true });

    refreshBus.emit('rag', { status: 'partial', detail: 'first' });
    refreshBus.emit('mcp', { status: 'error', detail: 'second' });
    refreshBus.emit('models', { status: 'success', detail: 'third' });
    logger.info('loaded', { source: 'lifecycle' });
    await service.writeNow('manual');

    const raw = adapter.readRaw(diagnosticsPath);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}') as {
      session: { status: string; startedAt: number };
      refreshEvents: Array<{ domain: string; detail?: string }>;
      logs: Array<{ source: string; message: string }>;
    };
    expect(parsed.session.status).toBe('running');
    expect(parsed.session.startedAt).toBe(Date.parse('2026-06-25T00:00:00.000Z'));
    expect(parsed.refreshEvents.map((event) => event.detail)).toEqual(['second', 'third']);
    expect(parsed.logs).toContainEqual(
      expect.objectContaining({ source: 'lifecycle', message: 'loaded' }),
    );
  });

  it('writes a final stopped session snapshot when disabled or unloaded', async () => {
    const { adapter, service } = createService({ enabled: true });

    vi.setSystemTime(new Date('2026-06-25T00:00:05.000Z'));
    await service.stop('plugin-unload');

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      session: { status: string; endedAt: number; endReason: string };
    };
    expect(parsed.session.status).toBe('stopped');
    expect(parsed.session.endedAt).toBe(Date.parse('2026-06-25T00:00:05.000Z'));
    expect(parsed.session.endReason).toBe('plugin-unload');
    expect(service.isRunning()).toBe(false);
  });

  it('clears detailed logging artifacts and starts a clean buffer', async () => {
    const { adapter, refreshBus, logger, service } = createService({ enabled: true });
    refreshBus.emit('rag', { status: 'partial', detail: 'before cleanup' });
    logger.warn('before cleanup', { source: 'diagnostics' });
    await service.writeNow('manual');

    await service.clearDetailedLogging();
    await service.writeNow('after-cleanup');

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      refreshEvents: unknown[];
      logs: unknown[];
    };
    expect(adapter.removePaths).toContain(diagnosticsPath);
    expect(parsed.refreshEvents).toEqual([]);
    expect(parsed.logs).toEqual([]);
  });

  it('updates heartbeat lag for the whole diagnostics session', async () => {
    const { adapter, service } = createService({ enabled: true });

    await vi.advanceTimersByTimeAsync(1000);
    vi.setSystemTime(new Date('2026-06-25T00:00:01.037Z'));
    await vi.advanceTimersByTimeAsync(1000);
    await service.writeNow('manual');

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      heartbeat: { tickCount: number; maxLagMs: number };
    };
    expect(parsed.heartbeat.tickCount).toBeGreaterThan(0);
    expect(parsed.heartbeat.maxLagMs).toBeGreaterThanOrEqual(0);
  });

  it('flags a previous running session as an unclean shutdown suspect', async () => {
    const adapter = new RecordingAdapter();
    adapter.writeRaw(
      diagnosticsPath,
      JSON.stringify({
        generatedAt: Date.parse('2026-06-24T23:59:55.000Z'),
        session: {
          id: 'agent-diagnostics-old',
          status: 'running',
          startedAt: Date.parse('2026-06-24T23:59:50.000Z'),
          endedAt: null,
          endReason: null,
        },
        heartbeat: {
          lastStartedAt: Date.parse('2026-06-24T23:59:55.000Z'),
          lastFinishedAt: Date.parse('2026-06-24T23:59:55.010Z'),
          lastLagMs: 10,
          maxLagMs: 10,
          tickCount: 1,
        },
      }),
    );
    const { service } = createService({ enabled: false, adapter });

    await service.setEnabled(true);
    await service.writeNow('manual');

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      previousSession: {
        status: string;
        suspectedUncleanShutdown: boolean;
        id: string;
        lastGeneratedAt: number;
      } | null;
    };
    expect(parsed.previousSession).toEqual(
      expect.objectContaining({
        status: 'running',
        suspectedUncleanShutdown: true,
        id: 'agent-diagnostics-old',
        lastGeneratedAt: Date.parse('2026-06-24T23:59:55.000Z'),
      }),
    );
  });

  it('records bounded breadcrumbs before risky work starts', async () => {
    const { adapter, service } = createService({ enabled: true, maxBreadcrumbs: 1 });

    await service.recordBreadcrumb({
      phase: 'rag.runtime',
      action: 'enter',
      detail: 'vector-store-open',
      data: { fileCount: 1 },
    });
    await service.recordBreadcrumb({
      phase: 'rag.runtime',
      action: 'enter',
      detail: 'bm25-load',
      data: { apiKey: 'sk-secretsecretsecret', fileCount: 3 },
    });

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      breadcrumbs: Array<{
        phase: string;
        action: string;
        detail?: string;
        data?: Record<string, unknown>;
      }>;
    };
    expect(parsed.breadcrumbs).toEqual([
      expect.objectContaining({
        phase: 'rag.runtime',
        action: 'enter',
        detail: 'bm25-load',
        data: { apiKey: '[REDACTED]', fileCount: 3 },
      }),
    ]);
  });

  it('appends NDJSON events and exposes the unfinished active operation for postmortems', async () => {
    const { adapter, service } = createService({ enabled: true, maxBreadcrumbs: 5 });

    await service.recordBreadcrumb({
      phase: 'rag.runtime',
      action: 'enter',
      detail: 'bm25-load',
      data: { fileCount: 42, apiKey: 'sk-secretsecretsecret' },
    });

    const snapshot = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      activeOperations: Array<{
        phase: string;
        detail?: string;
        startedAt: number;
        data?: Record<string, unknown>;
      }>;
      eventLog: { path: string; lastAppendAt: number | null; lastError: string | null };
    };
    expect(snapshot.eventLog.path).toBe(eventLogPath);
    expect(snapshot.eventLog.lastAppendAt).toBe(Date.parse('2026-06-25T00:00:00.000Z'));
    expect(snapshot.eventLog.lastError).toBeNull();
    expect(snapshot.activeOperations).toEqual([
      expect.objectContaining({
        phase: 'rag.runtime',
        detail: 'bm25-load',
        data: { fileCount: 42, apiKey: '[REDACTED]' },
      }),
    ]);

    const events = (adapter.readRaw(eventLogPath) ?? '')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; phase?: string; detail?: string });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session_start' }),
        expect.objectContaining({
          type: 'operation_start',
          phase: 'rag.runtime',
          detail: 'bm25-load',
        }),
      ]),
    );
  });

  it('removes an active operation when the matching breadcrumb leaves or errors', async () => {
    const { adapter, service } = createService({ enabled: true, maxBreadcrumbs: 5 });

    await service.recordBreadcrumb({ phase: 'rag.runtime', action: 'enter', detail: 'bm25-load' });
    await service.recordBreadcrumb({ phase: 'rag.runtime', action: 'leave', detail: 'bm25-load' });

    const parsed = JSON.parse(adapter.readRaw(diagnosticsPath) ?? '{}') as {
      activeOperations: unknown[];
    };
    expect(parsed.activeOperations).toEqual([]);
  });
});
