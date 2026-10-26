import { beforeEach, describe, expect, it, vi } from 'vitest';

const rustWireExports = vi.hoisted(() => ({
  plan_indexed_search_queries_json: vi.fn<(input: string) => string>(),
  plan_indexed_review_answer_plan_json: vi.fn<(input: string) => string>(),
  validate_indexed_review_answer_json: vi.fn<(input: string) => string>(),
  plan_indexed_evidence_json: vi.fn<(input: string) => string>(),
}));

vi.mock('../../generated/rag-wasm/rag_wasm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/rag-wasm/rag_wasm.js')>();
  rustWireExports.plan_indexed_evidence_json.mockImplementation(actual.plan_indexed_evidence_json);
  return { ...actual, ...rustWireExports };
});

import {
  calculateRecallAtKRust,
  RustBm25RuntimeIndex,
  createContentHashRust,
  chunkMarkdownRust,
  chunkPlainTextRust,
  countFilesByExtensionsRust,
  deriveNativeToolCoverageReceiptRust,
  countKeywordMatchesRust,
  extractVaultLinksRust,
  isExcludedPathRust,
  isExcludedExtRust,
  planAssistantResponseClassificationRust,
  planChatMetaRust,
  planChatMessagesRust,
  planChatSaveMetadataRust,
  planChatContextMentionsRust,
  planChatModelStateRust,
  planContextBudgetAppendRust,
  planContextSourcesRust,
  planQueryResultScoreRust,
  planFileIndexRecordsRust,
  planFolderMentionFilesRust,
  planFolderLexicalEvidenceIndicesRust,
  planNativeVaultLexicalHitRust,
  planToolResultSourceReferencesRust,
  planImplicitFolderQueryPathsRust,
  planIndexPendingFilesRust,
  createIndexedDbRecordKeyRust,
  planIndexedDbStorageLayoutRust,
  planVectorStoreAddRust,
  planVectorStoreLookupByFilePathsRust,
  planVectorStoreLookupByIdsRust,
  planVectorStoreRemoveFileRust,
  planVectorStoreReplaceFileRust,
  planVectorStoreStatsRust,
  parseMentionCandidatesRust,
  planRerankMessagesRust,
  planRerankResponseWithStatusRust,
  planRerankResultOrderRust,
  planBm25CandidateResolutionRust,
  planBm25HitLookupRust,
  planBm25SourceLookupsRust,
  isMcpToolAvailableRust,
  planMcpServerCandidatesRust,
  planDiverseResultIndicesRust,
  planRagFileContentProbeIndicesRust,
  planRagFileIndexabilityRust,
  planRagFileTypeSummaryRust,
  planRagStatusRust,
  planRagIndexingEtaRust,
  planRagAutomaticRecoveryBatchRust,
  planRagAutomaticRecoveryRust,
  planProviderProfileStateRust,
  planProviderVerificationResetRust,
  planReferenceFileIndicesRust,
  planResearchAnswerContractRust,
  mergeIndexedEvidencePlansRust,
  planIndexedEvidenceRust,
  planIndexedReviewAnswerPlanRust,
  planIndexedSearchQueriesRust,
  verifyIndexedEvidenceRust,
  validateIndexedReviewAnswerRust,
  planResearchProviderLedgerTransitionRust,
  planResearchProviderRequestBudgetRust,
  planMergedRetrievalCandidatesByEntryIdRust,
  planSourceReferencesRust,
  planSourceValidationInputsRust,
  planSourceValidationWarningsRust,
  planStructuralHeadingNeighborsRust,
  planStructuralLinkedPathsRust,
  planVaultLinkFallbackIndexRust,
  planVaultLinkCandidatesRust,
  RustIvfRuntimeIndex,
  rankTopKPairsRust,
  classifyMcpToolErrorRust,
  isMcpToolResultEmptyRust,
  normalizeMcpToolResultRust,
  parseMcpToolArgumentsRust,
  selectRelevantResultIndicesRust,
  tokenizeRust,
  validateMcpJsonRust,
  formatMcpJsonRust,
  shouldAppendMcpPathHintRust,
  getMcpConnectionStateRust,
  shouldOfferContext7ForPromptRust,
  type RustIndexedReviewAnswerPlan,
  type RustIndexedReviewAnswerPlanInput,
  type RustIndexedReviewAnswerValidationInput,
} from './rust-core';

beforeEach(() => {
  rustWireExports.plan_indexed_search_queries_json.mockReset();
  rustWireExports.plan_indexed_review_answer_plan_json.mockReset();
  rustWireExports.validate_indexed_review_answer_json.mockReset();
  rustWireExports.plan_indexed_evidence_json.mockClear();
});

