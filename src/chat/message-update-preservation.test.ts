import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessageWithMeta, ToolCallRecord } from './types';
import { ChatView } from './view';

vi.mock('obsidian', () => ({
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  Notice: class {},
}));

class PreserveTestElement {
  readonly classList = { contains: (name: string): boolean => name === 'assistant' };
  querySelector(): null {
    return null;
  }
}

const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

beforeAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: class PreserveTestHTMLElement {},
    writable: true,
  });
});

afterAll(() => {
  if (originalHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', originalHTMLElement);
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});

const TOOL_CALL: ToolCallRecord = {
  id: 'tool-1',
  name: 'synthetic_tool',
  arguments: '{}',
  status: 'success',
  resultSummary: '합성 도구 결과',
};

function createHarness() {
  const message: ChatMessageWithMeta = {
    id: 'answer',
    role: 'assistant',
    content: '합성 본문입니다.',
    status: 'streaming',
    timestamp: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    reasoning: '합성 추론 요약',
    toolCalls: [TOOL_CALL],
  };
  const element = new PreserveTestElement();
  const updateAssistantLayers = vi.fn();
  const view = Object.assign(Object.create(ChatView.prototype), {
    messages: [message],
    messageEls: new Map([['answer', element]]),
    autoScroll: false,
    updateMessageMeta: (): void => {},
    updateAssistantLayers,
    progressTextByMessage: new Map<string, string>(),
    markDirtyAndAutoSave: (): void => {},
  }) as unknown as ChatView;
  return { view, message, element, updateAssistantLayers };
}

describe('메시지 갱신 시 추론·도구 기록 보존', () => {
  it('추론과 도구 기록을 전달하지 않은 진행 갱신은 기존 값을 지우지 않는다', () => {
    const { view, message, element, updateAssistantLayers } = createHarness();

    view.updateMessage('answer', '진행 중입니다.', false);

    expect(message.reasoning).toBe('합성 추론 요약');
    expect(message.toolCalls).toEqual([TOOL_CALL]);
    expect(updateAssistantLayers).toHaveBeenCalledWith(
      element,
      '진행 중입니다.',
      false,
      '합성 추론 요약',
      [TOOL_CALL],
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('명시적인 빈 추론과 빈 도구 배열은 기존 값을 지운다', () => {
    const { view, message } = createHarness();

    view.updateMessage('answer', '완료 본문입니다.', true, '', []);

    expect(message.reasoning).toBe('');
    expect(message.toolCalls).toEqual([]);
  });
});

describe('진행 문구와 답변 본문 분리', () => {
  it('진행 문구는 작업 영역에만 전달하고 답변 content는 비워 둔다', () => {
    const { view, message, updateAssistantLayers } = createHarness();

    view.updateMessage('answer', '', false, undefined, undefined, {
      progressText: '색인 근거를 검토하는 중입니다.',
    });

    expect(message.content).toBe('');
    expect(updateAssistantLayers).toHaveBeenCalledWith(
      expect.anything(),
      '',
      false,
      '합성 추론 요약',
      [TOOL_CALL],
      undefined,
      undefined,
      undefined,
      '색인 근거를 검토하는 중입니다.',
    );

    view.updateMessage('answer', '최종 답변입니다.', true);

    expect(message.content).toBe('최종 답변입니다.');
    expect(updateAssistantLayers).toHaveBeenLastCalledWith(
      expect.anything(),
      '최종 답변입니다.',
      true,
      '합성 추론 요약',
      [TOOL_CALL],
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });
});
