import { describe, expect, it, vi } from 'vitest';
import type { ActionFeedbackResult, RunActionWithFeedbackOptions } from './utils/action-feedback';

const feedback = vi.hoisted(() =>
  vi.fn(async (options: RunActionWithFeedbackOptions) => options.action()),
);
vi.mock('./utils/action-feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/action-feedback')>();
  feedback.mockImplementation(actual.runActionWithFeedback);
  return { ...actual, runActionWithFeedback: feedback };
});
vi.mock('obsidian', () => ({
  PluginSettingTab: class {},
  Modal: class {},
  Notice: class {},
  Plugin: class {},
  Platform: { isDesktopApp: true },
}));

import { DEFAULT_SETTINGS, SuperpowerInsideSettingTab } from './settings';
import { setLanguage, t } from './i18n';

describe('설정 인덱싱 준비 단계 취소', () => {
  it.each((['pending', 'all'] as const).flatMap((kind) =>
    (['legacy', 'indexed', 'paused', 'running', 'initializing', 'restoring', 'guard', 'invalid', 'disabled', 'missing-model', 'null', 'partial', 'failed', 'result-paused', 'cancelled', 'error'] as const)
      .map((state) => ({ kind, state })),
  ))('$kind 실제 click은 $state 상태에서 공통 명시 API와 보호를 유지한다', async ({ kind, state }) => {
    feedback.mockClear();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providerProfiles = [{
      id: 'local', name: 'Local', strategy: 'ternlight', apiKey: '',
      enabled: state !== 'disabled',
      models: [{ id: 'ternlight-base', kind: 'embedding',
        verification: { chatStatus: 'unknown', embeddingStatus: 'success' } }],
    }];
    settings.rag.embeddingModelRef = state === 'invalid' ? '' :
      state === 'missing-model' ? 'profile:local:missing' : 'profile:local:ternlight-base';
    const operation = vi.fn(async () => {
      await Promise.resolve();
      if (state === 'cancelled') throw new DOMException('취소', 'AbortError');
      if (state === 'error') throw new Error('합성 실행 실패');
      if (state === 'null') return null;
      return { indexed: 2, skipped: 0, partial: state === 'partial' ? 1 : 0,
        failed: state === 'failed' ? 1 : 0,
        guardState: state === 'result-paused' ? { mode: 'paused' } : null };
    });
    const scheduler = {
      beginPreparation: vi.fn(), endPreparation: vi.fn(),
      indexPending: vi.fn(), reindexAll: vi.fn(),
    };
    const plugin = {
      settings,
      getRagRuntimeState: () => ({
        hasIndexer: state === 'indexed' || state === 'paused',
        ragIndexingScheduler: state === 'indexed' || state === 'paused' ? scheduler : null,
        ragStatus: state === 'paused' ? { totalDocuments: 2, updateRequiredDocuments: [] } : null,
        initRunning: state === 'initializing',
        generation: state === 'restoring' ? { availability: 'restoring' } : undefined,
        autoRecoveryPausedByUser: state === 'paused',
      }),
      isRagIndexing: () => state === 'running',
      getRagPerformanceGuardState: () => state === 'guard' ? { mode: 'paused', remainingPauseMs: 1000 } : null,
      startRagUpdate: operation, rebuildRagGeneration: operation,
      resumeRagAutoRecovery: vi.fn(), ensureRagRuntimeInitialized: vi.fn(() => Promise.resolve(true)),
    };
    const clicks = new Map<string, () => void>();
    const buttons = new Map<string, { disabled: boolean; hidden: boolean }>();
    const container = {
      setText: () => undefined, createDiv: () => container,
      createEl: (_tag: string, options: { text: string }, setup: (button: unknown) => void) => {
        const button = { disabled: false, hidden: false, addEventListener: (_event: string, listener: () => void) => clicks.set(options.text, listener) };
        buttons.set(options.text, button);
        setup(button);
      },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const access = tab as unknown as {
      buildControlsSection(element: unknown): void;
      getRagStatus(): Promise<null>;
      createRagDisclosure(): unknown;
    };
    const status = vi.spyOn(access, 'getRagStatus').mockResolvedValue(null);
    vi.spyOn(access, 'createRagDisclosure').mockReturnValue({ content: container });
    vi.spyOn(tab, 'updateRagStats').mockImplementation(() => undefined);
    access.buildControlsSection(container);
    await Promise.resolve();
    const blocked = ['running', 'initializing', 'restoring', 'guard', 'invalid', 'disabled', 'missing-model'].includes(state);
    const label = t(kind === 'pending' ? 'settingsAuto127' : 'settingsAuto169');
    expect(buttons.get(label)?.disabled).toBe(blocked);
    const statusReads = status.mock.calls.length;
    // disabled 우회 호출에도 진입점 자체의 보호가 필요합니다.
    clicks.get(label)?.();
    const result = await (feedback.mock.results[0]?.value as Promise<ActionFeedbackResult>);
    expect(operation).toHaveBeenCalledTimes(blocked ? 0 : 1);
    if (!blocked) {
      expect(result?.status).toBe(state === 'error' ? 'error' :
        ['null', 'partial', 'failed', 'result-paused', 'cancelled'].includes(state) ? 'partial' : 'success');
      expect(plugin.resumeRagAutoRecovery).toHaveBeenCalledTimes(kind === 'all' ? 1 : 0);
    }
    expect(plugin.ensureRagRuntimeInitialized).not.toHaveBeenCalled();
    expect(scheduler.beginPreparation).not.toHaveBeenCalled();
    expect(scheduler.indexPending).not.toHaveBeenCalled();
    expect(scheduler.reindexAll).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(statusReads);
  });
  it.each(
    (['pending', 'all'] as const).flatMap((kind) =>
      (['cancelled', 'restarted', 'replaced', 'empty', 'error', 'success'] as const).map(
        (outcome) => ({
          kind,
          outcome,
        }),
      ),
    ),
  )('$kind 준비 단계 $outcome 전환에서도 신호와 정리를 유지한다', async ({ kind, outcome }) => {
    feedback.mockClear();
    setLanguage('ko');
    const controller = new AbortController();
    const scheduler = {
      beginPreparation: vi.fn(() => controller.signal),
      endPreparation: vi.fn(),
      indexPending: vi.fn().mockResolvedValue({ indexed: 2, skipped: 0 }),
      reindexAll: vi.fn().mockResolvedValue({ indexed: 2, skipped: 0 }),
    };
    let runtimeScheduler = scheduler;
    let running = false;
    const plugin = {
      getRagRuntimeState: () => ({
        hasIndexer: true,
        ragIndexingScheduler: runtimeScheduler,
        ragStatus: null,
      }),
      isRagIndexing: () => running,
      getRagPerformanceGuardState: () => null,
    };
    const clicks = new Map<string, () => void>();
    const container = {
      setText: () => undefined,
      createDiv: () => container,
      createEl: (_tag: string, options: { text: string }, setup: (button: unknown) => void) => {
        setup({
          addEventListener: (_event: string, listener: () => void) =>
            clicks.set(options.text, listener),
        });
      },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const status = { totalDocuments: 2, updateRequiredDocuments: [{}] };
    const access = tab as unknown as {
      buildControlsSection(element: unknown): void;
      getRagStatus(signal?: AbortSignal): Promise<unknown>;
      createRagDisclosure(): unknown;
      updateRagControlStates(status: null): void;
      reindexAllButton: { disabled: boolean };
    };
    const getStatus = vi.spyOn(access, 'getRagStatus').mockResolvedValue(status);
    vi.spyOn(access, 'createRagDisclosure').mockReturnValue({ content: container });
    access.buildControlsSection(container);
    await Promise.resolve();
    const updateStats = vi.spyOn(tab, 'updateRagStats').mockImplementation(() => undefined);
    let finishStatus: (value: typeof status) => void = () => undefined;
    let failStatus: (error: Error) => void = () => undefined;
    getStatus.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finishStatus = resolve;
          failStatus = reject;
        }),
    );

    clicks.get(t(kind === 'pending' ? 'settingsAuto127' : 'settingsAuto169'))?.();
    await vi.waitFor(() => expect(getStatus).toHaveBeenLastCalledWith(controller.signal));
    expect(scheduler.beginPreparation).toHaveBeenCalledOnce();
    if (outcome === 'cancelled' || outcome === 'restarted') controller.abort();
    if (outcome === 'restarted') {
      running = true;
      access.updateRagControlStates(null);
      expect(access.reindexAllButton.disabled).toBe(true);
    }
    if (outcome === 'replaced') runtimeScheduler = { ...scheduler };
    if (outcome === 'error') failStatus(new Error('합성 상태 조회 실패'));
    else
      finishStatus(
        outcome === 'empty' ? { totalDocuments: 0, updateRequiredDocuments: [] } : status,
      );
    const result = await (feedback.mock.results[0]?.value as Promise<ActionFeedbackResult>);
    expect(result?.status).toBe(
      outcome === 'cancelled' || outcome === 'restarted' || outcome === 'replaced'
        ? 'partial'
        : outcome === 'empty'
          ? 'noop'
          : outcome,
    );
    expect(scheduler.indexPending).toHaveBeenCalledTimes(
      outcome === 'success' && kind === 'pending' ? 1 : 0,
    );
    expect(scheduler.reindexAll).toHaveBeenCalledTimes(
      outcome === 'success' && kind === 'all' ? 1 : 0,
    );
    expect(scheduler.endPreparation).toHaveBeenCalledWith(controller.signal);
    if (outcome === 'restarted') expect(access.reindexAllButton.disabled).toBe(true);
    if (outcome === 'cancelled' || outcome === 'empty' || outcome === 'success') {
      expect(updateStats).toHaveBeenCalled();
    }
  });

  it.each([false, true])(
    '초기화 후 최신 캐시와 취소 상태를 다시 확인한다 (취소=%s)',
    async (cancelled) => {
      const controller = new AbortController();
      const status = { totalDocuments: 3, updateRequiredDocuments: [] };
      let cachedStatus: typeof status | null = null;
      const plugin = {
        getRagRuntimeState: () => ({
          vectorStore: cachedStatus ? {} : null,
          ragStatus: cachedStatus,
        }),
        ensureRagRuntimeInitialized: () => {
          cachedStatus = status;
          if (cancelled) controller.abort();
          return Promise.resolve(true);
        },
      };
      const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
      const pending = (
        tab as unknown as { getRagStatus(signal: AbortSignal): Promise<unknown> }
      ).getRagStatus(controller.signal);
      if (cancelled) await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      else await expect(pending).resolves.toBe(status);
    },
  );

  it('업데이트 시작 버튼은 두 언어에서 같은 행동을 표시한다', () => {
    setLanguage('en');
    expect(t('settingsAuto127')).toBe('Start update');
    setLanguage('ko');
    expect(t('settingsAuto127')).toBe('업데이트 시작');
  });
});