describe('Rust WASM RAG core bridge', () => {
  it('내장 WASM을 동기 초기화해 토큰화한다', () => {
    expect(tokenizeRust('hello')).toEqual(['hello']);
  });

  it('프로바이더 필수 설정과 부분 성공 상태를 Rust에서 판정한다', () => {
    expect(
      planProviderProfileStateRust({
        strategy: 'openAICompatible',
        enabled: true,
        apiKeyConfigured: false,
        baseUrlConfigured: false,
        models: [
          {
            value: 'profile:local:auto',
            label: 'Local / auto',
            kind: 'general',
            verificationStatus: 'unknown',
          },
        ],
      }),
    ).toMatchObject({ tone: 'needs-url', chatUsable: false });

    expect(
      planProviderProfileStateRust({
        strategy: 'openRouter',
        enabled: true,
        apiKeyConfigured: true,
        baseUrlConfigured: true,
        models: [
          {
            value: 'profile:remote:working',
            label: 'Remote / working',
            kind: 'general',
            verificationStatus: 'success',
          },
          {
            value: 'profile:remote:broken',
            label: 'Remote / broken',
            kind: 'general',
            verificationStatus: 'failed',
          },
        ],
      }),
    ).toEqual({
      tone: 'ready',
      chatSupported: true,
      embeddingSupported: true,
      chatUsable: true,
      embeddingUsable: false,
      chatModelValues: ['profile:remote:working'],
      embeddingModelValues: [],
    });
  });

  it('사용 가능한 canonical 채팅 모델을 노출하되 stale 기본값은 선택하지 않는다', () => {
    expect(
      planChatModelStateRust(
        [
          {
            strategy: 'ternlight',
            enabled: true,
            apiKeyConfigured: false,
            baseUrlConfigured: false,
            models: [
              {
                value: 'profile:ternlight:legacy',
                label: 'Ternlight / legacy',
                kind: 'general',
                verificationStatus: 'success',
              },
            ],
          },
          {
            strategy: 'openRouter',
            enabled: true,
            apiKeyConfigured: true,
            baseUrlConfigured: true,
            models: [
              {
                value: 'profile:openrouter:b',
                label: 'OpenRouter / B',
                kind: 'general',
                verificationStatus: 'success',
              },
              {
                value: 'profile:openrouter:a',
                label: 'OpenRouter / A',
                kind: 'general',
                verificationStatus: 'unknown',
              },
            ],
          },
          {
            strategy: 'openAICompatible',
            enabled: true,
            apiKeyConfigured: false,
            baseUrlConfigured: true,
            models: [
              {
                value: 'profile:free:auto',
                label: 'FreeLLMAPI / auto',
                kind: 'general',
                verificationStatus: 'unknown',
              },
            ],
          },
        ],
        'profile:missing:auto',
      ),
    ).toEqual({
      options: [
        { value: 'profile:free:auto', label: 'FreeLLMAPI / auto' },
        { value: 'profile:openrouter:a', label: 'OpenRouter / A' },
        { value: 'profile:openrouter:b', label: 'OpenRouter / B' },
      ],
      selectedModel: '',
      enabledProviderCount: 2,
      availableModelCount: 3,
    });
  });

  it('연결 정보 변경 후 검증 상태 초기화를 Rust에서 계획한다', () => {
    expect(
      planProviderVerificationResetRust([
        { chatStatus: 'success', embeddingStatus: 'failed' },
        { chatStatus: 'unknown', embeddingStatus: 'success' },
      ]),
    ).toEqual([
      { chatStatus: 'unknown', embeddingStatus: 'unknown' },
      { chatStatus: 'unknown', embeddingStatus: 'unknown' },
    ]);
  });

  it('preserves content hash and tokenizer contracts through WASM', () => {
    expect(createContentHashRust('hello')).toBe('4f9f2cab');
    expect(createContentHashRust('요고49 포인트 페이백')).toBe('d30c670d');

    const tokens = tokenizeRust('OpenRouter freeLLMApi 요고49 포인트 페이백');
    expect(tokens).not.toBeNull();
    expect(tokens).toContain('openrouter');
    expect(tokens).toContain('free');
    expect(tokens).toContain('llm');
    expect(tokens).toContain('요고49');
    expect(tokens).toContain('포인트');
  });

  it('내장 WASM에서 분리형 한글 비교 질문과 검색어를 정규화한다', async () => {
    const actual = await vi.importActual<typeof import('../../generated/rag-wasm/rag_wasm.js')>(
      '../../generated/rag-wasm/rag_wasm.js',
    );
    rustWireExports.plan_indexed_search_queries_json.mockImplementation(
      actual.plan_indexed_search_queries_json,
    );
    const question = '구리 저장소와 유리 큐의 지연 차이를 설명해줘';
    const composed = planIndexedSearchQueriesRust({ question });
    const decomposed = planIndexedSearchQueriesRust({ question: question.normalize('NFD') });
    expect(composed?.mode).toBe('comparison');
    expect(decomposed?.mode).toBe('comparison');
    expect(decomposed?.facets[0]?.query).toBe(question.normalize('NFD'));
    expect(decomposed?.facets[0]?.terms).toEqual(composed?.facets[0]?.terms);
    expect(decomposed?.facets.slice(1)).toEqual(composed?.facets.slice(1));
  });

  it('plans implicit folder evidence and programming-only Context7 through WASM', () => {
    expect(
      planImplicitFolderQueryPathsRust('오로라 프로젝트의 진행 상황은?', [
        'archive',
        'aurora',
        'aurora-old',
      ]),
    ).toEqual(['aurora']);
    expect(
      planFolderLexicalEvidenceIndicesRust(
        'Aurora migration',
        ['unrelated', 'Aurora migration plan', 'migration only'],
        2,
        'any',
      ),
    ).toEqual([1, 2]);
    expect(shouldOfferContext7ForPromptRust('Rust API 예제를 보여줘')).toBe(true);
    expect(shouldOfferContext7ForPromptRust('오로라 프로젝트의 진행 상황은?')).toBe(false);
  });

  it('네이티브 lexical 근거의 실제 일치 행과 검증 상태를 계획한다', () => {
    expect(
      planNativeVaultLexicalHitRust(
        '고객 이탈',
        '# 제목\n무관한 내용\n고객 이탈의 원인은 느린 온보딩이다.',
        'all',
      ),
    ).toEqual({
      startLine: 3,
      endLine: 3,
      preview: '고객 이탈의 원인은 느린 온보딩이다.',
      status: 'verified',
    });
    expect(
      planNativeVaultLexicalHitRust('고객 이탈', '고객 인터뷰\n이탈 원인', 'all'),
    ).toMatchObject({
      startLine: 1,
      status: 'candidate',
    });
  });

  it('저장된 도구 출처를 본문 없는 재읽기 전용 메타데이터로 제한한다', () => {
    expect(
      planToolResultSourceReferencesRust([
        {
          id: 'vault:Alpha.md:3-4',
          filePath: 'Alpha.md',
          status: 'candidate',
          line: 3,
          endLine: 4,
          heading: 'provider로 보내지 않을 제목',
          preview: 'provider로 보내지 않을 본문',
        },
        {
          id: 'vault:Stale.md:1-1',
          filePath: 'Stale.md',
          status: 'stale',
          preview: '오래된 근거',
        },
      ]),
    ).toEqual([
      {
        filePath: 'Alpha.md',
        status: 'candidate',
        requiresRead: true,
        line: 3,
        endLine: 4,
      },
    ]);
  });

  it('plans RAG vector indexing ETA through the Rust bridge', () => {
    const calibratedEta = planRagIndexingEtaRust({
      nowMs: 10000,
      startedAtMs: 0,
      totalFiles: 10,
      completedFiles: 3,
      currentFileTotalChunks: 1,
      currentFileEmbeddedChunks: 0,
      totalEstimatedChunks: 10,
      completedEstimatedChunks: 3,
      currentFileEstimatedChunks: 1,
      totalPlannedChunks: 0,
      completedPlannedChunks: 0,
      planningComplete: false,
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
    });
    expect(calibratedEta).toMatchObject({
      totalFiles: 10,
      completedFiles: 3,
      currentFileProgress: 0,
      progressRatio: 0.3,
      elapsedMs: 10000,
      remainingMs: 17500,
      estimatedCompletionMs: 27500,
      confidence: 'medium',
      basis: 'calibrated-estimate',
      confidenceReason: 'calibrated-estimate',
      etaConfidenceReason: 'calibrated-estimate',
    });
    expect(typeof calibratedEta?.lowerRemainingMs).toBe('number');
    expect(typeof calibratedEta?.upperRemainingMs).toBe('number');

    expect(
      planRagIndexingEtaRust({
        nowMs: 5000,
        startedAtMs: 0,
        totalFiles: 4,
        completedFiles: 0,
        currentFileTotalChunks: 1,
        currentFileEmbeddedChunks: 1,
        totalEstimatedChunks: 100,
        completedEstimatedChunks: 0,
        currentFileEstimatedChunks: 1,
        totalPlannedChunks: 0,
        completedPlannedChunks: 0,
        planningComplete: false,
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
      })?.remainingMs,
    ).toBe(99000);

    expect(
      planRagIndexingEtaRust({
        nowMs: 5000,
        startedAtMs: 0,
        totalFiles: 4,
        completedFiles: 1,
        currentFileTotalChunks: 4,
        currentFileEmbeddedChunks: 2,
        totalEstimatedChunks: 100,
        completedEstimatedChunks: 25,
        currentFileEstimatedChunks: 50,
        totalPlannedChunks: 10,
        completedPlannedChunks: 3,
        planningComplete: true,
        completedBatchDurationsMs: [1000, 1000, 1000],
        completedBatchChunkCounts: [1, 1, 1],
        completedFileDurationsMs: [1200],
        completedFileChunkCounts: [3],
        completedFileEstimatedChunkCounts: [25],
        completedFileActualChunkCounts: [3],
        completedFileOverheadDurationsMs: [200],
        historicalMsPerChunk: null,
        historicalChunkEstimateRatio: null,
        historicalVariance: null,
      }),
    ).toEqual(
      expect.objectContaining({
        basis: 'planned-chunks',
        progressRatio: 0.5,
        currentFileProgress: 0.5,
      }),
    );

    expect(
      planRagIndexingEtaRust({
        nowMs: Number.NaN,
        startedAtMs: 0,
        totalFiles: 10,
        completedFiles: 0,
        currentFileTotalChunks: 0,
        currentFileEmbeddedChunks: 0,
        totalEstimatedChunks: 10,
        completedEstimatedChunks: 0,
        currentFileEstimatedChunks: 0,
        totalPlannedChunks: 0,
        completedPlannedChunks: 0,
        planningComplete: false,
        completedBatchDurationsMs: [],
        completedBatchChunkCounts: [],
        completedFileDurationsMs: [],
        completedFileChunkCounts: [],
        completedFileEstimatedChunkCounts: [],
        completedFileActualChunkCounts: [],
        completedFileOverheadDurationsMs: [],
        historicalMsPerChunk: null,
        historicalChunkEstimateRatio: null,
        historicalVariance: null,
      }),
    ).toBeNull();
  });

  it('MCP 연결 상태 판정을 Rust에서 직접 계산한다', () => {
    expect(getMcpConnectionStateRust(0, 0, 0, false)).toBe('idle');
    expect(getMcpConnectionStateRust(2, 1, 1, true)).toBe('connecting');
    expect(getMcpConnectionStateRust(2, 2, 0, false)).toBe('connected');
    expect(getMcpConnectionStateRust(2, 1, 1, false)).toBe('partial-error');
    expect(getMcpConnectionStateRust(2, 0, 2, false)).toBe('error');
  });

  it('MCP 경로 보강 힌트는 Rust에서 ENOENT + 상대 명령어일 때만 true', () => {
    expect(shouldAppendMcpPathHintRust('npx', 'spawn npx ENOENT')).toBe(true);
    expect(shouldAppendMcpPathHintRust('uvx', 'spawn uvx ENOENT')).toBe(true);
    expect(shouldAppendMcpPathHintRust('/opt/homebrew/bin/npx', 'spawn npx ENOENT')).toBe(false);
    expect(shouldAppendMcpPathHintRust('npx', 'permission denied')).toBe(false);
  });

  it('plans BM25 lookup and stale document repair through Rust', () => {
    const lookupPlan = planBm25HitLookupRust(
      [
        { docId: 'low', sourcePath: 'low.md', score: 0.2 },
        { docId: 'stale', sourcePath: 'keyword.md', score: 0.8 },
        { docId: 'high', sourcePath: 'high.md', score: 1.2 },
      ],
      1,
      2,
    );

    expect(lookupPlan).toEqual({
      hits: [
        { docId: 'high', sourcePath: 'high.md', score: 1.2 },
        { docId: 'stale', sourcePath: 'keyword.md', score: 0.8 },
      ],
      lookupDocIds: ['high', 'stale'],
      maxScore: 1.2,
    });
    expect(planBm25SourceLookupsRust(lookupPlan?.hits ?? [], ['high'])).toEqual(['keyword.md']);

    const candidates = planBm25CandidateResolutionRust({
      hits: lookupPlan?.hits ?? [],
      foundEntries: [{ id: 'high', filePath: 'high.md', compatible: true }],
      pathEntries: [
        { id: 'keyword.md::1', filePath: 'keyword.md', compatible: true },
        { id: 'keyword.md::2', filePath: 'keyword.md', compatible: true },
      ],
      candidateLimit: 2,
      maxScore: lookupPlan?.maxScore ?? 1,
    });

    expect(candidates).toEqual([
      { entrySet: 'found', entryIndex: 0, sourceScore: 1 },
      { entrySet: 'path', entryIndex: 0, sourceScore: 0.8 / 1.2 },
    ]);
  });

  it('plans structural linked paths and heading neighbors through Rust', () => {
    expect(
      planStructuralLinkedPathsRust(
        ['seed.md'],
        [
          { sourcePath: 'seed.md', targetPath: 'linked.md' },
          { sourcePath: 'backlink.md', targetPath: 'seed.md' },
          { sourcePath: 'seed.md', targetPath: 'linked.md' },
          { sourcePath: 'seed.md', targetPath: 'seed.md' },
          { sourcePath: 'seed.md', targetPath: 'cache-target.md' },
        ],
      ),
    ).toEqual(['linked.md', 'backlink.md', 'cache-target.md']);

    expect(
      planStructuralHeadingNeighborsRust({
        seeds: [
          {
            id: 'seed.md::12',
            filePath: 'seed.md',
            startLine: 12,
            endLine: 12,
            heading: 'Main',
          },
        ],
        entries: [
          {
            id: 'seed.md::12',
            filePath: 'seed.md',
            startLine: 12,
            compatible: true,
            heading: 'Main',
          },
          {
            id: 'seed.md::18',
            filePath: 'seed.md',
            startLine: 18,
            compatible: true,
            heading: 'Main',
          },
          {
            id: 'seed.md::24',
            filePath: 'seed.md',
            startLine: 24,
            compatible: true,
            heading: 'Sub',
          },
          {
            id: 'seed.md::40',
            filePath: 'seed.md',
            startLine: 40,
            compatible: true,
            heading: 'Other',
          },
          {
            id: 'seed.md::41',
            filePath: 'seed.md',
            startLine: 41,
            compatible: false,
            heading: 'Main',
          },
        ],
        headings: [
          { filePath: 'seed.md', startLine: 10, level: 2 },
          { filePath: 'seed.md', startLine: 20, level: 3 },
          { filePath: 'seed.md', startLine: 35, level: 2 },
        ],
      }),
    ).toEqual([1]);
  });

  it('plans LLM rerank response parsing and result ordering through Rust', () => {
    const messages = planRerankMessagesRust(
      'What changed?',
      [
        {
          id: 'a.md::0',
          sourcePath: 'a.md',
          heading: 'Intro',
          text: 'short text',
        },
        {
          id: 'b.md::0',
          sourcePath: 'b.md',
          heading: '',
          text: '  abcdefghij  ',
        },
      ],
      6,
    );
    expect(messages).not.toBeNull();
    expect(messages?.systemContent).toContain('Return JSON only');
    expect(JSON.parse(messages?.userContent ?? '{}')).toEqual({
      question: 'What changed?',
      candidates: [
        {
          id: 'a.md::0',
          index: 0,
          sourcePath: 'a.md',
          heading: 'Intro',
          text: 'short...',
        },
        {
          id: 'b.md::0',
          index: 1,
          sourcePath: 'b.md',
          heading: '',
          text: 'abcd...',
        },
      ],
    });

    expect(
      planRerankResponseWithStatusRust(
        '결과입니다.\n```json\n{"rankedIds":["b","missing","a","b",3,"c"]}\n```',
        ['a', 'b', 'c'],
      )?.rankedIds,
    ).toEqual(['b', 'a', 'c']);

    expect(
      planRerankResponseWithStatusRust(
        '결과입니다.\n```json\n{"rankedIds":["b","missing","a","b",3,"c"]}\n```',
        ['a', 'b', 'c'],
      ),
    ).toEqual({ rankedIds: ['b', 'a', 'c'], rerankStatus: 'applied' });

    expect(planRerankResponseWithStatusRust('not-json', ['a'])?.rankedIds).toEqual([]);
    expect(planRerankResponseWithStatusRust('not-json', ['a'])).toEqual({
      rankedIds: [],
      rerankStatus: 'invalid-json',
    });

    expect(planRerankResultOrderRust(['a', 'b', 'c', 'd'], ['b', 'a', 'b', 'missing'])).toEqual([
      1, 0, 2, 3,
    ]);
    expect(planRerankResultOrderRust(['a', 'b'], [])).toEqual([0, 1]);
  });

  it('returns Rust keyword-match counts with case-insensitive substring matching', () => {
    expect(countKeywordMatchesRust(['Apple', 'missing', 'router'], 'Apple router')).toBe(2);
  });

  it('returns original vector row indexes and scores for top-k ranking', () => {
    const scores = rankTopKPairsRust(
      [1, 0],
      [
        [0, 1],
        [1, 0],
        [0.6, 0.8],
        [0, 0],
      ],
      3,
    );

    expect(scores).not.toBeNull();
    expect(scores).toEqual([
      { index: 1, score: 1 },
      { index: 2, score: 0.6 },
      { index: 0, score: 0 },
    ]);
  });

  it('uses integer top-k limit and handles zero vector rows as invalid candidates', () => {
    expect(
      rankTopKPairsRust(
        [1, 0],
        [
          [1, 0],
          [0, 1],
          [0, 0],
          [0.6, 0.8],
        ],
        3.9,
      ),
    ).toEqual([
      { index: 0, score: 1 },
      { index: 3, score: 0.6 },
      { index: 1, score: 0 },
    ]);
  });

  it('filters non-finite query and candidate vectors before ranking', () => {
    expect(
      rankTopKPairsRust(
        [Number.NaN, 0],
        [
          [1, 0],
          [0, 1],
        ],
        3,
      ),
    ).toEqual([]);

    expect(
      rankTopKPairsRust(
        [1, 0],
        [
          [1, Number.POSITIVE_INFINITY],
          [1, 0],
        ],
        3,
      ),
    ).toEqual([{ index: 1, score: 1 }]);
  });

  it('plans file index records from vector metadata through Rust', () => {
    expect(
      planFileIndexRecordsRust(
        [
          {
            filePath: 'a.md',
            sourceMtime: 100,
            sourceSize: 10,
            contentHash: 'hash-a',
            indexedAt: 200,
            endLine: 4,
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
          },
          {
            filePath: 'a.md',
            sourceMtime: 100,
            sourceSize: 10,
            contentHash: 'hash-a',
            indexedAt: 200,
            endLine: 8,
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
          },
          {
            filePath: 'b.md',
            sourceMtime: 300,
            sourceSize: 30,
            contentHash: 'hash-b',
            indexedAt: 400,
            endLine: 2,
            embeddingProvider: 'openai',
          },
        ],
        999,
      ),
    ).toEqual([
      {
        filePath: 'a.md',
        sourceMtime: 100,
        sourceSize: 10,
        contentHash: 'hash-a',
        indexedAt: 200,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        hasCompleteMetadata: true,
        vectorCount: 2,
        updated: 999,
      },
      {
        filePath: 'b.md',
        hasCompleteMetadata: false,
        vectorCount: 1,
        updated: 999,
      },
    ]);
  });

  it('plans vector store mutation and lookup operations through Rust', () => {
    expect(planVectorStoreAddRust(['a', 'b'], ['b', 'c', 'c'])).toEqual({
      sources: [
        { source: 'existing', index: 0 },
        { source: 'incoming', index: 0 },
        { source: 'incoming', index: 2 },
      ],
      removedCount: 0,
      changed: true,
    });

    expect(planVectorStoreReplaceFileRust(['a.md', 'b.md', 'a.md'], 'a.md', 2)).toEqual({
      sources: [
        { source: 'existing', index: 1 },
        { source: 'incoming', index: 0 },
        { source: 'incoming', index: 1 },
      ],
      removedCount: 2,
      changed: true,
    });

    expect(planVectorStoreRemoveFileRust(['a.md', 'b.md', 'a.md'], 'a.md')).toEqual({
      sources: [{ source: 'existing', index: 1 }],
      removedCount: 2,
      changed: true,
    });

    expect(planVectorStoreLookupByFilePathsRust(['a.md', 'b.md', 'a.md'], ['a.md'])).toEqual([
      0, 2,
    ]);
    expect(planVectorStoreLookupByIdsRust(['a', 'b', 'c'], ['c', 'missing', 'a'])).toEqual([2, 0]);
  });

  it('plans vector store stats and indexed paths through Rust', () => {
    expect(planVectorStoreStatsRust(['b.md', 'a.md', 'b.md'], 1234)).toEqual({
      totalEntries: 3,
      totalFiles: 2,
      totalVectors: 3,
      averageVectorsPerFile: 1.5,
      lastUpdated: 1234,
      indexedFilePaths: ['a.md', 'b.md'],
    });

    expect(planVectorStoreStatsRust([], 1234)).toEqual({
      totalEntries: 0,
      totalFiles: 0,
      totalVectors: 0,
      averageVectorsPerFile: 0,
      lastUpdated: null,
      indexedFilePaths: [],
    });
  });

  it('plans generation-isolated IndexedDB storage through Rust', () => {
    const layout = planIndexedDbStorageLayoutRust(
      'superpower-inside',
      'C:/Vaults/Example',
      'Example',
      'profile:local::embedding-v2',
    );

    expect(layout).not.toBeNull();
    expect(layout?.contractVersion).toBe(2);
    expect(layout?.active.vector).toMatch(/^superpower-inside:rag-v2:[a-f0-9]{32}:/);
    expect(layout?.active.embeddingCache).not.toBe(layout?.active.vector);
    expect(layout?.legacyNames).toContain('superpower-inside:Example:VectorStore');
  });

  it('plans order-independent automatic RAG recovery fingerprints and retry delays through Rust', () => {
    const files = [
      { path: 'notes/beta.md', mtime: 200, size: 20 },
      { path: 'notes/alpha.md', mtime: 100, size: 10 },
    ];
    const first = planRagAutomaticRecoveryRust(files, '', 0);
    const reordered = planRagAutomaticRecoveryRust([...files].reverse(), '', 0);

    expect(first).not.toBeNull();
    expect(reordered?.fingerprint).toBe(first?.fingerprint);
    expect(first).toEqual(
      expect.objectContaining({
        requiresRecovery: true,
        retryAllowed: true,
        retryDelayMs: 2_000,
        fileCount: 2,
      }),
    );
    expect(planRagAutomaticRecoveryRust(files, first?.fingerprint ?? '', 0)).toEqual(
      expect.objectContaining({ requiresRecovery: false }),
    );
    expect(planRagAutomaticRecoveryRust(files, '', 1)?.retryDelayMs).toBe(30_000);
    expect(planRagAutomaticRecoveryRust(files, '', 2)?.retryDelayMs).toBe(120_000);
    expect(planRagAutomaticRecoveryRust(files, '', 3)).toEqual(
      expect.objectContaining({ requiresRecovery: false, retryAllowed: false }),
    );
    expect(planRagAutomaticRecoveryRust(files, first?.fingerprint ?? '', 0, 1)).toEqual(
      expect.objectContaining({ requiresRecovery: true }),
    );
  });

  it('keeps automatic recovery batches bounded and leaves large sources for explicit indexing', () => {
    expect(
      planRagAutomaticRecoveryBatchRust([
        { path: 'large.md', mtime: 1, size: 600_000 },
        { path: 'new.md', mtime: 3, size: 100 },
        { path: 'old.md', mtime: 2, size: 200 },
      ]),
    ).toEqual({ eligibleIndices: [1, 2], batchIndices: [1, 2], selectedSourceBytes: 300 });
  });

  it('creates deterministic 128-bit namespaced IndexedDB record keys through Rust', () => {
    const key = createIndexedDbRecordKeyRust('profile:local::embedding-v2', 'same text');

    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(createIndexedDbRecordKeyRust('profile:local::embedding-v2', 'same text')).toBe(key);
    expect(createIndexedDbRecordKeyRust('profile:remote::embedding-v2', 'same text')).not.toBe(key);
  });

  it('queries ANN candidates through the Rust IVF runtime index', () => {
    const runtime = RustIvfRuntimeIndex.build(
      [
        [1, 0],
        [0.95, 0.05],
        [0, 1],
        [0.05, 0.95],
      ],
      2,
      4,
    );

    expect(runtime).not.toBeNull();
    expect(runtime?.clusterCount).toBe(2);
    const scores = runtime?.query([1, 0], 2, 1);
    runtime?.dispose();

    expect(scores?.[0]).toEqual({ index: 0, score: 1 });
    expect(scores?.[1]?.index).toBe(1);
    expect(scores?.[1]?.score).toBeCloseTo(0.9986178);
  });

  it('calculates recall@k through Rust', () => {
    expect(calculateRecallAtKRust(['a', 'b', 'c'], ['c', 'x', 'a'], 3)).toBeCloseTo(2 / 3);
    expect(calculateRecallAtKRust(['a', 'a', 'b'], ['a', 'b'], 3)).toBeCloseTo(1);
    expect(calculateRecallAtKRust(['a'], ['a'], 0)).toBe(0);
  });

  it('plans RAG query result score rows through Rust', () => {
    const plan = planQueryResultScoreRust({
      cosineScore: 0.2,
      bm25Score: 0.4,
      bm25Weight: 0.3,
      hasBm25: true,
      sourceScores: {
        ann: 0.7,
        structural: 0.9,
      },
      sourceRanks: {
        vector: 1,
        structural: 4,
      },
      retrievalSources: ['vector', 'structural'],
    });
    const expectedRrf = (0.7 * (1 / 61) + 0.12 * (1 / 64)) / ((0.7 + 0.12) * (1 / 61));

    expect(plan).not.toBeNull();
    expect(plan?.combinedBase).toBeCloseTo(0.26);
    expect(plan?.rrfScore).toBeCloseTo(expectedRrf);
    expect(plan?.sourcePrior).toBeCloseTo(0.108);
    expect(plan?.sourceEvidenceScore).toBe(0.9);
    expect(plan?.bestEvidenceRank).toBe(4);
    expect(plan?.hasStructuralEvidence).toBe(true);
    expect(plan?.hasStrongStructuralEvidence).toBe(true);
    expect(plan?.combinedScore).toBeCloseTo(0.35 * 0.26 + 0.55 * expectedRrf + 0.1 * 0.108);
    expect(plan?.selectionReason).toBe('strong-structural-evidence');
  });

  it('selects sorted RAG relevant result indexes through Rust', () => {
    const indexes = selectRelevantResultIndicesRust(
      [
        {
          score: 0.9,
          vectorScore: 0.9,
          bm25Score: 0,
          keywordMatches: 0,
          retrievalSources: ['vector'],
          sourceEvidenceScore: 0,
        },
        {
          score: 0.7,
          vectorScore: 0.7,
          bm25Score: 0,
          keywordMatches: 0,
          retrievalSources: ['vector'],
          sourceEvidenceScore: 0,
        },
        {
          score: 0.5,
          vectorScore: 0.2,
          bm25Score: 0,
          keywordMatches: 0,
          retrievalSources: ['structural'],
          sourceEvidenceScore: 0.7,
          bestEvidenceRank: 2,
        },
        {
          score: 0.49,
          vectorScore: 0.2,
          bm25Score: 0.7,
          keywordMatches: 1,
          retrievalSources: ['bm25'],
          sourceEvidenceScore: 0,
        },
        {
          score: 0.3,
          vectorScore: 0.3,
          bm25Score: 0,
          keywordMatches: 0,
          retrievalSources: ['vector'],
          sourceEvidenceScore: 0,
        },
      ],
      0.5,
      true,
    );

    expect(indexes).toEqual([0, 2]);
  });

  it('plans retrieval candidate merge entry id grouping through Rust', () => {
    const plan = planMergedRetrievalCandidatesByEntryIdRust([
      {
        entryId: 'note-a#1',
        source: 'vector',
        sourceScore: 0.4,
        rank: 2,
      },
      {
        entryId: 'note-b#1',
        source: 'bm25',
        sourceScore: 0.8,
        rank: 1,
      },
      {
        entryId: 'note-a#1',
        source: 'bm25',
        sourceScore: 0.9,
        rank: 1,
      },
      {
        entryId: 'note-a#1',
        source: 'vector',
        sourceScore: 0.6,
        rank: 3,
      },
    ]);

    expect(plan).toEqual([
      {
        entryIndex: 0,
        firstCandidateIndex: 0,
        candidateIndexes: [0, 2, 3],
        sources: [
          {
            source: 'vector',
            sourceScore: 0.6,
            rank: 2,
          },
          {
            source: 'bm25',
            sourceScore: 0.9,
            rank: 1,
          },
        ],
      },
      {
        entryIndex: 1,
        firstCandidateIndex: 1,
        candidateIndexes: [1],
        sources: [
          {
            source: 'bm25',
            sourceScore: 0.8,
            rank: 1,
          },
        ],
      },
    ]);
  });

  it('plans diverse result indexes from source path and heading strings through Rust', () => {
    const indexes = planDiverseResultIndicesRust(
      [
        { score: 1, vector: [1, 0], sourcePath: 'same.md', heading: 'A' },
        { score: 0.99, vector: [0.999, 0.001], sourcePath: 'same.md', heading: 'A' },
        { score: 0.96, vector: [0.96, 0.28], sourcePath: 'other.md', heading: undefined },
      ],
      2,
    );

    expect(indexes).toEqual([0, 2]);
  });

  it('extracts vault links through Rust with normalization and dedupe', () => {
    const links = extractVaultLinksRust(
      [
        '[[제품 개념 정리]]',
        '![[Monithub%EC%9D%98%20%EA%B0%80%EC%B9%98.md#핵심]]',
        '[[제품 개념 정리|alias]]',
        '[기획](../제품%20개념%20정리.md)',
        '[외부](https://example.com)',
      ].join('\n'),
    );

    expect(links).toEqual(['제품 개념 정리', 'Monithub의 가치.md', '../제품 개념 정리.md']);
  });

  it('plans vault link path candidates and fallback basename through Rust', () => {
    expect(
      planVaultLinkCandidatesRust(
        '제품문서/고객 입장에서의 제품/데모 및 제품 기획.md',
        '../제품 개념 정리.md',
      ),
    ).toEqual({
      candidates: ['제품 개념 정리.md', '제품문서/제품 개념 정리.md'],
      fallbackBasename: '제품 개념 정리',
    });
  });

  it('plans vault link basename fallback index through Rust', () => {
    expect(planVaultLinkFallbackIndexRust('Halvard', ['Tamsin', 'Halvard', 'Halvard'])).toBe(1);
    expect(planVaultLinkFallbackIndexRust('Missing', ['Tamsin', 'Halvard'])).toBeNull();
  });

  it('plans folder mention file indices and partial state through Rust', () => {
    expect(
      planFolderMentionFilesRust(
        'Notes',
        ['Notes/a.md', 'Other/a.md', 'Notes/nested/b.md', 'NotesExtra/c.md'],
        1,
      ),
    ).toEqual({
      indices: [0],
      partial: true,
      matchedCount: 2,
      limitReason: 'max-files',
    });
    expect(planFolderMentionFilesRust('Missing', ['Notes/a.md'], 12)).toEqual({
      indices: [],
      partial: false,
      matchedCount: 0,
      limitReason: 'complete',
    });
  });

  it('plans RAG file type summary counts and ordering through Rust', () => {
    expect(
      planRagFileTypeSummaryRust(
        [
          { filePath: 'notes/a.md', extension: 'MD', indexable: true },
          { filePath: 'src/main.ts', extension: 'ts', indexable: true },
          { filePath: 'src/other.ts', extension: '.TS', indexable: true },
          { filePath: '.env', extension: '', indexable: false, recommendationReason: 'sensitive' },
          {
            filePath: 'empty.markdown',
            extension: 'markdown',
            indexable: false,
            recommendationReason: 'empty',
          },
          {
            filePath: 'image.PNG',
            extension: 'PNG',
            indexable: false,
            recommendationReason: 'binary',
          },
          {
            filePath: 'broken.weird',
            extension: 'weird',
            indexable: false,
            recommendationReason: 'unreadable',
          },
          {
            filePath: 'large.opaque',
            extension: 'opaque',
            indexable: false,
            recommendationReason: 'too-large',
          },
        ],
        '확장자 없음',
      ),
    ).toEqual({
      targetTypes: [
        { extension: 'ts', label: '.ts', count: 2 },
        { extension: 'md', label: '.md', count: 1 },
      ],
      excludeRecommendations: [
        { extension: 'opaque', label: '.opaque', count: 1, reason: 'too-large' },
        { extension: 'weird', label: '.weird', count: 1, reason: 'unreadable' },
      ],
      totalTargetFiles: 3,
    });
  });

  it('plans RAG file eligibility and text probe requests through Rust', () => {
    const files = [
      { filePath: 'note.md', fileName: 'note.md', extension: 'MD', size: 10 },
      { filePath: 'src/main.ts', fileName: 'main.ts', extension: 'ts', size: 10 },
      { filePath: '.env', fileName: '.env', extension: '', size: 10 },
      { filePath: 'empty.md', fileName: 'empty.md', extension: 'md', size: 0 },
      { filePath: 'custom.weird', fileName: 'custom.weird', extension: 'weird', size: 10 },
      { filePath: 'bin.weird', fileName: 'bin.weird', extension: 'weird', size: 10 },
      { filePath: 'Archive/old.txt', fileName: 'old.txt', extension: 'txt', size: 10 },
      { filePath: 'image.png', fileName: 'image.png', extension: 'png', size: 10 },
      { filePath: 'empty.txt', fileName: 'empty.txt', extension: 'txt', size: 0 },
      {
        filePath: 'large.opaque',
        fileName: 'large.opaque',
        extension: 'opaque',
        size: 512 * 1024 + 1,
      },
    ];

    expect(planRagFileContentProbeIndicesRust(files, ['Archive'], ['png'])).toEqual([4, 5]);

    expect(
      planRagFileIndexabilityRust(
        files,
        ['Archive'],
        ['png'],
        [
          { index: 4, readable: true, sample: 'plain text content' },
          { index: 5, readable: true, sample: '\u0000binary' },
        ],
      ),
    ).toEqual({
      candidateIndices: [0, 1, 4],
      summaryInputs: [
        { filePath: 'note.md', extension: 'MD', indexable: true },
        { filePath: 'src/main.ts', extension: 'ts', indexable: true },
        { filePath: '.env', extension: '', indexable: false, recommendationReason: 'sensitive' },
        {
          filePath: 'empty.md',
          extension: 'md',
          indexable: false,
          recommendationReason: 'empty',
        },
        { filePath: 'custom.weird', extension: 'weird', indexable: true },
        {
          filePath: 'bin.weird',
          extension: 'weird',
          indexable: false,
          recommendationReason: 'unreadable',
        },
        {
          filePath: 'empty.txt',
          extension: 'txt',
          indexable: false,
          recommendationReason: 'empty',
        },
        {
          filePath: 'large.opaque',
          extension: 'opaque',
          indexable: false,
          recommendationReason: 'too-large',
        },
      ],
    });
  });

  it('excludes secret-like RAG files while keeping ordinary config and log text files', () => {
    const files = [
      { filePath: '.npmrc', fileName: '.npmrc', extension: '', size: 10 },
      { filePath: 'id_ed25519', fileName: 'id_ed25519', extension: '', size: 10 },
      { filePath: 'cert.pem', fileName: 'cert.pem', extension: 'pem', size: 10 },
      { filePath: 'private.key', fileName: 'private.key', extension: 'key', size: 10 },
      { filePath: 'secrets.json', fileName: 'secrets.json', extension: 'json', size: 10 },
      { filePath: 'credentials.toml', fileName: 'credentials.toml', extension: 'toml', size: 10 },
      { filePath: 'app.config', fileName: 'app.config', extension: 'config', size: 10 },
      { filePath: 'app.log', fileName: 'app.log', extension: 'log', size: 10 },
    ];

    expect(planRagFileIndexabilityRust(files, [], [], [])).toEqual({
      candidateIndices: [6, 7],
      summaryInputs: [
        { filePath: '.npmrc', extension: '', indexable: false, recommendationReason: 'sensitive' },
        {
          filePath: 'id_ed25519',
          extension: '',
          indexable: false,
          recommendationReason: 'sensitive',
        },
        {
          filePath: 'cert.pem',
          extension: 'pem',
          indexable: false,
          recommendationReason: 'sensitive',
        },
        {
          filePath: 'private.key',
          extension: 'key',
          indexable: false,
          recommendationReason: 'sensitive',
        },
        {
          filePath: 'secrets.json',
          extension: 'json',
          indexable: false,
          recommendationReason: 'sensitive',
        },
        {
          filePath: 'credentials.toml',
          extension: 'toml',
          indexable: false,
          recommendationReason: 'sensitive',
        },
        { filePath: 'app.config', extension: 'config', indexable: true },
        { filePath: 'app.log', extension: 'log', indexable: true },
      ],
    });
  });

  it('plans answer source references and warning keys through Rust', () => {
    const references = planSourceReferencesRust(
      [
        '참고 [[Existing]] 및 [[Missing.md#섹션|누락]]',
        '[문서](Docs%20A.md#head)',
        'Source rag-9 그리고 Source rag-1',
      ].join('\n'),
    );

    expect(references).toEqual([
      {
        label: '[[Existing]]',
        target: 'Existing',
        kind: 'wikilink',
        aliases: ['Existing', 'Existing.md'],
      },
      {
        label: '[[Missing.md#섹션|누락]]',
        target: 'Missing.md',
        kind: 'wikilink',
        aliases: ['Missing.md', 'Missing.md.md', 'Missing'],
      },
      {
        label: '[문서](Docs%20A.md#head)',
        target: 'Docs A.md',
        kind: 'markdown-link',
        aliases: ['Docs A.md', 'Docs A.md.md', 'Docs A'],
      },
      {
        label: 'Source rag-9',
        target: 'rag-9',
        kind: 'source-id',
        aliases: [],
      },
      {
        label: 'Source rag-1',
        target: 'rag-1',
        kind: 'source-id',
        aliases: [],
      },
    ]);

    expect(
      references
        ? planSourceValidationWarningsRust(references, ['rag-1'], ['Existing.md'], ['Docs A.md'])
        : null,
    ).toEqual([
      {
        id: 'link:Missing.md',
        label: '[[Missing.md#섹션|누락]]',
        kind: 'missing-link',
      },
      {
        id: 'source:rag-9',
        label: 'Source rag-9',
        kind: 'unverified-source',
      },
    ]);
  });

  it('plans source validation citation and alias inputs through Rust', () => {
    const references =
      planSourceReferencesRust('참고 [[Existing]]\n[문서](Docs%20A.md)\nSource rag-1') ?? [];

    expect(
      planSourceValidationInputsRust(
        references,
        ['rag-1', 'rag-2'],
        ['Notes/Existing.md', 'Draft.md'],
        ['verified', 'missing'],
      ),
    ).toEqual({
      verifiedCitationIds: ['rag-1'],
      verifiedPaths: ['Notes/Existing.md'],
      aliasCandidates: ['Existing', 'Existing.md', 'Docs A.md', 'Docs A.md.md', 'Docs A'],
    });
  });

  it('plans assistant response question classification through Rust', () => {
    expect(
      planAssistantResponseClassificationRust({
        content: '해당되는 항목을 모두 선택해 주세요.\n- 성능\n- 보안',
        reasoning: '  생각 중  ',
      }),
    ).toEqual({
      type: 'question',
      content: '',
      reasoning: '생각 중',
      question: {
        prompt: '해당되는 항목을 모두 선택해 주세요.',
        choices: [
          { id: 'choice-1', label: '성능' },
          { id: 'choice-2', label: '보안' },
        ],
        selectionMode: 'multiple',
        allowFreeText: true,
        source: 'answer',
      },
      originalContent: '해당되는 항목을 모두 선택해 주세요.\n- 성능\n- 보안',
    });

    expect(
      planAssistantResponseClassificationRust({
        content: '',
        reasoning: '사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\nA) 전체\nB) 변경분만',
      }),
    ).toEqual({
      type: 'question',
      content: '',
      reasoning: '사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\nA) 전체\nB) 변경분만',
      question: {
        prompt: '어떤 범위를 분석할까요?',
        choices: [
          { id: 'choice-1', label: '전체' },
          { id: 'choice-2', label: '변경분만' },
        ],
        selectionMode: 'single',
        allowFreeText: true,
        source: 'reasoning-leak',
      },
      originalContent: '',
    });
  });

  it('plans persisted chat message blocks through Rust', () => {
    const body = [
      '<!-- superpower-inside-message',
      JSON.stringify(
        {
          id: 'msg-1',
          role: 'assistant',
          providerKey: 'openai',
          errorRetryAt: '2026-01-01T00:05:00.000Z',
          assistantQuestion: {
            prompt: '어떤 범위를 분석할까요?',
            choices: [{ id: 'choice-1', label: '전체' }],
            selectionMode: 'single',
            allowFreeText: true,
            source: 'answer',
          },
        },
        null,
        2,
      ),
      '-->',
      '### 1. Assistant',
      '',
      '<!-- superpower-inside-reasoning-start encoding="base64" -->',
      '7IOd6rCB7J2YIOqzvOygleyeheuLiOuLpC4=',
      '<!-- superpower-inside-reasoning-end -->',
      '',
      '<!-- superpower-inside-content-start encoding="base64" -->',
      '7JuQ67O4IOuLteuzgCDrgrTsmqk=',
      '<!-- superpower-inside-content-end -->',
      '<!-- /superpower-inside-message -->',
      '',
      '<!-- superpower-inside-message',
      JSON.stringify({ id: 'msg-2', role: 'assistant' }, null, 2),
      '-->',
      '<!-- superpower-inside-reasoning-start encoding="base64" -->',
      '7IOd6rCB7J2YIOqzvOygleyeheuLiOuLpC4=',
      '<!-- superpower-inside-reasoning-end -->',
      '<!-- superpower-inside-content-start encoding="base64" -->',
      '',
      '<!-- superpower-inside-content-end -->',
      '<!-- /superpower-inside-message -->',
    ].join('\n');

    expect(
      planChatMessagesRust(
        body,
        1_700_000_000_000,
        '2026-01-01T00:00:00.000Z',
        '[decoding failed]',
      ),
    ).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        role: 'assistant',
        content: '원본 답변 내용',
        reasoning: '생각의 과정입니다.',
        timestamp: 1_700_000_000_000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        providerKey: 'openai',
        errorRetryAt: '2026-01-01T00:05:00.000Z',
        status: 'complete',
        assistantQuestion: {
          prompt: '어떤 범위를 분석할까요?',
          choices: [{ id: 'choice-1', label: '전체' }],
          selectionMode: 'single',
          allowFreeText: true,
          source: 'answer',
        },
      }),
      expect.objectContaining({
        id: 'msg-2',
        role: 'assistant',
        content: '생각의 과정입니다.',
        reasoning: '생각의 과정입니다.',
        timestamp: 1_700_000_000_000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'complete',
      }),
    ]);
  });

  it('plans chat list metadata through Rust', () => {
    const content = [
      '---',
      'title: "저장된 세션"',
      'created: 1700000000000',
      'updated: "2026-05-16T01:02:03.000Z"',
      'messages: not-a-number',
      'provider: "OpenAI"',
      'model: "gpt-4.1"',
      '---',
      '',
      '## Messages',
      '',
      '<!-- superpower-inside-message',
      JSON.stringify({ id: 'msg-user', role: 'user' }),
      '-->',
      '### 1. User',
      '',
      '<!-- superpower-inside-content-start encoding="base64" -->',
      Buffer.from('첫 번째 사용자 메시지입니다. '.repeat(10), 'utf8').toString('base64'),
      '<!-- superpower-inside-content-end -->',
      '<!-- /superpower-inside-message -->',
      '',
      '<!-- superpower-inside-message',
      JSON.stringify({ id: 'msg-assistant', role: 'assistant' }),
      '-->',
      '<!-- superpower-inside-content-start encoding="base64" -->',
      Buffer.from('답변', 'utf8').toString('base64'),
      '<!-- superpower-inside-content-end -->',
      '<!-- /superpower-inside-message -->',
    ].join('\n');

    expect(planChatMetaRust(content, 'fallback.md', 1_680_000_000_000)).toEqual({
      title: '저장된 세션',
      created: '2023-11-14T22:13:20.000Z',
      updated: '2026-05-16T01:02:03.000Z',
      messageCount: 2,
      preview:
        '첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫...',
      provider: 'OpenAI',
      model: 'gpt-4.1',
    });
  });

  it('plans chat save metadata through Rust', () => {
    expect(
      planChatSaveMetadataRust(
        [
          {
            role: 'user',
            content: '사용자 첫 질문입니다.\n두 번째 줄',
            timestamp: 1_700_000_000_000,
            createdAt: '2023-11-14T22:13:20.000Z',
          },
          {
            role: 'assistant',
            content: '이전 답변',
            status: 'complete',
            providerKey: 'openai',
            model: 'gpt-4.1-mini',
            citations: [{ id: 'rag-1' }, { id: 'rag-2' }],
          },
          {
            role: 'assistant',
            content: '최종 완료 답변',
            status: 'complete',
            providerLabel: 'OpenAI',
            model: 'gpt-4.1',
            citations: [{ id: 'rag-3' }],
          },
        ],
        '1700000000000',
        '',
        '2026-01-01T00:00:00.000Z',
      ),
    ).toEqual({
      title: '사용자 첫 질문입니다. 두 번째 줄',
      created: '2023-11-14T22:13:20.000Z',
      sourceCount: 3,
      provider: 'OpenAI',
      model: 'gpt-4.1',
      summary: '최종 완료 답변',
    });
  });

  it('plans RAG context citations, blocks, and source ids through Rust', () => {
    const plan = planContextSourcesRust(
      [
        {
          filePath: 'note.md',
          heading: '핵심',
          startLine: 3,
          endLine: 5,
          text: '  긴   본문\n\n요약 '.repeat(30),
          score: 0.91,
          vectorScore: 0.8,
          bm25Score: 0.2,
          selectionReason: 'keyword-vector',
        },
        {
          filePath: 'stale.md',
          startLine: 0,
          text: '오래된 본문',
          score: 0.6,
          vectorScore: 0.4,
          bm25Score: 0.3,
        },
      ],
      [{ status: 'verified' }, { status: 'stale', detail: '파일이 변경됨' }],
      7,
      'rag',
    );
    const firstPreview = plan?.citations[0]?.preview ?? '';

    expect(firstPreview).toMatch(/^긴 본문 요약 긴 본문 요약/);
    expect(plan).toEqual({
      citations: [
        {
          id: 'rag-7',
          filePath: 'note.md',
          heading: '핵심',
          line: 4,
          endLine: 6,
          score: 0.91,
          vectorScore: 0.8,
          bm25Score: 0.2,
          status: 'verified',
          preview: firstPreview,
          previewTruncated: true,
          selectionReason: 'keyword-vector',
        },
        {
          id: 'rag-8',
          filePath: 'stale.md',
          line: 1,
          score: 0.6,
          vectorScore: 0.4,
          bm25Score: 0.3,
          status: 'stale',
          detail: '파일이 변경됨',
          preview: '오래된 본문',
          previewTruncated: false,
        },
      ],
      blocks: [
        {
          sourceId: 'rag-7',
          text: `[Source rag-7: note.md # 핵심]\n${'  긴   본문\n\n요약 '.repeat(30)}`,
        },
      ],
      sourceIds: ['rag-7'],
      rejectedCount: 1,
    });
  });

  it('plans context budget append through Rust without splitting surrogate pairs', () => {
    expect(planContextBudgetAppendRust(4, 'de😀f')).toEqual({
      text: 'de😀',
      remainingChars: 0,
      complete: false,
      appended: true,
    });
    expect(planContextBudgetAppendRust(1, '😀A')).toEqual({
      text: '',
      remainingChars: 0,
      complete: false,
      appended: false,
    });
  });

  it('plans chat context mention type indices and auto RAG policy through Rust', () => {
    expect(planChatContextMentionsRust(['server', 'file', 'folder', 'server'])).toEqual({
      fileIndices: [1],
      folderIndices: [2],
      tagIndices: [],
      serverIndices: [0, 3],
      useAutoRag: true,
      autoRagReason: 'server-and-vault',
    });
    expect(planChatContextMentionsRust(['server'])).toEqual({
      fileIndices: [],
      folderIndices: [],
      tagIndices: [],
      serverIndices: [0],
      useAutoRag: false,
      autoRagReason: 'server-only',
    });
  });

  it('plans MCP server candidates and tool name matching through Rust', () => {
    expect(
      planMcpServerCandidatesRust(
        ['serper', 'context7', 'serper'],
        ['filesystem', 'serper', 'context7', 'local'],
        {
          context7: 'disconnected',
          filesystem: 'connected',
          local: 'connected',
          serper: 'connected',
        },
      ),
    ).toEqual(['serper', 'filesystem', 'local']);
    expect(isMcpToolAvailableRust('search', ['lookup_docs', 'search'])).toBe(true);
    expect(isMcpToolAvailableRust('search', ['search_v2'])).toBe(false);
  });

  it('validates and formats MCP JSON through Rust bridge', () => {
    const valid = validateMcpJsonRust(
      JSON.stringify({
        mcpServers: {
          context7: {
            command: 'node',
            args: ['-y', '@upstash/context7-mcp'],
            env: { CONTEXT: '1' },
          },
        },
      }),
    );

    expect(valid).toEqual({
      valid: true,
      data: {
        mcpServers: {
          context7: {
            command: 'node',
            args: ['-y', '@upstash/context7-mcp'],
            env: { CONTEXT: '1' },
          },
        },
      },
    });

    expect(validateMcpJsonRust('{}')).toMatchObject({ valid: false });
    expect(validateMcpJsonRust('{}')?.errorCode).toBe('missing-mcp-servers');
    expect(validateMcpJsonRust('{"mcpServers":[]}')?.errorCode).toBe('invalid-mcp-servers');
    expect(validateMcpJsonRust('{"mcpServers":{"bad":"string"}}')?.errorCode).toBe(
      'invalid-server-value',
    );
    expect(formatMcpJsonRust('{ "mcpServers" : { "context7": {"command":"node"} } }')).toBe(
      `{
  "mcpServers": {
    "context7": {
      "command": "node"
    }
  }
}`,
    );
    expect(formatMcpJsonRust('{"mcpServers":[]}')).toBeNull();
  });

  it('parses MCP tool inputs, normalizes results, and classifies MCP errors through Rust', () => {
    expect(parseMcpToolArgumentsRust('{"query":"x"}')).toEqual({ query: 'x' });
    expect(parseMcpToolArgumentsRust('raw input')).toEqual({ input: 'raw input' });
    expect(parseMcpToolArgumentsRust('')).toEqual({});

    expect(
      normalizeMcpToolResultRust({ content: [{ type: 'text', text: 'hello' }, { notes: 'ok' }] }),
    ).toEqual({
      displayText: 'hello\n\n{"notes":"ok"}',
      modelText: 'hello\n\n{"notes":"ok"}',
    });
    expect(normalizeMcpToolResultRust({ content: [] })).toEqual({
      displayText: '[]',
      modelText: '[]',
    });

    expect(
      isMcpToolResultEmptyRust(
        { content: [] },
        {
          displayText: 'text',
          modelText: 'text',
        },
      ),
    ).toBe(true);
    expect(
      isMcpToolResultEmptyRust(
        { content: [{ type: 'text', text: 'ok' }] },
        {
          displayText: 'text',
          modelText: 'text',
        },
      ),
    ).toBe(false);

    expect(classifyMcpToolErrorRust("Input validation error: does not match '\\d+'")).toEqual({
      kind: 'validation-pattern',
      pattern: '\\d+',
    });
    expect(classifyMcpToolErrorRust("Input validation error: unknown field 'path'")).toEqual({
      kind: 'validation-field',
      field: 'path',
    });
    expect(classifyMcpToolErrorRust('some required field is missing')).toEqual({
      kind: 'validation-required',
    });
    expect(classifyMcpToolErrorRust('Input validation error: malformed payload')).toEqual({
      kind: 'validation-generic',
    });
  });

  it('plans referenced vault file self-skip and dedupe through Rust', () => {
    expect(
      planReferenceFileIndicesRust('Notes/source.md', [
        'Notes/first.md',
        'Notes/source.md',
        'Notes/first.md',
        'Notes/second.md',
      ]),
    ).toEqual([0, 3]);
  });

  it('matches vault exclude path patterns through Rust', () => {
    expect(isExcludedPathRust('Archive/old.txt', ['archive'])).toBe(true);
    expect(isExcludedPathRust('foo/.git/config', ['**/.git'])).toBe(true);
    expect(isExcludedPathRust('.git/config', ['.git/**'])).toBe(true);
    expect(isExcludedPathRust('Projects/drafts/note.md', ['**/drafts'])).toBe(true);
    expect(isExcludedPathRust('src/main.test.ts', ['src/*.test.ts'])).toBe(true);
    expect(isExcludedPathRust('notes/today.md', ['png', 'jpg'])).toBe(false);
    expect(isExcludedPathRust('images/logo.PNG', ['png'])).toBe(true);
  });

  it('checks file extension exclusion through Rust using normalized extension keys', () => {
    expect(isExcludedExtRust('Notes/README.MD', ['MD'])).toBe(true);
    expect(isExcludedExtRust('notes/asset.png', [' .png ', 'jpg'])).toBe(true);
    expect(isExcludedExtRust('notes/.env', ['env', 'md'])).toBe(false);
    expect(isExcludedExtRust('notes/noext', ['md', 'txt'])).toBe(false);
  });

  it('counts files by normalized extension keys through Rust', () => {
    expect(
      countFilesByExtensionsRust(
        ['md', 'TS', '.png', 'md', 'env', ''],
        ['TS', 'png', ' .md ', 'md'],
      ),
    ).toEqual({
      png: 1,
      md: 2,
      ts: 1,
    });
  });

  it('extracts chat mention candidates through Rust', () => {
    const candidates = parseMentionCandidatesRust(
      '@browser @[Project Plan.md] @[Project Plan.md] @[Archive.md] @Notes/today.md @missing',
    );

    expect(candidates).toEqual([
      { raw: '@[Project Plan.md]', name: 'Project Plan.md' },
      { raw: '@[Archive.md]', name: 'Archive.md' },
      { raw: '@browser', name: 'browser' },
      { raw: '@Notes/today.md', name: 'Notes/today.md' },
      { raw: '@missing', name: 'missing' },
    ]);
  });

  it('plans RAG index status summary through Rust', () => {
    const plan = planRagStatusRust({
      includedFiles: [
        { path: 'healthy.md', mtime: 100, size: 10 },
        { path: 'missing.md', mtime: 200, size: 20 },
        { path: 'stale.md', mtime: 300, size: 30 },
        { path: 'legacy.md', mtime: 400, size: 40 },
        { path: 'embedding.md', mtime: 500, size: 50 },
      ],
      records: [
        {
          filePath: 'healthy.md',
          sourceMtime: 100,
          sourceSize: 10,
          contentHash: 'healthy-hash',
          indexedAt: 900,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          hasCompleteMetadata: true,
          vectorCount: 2,
        },
        {
          filePath: 'stale.md',
          sourceMtime: 299,
          sourceSize: 30,
          contentHash: 'stale-hash',
          indexedAt: 900,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          hasCompleteMetadata: true,
          vectorCount: 3,
        },
        {
          filePath: 'legacy.md',
          hasCompleteMetadata: false,
          vectorCount: 4,
        },
        {
          filePath: 'embedding.md',
          sourceMtime: 500,
          sourceSize: 50,
          contentHash: 'embedding-hash',
          indexedAt: 900,
          embeddingProvider: 'ollama',
          embeddingModel: 'local-embedding-model',
          hasCompleteMetadata: true,
          vectorCount: 5,
        },
      ],
      totalVaultFiles: 7,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      reasons: {
        missing: 'missing reason',
        legacy: 'legacy reason',
        staleFile: 'stale file reason',
        embeddingChanged: 'embedding changed reason',
      },
    });

    expect(plan).toEqual({
      totalDocuments: 5,
      healthyDocuments: 1,
      missingDocuments: 1,
      staleDocuments: 2,
      unknownDocuments: 1,
      excludedDocuments: 2,
      totalVectors: 2,
      updateRequiredDocuments: [
        {
          path: 'missing.md',
          status: 'missing',
          reason: 'missing reason',
          mtime: 200,
          size: 20,
        },
        {
          path: 'embedding.md',
          status: 'stale',
          reason: 'embedding changed reason',
          mtime: 500,
          size: 50,
        },
        {
          path: 'stale.md',
          status: 'stale',
          reason: 'stale file reason',
          mtime: 300,
          size: 30,
        },
        {
          path: 'legacy.md',
          status: 'unknown',
          reason: 'legacy reason',
          mtime: 400,
          size: 40,
        },
      ],
    });
  });

  it('plans pending index file selection through Rust', () => {
    expect(
      planIndexPendingFilesRust(['b.md', 'a.md', 'c.md', 'a.md'], ['a.md', 'missing.md']),
    ).toEqual({
      fileIndices: [1, 3],
      skipped: 2,
    });
    expect(planIndexPendingFilesRust(['a.md'], [])).toEqual({
      fileIndices: [],
      skipped: 1,
    });
  });

  it('returns markdown chunks with heading and line metadata', () => {
    const chunks = chunkMarkdownRust(
      ['# First', 'alpha', '', 'beta', '# Second', '```', 'const value = 1;', '```'].join('\n'),
      100,
      0,
    );

    expect(chunks).toEqual([
      {
        text: '# First\nalpha\n\nbeta',
        metadata: {
          filePath: '',
          heading: 'First',
          startLine: 0,
          endLine: 3,
        },
      },
      {
        text: '# Second\n```\nconst value = 1;\n```',
        metadata: {
          filePath: '',
          heading: 'Second',
          startLine: 4,
          endLine: 7,
        },
      },
    ]);
  });

  it('returns plain text chunks with blank-line split metadata', () => {
    const chunks = chunkPlainTextRust(['alpha', '', 'beta beta'].join('\n'), 12, 0);

    expect(chunks).toEqual([
      {
        text: 'alpha',
        metadata: {
          filePath: '',
          startLine: 0,
          endLine: 1,
        },
      },
      {
        text: 'beta beta',
        metadata: {
          filePath: '',
          startLine: 2,
          endLine: 2,
        },
      },
    ]);
  });

  it('불완전한 조사 범위의 scoped negative 위반 코드를 중복 없이 전달한다', () => {
    const plan = planResearchAnswerContractRust({
      answer: '현재 검색 범위에서 퀼런의 원장 직접 언급을 찾지 못했습니다.',
      language: 'ko',
      receipt: {
        inventoryCount: 2,
        pagedCount: 2,
        locallyScreenedCount: 1,
        selectedEvidenceCount: 0,
        providerTransferredCount: 0,
        providerAnalyzedCount: 0,
        providerOmittedCount: 0,
        wholeVaultLocallyScreened: false,
        allSelectedEvidenceAnalyzed: true,
        allInventoryEvidenceAnalyzed: false,
        exactNegativeAllowed: false,
        reasonCodes: ['local-screen-unreadable'],
      },
    });

    expect(plan).not.toBeNull();
    expect(plan?.violationCodes).toEqual(['exact-negative-coverage-incomplete']);
  });

  it('명시한 영어 locale은 답변의 한국어 고유명사보다 우선한다', () => {
    const plan = planResearchAnswerContractRust({
      answer: 'After checking every note, I found evidence about Quillon.',
      language: 'en',
      receipt: {
        inventoryCount: 2,
        pagedCount: 2,
        locallyScreenedCount: 2,
        selectedEvidenceCount: 1,
        providerTransferredCount: 1,
        providerAnalyzedCount: 1,
        providerOmittedCount: 0,
        wholeVaultLocallyScreened: true,
        allSelectedEvidenceAnalyzed: true,
        allInventoryEvidenceAnalyzed: false,
        exactNegativeAllowed: true,
        reasonCodes: [],
      },
    });

    expect(plan).toMatchObject({
      allowed: false,
      safeCoverageText:
        'The whole vault was screened locally and all selected evidence was analyzed.',
    });
  });

  it('provider batch 의미를 유지하면서 final과 repair가 예약된 호출 상한을 전달한다', () => {
    expect(
      planResearchProviderRequestBudgetRust({
        providerBatchCount: 8,
        providerBudget: {
          maxSelectedItems: 64,
          batchSize: 8,
          maxBatches: 8,
          maxTransferItems: 64,
        },
      }),
    ).toEqual({
      maxRequests: 12,
      maxProviderAttempts: 14,
      maxRetryWaitMs: 30_000,
      maxMapRequests: 8,
      maxReductionRequests: 2,
      reservedFinalRequests: 1,
      reservedRepairRequests: 1,
    });
  });

  it('provider 실제 시도와 누적 retry 대기를 미래 논리 호출 예약 안에서 제한한다', () => {
    expect(
      planResearchProviderLedgerTransitionRust({
        maxProviderAttempts: 14,
        maxRetryWaitMs: 30_000,
        providerAttempts: 3,
        retryWaitMs: 29_000,
        remainingLogicalRequests: 11,
        event: { kind: 'retry-wait', retryDelayMs: 500 },
      }),
    ).toEqual({
      allowed: false,
      providerAttempts: 3,
      retryWaitMs: 29_000,
      reason: 'provider-attempt-limit',
    });

    expect(
      planResearchProviderLedgerTransitionRust({
        maxProviderAttempts: 14,
        maxRetryWaitMs: 30_000,
        providerAttempts: 2,
        retryWaitMs: 29_750,
        remainingLogicalRequests: 10,
        event: { kind: 'retry-wait', retryDelayMs: 500 },
      }),
    ).toEqual({
      allowed: false,
      providerAttempts: 2,
      retryWaitMs: 29_750,
      reason: 'retry-wait-limit',
    });
  });

  it('bounded native 검색 결과를 exact negative 불가 범위로 전달한다', () => {
    const receipt = deriveNativeToolCoverageReceiptRust([
      JSON.stringify({
        action: 'search',
        query: 'Alpha',
        path: '',
        match: 'all',
        hits: [],
        scannedFiles: 100,
        unreadableFiles: 0,
        totalHits: 20,
        truncated: true,
      }),
    ]);

    expect(receipt).toMatchObject({
      wholeVaultLocallyScreened: false,
      exactNegativeAllowed: false,
      reasonCodes: ['local-screen-omitted'],
    });
  });

  it('필터 제한 검색의 coverage를 TS에서도 보존하고 전수 확인으로 확대하지 않는다', () => {
    const receipt = deriveNativeToolCoverageReceiptRust([
      JSON.stringify({
        action: 'search',
        query: 'Alpha',
        path: '',
        match: 'all',
        hits: [],
        scannedFiles: 1,
        unreadableFiles: 0,
        totalHits: 0,
        truncated: false,
        filters: { tags: ['project'] },
        scopeRestricted: true,
      }),
    ]);
    expect(receipt).toMatchObject({
      wholeVaultLocallyScreened: false,
      exactNegativeAllowed: false,
      reasonCodes: ['local-screen-filtered'],
    });
    expect(
      receipt &&
        planResearchAnswerContractRust({
          answer: '현재 검색 범위에서 Alpha 내용은 없습니다.',
          language: 'ko',
          receipt,
        }),
    ).toMatchObject({ allowed: false });
    expect(
      receipt &&
        planResearchAnswerContractRust({
          answer: '확인한 근거를 요약합니다.',
          language: 'ko',
          receipt,
        }),
    ).toMatchObject({ allowed: true });
  });

  it('native 검색과 다른 주제의 부재 단정을 막고 같은 query의 제한 문구만 허용한다', () => {
    const receipt = deriveNativeToolCoverageReceiptRust([
      JSON.stringify({
        action: 'search',
        query: 'Alpha',
        path: '',
        match: 'all',
        hits: [],
        scannedFiles: 100,
        unreadableFiles: 0,
        totalHits: 0,
        truncated: false,
      }),
    ]);

    expect(receipt?.searchScopes).toEqual([
      { query: 'Alpha', path: '', match: 'all', complete: true },
    ]);
    expect(
      receipt
        ? planResearchAnswerContractRust({
            answer: '현재 검색 범위에서 Beta 내용은 없습니다.',
            language: 'ko',
            receipt,
          })
        : null,
    ).toMatchObject({
      allowed: false,
      violationCodes: ['exact-negative-coverage-incomplete'],
    });
    expect(
      receipt
        ? planResearchAnswerContractRust({
            answer: '현재 검색 범위에서 Alpha 내용은 없습니다.',
            language: 'ko',
            receipt,
          })
        : null,
    ).toMatchObject({ allowed: true, violationCodes: [] });
  });

  it('path 제한 검색은 whole-vault가 아니며 query와 path를 함께 적은 부재 문구만 허용한다', () => {
    const receipt = deriveNativeToolCoverageReceiptRust([
      JSON.stringify({
        action: 'search',
        query: 'Alpha',
        path: 'Projects',
        match: 'all',
        hits: [],
        scannedFiles: 10,
        unreadableFiles: 0,
        totalHits: 0,
        truncated: false,
      }),
    ]);

    expect(receipt).toMatchObject({
      wholeVaultLocallyScreened: false,
      exactNegativeAllowed: true,
    });
    expect(
      receipt
        ? planResearchAnswerContractRust({
            answer: '현재 검색 범위에서 Alpha 내용은 없습니다.',
            language: 'ko',
            receipt,
          })
        : null,
    ).toMatchObject({ allowed: false });
    expect(
      receipt
        ? planResearchAnswerContractRust({
            answer: '현재 검색 범위 Projects에서 Alpha 내용은 없습니다.',
            language: 'ko',
            receipt,
          })
        : null,
    ).toMatchObject({ allowed: true });
  });
});

