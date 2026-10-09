import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { RetiredArtifactService } from './retired-artifacts';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../utils/modal-prompts', () => ({ confirmWithModal: mocks.confirm }));
vi.mock('obsidian', () => ({
  Notice: class {},
  Setting: class {
    descEl: ElementFixture;
    constructor(readonly container: ElementFixture) {
      this.descEl = container.createDiv();
    }
    setName() {
      return this;
    }
    addButton(callback: (button: ButtonFixture) => void) {
      callback(new ButtonFixture(this.container));
      return this;
    }
  },
}));
import { buildRetiredArtifactSettings } from './retired-artifacts-settings';
import { setLanguage, t } from '../i18n';

class ElementFixture {
  textContent = '';
  disabled = false;
  isConnected = true;
  children: ElementFixture[] = [];
  attributes = new Map<string, string>();
  click = async () => {};
  focus = vi.fn();
  createDiv() {
    const child = new ElementFixture();
    this.children.push(child);
    return child;
  }
  setText(value: string) {
    this.textContent = value;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
}

class ButtonFixture {
  readonly buttonEl: ElementFixture;
  constructor(container: ElementFixture) {
    this.buttonEl = container.createDiv();
  }
  setDisabled(value: boolean) {
    this.buttonEl.disabled = value;
    return this;
  }
  setButtonText(value: string) {
    this.buttonEl.setText(value);
    return this;
  }
  onClick(callback: () => Promise<void>) {
    this.buttonEl.click = callback;
    return this;
  }
}

function fixture() {
  const root = new ElementFixture();
  const scan = vi.fn(() =>
    Promise.resolve({ bytes: 1_000_000, hasArtifacts: true, capacity: '1.00', revision: 1 }),
  );
  const cleanup = vi.fn(() => Promise.resolve({ failed: 0, changed: false }));
  buildRetiredArtifactSettings(
    root as unknown as HTMLElement,
    {} as App,
    { scan, cleanup } as unknown as RetiredArtifactService,
  );
  const [status, button] = root.children;
  return { root, status, button, scan, cleanup };
}

describe('생성물 정리 설정의 선택과 상태', () => {
  beforeEach(() => {
    setLanguage('ko');
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(false);
  });

  it('용량만 안내하고 유지 선택은 데이터를 삭제하지 않는다', async () => {
    const { button, status, cleanup } = fixture();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(status.textContent).toBe(t('retiredArtifactsSize', { size: '1.00' }));
    expect(status.attributes.get('aria-live')).toBe('polite');
    await button.click();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.anything(),
      t('retiredArtifactsConfirm', { size: '1.00' }),
      {
        confirmText: t('retiredArtifactsDelete'),
        cancelText: t('retiredArtifactsKeep'),
        ctaClass: 'mod-warning',
      },
    );
    expect(cleanup).not.toHaveBeenCalled();
    expect(button.focus).toHaveBeenCalled();
  });

  it('삭제 중에는 비활성화하고 완료 후 빈 상태를 표시한다', async () => {
    const { button, status, cleanup, scan } = fixture();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    mocks.confirm.mockResolvedValue(true);
    let finish: ((value: { failed: number; changed: boolean }) => void) | undefined;
    cleanup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    scan.mockResolvedValueOnce({ bytes: 0, hasArtifacts: false, capacity: '0.00', revision: 1 });
    const action = button.click();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe(t('retiredArtifactsRunning'));
    finish?.({ failed: 0, changed: false });
    await action;
    expect(status.textContent).toBe(t('retiredArtifactsEmpty'));
    expect(button.disabled).toBe(true);
  });

  it('조회 실패는 재확인으로 복구하고 부분 실패는 남은 용량과 함께 표시한다', async () => {
    const { button, status, scan, cleanup } = fixture();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    mocks.confirm.mockResolvedValue(true);
    cleanup.mockResolvedValueOnce({ failed: 1, changed: false });
    await button.click();
    expect(status.textContent).toContain(t('retiredArtifactsPartial'));
    expect(status.textContent).toContain('1.00 MB');
    scan.mockRejectedValueOnce(new Error('read failed'));
    await button.click();
    expect(status.textContent).toBe(t('retiredArtifactsScanFailed'));
    expect(button.textContent).toBe(t('retiredArtifactsRetry'));
    const deleted = cleanup.mock.calls.length;
    await button.click();
    expect(cleanup).toHaveBeenCalledTimes(deleted);
    expect(button.textContent).toBe(t('retiredArtifactsReview'));
  });

  it('사라진 설정 화면에는 늦은 조회 결과를 반영하지 않는다', async () => {
    const { root, status, button } = fixture();
    root.isConnected = false;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(status.textContent).toBe(t('retiredArtifactsScanning'));
    expect(button.disabled).toBe(true);
  });
});
