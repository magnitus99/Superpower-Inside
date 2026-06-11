import type { RefreshResult } from './refresh-action';
import type { GraphRagIndexingProgress } from '../graph/indexing-runner';

// ── 타입 ────────────────────────────────────────────────────────────

/** 새로고침 이벤트를 발행할 수 있는 도메인 */
export type RefreshDomain =
  | 'rag'
  | 'mcp'
  | 'models'
  | 'sessions'
  | 'exclude-counts'
  | 'graph-progress'
  | 'graph-data';

/** graph-progress 도메인 전용 페이로드 */
export interface GraphProgressResult extends RefreshResult {
  runId?: number;
  progress?: GraphRagIndexingProgress;
}

export interface GraphDataResult extends RefreshResult {
  runId?: number;
  source?: 'graph-run' | 'graph-cleanup';
}

/** RefreshBus에서 사용하는 이벤트 핸들러 */
export type RefreshHandler = (result: RefreshResult) => void;

// ── RefreshBus 클래스 ───────────────────────────────────────────────

/**
 * 도메인별 새로고침 이벤트 버스.
 *
 * 한 뷰에서 발생한 새로고침 결과를 다른 뷰가 구독하여
 * 크로스뷰 상태 동기화를 가능하게 합니다.
 *
 * 사용 예:
 *   const bus = new RefreshBus();
 *   bus.on('mcp', (result) => { ... });
 *   bus.emit('mcp', { status: 'success' });
 */
export class RefreshBus {
  private readonly listeners = new Map<RefreshDomain, Set<RefreshHandler>>();

  /** 이벤트 발행 */
  emit(domain: RefreshDomain, result: RefreshResult): void {
    const handlers = this.listeners.get(domain);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(result);
      } catch {
        // 리스너 오류가 다른 리스너에 전파되지 않도록 함
      }
    }
  }

  /** 이벤트 구독. 구독 해제 함수를 반환합니다. */
  on(domain: RefreshDomain, handler: RefreshHandler): () => void {
    let handlers = this.listeners.get(domain);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(domain, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
      if (handlers && handlers.size === 0) {
        this.listeners.delete(domain);
      }
    };
  }

  /** 모든 리스너 제거 */
  destroy(): void {
    this.listeners.clear();
  }
}
