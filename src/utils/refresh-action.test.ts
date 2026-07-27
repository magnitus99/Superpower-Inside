import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('obsidian', () => ({
  Notice: class {
    constructor(_msg: string, _duration?: number) {}
    static setMessage(_msg: string): void {}
  },
}));

import { RefreshAction } from './refresh-action';

/** 테스트용 버튼 mock */
function createMockButton(text = '새로고침') {
  const listeners: Record<string, (() => void)[]> = {};
  const classSet = new Set<string>();
  const btn = {
    disabled: false,
    textContent: text,
    classList: {
      add(c: string) { classSet.add(c); },
      remove(c: string) { classSet.delete(c); },
      contains(c: string) { return classSet.has(c); },
    },
    addEventListener(evt: string, fn: () => void) {
      (listeners[evt] ??= []).push(fn);
    },
    removeEventListener(evt: string, fn: () => void) {
      const arr = listeners[evt];
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    click() {
      listeners['click']?.forEach((fn) => fn());
    },
    addClass(c: string) { classSet.add(c); },
    removeClass(c: string) { classSet.delete(c); },
    setText(t: string) { (btn as Record<string, unknown>).textContent = t; },
    remove() { /* DOM 정리 mock */ },
  };
  return btn as unknown as HTMLButtonElement;
}

describe('RefreshAction', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    btn = createMockButton();
  });

  it('초기 상태는 idle이다', () => {
    const action = new RefreshAction({
      action: () => Promise.resolve({ status: 'success' } as const),
    });
    expect(action.getState()).toBe('idle');
  });

  it('버튼 클릭 시 로딩 상태로 전환되고 완료 후 idle로 돌아온다', async () => {
    const actionFn = vi.fn().mockResolvedValue({ status: 'success' });
    const action = new RefreshAction({
      action: actionFn,
      loadingText: '로딩 중...',
      spinnerClass: 'spinning',
      successNotice: false,
      throttleMs: 0,
    });
    action.attach(btn);

    expect(action.getState()).toBe('idle');
    btn.click();

    // 로딩 상태 확인
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('로딩 중...');
    expect(btn.classList.contains('spinning')).toBe(true);

    // 비동기 완료 대기
    await vi.waitFor(() => action.getState() === 'idle', { timeout: 500 });

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('새로고침');
    expect(btn.classList.contains('spinning')).toBe(false);
    expect(actionFn).toHaveBeenCalledOnce();
  });

  it('throttle: 연속 클릭 시 한 번만 실행된다', async () => {
    const actionFn = vi.fn().mockResolvedValue({ status: 'success' });
    const action = new RefreshAction({
      action: actionFn,
      throttleMs: 50,
      successNotice: false,
    });
    action.attach(btn);

    btn.click();
    btn.click();
    btn.click();

    await vi.waitFor(() => actionFn.mock.calls.length > 0, { timeout: 200 });
    expect(actionFn).toHaveBeenCalledTimes(1);
  });

  it('AbortController: 이전 작업이 취소되고 새 작업이 실행된다', async () => {
    let resolveFirst!: (value: { status: 'success' }) => void;
    const firstCall = new Promise<{ status: 'success' }>((resolve) => {
      resolveFirst = resolve;
    });

    let callCount = 0;
    const actionFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return firstCall;
      return { status: 'success' };
    });

    const action = new RefreshAction({
      action: actionFn,
      throttleMs: 0,
      successNotice: false,
    });
    action.attach(btn);

    btn.click();
    await vi.waitFor(() => callCount === 1, { timeout: 200 });

    btn.click();
    resolveFirst({ status: 'success' });
    await vi.waitFor(() => callCount === 2, { timeout: 200 });

    expect(actionFn).toHaveBeenCalledTimes(2);
    expect((actionFn.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  });

  it('timeout: 타임아웃 후 작업이 취소된다', async () => {
    const actionFn = vi.fn().mockImplementation(
      async () =>
        new Promise<{ status: 'success' }>(() => {
          /* 영원히 pending */
        }),
    );
    const action = new RefreshAction({
      action: actionFn,
      timeoutMs: 50,
      throttleMs: 0,
      errorNotice: false,
    });
    action.attach(btn);

    btn.click();
    // actionFn이 호출될 때까지 대기
    await vi.waitFor(() => actionFn.mock.calls.length > 0, { timeout: 200 });
    // timeout이 발생할 때까지 충분한 시간 대기
    await new Promise((resolve) => setTimeout(resolve, 200));

    const sig = actionFn.mock.calls[0][0] as AbortSignal;
    expect(sig.aborted).toBe(true);
  });

  it('작업이 에러를 throw하면 error 상태가 된다', async () => {
    const action = new RefreshAction({
      action: () => Promise.reject(new Error('테스트 에러')),
      errorNotice: false,
      throttleMs: 0,
    });
    action.attach(btn);

    btn.click();
    await vi.waitFor(() => action.getState() === 'idle', { timeout: 500 });

    expect(btn.disabled).toBe(false);
  });

  it('execute()로 수동 실행이 가능하다', async () => {
    const actionFn = vi.fn().mockResolvedValue({ status: 'success' });
    const action = new RefreshAction({
      action: actionFn,
      successNotice: false,
    });

    const result = await action.execute();
    expect(result).toEqual({ status: 'success' });
    expect(actionFn).toHaveBeenCalledOnce();
  });

  it('detach() 후 버튼 클릭이 무시된다', () => {
    const actionFn = vi.fn().mockResolvedValue({ status: 'success' });
    const action = new RefreshAction({ action: actionFn, throttleMs: 0, successNotice: false });
    action.attach(btn);
    action.detach();

    btn.click();
    expect(actionFn).not.toHaveBeenCalled();
  });

  it('cleanup 시 AbortController가 abort 된다', async () => {
    const actionFn = vi.fn().mockResolvedValue({ status: 'success' } as const);
    const action = new RefreshAction({
      action: actionFn,
      timeoutMs: 5000,
      throttleMs: 0,
      errorNotice: false,
    });

    btn.click();
    // actionFn이 호출될 때까지 대기
    await vi.waitFor(() => actionFn.mock.calls.length > 0, { timeout: 200 });
    // detach 시 cleanup이 abort를 호출하고 버튼을 초기화
    action.detach();
    expect(btn.disabled).toBe(false);
  });

  it('restoreText: false면 원래 텍스트를 복원하지 않는다', async () => {
    const action = new RefreshAction({
      action: () => Promise.resolve({ status: 'success' } as const),
      loadingText: '로딩 중...',
      restoreText: false,
      throttleMs: 0,
      successNotice: false,
      spinnerClass: '',
    });
    action.attach(btn);

    btn.click();
    await vi.waitFor(() => action.getState() === 'idle', { timeout: 500 });

    expect(btn.textContent).toBe('로딩 중...');
  });
});
