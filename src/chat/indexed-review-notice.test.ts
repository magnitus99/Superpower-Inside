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
  readonly classList = { contains: (name: string): boolean => name === 'assistant' };
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
  const updateAssistantLayers = vi.fn();
  const view = Object.assign(Object.create(ChatView.prototype), {
    messages: [message],
    messageEls: new Map([['answer', new NoticeTestElement()]]),
    autoScroll: false,
    updateMessageMeta: (): void => {},
    updateAssistantLayers,
    markDirtyAndAutoSave: (): void => {},
  }) as unknown as ChatView;
  return { view, message, updateAssistantLayers };
}

describe('엔진 검토 고지와 근거 전용 렌더링', () => {
  it('완료 본문 뒤에 고지를 한 번만 붙이고 저장 본문 재렌더에서 중복하지 않는다', () => {
    const { view, message } = createHarness();
    view.updateMessage('answer', '합성 본문입니다.', true, undefined, undefined, {
      indexedReviewNotice: '합성 검수 고지',
    });
    expect(message.content).toBe('합성 본문입니다.\n\n합성 검수 고지');
    expect(message.indexedReviewNotice).toBe('합성 검수 고지');

    view.updateMessage('answer', message.content, true, undefined, undefined, {
      indexedReviewNotice: '합성 검수 고지',
    });
    expect(message.content).toBe('합성 본문입니다.\n\n합성 검수 고지');
  });

  it.each(['원문 근거만 표시합니다.', ''])(
    '답변의 인용 마커가 없어도 검증 출처를 assistant 표시 계층에 전달한다: %s',
    (content) => {
      const { view, message, updateAssistantLayers } = createHarness();
      const citations = [
        {
          id: 'synthetic-verified',
          filePath: 'Synthetic.md',
          preview: '독립 합성 근거',
          status: 'verified' as const,
        },
      ];
      view.updateMessage('answer', content, true, undefined, undefined, { citations });
      expect(message.content).toBe(content);
      expect(message.citations).toEqual(citations);
      expect(message.status).toBe('complete');
      expect(updateAssistantLayers).toHaveBeenCalledWith(
        expect.any(NoticeTestElement),
        content,
        true,
        undefined,
        undefined,
        citations,
        undefined,
        undefined,
      );
    },
  );

  it('정상 집계는 본문에 덧붙이지 않고 펼침 상세용 메타데이터로 보존한다', () => {
    const { view, message } = createHarness();
    const phase = () => ({ durationMs: 0, requests: 0, reportedRequests: 0 });
    view.updateMessage('answer', '합성 본문입니다.', true, undefined, undefined, {
      indexedReviewNotice: '정상 집계 상세',
      indexedReviewDiagnostics: {
        noticeLevel: 'detail',
        phases: { inventory: phase(), search: phase(), map: phase(), screen: phase(), extract: phase(), reduce: phase(), answer: phase() },
        counts: { candidateSegments: 1, screenAcceptedSegments: 1, extractedSegments: 1, screenRetries: 0, extractRetries: 0, splitBatches: 0, reduceRequests: 0, cacheHits: 0 },
      },
    });
    expect(message.content).toBe('합성 본문입니다.');
    expect(message.indexedReviewNotice).toBe('정상 집계 상세');
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
