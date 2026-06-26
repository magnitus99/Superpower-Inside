import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = document.createElement('div');
    open(): void {}
    close(): void {}
  },
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import {
  buildEmbeddingModelOptions,
  resolveProviderReadiness,
  selectInitialEmbeddingModel,
  buildGraphRagActionGroups,
  getGraphRagIndexingResultNotice,
  getGraphRagLiveStatusPresentation,
  getGraphRagControlState,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  normalizeRagPerformanceTuningMode,
  resolveRagPerformanceSettings,
  shouldRequireProviderApiKey,
  shouldShowProviderApiKey,
} from './rag/settings-display';
import {
  buildSettingsTabs,
  buildEmbeddingModels,
  buildEmbeddingProviderOptions,
  buildMcpJsonEditorValue,
  buildChatModelOptions,
  buildEmbeddingProfileModelOptions,
  buildProviderModelRef,
  DEFAULT_SETTINGS,
  migrateLegacyProviderProfiles,
  normalizeAgentDiagnosticsSettings,
  normalizeChatSaveFolder,
  parseProviderModelRef,
  SuperpowerInsideSettingTab,
  upsertProviderProfileModel,
} from './settings';
import { CONTEXT7_MCP_SERVER_NAME, shouldShowPluginAwareContext7Warning } from './mcp/context7';
import { setLanguage, t } from './i18n';

afterEach(() => {
  vi.useRealTimers();
  setLanguage('ko');
});

