import { Notice } from 'obsidian';
import { t } from '../i18n';

// ── 타입 ────────────────────────────────────────────────────────────

/** 새로고침 동작의 현재 상태 */
export type RefreshState = 'idle' | 'loading' | 'success' | 'error';

/** 액션 실행 결과 */
export interface RefreshResult {
  progress?: import('../graph/indexing-runner').GraphRagIndexingProgress;
  status: 'success' | 'partial' | 'error';
  detail?: string;
  runId?: number;
  source?: 'graph-run' | 'graph-cleanup';
}

/** RefreshAction 생성 옵션 */
export interface RefreshActionOptions {
  /** 실제 새로고침을 수행하는 비동기 함수. AbortSignal을 받아 취소 가능해야 함. */
  action: (signal: AbortSignal) => Promise<RefreshResult>;
  /** 로딩 중 버튼 텍스트 (기본값: "새로고침 중...") */
  loadingText?: string;
  /** 성공 시 표시할 Notice 메시지. false면 Notice를 띄우지 않음 */
  successNotice?: string | false;
  /** 실패 시 표시할 Notice 메시지. false면 Notice를 띄우지 않음 */
  errorNotice?: string | false;
  /** 연속 클릭 방지 throttle (ms). 기본값 300 */
  throttleMs?: number;
  /** 타임아웃 (ms). 기본값 30000. 0이면 타임아웃 없음 */
  timeoutMs?: number;
  /** spinner CSS 클래스. 버튼에 추가/제거됨 */
  spinnerClass?: string;
  /** idle 상태로 돌아갈 때 버튼 텍스트를 원래대로 복원할지 여부 */
  restoreText?: boolean;
}

// ── 기본값 ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<RefreshActionOptions, 'action'>> = {
  loadingText: '',
  successNotice: false,
  errorNotice: false,
  throttleMs: 300,
  timeoutMs: 30_000,
  spinnerClass: 'spinning',
  restoreText: true,
};

// ── RefreshAction 클래스 ────────────────────────────────────────────

/**
 * 새로고침 버튼의 상태 관리와 실행을 캡슐화합니다.
 *
 * - throttle: 연속 클릭 시 일정 시간 내 최초 한 번만 실행
 * - AbortController: 이전 실행 중인 작업을 새 요청으로 취소
 * - UI 피드백: 로딩 애니메이션, 버튼 비활성화, Notice 알림
 */
export class RefreshAction {
  private readonly opts: Required<Omit<RefreshActionOptions, 'action'>> &
    Pick<RefreshActionOptions, 'action'>;
  private state: RefreshState = 'idle';
  private abortController: AbortController | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private originalText = '';
  private btn: HTMLElement | null = null;

  constructor(options: RefreshActionOptions) {
    this.opts = {
      ...DEFAULT_OPTIONS,
      ...options,
      loadingText: options.loadingText ?? t('refreshing'),
    };
  }

  /** 버튼이 HTMLButtonElement인지 duck-typing으로 확인 (jsdom 등에서 instanceof 실패 방지) */
  private isButton(el: HTMLElement | null): boolean {
    if (!el) return false;
    try {
      return el instanceof HTMLButtonElement;
    } catch {
      // instanceof가 실패하면 disabled/textContent 등의 존재 여부로 판단
      return 'disabled' in el && 'textContent' in el;
    }
  }

  /** 현재 상태 */
  getState(): RefreshState {
    return this.state;
  }

  /** 버튼에 연결하고 click 이벤트를 바인딩합니다. */
  attach(btn: HTMLElement): void {
    this.detach();
    this.btn = btn;
    this.originalText = this.isButton(btn) ? (btn.textContent ?? '') : '';

    btn.addEventListener('click', this.handleClick);
  }

  /** 버튼 연결을 해제하고 내부 리소스를 정리합니다. */
  detach(): void {
    if (this.btn) {
      this.btn.removeEventListener('click', this.handleClick);
      this.btn = null;
    }
    this.cleanup();
  }

  /** 외부에서 수동 실행 (버튼 클릭 없이) */
  async execute(): Promise<RefreshResult> {
    return this.run();
  }

  // ── private ───────────────────────────────────────────────────────

  private readonly handleClick = (): void => {
    if (this.opts.throttleMs > 0) {
      if (this.throttleTimer !== null) return;
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
      }, this.opts.throttleMs);
    }
    void this.run();
  };

  private async run(): Promise<RefreshResult> {
    // 이전 실행 중인 작업 취소
    if (this.state === 'loading') {
      this.abort();
      // abort() 호출만으로는 AbortError가 비동기로 처리되므로,
      // 상태를 idle로 직접 초기화하여 즉시 재실행 가능하게 함
      this.resetButton();
    }

    if (this.state === 'loading') {
      return { status: 'error', detail: t('refreshAlreadyRunning') };
    }

    this.abortController = new AbortController();

    // 타임아웃 설정
    if (this.opts.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.abort();
      }, this.opts.timeoutMs);
    }

    this.transition('loading');

    try {
      const result = await this.opts.action(this.abortController.signal);
      this.transition(result.status === 'error' ? 'error' : 'success');

      if (result.status !== 'error' && this.opts.successNotice !== false) {
        const msg = this.opts.successNotice || this.getDefaultSuccessMessage(result);
        if (msg) new Notice(msg, 3000);
      }
      if (result.status === 'error' && this.opts.errorNotice !== false) {
        const msg =
          this.opts.errorNotice ||
          t('refreshFailedWithMessage', { message: result.detail ?? t('autoSaveUnknownError') });
        new Notice(msg, 5000);
      }

      return result;
    } catch (err) {
      // AbortError는 정상 취소로 간주 (silent)
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.transition('idle');
        return { status: 'error', detail: t('refreshCancelled') };
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.transition('error');
      if (this.opts.errorNotice !== false) {
        const notice = this.opts.errorNotice || t('refreshFailedWithMessage', { message: msg });
        new Notice(notice, 5000);
      }
      return { status: 'error', detail: msg };
    } finally {
      this.clearTimeoutTimer();
      this.abortController = null;
    }
  }

  private abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.clearTimeoutTimer();
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private transition(next: RefreshState): void {
    this.state = next;
    if (!this.btn) return;

    if (next === 'loading') {
      if (this.isButton(this.btn)) {
        (this.btn as HTMLButtonElement).disabled = true;
      }
      if (this.opts.spinnerClass) {
        this.btn.addClass(this.opts.spinnerClass);
      }
      if (this.opts.loadingText && this.isButton(this.btn)) {
        this.originalText = this.btn.textContent ?? '';
        this.btn.setText(this.opts.loadingText);
      }
    } else if (next === 'idle') {
      this.resetButton();
    } else {
      // success / error → 잠시 후 idle로
      this.resetButton();
    }
  }

  private resetButton(): void {
    if (!this.btn) return;
    if (this.isButton(this.btn)) {
      (this.btn as HTMLButtonElement).disabled = false;
    }
    if (this.opts.spinnerClass) {
      this.btn.removeClass(this.opts.spinnerClass);
    }
    if (this.opts.restoreText && this.originalText && this.isButton(this.btn)) {
      (this.btn as HTMLButtonElement).setText(this.originalText);
    }
    this.state = 'idle';
  }

  /** 내부 리소스 정리 (detach 시 호출) */
  private cleanup(): void {
    this.abort();
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.btn) {
      this.resetButton();
    }
  }

  private getDefaultSuccessMessage(result: RefreshResult): string | null {
    if (result.status === 'success') return t('refreshComplete');
    if (result.status === 'partial' && result.detail) return result.detail;
    return null;
  }
}
