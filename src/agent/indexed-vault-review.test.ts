import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { enumerateIndexedDocuments } from './indexed-vault-enumeration';
import { LLMProviderHttpError, type ChatMessage, type LLMProvider } from '../llm/providers';
import {
  createContentHashRust,
  mergeIndexedEvidencePlansRust,
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
  toModelIndexedEvidenceDossier,
  type IndexedVaultCorpus,
  type IndexedVaultReviewOptions,
} from './indexed-vault-review';

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    createContentHashRust: vi.fn(actual.createContentHashRust),
    mergeIndexedEvidencePlansRust: vi.fn(actual.mergeIndexedEvidencePlansRust),
    planIndexedEvidenceRust: vi.fn(actual.planIndexedEvidenceRust),
    planIndexedReviewAnswerPlanRust: vi.fn(actual.planIndexedReviewAnswerPlanRust),
    validateIndexedReviewAnswerRust: vi.fn(actual.validateIndexedReviewAnswerRust),
    verifyIndexedEvidenceRust: vi.fn(actual.verifyIndexedEvidenceRust),
  };
});

const RELEVANT = 'Synthetic/Relevant.md';
const OTHER = 'Synthetic/Other.md';
const HIDDEN = 'Synthetic/Hidden.md';
const SOURCE_ID = RELEVANT + '#L3-L4';
const OTHER_SOURCE_ID = OTHER + '#L1-L1';
const HIDDEN_SOURCE_ID = HIDDEN + '#L1-L1';

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

