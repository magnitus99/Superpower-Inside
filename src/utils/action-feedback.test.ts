import { beforeEach, describe, expect, it, vi } from 'vitest';

const noticeMessages: string[] = [];

vi.mock('obsidian', () => ({
  Notice: class {
    constructor(message: string) {
      noticeMessages.push(message);
    }
  },
}));

import { runActionWithFeedback } from './action-feedback';
import type { RefreshDomain } from './refresh-bus';

function createButton(text = '실행') {
  const classes = new Set<string>();
  const button = {
    disabled: false,
    textContent: text,
    addClass(cls: string) {
      classes.add(cls);
    },
    removeClass(cls: string) {
      classes.delete(cls);
    },
    setText(next: string) {
      button.textContent = next;
    },
    hasClass(cls: string) {
      return classes.has(cls);
    },
  };
  return button;
}

describe('runActionWithFeedback', () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it('성공 결과는 버튼을 복구하고 Notice와 refreshBus 이벤트를 남긴다', async () => {
    const button = createButton();
    const emitted: { domain: RefreshDomain; status: string }[] = [];

    const result = await runActionWithFeedback({
      button,
      loadingText: '처리 중',
      refreshBus: {
        emit: (domain, payload) => emitted.push({ domain, status: payload.status }),
      },
      refreshDomains: ['rag', 'models'],
      action: () => {
        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe('처리 중');
        expect(button.hasClass('spinning')).toBe(true);
        return { status: 'success', detail: '완료됨' };
      },
    });

    expect(result.status).toBe('success');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('실행');
    expect(button.hasClass('spinning')).toBe(false);
    expect(noticeMessages).toEqual(['완료됨']);
    expect(emitted).toEqual([
      { domain: 'rag', status: 'success' },
      { domain: 'models', status: 'success' },
    ]);
  });

  it('noop 결과도 침묵하지 않고 설명 Notice를 표시한다', async () => {
    const button = createButton();

    const result = await runActionWithFeedback({
      button,
      action: () => ({ status: 'noop', detail: '이미 최신입니다.' }),
    });

    expect(result.status).toBe('noop');
    expect(noticeMessages).toEqual(['이미 최신입니다.']);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('실행');
  });

  it('throw된 오류는 실패 Notice를 남기고 버튼을 복구한다', async () => {
    const button = createButton();

    const result = await runActionWithFeedback({
      button,
      action: () => {
        throw new Error('네트워크 실패');
      },
    });

    expect(result).toEqual({ status: 'error', detail: '네트워크 실패' });
    expect(noticeMessages).toEqual(['실패했습니다: 네트워크 실패']);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('실행');
  });

  it('원래 disabled였던 버튼은 완료 후 disabled 상태를 유지한다', async () => {
    const button = createButton();
    button.disabled = true;

    await runActionWithFeedback({
      button,
      action: () => ({ status: 'success', notice: false }),
    });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('실행');
  });

  it('Obsidian ButtonComponent 형태도 비활성화와 텍스트 복구를 지원한다', async () => {
    const calls: string[] = [];
    const component = {
      buttonEl: createButton('저장'),
      setDisabled(disabled: boolean) {
        calls.push(`disabled:${disabled}`);
        component.buttonEl.disabled = disabled;
        return component;
      },
      setButtonText(text: string) {
        calls.push(`text:${text}`);
        component.buttonEl.textContent = text;
        return component;
      },
    };

    await runActionWithFeedback({
      button: component,
      loadingText: '저장 중',
      action: () => ({ status: 'success', notice: false }),
    });

    expect(calls).toEqual(['disabled:true', 'text:저장 중', 'disabled:false', 'text:저장']);
    expect(noticeMessages).toEqual([]);
  });
});
