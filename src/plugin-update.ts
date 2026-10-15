import { Notice, requestUrl, type App } from 'obsidian';
import { t } from './i18n';
import type { AppLogger } from './utils/logger';

/** 저장소 리모트(origin)의 최신 릴리스. 버전 번호가 아니라 '더 새로운 릴리스가 있는지'만 확인합니다. */
const RELEASE_API_URL = 'https://api.github.com/repos/magnitus99/Superpower-Inside/releases/latest';
/** 확인 간격. 확인 결과와 무관하게 하루에 한 번만 조회합니다. */
export const UPDATE_CHECK_INTERVAL_MS = 86_400_000;
/** 확인 시각·확인된 태그·알림 시각·알림 사용 여부만 저장합니다. 키·토큰은 저장하지 않습니다. */
const STORAGE_KEY = 'superpower-inside.update-check';

interface PluginUpdateState {
  /** 마지막 확인 시각(ms). 실패·오프라인도 확인으로 기록해 하루 동안 재시도하지 않습니다. */
  checkedAt: number;
  /** 확인된 최신 태그. null이면 현재 버전이 최신이거나 릴리스를 조회할 수 없는 상태입니다. */
  latestTag: string | null;
  /** 마지막 알림 시각(ms). 토스트는 하루에 한 번만 표시합니다. */
  notifiedAt: number;
  /** 토스트 알림 표시 여부(기본 true). 설정 화면 안내는 이 값과 무관하게 항상 표시됩니다. */
  noticeEnabled: boolean;
}

/**
 * 릴리스 태그를 하루에 한 번 확인해 현재 버전이 이전 버전인지 판단합니다.
 * 사용자에게는 버전 번호를 보여주지 않고 새 기능 안내만 전달합니다.
 */
export class PluginUpdateChecker {
  private state: PluginUpdateState;
  private pending: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly currentVersion: string,
    private readonly logger: AppLogger,
    /** 안내 표시가 바뀔 때 열려 있는 설정 화면을 갱신합니다. */
    private readonly onAvailabilityChange: () => void,
  ) {
    this.state = readStoredState(app);
  }

  /** 현재 버전보다 새로운 릴리스가 확인된 상태인지 여부. */
  get available(): boolean {
    return isOutdated(this.currentVersion, this.state.latestTag);
  }

  /** 토스트 알림 표시 여부. 설정 화면의 새 버전 안내와는 무관합니다. */
  get noticeEnabled(): boolean {
    return this.state.noticeEnabled;
  }

  setNoticeEnabled(enabled: boolean): void {
    this.state = { ...this.state, noticeEnabled: enabled };
    this.app.saveLocalStorage(STORAGE_KEY, this.state);
  }

  /**
   * 마지막 확인에서 하루가 지난 경우에만 릴리스를 조회합니다.
   * 진행 중인 요청은 공유하고, dispose 뒤 도착한 결과는 반영하지 않습니다.
   */
  check(): Promise<void> {
    if (this.disposed) return this.pending ?? Promise.resolve();
    if (this.pending) return this.pending;
    if (Date.now() - this.state.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      this.logger.trace('Update check skipped until the daily interval elapses.', {
        source: 'update.check',
        data: { checkedAt: this.state.checkedAt },
      });
      return Promise.resolve();
    }
    this.pending = this.runCheck().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** 플러그인 언로드 시 호출합니다. 이후 응답은 저장·알림을 실행하지 않습니다. */
  dispose(): void {
    this.disposed = true;
  }

  private async runCheck(): Promise<void> {
    let latestTag = this.state.latestTag;
    let outdated = false;
    try {
      const response = await requestUrl({
        url: RELEASE_API_URL,
        throw: false,
        headers: { accept: 'application/vnd.github+json' },
      });
      if (this.disposed) return;
      if (response.status === 404) {
        // 릴리스 철회: 확인된 새 버전이 사라졌으므로 안내를 지웁니다.
        latestTag = null;
      } else if (response.status === 200) {
        latestTag = readLatestTag(response.json);
        outdated = isOutdated(this.currentVersion, latestTag);
      } else {
        // 일시적인 응답 오류: 기존 안내를 유지하고 다음 확인까지 재시도하지 않습니다.
        this.logger.warn('Update check returned an unexpected status.', {
          source: 'update.check',
          data: { status: response.status },
        });
      }
    } catch (error) {
      if (this.disposed) return;
      this.logger.warn('Update check request failed.', { source: 'update.check', error });
    }
    this.commit({ ...this.state, checkedAt: Date.now(), latestTag }, outdated);
  }

  private commit(next: PluginUpdateState, outdated: boolean): void {
    const changed = this.available !== isOutdated(this.currentVersion, next.latestTag);
    // 토스트는 하루에 한 번만 보냅니다. 설정 화면 안내는 이 제한과 무관합니다.
    const shouldNotify =
      outdated &&
      next.noticeEnabled &&
      Date.now() - next.notifiedAt >= UPDATE_CHECK_INTERVAL_MS;
    if (shouldNotify) next.notifiedAt = Date.now();
    this.state = next;
    this.app.saveLocalStorage(STORAGE_KEY, next);
    if (changed) this.onAvailabilityChange();
    if (shouldNotify) {
      this.logger.notice('A newer release is available.', { source: 'update.check' });
      new Notice(`[Superpower-Inside] ${t('settingsUpdateAvailable')}`);
    }
  }
}

function readStoredState(app: App): PluginUpdateState {
  const raw: unknown = app.loadLocalStorage(STORAGE_KEY);
  if (typeof raw !== 'object' || raw === null)
    return { checkedAt: 0, latestTag: null, notifiedAt: 0, noticeEnabled: true };
  const { checkedAt, latestTag, notifiedAt, noticeEnabled } = raw as {
    checkedAt?: unknown;
    latestTag?: unknown;
    notifiedAt?: unknown;
    noticeEnabled?: unknown;
  };
  return {
    checkedAt:
      typeof checkedAt === 'number' && Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt : 0,
    latestTag: typeof latestTag === 'string' ? latestTag : null,
    notifiedAt:
      typeof notifiedAt === 'number' && Number.isFinite(notifiedAt) && notifiedAt > 0
        ? notifiedAt
        : 0,
    noticeEnabled: noticeEnabled !== false,
  };
}

function readLatestTag(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const tag = (payload as { tag_name?: unknown }).tag_name;
  if (typeof tag !== 'string') return null;
  return tag.trim() === '' ? null : tag.trim();
}

/** 현재 버전보다 새 태그가 있으면 true. 형식을 해석할 수 없으면 알리지 않습니다. */
function isOutdated(currentVersion: string, latestTag: string | null): boolean {
  if (!latestTag) return false;
  const latest = parseVersion(latestTag);
  const current = parseVersion(currentVersion);
  if (!latest || !current) return false;
  const length = Math.max(latest.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const left = latest[index] ?? 0;
    const right = current[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** 숫자와 점으로 된 태그·버전을 숫자 구간으로 나눕니다. 형식이 다르면 null입니다. */
function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)$/u.exec(value.trim());
  const digits = match?.[1];
  if (!digits) return null;
  return digits.split('.').map((part) => Number(part));
}