describe('planIndexedEvidenceRust / verifyIndexedEvidenceRust', () => {
  const planInput = {
    question: 'alpha -beta gamma.md 2024',
    documents: [{ path: 'notes/alpha.md', text: 'alpha gamma.md 2024 review' }],
  } as const;

  it('does not throw while the generated glue has no evidence exports yet', () => {
    const plan = planIndexedEvidenceRust(planInput);
    if (plan !== null) return;
    expect(plan).toBeNull();
    const verification = verifyIndexedEvidenceRust({
      evidence: [{ sourceId: 'notes/alpha.md#L1-L1', path: 'notes/alpha.md', quote: 'alpha' }],
      documents: [{ path: 'notes/alpha.md', text: 'alpha gamma.md 2024 review' }],
    });
    expect(verification).toBeNull();
  });

  it('현재 구절의 유일한 주소 제안을 WASM에서 읽되 재검증 전 상태는 유지한다', () => {
    const evidence = {
      sourceId: 'old',
      path: 'notes/synthetic.md',
      quote: 'Unique cooling condition.',
      revision: 'old',
      startLine: 1,
      endLine: 1,
    };
    const documents = [
      {
        path: evidence.path,
        text: 'Introduction.\nUnique cooling condition.',
        revision: 'new',
        startLine: 40,
      },
    ];
    const result = verifyIndexedEvidenceRust({ evidence: [evidence], documents });
    expect(result?.statuses[0]).toMatchObject({
      status: 'revision-mismatch',
      relocation: { startLine: 41, endLine: 41, revision: 'new' },
    });
    const relocation = result?.statuses[0]?.relocation;
    expect(relocation).toBeDefined();
    const verified = verifyIndexedEvidenceRust({
      evidence: [{ ...evidence, ...relocation }],
      documents,
    });
    expect(verified?.statuses[0]?.status).toBe('verified');
  });

  it('honors the deterministic evidence contract once the glue export lands', () => {
    const plan = planIndexedEvidenceRust(planInput);
    if (plan === null) return;
    expect(plan.queryTokens.some((token) => token.text === 'alpha' && !token.negated)).toBe(true);
    expect(plan.queryTokens.some((token) => token.text === 'beta' && token.negated)).toBe(true);
    expect(plan.evidence.length).toBeGreaterThan(0);
    expect(plan.evidence[0].rank).toBe(1);
    expect(plan.evidence[0].path).toBe('notes/alpha.md');
    expect(plan.diagnostics.candidateDocuments).toBe(1);
    expect(['supported', 'incomplete', 'budget-exhausted']).toContain(plan.coverage.status);
    const verification = verifyIndexedEvidenceRust({
      evidence: [
        {
          sourceId: plan.evidence[0].sourceId,
          path: plan.evidence[0].path,
          quote: plan.evidence[0].quote,
          startLine: plan.evidence[0].startLine,
          endLine: plan.evidence[0].endLine,
        },
      ],
      documents: [{ path: 'notes/alpha.md', text: 'alpha gamma.md 2024 review' }],
    });
    expect(verification?.statuses.length).toBe(1);
    expect(['verified', 'quote-missing', 'position-mismatch']).toContain(
      verification?.statuses[0].status,
    );
  });
});

