import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './view';
import type { ChatMessageWithMeta, SourceValidationWarning } from './types';
import { prepareChatProviderForModel } from '../llm/provider-resolution';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import type { LLMProvider } from '../llm/providers';
import { RAGQueryEngine } from '../rag/query';

vi.mock('obsidian', () => ({
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  Notice: class {},
}));
vi.mock('../llm/provider-resolution', () => ({
  prepareChatProviderForModel: vi.fn(),
  buildStoredChatModelRef: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

interface ActionView {
  inputArea: { value: string };
  handleSend(text?: string, sourceMessage?: ChatMessageWithMeta): Promise<void>;
  regenerateFromAssistant(messageId: string): Promise<void>;
  repairSourceWarning(warning: SourceValidationWarning, messageId: string): void;
  insertMessageIntoActiveNote(message: ChatMessageWithMeta): Promise<void>;
}

const messages: ChatMessageWithMeta[] = [
  {
    id: 'question',
    role: 'user',
    content: '합성 비교 질문',
    status: 'complete',
    timestamp: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'answer',
    role: 'assistant',
    content: '합성 답변 [source-1]',
    status: 'complete',
    timestamp: 2,
    createdAt: '',
    updatedAt: '',
  },
];

describe('메시지 행동의 작성 중 질문 보존', () => {
  let view: ActionView;
  const send = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    send.mockClear();
    view = Object.create(ChatView.prototype) as ActionView;
    Object.assign(view, {
      inputArea: { value: '작성 중인 별도 질문 @folder:Drafts' },
      messages: messages.map((message) => ({ ...message })),
      isStreaming: false,
      handleSend: send,
      markDirtyAndAutoSave: vi.fn(),
      rebuildMessagesDOM: vi.fn(),
      autoResizeInput: vi.fn(),
      renderContextPreview: vi.fn(),
    });
  });

  it('재생성은 원래 질문을 직접 전송하고 작성 중 질문을 덮어쓰지 않는다', async () => {
    await view.regenerateFromAssistant('answer');
    expect(send).toHaveBeenCalledWith('합성 비교 질문');
    expect(view.inputArea.value).toBe('작성 중인 별도 질문 @folder:Drafts');
  });

  it('출처 확인은 대상 답변을 함께 전송하고 작성 중 질문을 보존한다', () => {
    view.repairSourceWarning(
      {
        id: 'warning',
        label: 'source-1',
        detail: '합성 미확인 출처',
        kind: 'unverified-source',
      },
      'answer',
    );
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('source-1'),
      expect.objectContaining({ id: 'answer', content: messages[1].content }),
    );
    expect(view.inputArea.value).toBe('작성 중인 별도 질문 @folder:Drafts');
  });

  it('사라진 답변의 출처 확인은 다른 답변을 대상으로 전송하지 않는다', () => {
    view.repairSourceWarning(
      {
        id: 'warning',
        label: 'source-1',
        detail: '',
        kind: 'unverified-source',
      },
      'removed',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('현재 노트에 삽입한 답변은 출처와 확인 한계를 함께 남긴다', async () => {
    const active = { path: 'Drafts/synthetic.md' };
    const append = vi.fn().mockResolvedValue(undefined);
    Object.assign(view, {
      app: {
        workspace: { getActiveFile: () => active },
        vault: { append },
      },
    });
    await view.insertMessageIntoActiveNote({
      ...messages[1],
      citations: [
        {
          id: 'source-1',
          filePath: 'Sources/synthetic.md',
          line: 3,
          status: 'verified',
          preview: '합성 근거',
        },
      ],
      sourceWarnings: [
        {
          id: 'missing',
          label: '합성 제한',
          detail: '일부 자료를 확인하지 못했습니다.',
          kind: 'unverified-source',
        },
      ],
      stopReason: 'cancelled',
    });
    expect(append).toHaveBeenCalledWith(active, expect.stringContaining(messages[1].content));
    expect(append).toHaveBeenCalledWith(
      active,
      expect.stringContaining('[[Sources/synthetic.md]]'),
    );
    expect(append).toHaveBeenCalledWith(
      active,
      expect.stringContaining('일부 자료를 확인하지 못했습니다.'),
    );
    expect(append).toHaveBeenCalledWith(active, expect.stringContaining('중단'));
  });
});

describe('행동 전송과 일반 전송의 초안 수명 주기', () => {
  it('이전 실행의 컨텍스트 준비는 새 실행의 검색 기록에 연결되지 않는다', () => {
    const observer = { run: { token: 1, controller: new AbortController() }, record: vi.fn() };
    const nextObserver = { run: { token: 2, controller: new AbortController() }, record: vi.fn() };
    const engine = new RAGQueryEngine(null, null);
    const view = Object.create(ChatView.prototype) as {
      getChatQueryEngine(captured: typeof observer | null): unknown;
    };
    Object.assign(view, {
      plugin: { ragEngine: engine },
      activeRun: nextObserver.run,
      retrievalObserver: nextObserver,
    });
    expect(view.getChatQueryEngine(observer)).toBe(engine);
    expect(view.getChatQueryEngine(null)).toBe(engine);
    expect(observer.record).not.toHaveBeenCalled();
    expect(nextObserver.record).not.toHaveBeenCalled();
  });

  function createView() {
    vi.stubGlobal('HTMLElement', class {});
    const view = Object.create(ChatView.prototype) as ActionView;
    const storedMessages = messages.map((message) => ({ ...message }));
    const stream = vi.fn<LLMProvider['streamChat']>((_messages, onChunk) => {
      onChunk({ content: '합성 응답', done: true });
      return Promise.resolve();
    });
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue('합성 응답');
    const provider: LLMProvider = {
      capability: resolveProviderCapability({
        providerKey: 'ollama',
        model: 'synthetic',
        overrides: { maxToolRounds: 0 },
      }),
      chat,
      streamChat: stream,
    };
    vi.mocked(prepareChatProviderForModel).mockResolvedValue({
      providerKey: 'ollama',
      model: 'synthetic',
      providerLabel: '합성 제공자',
      provider,
    });
    const context = vi.fn().mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
    });
    Object.assign(view, {
      app: { workspace: { getActiveFile: () => null, iterateAllLeaves: vi.fn() } },
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
      },
      inputArea: { value: '작성 중인 별도 질문' },
      messages: storedMessages,
      activeVariantByRoot: new Map(),
      compatibilityToolModels: new Set(),
      messageEls: new Map(),
      runTokenSequence: 0,
      pendingRegeneration: null,
      isStreaming: false,
      setLoading: vi.fn(),
      getDraftAttachmentIds: () => [],
      autoResizeInput: vi.fn(),
      renderContextPreview: vi.fn(),
      parseMentions: () => [],
      getMentionedServerNames: () => [],
      getEffectiveMcpServerNames: () => [],
      getMentionOnlyServers: () => [],
      buildPromptContext: context,
      addMessage: (role: ChatMessageWithMeta['role'], content: string) => {
        const message = { ...messages[0], role, content, id: `message-${storedMessages.length}` };
        storedMessages.push(message);
        return message.id;
      },
      updateMessage: vi.fn(),
      markDirtyAndAutoSave: vi.fn(),
      validateAssistantSources: () => [],
      saveCurrentSession: vi.fn(),
      summarizeCurrentSessionTitle: vi.fn(),
      formatErrorDetail: () => '합성 실패',
      cancelRunningToolCalls: () => [],
    });
    return { view, stream, context, chat, storedMessages };
  }

  it('준비 과정과 최종 응답의 실제 사용량을 같은 답변에 연결한다', async () => {
    const { view, chat, stream, context, storedMessages } = createView();
    chat.mockImplementation((_messages, _temperature, _tools, options) => {
      options?.onUsage?.({ inputTokens: 10, outputTokens: 3, totalTokens: 13 });
      return Promise.resolve('합성 준비 결과');
    });
    context.mockImplementation(
      async (
        _text: string,
        _previous: readonly string[],
        _defer: boolean,
        _workspace: unknown,
        trackedProvider: LLMProvider,
      ) => {
        await trackedProvider.chat([]);
        return { systemPrompt: null, attachments: [], citations: [], warnings: [] };
      },
    );
    stream.mockImplementation((_messages, onChunk, _temperature, _tools, options) => {
      options?.onUsage?.({ inputTokens: 20, outputTokens: 7, totalTokens: 27 });
      onChunk({ content: '합성 최종 응답', done: true });
      return Promise.resolve();
    });
    await view.handleSend('합성 검색 질문');
    expect(storedMessages.at(-1)?.usageSnapshot).toEqual({
      requests: 2,
      reportedRequests: 2,
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
    });
  });

  it.each(['complete', 'error', 'cancelled'] as const)(
    '행동 전송의 %s 이후에도 작성 중 질문을 보존한다',
    async (outcome) => {
      const { view, stream } = createView();
      if (outcome !== 'complete')
        stream.mockRejectedValueOnce(
          outcome === 'cancelled'
            ? new DOMException('합성 취소', 'AbortError')
            : new Error('합성 오류'),
        );
      await view.handleSend('source-1 출처를 다시 확인해줘.', messages[1]);
      expect(stream).toHaveBeenCalled();
      expect(view.inputArea.value).toBe('작성 중인 별도 질문');
      expect(stream).toHaveBeenCalledWith(
        expect.arrayContaining([{ role: 'assistant', content: messages[1].content }]),
        expect.any(Function),
        0.7,
        undefined,
        expect.any(Object),
      );
    },
  );

  it('일반 전송은 성공하면 입력을 비우고 준비 실패 때는 원래 질문을 복원한다', async () => {
    const { view, context } = createView();
    await view.handleSend();
    expect(view.inputArea.value).toBe('');
    view.inputArea.value = '준비 실패 시 보존할 질문';
    context.mockRejectedValueOnce(new Error('합성 준비 실패'));
    await view.handleSend();
    expect(view.inputArea.value).toBe('준비 실패 시 보존할 질문');
  });

  it('행동 전송의 준비 실패는 기존 질문과 미리보기를 건드리지 않는다', async () => {
    const { view, context } = createView();
    context.mockRejectedValueOnce(new Error('합성 준비 실패'));
    await view.handleSend('합성 재시도');
    expect(view.inputArea.value).toBe('작성 중인 별도 질문');
  });
});