describe('RAG 설정 표시 헬퍼', () => {
  it('provider profile model refs preserve provider id and colon-containing model ids', () => {
    const value = buildProviderModelRef('local-ollama', 'qwen3:8b-q8_0');

    expect(value).toBe('profile:local-ollama:qwen3:8b-q8_0');
    expect(parseProviderModelRef(value)).toEqual({
      kind: 'profile',
      profileId: 'local-ollama',
      modelId: 'qwen3:8b-q8_0',
    });
    expect(parseProviderModelRef('openai:gpt-4o-mini')).toEqual({
      kind: 'legacy',
      providerKey: 'openai',
      modelId: 'gpt-4o-mini',
    });
    expect(parseProviderModelRef('customOpenAI:local:auto')).toEqual({
      kind: 'legacy-custom-openai',
      providerId: 'local',
      modelId: 'auto',
    });
  });

  it('provider profile model classification is exclusive and embedding wins conflicts', () => {
    const models = upsertProviderProfileModel(
      upsertProviderProfileModel([], {
        id: 'qwen3',
        kind: 'general',
        verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
      }),
      {
        id: 'qwen3',
        kind: 'embedding',
        verification: { chatStatus: 'success', embeddingStatus: 'success' },
      },
    );

    expect(models).toEqual([
      {
        id: 'qwen3',
        kind: 'embedding',
        verification: { chatStatus: 'success', embeddingStatus: 'success' },
      },
    ]);
  });

  it('model selectors split general chat models from embedding models', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      providerProfiles: [
        {
          id: 'local',
          name: 'Local',
          strategy: 'ollama' as const,
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          enabled: true,
          models: [
            {
              id: 'llama3.1',
              kind: 'general' as const,
              verification: { chatStatus: 'success' as const, embeddingStatus: 'unknown' as const },
            },
            {
              id: 'qwen3-embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'success' as const },
            },
          ],
        },
      ],
    };

    expect(
      buildChatModelOptions(settings, {
        currentModel: '',
      }).map((option) => option.value),
    ).toEqual(['profile:local:llama3.1']);
    expect(
      buildEmbeddingProfileModelOptions(settings, {
        currentModel: '',
      }).map((option) => option.value),
    ).toEqual(['profile:local:qwen3-embed']);
  });

  it('does not create provider profiles from untouched default RAG embedding settings', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      providerProfiles: [],
    });

    expect(migrated.providerProfiles).toEqual([]);
    expect(migrated.rag.embeddingModelRef).toBe('');
  });

  it('legacy provider settings migrate to profiles and embedding classification wins default chat conflicts', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        enabled: true,
        models: ['gpt-4o-mini', 'text-embedding-3-small'],
      },
      chat: {
        ...DEFAULT_SETTINGS.chat,
        defaultModel: 'openai:text-embedding-3-small',
      },
      rag: {
        ...DEFAULT_SETTINGS.rag,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    });

    expect(migrated.providerProfiles).toEqual([
      expect.objectContaining({
        id: 'openai',
        name: 'OpenAI',
        strategy: 'openai',
        models: [
          expect.objectContaining({ id: 'gpt-4o-mini', kind: 'general' }),
          expect.objectContaining({ id: 'text-embedding-3-small', kind: 'embedding' }),
        ],
      }),
    ]);
    expect(migrated.chat.defaultModel).toBe('');
    expect(migrated.rag.embeddingModelRef).toBe('profile:openai:text-embedding-3-small');
  });

  it('설정 탭 라벨은 현재 언어로 매번 다시 계산한다', () => {
    setLanguage('ko');
    expect(buildSettingsTabs().find((tab) => tab.id === 'providers')?.label).toBe('프로바이더');

    setLanguage('en');
    expect(buildSettingsTabs().find((tab) => tab.id === 'providers')?.label).toBe('Providers');
    expect(buildSettingsTabs().find((tab) => tab.id === 'chat')?.label).toBe('Chat');
    expect(buildSettingsTabs().find((tab) => tab.id === 'advanced')?.label).toBe('Advanced');
  });

  it('채팅 저장 폴더 제외 설명에 현재 폴더를 표시한다', () => {
    expect(getChatFolderExcludeDescription('CustomChats')).toContain('현재 제외 대상: CustomChats');
    expect(getChatFolderExcludeDescription('')).toContain('현재 제외 대상: 미설정');
  });

  it('Ollama Local만 API Key 입력을 숨긴다', () => {
    expect(shouldShowProviderApiKey('ollama')).toBe(false);
    expect(shouldShowProviderApiKey('ollamaCloud')).toBe(true);
    expect(shouldShowProviderApiKey('openai')).toBe(true);
    expect(shouldShowProviderApiKey('customOpenAI')).toBe(true);
    expect(shouldRequireProviderApiKey('customOpenAI')).toBe(false);
  });

  it('Provider readiness는 API 키보다 실제 검증 성공을 우선한다', () => {
    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
        validation: {
          authenticated: true,
          serverReachable: true,
        },
      }).tone,
    ).toBe('ready');

    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
        validation: {
          authenticated: false,
          serverReachable: true,
        },
      }).tone,
    ).toBe('ready');

    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
      }).tone,
    ).toBe('needs-key');
  });

  it('RAG 임베딩 모델 옵션은 preset, provider 모델, 현재 선택 모델을 보존해 병합한다', () => {
    const options = buildEmbeddingModelOptions(
      [
        {
          id: 'text-embedding-3-small',
          name: 'OpenAI Small',
          dimensions: 1536,
          description: 'preset',
        },
      ],
      ['text-embedding-3-small', 'custom-embedding'],
      'legacy-selected',
    );

    expect(options.map((option) => option.id)).toEqual([
      'text-embedding-3-small',
      'custom-embedding',
      'legacy-selected',
    ]);
    expect(options.find((option) => option.id === 'text-embedding-3-small')?.source).toBe('preset');
    expect(options.find((option) => option.id === 'custom-embedding')?.source).toBe('provider');
    expect(options.find((option) => option.id === 'legacy-selected')?.label).toContain(
      '현재 선택됨',
    );
  });

  it('RAG 임베딩 모델 옵션은 embedding 검증 성공 모델을 먼저 표시하고 chat-only 모델을 확정하지 않는다', () => {
    const options = buildEmbeddingModelOptions(
      [],
      ['chat-only-model', 'embedding-model', 'unknown-model'],
      'chat-only-model',
      {
        'chat-only-model': { chatStatus: 'success', embeddingStatus: 'unknown' },
        'embedding-model': { chatStatus: 'unknown', embeddingStatus: 'success' },
      },
    );

    expect(options.map((option) => option.id)).toEqual([
      'embedding-model',
      'chat-only-model',
      'unknown-model',
    ]);
    expect(options.find((option) => option.id === 'embedding-model')?.embeddingStatus).toBe(
      'success',
    );
    expect(options.find((option) => option.id === 'chat-only-model')?.embeddingStatus).toBe(
      'unknown',
    );
  });

  it('Ollama Local로 전환할 때 embedding 검증 성공 모델이 없으면 preset 모델을 자동 선택하지 않는다', () => {
    const options = buildEmbeddingModelOptions(
      [
        {
          id: 'legacy-hardcoded-embedding',
          name: 'legacy-hardcoded-embedding',
          dimensions: 384,
          description: 'preset',
        },
      ],
      ['llama3.1'],
      '',
    );

    expect(selectInitialEmbeddingModel(options)).toBe('');
  });

  it('Ollama Local 임베딩 모델은 하드코딩 preset을 제공하지 않는다', () => {
    expect(buildEmbeddingModels().ollama).toEqual([]);
  });

  it('RAG 임베딩 프로바이더 옵션에는 활성화된 custom OpenAI-compatible provider를 포함한다', () => {
    const options = buildEmbeddingProviderOptions([
      {
        id: 'local',
        name: 'Local Embeddings',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        models: ['custom-embedding'],
        enabled: true,
        useRequestUrl: true,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        apiKey: '',
        baseUrl: 'http://localhost:5678/v1',
        models: [],
        enabled: false,
      },
    ]);

    expect(options).toContainEqual({ value: 'customOpenAI:local', label: 'Local Embeddings' });
    expect(options.some((option) => option.value === 'customOpenAI:disabled')).toBe(false);
  });

  it('GraphRAG 모델 옵션은 custom provider 내부 id 대신 사용자가 정한 이름을 표시한다', () => {
    const options = buildChatModelOptions(
      {
        ...DEFAULT_SETTINGS,
        customOpenAIProviders: [
          {
            id: 'custom-1',
            name: 'Onyx Graph Provider',
            apiKey: 'key',
            baseUrl: 'https://example.com/v1',
            models: ['auto'],
            enabled: true,
            useRequestUrl: true,
          },
        ],
      },
      { currentModel: 'customOpenAI:custom-1:auto', includeEmpty: true },
    );

    expect(options).toContainEqual({
      value: 'customOpenAI:custom-1:auto',
      label: 'Onyx Graph Provider / auto',
    });
    expect(options.map((option) => option.label).join('\n')).not.toContain('custom-1');
  });

  it('채팅 저장 폴더 값은 레거시 이름이어도 저장된 값을 그대로 보존한다', () => {
    expect(normalizeChatSaveFolder('SuperObsidianByAI')).toBe('SuperObsidianByAI');
    expect(normalizeChatSaveFolder('SuperObsidianByAIChats')).toBe('SuperObsidianByAIChats');
    expect(normalizeChatSaveFolder('SuperpowerInside')).toBe('SuperpowerInside');
    expect(normalizeChatSaveFolder('CustomChats')).toBe('CustomChats');
    expect(normalizeChatSaveFolder(undefined)).toBeNull();
  });

  it('기본 RAG 제외 경로에는 채팅 저장 폴더명을 하드코딩하지 않는다', () => {
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInsideChats');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInside');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAI');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAIChats');
  });

  it('신규 설치 기본 RAG 설정은 성능 보호를 켠다', () => {
    expect(DEFAULT_SETTINGS.rag.performanceTuningMode).toBe('auto');
    expect(DEFAULT_SETTINGS.rag.performanceGuardEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.rag.maxEmbeddingBatchSize).toBe(32);
    expect(DEFAULT_SETTINGS.rag.indexingYieldMs).toBe(25);
    expect(DEFAULT_SETTINGS.rag.slowEventLoopThresholdMs).toBe(150);
    expect(DEFAULT_SETTINGS.rag.slowBatchThresholdMs).toBe(3000);
  });

  it('자동 성능 설정은 Ollama와 그 외 프로바이더에 다른 기본값을 적용한다', () => {
    expect(resolveRagPerformanceSettings(DEFAULT_SETTINGS.rag)).toEqual({
      enabled: true,
      maxEmbeddingBatchSize: 32,
      indexingYieldMs: 25,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });

    expect(
      resolveRagPerformanceSettings({
        ...DEFAULT_SETTINGS.rag,
        embeddingProvider: 'ollama',
      }),
    ).toEqual({
      enabled: true,
      maxEmbeddingBatchSize: 1,
      indexingYieldMs: 50,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });
  });

  it('수동 성능 설정은 저장된 override 값을 그대로 사용한다', () => {
    expect(
      resolveRagPerformanceSettings({
        ...DEFAULT_SETTINGS.rag,
        performanceTuningMode: 'custom',
        performanceGuardEnabled: false,
        maxEmbeddingBatchSize: 7,
        indexingYieldMs: 80,
        slowEventLoopThresholdMs: 220,
        slowBatchThresholdMs: 4200,
      }),
    ).toEqual({
      enabled: false,
      maxEmbeddingBatchSize: 7,
      indexingYieldMs: 80,
      slowEventLoopThresholdMs: 220,
      slowBatchThresholdMs: 4200,
    });
  });

  it('저장된 성능 튜닝 모드는 migration에서 auto/custom으로 정규화한다', () => {
    expect(normalizeRagPerformanceTuningMode('custom')).toBe('custom');
    expect(normalizeRagPerformanceTuningMode('auto')).toBe('auto');
    expect(normalizeRagPerformanceTuningMode(undefined)).toBe('auto');
    expect(normalizeRagPerformanceTuningMode('legacy')).toBe('auto');
  });

  it('RAG 인덱싱 제어 버튼 비활성 사유를 계산한다', () => {
    expect(
      getRagIndexingControlState({
        hasIndexer: false,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toContain('초기화되지');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: true,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toBe('인덱싱이 이미 실행 중입니다.');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardRemainingPauseMs: 12_400,
      }).updatePending.reason,
    ).toBe('성능 보호 대기 중입니다. 약 13초 후 다시 시도할 수 있습니다.');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 0,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toBe('업데이트가 필요한 문서가 없습니다.');
  });

  it('전체 재인덱싱은 업데이트 대상이 없어도 전체 문서가 있으면 활성화한다', () => {
    const state = getRagIndexingControlState({
      hasIndexer: true,
      isIndexing: false,
      totalDocuments: 10,
      updateRequiredCount: 0,
      guardRemainingPauseMs: null,
    });

    expect(state.updatePending.disabled).toBe(true);
    expect(state.reindexAll.disabled).toBe(false);
    expect(state.reindexAll.reason).toBeNull();
  });

  it('RAG 상태 계산은 런타임이 없으면 명시 초기화를 먼저 시도한다', async () => {
    const file = {
      path: 'note.md',
      name: 'note.md',
      basename: 'note',
      extension: 'md',
      stat: { ctime: 1, mtime: 1, size: 12 },
    };
    const vectorStore = {
      getFileIndexRecords: vi.fn(() => Promise.resolve([])),
    };
    const plugin = {
      app: {
        vault: {
          configDir: '.obsidian',
          getFiles: vi.fn(() => [file]),
          cachedRead: vi.fn(() => Promise.resolve('문서 내용')),
        },
      },
      settings: {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          excludePaths: [],
          excludeExts: [],
          excludeChatFolder: false,
        },
      },
      eventDrivenRagStats: null,
      vectorStore: null as typeof vectorStore | null,
      getRagRuntimeState: vi.fn(() => ({
        ragStatus: plugin.eventDrivenRagStats,
        graphRagStatus: null,
        vectorStore: plugin.vectorStore,
        embeddingProvider: null,
        ragIndexingScheduler: null,
        ragIndexingStatus: null,
        hasIndexer: plugin.vectorStore !== null,
        nextAutoUpdateAt: null,
        lastAutoUpdateSkippedReason: null,
        lastAutoUpdateResult: null,
        lastInitError: null,
        lastInitSkippedReason: null,
      })),
      ensureRagRuntimeInitialized: vi.fn(() => {
        plugin.vectorStore = vectorStore;
        return Promise.resolve(true);
      }),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    const status = await (
      tab as unknown as {
        getRagStatus(): Promise<{ totalDocuments: number } | null>;
      }
    ).getRagStatus();

    expect(plugin.ensureRagRuntimeInitialized).toHaveBeenCalledOnce();
    expect(status?.totalDocuments).toBe(1);
  });

  it('GraphRAG 작업 버튼은 실행 범위와 차이를 라벨/설명에 드러낸다', () => {
    const groups = buildGraphRagActionGroups({
      controls: {
        start: { disabled: false, reason: null },
        cancel: { disabled: true, reason: '실행 중인 GraphRAG 인덱싱이 없습니다.' },
        resume: { disabled: false, reason: null },
      },
      syncStale: { disabled: false, reason: null },
      buildCommunities: { disabled: false, reason: null },
      resetGraphRag: { disabled: false, reason: null },
      openExplorer: { disabled: false, reason: null },
      totalCandidateFiles: 50,
      maxFilesPerRun: 20,
      failedFileCount: 3,
      staleFileCount: 7,
    });

    expect(groups.map((group) => group.label)).toEqual(['추출 실행', '그래프 정리', '결과 확인']);
    expect(groups.flatMap((group) => group.actions.map((action) => action.label))).toEqual([
      '전체 추출 실행',
      '실행 중지',
      '실패만 재시도 (3)',
      '변경분 동기화 (7)',
      '커뮤니티 다시 빌드',
      'GraphRAG 데이터 초기화',
      '탐색기 열기',
    ]);
    expect(groups[0]?.actions[0]?.description).toContain('대상 50개 중 최대 20개');
    expect(groups[0]?.actions[2]?.description).toContain('성공한 파일은 건드리지 않습니다');
    expect(groups[1]?.actions[1]?.description).toContain(
      '증거, 엔티티, 관계, 클레임, 커뮤니티, 캐시를 즉시 삭제하고 진행 상태를 초기화합니다.',
    );
    expect(groups[1]?.actions[0]?.description).toContain('파일 재추출은 하지 않습니다');
  });

  it('GraphRAG live 상태는 현재 phase와 파일 진행률을 작은 패널 문구로 바꾼다', () => {
    const status = getGraphRagLiveStatusPresentation({
      isRunning: true,
      phase: 'api-response-normalizing',
      currentFile: 'folder/note.md',
      processedFiles: 2,
      skippedFiles: 1,
      failedFiles: 1,
      selectedFiles: 8,
      processedChunks: 0,
      skippedChunks: 0,
      failedChunks: 0,
      storedEvidence: 0,
      storedEntities: 0,
      storedRelations: 0,
      storedClaims: 0,
      storedRejectedFacts: 0,
      cachedChunks: 0,
    });

    expect(status.active).toBe(true);
    expect(status.title).toBe('지금 GraphRAG가 인덱싱 중입니다');
    expect(status.phaseLabel).toBe('API 응답 정리 중');
    expect(status.detail).toBe('4/8 파일 처리 중 (note.md) — 50%');
    expect(status.chunkDetail).toBeNull();
    expect(status.storageDetail).toBeNull();
  });

  it('GraphRAG live 상태는 청크 처리량과 저장 항목 수를 함께 보여준다', () => {
    const status = getGraphRagLiveStatusPresentation({
      isRunning: true,
      phase: 'storing-results',
      currentFile: 'folder/note.md',
      processedFiles: 57,
      skippedFiles: 0,
      failedFiles: 2,
      selectedFiles: 1406,
      processedChunks: 12,
      skippedChunks: 3,
      failedChunks: 2,
      storedEvidence: 12,
      storedEntities: 38,
      storedRelations: 21,
      storedClaims: 9,
      storedRejectedFacts: 2,
      cachedChunks: 10,
    });

    expect(status.detail).toBe('59/1406 파일 처리 중 (note.md) — 4%');
    expect(status.chunkDetail).toBe('청크 12개 저장 완료, 2개 실패');
    expect(status.storageDetail).toBe('저장됨: 증거 12, 엔티티 38, 관계 21, 클레임 9, 거부 2');
  });

  it('GraphRAG live 상태는 실행 중이 아니면 비활성 패널 상태를 반환한다', () => {
    expect(
      getGraphRagLiveStatusPresentation({
        isRunning: false,
        phase: 'completed',
        currentFile: null,
        processedFiles: 5,
        skippedFiles: 0,
        failedFiles: 0,
        selectedFiles: 5,
        processedChunks: 3,
        skippedChunks: 0,
        failedChunks: 0,
        storedEvidence: 3,
        storedEntities: 2,
        storedRelations: 1,
        storedClaims: 1,
        storedRejectedFacts: 0,
        cachedChunks: 3,
      }),
    ).toEqual({
      active: false,
      title: 'GraphRAG 인덱싱 대기 중',
      phaseLabel: '추출 완료',
      detail: '실행 중인 GraphRAG 인덱싱이 없습니다.',
      chunkDetail: null,
      storageDetail: null,
    });
  });

  it('변경분 동기화가 처리할 파일 없이 끝나면 완료 대신 이유를 안내한다', () => {
    const notice = getGraphRagIndexingResultNotice(
      {
        totalCandidateFiles: 0,
        selectedFiles: 0,
        processedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        processedChunks: 0,
        skippedChunks: 0,
        failedChunks: 0,
        cancelled: false,
        startedAt: 1,
        finishedAt: 2,
        runId: 1,
      },
      'syncStale',
    );

    expect(notice).toBe(
      'GraphRAG 변경분 동기화: 다시 추출할 파일이 없습니다. 모든 파일이 최신 상태이거나 현재 RAG 인덱스에 남아 있는 변경 후보가 없습니다.',
    );
  });

  it('resetGraphRag 액션은 확인창 승인 시 plugin.resetGraphRagData를 호출하고 상태 갱신합니다', async () => {
    const refreshSpy = vi.fn();
    const plugin = {
      app: {} as never,
      settings: {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          graphRagEnabled: true,
          graphRagModel: 'openai:gpt-4.1-mini',
          graphRagMaxFilesPerRun: 10,
        },
      },
      graphRagStatus: null,
      knowledgeGraphStore: null,
      vectorStore: null,
      saveSettings: vi.fn(),
      saveSettingsLight: vi.fn(),
      reconnectMCP: vi.fn(),
      setupAutoUpdate: vi.fn(),
      isGraphRagIndexing: vi.fn(() => false),
      cancelGraphRagIndexing: vi.fn(),
      runGraphRagIndexing: vi.fn(),
      resumeGraphRagIndexing: vi.fn(),
      syncStaleGraphRag: vi.fn(),
      buildGraphRagCommunities: vi.fn(),
      resetGraphRagData: vi.fn(() => Promise.resolve()),
      hasGraphRagRunner: vi.fn(() => true),
      openGraphRagView: vi.fn(),
      eventDrivenRagStats: null,
      getRagRuntimeState: vi.fn(() => ({
        ragStatus: null,
        graphRagStatus: plugin.graphRagStatus,
        vectorStore: plugin.vectorStore,
        embeddingProvider: null,
        ragIndexingScheduler: null,
        ragIndexingStatus: null,
        hasIndexer: false,
        nextAutoUpdateAt: null,
        lastAutoUpdateSkippedReason: null,
        lastAutoUpdateResult: null,
        lastInitError: null,
        lastInitSkippedReason: null,
      })),
      initRAG: vi.fn(),
      isRagIndexing: vi.fn(),
      cancelRagIndexing: vi.fn(),
      runRagIndexing: vi.fn(),
      resumeRagIndexing: vi.fn(),
      getRagPerformanceGuardState: vi.fn(),
      createIndexedDbName: vi.fn(),
      mcpRegistry: null,
      refreshBus: {
        on: vi.fn(() => refreshSpy),
        emit: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        notice: vi.fn(),
      },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const spy = vi
      .spyOn(tab as unknown as { updateGraphRagStats: () => void }, 'updateGraphRagStats')
      .mockImplementation(() => {
        return;
      });
    const action = {
      id: 'resetGraphRag' as const,
      groupId: 'maintain',
      groupLabel: '그래프 정리',
      label: 'GraphRAG 데이터 초기화',
      description:
        '증거, 엔티티, 관계, 클레임, 커뮤니티, 캐시를 즉시 삭제하고 진행 상태를 초기화합니다.',
      iconName: 'trash-2',
      state: { disabled: false, reason: null },
      tone: 'danger' as const,
    };
    const globalWindow = globalThis as { confirm?: () => boolean };
    const originalConfirm = globalWindow.confirm;
    const confirmSpy = vi.fn(() => true);
    globalWindow.confirm = confirmSpy;

    try {
      await (
        tab as unknown as {
          handleGraphRagAction: (
            action: {
              id: 'resetGraphRag';
            },
            cost: { costLabel: string },
          ) => Promise<void>;
        }
      ).handleGraphRagAction(action, { costLabel: 'local' });

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(plugin.resetGraphRagData).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      if (originalConfirm === undefined) {
        delete globalWindow.confirm;
      } else {
        globalWindow.confirm = originalConfirm;
      }
      spy.mockRestore();
    }
  });

  it('GraphRAG 추출 모델이 없으면 provider 상태보다 모델 선택 안내를 먼저 표시한다', () => {
    const state = getGraphRagControlState({
      enabled: true,
      hasProvider: false,
      hasModel: false,
      isRunning: false,
      totalCandidateFiles: 1,
      failedFileCount: 0,
    });

    expect(state.start.reason).toBe('GraphRAG 추출 모델을 선택하세요.');
  });

  it('GraphRAG 모델은 있지만 runner가 없으면 provider와 모델 목록 설정을 안내한다', () => {
    const state = getGraphRagControlState({
      enabled: true,
      hasProvider: false,
      hasModel: true,
      isRunning: false,
      totalCandidateFiles: 1,
      failedFileCount: 0,
    });

    expect(state.start.reason).toBe(
      '선택한 GraphRAG 모델의 provider를 활성화하고 모델 목록에 추가하세요.',
    );
  });

  it('GraphRAG가 켜져 있고 대상 파일만 없으면 비활성 대신 대상 없음 사유를 표시한다', () => {
    const state = getGraphRagControlState({
      enabled: true,
      hasProvider: true,
      hasModel: true,
      isRunning: false,
      totalCandidateFiles: 0,
      failedFileCount: 0,
    });

    expect(state.start.reason).toBe('GraphRAG 인덱싱 대상 파일이 없습니다.');
  });

  it('일반 설정 자동 저장은 RAG 런타임을 재초기화하지 않는다', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const saveSettingsLight = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: false,
      },
      saveSettings,
      saveSettingsLight,
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: false, reinitMcp: false });
    expect(saveSettingsLight).not.toHaveBeenCalled();
  });

  it('RAG 설정 자동 저장은 명시된 경우에만 RAG 런타임을 재초기화한다', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: false,
      },
      saveSettings,
      saveSettingsLight: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave({ reinitRag: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: true, reinitMcp: false });
  });

  it('여러 자동 저장 요청은 RAG 재초기화 요구를 보존해 한 번으로 병합한다', async () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: true,
        autoSaveDebounceMs: 1000,
      },
      saveSettings,
      saveSettingsLight: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave();
    tab.debouncedSave({ reinitRag: true });
    await vi.runAllTimersAsync();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: true, reinitMcp: false });
  });

  it('설정 자동 저장 기본 debounce는 1초다', () => {
    expect(DEFAULT_SETTINGS.autoSaveDebounceMs).toBe(1000);
  });

  it('agent diagnostics settings default to disabled and normalize legacy data', () => {
    expect(DEFAULT_SETTINGS.agentDiagnostics.enabled).toBe(false);
    expect(normalizeAgentDiagnosticsSettings(undefined)).toEqual({ enabled: false });
    expect(normalizeAgentDiagnosticsSettings({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeAgentDiagnosticsSettings({ enabled: 'true' })).toEqual({ enabled: false });
  });

  it('기본 MCP 설정은 Context7 서버를 포함한다', () => {
    expect(DEFAULT_SETTINGS.mcpIncludeWslPath).toBe(false);
    expect(DEFAULT_SETTINGS.mcpServers).toContainEqual({
      name: CONTEXT7_MCP_SERVER_NAME,
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
  });

  it('MCP JSON 편집기 초기값은 Context7 기본 서버를 포함한다', () => {
    const parsed = JSON.parse(buildMcpJsonEditorValue(DEFAULT_SETTINGS.mcpServers)) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };

    expect(parsed.mcpServers.context7).toEqual({
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
  });

  it('사용자가 지정한 Context7 MCP 설정은 JSON 편집기 값에서 보존된다', () => {
    const parsed = JSON.parse(
      buildMcpJsonEditorValue([
        {
          name: 'context7',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7-key'],
          env: { CONTEXT7_API_KEY: 'ctx7-env-key' },
        },
      ]),
    ) as {
      mcpServers: Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      >;
    };

    expect(parsed.mcpServers.context7?.args).toEqual([
      '-y',
      '@upstash/context7-mcp',
      '--api-key',
      'ctx7-key',
    ]);
    expect(parsed.mcpServers.context7?.env).toEqual({ CONTEXT7_API_KEY: 'ctx7-env-key' });
  });

  it('명시적으로 빈 MCP 서버 목록을 저장한 경우 JSON 편집기 값도 빈 객체로 유지한다', () => {
    expect(buildMcpJsonEditorValue([])).toBe(JSON.stringify({ mcpServers: {} }, null, 2));
  });

  it('플러그인 인식 생성이 켜졌고 Context7가 없을 때만 경고한다', () => {
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: true,
        servers: [],
      }),
    ).toBe(true);
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: true,
        servers: DEFAULT_SETTINGS.mcpServers,
      }),
    ).toBe(false);
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: false,
        servers: [],
      }),
    ).toBe(false);
  });

  it('MCP 툴 실행 정책 설명은 멘션 서버 신뢰와 결과 전달 범위를 안내한다', () => {
    setLanguage('ko');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('멘션한 MCP 서버');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('사용 의사');
    expect(t('mcpToolExecutionPolicyDesc')).toContain(
      '최종 답변 생성을 위해 LLM provider로 다시 전달',
    );

    setLanguage('en');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('mentioned MCP server');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('intent to use');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('sent back to the LLM provider');

    setLanguage('ko');
  });
});