function corpusWithDiscoverableDocument(): IndexedVaultCorpus {
  const base = corpusFixture();
  const record = {
    filePath: HIDDEN,
    contentHash: 'hash-hidden',
    sourceMtime: 1,
    sourceSize: 10,
    vectorCount: 1,
    updated: 1,
  };
  const entry = {
    id: 'chunk-hidden',
    vector: [],
    metadata: {
      filePath: HIDDEN,
      startLine: 1,
      endLine: 1,
      text: 'Quartz cooling cycles increase in winter.',
      contentHash: 'hash-hidden',
    },
  };
  return {
    getEntriesByFilePaths: async (paths) => {
      const entries = await base.getEntriesByFilePaths(paths.filter((path) => path !== HIDDEN));
      return paths.includes(HIDDEN) ? [...entries, entry] : entries;
    },
    getFileIndexRecords: async () => [...(await base.getFileIndexRecords()), record],
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

function hiddenPlan(): RustIndexedEvidencePlan {
  const plan = planFixture();
  const first = plan.evidence[0];
  if (!first) throw new Error('hidden fixture without a passage');
  return {
    ...plan,
    order: [HIDDEN_SOURCE_ID],
    evidence: [
      {
        ...first,
        sourceId: HIDDEN_SOURCE_ID,
        path: HIDDEN,
        quote: 'Quartz cooling cycles increase in winter.',
        startLine: 1,
        endLine: 1,
        queryIndexes: [2],
      },
    ],
    coverage: { ...plan.coverage, reviewedDocuments: 1 },
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
  it.each([0, 2])('최소 DTO helper는 기존 provider payload와 대표 페이지 %s개 상태를 그대로 공유한다', async (pageCount) => {
    const { provider, calls } = answerProvider();
    const summary = {
      matchMode: 'nfkc-unicode-lower-line-substring-v1' as const, generationId: 'synthetic-generation',
      receipt: { version: 1 as const, incarnation: 'synthetic-incarnation', mutation: 'synthetic-mutation' },
      sources: 2, needles: [{ needle: 'quartz', normalizedNeedle: 'quartz', documents: 1, matchingLines: 2, occurrences: 3 }], pageCount,
    };
    const result = await reviewIndexedVault(reviewOptions({ provider,
      openLiteralInventory: () => Promise.resolve({ getSummary: () => Promise.resolve(summary),
        readPage: (pageIndex) => Promise.resolve({ pageIndex, nextPage: pageIndex + 1 < pageCount ? pageIndex + 1 : null, references: [] }),
        close: () => Promise.resolve() }),
    }));
    const dossier = result.dossier;
    dossier.sourceDocuments = { [RELEVANT]: { segments: [{ label: '합성 비공개 원장', startLine: 0, endLine: 0 }] } };
    const original = structuredClone(dossier);
    const projected = toModelIndexedEvidenceDossier(dossier);
    expect(JSON.parse(JSON.stringify(projected))).toEqual(JSON.parse(String(calls[0]?.[1]?.content)));
    expect(projected.literalInventory).toEqual({ matchMode: summary.matchMode, scope: 'indexed-policy-allowed-source-body',
      needles: summary.needles, discoveryPagesReadComplete: true });
    expect(JSON.stringify(projected)).not.toContain('합성 비공개 원장');
    expect(JSON.stringify(projected)).not.toMatch(/sourceDocuments|generationId|receipt|incarnation|mutation|pageCount|representativePages/);
    expect(dossier).toEqual(original);
  });

  it.each(['unavailable', 'failed'] as const)('최소 DTO helper는 %s reason을 바꾸지 않는다', async (status) => {
    const result = await reviewIndexedVault(reviewOptions({ deferAnswer: true }));
    result.dossier.literalInventory = { status, reason: 'source-literal-unavailable' };
    expect(toModelIndexedEvidenceDossier(result.dossier).literalInventory).toEqual(result.dossier.literalInventory);
  });

  it.each(['owner', 'signal'] as const)('마지막 literal summary await 도중 %s 무효화는 답변·완료를 게시하지 않는다', async (failure) => {
    const { provider } = answerProvider();
    const controller = new AbortController();
    let current = true, calls = 0;
    const summary = { matchMode: 'nfkc-unicode-lower-line-substring-v1' as const, generationId: 'synthetic', receipt: { version: 1 as const, incarnation: crypto.randomUUID(), mutation: crypto.randomUUID() }, sources: 2, needles: [], pageCount: 0 };
    const close = vi.fn(() => Promise.resolve());
    const onAnswer = vi.fn(), onProgress = vi.fn<NonNullable<IndexedVaultReviewOptions['onProgress']>>();
    const reviewing = reviewIndexedVault(reviewOptions({ provider, deferAnswer: true, signal: controller.signal, isCurrent: () => current, onAnswer, onProgress,
      openLiteralInventory: () => Promise.resolve({ getSummary: () => { if (++calls === 2) { if (failure === 'signal') controller.abort(); else current = false; } return Promise.resolve(summary); }, readPage: () => Promise.resolve(null), close }),
    }));
    if (failure === 'signal') await expect(reviewing).rejects.toMatchObject({ name: 'AbortError' });
    else { const result = await reviewing; expect(result.outcome).toBe('indexing'); expect(result.evidence).toEqual([]); expect(result.citations).toEqual([]); }
    expect(calls).toBe(2);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([progress]) => progress.phase === 'complete')).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([false, true])('opener가 없는 filter=%s의 unavailable은 dossier와 모델 payload에서도 명시한다', async (filters) => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider, ...(filters ? { filters: {} } : {}),
      matchInventory: [{ query: 'quartz', totalDocuments: 2, totalChunks: 2, totalOccurrences: 2, documents: [] }],
    }));
    const expected = { status: 'unavailable', reason: filters ? 'unsupported-filters' : 'source-literal-unavailable' };
    expect(result.dossier.literalInventory).toEqual(expected);
    expect(calls.length).toBeGreaterThan(0);
    const payload = JSON.parse(String(calls[0][1].content)) as { literalInventory?: unknown; matchInventory?: unknown };
    expect(payload.literalInventory).toEqual(expected);
    expect(payload.matchInventory).toEqual([{ query: 'quartz', totalDocuments: 2, totalChunks: 2, totalOccurrences: 2 }]);
  });
  it('실제 검색·원문 검증·생성·교정 단계와 제공된 추론만 전달하고 미검증 JSON은 숨긴다', async () => {
    const phases: string[] = [];
    const onReasoning = vi.fn();
    const onAnswer = vi.fn();
    let requests = 0;
    const streamChat: LLMProvider['streamChat'] = async (_messages, consume) => {
      requests++;
      consume({ content: requests === 1 ? '{"paragraphs":' : JSON.stringify({
        paragraphs: [{ text: '냉각 조건을 확인했습니다.', sources: [SOURCE_ID] }],
      }), reasoning: '제공된 근거의 조건을 확인합니다.', done: false });
      expect(onAnswer).not.toHaveBeenCalled();
      await Promise.resolve();
    };
    const result = await reviewIndexedVault(reviewOptions({
      provider: { streamChat }, onAnswer, onReasoning,
      onProgress: (progress) => phases.push(progress.phase),
    }));
    expect(phases).toEqual(expect.arrayContaining(['search', 'verify', 'answer', 'repair', 'complete']));
    expect(onReasoning).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('냉각 조건을 확인했습니다.');
    expect(result.content).not.toContain('{"paragraphs":');
  });

  it('사용자 시스템 프롬프트를 provider 답변 요청에 전달한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ systemPrompt: '사용자 답변 지침', provider }),
    );
    expect(result.outcome).toBe('answered');
    expect(calls.length).toBeGreaterThan(0);
    for (const messages of calls) {
      expect(messages.find((message) => message.role === 'system')?.content).toContain(
        '사용자 답변 지침',
      );
      expect(messages.find((message) => message.role === 'user')?.content).not.toContain(
        '사용자 답변 지침',
      );
    }
  });

  it.each([false, true])('최초 후보 밖 후속 근거를 원문 검증 뒤 결합하고 실패한 문서는 제외한다: %s', async (sourceMissing) => {
    const extra = twoDocumentPlan();
    extra.evidence = extra.evidence.map((item) => ({ ...item, queryIndexes: [2], preferredQueryIndexes: [2] }));
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
    if (!sourceMissing) {
      const followup = result.evidence.find((item) => item.path === OTHER);
      expect(followup?.queryIndexes ?? []).toEqual([]);
      expect(followup?.preferredQueryIndexes ?? []).toEqual([]);
    }
    const request = calls[1]?.[1]?.content ?? '{}';
    const projectedEvidence: unknown = JSON.parse(JSON.stringify(toModelIndexedEvidenceDossier(result.dossier).evidence));
    expect(JSON.parse(request)).toMatchObject({
      evidence: projectedEvidence,
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

  it('후속 검토가 성공해도 기본 검토의 미검토·미색인 수를 지우지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust)
      .mockReturnValueOnce(planFixture())
      .mockReturnValueOnce(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    let requests = 0;
    const streamChat = vi.fn((_messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      requests++;
      consume({
        content:
          requests === 1
            ? '["delivery schedule", "cooling protocol"]'
            : JSON.stringify({
                paragraphs: [
                  { text: '근거를 확인했습니다.', sources: [SOURCE_ID, OTHER_SOURCE_ID] },
                ],
              }),
      });
      return Promise.resolve();
    });
    const sourceReader = vi.fn((path: string) =>
      Promise.resolve({
        revision: '1:10',
        text:
          path === RELEVANT
            ? '\n\nQuartz restarts only after two cooling cycles.\n'
            : 'Delivery schedule for the northern region.',
      }),
    );
    const result = await reviewIndexedVault(
      reviewOptions({
        indexedPaths: [RELEVANT],
        provider: { streamChat },
        sourceReader,
        inventory: { indexedCount: 3, unreviewedCount: 0, notIndexedCount: 1 },
        discoveryPaths: [RELEVANT, OTHER],
        discoveryCandidates: [
          { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
          { path: OTHER, score: 1, source: 'bm25', rank: 2 },
        ],
        getFollowupPaths: () => Promise.resolve([RELEVANT, OTHER]),
      }),
    );

    expect(result.dossier.followup?.status).toBe('searched');
    expect(result.coverage.reviewedDocuments).toBe(2);
    // 기본 검토에서 요청 밖 색인 2개와 미색인 1개는 후속 검토 뒤에도 유지됩니다.
    expect(result.coverage.unreviewedDocuments).toBe(2);
    expect(result.coverage.notIndexedDocuments).toBe(1);
    expect(result.coverage.status).toBe('incomplete');
  });

  it.each([false, true])('필터·mixed 요청도 범위 내 전체 검색과 첫 모델 단서 페이지를 분리한다: %s', async (mixed) => {
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const paths = Array.from({ length: 121 }, (_, index) => `Synthetic/Lead-${index}.md`);
    const streamChat = vi.fn((_messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      consume({ content: '{"queries":["cooling exceptions"],"enumerate":false}' });
      return Promise.resolve();
    });
    const result = await reviewIndexedVault(reviewOptions({
      provider: { streamChat }, deferAnswer: mixed, filters: { tags: [] },
      discoveryCandidates: [RELEVANT, ...paths].map((path, index) => ({ path, score: 1, source: 'bm25', rank: index + 1 })),
      discoveryPaths: [RELEVANT, ...paths],
      getFollowupPaths: () => Promise.resolve([RELEVANT, ...paths.slice(1)]),
    }));
    const request: unknown = JSON.parse(streamChat.mock.calls[0]?.[0][1]?.content ?? '{}');
    const expectedDiscovery: unknown = expect.arrayContaining([{ path: paths[1], state: 'unreviewed', verification: 'unverified' }]);
    expect(request).toMatchObject({ discovery: expectedDiscovery });
    if (!request || typeof request !== 'object' || !('discovery' in request)) throw new Error('단서 목록 필요');
    expect(request.discovery).toHaveLength(96);
    expect(request).toMatchObject({ discoveredDocuments: 121, discoveryNextOffset: 96 });
    expect(JSON.stringify(request)).not.toContain(paths[0]);
    expect(result.dossier.followup?.status).toBe('searched');
    expect(result.readDiscoveryPage).toBeTypeOf('function');
    if (mixed) expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it('100개 문서 전체 열거를 상위 k와 분리해 검증하고 중복·읽기 실패·접근 변경을 보존한다', async () => {
    const seed = await reviewIndexedVault(reviewOptions({ deferAnswer: true }));
    const paths = Array.from({ length: 100 }, (_, index) => `Synthetic/Listing-${index}.md`);
    const item = seed.evidence[0];
    const citation = seed.citations[0];
    if (!item || !citation) throw new Error('검증된 합성 근거 필요');
    let allowed = paths;
    const review = vi.fn((request: IndexedVaultReviewOptions) => {
      const path = request.indexedPaths[0];
      const sourceId = `${path}#L1-L1`;
      return Promise.resolve({ ...seed, evidence: [{ ...item, path, sourceId, startLine: 1, endLine: 1 }],
        citations: [{ ...citation, id: sourceId, filePath: path, status: 'verified' as const }] });
    });
    const options = reviewOptions({
      indexedPaths: paths, discoveryPaths: paths, getFollowupPaths: () => Promise.resolve(allowed),
      matchInventory: [{ query: 'quartz', totalDocuments: 100, totalChunks: 100, totalOccurrences: 100,
        documents: paths.map((sourcePath) => ({ sourcePath, occurrences: 1 })) }],
    });
    await expect(enumerateIndexedDocuments({ ...options, isCurrent: () => false }, review))
      .rejects.toThrow('[enumerate:currentness]');
    expect(review).not.toHaveBeenCalled();
    const complete = await enumerateIndexedDocuments(options, review);
    expect(complete.incomplete).toBe(false);
    expect(complete.citations).toHaveLength(100);
    expect(new Set(complete.citations.map((item) => item.filePath)).size).toBe(100);
    expect(complete.content).toContain('Listing&#45;99');
    expect(review).toHaveBeenCalledTimes(100);
    expect(review.mock.calls[99]?.[0]).toMatchObject({ deferAnswer: true, matchInventory: undefined, indexedPaths: [paths[99]] });
    const restricted = await enumerateIndexedDocuments({ ...options, matchInventory: [options.matchInventory![0], options.matchInventory![0]] }, async (request) => {
      const result = await review(request);
      if (request.indexedPaths[0] === paths[99]) allowed = paths.slice(1);
      return request.indexedPaths[0] === paths[50] ? { ...result, evidence: [], citations: [] } : result;
    });
    expect(restricted.incomplete).toBe(true);
    expect(restricted.citations).toHaveLength(98);
    expect(restricted.content).not.toContain('Listing&#45;0 ');
    const controller = new AbortController();
    controller.abort();
    await expect(enumerateIndexedDocuments({ ...options, signal: controller.signal }, review)).rejects.toThrow();
  });

  it('열거 검토는 검색 계획 상한(3개)을 넘는 질의 변형을 전달하지 않는다', async () => {
    const seed = await reviewIndexedVault(reviewOptions({ deferAnswer: true }));
    const item = seed.evidence[0];
    const citation = seed.citations[0];
    if (!item || !citation) throw new Error('검증된 합성 근거 필요');
    const review = vi.fn((request: IndexedVaultReviewOptions) => {
      const path = request.indexedPaths[0];
      const sourceId = `${path}#L1-L1`;
      return Promise.resolve({
        ...seed,
        evidence: [{ ...item, path, sourceId, startLine: 1, endLine: 1 }],
        citations: [{ ...citation, id: sourceId, filePath: path, status: 'verified' as const }],
      });
    });
    const queries = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const options = reviewOptions({
      indexedPaths: [RELEVANT],
      discoveryPaths: [RELEVANT],
      getFollowupPaths: () => Promise.resolve([RELEVANT]),
      matchInventory: queries.map((query) => ({
        query,
        totalDocuments: 1,
        totalChunks: 1,
        totalOccurrences: 1,
        documents: [{ sourcePath: RELEVANT, occurrences: 1 }],
      })),
    });

    const result = await enumerateIndexedDocuments(options, review);

    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]?.[0]).toMatchObject({
      question: 'q1',
      queryVariants: ['q2', 'q3', 'q4'],
    });
    expect(result.incomplete).toBe(false);
  });

  it.each([false, true])('목록 질문은 모델 생성 보류=%s에서도 검증된 열거를 표시한다', async (deferAnswer) => {
    const { provider, calls } = answerProvider();
    const currentText =
      '첫 줄\n둘째 줄\nQuartz restarts only after two cooling cycles.\n넷째 줄';

    const result = await reviewIndexedVault(
      reviewOptions({
        question: '볼트의 모든 문서를 나열해줘',
        indexedPaths: [RELEVANT],
        provider,
        deferAnswer,
        sourceReader: () =>
          Promise.resolve({
            revision: '1:10',
            text: currentText,
            contentHash: 'hash-relevant',
          }),
        matchInventory: [
          {
            query: 'Quartz',
            totalDocuments: 1,
            totalChunks: 1,
            totalOccurrences: 1,
            documents: [{ sourcePath: RELEVANT, occurrences: 1 }],
          },
        ],
      }),
    );

    expect(result.dossier.followup?.status).not.toBe('searched');
    expect(result.dossier.enumeration).toBeDefined();
    expect(result.dossier.enumeration?.incomplete).toBe(false);
    expect(result.citations.some((citation) => citation.filePath === RELEVANT)).toBe(true);
    expect(result.content).toContain(result.dossier.enumeration?.content);
    expect(calls).toHaveLength(deferAnswer ? 0 : 1);
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

  it('검토 예산 밖 discovery 페이지의 미검토 경로를 현재 원문 검증 근거로 합류시킨다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT, OTHER],
      deferAnswer: true,
      discoveryCandidates: [
        { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
        { path: OTHER, score: 1, source: 'bm25', rank: 2 },
        { path: HIDDEN, score: 0.5, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER, HIDDEN],
    }));
    expect(result.diagnostics.counts.discoveryInspectedDocuments).toBe(1);
    expect(result.coverage.plannedPaths).toContain(HIDDEN);
    const evidence = result.evidence.find((item) => item.path === HIDDEN);
    expect(evidence?.quote).toBe('Quartz cooling cycles increase in winter.');
    expect(result.citations.find((citation) => citation.filePath === HIDDEN)?.status).toBe(
      'verified',
    );
    expect(result.dossier.discoverySummary?.selectedSourceDocuments).toBeGreaterThanOrEqual(2);
  });

  it.each(['empty', 'partial', 'partial-revoked'] as const)('후속 순위가 %s면 기존 단서로 남은 원문 심사 예산을 채운다', async mode => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const basePath = 'Synthetic/Base.md';
    const rankedPath = 'Synthetic/Ranked.md';
    const revoked = 'Synthetic/Revoked.md';
    const outside = 'Synthetic/New.md';
    const fallback = Array.from({ length: 10 }, (_, i) => `Synthetic/Discovery-${i}.md`);
    const original = [basePath, rankedPath, revoked, ...fallback];
    const textFor = (path: string) => path === rankedPath ? 'The interferometer isolates motion.' : `The quartz threshold is documented in ${path}.`;
    let allowed = [...original, outside];
    const getEntriesByFilePaths = vi.fn((paths: readonly string[]) => {
      if (mode === 'partial-revoked' && paths.includes(rankedPath)) allowed = allowed.filter(path => path !== fallback[2]);
      return Promise.resolve(paths.map(path => ({ id: path, vector: [], metadata: {
        filePath: path, startLine: 1, endLine: 1, text: textFor(path), contentHash: 'indexed',
      } })));
    });
    const sourceReader = vi.fn((path: string) => {
      const text = textFor(path);
      return Promise.resolve(path === fallback[0] ? { text: null, revision: null } : {
        text, revision: '1:10', chunks: [{ startLine: 1, endLine: 1, text }],
      });
    });
    const rankFollowup = vi.fn(() => {
      allowed = [basePath, rankedPath, outside, ...fallback];
      return Promise.resolve(mode === 'empty' ? [[]] : [[revoked, outside, rankedPath, rankedPath]]);
    });
    const corpus = { getEntriesByFilePaths, getFileIndexRecords: () => Promise.resolve(original.map(filePath => ({
      filePath, contentHash: 'indexed', sourceMtime: 1, sourceSize: 10, vectorCount: 1, updated: 1,
    }))) };
    const { provider } = scriptedAnswerProvider(['["interferometer"]']);
    const candidates = [basePath, revoked, outside, ...(mode === 'empty' ? [] : [rankedPath]), ...fallback]
      .map((path, i) => ({ path, score: 1, source: 'bm25' as const, rank: i + 1 }));
    const result = await reviewIndexedVault(reviewOptions({ question: 'Quartz threshold', indexedPaths: [basePath],
      scopes: ['Synthetic'], deferAnswer: true, corpus, sourceReader, provider, candidates: candidates.slice(0, 1),
      discoveryPaths: original, discoveryCandidates: candidates, getFollowupPaths: () => Promise.resolve(allowed), rankFollowup,
    }));
    const denied = [revoked, outside, ...(mode === 'partial-revoked' ? [fallback[2]] : [])];
    const expected = (mode === 'empty' ? fallback.slice(0, 8) : [rankedPath, ...fallback.slice(0, 7)])
      .filter(path => !denied.includes(path));
    expect(rankFollowup).toHaveBeenCalledOnce();
    expect(getEntriesByFilePaths.mock.calls.flatMap(([paths]) => paths)).toEqual([basePath, ...expected]);
    expect(result.diagnostics.counts.discoveryInspectedDocuments).toBe(expected.length);
    expect(result.diagnostics.stageTrace?.selectionAndFollowup).toMatchObject({ pages: 1, inspected: expected.length });
    expect(result.citations).toContainEqual(expect.objectContaining({ filePath: fallback[1], status: 'verified' }));
    if (mode !== 'empty') expect(result.citations).toContainEqual(expect.objectContaining({ filePath: rankedPath, status: 'verified' }));
    expect(sourceReader.mock.calls.some(([path]) => denied.includes(path))).toBe(false);
    expect(result.citations.some(citation => citation.filePath === fallback[0])).toBe(false);
  });

  it('반대쪽 원표기로 뒤바뀐 번역 계획은 기본 비교 계획을 대체하지 않는다', async () => {
    const plan = { ...COMPARISON_SEARCH_PLAN };
    const { provider, calls } = scriptedAnswerProvider([JSON.stringify({ subjects: [
      { anchor: 'Synthetic Alpha', identity: 'ＳＹＮＴＨＥＴＩＣ ＢＥＴＡ', query: 'physics' },
      { anchor: 'Synthetic Beta', identity: 'synthetic alpha', query: 'physics' },
    ] })]);
    const rankFollowup = vi.fn(() => Promise.resolve([[RELEVANT], [OTHER]]));
    const result = await reviewIndexedVault(reviewOptions({ question: 'Compare Synthetic Alpha and Synthetic Beta.', searchPlan: plan,
      deferAnswer: true, provider, rankFollowup, discoveryPaths: [RELEVANT, OTHER],
      discoveryCandidates: [{ path: RELEVANT, score: 1, rank: 1, source: 'bm25' }],
      getFollowupPaths: () => Promise.resolve([RELEVANT, OTHER]),
    }));
    expect(calls).toHaveLength(1);
    expect(rankFollowup).not.toHaveBeenCalled();
    expect(result.diagnostics.stageTrace?.selectionAndFollowup).toMatchObject({ followup: 'failed', failure: 'plan' });
    expect(result.dossier.searchPlan).toEqual(plan);
  });

  it.each(['no-ranked-chunks', 'merge-failure', 'current-read-failure', 'duplicate-evidence', 'regresses-support', 'regresses-recovered-support', 'verified-support'] as const)(
    '후속 순위 %s: 새 검증 근거가 양측 지원을 유지할 때만 비교 계획을 바꾼다', async mode => {
      const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
      vi.mocked(planIndexedReviewAnswerPlanRust).mockImplementation(actual.planIndexedReviewAnswerPlanRust);
      vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
      const question = 'Compare Synthetic Alpha and Synthetic Beta.';
      const right = 'Synthetic/RankedBeta.md';
      const duplicate = mode === 'duplicate-evidence';
      const regresses = mode === 'regresses-support' || mode === 'regresses-recovered-support';
      const ranked = duplicate ? [[RELEVANT], [OTHER]] : [[HIDDEN], regresses ? [] : [right]];
      const paths = [...new Set([RELEVANT, OTHER, ...ranked.flat()])];
      const quotes = new Map([
        [RELEVANT, 'Alpha yields under pressure.'], [OTHER, 'Beta fractures under pressure.'],
        [HIDDEN, 'Copper exhibits ductility.'], [right, 'Quartz forms a lattice.'],
      ]);
      const isRanked = (path: string) => path === HIDDEN || path === right;
      const getEntriesByFilePaths = vi.fn((requested: readonly string[]) => Promise.resolve(requested.flatMap(path =>
        isRanked(path) && mode === 'no-ranked-chunks' ? [] : [{ id: path, vector: [], metadata: {
          filePath: path, startLine: 1, endLine: 1, text: quotes.get(path)!, contentHash: 'indexed',
        } }])));
      const corpus = { getEntriesByFilePaths, getFileIndexRecords: () => Promise.resolve(paths.map(filePath => ({
        filePath, contentHash: 'indexed', sourceMtime: 1, sourceSize: 10, vectorCount: 1, updated: 1,
      }))) };
      const sourceReader = vi.fn((path: string) => {
        const text = quotes.get(path)!;
        return Promise.resolve(isRanked(path) && mode === 'current-read-failure' ? { text: null, revision: null } : {
          text, revision: '1:10', chunks: [{ startLine: 1, endLine: 1, text }],
        });
      });
      const rankFollowup = vi.fn(() => Promise.resolve(ranked));
      const { provider } = scriptedAnswerProvider([JSON.stringify({ subjects: [
        { anchor: duplicate ? 'Alpha' : 'Synthetic Alpha', identity: 'copper', query: duplicate ? 'alpha' : 'ductility' },
        { anchor: duplicate ? 'Beta' : 'Synthetic Beta', identity: 'quartz', query: duplicate ? 'beta' : 'lattice' },
      ] })]);
      const candidates = [{ path: RELEVANT, queryIndex: 1 }, { path: OTHER, queryIndex: 2 }]
        .map((candidate, i) => ({ ...candidate, score: 1, rank: i + 1, source: 'bm25' as const }));
      const review = () => reviewIndexedVault(reviewOptions({ question,
        searchPlan: COMPARISON_SEARCH_PLAN, deferAnswer: true, provider, corpus, sourceReader, rankFollowup,
        candidates, discoveryPaths: paths, discoveryCandidates: candidates, getFollowupPaths: () => Promise.resolve(paths),
      }));
      let result!: Awaited<ReturnType<typeof review>>;
      await vi.mocked(planIndexedEvidenceRust).withImplementation(input => {
        const plan = actual.planIndexedEvidenceRust(input);
        if (!plan || input.question !== question || mode === 'regresses-recovered-support') return plan;
        return { ...plan, evidence: plan.evidence.map(item => ({ ...item, queryIndexes: [item.path === RELEVANT ? 1 : 2] })) };
      }, async () => {
        if (mode === 'merge-failure') {
          await vi.mocked(mergeIndexedEvidencePlansRust).withImplementation(input =>
            input.plans.length > 1 && input.plans.some(plan => plan.evidence.some(item => isRanked(item.path)))
              ? null : actual.mergeIndexedEvidencePlansRust(input), async () => { result = await review(); });
        } else result = await review();
      });
      const accepted = mode === 'verified-support';
      expect(rankFollowup).toHaveBeenCalledOnce();
      expect(getEntriesByFilePaths.mock.calls.flatMap(([requested]) => requested)).toEqual([RELEVANT, OTHER, ...ranked.flat()]);
      if (mode === 'current-read-failure') expect(sourceReader).toHaveBeenCalledWith(HIDDEN, expect.any(AbortSignal));
      if (regresses) {
        const rankedEvidence = result.dossier.evidence.find(item => item.path === HIDDEN);
        expect(rankedEvidence).toBeDefined();
        expect(rankedEvidence?.queryIndexes ?? []).toEqual([]);
      }
      if (mode === 'regresses-recovered-support') expect(result.diagnostics.stageTrace?.selectionAndFollowup?.currentFacetPassages).toBe(2);
      else expect(result.diagnostics.stageTrace?.selectionAndFollowup?.currentFacetScan).toBeUndefined();
      if (accepted) expect(result.dossier.searchPlan?.facets.slice(1).map(f => f.terms)).toEqual([['copper'], ['quartz']]);
      else expect(result.dossier.searchPlan).toEqual(COMPARISON_SEARCH_PLAN);
      expect(result.dossier.answerPlan).toMatchObject({
        requiredFacetIds: ['subject-0', 'subject-1'], missingFacetIds: [], synthesisRequired: true,
        facets: (accepted ? [HIDDEN, right] : [RELEVANT, OTHER]).map(path => ({ status: 'supported', sourceIds: [`${path}#L1-L1`] })),
      });
    },
  );

  it('앞선 discovery 페이지가 모두 검토 상태여도 다음 페이지의 미검토 경로를 조사한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const dead = Array.from({ length: 96 }, (_, index) => `Synthetic/Dead-${index}.md`);
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT, OTHER, ...dead],
      deferAnswer: true,
      discoveryCandidates: [
        ...dead.map((path, index) => ({
          path,
          score: 1,
          source: 'bm25' as const,
          rank: index + 1,
        })),
        { path: HIDDEN, score: 0.5, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER, ...dead, HIDDEN],
    }));
    expect(result.diagnostics.counts.discoveryInspectedDocuments).toBe(1);
    expect(result.evidence.some((item) => item.path === HIDDEN)).toBe(true);
  });

  it('추가 검토에도 로컬 질의 변형을 넘겨 변형으로만 일치한 discovery 경로를 검증한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      question: '쿼츠 냉각 주기',
      queryVariants: ['Quartz cooling cycles'],
      indexedPaths: [RELEVANT, OTHER],
      deferAnswer: true,
      discoveryCandidates: [
        { path: HIDDEN, score: 0.5, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER, HIDDEN],
    }));
    expect(result.evidence.some((item) => item.path === HIDDEN)).toBe(true);
  });

  it('허용 경로 재조회가 끝나지 않아도 중단하면 추가 검토를 기다리지 않는다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const controller = new AbortController();
    let calls = 0;
    const run = reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT, OTHER],
      deferAnswer: true,
      signal: controller.signal,
      provider: scriptedAnswerProvider(['{"queries":[],"enumerate":false}']).provider,
      discoveryCandidates: [
        { path: HIDDEN, score: 1, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER, HIDDEN],
      getFollowupPaths: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve([RELEVANT, OTHER, HIDDEN])
          : new Promise<readonly string[]>(() => {});
      },
    }));
    await vi.waitFor(() => expect(calls).toBe(2));
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('discovery 추가 검토에 원래 후보와 비교 facet 귀속을 함께 넘긴다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) =>
      input.documents.length > 0 && input.documents.every((document) => document.path === HIDDEN)
        ? hiddenPlan()
        : comparisonEvidencePlan(),
    );
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const hiddenCandidate = {
      path: HIDDEN,
      score: 0.5,
      source: 'vector' as const,
      rank: 97,
      queryIndex: 2,
      startLine: 1,
      endLine: 1,
    };
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT, OTHER],
      deferAnswer: true,
      searchPlan: COMPARISON_SEARCH_PLAN,
      candidates: [
        { path: RELEVANT, score: 2, source: 'bm25', rank: 1, queryIndex: 1 },
        { path: OTHER, score: 1, source: 'bm25', rank: 2, queryIndex: 2 },
      ],
      discoveryCandidates: [
        { path: RELEVANT, score: 2, source: 'bm25', rank: 1, queryIndex: 1 },
        { path: OTHER, score: 1, source: 'bm25', rank: 2, queryIndex: 2 },
        hiddenCandidate,
      ],
      discoveryPaths: [RELEVANT, OTHER, HIDDEN],
    }));
    expect(result.evidence.find((item) => item.path === HIDDEN)?.queryIndexes).toEqual([2]);
    const inspectionCall = vi
      .mocked(planIndexedEvidenceRust)
      .mock.calls.find(
        ([input]) =>
          input.documents.length > 0 &&
          input.documents.every((document) => document.path === HIDDEN),
      );
    expect(inspectionCall?.[0].candidates).toEqual([
      expect.objectContaining({ path: HIDDEN, queryIndex: 2 }),
    ]);
  });

  it('discovery 추가 검토가 넓힌 범위를 total·완료 진행·안내에 반영한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const progress: { phase: string; totalFiles: number }[] = [];
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT],
      exhaustiveReview: true,
      deferAnswer: true,
      onProgress: (item) => progress.push({ phase: item.phase, totalFiles: item.totalFiles }),
      discoveryCandidates: [
        { path: HIDDEN, score: 0.5, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER, HIDDEN],
    }));
    expect(result.processedFiles).toBe(2);
    expect(result.totalFiles).toBe(2);
    expect(result.coverageNotice).toContain('검토 범위 문서 2개');
    expect(progress.filter((item) => item.phase === 'complete').at(-1)?.totalFiles).toBe(2);
  });

  it('원문 변경 복구 후보는 보존하되 부족 facet을 입증하지 못한 새 구절에는 옛 귀속을 붙이지 않는다', async () => {
    const revisedHidden = 'Quartz cooling cycles now require a fourth cycle.';
    const initialPlan = comparisonEvidencePlan();
    const first = initialPlan.evidence[0];
    if (!first) throw new Error('comparison fixture missing');
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) => {
      if (
        input.documents.length > 0 &&
        input.documents.every((document) => document.path === HIDDEN)
      ) {
        const plan = hiddenPlan();
        const quote = (input.documents[0]?.text ?? '').includes('fourth')
          ? revisedHidden
          : 'Quartz cooling cycles increase in winter.';
        const hasFacet =
          input.candidates?.some(
            (candidate) => candidate.path === HIDDEN && candidate.queryIndex === 2,
          ) === true;
        return {
          ...plan,
          evidence: [
            {
              ...plan.evidence[0],
              quote,
              revision: input.documents[0].revision ?? null,
              queryIndexes: hasFacet ? [2] : [],
            },
          ],
        };
      }
      return { ...initialPlan, evidence: [{ ...first, queryIndexes: [1] }] };
    });
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation((input) => {
      const template = verifiedStatuses(input).statuses[0];
      const currentSource = input.documents.some((document) => document.revision === '2:20');
      return {
        statuses: input.evidence.map((item) => ({
          ...template,
          sourceId: item.sourceId,
          path: item.path,
          status:
            currentSource && item.quote.includes('increase in winter')
              ? ('quote-missing' as const)
              : ('verified' as const),
        })),
      };
    });
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT],
      deferAnswer: true,
      searchPlan: COMPARISON_SEARCH_PLAN,
      candidates: [{ path: RELEVANT, score: 2, source: 'bm25', rank: 1, queryIndex: 1 }],
      discoveryCandidates: [
        {
          path: HIDDEN,
          score: 0.5,
          source: 'vector',
          rank: 97,
          queryIndex: 2,
          startLine: 1,
          endLine: 1,
        },
      ],
      discoveryPaths: [RELEVANT, HIDDEN],
      sourceReader: (path) =>
        Promise.resolve(
          path === HIDDEN
            ? { revision: '2:20', text: revisedHidden }
            : {
                revision: '1:10',
                text: 'Quartz restarts only after two cooling cycles.',
                contentHash: 'hash-relevant',
              },
        ),
    }));
    expect(result.evidence.find((item) => item.path === HIDDEN)).toMatchObject({ queryIndexes: [], contentHash: createContentHashRust(revisedHidden) });
    const recoveryCall = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0];
    expect(recoveryCall?.documents.some((document) => document.revision === '2:20')).toBe(true);
    expect(recoveryCall?.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: HIDDEN, queryIndex: 2 })]),
    );
    expect(
      result.dossier.answerPlan?.facets.find((facet) => facet.id === 'subject-1')?.status,
    ).toBe('missing');
  });

  it('원문 변경 복구가 기존 검증 근거를 고정 상한으로 자르지 않는다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const basePaths = Array.from({ length: 24 }, (_, index) => `Synthetic/Base-${index}.md`);
    const extraPaths = Array.from({ length: 8 }, (_, index) => `Synthetic/Extra-${index}.md`);
    const allPaths = [...basePaths, ...extraPaths];
    const texts = new Map(
      allPaths.map((path) => [path, `Quartz cooling cycles variant ${path.slice(-6)}.`]),
    );
    const records = allPaths.map((path) => ({
      filePath: path,
      contentHash: `hash-${path}`,
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    }));
    const entries = allPaths.map((path) => ({
      id: `chunk-${path}`,
      vector: [],
      metadata: {
        filePath: path,
        startLine: 1,
        endLine: 1,
        text: texts.get(path) ?? '',
        contentHash: `hash-${path}`,
      },
    }));
    const result = await reviewIndexedVault(reviewOptions({
      corpus: {
        getEntriesByFilePaths: (paths) =>
          Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
        getFileIndexRecords: () => Promise.resolve(records),
      },
      indexedPaths: basePaths,
      candidates: basePaths.map((path, index) => ({
        path,
        score: 1,
        source: 'bm25' as const,
        rank: index + 1,
      })),
      discoveryCandidates: [
        ...basePaths.map((path, index) => ({
          path,
          score: 1,
          source: 'bm25' as const,
          rank: index + 1,
        })),
        ...extraPaths.map((path, index) => ({
          path,
          score: 0.5,
          source: 'bm25' as const,
          rank: 97 + index,
        })),
      ],
      discoveryPaths: allPaths,
      deferAnswer: true,
      sourceReader: (path) =>
        Promise.resolve(
          path === extraPaths[0]
            ? {
                revision: '2:20',
                text: 'Quartz cooling cycles updated fourth cycle.',
                contentHash: 'hash-updated',
              }
            : {
                revision: '1:10',
                text: texts.get(path) ?? '',
                contentHash: `hash-${path}`,
              },
        ),
    }));
    expect(result.evidence.length).toBeGreaterThan(24);
    expect(result.evidence.filter((item) => extraPaths.includes(item.path)).length).toBe(8);
  });

  it('discovery 허용 범위 밖 경로는 추가 검토로 승격하지 않는다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const result = await reviewIndexedVault(reviewOptions({
      corpus: corpusWithDiscoverableDocument(),
      indexedPaths: [RELEVANT, OTHER],
      deferAnswer: true,
      discoveryCandidates: [
        { path: HIDDEN, score: 1, source: 'bm25', rank: 97, startLine: 1, endLine: 1 },
      ],
      discoveryPaths: [RELEVANT, OTHER],
    }));
    expect(result.diagnostics.counts.discoveryInspectedDocuments).toBeUndefined();
    expect(result.evidence.some((item) => item.path === HIDDEN)).toBe(false);
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
      expect(payload).toEqual(JSON.parse(JSON.stringify(toModelIndexedEvidenceDossier(result.dossier))));
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
      ...JSON.parse(JSON.stringify(toModelIndexedEvidenceDossier(result.dossier))),
      matchInventory: [{ query: 'quartz', totalDocuments: 12, totalChunks: 20,
        totalOccurrences: 34 }],
      coverage: {
        documentScope: result.coverage.documentScope,
        status: result.coverage.status,
        reviewedDocuments: result.coverage.reviewedDocuments,
        unreviewedDocuments: result.coverage.unreviewedDocuments,
        notIndexedDocuments: result.coverage.notIndexedDocuments,
      },
    });
  });

  it('큰 집계 원장은 결과에 보존하고 집계 요약과 검증 원문으로 답변을 생성한다', async () => {
    const { provider, calls } = answerProvider();
    const budget = planModelContextRust({});
    if (!budget) throw new Error('모델 예산 계약을 초기화하지 못했습니다.');
    const documents = Array.from({ length: 5_000 }, (_, index) => ({
      sourcePath: `synthetic/${index}-${'x'.repeat(100)}.md`,
      occurrences: 1,
    }));
    const result = await reviewIndexedVault(reviewOptions({
      provider: { ...provider, contextBudget: { ...budget, inputBytes: 50_000 } },
      matchInventory: [{ query: 'quartz', totalDocuments: 5_000, totalChunks: 5_000,
        totalOccurrences: 5_000, documents }],
    }));
    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe('answered');
    expect(result.dossier.matchInventory?.[0]?.documents).toHaveLength(5_000);
    const payload = JSON.parse(String(calls[0]?.[1]?.content)) as {
      matchInventory: { totalDocuments: number; documents?: unknown[] }[];
      evidence: unknown[];
    };
    expect(payload.matchInventory[0]?.totalDocuments).toBe(5_000);
    expect(payload.matchInventory[0]?.documents).toBeUndefined();
    expect(payload.evidence).toEqual(JSON.parse(JSON.stringify(toModelIndexedEvidenceDossier(result.dossier).evidence)));
  });

  it('입력 예산을 넘으면 모델을 호출하지 않고 evidence-only를 반환한다', async () => {
    const { provider, calls } = answerProvider();
    const budget = planModelContextRust({});
    if (!budget) throw new Error('모델 예산 계약을 초기화하지 못했습니다.');
    const contextBudget = { ...budget, inputBytes: 1 };
    const result = await reviewIndexedVault(
      reviewOptions({ provider: { ...provider, contextBudget } }),
    );
    expect(result.diagnostics.stageTrace?.generationAndCorrection).toMatchObject({ requests: 0, sentPassages: 0, inputByteLimit: 1, preparationFailed: true });
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
    vi.mocked(planIndexedEvidenceRust).mockClear().mockReturnValue(planFixture());
    vi.mocked(verifyIndexedEvidenceRust).mockClear().mockReturnValue(verificationFixture());
  });

  it('비교 답변의 missing facet은 같은 모델로 정확히 한 번 교정한 뒤 채택한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const answerPlan = comparisonAnswerPlan();
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReset();
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(answerPlan);
    vi.mocked(validateIndexedReviewAnswerRust).mockReset();
    const { provider, calls } = scriptedAnswerProvider([
      JSON.stringify({ paragraphs: [{ text: '왼쪽 근거만 다룬 답변', supports: ['F1.S1'] }] }),
      JSON.stringify({ paragraphs: [{ text: '종합한 비교 답변', supports: ['F1.S1', 'F2.S2'] }] }),
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

  it('생성과 교정 모두 비교의 legacy source ID 응답을 Rust에 넘기지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(comparisonAnswerPlan());
    const validate = vi.mocked(validateIndexedReviewAnswerRust).mockReset();
    const legacy = JSON.stringify({ paragraphs: [{
      text: 'Synthetic legacy comparison.',
      sources: [SOURCE_ID, OTHER_SOURCE_ID],
      covers: ['subject-0', 'subject-1'],
    }] });
    const { provider, calls } = scriptedAnswerProvider([legacy, `Synthetic intro.\n${legacy}\nSynthetic outro.`]);
    const result = await reviewIndexedVault(reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }));

    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedBoundCorrection', { reason: 'paragraph-1:mixed-or-missing-supports', facets: '-' }),
    });
    expect(validate.mock.calls.map(([input]) => input.response)).toEqual(['', '']);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(result.outcome).toBe('evidence-only');
    expect(result.content).not.toContain('Synthetic legacy comparison.');
  });

  it('형식 실패의 고정 코드를 원문 없이 교정 요청에 전달하고 한 번만 재시도한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(comparisonEvidencePlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    vi.mocked(planIndexedReviewAnswerPlanRust).mockReturnValue(comparisonAnswerPlan());
    vi.mocked(validateIndexedReviewAnswerRust).mockReturnValue({
      valid: false,
      reason: 'invalid-format',
      missingFacetIds: [],
      formatIssue: 'invalid-covers',
      fieldIssue: 'duplicate-id',
    });
    const { provider, calls } = scriptedAnswerProvider(['{"paragraphs":[]}']);
    const result = await reviewIndexedVault(
      reviewOptions({ provider, searchPlan: COMPARISON_SEARCH_PLAN }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedBoundCorrection', {
        reason: 'invalid-format:invalid-covers:duplicate-id',
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
    vi.mocked(validateIndexedReviewAnswerRust).mockReset();
    const { provider, calls } = scriptedAnswerProvider([
      JSON.stringify({ paragraphs: [{ text: 'Synthetic Alpha만 확인했습니다.', supports: ['F1.S1'] }] }),
    ]);
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
      paragraphContract: {
        supportChoices: [{ key: 'F1.S1', sourceId: SOURCE_ID, facetId: 'subject-0' }],
        supplementalChoices: [{ key: 'S2', sourceId: OTHER_SOURCE_ID, facetId: null }],
        allowedSourcesByFacet: { 'subject-0': [SOURCE_ID] },
        example: { paragraphs: [{ text: '…', supports: ['F1.S1'] }] },
      },
      evidence: [
        { sourceId: SOURCE_ID, facetIds: ['subject-0'] },
        { sourceId: OTHER_SOURCE_ID, facetIds: [] },
      ],
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

  it('현재 file hash가 색인 hash와 달라도 현재 구절 검증을 통과하면 현재 revision·hash로 갱신한다', async () => {
    const verify = vi.mocked(verifyIndexedEvidenceRust);
    verify.mockReset();
    verify.mockImplementation(verifiedStatuses);
    const indexed = planFixture();
    const first = indexed.evidence[0];
    if (!first) throw new Error('plan fixture without evidence');
    vi.mocked(planIndexedEvidenceRust).mockReturnValueOnce({
      ...indexed,
      evidence: [{ ...first, contentHash: 'hash-indexed' }],
    });
    const { provider } = answerProvider();
    const currentText =
      '첫 줄\n둘째 줄\nQuartz restarts only after two cooling cycles.\n넷째 줄';

    const result = await reviewIndexedVault(
      reviewOptions({
        indexedPaths: [RELEVANT],
        provider,
        sourceReader: () =>
          Promise.resolve({
            revision: '1:10',
            text: currentText,
            contentHash: 'hash-current',
          }),
      }),
    );

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      revision: '1:10',
      contentHash: 'hash-current',
    });
  });

  it.each(['일반', '주소 교정', '재선택 복구'])('hash 없는 현재 원문의 %s 근거에는 현재 전체 본문 hash만 남긴다', async (mode) => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const initial = planFixture();
    const original = { ...initial.evidence[0], endLine: 3, sourceId: `${RELEVANT}#L3-L3` };
    const revision = mode === '일반' ? '1:10' : '2:20';
    const line = mode === '일반' ? 3 : 5;
    const quote = mode === '재선택 복구' ? 'Quartz now requires three cooling cycles.' : original.quote;
    const text = '\n'.repeat(line - 1) + quote + '\nCurrent footer';
    const id = `${RELEVANT}#L${line}-L${line}`;
    const planner = vi.mocked(planIndexedEvidenceRust).mockReset()
      .mockReturnValueOnce({ ...initial, evidence: [original] })
      .mockReturnValue({ ...initial, evidence: [{ ...original, sourceId: id, startLine: line, endLine: line,
        revision, quote, contentHash: 'obsolete-recovery-hash' }] });
    const result = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], deferAnswer: true,
      sourceReader: () => Promise.resolve({ revision, text }),
    }));
    expect(planner).toHaveBeenCalledTimes(mode === '재선택 복구' ? 2 : 1);
    expect(result.citations).toMatchObject([{ id, line, preview: quote, status: 'verified' }]);
    expect(result.dossier.evidence).toMatchObject([{ sourceId: id, revision, quote, contentHash: actual.createContentHashRust(text) }]);
  });

  it('현재 hash를 계산하지 못하면 과거 hash나 revision만으로 복구·인용하지 않는다', async () => {
    vi.mocked(createContentHashRust).mockReturnValueOnce(null);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], provider,
      sourceReader: () => Promise.resolve({ revision: '1:10', text: '\n\n' + planFixture().evidence[0].quote }),
    }));
    expect(result.coverage.unreviewedPaths).toContain(RELEVANT);
    expect(result.dossier.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('청크에만 있는 구절은 재선택 뒤에도 현재 원문 증거가 아니다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({ ...plan, evidence: plan.evidence.map(item => ({ ...item, endLine: 3 })) });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider,
      sourceReader: () => Promise.resolve({ revision: '1:10', text: 'Different source.',
        chunks: [{ text: planFixture().evidence[0].quote, startLine: 3, endLine: 4 }],
      }),
    }));
    expect(calls).toHaveLength(0);
    expect(result.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
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
    const initial = twoDocumentPlan();
    plan.mockReturnValueOnce(initial).mockReturnValue({ ...initial, evidence: initial.evidence.map(item => ({ ...item, revision: '1:11' })) });
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
      const sourceId = `${RELEVANT}#L81-L81`;
      const { provider, calls } = scriptedAnswerProvider([JSON.stringify({ paragraphs: [{ text: 'Synthetic.', sources: [sourceId] }] })]);
      const result = await reviewIndexedVault(
        reviewOptions({
          provider,
          sourceReader: () =>
            Promise.resolve({
              revision: '1:11',
              text: '\n'.repeat(80) + original.quote,
              chunks: [{ text: original.quote, startLine: 81, endLine: 81 }],
            }),
        }),
      );
      if (accept) {
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({
          ...original, sourceId,
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
        sourceReader: () => Promise.resolve({ revision: '1:11', text: '\n'.repeat(80) + item.quote, chunks }),
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
    expect(verify.mock.calls.at(-1)?.[0].documents).toMatchObject([{ text: '\n'.repeat(3) + item.quote, startLine: 78 }]);
    expect(result.evidence).toEqual([{ ...recovered, contentHash: createContentHashRust('\n'.repeat(80) + item.quote) }]);
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
    expect(result.diagnostics.stageTrace?.generationAndCorrection).toMatchObject({ requests: 2, validationFailures: ['invalid-format', 'invalid-format'] });
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

it('engine-only dossier는 deferAnswer와 별개로 후속·답변 모델을 0회로 유지한다', async () => {
  const streamChat = vi.fn<LLMProvider['streamChat']>(() => Promise.reject(new Error('synthetic-sensitive-provider-error')));
  const result = await reviewIndexedVault(reviewOptions({ executionMode: 'engine-only',
    discoveryPaths: [RELEVANT, OTHER], discoveryCandidates: [{ path: RELEVANT, score: 1, rank: 1, source: 'bm25' }],
    getFollowupPaths: () => Promise.resolve([RELEVANT, OTHER]), provider: { streamChat },
  }));
  expect(streamChat).not.toHaveBeenCalled();
  expect(result.outcome).toBe('evidence-only');
  expect(result.dossier.evidence.length).toBeGreaterThan(0);
  expect(result.providerTransfer.sentFiles).toBe(0);
});

it('현재 큰 셀 원장은 dossier에 보존하지만 어떤 모델 요청에도 복제하지 않는다', async () => {
  const { provider, calls } = answerProvider();
  const marker = 'synthetic-cell-ledger-private-marker';
  const cells = Array.from({ length: 1000 }, (_, index) => ({ address: `A${index + 1}`, value: marker }));
  const sourceMetadata = { segments: [{ label: 'Table', startLine: 3, endLine: 4, locator: { cells } }] };
  const result = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], provider,
    sourceReader: () => Promise.resolve({ revision: '1:10', contentHash: 'hash-relevant',
      text: 'one\ntwo\nQuartz restarts only after two cooling cycles.\nfour', sourceMetadata }),
  }));
  expect(result.dossier.sourceDocuments?.[RELEVANT]).toEqual(sourceMetadata);
  expect(calls.length).toBeGreaterThan(0);
  expect(JSON.stringify(calls)).not.toContain(marker);
  expect(JSON.stringify(calls)).not.toContain('sourceDocuments');
});