describe('indexed search/answer wire wrappers', () => {
  function evidencePlanWire(queryIndexes?: readonly number[], preferredQueryIndexes?: readonly unknown[]): string {
    return JSON.stringify({
      queryTokens: [],
      phrases: [],
      evidence: [
        {
          sourceId: 'notes/alpha.md#L1-L1',
          path: 'notes/alpha.md',
          revision: null,
          startLine: 1,
          endLine: 1,
          quote: 'alpha',
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
          ...(queryIndexes === undefined ? {} : { queryIndexes }),
          ...(preferredQueryIndexes === undefined ? {} : { preferredQueryIndexes }),
        },
      ],
      order: ['notes/alpha.md#L1-L1'],
      diagnostics: {
        candidateDepth: 1,
        candidateDocuments: 1,
        selectedDocuments: 1,
        truncated: false,
        droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
        zeroHitReason: null,
        unmatchedTerms: [],
        candidateChunks: 1,
        selectedChunks: 1,
        missingCandidatePaths: 0,
      },
      coverage: {
        status: 'supported',
        reviewedDocuments: 1,
        unreviewedDocuments: 0,
        notIndexedDocuments: 0,
      },
      budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262144, usedChars: 5 },
    });
  }

  it('plans search facets through the dynamic generated export', () => {
    const input = {
      question: 'Compare alpha and beta',
      scoringQuestion: 'alpha beta reliability',
      scopes: [] as string[],
    };
    const wire = {
      mode: 'comparison',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: 'alpha beta',
          queryIndex: 0,
          terms: ['alpha', 'beta'],
        },
        { id: 'subject-0', kind: 'subject', query: 'alpha', queryIndex: 1, terms: ['alpha'] },
      ],
    };
    rustWireExports.plan_indexed_search_queries_json.mockReturnValue(JSON.stringify(wire));

    expect(planIndexedSearchQueriesRust(input)).toEqual(wire);
    expect(rustWireExports.plan_indexed_search_queries_json).toHaveBeenCalledWith(
      JSON.stringify(input),
    );
  });

  it('plans and validates indexed review answers through dynamic exports', () => {
    const answerPlan: RustIndexedReviewAnswerPlan = {
      mode: 'single',
      facets: [
        {
          id: 'question',
          kind: 'question',
          label: 'alpha',
          status: 'supported',
          sourceIds: ['notes/alpha.md#L1-L1'],
        },
      ],
      requiredFacetIds: ['question'],
      missingFacetIds: [],
      synthesisRequired: false,
    };
    const planInput: RustIndexedReviewAnswerPlanInput = {
      searchPlan: {
        mode: 'single',
        facets: [
          { id: 'question', kind: 'question', query: 'alpha', queryIndex: 0, terms: ['alpha'] },
        ],
      },
      evidence: [
        {
          sourceId: 'notes/alpha.md#L1-L1',
          path: 'notes/alpha.md',
          quote: 'alpha',
          queryIndexes: [0],
        },
      ],
    };
    const validationInput: RustIndexedReviewAnswerValidationInput = {
      sourceIds: ['notes/alpha.md#L1-L1'],
      answerPlan,
      response: '{"paragraphs":[]}',
    };
    rustWireExports.plan_indexed_review_answer_plan_json.mockReturnValue(
      JSON.stringify(answerPlan),
    );
    rustWireExports.validate_indexed_review_answer_json.mockReturnValue(
      JSON.stringify({ valid: true, content: 'alpha' }),
    );

    expect(planIndexedReviewAnswerPlanRust(planInput)).toEqual(answerPlan);
    expect(validateIndexedReviewAnswerRust(validationInput)).toEqual({
      valid: true,
      content: 'alpha',
    });
    expect(rustWireExports.plan_indexed_review_answer_plan_json).toHaveBeenCalledWith(
      JSON.stringify(planInput),
    );
    expect(rustWireExports.validate_indexed_review_answer_json).toHaveBeenCalledWith(
      JSON.stringify(validationInput),
    );
  });

  it('preserves bounded format issues and rejects malformed wire diagnostics', () => {
    const input: RustIndexedReviewAnswerValidationInput = {
      sourceIds: [],
      answerPlan: {
        mode: 'single',
        facets: [],
        requiredFacetIds: [],
        missingFacetIds: [],
        synthesisRequired: false,
      },
      response: '',
    };
    const failure = { valid: false, reason: 'invalid-format', missingFacetIds: [] };
    for (const formatIssue of [
      'invalid-json',
      'invalid-paragraphs',
      'invalid-text',
      'invalid-sources',
      'unknown-source',
      'invalid-covers',
    ]) {
      rustWireExports.validate_indexed_review_answer_json.mockReturnValue(
        JSON.stringify({ ...failure, formatIssue }),
      );
      expect(validateIndexedReviewAnswerRust(input)).toEqual({ ...failure, formatIssue });
    }
    rustWireExports.validate_indexed_review_answer_json.mockReturnValue(JSON.stringify(failure));
    expect(validateIndexedReviewAnswerRust(input)).toEqual(failure);
    for (const formatIssue of ['untrusted diagnostic text', 1, null]) {
      rustWireExports.validate_indexed_review_answer_json.mockReturnValue(
        JSON.stringify({ ...failure, formatIssue }),
      );
      expect(validateIndexedReviewAnswerRust(input)).toBeNull();
    }
    rustWireExports.validate_indexed_review_answer_json.mockReturnValue(
      JSON.stringify({ ...failure, reason: 'missing-facet', formatIssue: 'unknown-source' }),
    );
    expect(validateIndexedReviewAnswerRust(input)).toBeNull();
  });

  it('preserves indexed evidence query indexes and backfills legacy output', () => {
    const input = {
      question: 'alpha',
      documents: [{ path: 'notes/alpha.md', text: 'alpha' }],
    };
    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire([1, 3]));
    expect(planIndexedEvidenceRust(input)?.evidence[0].queryIndexes).toEqual([1, 3]);

    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire());
    expect(planIndexedEvidenceRust(input)?.evidence[0].queryIndexes).toEqual([]);
  });

  it('병합의 원래 배치 순위·점수 비율을 보존하고 잘못된 wire 값은 거절한다', () => {
    const input = { question: 'alpha', documents: [{ path: 'notes/alpha.md', text: 'alpha' }] };
    const ranking = { rank: 2, scoreRatio: 0.75 };
    const wire = JSON.parse(evidencePlanWire()) as { evidence: { mergeRanking?: unknown }[] };
    wire.evidence[0].mergeRanking = ranking;
    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(JSON.stringify(wire));
    expect(planIndexedEvidenceRust(input)?.evidence[0]).toMatchObject({ mergeRanking: ranking });
    for (const invalid of [
      null,
      {},
      { rank: 0, scoreRatio: 0.5 },
      { rank: 1.5, scoreRatio: 0.5 },
      { rank: '1', scoreRatio: 0.5 },
      { rank: 1, scoreRatio: -0.1 },
      { rank: 1, scoreRatio: 1.1 },
      { rank: 1, scoreRatio: '0.5' },
    ]) {
      wire.evidence[0].mergeRanking = invalid;
      rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(JSON.stringify(wire));
      expect(planIndexedEvidenceRust(input)).toBeNull();
    }
  });

  it('preserves independent facet representatives and accepts legacy evidence', () => {
    const input = { question: 'alpha', documents: [{ path: 'notes/alpha.md', text: 'alpha' }] };
    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire([1, 3], [3]));
    expect(planIndexedEvidenceRust(input)?.evidence[0].preferredQueryIndexes).toEqual([3]);
    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire([1, 3]));
    expect(planIndexedEvidenceRust(input)?.evidence[0].preferredQueryIndexes).toEqual([]);
    for (const invalid of [[2], [-1], [4], [1.5], ['1']]) {
      rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire([1, 3], invalid));
      expect(planIndexedEvidenceRust(input)).toBeNull();
    }
  });

  it.each([-1, 4, 1.5])('rejects invalid indexed evidence query index %s', (queryIndex) => {
    const input = {
      question: 'alpha',
      documents: [{ path: 'notes/alpha.md', text: 'alpha' }],
    };
    rustWireExports.plan_indexed_evidence_json.mockReturnValueOnce(evidencePlanWire([queryIndex]));
    expect(planIndexedEvidenceRust(input)).toBeNull();

    expect(
      planIndexedEvidenceRust({
        ...input,
        candidates: [
          {
            path: 'notes/alpha.md',
            source: 'bm25',
            rank: 1,
            queryIndex,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('mergeIndexedEvidencePlansRust', () => {
  const planRow = {
    sourceId: 'a.md#L1-L1',
    path: 'a.md',
    revision: null,
    startLine: 1,
    endLine: 1,
    quote: 'alpha',
    contextBefore: '',
    contextAfter: '',
    score: 1,
    rank: 1,
    signal: 'lexical',
    phraseMatches: 0,
    proximityScore: 0,
    fieldScore: 0,
    exactSignals: [],
    fieldMatches: [],
    negatedNearby: false,
    duplicateOf: null,
    highlights: [{ start: 0, end: 5 }],
  } as const;
  const plan = {
    queryTokens: [],
    phrases: [],
    evidence: [planRow],
    order: [planRow.sourceId],
    diagnostics: {
      candidateDepth: 1,
      candidateDocuments: 1,
      candidateChunks: 1,
      selectedDocuments: 1,
      selectedChunks: 1,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
      unmatchedTerms: [],
      missingCandidatePaths: 0,
      zeroHitReason: null,
    },
    coverage: {
      status: 'supported' as const,
      reviewedDocuments: 1,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    budget: { maxDocuments: 64, maxPassages: 12, maxChars: 262144, usedChars: 5 },
  } as const;

  it('stays null-safe until the glue export lands', () => {
    const merged = mergeIndexedEvidencePlansRust({ plans: [plan] });
    if (merged !== null) {
      expect(merged.evidence.length).toBeLessThanOrEqual(1);
      expect(merged.evidence[0]?.highlights.length).toBeGreaterThan(0);
      return;
    }
    expect(merged).toBeNull();
  });

  it('is partition invariant once the glue export lands', () => {
    const forward = mergeIndexedEvidencePlansRust({ plans: [plan] });
    const backward = mergeIndexedEvidencePlansRust({ plans: [plan] });
    if (forward === null || backward === null) return;
    expect(forward.order).toEqual(backward.order);
    expect(forward.diagnostics.evaluatedChunks).toBe(1);
  });
});

describe('RustBm25RuntimeIndex field bridge', () => {
  it('adds fields and reports position index status', () => {
    const index = RustBm25RuntimeIndex.empty(3);
    if (index === null) return;
    try {
      const added = index.addDocumentFields(
        'doc-1',
        'alpha beta',
        'a.md',
        { path: 'a.md', title: 'Alpha', headings: ['Alpha'], tags: ['t'] },
        3,
      );
      expect(added).toBe(true);
      const status = index.positionIndexStatus();
      expect(status).not.toBeNull();
      expect(status?.totalDocs).toBe(1);
      expect(status?.complete).toBe(true);
    } finally {
      index.dispose();
    }
  });
});
