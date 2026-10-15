import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { AppLogger } from './utils/logger';

const host = vi.hoisted(() => ({ request: vi.fn(), notice: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: host.request, Notice: host.notice }));
import { PluginUpdateChecker } from './plugin-update';
import { setLanguage } from './i18n';

const DAY = 86_400_000;
const release = (tag: string) => ({ status: 200, json: { tag_name: tag, draft: false, prerelease: false } });

describe('플러그인 업데이트 확인', () => {
  let stored: unknown;
  let now: number;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let app: App;
  const create = (version = '1.0.0') => new PluginUpdateChecker(app, version, new AppLogger(), changed);

  beforeEach(() => {
    vi.useFakeTimers();
    now = Date.UTC(2026, 9, 15);
    vi.setSystemTime(now);
    vi.clearAllMocks();
    setLanguage('ko');
    stored = null;
    changed = vi.fn<() => void>();
    app = {
      loadLocalStorage: () => stored,
      saveLocalStorage: (_key: string, value: unknown) => { stored = value; },
    } as unknown as App;
    host.request.mockResolvedValue(release('1.1.0'));
  });

  it('새 릴리스를 알리고 재시작·중복 호출·24시간 미만에는 다시 요청하거나 알리지 않는다', async () => {
    const checker = create();
    await Promise.all([checker.check(), checker.check()]);
    expect(checker.available).toBe(true);
    expect(host.request).toHaveBeenCalledTimes(1);
    expect(host.request.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://api.github.com/repos/magnitus99/Superpower-Inside/releases/latest',
      throw: false,
    });
    expect(host.notice).toHaveBeenCalledTimes(1);
    expect(host.notice.mock.calls[0]?.[0]).not.toContain('1.1.0');
    // 알림만 보고는 어떤 플러그인인지 알 수 없으므로 제품 이름을 접두합니다.
    expect(host.notice.mock.calls[0]?.[0]).toMatch(/^\[Superpower-Inside\] /u);
    const restarted = create();
    expect(restarted.available).toBe(true);
    vi.setSystemTime(now + DAY - 1);
    await restarted.check();
    expect(host.request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + DAY);
    await restarted.check();
    expect(host.request).toHaveBeenCalledTimes(2);
    expect(host.notice).toHaveBeenCalledTimes(2);
  });

  it('토스트는 하루 한 번만 보내고 토글을 끄면 알림만 멈춘다', async () => {
    // 최근에 이미 알린 상태라면 새 확인이 이뤄져도 24시간 안에는 다시 알리지 않는다.
    stored = {
      checkedAt: now - DAY - 1,
      latestTag: null,
      notifiedAt: now - 3_600_000,
      noticeEnabled: true,
    };
    const checker = create();
    await checker.check();
    expect(checker.available).toBe(true);
    expect(host.notice).not.toHaveBeenCalled();

    // 토글을 끄면 알림 없이 안내 상태만 유지되고 저장된 값을 따릅니다.
    checker.setNoticeEnabled(false);
    vi.setSystemTime(now + DAY * 2);
    await checker.check();
    expect(checker.available).toBe(true);
    expect(host.notice).not.toHaveBeenCalled();
    expect(create().noticeEnabled).toBe(false);

    // 다시 켜면 다음 확인에서 하루 한 번 알림이 재개됩니다.
    checker.setNoticeEnabled(true);
    expect(create().noticeEnabled).toBe(true);
    vi.setSystemTime(now + DAY * 3);
    await checker.check();
    expect(host.notice).toHaveBeenCalledTimes(1);
  });

  it('업데이트 설치 후에는 이전 안내를 숨기고 같은 버전과 개발 중인 높은 버전은 알리지 않는다', async () => {
    await create().check();
    const updated = create('1.1.0');
    expect(updated.available).toBe(false);
    await updated.check();
    expect(host.notice).toHaveBeenCalledTimes(1);
    const ahead = create('2.0.0');
    await ahead.check();
    expect(ahead.available).toBe(false);
  });

  it('릴리스 철회는 다음 일일 확인에서 안내를 지운다', async () => {
    const checker = create();
    await checker.check();
    vi.setSystemTime(now + DAY);
    host.request.mockResolvedValue({ status: 404 });
    await checker.check();
    expect(checker.available).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429, 500])('HTTP %s는 기존 안내를 보존하고 하루 동안 재시도·재알림하지 않는다', async (status) => {
    const checker = create();
    await checker.check();
    vi.setSystemTime(now + DAY);
    host.request.mockResolvedValue({ status });
    await checker.check();
    await create().check();
    expect(checker.available).toBe(true);
    expect(host.request).toHaveBeenCalledTimes(2);
    expect(host.notice).toHaveBeenCalledTimes(1);
  });

  it('오프라인과 잘못된 응답은 알림 없이 하루 뒤 다시 확인한다', async () => {
    host.request.mockRejectedValue(new Error('offline'));
    const checker = create();
    await checker.check();
    await checker.check();
    expect(host.request).toHaveBeenCalledTimes(1);
    expect(checker.available).toBe(false);
    vi.setSystemTime(now + DAY);
    host.request.mockResolvedValue({ status: 200, json: { tag_name: 'invalid' } });
    await checker.check();
    expect(checker.available).toBe(false);
    expect(host.notice).not.toHaveBeenCalled();
  });

  it('해제 뒤 도착한 응답은 저장·화면 갱신·알림을 실행하지 않는다', async () => {
    let finish: (value: unknown) => void = () => {};
    host.request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const checker = create();
    const pending = checker.check();
    checker.dispose();
    const before = stored;
    finish(release('1.1.0'));
    await pending;
    expect(stored).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    expect(host.notice).not.toHaveBeenCalled();
  });
});
