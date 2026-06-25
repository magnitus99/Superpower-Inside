import type { DataAdapter } from 'obsidian';

import type {
  AgentDiagnosticsFileWriteState,
  AgentDiagnosticsHeartbeatState,
  AgentDiagnosticsRefreshEvent,
  AgentDiagnosticsSessionState,
} from './snapshot';
import type { RefreshBus, RefreshDomain } from '../utils/refresh-bus';
import type { RefreshResult } from '../utils/refresh-action';
import type { AppLogger, LogEntry, LoggerChangeEvent } from '../utils/logger';
import { writeJsonToVault } from '../utils/vault';

const REFRESH_DOMAINS: readonly RefreshDomain[] = [
  'rag',
  'mcp',
  'models',
  'sessions',
  'exclude-counts',
  'graph-progress',
  'graph-data',
];

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_REFRESH_EVENTS = 100;
const DEFAULT_MAX_LOG_ENTRIES = 200;

export interface AgentDiagnosticsServiceSnapshotState {
  session: AgentDiagnosticsSessionState;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: readonly AgentDiagnosticsRefreshEvent[];
  logs: readonly LogEntry[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
}

export interface AgentDiagnosticsServiceOptions {
  adapter: DataAdapter;
  filePath: string;
  refreshBus: RefreshBus;
  logger: AppLogger;
  buildSnapshot: (state: AgentDiagnosticsServiceSnapshotState) => unknown;
  heartbeatIntervalMs?: number;
  maxRefreshEvents?: number;
  maxLogEntries?: number;
  now?: () => number;
}

export class AgentDiagnosticsService {
  private readonly adapter: DataAdapter;
  private readonly filePath: string;
  private readonly refreshBus: RefreshBus;
  private readonly logger: AppLogger;
  private readonly buildSnapshot: (state: AgentDiagnosticsServiceSnapshotState) => unknown;
  private readonly heartbeatIntervalMs: number;
  private readonly maxRefreshEvents: number;
  private readonly maxLogEntries: number;
  private readonly now: () => number;
  private refreshEvents: AgentDiagnosticsRefreshEvent[] = [];
  private unsubscribers: Array<() => void> = [];
  private heartbeatTimer: number | null = null;
  private nextHeartbeatExpectedAt: number | null = null;
  private session: AgentDiagnosticsSessionState | null = null;
  private heartbeat: AgentDiagnosticsHeartbeatState = createInitialHeartbeat();
  private fileWrite: AgentDiagnosticsFileWriteState | null = null;
  private nextEventId = 1;
  private writeInProgress = false;

  constructor(options: AgentDiagnosticsServiceOptions) {
    this.adapter = options.adapter;
    this.filePath = options.filePath;
    this.refreshBus = options.refreshBus;
    this.logger = options.logger;
    this.buildSnapshot = options.buildSnapshot;
    this.heartbeatIntervalMs = Math.max(
      250,
      Math.floor(options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS),
    );
    this.maxRefreshEvents = Math.max(
      1,
      Math.floor(options.maxRefreshEvents ?? DEFAULT_MAX_REFRESH_EVENTS),
    );
    this.maxLogEntries = Math.max(1, Math.floor(options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES));
    this.now = options.now ?? (() => Date.now());
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      this.start();
      return;
    }
    await this.stop('disabled');
  }

