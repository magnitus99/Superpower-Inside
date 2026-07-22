import type { DataAdapter } from 'obsidian';

import type {
  AgentDiagnosticsBreadcrumb,
  AgentDiagnosticsBreadcrumbAction,
  AgentDiagnosticsActiveOperationState,
  AgentDiagnosticsEventLogState,
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
import {
  DEFAULT_DIAGNOSTICS_EVENT_LOG_MAX_BYTES,
  rotatePluginEventLog,
} from '../utils/plugin-file-maintenance';

const REFRESH_DOMAINS: readonly RefreshDomain[] = [
  'rag',
  'mcp',
  'models',
  'sessions',
  'exclude-counts',
  'graph-progress',
  'graph-data',
];

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_MAX_REFRESH_EVENTS = 100;
const DEFAULT_MAX_LOG_ENTRIES = 200;
const DEFAULT_MAX_BREADCRUMBS = 200;

export interface AgentDiagnosticsServiceSnapshotState {
  session: AgentDiagnosticsSessionState;
  previousSession: AgentDiagnosticsPreviousSessionState | null;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: readonly AgentDiagnosticsRefreshEvent[];
  breadcrumbs: readonly AgentDiagnosticsBreadcrumb[];
  activeOperations: readonly AgentDiagnosticsActiveOperationState[];
  logs: readonly LogEntry[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
  eventLog: AgentDiagnosticsEventLogState | null;
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
  eventLogPath: string;
  refreshBus: RefreshBus;
  logger: AppLogger;
  buildSnapshot: (state: AgentDiagnosticsServiceSnapshotState) => unknown;
  heartbeatIntervalMs?: number;
  maxRefreshEvents?: number;
  maxLogEntries?: number;
  maxBreadcrumbs?: number;
  maxEventLogBytes?: number;
  now?: () => number;
}

export class AgentDiagnosticsService {
  private readonly adapter: DataAdapter;
  private readonly filePath: string;
  private readonly eventLogPath: string;
  private readonly refreshBus: RefreshBus;
  private readonly logger: AppLogger;
  private readonly buildSnapshot: (state: AgentDiagnosticsServiceSnapshotState) => unknown;
  private readonly heartbeatIntervalMs: number;
  private readonly maxRefreshEvents: number;
  private readonly maxLogEntries: number;
  private readonly maxBreadcrumbs: number;
  private readonly maxEventLogBytes: number;
  private readonly now: () => number;
  private refreshEvents: AgentDiagnosticsRefreshEvent[] = [];
  private breadcrumbs: AgentDiagnosticsBreadcrumb[] = [];
  private activeOperations = new Map<string, AgentDiagnosticsActiveOperationState>();
  private unsubscribers: Array<() => void> = [];
  private heartbeatTimer: number | null = null;
  private nextHeartbeatExpectedAt: number | null = null;
  private session: AgentDiagnosticsSessionState | null = null;
  private previousSession: AgentDiagnosticsPreviousSessionState | null = null;
  private heartbeat: AgentDiagnosticsHeartbeatState = createInitialHeartbeat();
  private fileWrite: AgentDiagnosticsFileWriteState | null = null;
  private eventLog: AgentDiagnosticsEventLogState | null = null;
  private nextEventId = 1;
  private nextBreadcrumbId = 1;
  private writeInProgress = false;
  private eventLogBytes: number | null = null;
  private eventLogAppendQueue: Promise<void> = Promise.resolve();

  constructor(options: AgentDiagnosticsServiceOptions) {
    this.adapter = options.adapter;
    this.filePath = options.filePath;
    this.eventLogPath = options.eventLogPath;
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
    this.maxEventLogBytes = Math.max(
      1,
      Math.floor(options.maxEventLogBytes ?? DEFAULT_DIAGNOSTICS_EVENT_LOG_MAX_BYTES),
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
    this.activeOperations.clear();
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
    this.eventLog = {
      path: this.eventLogPath,
      lastAppendAt: null,
      lastError: null,
    };
    this.eventLogBytes = null;
    this.subscribe();
    this.startHeartbeat();
    void this.appendEventLog({
      type: 'session_start',
      data: {
        sessionId: this.session.id,
      },
    });
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
      await this.appendEventLog({
        type: 'session_stop',
        data: {
          reason,
        },
      });
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
    this.updateActiveOperation(breadcrumb);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - this.maxBreadcrumbs);
    }
    await this.appendEventLog(toBreadcrumbEventLogInput(breadcrumb));
    await this.writeSnapshot('breadcrumb');
  }

  async clearDetailedLogging(): Promise<void> {
    await this.eventLogAppendQueue;
    this.logger.clear();
    this.refreshEvents = [];
    this.breadcrumbs = [];
    this.activeOperations.clear();
    this.previousSession = null;
    this.heartbeat = createInitialHeartbeat();
    this.fileWrite = {
      path: this.filePath,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    this.eventLog = {
      path: this.eventLogPath,
      lastAppendAt: null,
      lastError: null,
    };
    if (await this.adapter.exists(this.filePath)) {
      await this.adapter.remove(this.filePath);
    }
    if (await this.adapter.exists(this.eventLogPath)) {
      await this.adapter.remove(this.eventLogPath);
    }
    const previousEventLogPath = `${this.eventLogPath}.previous`;
    if (await this.adapter.exists(previousEventLogPath)) {
      await this.adapter.remove(previousEventLogPath);
    }
    this.eventLogBytes = 0;
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
      void this.appendEventLog({
        type: 'session_heartbeat',
        data: this.heartbeat,
      });
      if ((this.heartbeat.lastLagMs ?? 0) > 250) {
        void this.appendEventLog({
          type: 'event_loop_lag',
          data: {
            lagMs: this.heartbeat.lastLagMs,
            maxLagMs: this.heartbeat.maxLagMs,
          },
        });
      }
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
    const event = {
      id: this.nextEventId++,
      timestamp: this.now(),
      domain,
      status: result.status,
      detail: result.detail,
      runId: result.runId,
      source: result.source,
    };
    this.refreshEvents.push(event);
    if (this.refreshEvents.length > this.maxRefreshEvents) {
      this.refreshEvents.splice(0, this.refreshEvents.length - this.maxRefreshEvents);
    }
    void this.appendEventLog({
      type: 'refresh_event',
      data: event,
    });
  }

  private handleLoggerEvent(event: LoggerChangeEvent): void {
    if (event.type === 'entry') {
      void this.appendEventLog({
        type: 'log_entry',
        data: event.entry,
      });
      return;
    }
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

  private updateActiveOperation(breadcrumb: AgentDiagnosticsBreadcrumb): void {
    const key = activeOperationKey(breadcrumb.phase, breadcrumb.detail);
    if (breadcrumb.action === 'enter') {
      this.activeOperations.set(key, {
        id: breadcrumb.id,
        phase: breadcrumb.phase,
        detail: breadcrumb.detail,
        startedAt: breadcrumb.timestamp,
        lastUpdatedAt: breadcrumb.timestamp,
        data: breadcrumb.data,
      });
      return;
    }
    if (breadcrumb.action === 'leave' || breadcrumb.action === 'error') {
      this.activeOperations.delete(key);
      return;
    }
    const existing = this.activeOperations.get(key);
    if (!existing) return;
    this.activeOperations.set(key, {
      ...existing,
      lastUpdatedAt: breadcrumb.timestamp,
      data: breadcrumb.data ?? existing.data,
    });
  }

  private appendEventLog(event: AgentDiagnosticsEventLogInput): Promise<void> {
    const operation = this.eventLogAppendQueue.then(() => this.appendEventLogNow(event));
    this.eventLogAppendQueue = operation.catch(() => undefined);
    return operation;
  }

  private async appendEventLogNow(event: AgentDiagnosticsEventLogInput): Promise<void> {
    if (!this.session) return;
    const timestamp = this.now();
    const payload = {
      schemaVersion: 1,
      id: `${this.session.id}:${timestamp}:${this.nextEventId++}`,
      timestamp,
      sessionId: this.session.id,
      type: event.type,
      ...(event.phase ? { phase: event.phase } : {}),
      ...(event.action ? { action: event.action } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
      ...(event.data === undefined ? {} : { data: redactLogValue(event.data) }),
    };
    try {
      const append = (this.adapter as Partial<Pick<DataAdapter, 'append'>>).append;
      if (typeof append !== 'function') {
        this.eventLog = {
          path: this.eventLogPath,
          lastAppendAt: this.eventLog?.lastAppendAt ?? null,
          lastError: 'append unavailable',
        };
        return;
      }
      const dir = this.eventLogPath.split('/').slice(0, -1).join('/');
      if (dir) {
        await this.adapter.mkdir(dir);
      }
      const line = `${JSON.stringify(payload)}\n`;
      const lineBytes = new TextEncoder().encode(line).byteLength;
      await this.rotateEventLogIfNeeded(lineBytes);
      await append.call(this.adapter, this.eventLogPath, line);
      this.eventLogBytes = (this.eventLogBytes ?? 0) + lineBytes;
      this.eventLog = {
        path: this.eventLogPath,
        lastAppendAt: timestamp,
        lastError: null,
      };
    } catch (err) {
      this.eventLog = {
        path: this.eventLogPath,
        lastAppendAt: this.eventLog?.lastAppendAt ?? null,
        lastError: err instanceof Error ? err.message : String(err),
      };
      if (event.type !== 'log_entry') {
        this.logger.warn('Agent diagnostics event log append failed.', {
          source: 'diagnostics',
          data: { path: this.eventLogPath, eventType: event.type },
          error: err,
        });
      }
    }
  }

  private async rotateEventLogIfNeeded(pendingBytes: number): Promise<void> {
    if (this.eventLogBytes === null) {
      const stat = await this.adapter.stat(this.eventLogPath);
      this.eventLogBytes = stat?.type === 'file' ? stat.size : 0;
    }
    if (this.eventLogBytes + pendingBytes <= this.maxEventLogBytes) return;
    await rotatePluginEventLog(this.adapter, this.eventLogPath);
    this.eventLogBytes = 0;
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
      activeOperations: [...this.activeOperations.values()].sort(
        (left, right) => left.startedAt - right.startedAt,
      ),
      logs,
      fileWrite: this.fileWrite,
      eventLog: this.eventLog,
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
    lastActiveOperation: parseLastActiveOperation(value.activeOperations),
    suspectedUncleanShutdown: true,
  };
}

interface AgentDiagnosticsEventLogInput {
  type:
    | 'session_start'
    | 'session_stop'
    | 'session_heartbeat'
    | 'event_loop_lag'
    | 'operation_start'
    | 'operation_end'
    | 'operation_error'
    | 'operation_mark'
    | 'refresh_event'
    | 'log_entry';
  phase?: string;
  action?: AgentDiagnosticsBreadcrumbAction;
  detail?: string;
  data?: unknown;
}

function toBreadcrumbEventLogInput(
  breadcrumb: AgentDiagnosticsBreadcrumb,
): AgentDiagnosticsEventLogInput {
  return {
    type: toBreadcrumbEventType(breadcrumb.action),
    phase: breadcrumb.phase,
    action: breadcrumb.action,
    detail: breadcrumb.detail,
    data: breadcrumb.data,
  };
}

function toBreadcrumbEventType(
  action: AgentDiagnosticsBreadcrumbAction,
): AgentDiagnosticsEventLogInput['type'] {
  if (action === 'enter') return 'operation_start';
  if (action === 'leave') return 'operation_end';
  if (action === 'error') return 'operation_error';
  return 'operation_mark';
}

function activeOperationKey(phase: string, detail: string | undefined): string {
  return `${phase}\u0000${detail ?? ''}`;
}

function parseLastActiveOperation(value: unknown): AgentDiagnosticsActiveOperationState | null {
  if (!Array.isArray(value)) return null;
  const operations = value
    .map(parseActiveOperation)
    .filter((operation): operation is AgentDiagnosticsActiveOperationState => operation !== null)
    .sort((left, right) => left.startedAt - right.startedAt);
  return operations.at(-1) ?? null;
}

function parseActiveOperation(value: unknown): AgentDiagnosticsActiveOperationState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'number' ||
    typeof value.phase !== 'string' ||
    typeof value.startedAt !== 'number' ||
    typeof value.lastUpdatedAt !== 'number'
  ) {
    return null;
  }
  return {
    id: value.id,
    phase: value.phase,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    startedAt: value.startedAt,
    lastUpdatedAt: value.lastUpdatedAt,
    data: value.data,
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
