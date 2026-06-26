import type { DataAdapter } from 'obsidian';

import type {
  AgentDiagnosticsBreadcrumb,
  AgentDiagnosticsBreadcrumbAction,
  AgentDiagnosticsFileWriteState,
  AgentDiagnosticsHeartbeatState,
  AgentDiagnosticsPreviousSessionState,
  AgentDiagnosticsRefreshEvent,
  AgentDiagnosticsSessionState,
} from './snapshot';
import type { RefreshBus, RefreshDomain } from '../utils/refresh-bus';
import type { RefreshResult } from '../utils/refresh-action';
import { redactLogValue, type AppLogger, type LogEntry, type LoggerChangeEvent } from '../utils/logger';
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
const DEFAULT_MAX_BREADCRUMBS = 100;

export interface AgentDiagnosticsServiceSnapshotState {
  session: AgentDiagnosticsSessionState;
  previousSession: AgentDiagnosticsPreviousSessionState | null;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: readonly AgentDiagnosticsRefreshEvent[];
  breadcrumbs: readonly AgentDiagnosticsBreadcrumb[];
  logs: readonly LogEntry[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
}

export interface AgentDiagnosticsBreadcrumbInput {
  phase: string;
  action: AgentDiagnosticsBreadcrumbAction;
  detail?: string;
  data?: unknown;
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
  maxBreadcrumbs?: number;
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
  private readonly maxBreadcrumbs: number;
  private readonly now: () => number;
  private refreshEvents: AgentDiagnosticsRefreshEvent[] = [];
  private breadcrumbs: AgentDiagnosticsBreadcrumb[] = [];
  private unsubscribers: Array<() => void> = [];
  private heartbeatTimer: number | null = null;
  private nextHeartbeatExpectedAt: number | null = null;
  private session: AgentDiagnosticsSessionState | null = null;
  private previousSession: AgentDiagnosticsPreviousSessionState | null = null;
  private heartbeat: AgentDiagnosticsHeartbeatState = createInitialHeartbeat();
  private fileWrite: AgentDiagnosticsFileWriteState | null = null;
  private nextEventId = 1;
  private nextBreadcrumbId = 1;
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
    this.maxBreadcrumbs = Math.max(
      1,
      Math.floor(options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS),
    );
    this.now = options.now ?? (() => Date.now());
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      const shouldReadPreviousSession = !this.isRunning();
      this.start();
      if (shouldReadPreviousSession) {
        this.previousSession = await this.readPreviousSessionSuspect();
      }
      return;
    }
    await this.stop('disabled');
  }

  start(): void {
    if (this.session?.status === 'running') return;
    const startedAt = this.now();
    this.previousSession = null;
    this.breadcrumbs = [];
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

  async recordBreadcrumb(input: AgentDiagnosticsBreadcrumbInput): Promise<void> {
    if (!this.isRunning()) return;
    const breadcrumb: AgentDiagnosticsBreadcrumb = {
      id: this.nextBreadcrumbId++,
      timestamp: this.now(),
      phase: input.phase,
      action: input.action,
      detail: input.detail,
      data: input.data === undefined ? undefined : redactLogValue(input.data),
    };
    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - this.maxBreadcrumbs);
    }
    await this.writeSnapshot('breadcrumb');
  }

  async clearDetailedLogging(): Promise<void> {
    this.logger.clear();
    this.refreshEvents = [];
    this.breadcrumbs = [];
    this.previousSession = null;
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
      previousSession: this.previousSession,
      heartbeat: this.heartbeat,
      refreshEvents: [...this.refreshEvents],
      breadcrumbs: [...this.breadcrumbs],
      logs,
      fileWrite: this.fileWrite,
    };
  }

  private async readPreviousSessionSuspect(): Promise<AgentDiagnosticsPreviousSessionState | null> {
    try {
      if (!(await this.adapter.exists(this.filePath))) return null;
      const raw = await this.adapter.read(this.filePath);
      const parsed = JSON.parse(raw) as unknown;
      return parsePreviousSessionSuspect(parsed);
    } catch {
      return null;
    }
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

function parsePreviousSessionSuspect(
  value: unknown,
): AgentDiagnosticsPreviousSessionState | null {
  if (!isRecord(value)) return null;
  const session = value.session;
  if (!isRecord(session)) return null;
  const status = session.status;
  if (status !== 'running') return null;
  const id = typeof session.id === 'string' ? session.id : null;
  const startedAt = typeof session.startedAt === 'number' ? session.startedAt : null;
  if (!id || startedAt === null) return null;
  const endedAt = typeof session.endedAt === 'number' ? session.endedAt : null;
  const endReason = typeof session.endReason === 'string' ? session.endReason : null;
  if (endedAt !== null || endReason !== null) return null;
  return {
    id,
    status,
    startedAt,
    endedAt,
    endReason,
    lastGeneratedAt: typeof value.generatedAt === 'number' ? value.generatedAt : null,
    lastHeartbeat: parseHeartbeat(value.heartbeat),
    suspectedUncleanShutdown: true,
  };
}

function parseHeartbeat(value: unknown): AgentDiagnosticsHeartbeatState | null {
  if (!isRecord(value)) return null;
  const maxLagMs = typeof value.maxLagMs === 'number' ? value.maxLagMs : null;
  const tickCount = typeof value.tickCount === 'number' ? value.tickCount : null;
  if (maxLagMs === null || tickCount === null) return null;
  return {
    lastStartedAt: typeof value.lastStartedAt === 'number' ? value.lastStartedAt : null,
    lastFinishedAt: typeof value.lastFinishedAt === 'number' ? value.lastFinishedAt : null,
    lastLagMs: typeof value.lastLagMs === 'number' ? value.lastLagMs : null,
    maxLagMs,
    tickCount,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
