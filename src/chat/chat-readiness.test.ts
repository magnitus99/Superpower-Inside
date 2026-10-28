import { describe, expect, it } from 'vitest';
import {
  createChatReadinessSnapshot,
  resolveChatRetrievalReadiness,
  selectRagContextEngine,
} from './chat-readiness';

describe('질문을 보내기 위한 준비 조건', () => {
  it('연결이 없으면 질문을 보존한 채 연결 설정만 안내한다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 0,
      availableModelCount: 0,
      selectedModel: '',
      retrieval: 'ready',
    });
    expect(snapshot.blocksSend).toBe(true);
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        kind: 'provider',
        action: 'configure-provider',
        severity: 'blocking',
      }),
    ]);
  });
  it('모델이 등록되지 않았으면 연결 설정으로 안내한다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 0,
        selectedModel: '',
        retrieval: 'ready',
      }).items[0].action,
    ).toBe('configure-provider');
  });
  it('사용할 모델이 있지만 선택하지 않았을 때만 모델 선택을 요청한다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 2,
        selectedModel: '',
        retrieval: 'ready',
      }).items[0].action,
    ).toBe('select-model');
  });
  it('질문이 가능하고 검색이 준비됐으면 아무 관리도 요구하지 않는다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 1,
        selectedModel: 'example:model',
        retrieval: 'ready',
      }),
    ).toMatchObject({ status: 'ready', blocksSend: false, items: [] });
  });
  it('검색 인덱싱 중이면 전송을 막지 않고 누락 가능성만 알린다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'example:model',
      retrieval: 'preparing',
    });
    expect(snapshot).toMatchObject({ status: 'degraded', blocksSend: false });
    expect(snapshot.items).toEqual([
      expect.objectContaining({ kind: 'rag', severity: 'notice', tone: 'neutral', label: '검색 준비 중' }),
    ]);
  });
  it('검색이 준비되지 않았으면 준비되지 않았다고 알린다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'example:model',
      retrieval: 'degraded',
    });
    expect(snapshot).toMatchObject({ status: 'degraded', blocksSend: false });
    expect(snapshot.items).toEqual([
      expect.objectContaining({ kind: 'rag', severity: 'notice', tone: 'warning', label: '검색 준비 안 됨' }),
    ]);
  });
  it('연결이 막혀 있으면 검색 안내 대신 연결 문제만 보여 준다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 0,
      availableModelCount: 0,
      selectedModel: '',
      retrieval: 'degraded',
    });
    expect(snapshot.items.map((item) => item.kind)).toEqual(['provider']);
  });
});

describe('검색 준비 상태 요약', () => {
  it('넘어갈 준비가 모두 끝났으면 ready다', () => {
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: false,
        keywordIndex: 'ready',
        indexing: false,
      }),
    ).toBe('ready');
  });
  it('키워드 색인을 끈 구성은 준비 상태를 낮추지 않는다', () => {
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: false,
        keywordIndex: 'disabled',
        indexing: false,
      }),
    ).toBe('ready');
  });
  it('초기화·색인 로딩·문서 갱신은 모두 준비 중으로 묶는다', () => {
    expect(
      resolveChatRetrievalReadiness({
        initializing: true,
        failed: false,
        keywordIndex: 'ready',
        indexing: false,
      }),
    ).toBe('preparing');
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: false,
        keywordIndex: 'loading',
        indexing: false,
      }),
    ).toBe('preparing');
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: false,
        keywordIndex: 'ready',
        indexing: true,
      }),
    ).toBe('preparing');
  });
  it('색인이 진행 중이면 단계·문서 범위·남은 시간을 함께 보여 준다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'model-a',
      retrieval: 'preparing',
      indexing: {
        phase: 'file',
        completedFiles: 12,
        totalFiles: 40,
        currentFileEmbeddedChunks: 30,
        currentFileTotalChunks: 120,
        etaRemainingMs: 95_000,
      },
    });
    expect(snapshot.items[0]).toEqual(
      expect.objectContaining({
        kind: 'rag',
        detail: '파일 색인 · 문서 12/40개 · 현재 문서 30/120 청크 · 남은 시간 1m 35s',
      }),
    );
  });

  it('남은 시간을 아직 모르면 계산 중으로 표시하고 문서 범위는 유지한다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'model-a',
      retrieval: 'preparing',
      indexing: {
        phase: 'preparing',
        completedFiles: 0,
        totalFiles: 0,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
      },
    });
    expect(snapshot.items[0]?.detail).toBe('준비 · 남은 시간 계산 중');
  });

  it('키워드 색인 복원 중에는 읽은 문서 수를 보여 준다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 1,
      availableModelCount: 1,
      selectedModel: 'model-a',
      retrieval: 'preparing',
      indexing: {
        phase: 'preparing',
        completedFiles: 0,
        totalFiles: 0,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
        keywordRestore: { processedDocuments: 1_200, expectedDocuments: 5_400 },
      },
    });
    expect(snapshot.items[0]?.detail).toBe('키워드 색인을 다시 읽는 중 · 문서 1200/5400');
  });

  it('초기화 실패·건너뜀과 색인 사용 불가는 제한 상태로 남긴다', () => {
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: true,
        keywordIndex: 'ready',
        indexing: false,
      }),
    ).toBe('degraded');
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: false,
        keywordIndex: 'unavailable',
        indexing: true,
      }),
    ).toBe('degraded');
  });

  it('한 검색 백엔드가 살아 있으면 다른 백엔드의 제한을 검색 불가로 낮추지 않는다', () => {
    // 임베딩 초기화가 건너뛰어도 BM25 색인이 준비됐으면 lexical 검색은 가능합니다.
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: true,
        keywordIndex: 'ready',
        indexing: false,
        searchBackendReady: true,
      }),
    ).toBe('ready');
    // 키워드 작업자가 실패해도 벡터 색인이 준비됐으면 검색은 가능합니다.
    expect(
      resolveChatRetrievalReadiness({
        initializing: false,
        failed: true,
        keywordIndex: 'unavailable',
        indexing: false,
        searchBackendReady: true,
      }),
    ).toBe('ready');
  });
});

describe('검색 컨텍스트 엔진 경계', () => {
  it('ready일 때만 색인 엔진을 컨텍스트 구성에 전달한다', () => {
    const engine = { query: () => Promise.resolve([]) };
    expect(selectRagContextEngine(engine, 'ready')).toBe(engine);
    expect(selectRagContextEngine(engine, 'preparing')).toBeNull();
    expect(selectRagContextEngine(engine, 'degraded')).toBeNull();
    expect(selectRagContextEngine(null, 'ready')).toBeNull();
  });
});
