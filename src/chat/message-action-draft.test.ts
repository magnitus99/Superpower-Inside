import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './view';
import type { ChatMessageWithMeta, SourceValidationWarning } from './types';
import { prepareChatProviderForModel } from '../llm/provider-resolution';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import type { LLMProvider } from '../llm/providers';
import { RAGQueryEngine } from '../rag/query';
import * as indexedSearch from '../search/indexed-search-deps';
import { getRagCandidateFiles } from '../utils/vault';
import { reviewIndexedVault, type IndexedVaultReviewResult } from '../agent/indexed-vault-review';

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
vi.mock('../agent/indexed-vault-review', () => ({ reviewIndexedVault: vi.fn() }));
vi.mock('../utils/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/vault')>()),
  getRagCandidateFiles: vi.fn(() => Promise.resolve([])),
}));

afterEach(() => vi.unstubAllGlobals());

function createReviewResult(
  overrides: Partial<IndexedVaultReviewResult> = {},
): IndexedVaultReviewResult {
  const coverage: IndexedVaultReviewResult['coverage'] = {
    status: 'supported',
    documentScope: 'all',
    reviewedDocuments: 1,
    unreviewedDocuments: 0,
    notIndexedDocuments: 0,
    requestedPaths: [],
    plannedPaths: [],
    unreviewedPaths: [],
  };
  const phase = () => ({ durationMs: 0, requests: 0, reportedRequests: 0 });
  return {
    outcome: 'answered',
    evidence: [],
    coverage,
    dossier: {
      question: '합성 질문',
      scoringQuestion: '합성 질문',
      previousUserQuestions: [],
      queryPlan: { queryTokens: [], phrases: [] },
      documentScope: 'all',
      evidence: [],
      coverage,
      diagnostics: null,
      notice: '합성 고지',
    },
    content: '합성 답변',
    citations: [],
    totalFiles: 1,
    processedFiles: 1,
    rejectedFiles: 0,
    providerTransfer: { sentFiles: 1 },
    coverageNotice: '합성 고지',
    engineUnavailable: false,
    diagnostics: {
      phases: {
        inventory: phase(),
        search: phase(),
        map: phase(),
        screen: phase(),
        extract: phase(),
        reduce: phase(),
        answer: phase(),
      },
      counts: {
        candidateSegments: 1,
        screenAcceptedSegments: 1,
        extractedSegments: 1,
        screenRetries: 0,
        extractRetries: 0,
        splitBatches: 0,
        reduceRequests: 0,
        cacheHits: 0,
      },
    },
    ...overrides,
  };
}

interface ActionView {
  inputArea: { value: string };
  skipAutoRagOnce?: boolean;
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

