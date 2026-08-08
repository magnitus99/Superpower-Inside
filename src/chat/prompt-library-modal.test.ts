import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ExclusiveAsyncAction,
  focusPromptModalTarget,
  getSharedPromptModalAction,
  getPromptModalTabTarget,
  resolvePromptModalSelection,
} from './prompt-library-modal-state';

const modalSource = readFileSync(new URL('./prompt-library-modal.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('프롬프트 보관함 모달 구조', () => {
  it('프로바이더 프로필 공통 모델 연결 경로를 사용한다', () => {
    expect(modalSource).toContain('resolvePromptGenerationModelState(');
    expect(modalSource).toContain('modelSelect.value = modelState.selectedModel');
    expect(modalSource).toContain('createPromptGenerationProvider(');
    expect(modalSource).not.toContain('CHAT_PROVIDER_KEYS');
    expect(modalSource).not.toContain('createProviderFromModelValue');
  });

  it('모델이 없거나 기본 선택이 유효하지 않으면 생성 흐름을 잠그고 이유를 표시한다', () => {
    expect(modalSource).toContain('const hasSelectedModel = modelState.selectedModel.length > 0');
    expect(modalSource).toContain('generateBtn.disabled = !hasSelectedModel');
    expect(modalSource).toContain('directionSelect.disabled = !hasSelectedModel');
    expect(modalSource).toContain("text: t('promptGenerationModelRequired')");
    expect(modalSource).toContain("text: t('promptGenerationNoModelsReason')");
    expect(modalSource).toContain("modelSelect.addEventListener('change'");
    expect(modalSource).toContain('modelSelect.value.trim().length > 0');
  });

  it('대화상자와 프롬프트 목록을 키보드로 탐색할 수 있다', () => {
    expect(modalSource).toContain("modal.setAttribute('role', 'dialog')");
    expect(modalSource).toContain("modal.setAttribute('aria-modal', 'true')");
    expect(modalSource).toContain("event.key === 'Escape'");
    expect(modalSource).toContain("event.key !== 'Tab'");
    expect(modalSource).toContain("list.createEl('button'");
    expect(modalSource).toContain('previousFocus?.isConnected');
    expect(modalSource).toContain("setIcon(closeBtn, 'x')");
    expect(modalSource).toContain("render('selectedPrompt')");
    expect(modalSource).toContain("runMutation('titleInput'");
    expect(modalSource).toContain('closeBtn.focus()');
    expect(modalSource).toContain('if (localMutationInProgress)');
    expect(modalSource).toContain("t('promptMutationInProgress')");
  });

  it('저장 중 다른 변경을 시작하지 않고 실패 종료 후에만 다음 변경을 허용한다', async () => {
    const action = new ExclusiveAsyncAction();
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const state = { value: '초기' };

    const first = action.tryRun(async () => {
      state.value = '임시 변경';
      await firstFinished;
      state.value = '롤백';
    });
    const skipped = await action.tryRun(() => {
      state.value = '경쟁한 성공';
      return Promise.resolve();
    });

    expect(skipped).toBe(false);
    expect(state.value).toBe('임시 변경');
    releaseFirst?.();
    await first;

    const accepted = await action.tryRun(() => {
      state.value = '최종 성공';
      return Promise.resolve();
    });
    expect(accepted).toBe(true);
    expect(state.value).toBe('최종 성공');
  });

  it('같은 plugin의 여러 모달은 하나의 변경 잠금을 공유한다', async () => {
    const owner = {};
    const firstModalAction = getSharedPromptModalAction(owner);
    const secondModalAction = getSharedPromptModalAction(owner);
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const transitions: boolean[] = [];
    const unsubscribe = secondModalAction.subscribe((running) => transitions.push(running));

    const first = firstModalAction.tryRun(() => firstFinished);
    await expect(secondModalAction.tryRun(() => Promise.resolve())).resolves.toBe(false);
    releaseFirst?.();
    await first;
    unsubscribe();

    expect(firstModalAction).toBe(secondModalAction);
    expect(transitions).toEqual([false, true, false]);
  });

  it('다른 모달에서 현재 항목이 삭제되면 활성 항목으로 선택을 복구한다', () => {
    expect(modalSource).toContain('selectedId = resolvePromptModalSelection(');
    expect(
      resolvePromptModalSelection(
        'deleted-prompt',
        'active-prompt',
        ['default-prompt', 'active-prompt'],
        'default-prompt',
      ),
    ).toBe('active-prompt');
    expect(
      resolvePromptModalSelection(
        'deleted-prompt',
        'missing-active',
        ['default-prompt', 'remaining-prompt'],
        'default-prompt',
      ),
    ).toBe('default-prompt');
  });

  it('느린 모델 요청은 닫기를 막지 않고 결과 저장 구간만 전역 잠금한다', () => {
    const providerCall = modalSource.indexOf('await providerInfo.provider.chat(');
    const saveMutation = modalSource.indexOf(
      "await runMutationWhenIdle('titleInput'",
      providerCall,
    );

    expect(providerCall).toBeGreaterThanOrEqual(0);
    expect(saveMutation).toBeGreaterThan(providerCall);
    expect(modalSource).toContain(
      'if (isClosed || generationToken !== generationSequence) return;',
    );
  });

  it('변경 작업이 예외로 끝나도 잠금을 해제한다', async () => {
    const action = new ExclusiveAsyncAction();

    await expect(action.tryRun(() => Promise.reject(new Error('저장 실패')))).rejects.toThrow(
      '저장 실패',
    );

    expect(action.isRunning).toBe(false);
    await expect(action.tryRun(() => Promise.resolve())).resolves.toBe(true);
  });

  it('재렌더 후 새로 생성된 제어에 포커스를 복원한다', () => {
    const replacement = { focus: vi.fn(), isConnected: true };
    const querySelector = vi.fn(() => replacement);
    const root = { querySelector } as unknown as HTMLElement;

    expect(focusPromptModalTarget(root, 'titleInput')).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('[data-prompt-focus="titleInput"]:not([disabled])');
    expect(replacement.focus).toHaveBeenCalledOnce();
  });

  it('포커스가 비활성 제어에서 사라져도 다음 Tab을 모달 안으로 되돌린다', () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;
    const outside = {} as HTMLElement;
    const focusable = [first, middle, last];

    expect(getPromptModalTabTarget(focusable, outside, false)).toBe(first);
    expect(getPromptModalTabTarget(focusable, outside, true)).toBe(last);
    expect(getPromptModalTabTarget(focusable, last, false)).toBe(first);
    expect(getPromptModalTabTarget(focusable, first, true)).toBe(last);
    expect(getPromptModalTabTarget(focusable, middle, false)).toBeNull();
  });

  it('런타임 style 주입 없이 배포 CSS에서 반응형 레이아웃을 제공한다', () => {
    expect(modalSource).not.toContain("doc.createElement('style')");
    expect(modalSource).not.toContain('style.textContent');
    expect(stylesSource).toContain('.superpower-inside-prompt-modal');
    expect(stylesSource).toContain('@media (max-width: 760px)');
    expect(stylesSource).toContain('@media (max-width: 520px)');
  });
});
