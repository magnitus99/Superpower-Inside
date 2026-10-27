import type { ChatRetrievalReadiness } from './chat-readiness';

export type RetrievalWaitResult = 'ready' | 'unavailable' | 'changed' | 'timeout';

/** 준비 작업을 재시도하지 않고 실제 readiness 전환만 기다립니다. */
export function waitForRetrievalReady(options: {
  signal: AbortSignal;
  getReadiness: () => ChatRetrievalReadiness;
  isCurrent: () => boolean;
}): Promise<RetrievalWaitResult> {
  return new Promise((resolve, reject) => {
    let timer: number | undefined;
    const deadline = Date.now() + 10 * 60 * 1000;
    const cleanup = (): void => {
      window.clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
    };
    const finish = (result: RetrievalWaitResult): void => {
      cleanup();
      resolve(result);
    };
    const abort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const check = (): void => {
      try {
        if (options.signal.aborted) return abort();
        if (!options.isCurrent()) return finish('changed');
        const readiness = options.getReadiness();
        if (readiness === 'ready') return finish('ready');
        if (readiness === 'degraded') return finish('unavailable');
        // 준비 상태가 해소되지 않으면 초안을 보존하고 유한하게 종료합니다.
        if (Date.now() >= deadline) return finish('timeout');
        timer = window.setTimeout(check, 500);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    options.signal.addEventListener('abort', abort, { once: true });
    check();
  });
}
