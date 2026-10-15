import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './view';
import { loadChat, saveChat } from './persistence';

vi.mock('obsidian', () => ({
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  Notice: class {},
}));
vi.mock('./persistence', () => ({
  loadChat: vi.fn().mockResolvedValue({
    messages: [{ id: 'user-1', role: 'user', content: '합성 메시지', status: 'complete' }],
    title: '이전 대화',
  }),
  saveChat: vi.fn().mockResolvedValue({ path: 'Chats/current.md' }),
}));

describe('보관함 탐색 저장 계약', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, true])(
    '수정 여부가 %s인 대화를 전환할 때 필요한 경우에만 저장한다',
    async (isDirty) => {
      const view = Object.create(ChatView.prototype) as ChatView;
      Object.assign(view, {
        app: { vault: {} },
        plugin: {
          settings: { chat: { saveFolder: 'Chats' } },
          refreshBus: { emit: vi.fn() },
          logger: { error: vi.fn() },
        },
        session: { filePath: 'Chats/current.md', title: '현재 대화', isDirty },
        messages: [{ role: 'user', content: '합성 메시지' }],
        activeVariantByRoot: new Map(),
        invalidateActiveChatRun: vi.fn(),
        clearAutoSaveTimer: vi.fn(),
        rebuildMessagesDOM: vi.fn(),
        updateHeaderTitle: vi.fn(),
        getCurrentSessionFile: vi.fn().mockReturnValue({ path: 'Chats/current.md' }),
      });

      await view.loadSession('Chats/older.md');
      await view.loadSession('Chats/current.md');

      expect(loadChat).toHaveBeenCalledTimes(2);
      expect(saveChat).toHaveBeenCalledTimes(isDirty ? 1 : 0);
    },
  );
});
