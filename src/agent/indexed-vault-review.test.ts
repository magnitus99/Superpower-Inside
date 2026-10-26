import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { LLMProviderHttpError, type ChatMessage, type LLMProvider } from '../llm/providers';
import {
  planIndexedEvidenceRust,
  planIndexedReviewAnswerPlanRust,
  planModelContextRust,
  validateIndexedReviewAnswerRust,
  verifyIndexedEvidenceRust,
  type IndexedSearchPlan,
  type RustIndexedEvidencePlan,
  type RustIndexedEvidenceVerification,
  type RustIndexedReviewAnswerPlan,
} from '../rag/rust-core';
import {
  reviewIndexedVault,
  searchIndexedVault,
  type IndexedVaultCorpus,
  type IndexedVaultReviewOptions,
} from './indexed-vault-review';

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    planIndexedEvidenceRust: vi.fn(actual.planIndexedEvidenceRust),
    planIndexedReviewAnswerPlanRust: vi.fn(actual.planIndexedReviewAnswerPlanRust),
    validateIndexedReviewAnswerRust: vi.fn(actual.validateIndexedReviewAnswerRust),
    verifyIndexedEvidenceRust: vi.fn(actual.verifyIndexedEvidenceRust),
  };
});

const RELEVANT = 'Synthetic/Relevant.md';
const OTHER = 'Synthetic/Other.md';
const SOURCE_ID = RELEVANT + '#L3-L4';
const OTHER_SOURCE_ID = OTHER + '#L1-L1';