  function createView(maxToolRounds = 0) {
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('window', globalThis);
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
        overrides: { maxToolRounds },
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
      indexedReviewCache: new Map(),
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
      addMessage: (
        role: ChatMessageWithMeta['role'],
        content: string,
        _reasoning: unknown,
        _tools: unknown,
        meta: Partial<ChatMessageWithMeta> = {},
      ) => {
        const message = {
          ...messages[0], role, content, id: `message-${storedMessages.length}`, ...meta,
        };
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

  it('실제 채팅은 폴더·태그 제한을 집계 수집 시작부터 전달한다', async () => {
    const { view, context } = createView();
    context.mockResolvedValue({
      systemPrompt: null, attachments: [], citations: [], warnings: [], vaultSearchEnabled: true,
    });
    Object.assign(view, {
      parseMentions: () => [{ type: 'folder', name: 'Synthetic' }, { type: 'tag', name: 'limited' }],
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        getRetrievalReadiness: () => 'ready', prepareRagForChat: vi.fn(),
      },
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(createReviewResult());
    const collect = vi.spyOn(indexedSearch, 'collectIndexedSearchSource').mockResolvedValue(null);
    try {
      await view.handleSend('합성 범위 자료를 비교해줘');
      expect(collect.mock.calls[0]?.[7]).toEqual({
        scopes: ['Synthetic'], filters: { tags: ['limited'] },
      });
    } finally {
      collect.mockRestore();
    }
  });

  it('vault 질문은 준비 중 같은 실행을 보존하고 ready 전환 뒤 한 번만 재개한다', async () => {
    vi.useFakeTimers();
    const { view, context, stream, chat, storedMessages } = createView();
    const attachments = [{ id: 'synthetic-scope', type: 'folder', name: 'Synthetic', label: 'Synthetic' }];
    context.mockResolvedValue({
      systemPrompt: null,
      attachments,
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    const plugin = (view as unknown as { plugin: Record<string, unknown> }).plugin;
    let readiness = 'preparing';
    Object.assign(view, {
      parseMentions: () => [{ type: 'tag', name: 'synthetic-tag' }],
      plugin: {
        ...plugin,
        getRetrievalReadiness: () => readiness,
        prepareRagForChat: vi.fn(),
        documentCorpus: {
          getIndexedFilePaths: () => Promise.resolve([]),
          getEntriesByFilePaths: () => Promise.resolve([]),
          getFileIndexRecords: () => Promise.resolve([]),
        },
      },
    });
    vi.mocked(reviewIndexedVault).mockClear();
    vi.mocked(reviewIndexedVault).mockResolvedValue(createReviewResult());

    try {
      const pending = view.handleSend('합성 볼트 질문');
      await vi.advanceTimersByTimeAsync(0);
      expect(reviewIndexedVault).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      const activeRun = (view as unknown as { activeRun: { controller: AbortController } }).activeRun;
      expect(activeRun).not.toBeNull();
      expect(storedMessages.at(-1)?.status).not.toBe('complete');
      expect(storedMessages.at(-1)?.turnStage).toBe('building-context');

      readiness = 'ready';
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      expect(reviewIndexedVault).toHaveBeenCalledTimes(1);
      const expectedProvider: unknown = expect.any(Object);
      expect(reviewIndexedVault).toHaveBeenCalledWith(
        expect.objectContaining({
          question: '합성 볼트 질문', provider: expectedProvider,
          signal: activeRun.controller.signal,
          filters: { tags: ['synthetic-tag'] },
        }),
      );
      expect(storedMessages.filter((message) => message.content === '합성 볼트 질문')).toHaveLength(1);
      expect(storedMessages.at(-1)).toMatchObject({
        model: 'synthetic', providerKey: 'ollama', contextAttachments: attachments,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['stop', 'session', 'settings', 'model', 'degraded', 'read-error'] as const)(
    '준비 대기의 %s 경계에서 늦은 ready와 재전송은 이전 질문을 실행하지 않는다',
    async (outcome) => {
      vi.useFakeTimers();
      const { view, context, stream, chat, storedMessages } = createView();
      const originalText = '합성 대기 질문 @folder:Synthetic';
      view.inputArea.value = originalText;
      context.mockResolvedValue({
        systemPrompt: null,
        attachments: [{ id: 'scope', type: 'folder', name: 'Synthetic', label: 'Synthetic' }],
        citations: [], warnings: [], vaultSearchEnabled: true,
      });
      let readiness = 'preparing';
      let failed = false;
      const plugin = (view as unknown as { plugin: { settings: { chat: { defaultModel: string } } } }).plugin;
      const controls = view as unknown as {
        stopStreaming(): void;
        invalidateActiveChatRun(restoreDraft: boolean): void;
        updateMessage: ReturnType<typeof vi.fn>;
        summarizeCurrentSessionTitle: ReturnType<typeof vi.fn>;
      };
      Object.assign(view, {
        session: {},
        modelSelectEl: { value: 'ollama:synthetic' },
        plugin: {
          ...plugin,
          getRetrievalReadiness: () => {
            if (failed) throw new Error('synthetic readiness failure');
            return readiness;
          },
        },
        inputArea: { value: originalText, focus: vi.fn() },
        setLoading: vi.fn((loading: boolean) => Object.assign(view, { isStreaming: loading })),
      });
      vi.mocked(reviewIndexedVault).mockClear();
      try {
        const pending = view.handleSend();
        await vi.advanceTimersByTimeAsync(0);
        expect(storedMessages.filter((message) => message.content === originalText)).toHaveLength(1);
        await view.handleSend('무시할 중복 질문');
        expect(storedMessages.some((message) => message.content === '무시할 중복 질문')).toBe(false);
        if (outcome === 'stop') controls.stopStreaming();
        if (outcome === 'session') {
          controls.invalidateActiveChatRun(false);
          Object.assign(view, { session: {} });
        }
        if (outcome === 'settings') plugin.settings.chat.defaultModel = 'ollama:changed';
        if (outcome === 'model') {
          Object.assign(view, { modelSelectEl: { value: 'ollama:changed' } });
        }
        if (outcome === 'degraded') readiness = 'degraded';
        if (outcome === 'read-error') failed = true;
        await vi.advanceTimersByTimeAsync(500);
        await pending;
        const updates = controls.updateMessage.mock.calls.length;
        readiness = 'ready';
        failed = false;
        await vi.advanceTimersByTimeAsync(1000);
        expect(controls.updateMessage.mock.calls).toHaveLength(updates);
        expect(reviewIndexedVault).not.toHaveBeenCalled();
        expect(stream).not.toHaveBeenCalled();
        expect(chat).not.toHaveBeenCalled();
        expect(controls.summarizeCurrentSessionTitle).not.toHaveBeenCalled();
        expect(view.inputArea.value).toBe(outcome === 'stop' ? originalText : '');
        expect(storedMessages.filter((message) => message.content === originalText)).toHaveLength(1);
        if (outcome === 'degraded' || outcome === 'read-error') {
          expect(controls.updateMessage).toHaveBeenLastCalledWith(
            expect.any(String), expect.any(String), true, undefined, undefined,
            expect.objectContaining({ status: 'error', turnStage: 'error', stopReason: 'error' }),
          );
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('태그 멘션을 검색 엔진 필터로 전달한다', async () => {
    const { view, context } = createView();
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        ragEngine: null,
        documentCorpus: {
          getIndexedFilePaths: () => Promise.resolve(['Synthetic.md']),
          getEntriesByFilePaths: () => Promise.resolve([]),
          getFileIndexRecords: () => Promise.resolve([]),
        },
      },
      parseMentions: () => [{ type: 'tag', name: 'synthetic-tag' }],
      getEffectiveMcpServerNames: () => [],
      collectToolDefinitions: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(createReviewResult());
    await view.handleSend('@#synthetic-tag 합성 질문');
    expect(reviewIndexedVault).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { tags: ['synthetic-tag'] },
        documentScope: 'all',
        exhaustiveReview: false,
      }),
    );
  });

  it('전체 색인 수와 exhaustive review 경로를 분리해 전달한다', async () => {
    const { view, context } = createView();
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    const matchedPath = 'Synthetic/Matched.md';
    vi.mocked(getRagCandidateFiles).mockResolvedValueOnce([
      { path: matchedPath }, { path: 'Synthetic/Other.md' },
    ] as import('obsidian').TFile[]);
    const queryBm25Exhaustive = vi.fn(() =>
      Promise.resolve([{ path: matchedPath, score: 3, rank: 1 }]),
    );
    const plugin = (view as unknown as { plugin: Record<string, unknown> }).plugin;
    Object.assign(view, {
      plugin: {
        ...plugin,
        prepareRagForChat: vi.fn(),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive,
        },
        documentCorpus: {
          getIndexedFilePaths: () =>
            Promise.resolve([matchedPath, 'Synthetic/Other.md']),
          getEntriesByFilePaths: () => Promise.resolve([]),
          getFileIndexRecords: () => Promise.resolve([]),
        },
      },
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(createReviewResult());

    await view.handleSend('합성 전체 검토 질문');

    expect(reviewIndexedVault).toHaveBeenCalledWith(
      expect.objectContaining({
        indexedPaths: [matchedPath],
        exhaustiveReview: true,
        inventory: { indexedCount: 2, unreviewedCount: 0, notIndexedCount: 0 },
        documentScope: 'all',
      }),
    );
  });

  it('사용 가능한 MCP만 있으면 검수 답변을 재검색·재생성하지 않는다', async () => {
    const { view, stream, context, chat } = createView(3);
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    const updateMessage = vi.fn();
    const collectToolDefinitions = vi.fn().mockResolvedValue([]);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        documentCorpus: {
          getIndexedFilePaths: () => Promise.resolve(['Synthetic.md']),
          getEntriesByFilePaths: () => Promise.resolve([]),
          getFileIndexRecords: () => Promise.resolve([]),
        },
        ragEngine: null,
      },
      getEffectiveMcpServerNames: () => ['optional-server'],
      collectToolDefinitions,
      updateMessage,
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(
      createReviewResult({
        content: '검수 완료된 합성 답변',
        citations: [],
        totalFiles: 1,
        processedFiles: 1,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 1 },
        coverageNotice: '합성 검수 집계',
        diagnostics: {
          phases: {
            inventory: { durationMs: 0, requests: 0, reportedRequests: 0 },
            search: { durationMs: 0, requests: 0, reportedRequests: 0 },
            map: { durationMs: 0, requests: 0, reportedRequests: 0 },
            screen: { durationMs: 0, requests: 0, reportedRequests: 0 },
            extract: { durationMs: 0, requests: 0, reportedRequests: 0 },
            reduce: { durationMs: 0, requests: 0, reportedRequests: 0 },
            answer: { durationMs: 0, requests: 0, reportedRequests: 0 },
          },
          counts: {
            candidateSegments: 1,
            screenAcceptedSegments: 1,
            extractedSegments: 1,
            screenRetries: 0,
            extractRetries: 0,
            splitBatches: 0,
            reduceRequests: 0,
            cacheHits: 0,
          },
        },
        engineUnavailable: false,
      }),
    );
    await view.handleSend('합성 자료에 대한 질문');
    expect(reviewIndexedVault).toHaveBeenCalledWith(
      expect.objectContaining({ deferAnswer: false, documentScope: 'all' }),
    );
    expect(updateMessage).toHaveBeenCalledWith(
      expect.any(String),
      '검수 완료된 합성 답변',
      true,
      undefined,
      undefined,
      expect.objectContaining({ stopReason: 'complete' }),
    );
    expect(collectToolDefinitions).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it.each(['engine-unavailable', 'no-evidence', 'evidence-only'] as const)(
    '%s도 도구 루프 없이 본문과 검증 출처를 보존한다',
    async (outcome) => {
      const { view, stream, context, chat } = createView(3);
      context.mockResolvedValue({
        systemPrompt: null,
        attachments: [],
        citations: [],
        warnings: [],
        vaultSearchEnabled: true,
      });
      const collectToolDefinitions = vi.fn().mockResolvedValue([]);
      Object.assign(view, {
        plugin: {
          settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
          prepareRagForChat: vi.fn(),
          documentCorpus: {
            getIndexedFilePaths: () => Promise.resolve(['Synthetic.md']),
            getEntriesByFilePaths: () => Promise.resolve([]),
            getFileIndexRecords: () => Promise.resolve([]),
          },
          ragEngine: null,
          logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        getEffectiveMcpServerNames: () => ['optional-server'],
        collectToolDefinitions,
        updateMessage: vi.fn(),
      });
      vi.mocked(reviewIndexedVault).mockResolvedValue(
        createReviewResult({
          outcome,
          content: '엔진 결과 원문',
          citations:
            outcome === 'evidence-only'
              ? [
                  {
                    id: 'synthetic-source',
                    filePath: 'Synthetic.md',
                    preview: '합성 원문',
                    status: 'verified',
                  },
                ]
              : [],
          totalFiles: 1,
          processedFiles: 0,
          rejectedFiles: 0,
          providerTransfer: { sentFiles: 0 },
          coverageNotice: '미검증 합성 고지',
          engineUnavailable: true,
        }),
      );
      await view.handleSend('합성 자료에 대한 질문');
      expect(collectToolDefinitions).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect(Reflect.get(view, 'updateMessage')).toHaveBeenCalledWith(
        expect.any(String),
        '엔진 결과 원문',
        true,
        undefined,
        undefined,
        expect.objectContaining({
          citations:
            outcome === 'evidence-only'
              ? [expect.objectContaining({ id: 'synthetic-source', status: 'verified' })]
              : [],
          stopReason: 'complete',
        }),
      );
    },
  );

  it('일반 볼트 검토와 deep 요청 모두 전체 문서 범위를 전달한다', async () => {
    const { view, stream } = createView(0);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        ragEngine: null,
      },
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(createReviewResult());
    await view.handleSend('이 볼트 전체를 조사해서 요약해줘');
    expect(reviewIndexedVault).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentScope: 'all', deferAnswer: false }),
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it('검색 없이 보내기는 전체 볼트 연구를 끄고 플래그를 이번 실행에서만 소비한다', async () => {
    vi.mocked(reviewIndexedVault).mockClear();
    const { view, context, stream } = createView(0);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        ragEngine: null,
      },
      skipAutoRagOnce: true,
    });
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: false,
    });

    await view.handleSend('이 볼트 전체를 조사해서 요약해줘');

    expect(context.mock.calls[0]?.[7]).toBe(true);
    expect(view.skipAutoRagOnce).toBe(false);
    expect(reviewIndexedVault).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalled();
  });

  it('멘션 전용 서버 요청은 전체 볼트 연구와 dossier 주입을 끈다', async () => {
    vi.mocked(reviewIndexedVault).mockClear();
    const { view, context, stream } = createView(0);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        ragEngine: null,
      },
      getMentionedServerNames: () => ['synthetic-server'],
      getMentionOnlyServers: () => ['synthetic-server'],
    });
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });

    await view.handleSend('이 볼트 전체를 조사해서 요약해줘');

    expect(reviewIndexedVault).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalled();
  });

