export type PromptModalFocusTarget =
  | 'closeButton'
  | 'newPromptButton'
  | 'selectedPrompt'
  | 'titleInput';

/**
 * 동일 모달의 설정 변경이 겹쳐서 롤백 순서가 뒤집히지 않도록 한 번에 하나만 실행한다.
 */
export class ExclusiveAsyncAction {
  private running = false;
  private readonly listeners = new Set<(running: boolean) => void>();

  get isRunning(): boolean {
    return this.running;
  }

  async tryRun(action: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.setRunning(true);
    try {
      await action();
      return true;
    } finally {
      this.setRunning(false);
    }
  }

  async runWhenIdle(action: () => Promise<void>): Promise<void> {
    while (!(await this.tryRun(action))) {
      await this.waitUntilIdle();
    }
  }

  subscribe(listener: (running: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.running);
    return () => this.listeners.delete(listener);
  }

  private setRunning(running: boolean): void {
    this.running = running;
    for (const listener of this.listeners) listener(running);
  }

  private async waitUntilIdle(): Promise<void> {
    if (!this.running) return;
    await new Promise<void>((resolve) => {
      let unsubscribe = (): void => undefined;
      unsubscribe = this.subscribe((running) => {
        if (running) return;
        unsubscribe();
        resolve();
      });
    });
  }
}

const sharedPromptActions = new WeakMap<object, ExclusiveAsyncAction>();

/** 같은 plugin 설정을 편집하는 모든 모달이 하나의 비동기 변경 잠금을 공유한다. */
export function getSharedPromptModalAction(owner: object): ExclusiveAsyncAction {
  const existing = sharedPromptActions.get(owner);
  if (existing) return existing;
  const created = new ExclusiveAsyncAction();
  sharedPromptActions.set(owner, created);
  return created;
}

/** 재렌더링으로 기존 DOM이 제거된 뒤, 같은 역할의 새 제어에 포커스를 복원한다. */
export function focusPromptModalTarget(root: HTMLElement, target: PromptModalFocusTarget): boolean {
  const element = root.querySelector<HTMLElement>(
    `[data-prompt-focus="${target}"]:not([disabled])`,
  );
  if (!element?.isConnected) return false;
  element.focus();
  return true;
}

/** 현재 포커스가 사라졌거나 경계에 있을 때 모달 안에서 이어갈 다음 Tab 대상을 고른다. */
export function getPromptModalTabTarget(
  focusable: readonly HTMLElement[],
  activeElement: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return null;
  if (!focusable.includes(activeElement as HTMLElement)) return shiftKey ? last : first;
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}

/** 다른 모달에서 현재 항목이 삭제되면 활성 항목이나 첫 항목으로 선택을 복구한다. */
export function resolvePromptModalSelection(
  selectedId: string,
  activePromptId: string | undefined,
  availableIds: readonly string[],
  fallbackId: string,
): string {
  if (availableIds.includes(selectedId)) return selectedId;
  if (activePromptId && availableIds.includes(activePromptId)) return activePromptId;
  return availableIds[0] ?? fallbackId;
}