it('현재 청크가 verifier 입력 한도를 넘어도 선택 인용을 검증하며 실패한 형제 구절만 제외한다', async () => {
  const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
  vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
  const plan = planFixture();
  const first = { ...plan.evidence[0], endLine: 3 };
  const rejected = { ...first, sourceId: `${RELEVANT}#L10-L10`, startLine: 10, endLine: 10, quote: 'Removed synthetic condition.' };
  const base = corpusFixture();
  const corpus: IndexedVaultCorpus = {
    getFileIndexRecords: () => Promise.resolve([{ filePath: RELEVANT, contentHash: 'hash-relevant', sourceMtime: 1, sourceSize: 10, vectorCount: 2, updated: 1 }]),
    getEntriesByFilePaths: async (paths) => [...await base.getEntriesByFilePaths(paths), { id: 'synthetic-removed', vector: [], metadata: { filePath: RELEVANT, startLine: 10, endLine: 10, text: rejected.quote, contentHash: 'hash-relevant' } }],
  };
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValueOnce({ ...plan, evidence: [first, rejected], order: [first.sourceId, rejected.sourceId] }).mockReturnValue(null);
  const chunks = [{ text: first.quote, startLine: 3, endLine: 3 }, ...Array.from({ length: 9 }, (_, index) => ({ text: 'x'.repeat(1024 * 1024), startLine: 100 + index, endLine: 100 + index }))];
  const run = await reviewIndexedVault(reviewOptions({ corpus, indexedPaths: [RELEVANT],
    executionMode: 'engine-only', sourceReader: () => Promise.resolve({ revision: '1:10', text: `a\nb\n${first.quote}`, contentHash: 'hash-current', chunks }),
  }));
  expect(run.evidence.map((item) => item.sourceId)).toEqual([first.sourceId]);
  expect(run.citations).toMatchObject([{ id: first.sourceId, line: 3, status: 'verified' }]);
  expect(run.coverage.status).toBe('incomplete');
});