  it('mixed MCP에는 표시 본문 대신 dossier와 검증 출처만 주입한다', async () => {
    const { view, stream, context, chat } = createView(3);
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    const result = createReviewResult({
      outcome: 'evidence-only',
      content: '표시 전용 비JSON 원문 본문',
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(result);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        ragEngine: null,
      },
      getMentionedServerNames: () => ['external'],
      getEffectiveMcpServerNames: () => ['external'],
      collectToolDefinitions: vi.fn().mockResolvedValue([]),
    });
    await view.handleSend('합성 자료와 @external 결과를 비교해줘');
    expect(reviewIndexedVault).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentScope: 'all', deferAnswer: true }),
    );
    expect(stream).toHaveBeenCalled();
    const body = JSON.stringify(stream.mock.calls[0]?.[0]);
    expect(body).toContain('indexedEvidenceDossier');
    expect(body).toContain('합성 질문');
    expect(body).not.toContain(result.content);
    expect(chat).not.toHaveBeenCalled();
  });

  it('server-only 요청은 볼트 검토를 새로 시작하지 않는다', async () => {
    const { view, stream } = createView(3);
    vi.mocked(reviewIndexedVault).mockClear();
    Object.assign(view, {
      getMentionedServerNames: () => ['external'],
      getEffectiveMcpServerNames: () => ['external'],
      collectToolDefinitions: vi.fn().mockResolvedValue([]),
    });
    await view.handleSend('@external 상태를 알려줘');
    expect(reviewIndexedVault).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledOnce();
  });

  it('채팅 도구 catalog는 외부 MCP만 노출한다', async () => {
    const { view } = createView();
    const run = { token: 1, controller: new AbortController() };
    Object.assign(view, { activeRun: run, plugin: { mcpRegistry: null } });
    const collect = Reflect.get(view, 'collectToolDefinitions') as (
      servers: string[],
      explicit: string[],
      activeRun: typeof run,
    ) => Promise<import('../llm/providers').ToolDefinition[]>;
    expect(await collect.call(view, [], [], run)).toEqual([]);
    const listTools = vi.fn().mockResolvedValue([
      {
        name: 'remote_lookup',
        description: '합성 외부 조회',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    Object.assign(view, { plugin: { mcpRegistry: { getClient: () => ({ listTools }) } } });
    const definitions = await collect.call(view, ['external'], ['external'], run);
    expect(definitions.map((definition) => definition.function.name)).toEqual(['remote_lookup']);
    expect(listTools).toHaveBeenCalledWith(run.controller.signal);
    listTools.mockRejectedValueOnce(new Error('합성 discovery 실패'));
    await expect(collect.call(view, ['external'], ['external'], run)).rejects.toThrow('external');
  });

  it('공통 factory의 corpus·hybrid 후보·리비전 reader를 엔진 검토에 전달한다', async () => {
    const { view, context } = createView(0);
    context.mockResolvedValue({
      systemPrompt: null,
      attachments: [],
      citations: [],
      warnings: [],
      vaultSearchEnabled: true,
    });
    vi.mocked(getRagCandidateFiles).mockResolvedValueOnce([
      { path: 'Synthetic/Hybrid.md' },
    ] as import('obsidian').TFile[]);
    const corpus = {
      getIndexedFilePaths: () => Promise.resolve(['Synthetic/Hybrid.md']),
      getEntriesByFilePaths: () => Promise.resolve([]),
      getFileIndexRecords: () => Promise.resolve([]),
    };
    const query = vi.fn().mockResolvedValue([
      {
        entry: { metadata: { startLine: 4, endLine: 6 } },
        sourcePath: 'Synthetic/Hybrid.md',
        combinedScore: 0.8,
        bm25Score: 2,
        vectorScore: 0,
        retrievalSources: ['bm25'],
      },
    ]);
    Object.assign(view, {
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { defaultModel: 'ollama:synthetic' } },
        prepareRagForChat: vi.fn(),
        documentCorpus: corpus,
        ragEngine: { query },
        logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
      updateMessage: vi.fn(),
    });
    vi.mocked(reviewIndexedVault).mockResolvedValue(
      createReviewResult({
        content: '합성 해석',
        citations: [],
        totalFiles: 1,
        processedFiles: 1,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 1 },
        coverageNotice: '합성 집계',
        engineUnavailable: false,
      }),
    );
    await view.handleSend('합성 검색 질문');
    const options = vi.mocked(reviewIndexedVault).mock.calls.at(-1)?.[0];
    expect(options?.corpus).toBe(corpus);
    expect(options?.candidates?.[0]).toMatchObject({
      path: 'Synthetic/Hybrid.md',
      startLine: 4,
      rank: 1,
      source: 'bm25',
    });
    expect(typeof options?.revisionReader).toBe('function');
  });

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

describe('전수 검수 뒤 승인 대기 재개', () => {
  it('현재 정책과 원문으로 다시 검수한 근거만 후속 provider에 전달한다', async () => {
    const citation = {
      id: 'vault:Current/Fresh.md:1-2',
      filePath: 'Current/Fresh.md',
      preview: '새로운 독립 합성 근거',
      status: 'verified' as const,
      line: 1,
      endLine: 2,
    };
    const phase = () => ({ durationMs: 0, requests: 0, reportedRequests: 0 });
    const diagnostics = {
      phases: {
        inventory: phase(),
        search: phase(),
        map: phase(),
        screen: phase(),
        extract: phase(),
        reduce: phase(),
        answer: phase(),
      },
      counts: {
        candidateSegments: 1,
        screenAcceptedSegments: 1,
        extractedSegments: 1,
        screenRetries: 0,
        extractRetries: 0,
        splitBatches: 0,
        reduceRequests: 0,
        cacheHits: 0,
      },
    };
    const reviewContent = '현재 정책으로 확인한 독립 합성 검수 근거';
    vi.mocked(reviewIndexedVault).mockResolvedValue(
      createReviewResult({
        content: reviewContent,
        citations: [citation],
        totalFiles: 1,
        processedFiles: 1,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 1 },
        coverageNotice: '현재 검수 고지',
        diagnostics,
        engineUnavailable: false,
      }),
    );
    const pending = {
      id: 'pending-call',
      name: 'synthetic_tool',
      arguments: '{}',
      status: 'running',
      approved: false,
      serverName: 'synthetic-server',
      executionKind: 'mcp',
    };
    const storedMessages = [
      messages[0],
      {
        ...messages[1],
        providerKey: 'ollama',
        model: 'synthetic',
        content: '오래된 검수 답변',
        citations: [
          { ...citation, id: 'old-source', filePath: 'Excluded.md', preview: '오래된 제외 근거' },
        ],
        toolCalls: [pending],
        indexedReviewDiagnostics: diagnostics,
        indexedReviewNotice: '오래된 검수 고지',
      },
    ];
    const provider: LLMProvider = {
      capability: resolveProviderCapability({
        providerKey: 'ollama',
        model: 'synthetic',
        overrides: { maxToolRounds: 3 },
      }),
      chat: vi.fn().mockResolvedValue(''),
      streamChat: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(prepareChatProviderForModel).mockResolvedValue({
      providerKey: 'ollama',
      model: 'synthetic',
      providerLabel: '합성 제공자',
      provider,
    });
    const runToolResponseLoop = vi
      .fn<
        (options: {
          baseMessages: Array<{ role: string; content: string }>;
          meta: {
            citations?: ChatMessageWithMeta['citations'];
            dataBoundarySnapshot?: ChatMessageWithMeta['dataBoundarySnapshot'];
            indexedReviewNotice?: string;
          };
        }) => Promise<void>
      >()
      .mockResolvedValue(undefined);
    const view = Object.create(ChatView.prototype) as {
      approveToolCall(messageId: string, toolCallId: string): Promise<void>;
    };
    Object.assign(view, {
      app: { workspace: { getActiveFile: () => null, iterateAllLeaves: vi.fn() } },
      plugin: {
        settings: { pluginAwareEnabled: false, chat: { mcpMentionOnly: true } },
        prepareRagForChat: vi.fn().mockResolvedValue(undefined),
        documentCorpus: {
          getIndexedFilePaths: () => Promise.resolve(['Current/Fresh.md']),
          getEntriesByFilePaths: () => Promise.resolve([]),
          getFileIndexRecords: () => Promise.resolve([]),
        },
        ragEngine: null,
      },
      messages: storedMessages,
      runTokenSequence: 0,
      isStreaming: false,
      compatibilityToolModels: new Set(),
      setLoading: vi.fn(),
      updateMessage: vi.fn(),
      markDirtyAndAutoSave: vi.fn(),
      saveCurrentSession: vi.fn().mockResolvedValue(undefined),
      summarizeCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
      getMentionedServerNames: () => ['synthetic-server'],
      getEffectiveMcpServerNames: () => ['synthetic-server'],
      getMentionOnlyServers: () => ['synthetic-server'],
      parseMentions: () => [{ type: 'folder', name: 'Current' }],
      executeAssistantToolCalls: vi
        .fn()
        .mockResolvedValue([
          { ...pending, status: 'success', approved: true, result: '독립 합성 외부 결과' },
        ]),
      buildPromptContext: vi.fn().mockResolvedValue({
        systemPrompt: '합성 재개 지침',
        attachments: [],
        citations: [],
        warnings: [],
      }),
      collectToolDefinitions: vi.fn().mockResolvedValue([]),
      runToolResponseLoop,
      formatErrorDetail: () => '합성 오류',
    });
    vi.mocked(getRagCandidateFiles).mockResolvedValueOnce([
      { path: 'Current/Fresh.md' },
    ] as import('obsidian').TFile[]);
    await view.approveToolCall('answer', 'pending-call');
    expect(reviewIndexedVault).toHaveBeenCalledWith(
      expect.objectContaining({
        indexedPaths: ['Current/Fresh.md'],
        scopes: ['Current'],
        deferAnswer: true,
        documentScope: 'all',
        exhaustiveReview: false,
      }),
    );
    expect(runToolResponseLoop).toHaveBeenCalledOnce();
    const resumed = runToolResponseLoop.mock.calls[0]?.[0];
    const providerBody = JSON.stringify(resumed?.baseMessages);
    expect(providerBody).toContain('indexedEvidenceDossier');
    expect(providerBody).toContain('합성 질문');
    expect(providerBody).not.toContain(reviewContent);
    expect(providerBody).not.toContain('오래된 검수 답변');
    expect(providerBody).not.toContain('오래된 제외 근거');
    expect(resumed?.meta.citations).toContainEqual(citation);
    expect(resumed?.meta.citations).not.toContainEqual(
      expect.objectContaining({ filePath: 'Excluded.md' }),
    );
    expect(resumed?.meta.dataBoundarySnapshot?.providerPayload?.researchDocuments).toBe(1);
    expect(resumed?.meta.indexedReviewNotice).toBe('현재 검수 고지');
  });
});
