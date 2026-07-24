export interface ChatRunHandle<TController> {
  readonly token: number;
  readonly controller: TController;
}

export interface ChatRunFinalizationPlan {
  readonly ownsRun: boolean;
  readonly restoreSubmittedDraft: boolean;
  readonly clearPendingState: boolean;
  readonly saveSession: boolean;
  readonly clearLoading: boolean;
}

export function isChatRunOwner<TController>(
  activeRun: ChatRunHandle<TController> | null,
  run: ChatRunHandle<TController>,
): boolean {
  return (
    activeRun !== null && activeRun.token === run.token && activeRun.controller === run.controller
  );
}

export function isChatRunActive<
  TController extends { readonly signal: { readonly aborted: boolean } },
>(activeRun: ChatRunHandle<TController> | null, run: ChatRunHandle<TController>): boolean {
  return isChatRunOwner(activeRun, run) && !run.controller.signal.aborted;
}

export function planChatRunFinalization<TController>(
  activeRun: ChatRunHandle<TController> | null,
  run: ChatRunHandle<TController>,
  restoreDraft: boolean,
): ChatRunFinalizationPlan {
  const ownsRun = isChatRunOwner(activeRun, run);
  return {
    ownsRun,
    restoreSubmittedDraft: ownsRun && restoreDraft,
    clearPendingState: ownsRun && !restoreDraft,
    saveSession: ownsRun,
    clearLoading: ownsRun,
  };
}