it('교정 진행 중 source epoch가 무효화되면 이전 근거를 재전송하거나 게시하지 않는다', async () => {
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValue(planFixture());
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(verifiedStatuses);
  let current = true;
  const onAnswer = vi.fn();
  const { calls, provider } = scriptedAnswerProvider(['not json']);
  const run = await reviewIndexedVault(reviewOptions({ provider, onAnswer, isCurrent: () => current,
    onProgress: ({ phase }) => { if (phase === 'repair') current = false; },
  }));
  expect(calls).toHaveLength(1);
  expect(onAnswer).not.toHaveBeenCalled();
  expect(run.outcome).toBe('indexing');
  expect(run.dossier.evidence).toEqual([]);
});

it('최종 해석에는 현재 검증한 구절만 보내고 미검증 색인 문맥을 복제하지 않는다', async () => {
  const { provider, calls } = answerProvider();
  const plan = planFixture();
  const marker = 'synthetic unverified neighboring context';
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(verifiedStatuses);
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValue({ ...plan, evidence: plan.evidence.map((item) => ({ ...item, contextBefore: marker, contextAfter: marker })) });
  const quote = plan.evidence[0].quote;
  const run = await reviewIndexedVault(reviewOptions({ provider, sourceReader: () => Promise.resolve({ revision: '1:10', text: `a\nb\n${quote}\nd`, contentHash: 'hash-current' }) }));
  expect(run.outcome).toBe('answered');
  expect(JSON.stringify(calls)).not.toContain(marker);
  expect(JSON.stringify(calls)).toContain(quote);
});

