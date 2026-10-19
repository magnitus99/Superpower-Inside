import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import { ChatView } from './view';

vi.mock('obsidian', () => ({
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  Notice: class {},
}));

afterEach(() => vi.unstubAllGlobals());

/** DOM 없이 완료 본문에 검수 고지가 붙는 계약만 확인하는 최소 요소입니다. */
class NoticeTestElement {
  readonly classList = { contains: (): boolean => false };
  querySelector(): null {
    return null;
  }
}

const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

beforeAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: class NoticeTestHTMLElement {},
    writable: true,
  });
});

afterAll(() => {
  if (originalHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', originalHTMLElement);
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});

function createHarness(content = '합성 본문입니다.') {
  const message: ChatMessageWithMeta = {
    id: 'answer',
    role: 'assistant',
    content,
    status: 'streaming',
    timestamp: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const view = Object.assign(Object.create(ChatView.prototype), {
    messages: [message],
    messageEls: new Map([['answer', new NoticeTestElement()]]),
    autoScroll: false,
    updateMessageMeta: (): void => {},
    markDirtyAndAutoSave: (): void => {},
  }) as unknown as ChatView;
  return { view, message };
}

describe('전수 검수 고지 렌더링', () => {
  it('완료 본문 맨 앞에 고지를 한 번만 붙인다', () => {
    const { view, message } = createHarness();
    view.updateMessage('answer', '합성 본문입니다.', true, undefined, undefined, {
      indexedReviewNotice: '합성 검수 고지',
    });
    expect(message.content).toBe('합성 검수 고지\n\n합성 본문입니다.');
    expect(message.indexedReviewNotice).toBe('합성 검수 고지');

    view.updateMessage('answer', message.content, true, undefined, undefined, {
      indexedReviewNotice: '합성 검수 고지',
    });
    expect(message.content).toBe('합성 검수 고지\n\n합성 본문입니다.');
  });

  it('진행 중 본문과 고지 없는 완료 본문은 그대로 둔다', () => {
    const streaming = createHarness();
    streaming.view.updateMessage('answer', streaming.message.content, false, undefined, undefined, {
      indexedReviewNotice: '합성 검수 고지',
    });
    expect(streaming.message.content).toBe('합성 본문입니다.');
    expect(streaming.message.indexedReviewNotice).toBe('합성 검수 고지');

    const plain = createHarness();
    plain.view.updateMessage('answer', '합성 본문입니다.', true);
    expect(plain.message.content).toBe('합성 본문입니다.');
    expect(plain.message.indexedReviewNotice).toBeUndefined();
  });
});
