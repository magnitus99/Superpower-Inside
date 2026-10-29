import type { ProviderProfileConfig } from '../settings';
import type { AppLogger } from '../utils/logger';
import { normalizeQuotaIntervalSecondsRust } from '../rag/rust-core';
import {
  fetchProviderQuota,
  getProviderQuotaIdentity,
  type ProviderQuotaResult,
} from './provider-quota-api';

export const DEFAULT_QUOTA_INTERVAL_SECONDS = 30;
const REQUEST_DEADLINE_MS = 15000;
export type ProviderQuotaState = ProviderQuotaResult | { status: 'loading' };

interface QuotaEntry {
  profile: ProviderProfileConfig;
  identity: string;
  state: ProviderQuotaState;
  inFlight: boolean;
  generation: number;
  nextDue: number;
  retryAt: number;
  deadline?: number;
}
interface ProviderQuotaServiceOptions {
  getProfiles(): readonly ProviderProfileConfig[];
  getIntervalSeconds(): unknown;
  onChange(profileId: string): void;
  fetchQuota?: (profile: ProviderProfileConfig) => Promise<ProviderQuotaResult>;
  identity?: (profile: ProviderProfileConfig) => string;
  logger?: AppLogger;
}

/** 한 플러그인 수명에서 설정과 모든 채팅 창이 공유하는 조회기입니다. */
export class ProviderQuotaService {
  private readonly entries = new Map<string, QuotaEntry>();
  private timer: number | undefined;
  private intervalSeconds = DEFAULT_QUOTA_INTERVAL_SECONDS;
  private disposed = false;
  private started = false;
  private readonly fetchQuota: NonNullable<ProviderQuotaServiceOptions['fetchQuota']>;
  private readonly identity: NonNullable<ProviderQuotaServiceOptions['identity']>;

  constructor(private readonly options: ProviderQuotaServiceOptions) {
    this.fetchQuota = options.fetchQuota ?? fetchProviderQuota;
    this.identity = options.identity ?? getProviderQuotaIdentity;
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.configure();
  }

  /** 저장 반복은 기존 타이머를 유지하고, 실제 간격 변경만 다시 예약합니다. */
  configure(): void {
    if (this.disposed || !this.started) return;
    const interval = normalizeQuotaIntervalSecondsRust(this.options.getIntervalSeconds());
    if (interval === null) return;
    if (this.timer === undefined || interval !== this.intervalSeconds) {
      if (this.timer !== undefined) window.clearInterval(this.timer);
      this.intervalSeconds = interval;
      for (const entry of this.entries.values()) entry.nextDue = 0;
      this.timer = window.setInterval(() => this.refresh(), interval * 1000);
    }
    this.refresh();
  }

  get(profileId: string): ProviderQuotaState | undefined {
    const entry = this.entries.get(profileId);
    if (!entry) return undefined;
    const current = this.options.getProfiles().find((profile) => profile.id === profileId);
    if (!current || this.identity(current) !== entry.identity) return undefined;
    return entry.state;
  }

  /** 시작·설정 변경·주기 호출은 모두 이 함수와 연결별 중복/대기 규칙을 사용합니다. */
  refresh(): void {
    if (this.disposed || !this.started) return;
    const profiles = this.options.getProfiles();
    const ids = new Set(profiles.map((profile) => profile.id));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) {
        if (entry.deadline !== undefined) window.clearTimeout(entry.deadline);
        this.entries.delete(id);
      }
    }
    for (const profile of profiles) {
      const identity = this.identity(profile);
      let entry = this.entries.get(profile.id);
      if (!entry || entry.identity !== identity) {
        if (entry?.deadline !== undefined) window.clearTimeout(entry.deadline);
        entry = {
          profile: { ...profile },
          identity,
          state: profile.enabled ? { status: 'loading' } : { status: 'disabled' },
          inFlight: false,
          generation: 0,
          nextDue: 0,
          retryAt: 0,
        };
        this.entries.set(profile.id, entry);
        this.options.onChange(profile.id);
      }
      if (!profile.enabled) continue;
      if (entry.inFlight || Date.now() < entry.nextDue || Date.now() < entry.retryAt) {
        this.options.logger?.trace('Provider quota refresh skipped.', {
          source: 'llm.quota',
          data: {
            reason: entry.inFlight
              ? 'in-flight'
              : Date.now() < entry.retryAt
                ? 'backoff'
                : 'interval',
          },
        });
        continue;
      }
      void this.query(entry);
    }
  }

  private isCurrent(entry: QuotaEntry): boolean {
    return (
      !this.disposed &&
      this.entries.get(entry.profile.id) === entry &&
      this.options
        .getProfiles()
        .some(
          (profile) => profile.id === entry.profile.id && this.identity(profile) === entry.identity,
        )
    );
  }

  private async query(entry: QuotaEntry): Promise<void> {
    entry.inFlight = true;
    const generation = ++entry.generation;
    const isCurrentQuery = (): boolean => this.isCurrent(entry) && entry.generation === generation;
    entry.nextDue = Date.now() + this.intervalSeconds * 1000;
    let expired = false;
    const deadline = window.setTimeout(() => {
      expired = true;
      if (!isCurrentQuery()) return;
      entry.inFlight = false;
      entry.deadline = undefined;
      entry.state = { status: 'unavailable', reason: 'timeout' };
      this.options.onChange(entry.profile.id);
    }, REQUEST_DEADLINE_MS);
    entry.deadline = deadline;
    try {
      const result = await this.fetchQuota(entry.profile);
      if (!isCurrentQuery() || expired) return;
      if ('retryAfterMs' in result && result.retryAfterMs !== undefined) {
        entry.retryAt = Date.now() + result.retryAfterMs;
      }
      entry.state = result;
      if (result.status === 'unavailable') {
        this.options.logger?.debug('Provider quota unavailable.', {
          source: 'llm.quota',
          data: { reason: result.reason },
        });
      }
      this.options.onChange(entry.profile.id);
    } catch {
      if (!isCurrentQuery() || expired) return;
      entry.state = { status: 'unavailable', reason: 'network' };
      this.options.onChange(entry.profile.id);
    } finally {
      window.clearTimeout(deadline);
      if (isCurrentQuery()) {
        entry.deadline = undefined;
        entry.inFlight = false;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    for (const entry of this.entries.values()) {
      if (entry.deadline !== undefined) window.clearTimeout(entry.deadline);
    }
    this.entries.clear();
  }
}