it('literal receipt가 최종 전달 전에 바뀌면 모델 요청과 이전 dossier를 폐기한다', async () => {
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValue(planFixture());
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(verifiedStatuses);
  const { provider, calls } = answerProvider();
  const onAnswer = vi.fn();
  const close = vi.fn(() => Promise.resolve());
  const summary = { matchMode: 'nfkc-unicode-lower-line-substring-v1' as const, generationId: 'synthetic', receipt: { version: 1 as const, incarnation: crypto.randomUUID(), mutation: crypto.randomUUID() }, sources: 2, needles: [], pageCount: 0 };
  const getSummary = vi.fn().mockResolvedValueOnce(summary).mockRejectedValue(new Error('synthetic receipt invalidation'));
  const result = await reviewIndexedVault(reviewOptions({ provider, onAnswer, openLiteralInventory: () => Promise.resolve({ getSummary, readPage: () => Promise.resolve(null), close }) }));
  expect(calls).toHaveLength(0);
  expect(onAnswer).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(result.outcome).toBe('indexing');
  expect(result.dossier.evidence).toEqual([]);
});

it('legacy overlap 청크의 행이 틀려도 재색인 없이 현재 원문의 주소로 최종 인용한다', async () => {
  const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
  vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
  vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
  const quote = 'Quartz restarts only after two cooling cycles.';
  const text = `# Cooling\n${quote}\n\n# Next`;
  const run = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], executionMode: 'engine-only',
    sourceReader: () => Promise.resolve({ revision: '1:10', text, chunks: [{ text: quote, startLine: 2, endLine: 2 }] }),
  }));
  expect(run.evidence).toMatchObject([{ quote, startLine: 2, endLine: 2 }]);
  expect(run.citations).toMatchObject([{ filePath: RELEVANT, id: `${RELEVANT}#L2-L2`, line: 2, endLine: 2, preview: quote }]);
});