describe('RAG indexing ETA settings label', () => {
  it('formats running RAG indexing ETA in the settings status label', () => {
    setLanguage('en');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          queuedFiles: 0,
          lastResult: null,
          progress: {
            event: 'batch-complete',
            startedAtMs: 0,
            nowMs: 10000,
            totalFiles: 10,
            completedFiles: 3,
            currentFilePath: 'c.md',
            currentFileIndex: 2,
            currentFileTotalChunks: 1,
            currentFileEmbeddedChunks: 0,
            totalEstimatedChunks: 10,
            completedEstimatedChunks: 3,
            currentFileEstimatedChunks: 1,
            totalPlannedChunks: 0,
            completedPlannedChunks: 0,
            currentFilePlannedChunks: 0,
            planningComplete: false,
            indexed: 3,
            vectors: 20,
            skipped: 0,
            completedBatchDurationsMs: [500],
            completedBatchChunkCounts: [1],
            completedFileDurationsMs: [2000, 3000, 2500],
            completedFileChunkCounts: [1, 1, 1],
            completedFileEstimatedChunkCounts: [1, 1, 1],
            completedFileActualChunkCounts: [1, 1, 1],
            completedFileOverheadDurationsMs: [],
            historicalMsPerChunk: null,
            historicalChunkEstimateRatio: null,
            historicalVariance: null,
            eta: {
              totalFiles: 10,
              completedFiles: 3,
              currentFileProgress: 0,
              progressRatio: 0.3,
              elapsedMs: 10000,
              remainingMs: 17500,
              estimatedCompletionMs: 27500,
              confidence: 'medium',
              basis: 'calibrated-estimate',
              lowerRemainingMs: 14000,
              upperRemainingMs: 21000,
              confidenceReason: 'calibrated-estimate',
              etaConfidenceReason: 'calibrated-estimate',
            },
          },
        },
      })),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    expect((tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel()).toBe(
      'Indexing: Full reindex - 3/10 files, ETA about 18s (calibrated speed from completed files)',
    );
  });

  it('keeps low-confidence RAG indexing ETA in calculating state', () => {
    setLanguage('en');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          queuedFiles: 0,
          lastResult: null,
          progress: {
            event: 'batch-complete',
            startedAtMs: 0,
            nowMs: 5000,
            totalFiles: 4,
            completedFiles: 0,
            currentFileTotalChunks: 1,
            currentFileEmbeddedChunks: 1,
            totalEstimatedChunks: 100,
            completedEstimatedChunks: 0,
            currentFileEstimatedChunks: 1,
            totalPlannedChunks: 0,
            completedPlannedChunks: 0,
            currentFilePlannedChunks: 0,
            planningComplete: false,
            indexed: 0,
            vectors: 0,
            skipped: 0,
            completedBatchDurationsMs: [1000],
            completedBatchChunkCounts: [1],
            completedFileDurationsMs: [],
            completedFileChunkCounts: [],
            completedFileEstimatedChunkCounts: [],
            completedFileActualChunkCounts: [],
            completedFileOverheadDurationsMs: [],
            historicalMsPerChunk: null,
            historicalChunkEstimateRatio: null,
            historicalVariance: null,
            eta: {
              totalFiles: 4,
              completedFiles: 0,
              currentFileProgress: 1,
              progressRatio: 0.01,
              elapsedMs: 5000,
              remainingMs: 99000,
              estimatedCompletionMs: 104000,
              confidence: 'low',
              basis: 'batch-rate',
              lowerRemainingMs: 0,
              upperRemainingMs: 198000,
              confidenceReason: 'batch-rate-only',
              etaConfidenceReason: 'batch-rate-only',
            },
          },
        },
      })),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    expect((tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel()).toBe(
      'Indexing: Full reindex - 0/4 files, calculating ETA (recent batch speed only)',
    );
  });
});