  start(): void {
    if (this.session?.status === 'running') return;
    const startedAt = this.now();
    this.session = {
      id: createSessionId(startedAt),
      status: 'running',
      startedAt,
      endedAt: null,
      endReason: null,
    };
    this.heartbeat = createInitialHeartbeat();
    this.fileWrite = {
      path: this.filePath,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    this.subscribe();
    this.startHeartbeat();
  }

  async stop(reason: string): Promise<void> {
    if (!this.session) {
      this.cleanupSubscriptions();
      return;
    }
    if (this.session.status === 'running') {
      this.session = {
        ...this.session,
        status: 'stopped',
        endedAt: this.now(),
        endReason: reason,
      };
      await this.writeSnapshot('stop');
    }
    this.cleanupSubscriptions();
  }

  isRunning(): boolean {
    return this.session?.status === 'running';
  }

  async writeNow(_reason: string): Promise<void> {
    if (!this.isRunning()) return;
    await this.writeSnapshot('manual');
  }

  async clearDetailedLogging(): Promise<void> {
    this.logger.clear();
    this.refreshEvents = [];
    this.heartbeat = createInitialHeartbeat();
    this.fileWrite = {
      path: this.filePath,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    if (await this.adapter.exists(this.filePath)) {
      await this.adapter.remove(this.filePath);
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  getSnapshotState(): AgentDiagnosticsServiceSnapshotState | null {
    if (!this.session) return null;
    return this.createSnapshotState();
  }

  private subscribe(): void {
    this.cleanupSubscriptions();
    this.unsubscribers = REFRESH_DOMAINS.map((domain) =>
      this.refreshBus.on(domain, (result) => {
        this.recordRefreshEvent(domain, result);
      }),
    );
    this.unsubscribers.push(
      this.logger.subscribe((event) => {
        this.handleLoggerEvent(event);
      }),
    );
  }

  private cleanupSubscriptions(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.nextHeartbeatExpectedAt = null;
  }

  private startHeartbeat(): void {
    this.nextHeartbeatExpectedAt = this.now() + this.heartbeatIntervalMs;
    this.heartbeatTimer = window.setInterval(() => {
      this.recordHeartbeat();
      void this.writeSnapshot('heartbeat');
    }, this.heartbeatIntervalMs);
  }

  private recordHeartbeat(): void {
    const startedAt = this.now();
    const expectedAt = this.nextHeartbeatExpectedAt ?? startedAt;
    const lagMs = Math.max(0, startedAt - expectedAt);
    const finishedAt = this.now();
    this.nextHeartbeatExpectedAt = startedAt + this.heartbeatIntervalMs;
    this.heartbeat = {
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastLagMs: lagMs,
      maxLagMs: Math.max(this.heartbeat.maxLagMs, lagMs),
      tickCount: this.heartbeat.tickCount + 1,
    };
  }

  private recordRefreshEvent(domain: RefreshDomain, result: RefreshResult): void {
    this.refreshEvents.push({
      id: this.nextEventId++,
      timestamp: this.now(),
      domain,
      status: result.status,
      detail: result.detail,
      runId: result.runId,
      source: result.source,
    });
    if (this.refreshEvents.length > this.maxRefreshEvents) {
      this.refreshEvents.splice(0, this.refreshEvents.length - this.maxRefreshEvents);
    }
  }

  private handleLoggerEvent(event: LoggerChangeEvent): void {
    if (event.type === 'clear') {
      this.refreshEvents.push({
        id: this.nextEventId++,
        timestamp: this.now(),
        domain: 'models',
        status: 'success',
        detail: 'logger cleared',
      });
      if (this.refreshEvents.length > this.maxRefreshEvents) {
        this.refreshEvents.splice(0, this.refreshEvents.length - this.maxRefreshEvents);
      }
    }
  }

  private async writeSnapshot(reason: string): Promise<void> {
    if (!this.session || this.writeInProgress) return;
    this.writeInProgress = true;
    const attemptAt = this.now();
    this.fileWrite = {
      path: this.filePath,
      lastAttemptAt: attemptAt,
      lastSuccessAt: this.fileWrite?.lastSuccessAt ?? null,
      lastError: null,
    };
    try {
      const snapshot = this.buildSnapshot(this.createSnapshotState());
      await writeJsonToVault(this.adapter, this.filePath, snapshot);
      this.fileWrite = {
        path: this.filePath,
        lastAttemptAt: attemptAt,
        lastSuccessAt: this.now(),
        lastError: null,
      };
    } catch (err) {
      this.fileWrite = {
        path: this.filePath,
        lastAttemptAt: attemptAt,
        lastSuccessAt: this.fileWrite.lastSuccessAt,
        lastError: err instanceof Error ? err.message : String(err),
      };
      this.logger.warn('Agent diagnostics snapshot write failed.', {
        source: 'diagnostics',
        data: { reason, path: this.filePath },
        error: err,
      });
    } finally {
      this.writeInProgress = false;
    }
  }

  private createSnapshotState(): AgentDiagnosticsServiceSnapshotState {
    if (!this.session) {
      throw new Error('Agent diagnostics session has not started.');
    }
    const logs = this.logger.getEntries().slice(-this.maxLogEntries);
    return {
      session: this.session,
      heartbeat: this.heartbeat,
      refreshEvents: [...this.refreshEvents],
      logs,
      fileWrite: this.fileWrite,
    };
  }
}

function createInitialHeartbeat(): AgentDiagnosticsHeartbeatState {
  return {
    lastStartedAt: null,
    lastFinishedAt: null,
    lastLagMs: null,
    maxLagMs: 0,
    tickCount: 0,
  };
}

function createSessionId(startedAt: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `agent-diagnostics-${startedAt.toString(36)}-${random}`;
}