it('현재 검증에서 탈락한 비교 facet의 미검토 단서를 순위가 높은 이미 지원된 쪽보다 먼저 조사한다', async () => {
  const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(actual.verifyIndexedEvidenceRust);
  vi.mocked(planIndexedEvidenceRust).mockReset().mockImplementation(input => input.documents.some(d => d.path === HIDDEN) ? hiddenPlan() : { ...comparisonEvidencePlan(), evidence: comparisonEvidencePlan().evidence.map(item => ({ ...item, endLine: item.startLine })) });
  vi.mocked(planIndexedReviewAnswerPlanRust).mockReset().mockImplementation(actual.planIndexedReviewAnswerPlanRust);
  const corpus = corpusWithDiscoverableDocument();
  const filler = Array.from({ length: 98 }, (_, i) => `Synthetic/a${i}.md`);
  const sourceReader = vi.fn((path: string) => Promise.resolve({ revision: '1:10', text: path === RELEVANT ? `x
y
${planFixture().evidence[0].quote}` : path === HIDDEN ? hiddenPlan().evidence[0].quote : null }));
  const searchPlan = { ...COMPARISON_SEARCH_PLAN, facets: COMPARISON_SEARCH_PLAN.facets.map(f => f.queryIndex === 2 ? { ...f, query: 'winter cooling', terms: ['winter', 'cooling'] } : f) };
  const result = await reviewIndexedVault(reviewOptions({ corpus, sourceReader, executionMode: 'engine-only', searchPlan,
    discoveryPaths: [RELEVANT, OTHER, ...filler, HIDDEN],
    discoveryCandidates: [...filler, HIDDEN].map((path, i) => ({ path, source: 'bm25', score: 200-i, rank: i+1, queryIndex: path === HIDDEN ? 2 : 1 })),
  }));
  expect(result.evidence.map(e => e.path)).toContain(HIDDEN);
  const inspection = vi.mocked(planIndexedEvidenceRust).mock.calls.map(([input]) => input).find(input => input.documents.some(d => d.path === HIDDEN));
  expect(inspection).toMatchObject({ question: 'winter cooling', queryVariants: ['winter', 'cooling'] });
  expect(inspection?.candidates).toBeUndefined();
  expect(sourceReader.mock.calls.filter(([p]) => p === RELEVANT)).toHaveLength(2);
  expect(sourceReader.mock.calls.filter(([p]) => p === OTHER)).toHaveLength(2);
  expect(result.dossier.answerPlan?.missingFacetIds).toEqual([]);
  expect(result.diagnostics.stageTrace).toMatchObject({ selectionAndFollowup: { missingBeforeInspection: [2] }, currentSource: { failures: { 'body-unavailable': 1 } }, dossier: { facetSourceCounts: [1, 1] } });
  expect(result.diagnostics.counts.discoveryInspectedDocuments).toBeLessThanOrEqual(8);
});