function corpusFixture(): IndexedVaultCorpus {
  const records = [
    {
      filePath: RELEVANT,
      contentHash: 'hash-relevant',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
    {
      filePath: OTHER,
      contentHash: 'hash-other',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
  ];
  const entries = [
    {
      id: 'chunk-relevant',
      vector: [],
      metadata: {
        filePath: RELEVANT,
        startLine: 3,
        endLine: 4,
        text: 'Quartz restarts only after two cooling cycles.',
        contentHash: 'hash-relevant',
      },
    },
    {
      id: 'chunk-other',
      vector: [],
      metadata: {
        filePath: OTHER,
        startLine: 1,
        endLine: 1,
        text: 'Delivery schedule for the northern region.',
        contentHash: 'hash-other',
      },
    },
  ];
  return {
    getEntriesByFilePaths: (paths) =>
      Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
    getFileIndexRecords: () => Promise.resolve(records),
  };
}

function planFixture(): RustIndexedEvidencePlan {
  return {
    queryTokens: [],
    phrases: [],
    order: [SOURCE_ID],
    evidence: [
      {
        sourceId: SOURCE_ID,
        path: RELEVANT,
        revision: '1:10',
        startLine: 3,
        endLine: 4,
        quote: 'Quartz restarts only after two cooling cycles.',
        contextBefore: '',
        contextAfter: '',
        score: 1,
        rank: 1,
        signal: 'lexical',
        phraseMatches: 1,
        proximityScore: 1,
        fieldScore: 1,
        exactSignals: [],
        fieldMatches: [],
        negatedNearby: false,
        highlights: [],
        duplicateOf: null,
      },
    ],
    diagnostics: {
      candidateDepth: 2,
      candidateDocuments: 2,
      selectedDocuments: 1,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 1, filtered: 0 },
      zeroHitReason: null,
      unmatchedTerms: [],
      candidateChunks: 2,
      selectedChunks: 1,
      missingCandidatePaths: 0,
    },
    coverage: {
      status: 'supported',
      reviewedDocuments: 2,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262_144, usedChars: 120 },
  };
}

function verificationFixture(): RustIndexedEvidenceVerification {
  return {
    statuses: [
      {
        sourceId: SOURCE_ID,
        path: RELEVANT,
        status: 'verified',
        exists: true,
        lineMatches: true,
        offsetMatches: null,
        revisionState: 'match',
        scopeState: 'in-scope',
        reviewState: 'reviewed',
        duplicateOf: null,
      },
    ],
  };
}

function twoDocumentPlan(): RustIndexedEvidencePlan {
  const fixture = planFixture();
  const first = fixture.evidence[0];
  if (!first) throw new Error('plan fixture without evidence');
  return {
    ...fixture,
    order: [SOURCE_ID, OTHER + '#L1-L1'],
    evidence: [
      first,
      {
        ...first,
        sourceId: OTHER + '#L1-L1',
        path: OTHER,
        revision: '1:10',
        startLine: 1,
        endLine: 1,
        quote: 'Delivery schedule for the northern region.',
        rank: 2,
      },
    ],
    diagnostics: {
      ...fixture.diagnostics,
      candidateDocuments: 2,
      candidateChunks: 2,
      selectedDocuments: 2,
      selectedChunks: 2,
      droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
    },
    coverage: { ...fixture.coverage, reviewedDocuments: 2 },
  };
}

function comparisonEvidencePlan(): RustIndexedEvidencePlan {
  const plan = twoDocumentPlan();
  const first = plan.evidence[0];
  const second = plan.evidence[1];
  if (!first || !second) throw new Error('comparison fixture without two passages');
  return {
    ...plan,
    evidence: [
      { ...first, queryIndexes: [1] },
      { ...second, queryIndexes: [2] },
    ],
  };
}

const COMPARISON_SEARCH_PLAN: IndexedSearchPlan = {
  mode: 'comparison',
  facets: [
    {
      id: 'question',
      kind: 'question',
      query: 'Compare Synthetic Alpha and Synthetic Beta',
      queryIndex: 0,
      terms: ['compare'],
    },
    {
      id: 'subject-0',
      kind: 'subject',
      query: 'Synthetic Alpha',
      queryIndex: 1,
      terms: ['alpha'],
    },
    {
      id: 'subject-1',
      kind: 'subject',
      query: 'Synthetic Beta',
      queryIndex: 2,
      terms: ['beta'],
    },
  ],
};

function comparisonAnswerPlan(
  overrides: Partial<RustIndexedReviewAnswerPlan> = {},
): RustIndexedReviewAnswerPlan {
  return {
    mode: 'comparison',
    facets: [
      {
        id: 'subject-0',
        kind: 'subject',
        label: 'Synthetic Alpha',
        status: 'supported',
        sourceIds: [SOURCE_ID],
      },
      {
        id: 'subject-1',
        kind: 'subject',
        label: 'Synthetic Beta',
        status: 'supported',
        sourceIds: [OTHER_SOURCE_ID],
      },
    ],
    requiredFacetIds: ['subject-0', 'subject-1'],
    missingFacetIds: [],
    synthesisRequired: true,
    ...overrides,
  };
}

function verifiedStatuses(input: Parameters<typeof verifyIndexedEvidenceRust>[0]) {
  return {
    statuses: input.evidence.map((item) => ({
      sourceId: item.sourceId,
      path: item.path,
      status: 'verified' as const,
      exists: true,
      lineMatches: true,
      offsetMatches: null,
      revisionState: 'match' as const,
      scopeState: 'in-scope' as const,
      reviewState: 'reviewed' as const,
      duplicateOf: null,
    })),
  };
}

function answerProvider(): { provider: LLMProvider; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const provider = {
    streamChat: async (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      calls.push(messages);
      consume({
        content: JSON.stringify({
          paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
        }),
      });
      return Promise.resolve();
    },
  } as unknown as LLMProvider;
  calls.length = 0;
  return { provider, calls };
}

function scriptedAnswerProvider(responses: readonly string[]): {
  provider: LLMProvider;
  calls: ChatMessage[][];
} {
  const calls: ChatMessage[][] = [];
  let attempt = 0;
  const provider = {
    streamChat: async (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      calls.push(messages);
      consume({ content: responses[Math.min(attempt, responses.length - 1)] ?? '' });
      attempt += 1;
      return Promise.resolve();
    },
  } as unknown as LLMProvider;
  return { provider, calls };
}

function reviewOptions(
  overrides: Partial<IndexedVaultReviewOptions> = {},
): IndexedVaultReviewOptions {
  return {
    question: 'Quartz cooling cycles',
    indexedPaths: [RELEVANT, OTHER],
    scopes: [],
    corpus: corpusFixture(),
    candidates: [
      { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
      { path: OTHER, score: 1, source: 'bm25', rank: 2 },
    ],
    revisionReader: () => Promise.resolve('1:10'),
    provider: answerProvider().provider,
    ...overrides,
  };
}

describe('엔진 근거 기반 색인 검토', () => {
  it.each([false, true])('최초 후보 밖 후속 근거를 원문 검증 뒤 결합하고 실패한 문서는 제외한다: %s', async (sourceMissing) => {
    const extra = twoDocumentPlan();
    extra.evidence = extra.evidence.map((item) => ({ ...item, queryIndexes: [2] }));
    vi.mocked(planIndexedEvidenceRust).mockReturnValueOnce(planFixture()).mockReturnValueOnce(extra);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const calls: ChatMessage[][] = [];
    const streamChat = vi.fn((messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      calls.push(messages);
      consume({ content: calls.length === 1 ? '["delivery schedule", "cooling protocol"]' : JSON.stringify({
        paragraphs: [{ text: '근거의 조건을 함께 설명합니다.', sources: sourceMissing ? [SOURCE_ID] : [SOURCE_ID, OTHER_SOURCE_ID] }],
      }) });
      return Promise.resolve();
    });
    const sourceReader = vi.fn((path: string) => Promise.resolve({
      revision: path === OTHER && sourceMissing ? null : '1:10',
      text: path === RELEVANT ? '\n\nQuartz restarts only after two cooling cycles.\n' : 'Delivery schedule for the northern region.',
    }));
    const result = await reviewIndexedVault(reviewOptions({
      indexedPaths: [RELEVANT], provider: { streamChat }, sourceReader,
      discoveryPaths: [RELEVANT, OTHER],
      discoveryCandidates: [
        { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
      ],
      getFollowupPaths: () => Promise.resolve([RELEVANT, OTHER]),
    }));
    expect(result.dossier.followup?.status).toBe('searched');
    expect(result.diagnostics.counts.followupRequests).toBe(1);
    expect(vi.mocked(planIndexedEvidenceRust).mock.calls[1]?.[0]).toMatchObject({
      question: 'delivery schedule',
      queryVariants: ['cooling protocol'],
      queryFacets: ['delivery schedule', 'cooling protocol'],
    });
    expect(vi.mocked(planIndexedEvidenceRust).mock.calls[1]?.[0].candidates).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(sourceReader).toHaveBeenCalledWith(OTHER, expect.any(AbortSignal));
    expect(result.evidence.some((item) => item.path === OTHER)).toBe(!sourceMissing);
    expect(result.evidence.some((item) => item.path === RELEVANT)).toBe(true);
    if (!sourceMissing) expect(result.evidence.find((item) => item.path === OTHER)?.queryIndexes ?? []).toEqual([]);
    const request = calls[1]?.[1]?.content ?? '{}';
    expect(JSON.parse(request)).toMatchObject({
      evidence: result.dossier.evidence,
      coverage: { reviewedDocuments: result.coverage.reviewedDocuments },
    });
    expect(JSON.parse(request)).not.toHaveProperty('coverage.requestedPaths');
    expect(JSON.parse(request)).not.toHaveProperty('coverage.plannedPaths');
    expect(JSON.parse(request)).not.toHaveProperty('coverage.unreviewedPaths');
    expect(result.coverage.requestedPaths).toContain(OTHER);
    expect(result.providerTransfer.sentPaths?.includes(OTHER)).toBe(!sourceMissing);
    expect(result.dossier.discoverySummary?.discoveredDocuments).toBe(1);
    expect(result.dossier.discoverySummary?.selectedSourceDocuments).toBe(1);
  });

  it('검토 밖 단서를 보존하되 원문이나 인용으로 승격하지 않는다', async () => {
    const hidden = 'Synthetic/Unreviewed.md';
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({
      provider,
      discoveryCandidates: [
        { path: RELEVANT, score: 2, source: 'bm25', rank: 1, startLine: 1, endLine: 3 },
        { path: hidden, score: 1, source: 'bm25', rank: 97, startLine: 8, endLine: 12 },
      ],
      discoveryPaths: [RELEVANT, OTHER, hidden],
    }));
    expect(result.dossier.discoverySummary).toMatchObject({
      discoveredDocuments: 2, selectedSourceDocuments: 1, unreviewedDocuments: 1,
    });
    const page = result.readDiscoveryPage?.({
      allowedPaths: [RELEVANT, hidden], scopes: [], offset: 0, limit: 32,
    });
    expect(page?.items.find((item) => item.path === hidden)).toMatchObject({
      startLine: 8, endLine: 12, state: 'unreviewed', verification: 'unverified',
    });
    expect(result.citations.some((citation) => citation.filePath === hidden)).toBe(false);
    expect(JSON.stringify(calls)).not.toContain(hidden);
    expect(result.readDiscoveryPage?.({
      allowedPaths: [RELEVANT], scopes: [], offset: 0, limit: 32,
    })?.summary.discoveredDocuments).toBe(1);
  });

  it('현재 실행이 끝났거나 취소된 단서 조회는 중단하고 필터 경계를 우회하지 않는다', async () => {
    let current = true;
    const originalController = new AbortController();
    const options = reviewOptions({
      deferAnswer: true,
      signal: originalController.signal,
      isCurrent: () => current,
      discoveryCandidates: [{ path: RELEVANT, score: 2, source: 'bm25', rank: 1 }],
      discoveryPaths: [RELEVANT],
    });
    const result = await reviewIndexedVault(options);
    const request = { allowedPaths: [RELEVANT], scopes: [], offset: 0, limit: 32 };
    expect(result.readDiscoveryPage?.(request)?.summary.discoveredDocuments).toBe(1);
    const controller = new AbortController();
    controller.abort();
    expect(() => result.readDiscoveryPage?.({ ...request, signal: controller.signal })).toThrow();
    current = false;
    expect(result.readDiscoveryPage?.(request)).toBeNull();
    current = true;
    originalController.abort();
    expect(() => result.readDiscoveryPage?.(request)).toThrow();
    const filtered = await reviewIndexedVault({
      ...options, signal: undefined, filters: { tags: ['restricted'] },
    });
    expect(filtered.readDiscoveryPage).toBeUndefined();
    expect(filtered.dossier.discoverySummary).toBeUndefined();
  });

  it('독립 후속 질의의 대표 근거와 귀속을 WASM 계획·병합까지 보존한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const result = await searchIndexedVault({
      question: 'cooling cycles', queryVariants: ['delivery schedule'],
      queryFacets: ['cooling cycles', 'delivery schedule'],
      indexedPaths: [RELEVANT, OTHER], scopes: [], corpus: corpusFixture(),
      budget: { maxPassages: 2, maxChars: 8192 },
    });
    expect(result?.evidence).toHaveLength(2);
    expect(result?.evidence.find((item) => item.path === RELEVANT)?.queryIndexes).toEqual([1]);
    expect(result?.evidence.find((item) => item.path === OTHER)?.queryIndexes).toEqual([2]);
  });

  it('후보 수집의 번역 구문을 원문 구절 평가에도 전달한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const result = await reviewIndexedVault(reviewOptions({
      question: '냉각 주기',
      queryVariants: ['Quartz cooling cycles'],
      candidates: undefined,
      deferAnswer: true,
    }));
    expect(result.evidence.map((item) => item.path)).toContain(RELEVANT);
    expect(result.evidence.map((item) => item.path)).not.toContain(OTHER);
    expect(result.dossier.queryPlan.queryTokens.map((token) => token.text)).toContain('cooling');
    expect(result.dossier.queryPlan.phrases).toEqual([]);
    expect(planIndexedEvidenceRust).toHaveBeenCalledWith(expect.objectContaining({
      question: '냉각 주기', queryVariants: ['Quartz cooling cycles'],
    }));
  });

  it('기본 review와 명시적 all은 전체를 조회하고 candidates는 호환 목적으로만 후보를 조회한다', async () => {
    const corpus = corpusFixture();
    const read = vi.spyOn(corpus, 'getEntriesByFilePaths');
    const options = reviewOptions({
      corpus,
      candidates: [{ path: RELEVANT, score: 1, source: 'bm25', rank: 1 }],
      deferAnswer: true,
    });
    const all = await reviewIndexedVault(options);
    expect(read.mock.calls).toEqual([[[RELEVANT, OTHER]]]);
    expect(all.dossier.documentScope).toBe('all');
    expect(all.totalFiles).toBe(2);
    read.mockClear();
    const candidate = await reviewIndexedVault({ ...options, documentScope: 'candidates' });
    expect(read.mock.calls).toEqual([[[RELEVANT]]]);
    expect(candidate.dossier.documentScope).toBe('candidates');
    expect(candidate.totalFiles).toBe(1);
  });

  it('indexing 상태만 LLM과 도구 없이 현재 엔진 상태를 반환한다', async () => {
    const streamChat = vi.fn<LLMProvider['streamChat']>();
    const result = await reviewIndexedVault(
      reviewOptions({ candidatesState: 'indexing', provider: { streamChat } }),
    );
    expect(result.outcome).toBe('indexing');
    expect(result.evidence).toEqual([]);
    expect(result.content).toBe(t('indexedReviewIndexing'));
    expect(result.coverage.status).toBe('incomplete');
    expect(streamChat).not.toHaveBeenCalled();
  });

  it.each(['initializing', 'unavailable'] as const)(
    '%s 후보 상태에서도 all 색인 lexical 검토를 계속한다',
    async (candidatesState) => {
      const corpus = corpusFixture();
      const read = vi.spyOn(corpus, 'getEntriesByFilePaths');
      const { provider, calls } = answerProvider();
      const result = await reviewIndexedVault(
        reviewOptions({ candidates: [], candidatesState, corpus, provider }),
      );
      expect(read.mock.calls).toEqual([[[RELEVANT, OTHER]]]);
      expect(calls).toHaveLength(1);
      expect(result.outcome).toBe('answered');
      expect(result.dossier.documentScope).toBe('all');
    },
  );

  it('검색 중 색인 세대가 바뀌면 provider 답변을 게시하지 않고 indexing으로 되돌린다', async () => {
    const streamChat = vi.fn<LLMProvider['streamChat']>();
    const result = await reviewIndexedVault(
      reviewOptions({ isCurrent: () => false, provider: { streamChat } }),
    );
    expect(result.outcome).toBe('indexing');
    expect(result.citations).toEqual([]);
    expect(result.content).toBe(t('indexedReviewIndexing'));
    expect(streamChat).not.toHaveBeenCalled();
  });

  it.each(['format', 'http'] as const)(
    '%s 오류 후에도 verified 근거와 인용을 evidence-only로 반환한다',
    async (failure) => {
      const streamChat = vi.fn((...args: Parameters<LLMProvider['streamChat']>) => {
        if (failure === 'http')
          return Promise.reject(new LLMProviderHttpError('synthetic failure', 503));
        args[1]({ content: '{"invalid":true}', done: false });
        return Promise.resolve();
      });
      const result = await reviewIndexedVault(reviewOptions({ provider: { streamChat } }));
      expect(streamChat).toHaveBeenCalledTimes(failure === 'format' ? 2 : 1);
      expect(result.outcome).toBe('evidence-only');
      expect(result.evidence).toHaveLength(1);
      expect(result.dossier.evidence).toEqual(result.evidence);
      expect(result.citations[0]).toMatchObject({ id: SOURCE_ID, status: 'verified' });
      expect(result.content).toContain('> Quartz restarts');
      expect(result.content).not.toContain('{"invalid"');
      expect(result).not.toHaveProperty('toolFallback');
      const payload: unknown = JSON.parse(String(streamChat.mock.calls[0]?.[0]?.[1]?.content));
      expect(payload).toEqual({
        ...result.dossier,
        coverage: {
          documentScope: result.coverage.documentScope,
          status: result.coverage.status,
          reviewedDocuments: result.coverage.reviewedDocuments,
          unreviewedDocuments: result.coverage.unreviewedDocuments,
          notIndexedDocuments: result.coverage.notIndexedDocuments,
        },
      });
      expect(streamChat.mock.calls[0]?.[4]?.toolChoice).toBe('none');
    },
  );

  it('provider의 AbortError는 evidence-only로 삼키지 않는다', async () => {
    const streamChat = vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    await expect(
      reviewIndexedVault(reviewOptions({ provider: { streamChat } })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('검증 근거가 0개면 dossier와 no-evidence만 반환하고 모델을 호출하지 않는다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({ ...plan, evidence: [], order: [] });
    vi.mocked(verifyIndexedEvidenceRust).mockReturnValue({ statuses: [] });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.dossier.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it('후보 호환 모드에서 후보가 없으면 저장소와 모델을 읽지 않고 빈 dossier를 반환한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const corpus = corpusFixture();
    const read = vi.spyOn(corpus, 'getEntriesByFilePaths');
    const records = vi.spyOn(corpus, 'getFileIndexRecords');
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({
        corpus,
        provider,
        candidates: undefined,
        documentScope: 'candidates',
      }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(records).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.coverage.requestedPaths).toEqual([]);
  });

  it('질문·검색 질문·이전 사용자 질문·집계 인벤토리를 dossier에 보존한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        question: 'Follow-up?',
        scoringQuestion: 'Quartz cooling cycles',
        previousUserQuestions: ['Original question?'],
        matchInventory: [
          {
            query: 'quartz',
            totalDocuments: 12,
            totalChunks: 20,
            totalOccurrences: 34,
            documents: [{ sourcePath: RELEVANT, occurrences: 5 }],
          },
        ],
      }),
    );
    expect(result.dossier).toMatchObject({
      question: 'Follow-up?',
      scoringQuestion: 'Quartz cooling cycles',
      previousUserQuestions: ['Original question?'],
      matchInventory: [
        {
          query: 'quartz',
          totalDocuments: 12,
          totalOccurrences: 34,
          documents: [{ sourcePath: RELEVANT, occurrences: 5 }],
        },
      ],
    });
    const payload: unknown = JSON.parse(String(calls[0]?.[1]?.content));
    expect(payload).toEqual({
      ...result.dossier,
      coverage: {
        documentScope: result.coverage.documentScope,
        status: result.coverage.status,
        reviewedDocuments: result.coverage.reviewedDocuments,
        unreviewedDocuments: result.coverage.unreviewedDocuments,
        notIndexedDocuments: result.coverage.notIndexedDocuments,
      },
    });
  });

  it('입력 예산을 넘으면 모델을 호출하지 않고 evidence-only를 반환한다', async () => {
    const { provider, calls } = answerProvider();
    const budget = planModelContextRust({});
    if (!budget) throw new Error('모델 예산 계약을 초기화하지 못했습니다.');
    const contextBudget = { ...budget, inputBytes: 1 };
    const result = await reviewIndexedVault(
      reviewOptions({ provider: { ...provider, contextBudget } }),
    );
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('evidence-only');
    expect(result.citations[0]?.status).toBe('verified');
    expect(result.providerTransfer.sentFiles).toBe(0);
  });

  it('진행 중 취소와 늦은 provider 응답은 결과·콜백을 만들지 않는다', async () => {
    const controller = new AbortController();
    const onAnswer = vi.fn();
    let finish: (() => void) | undefined;
    let consume: Parameters<LLMProvider['streamChat']>[1] | undefined;
    const streamChat = vi.fn((...args: Parameters<LLMProvider['streamChat']>) => {
      consume = args[1];
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const pending = reviewIndexedVault(
      reviewOptions({ provider: { streamChat }, signal: controller.signal, onAnswer }),
    );
    const observed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    controller.abort();
    await observed;
    consume?.({ content: '{"late":true}', done: false });
    finish?.();
    await Promise.resolve();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('현재 원문 revision 조회가 멈춰도 취소는 즉시 완료된다', async () => {
    const controller = new AbortController();
    const revisionReader = vi.fn(() => new Promise<string | null>(() => undefined));
    const pending = reviewIndexedVault(
      reviewOptions({ revisionReader, signal: controller.signal }),
    );
    const outcome = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(revisionReader).toHaveBeenCalledTimes(1));
    controller.abort();
    const result: unknown = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve({ name: 'timeout' }), 100)),
    ]);
    expect(result).toMatchObject({ name: 'AbortError' });
  });

  it('evidence-only의 Markdown은 원문 이미지·링크·HTML을 실행하지 않는다', async () => {
    const plan = planFixture();
    const quote = '![tracking](https://example.com/image)\n<script>bad()</script>\n[[Private]]';
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      evidence: plan.evidence.map((item) => ({ ...item, quote })),
    });
    const result = await reviewIndexedVault(reviewOptions({ deferAnswer: true }));
    expect(result.evidence[0]?.quote).toBe(quote);
    expect(result.content).not.toContain('![');
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('[[Private]]');
    expect(result.content).toContain('&#60;script&#62;');
    expect(result.content).toContain('\n> ');
    expect(result.citations[0]?.preview).toBe(quote);
  });
  beforeEach(() => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(planFixture());
    vi.mocked(verifyIndexedEvidenceRust).mockReturnValue(verificationFixture());
  });

  it('비교 답변의 missing facet은 같은 모델로 정확히 한 번 교정한 뒤 채택한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const answerPlan = comparisonAnswerPlan();
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReset();
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(answerPlan);
    const validate = vi.mocked(validateIndexedReviewAnswerRust);
    validate.mockReset();
    validate
      .mockReturnValueOnce({
        valid: false,
        reason: 'missing-facet',
        missingFacetIds: ['subject-1'],
      })
      .mockReturnValueOnce({
        valid: true,
        content: `종합한 비교 답변 [${SOURCE_ID}] [${OTHER_SOURCE_ID}]`,
      });
    const { provider, calls } = scriptedAnswerProvider([
      JSON.stringify({ paragraphs: [] }),
      JSON.stringify({ paragraphs: [] }),
    ]);
    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        searchPlan: COMPARISON_SEARCH_PLAN,
        candidates: [
          { path: RELEVANT, score: 2, source: 'bm25', rank: 1, queryIndex: 1 },
          { path: OTHER, score: 1, source: 'bm25', rank: 2, queryIndex: 2 },
        ],
      }),
    );

    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(calls[1]?.at(-1)?.content).toContain('missing-facet');
    expect(calls[1]?.at(-1)?.content).toContain('subject-1');
    expect(planIndexedReviewAnswerPlanRust).toHaveBeenCalledWith({
      searchPlan: COMPARISON_SEARCH_PLAN,
      evidence: [
        {
          sourceId: SOURCE_ID,
          path: RELEVANT,
          quote: planFixture().evidence[0]?.quote,
          queryIndexes: [1],
        },
        {
          sourceId: OTHER_SOURCE_ID,
          path: OTHER,
          quote: 'Delivery schedule for the northern region.',
          queryIndexes: [2],
        },
      ],
    });
    expect(result.outcome).toBe('answered');
    expect(result.content).toContain('종합한 비교 답변');
    expect(result.citations.map((citation) => citation.id)).toEqual([SOURCE_ID, OTHER_SOURCE_ID]);
  });

  it('형식 실패의 고정 코드를 원문 없이 교정 요청에 전달하고 한 번만 재시도한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(comparisonAnswerPlan());
    vi.mocked(validateIndexedReviewAnswerRust).mockReturnValue({
      valid: false,
      reason: 'invalid-format',
      missingFacetIds: [],
      formatIssue: 'unknown-source',
    });
    const { provider, calls } = scriptedAnswerProvider(['{"paragraphs":[]}']);
    const result = await reviewIndexedVault(
      reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedReviewAnswerCorrection', {
        reason: 'invalid-format:unknown-source',
        facets: '-',
      }),
    });
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(result.outcome).toBe('evidence-only');
    expect(result.citations.every((citation) => citation.status === 'verified')).toBe(true);
  });

  it('두 번 모두 missing facet이면 불완전한 답변을 게시하지 않고 검증 근거로 폴백한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const answerPlan = comparisonAnswerPlan({
      facets: [
        {
          id: 'subject-0',
          kind: 'subject',
          label: 'Synthetic Alpha',
          status: 'supported',
          sourceIds: [SOURCE_ID],
        },
        {
          id: 'subject-1',
          kind: 'subject',
          label: 'Synthetic Beta',
          status: 'missing',
          sourceIds: [],
        },
      ],
      requiredFacetIds: ['subject-0'],
      missingFacetIds: ['subject-1'],
      synthesisRequired: false,
    });
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(answerPlan);
    vi.mocked(validateIndexedReviewAnswerRust).mockReturnValue({
      valid: false,
      reason: 'missing-facet',
      missingFacetIds: ['subject-0'],
    });
    const incompleteAnswer = '불완전한 비교 본문';
    const { provider, calls } = scriptedAnswerProvider([incompleteAnswer, incompleteAnswer]);
    const failedPlan: IndexedSearchPlan = {
      ...COMPARISON_SEARCH_PLAN,
      failedFacetIds: ['subject-1'],
    };
    const result = await reviewIndexedVault(reviewOptions({ provider, searchPlan: failedPlan }));
    const missingNotice = t('indexedReviewComparisonMissing', { facets: 'Synthetic Beta' });
    const failedNotice = t('indexedReviewComparisonSearchFailed', {
      facets: 'Synthetic Beta',
    });

    expect(calls).toHaveLength(2);
    expect(result.outcome).toBe('evidence-only');
    expect(result.content).not.toContain(incompleteAnswer);
    expect(result.content).toContain('> Quartz restarts');
    expect(result.content).toContain('> Delivery schedule');
    expect(result.content).toContain(missingNotice);
    expect(result.content).toContain(failedNotice);
    expect(result.coverageNotice).not.toContain(missingNotice);
    expect(result.content.indexOf('> Quartz restarts')).toBeLessThan(
      result.content.indexOf(missingNotice),
    );
    expect(result.content.indexOf(missingNotice)).toBeLessThan(
      result.content.indexOf(failedNotice),
    );
    expect(result.content.indexOf(failedNotice)).toBeLessThan(
      result.content.indexOf(result.coverageNotice),
    );
    expect(result.content.endsWith(result.coverageNotice)).toBe(true);
    expect(result.citations.map((citation) => citation.id)).toEqual([SOURCE_ID, OTHER_SOURCE_ID]);
  });

  it('한쪽 facet만 지원되면 그 facet만 답하고 missing label을 안전한 한계 고지로 덧붙인다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const unsafeLabel = 'Synthetic **Beta** <tag>';
    const answerPlan = comparisonAnswerPlan({
      facets: [
        {
          id: 'subject-0',
          kind: 'subject',
          label: 'Synthetic Alpha',
          status: 'supported',
          sourceIds: [SOURCE_ID],
        },
        {
          id: 'subject-1',
          kind: 'subject',
          label: unsafeLabel,
          status: 'missing',
          sourceIds: [],
        },
      ],
      requiredFacetIds: ['subject-0'],
      missingFacetIds: ['subject-1'],
      synthesisRequired: false,
    });
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(answerPlan);
    vi.mocked(validateIndexedReviewAnswerRust).mockReturnValue({
      valid: true,
      content: `Synthetic Alpha만 확인했습니다. [${SOURCE_ID}]`,
    });
    const { provider, calls } = scriptedAnswerProvider(['valid response']);
    const result = await reviewIndexedVault(
      reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }),
    );
    const payload: unknown = JSON.parse(String(calls[0]?.[1]?.content));

    expect(calls).toHaveLength(1);
    expect(payload).toMatchObject({
      answerPlan: {
        requiredFacetIds: ['subject-0'],
        missingFacetIds: ['subject-1'],
      },
    });
    expect(result.outcome).toBe('answered');
    expect(result.content).toContain('Synthetic Alpha만 확인했습니다.');
    expect(result.content).not.toContain('Synthetic Beta answer claim');
    expect(result.content).not.toContain('**Beta**');
    expect(result.content).not.toContain('<tag>');
    expect(result.content).toContain('&#42;&#42;Beta&#42;&#42; &#60;tag&#62;');
    expect(result.content.indexOf('Synthetic Alpha만 확인했습니다.')).toBeLessThan(
      result.content.indexOf('&#42;&#42;Beta&#42;&#42; &#60;tag&#62;'),
    );
    expect(result.content.indexOf('&#42;&#42;Beta&#42;&#42; &#60;tag&#62;')).toBeLessThan(
      result.content.indexOf(result.coverageNotice),
    );
    expect(result.content.endsWith(result.coverageNotice)).toBe(true);
    expect(result.citations.map((citation) => citation.id)).toEqual([SOURCE_ID]);
  });

  it('answer plan을 계산할 수 없으면 provider를 호출하지 않고 검증 근거만 반환한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(null);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }),
    );

    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('evidence-only');
    expect(result.content).toContain('> Quartz restarts');
    expect(result.content).toContain('> Delivery schedule');
    expect(result.citations).toHaveLength(2);
  });

  it('비교 가능한 supported subject가 없으면 provider를 호출하지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue({
      mode: 'comparison',
      facets: [
        {
          id: 'subject-0',
          kind: 'subject',
          label: 'Synthetic Alpha',
          status: 'missing',
          sourceIds: [],
        },
        {
          id: 'subject-1',
          kind: 'subject',
          label: 'Synthetic Beta',
          status: 'missing',
          sourceIds: [],
        },
      ],
      requiredFacetIds: [],
      missingFacetIds: ['subject-0', 'subject-1'],
      synthesisRequired: false,
    });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }),
    );

    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('evidence-only');
    expect(result.content).toContain(
      t('indexedReviewComparisonMissing', { facets: 'Synthetic Alpha, Synthetic Beta' }),
    );
    expect(result.citations).toHaveLength(2);
  });

  it('엔진이 채택·검증한 근거만 인용하고 최종 해석 한 번만 호출한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(1);
    const instruction = calls[0]?.[0]?.content ?? '';
    expect(instruction).toContain(t('llmIndexedReviewAnswer'));
    expect(result.outcome).toBe('answered');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.filePath).toBe(RELEVANT);
    expect(result.citations[0]?.line).toBe(3);
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('현재 원문 재검증에서 quote-missing이면 provider 없이 근거와 인용을 비운다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    const rejected: RustIndexedEvidenceVerification = {
      statuses: verificationFixture().statuses.map((status) => ({
        ...status,
        status: 'quote-missing',
        exists: false,
        lineMatches: null,
      })),
    };
    verify.mockReturnValueOnce(verificationFixture()).mockReturnValueOnce(rejected);
    const { provider, calls } = answerProvider();
    const currentText = '민감한 현재 원문 표식';
    const indexedQuote = planFixture().evidence[0]?.quote;
    if (!indexedQuote) throw new Error('indexed quote missing');

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () => Promise.resolve({ revision: '1:10', text: currentText }),
      }),
    );

    // 검색·현재 원문 검증 뒤에 주소 제안과 복구 계획 검증이 이어집니다.
    expect(verify).toHaveBeenCalledTimes(4);
    expect(verify.mock.calls[1]?.[0].documents).toMatchObject([
      { path: RELEVANT, revision: '1:10', text: currentText },
    ]);
    expect(calls).toHaveLength(0);
    expect(result.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.outcome).toBe('no-evidence');
    expect(result.coverage.status).toBe('incomplete');
    expect(result.coverage.unreviewedPaths).toContain(RELEVANT);
    expect(result.content).not.toContain(currentText);
    expect(result.content).not.toContain(indexedQuote);
  });

  it('revision이 같아도 현재 원문 text가 없으면 stale로 제외한다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockReturnValue(verificationFixture());
    const sourceReader = vi.fn(() => Promise.resolve({ revision: '1:10', text: null }));
    const { provider, calls } = answerProvider();

    const result = await reviewIndexedVault(reviewOptions({ provider, sourceReader }));

    expect(sourceReader).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(result.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.outcome).toBe('no-evidence');
    expect(result.coverage.status).toBe('incomplete');
    expect(result.coverage.unreviewedPaths).toContain(RELEVANT);
  });

  it('현재 원문 Rust 검증이 null이면 fail closed하고 provider를 호출하지 않는다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockReturnValueOnce(verificationFixture()).mockReturnValueOnce(null);
    const { provider, calls } = answerProvider();
    const currentText = '현재 원문 표식';

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () => Promise.resolve({ revision: '1:10', text: currentText }),
      }),
    );

    // null 검증 실패 뒤에도 주소 제안과 복구 계획 검증이 시도됩니다.
    expect(verify).toHaveBeenCalledTimes(4);
    expect(calls).toHaveLength(0);
    expect(result.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.outcome).toBe('no-evidence');
    expect(result.coverage.status).toBe('incomplete');
    expect(result.coverage.unreviewedPaths).toContain(RELEVANT);
    expect(result.content).not.toContain(currentText);
  });

  it('현재 원문 재검증을 통과하면 두 번째 검증 뒤 answer를 유지한다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockImplementation(verifiedStatuses);
    const currentText =
      '첫 줄\n둘째 줄\nQuartz restarts only after two cooling cycles.\n넷째 줄';
    const { provider, calls } = answerProvider();

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () => Promise.resolve({ revision: '1:10', text: currentText }),
      }),
    );

    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[1]?.[0].documents).toMatchObject([
      { path: RELEVANT, revision: '1:10', text: currentText },
    ]);
    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe('answered');
    expect(result.evidence).toHaveLength(1);
    expect(result.citations).toHaveLength(1);
  });

  it('현재 원문을 같은 청킹 규칙으로 검증하면 raw-text quote 불일치를 stale로 오인하지 않는다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () =>
          Promise.resolve({
            revision: '1:10',
            text: '현재 원문 표식만 있는 합성 텍스트',
            contentHash: 'hash-relevant',
            chunks: [
              {
                text: 'Quartz restarts only after two cooling cycles.',
                startLine: 3,
                endLine: 4,
              },
            ],
          }),
      }),
    );

    expect(verify).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe('answered');
    expect(result.evidence).toHaveLength(1);
    expect(result.citations[0]?.status).toBe('verified');
  });

  it('큰 현재 원문은 인용 주변 window만 검증해 다른 근거를 막지 않는다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockImplementation(verifiedStatuses);
    const currentText =
      '첫 줄\n둘째 줄\nQuartz restarts only after two cooling cycles.\n' +
      'filler line\n'.repeat(180_000);
    const { provider, calls } = answerProvider();

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () => Promise.resolve({ revision: '1:10', text: currentText }),
      }),
    );

    expect(verify).toHaveBeenCalledTimes(2);
    const documents = verify.mock.calls[1]?.[0].documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]?.text.length).toBeLessThan(1000);
    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe('answered');
    expect(result.evidence).toHaveLength(1);
  });

  it('엔진이 없으면 engine-unavailable을 반환하고 LLM을 부르지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(null);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('engine-unavailable');
    expect(result.engineUnavailable).toBe(true);
    expect(result.citations).toHaveLength(0);
  });

  it('현재 vault 리비전이 어긋난 채택 문서는 인용에서 제외한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, revisionReader: () => Promise.resolve('2:99') }),
    );
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
  });

  it('stale로 제거된 근거는 채택·coverage에서 제거 이후 기준으로 다시 반영한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        revisionReader: (path) => Promise.resolve(path === RELEVANT ? '1:10' : '2:99'),
      }),
    );
    expect(calls).toHaveLength(1);
    expect(result.citations.map((citation) => citation.filePath)).toEqual([RELEVANT]);
    expect(result.providerTransfer.sentFiles).toBe(1);
    expect(result.outcome).toBe('answered');
    // 제거된 문서는 채택 문서·coverage에서 빠지고 원문 재확인 실패 문서로만 남습니다.
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 0,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 1,
        unreadable: 1,
      }),
    );
    expect(result.rejectedFiles).toBe(0);
  });

  it('색인 뒤 원문이 바뀌어도 인용이 현재 본문에 남아 있으면 근거를 복구한다', async () => {
    const plan = vi.mocked(planIndexedEvidenceRust);
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    plan.mockReturnValue(twoDocumentPlan());
    verify.mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const currentText = 'Quartz cooling cycles reduce cracks in the mould.';

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        sourceReader: () =>
          Promise.resolve({ revision: '1:11', text: currentText, contentHash: 'hash-11' }),
      }),
    );

    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe('answered');
    expect(result.evidence).toHaveLength(2);
    expect(result.citations.map((citation) => citation.filePath)).toEqual([RELEVANT]);
    // 복구 계획은 현재 원문 전체를 1행 기준으로 엔진에 넘깁니다.
    const recoveryCall = plan.mock.calls.at(-1)?.[0];
    expect(recoveryCall?.documents).toHaveLength(2);
    expect(
      recoveryCall?.documents.every(
        (document) => document.text === currentText && document.startLine === 1,
      ),
    ).toBe(true);
    expect(result.coverage.unreviewedPaths).not.toContain(RELEVANT);
    expect(result.content).not.toContain(t('indexedReviewNoEvidence'));
  });

  it.each([true, false])(
    '유일한 원문 구절의 주소 제안은 재검증 성공(%s)일 때만 보존한다',
    async (accept) => {
      const initial = planFixture();
      const original = initial.evidence[0];
      if (!original) throw new Error('fixture evidence missing');
      const plan = vi
        .mocked(planIndexedEvidenceRust)
        .mockClear()
        .mockReturnValueOnce(initial)
        .mockReturnValue(null);
      const verify = vi.mocked(verifyIndexedEvidenceRust);
      verify.mockImplementationOnce(verifiedStatuses).mockImplementation((input) => ({
        statuses: verifiedStatuses(input).statuses.map((status) => ({
          ...status,
          status: input.evidence[0]?.startLine === 81 && accept ? 'verified' : 'position-mismatch',
          relocation: { startLine: 81, endLine: 81, revision: '1:11' },
        })),
      }));
      const { provider, calls } = answerProvider();
      const result = await reviewIndexedVault(
        reviewOptions({
          provider,
          sourceReader: () =>
            Promise.resolve({
              revision: '1:11',
              text: original.quote,
              chunks: [{ text: original.quote, startLine: 81, endLine: 81 }],
            }),
        }),
      );
      if (accept) {
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({
          ...original,
          startLine: 81,
          endLine: 81,
          revision: '1:11',
        });
        expect(result.citations[0]?.line).toBe(81);
        expect(calls).toHaveLength(1);
        expect(plan).toHaveBeenCalledTimes(1);
      } else {
        expect(result.evidence).toEqual([]);
        expect(calls).toHaveLength(0);
      }
      expect(verify.mock.calls.some(([input]) => input.evidence[0]?.startLine === 81)).toBe(true);
    },
  );

  it('줄 주소가 바뀐 근거는 현재 청크와 기존 검색 신호로 복구하고 재검증한다', async () => {
    const plan = vi.mocked(planIndexedEvidenceRust);
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    const initial = planFixture();
    const item = initial.evidence[0];
    if (!item) throw new Error('fixture evidence missing');
    const recovered = { ...item, revision: '1:11', startLine: 81, endLine: 82 };
    plan.mockReturnValueOnce(initial).mockReturnValue({ ...initial, evidence: [recovered] });
    verify.mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const chunks = [
      { text: 'Synthetic introductory section.', startLine: 1, endLine: 1 },
      { text: item.quote, startLine: 81, endLine: 82 },
    ];
    const candidates = [
      { path: RELEVANT, score: 0.9, queryIndex: 0, source: 'vector' as const, rank: 1 },
    ];

    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        candidates,
        queryVariants: ['cooling cycles'],
        sourceReader: () => Promise.resolve({ revision: '1:11', text: 'full source', chunks }),
      }),
    );

    const recovery = plan.mock.calls.at(-1)?.[0];
    expect(recovery?.documents).toEqual(
      chunks.map((chunk) => ({
        ...chunk,
        path: RELEVANT,
        revision: '1:11',
        indexed: true,
        reviewState: 'reviewed',
      })),
    );
    expect(recovery?.candidates).toEqual(candidates);
    expect(recovery?.queryVariants).toEqual(['cooling cycles']);
    expect(verify.mock.calls.at(-1)?.[0].documents).toEqual(recovery?.documents);
    expect(result.evidence).toEqual([recovered]);
    expect(result.citations[0]?.line).toBe(81);
    expect(calls).toHaveLength(1);
  });

  it('stale 제거로 결과가 비면 no-evidence와 미완료 고지를 유지한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, revisionReader: () => Promise.resolve('2:99') }),
    );
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.engineUnavailable).toBe(false);
    const incomplete = t('indexedReviewIncompleteNotice', {
      total: 2,
      accepted: 0,
      machineExcluded: 0,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 2,
      unreadable: 2,
    });
    expect(result.coverageNotice).toBe(incomplete);
    expect(result.content).toBe(`${t('indexedReviewNoEvidence')}\n\n${incomplete}`);
  });

  it('중복 vault 접두사는 첫 원문을 assistant로 전달해 정확한 ID로 한 번 교정한다', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const invalidAnswer = JSON.stringify({
      paragraphs: [{ text: '형식 오류', sources: [`vault:vault:${SOURCE_ID}`] }],
    });
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        attempt += 1;
        consume({
          content:
            attempt === 1
              ? invalidAnswer
              : JSON.stringify({
                  paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
                }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(result.content).toContain('두 번 냉각한 뒤');
    expect(calls[1]).toContainEqual({ role: 'assistant', content: invalidAnswer });
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedReviewAnswerCorrection', {
        reason: 'invalid-format',
        facets: '-',
      }),
    });
    expect(calls[0]?.[0]?.content).toContain('sourceId를 그대로 복사');
    expect(calls[1]?.at(-1)?.content).toContain('vault: 접두사를 붙이지');
  });

  it('단일 vault 접두사는 원본 sourceId로 정규화해 교정 없이 채택한다', async () => {
    const calls: ChatMessage[][] = [];
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        consume({
          content: JSON.stringify({
            paragraphs: [
              { text: '두 번 냉각한 뒤 재시작합니다.', sources: ['vault:' + SOURCE_ID] },
            ],
          }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(1);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(0);
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('첫 응답이 빈 문자열이면 assistant 원문 없이 교정 요청을 한 번 수행한다', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        attempt += 1;
        consume({
          content:
            attempt === 1
              ? ''
              : JSON.stringify({
                  paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
                }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(calls[1]?.some((message) => message.role === 'assistant')).toBe(false);
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedReviewAnswerCorrection', {
        reason: 'invalid-format',
        facets: '-',
      }),
    });
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('supported에서 두 답변 시도가 실패하면 coverage와 검증된 원문을 표시한다', async () => {
    const calls: ChatMessage[][] = [];
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        consume({
          content: JSON.stringify({
            paragraphs: [{ text: '형식 오류', sources: ['missing-source'] }],
          }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    const coverage = t('indexedReviewCoverage', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 0,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(coverage);
    expect(result.content).toContain('> Quartz restarts');
    expect(result.content.indexOf('> Quartz restarts')).toBeLessThan(
      result.content.indexOf(coverage),
    );
    expect(result.content.endsWith(coverage)).toBe(true);
    expect(result.outcome).toBe('evidence-only');
    expect(result.citations[0]?.status).toBe('verified');
    expect(result.content).not.toContain('검수 미완료');
  });

  it('budget-exhausted이고 실제 미검토 문서가 없으면 근거 범위 제한 고지와 답변을 낸다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: { ...plan.coverage, status: 'budget-exhausted' },
    });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    const limited = t('indexedReviewLimitedNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 0,
      unreadable: 0,
    });
    expect(calls).toHaveLength(1);
    expect(result.coverageNotice).toBe(limited);
    expect(result.content).toContain('두 번 냉각한 뒤');
    expect(result.content.indexOf('두 번 냉각한 뒤')).toBeLessThan(result.content.indexOf(limited));
    expect(result.content.endsWith(limited)).toBe(true);
    expect(result.coverageNotice).not.toContain('검수 미완료');
  });

  it('budget-exhausted여도 실제 미검토 문서가 있으면 incomplete 고지를 쓴다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: {
        ...plan.coverage,
        status: 'budget-exhausted',
        reviewedDocuments: 1,
        unreviewedDocuments: 1,
      },
    });
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    const incomplete = t('indexedReviewIncompleteNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 1,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(incomplete);
    expect(result.content.indexOf('두 번 냉각한 뒤')).toBeLessThan(
      result.content.indexOf(incomplete),
    );
    expect(result.content.endsWith(incomplete)).toBe(true);
    expect(result.content).not.toContain(
      t('indexedReviewLimitedNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 1,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 1,
        unreadable: 0,
      }),
    );
  });

  it('기계 선별·예산 제외 후보를 색인 범위 밖 문서로 표현하지 않는다', async () => {
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(result.coverageNotice).toContain('점수·필터로 제외된 후보 1개');
    expect(result.coverageNotice).not.toContain('색인 범위 밖 제외 1개');
  });

  it('전체 검토의 지원 상태와 전역 미색인 문서 수치를 구분한다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: { ...plan.coverage, status: 'incomplete', notIndexedDocuments: 1 },
    });
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 1,
        rejected: 0,
        budgetExcluded: 0,
        unreviewed: 0,
        notIndexed: 1,
        unreadable: 0,
      }),
    );
    expect(result.coverageNotice).toContain('미색인 문서 1개');
  });

  it('원문 검증 제외·원문 확인 후 예산 제외·원문 재확인 실패를 섞지 않는다', async () => {
    const base = planFixture();
    const selected = base.evidence[0];
    if (!selected) throw new Error('plan fixture without evidence');
    const verificationFailedId = RELEVANT + '#L5-L6';
    const budgetExcludedId = OTHER + '#L1-L1';
    const plan: RustIndexedEvidencePlan = {
      ...base,
      order: [selected.sourceId, verificationFailedId, budgetExcludedId],
      evidence: [
        { ...selected, score: 3, rank: 1 },
        {
          ...selected,
          sourceId: verificationFailedId,
          startLine: 5,
          endLine: 6,
          quote: 'A quotation that no longer matches the indexed source.',
          score: 2,
          rank: 2,
        },
        {
          ...selected,
          sourceId: budgetExcludedId,
          path: OTHER,
          startLine: 1,
          endLine: 1,
          quote: 'Delivery schedule for the northern region.',
          score: 1,
          rank: 3,
        },
      ],
      coverage: { ...base.coverage, status: 'incomplete', unreviewedDocuments: 1 },
    };
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(plan);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation((input) => ({
      statuses: verifiedStatuses(input).statuses.map((status) => {
        if (status.sourceId === verificationFailedId) {
          return {
            ...status,
            status: 'quote-missing' as const,
            exists: false,
            lineMatches: false,
          };
        }
        if (status.sourceId === budgetExcludedId) {
          return {
            ...status,
            status: 'unreviewed' as const,
            reviewState: 'unreviewed' as const,
          };
        }
        return status;
      }),
    }));
    const result = await reviewIndexedVault(reviewOptions());
    const incomplete = t('indexedReviewIncompleteNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 1,
      budgetExcluded: 1,
      notIndexed: 0,
      unreviewed: 1,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(incomplete);
    expect(result.rejectedFiles).toBe(1);
  });

  it('deferAnswer면 답변을 만들지 않고 검증 근거만 돌려준다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider, deferAnswer: true }));
    expect(calls).toHaveLength(0);
    expect(result.dossier.evidence[0]?.quote).toContain('cooling cycles');
    expect(result.outcome).toBe('evidence-only');
    expect(result.providerTransfer.sentFiles).toBe(0);
  });

  it('해시와 mtime:size는 비교 영역이 달라 해시 근거는 verified로 승격하지 않는다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      evidence: plan.evidence.map((item) => ({ ...item, revision: 'hash-relevant' })),
    });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
  });

  it('색인에 청크 해시가 없으면 엔진 입력에서 제외한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const corpus = corpusFixture();
    const stale: IndexedVaultCorpus = {
      getFileIndexRecords: () => corpus.getFileIndexRecords(),
      getEntriesByFilePaths: async (paths) =>
        (await corpus.getEntriesByFilePaths(paths)).map((entry) => ({
          ...entry,
          metadata: { ...entry.metadata, contentHash: undefined },
        })),
    };
    const search = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: stale,
    });
    expect(search?.evidence).toEqual([]);
    expect(search?.coverage.status).toBe('incomplete');
  });

  it('코퍼스 청크 sourceMtime(ms epoch)을 엔진 modifiedAt으로 배선한다', async () => {
    const sourceMtime = 1_700_000_000_000;
    const corpus = corpusFixture();
    const stamped: IndexedVaultCorpus = {
      getFileIndexRecords: async () =>
        (await corpus.getFileIndexRecords()).map((record) => ({ ...record, sourceMtime })),
      getEntriesByFilePaths: async (paths) =>
        (await corpus.getEntriesByFilePaths(paths)).map((entry) => ({
          ...entry,
          metadata: { ...entry.metadata, sourceMtime },
        })),
    };
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: stamped,
    });
    const documents = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0]?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]?.modifiedAt).toBe(sourceMtime);
  });

  it('코퍼스가 sourceMtime을 주지 않으면 modifiedAt 키를 만들지 않는다', async () => {
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: corpusFixture(),
    });
    const documents = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0]?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]).not.toHaveProperty('modifiedAt');
  });
});
