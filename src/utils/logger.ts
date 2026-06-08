export type LogLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  source?: string;
  data?: unknown;
  error?: unknown;
}

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
  error?: string;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  maxEntries: number;
  mirrorToConsole: boolean;
}

export type LoggerChangeEvent =
  | { type: 'entry'; entry: LogEntry }
  | { type: 'clear' }
  | { type: 'config'; config: LoggerConfig };

export type LoggerSubscriber = (event: LoggerChangeEvent) => void;

export const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'notice',
  'warn',
  'error',
  'fatal',
];

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  notice: 'NOTICE',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
};

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'var(--text-faint)',
  debug: 'var(--text-muted)',
  info: 'var(--text-normal)',
  notice: 'var(--text-accent)',
  warn: 'var(--text-warning)',
  error: 'var(--text-error)',
  fatal: 'var(--color-red)',
};

const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  minLevel: 'info',
  maxEntries: 1000,
  mirrorToConsole: true,
};

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|token|secret|password|credential|cookie|session)/iu;
const SENSITIVE_VALUE_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})/u;

let nextLogId = 1;

export function getLogLevelPriority(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export function normalizeLogLevel(value: unknown, fallback: LogLevel = 'info'): LogLevel {
  return typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel)
    ? (value as LogLevel)
    : fallback;
}

export function normalizeLoggerConfig(value: Partial<LoggerConfig> | undefined): LoggerConfig {
  return {
    minLevel: normalizeLogLevel(value?.minLevel, DEFAULT_LOGGER_CONFIG.minLevel),
    maxEntries: clampInteger(value?.maxEntries, 1, 10000, DEFAULT_LOGGER_CONFIG.maxEntries),
    mirrorToConsole:
      typeof value?.mirrorToConsole === 'boolean'
        ? value.mirrorToConsole
        : DEFAULT_LOGGER_CONFIG.mirrorToConsole,
  };
}

export function redactLogValue(value: unknown, keyHint = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return SENSITIVE_VALUE_PATTERN.test(value) ? '[REDACTED]' : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = redactLogValue(nestedValue, key);
    }
    return result;
  }

  return value;
}

export function formatLogError(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) {
    const text = error.stack || error.message;
    const redacted = redactLogValue(text);
    return typeof redacted === 'string' ? redacted : text;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(redactLogValue(error));
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  if (typeof error === 'string') {
    const redacted = redactLogValue(error);
    return typeof redacted === 'string' ? redacted : error;
  }
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return error.toString();
  }
  if (typeof error === 'symbol') {
    return error.description ?? 'symbol';
  }
  return 'unknown';
}

export class AppLogger {
  private config: LoggerConfig;
  private readonly entries: LogEntry[] = [];
  private readonly subscribers = new Set<LoggerSubscriber>();

  constructor(config?: Partial<LoggerConfig>) {
    this.config = normalizeLoggerConfig(config);
  }

  configure(config: Partial<LoggerConfig>): void {
    this.config = normalizeLoggerConfig({ ...this.config, ...config });
    this.trimEntries();
    this.emit({ type: 'config', config: this.getConfig() });
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  child(source: string): ScopedLogger {
    return new ScopedLogger(this, source);
  }

  subscribe(subscriber: LoggerSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
    this.emit({ type: 'clear' });
  }

  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  notice(message: string, context?: LogContext): void {
    this.log('notice', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.log('fatal', message, context);
  }

  log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (getLogLevelPriority(level) < getLogLevelPriority(this.config.minLevel)) {
      return;
    }

    const entry: LogEntry = {
      id: nextLogId++,
      timestamp: Date.now(),
      level,
      source: context.source?.trim() || 'core',
      message,
      data: context.data === undefined ? undefined : redactLogValue(context.data),
      error: formatLogError(context.error),
    };
    this.entries.push(entry);
    this.trimEntries();
    this.mirror(entry);
    this.emit({ type: 'entry', entry });
  }

  private trimEntries(): void {
    const overflow = this.entries.length - this.config.maxEntries;
    if (overflow > 0) {
      this.entries.splice(0, overflow);
    }
  }

  private emit(event: LoggerChangeEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // 로그 구독자의 오류는 런타임 흐름을 막지 않는다.
      }
    }
  }

  private mirror(entry: LogEntry): void {
    if (!this.config.mirrorToConsole) return;
    const payload = entry.data ?? entry.error;
    const prefix = `[Superpower Inside][${LOG_LEVEL_LABELS[entry.level]}][${entry.source}] ${entry.message}`;
    if (entry.level === 'trace' || entry.level === 'debug') {
      console.debug(prefix, payload ?? '');
      return;
    }
    if (entry.level === 'warn') {
      console.warn(prefix, payload ?? '');
      return;
    }
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(prefix, payload ?? '');
      return;
    }
    console.info(prefix, payload ?? '');
  }
}

export class ScopedLogger {
  constructor(
    private readonly logger: AppLogger,
    private readonly source: string,
  ) {}

  trace(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.trace(message, { ...context, source: this.source });
  }

  debug(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.debug(message, { ...context, source: this.source });
  }

  info(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.info(message, { ...context, source: this.source });
  }

  notice(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.notice(message, { ...context, source: this.source });
  }

  warn(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.warn(message, { ...context, source: this.source });
  }

  error(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.error(message, { ...context, source: this.source });
  }

  fatal(message: string, context?: Omit<LogContext, 'source'>): void {
    this.logger.fatal(message, { ...context, source: this.source });
  }
}

export function createLogger(config?: Partial<LoggerConfig>): AppLogger {
  return new AppLogger(config);
}

export const appLogger = createLogger();

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