it.each(['shared-chunk', 'next-chunk', 'different-segment', 'wrong-chunk'] as const)('인접 조건은 현재 원문의 확인된 행만 별도 인용한다 (%s)', async (mode) => {
  const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(actual.verifyIndexedEvidenceRust);
  const plan = planFixture();
  const anchor = { ...plan.evidence[0], startLine: 3, endLine: 3, sourceId: `${RELEVANT}#L3-L3`, contextAfter: 'private stale context' };
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValue({ ...plan, evidence: [anchor], order: [anchor.sourceId] });
  const text = `
${anchor.quote}
${anchor.quote}
Except during frost.`;
  const chunks = mode === 'shared-chunk' ? [{ startLine: 1, endLine: 4, text }] : [
    { startLine: 3, endLine: 3, text: anchor.quote },
    { startLine: 4, endLine: 4, text: mode === 'wrong-chunk' ? 'different' : 'Except during frost.' },
  ];
  const segments = mode === 'different-segment' ? [{ startLine: 0, endLine: 2, label: 'a' }, { startLine: 3, endLine: 3, label: 'b' }] : [];
  const result = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], executionMode: 'engine-only', sourceReader: () => Promise.resolve({ revision: '1:10', text, chunks, sourceMetadata: { segments } }) }));
  const accepted = mode === 'shared-chunk' || mode === 'next-chunk';
  expect(result.evidence.map(e => e.quote)).toEqual(accepted ? [anchor.quote, 'Except during frost.'] : [anchor.quote]);
  if (accepted) expect(result.citations).toContainEqual(expect.objectContaining({ line: 4, endLine: 4, preview: 'Except during frost.', status: 'verified' }));
  if (mode === 'wrong-chunk') expect(result.diagnostics.stageTrace?.currentSource?.adjacentRejected).toMatchObject({ 'chunk-boundary': 1 });
  if (mode === 'different-segment') expect(result.diagnostics.stageTrace?.currentSource?.adjacentRejected).toMatchObject({ 'segment-boundary': 1 });
  expect(JSON.stringify(toModelIndexedEvidenceDossier(result.dossier))).not.toContain('private stale context');
  expect(JSON.stringify(result.diagnostics.stageTrace)).not.toMatch(/Synthetic|frost|Quartz|.md/);
  expect(result.diagnostics.stageTrace).toMatchObject({ currentSource: { adjacentVerified: Number(accepted) }, dossier: { passages: 1 + Number(accepted) }, generationAndCorrection: { requests: 0 }, displayAndCitations: null });
});

