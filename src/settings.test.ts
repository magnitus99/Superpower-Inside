import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import {
  buildEmbeddingModelOptions,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  getVectorStoreTransferNotice,
  getVectorStoreDescription,
  getVectorStoreLabel,
  normalizeRagPerformanceTuningMode,
  resolveRagPerformanceSettings,
  shouldShowProviderApiKey,
} from './rag/settings-display';
import {
  buildEmbeddingProviderOptions,
  buildMcpJsonEditorValue,
  DEFAULT_SETTINGS,
  normalizeChatSaveFolder,
} from './settings';
import {
  CONTEXT7_MCP_SERVER_NAME,
  shouldShowPluginAwareContext7Warning,
} from './mcp/context7';
import { setLanguage, t } from './i18n';

describe('RAG 설정 표시 헬퍼', () => {
  it('선택된 벡터 저장소 라벨을 반환한다', () => {
    expect(getVectorStoreLabel('json')).toBe('JSON File');
    expect(getVectorStoreLabel('indexeddb')).toBe('IndexedDB');
  });

  it('JSON File과 IndexedDB의 장단점 설명을 포함한다', () => {
    const description = getVectorStoreDescription();

    expect(description).toContain('Obsidian Sync');
    expect(description).toContain('Git');
    expect(description).toContain('동기화 충돌');
    expect(description).toContain('로컬 브라우저 DB');
    expect(description).toContain('자동 포함되지 않습니다');
  });

  it('선택한 벡터 저장소가 비어 있고 반대 저장소에 벡터가 있을 때만 전환 안내를 반환한다', () => {
    expect(getVectorStoreTransferNotice('indexeddb', 10, 0)).toContain('전체 재인덱싱');
    expect(getVectorStoreTransferNotice('indexeddb', 10, 5)).toBeNull();
    expect(getVectorStoreTransferNotice('json', 0, 10)).toContain('전체 재인덱싱');
    expect(getVectorStoreTransferNotice('json', 0, 0)).toBeNull();
    expect(getVectorStoreTransferNotice('indexeddb', 10, 10)).toBeNull();
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
    expect(options.find((option) => option.id === 'text-embedding-3-small')?.source).toBe(
      'preset',
    );
    expect(options.find((option) => option.id === 'custom-embedding')?.source).toBe('provider');
    expect(options.find((option) => option.id === 'legacy-selected')?.label).toContain(
      '현재 선택됨',
    );
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

  it('신규 설치 기본 벡터 저장소는 IndexedDB이며 성능 보호를 켠다', () => {
    expect(DEFAULT_SETTINGS.rag.vectorStoreType).toBe('indexeddb');
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

  it('설정 자동 저장 기본 debounce는 1초다', () => {
    expect(DEFAULT_SETTINGS.autoSaveDebounceMs).toBe(1000);
  });

  it('기본 MCP 설정은 Context7 서버를 포함한다', () => {
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
      mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
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
    expect(t('mcpToolExecutionPolicyDesc')).toContain('최종 답변 생성을 위해 LLM provider로 다시 전달');

    setLanguage('en');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('mentioned MCP server');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('intent to use');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('sent back to the LLM provider');

    setLanguage('ko');
  });
});