it('선택 인접 행으로 전송 예산을 넘으면 필수 근거와 한 번의 생성 예산을 보존한다', async () => {
  const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
  vi.mocked(verifyIndexedEvidenceRust).mockReset().mockImplementation(actual.verifyIndexedEvidenceRust);
  const plan = planFixture();
  const anchor = { ...plan.evidence[0], endLine: 3, sourceId: `${RELEVANT}#L3-L3` };
  vi.mocked(planIndexedEvidenceRust).mockReset().mockReturnValue({ ...plan, evidence: [anchor], order: [anchor.sourceId] });
  const { provider, calls } = scriptedAnswerProvider([JSON.stringify({ paragraphs: [{ text: 'Synthetic.', sources: [anchor.sourceId] }] })]);
  const run = (line: string, inputBytes: number) => {
    const text = `\n\n${anchor.quote}\n${line}`;
    return reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], provider: { ...provider, contextBudget: { ...planModelContextRust({})!, inputBytes } },
      sourceReader: () => Promise.resolve({ revision: '1:10', text, chunks: [{ startLine: 1, endLine: 4, text }] }),
    }));
  };
  const base = await run('', 32_768);
  const neighbor = 'Synthetic adjacent context. '.repeat(100);
  const result = await run(neighbor, base.diagnostics.stageTrace!.generationAndCorrection!.preparedBytes! + 64);
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1])).not.toContain(neighbor);
  expect(result.outcome).toBe('answered');
  expect(result.evidence.map(item => item.sourceId)).toEqual([anchor.sourceId]);
  expect(result.diagnostics.stageTrace).toMatchObject({ currentSource: { adjacentVerified: 1 }, dossier: { passages: 1 }, generationAndCorrection: { sentPassages: 1, citedPositions: [0] } });
});

it('발견 후보가 비면 후속 계획·경로 심사에서 전 볼트 범위를 다시 열거하지 않는다', async () => {
  const getFollowupPaths = vi.fn(() => Promise.resolve([RELEVANT]));
  const { provider, calls } = answerProvider();
  const result = await reviewIndexedVault(reviewOptions({ indexedPaths: [RELEVANT], discoveryCandidates: [],
    discoveryPaths: [RELEVANT], getFollowupPaths, provider, deferAnswer: true }));
  expect(getFollowupPaths).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  expect(result.dossier.followup?.status).toBe('skipped');
});

it('shares identical model quote text without collapsing independent source addresses or conditions', async () => {
  const { dossier } = await reviewIndexedVault(reviewOptions({ executionMode: 'engine-only' }));
  const a = planFixture().evidence[0], b = { ...a, sourceId: OTHER_SOURCE_ID, path: OTHER };
  const quote = 'Glaze cracks only if frozen.';
  const projected = toModelIndexedEvidenceDossier({ ...dossier, evidence: [{ ...a, quote }, { ...b, quote }] });
  expect(projected.evidence).toMatchObject([{ sourceId: a.sourceId, quote }, { sourceId: b.sourceId, sameQuoteAs: a.sourceId }]);
  expect(JSON.stringify(projected.evidence).split(quote)).toHaveLength(2);
});

it('does not require a comparison-pair wire format for answers with only the question facet', async () => {
  const { provider, calls } = answerProvider();
  const plan: IndexedSearchPlan = { mode:'single', facets:[{kind:'question',id:'question',query:'Quartz cooling',queryIndex:0,terms:['quartz']}] };
  const result = await reviewIndexedVault(reviewOptions({provider, searchPlan:plan}));
  expect(calls[0]?.[0]?.content).toContain(t('llmIndexedReviewAnswer'));
  expect(toModelIndexedEvidenceDossier(result.dossier).paragraphContract).not.toHaveProperty('supportChoices');
  const ids = result.dossier.answerPlan?.facets[0]?.sourceIds;
  expect(ids?.length).toBeGreaterThan(0);
  expect(toModelIndexedEvidenceDossier(result.dossier).paragraphContract).toMatchObject({allowedSourcesByFacet:{question:ids},example:{paragraphs:[{sources:[ids?.[0]],covers:['question']}]}});
});
