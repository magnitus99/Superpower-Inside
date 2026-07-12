import { describe, expect, it } from 'vitest';

import {
  assignVectorClustersRust,
  analyzeRetrievalSourcesRust,
  buildInitialCentroidsRust,
  calculateRecallAtKRust,
  calculateHybridScoreRust,
  calculateRrfScoreRust,
  createEntityIdRust,
  createPendingEntityMergeIdRust,
  createContentHashRust,
  chunkMarkdownRust,
  chunkPlainTextRust,
  aggregateGraphEdgesRust,
  countFilesByExtensionsRust,
  bm25TermFrequenciesRust,
  detectCommunitiesRust,
  countKeywordMatchesRust,
  extractJsonObjectRust,
  extractVaultLinksRust,
  findMentionedEntityMatchesRust,
  isGraphExtractionCacheHitRust,
  isExcludedPathRust,
  isExcludedExtRust,
  isRustCoreAvailable,
  createGraphIdRust,
  normalizeGraphConfidenceRust,
  normalizeExtractedGraphPayloadRust,
  normalizeEntityNameRust,
  normalizeGraphNameRust,
  parseExtractedGraphPayloadRust,
  planAssistantResponseClassificationRust,
  planChatMetaRust,
  planChatMessagesRust,
  planChatSaveMetadataRust,
  planChatContextMentionsRust,
  planContextBudgetAppendRust,
  planContextGraphVerificationRust,
  planContextSourcesRust,
  planQueryResultScoreRust,
  planFileIndexRecordsRust,
  planFolderMentionFilesRust,
  planFolderLexicalEvidenceIndicesRust,
  planImplicitFolderQueryPathsRust,
  planGraphEdgeRecordsRust,
  planGraphRagStatusEntryLookupsRust,
  planGraphRagStatusEntrySnapshotRust,
  planGraphRagStatusFileSnapshotRust,
  planGraphRagStatusRust,
  planGraphRagMarkdownFilePathsRust,
  planIndexPendingFilesRust,
  planVectorStoreAddRust,
  planVectorStoreLookupByFilePathsRust,
  planVectorStoreLookupByIdsRust,
  planVectorStoreRemoveFileRust,
  planVectorStoreReplaceFileRust,
  planVectorStoreStatsRust,
  planGraphPruneRust,
  parseMentionCandidatesRust,
  planEntityResolutionRust,
  planBm25IndexAddDocumentRust,
  planBm25IndexRemoveDocumentRust,
  planBm25IndexRemoveSourceRust,
  planBm25SearchRust,
  planClaimEvidenceScoresRust,
  planEvidenceCandidateOrderRust,
  planRerankMessagesRust,
  planRerankResponseRust,
  planRerankResponseWithStatusRust,
  planRerankResultOrderRust,
  planBm25CandidateResolutionRust,
  planBm25HitLookupRust,
  planBm25SourceLookupsRust,
  planGraphDeletionIndicesRust,
  planGraphEvidenceCandidateLookupRust,
  planGraphEvidenceEntryCandidatesRust,
  planGraphClaimEntityIdsRust,
  planGraphCommunitySummaryGroupsRust,
  planGraphExtractionTypeValidationRust,
  planGraphRelationEndpointIndicesRust,
  planGraphMentionContextRust,
  planGraphEntityMergeRust,
  planGraphQueryExecutionRust,
  planGraphQueryRust,
  planGraphQueryResponseRust,
  planGraphSchemaCommunityIndicesRust,
  planGraphSchemaRelationIndicesRust,
  planGraphCommunityReplacementDeleteIdsRust,
  planGraphRagRunFileSelectionRust,
  planGraphRagUnsupportedPrunePathsRust,
  isMcpToolAvailableRust,
  planMcpServerCandidatesRust,
  planLocalEvidenceScoresRust,
  planDiverseResultIndicesRust,
  detectCommunitiesFromEdgesRust,
  planRagFileContentProbeIndicesRust,
  planRagFileIndexabilityRust,
  planRagFileTypeSummaryRust,
  planRagStatusRust,
  planRagIndexingEtaRust,
  planReferenceFileIndicesRust,
  planMergedRetrievalCandidatesByEntryIdRust,
  planMergedRetrievalCandidatesRust,
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
  recomputeCentroidsRust,
  isMcpToolResultEmptyRust,
  normalizeMcpToolResultRust,
  parseMcpToolArgumentsRust,
  scoreEntityMatchRust,
  isRelevantResultRust,
  scoreBm25Rust,
  sanitizeGraphIdPartRust,
  selectRelevantResultIndicesRust,
  selectDiverseIndicesRust,
  scoreLocalEvidenceRust,
  tokenizeRust,
  validateOntologyRelationRust,
  validateMcpJsonRust,
  formatMcpJsonRust,
  shouldAppendMcpPathHintRust,
  shouldRebuildGraphRuntimeForGraphStatusRust,
  getMcpConnectionStateRust,
  shouldOfferContext7ForPromptRust,
} from './rust-core';

describe('Rust WASM RAG core bridge', () => {
  it('loads embedded WASM bytes synchronously', () => {
    expect(isRustCoreAvailable()).toBe(true);
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
      ),
    ).toEqual([1, 2]);
    expect(shouldOfferContext7ForPromptRust('Rust API 예제를 보여줘')).toBe(true);
    expect(shouldOfferContext7ForPromptRust('오로라 프로젝트의 진행 상황은?')).toBe(false);
  });

  it('returns BM25 term frequencies from Rust tokenizer output', () => {
    const frequencies = bm25TermFrequenciesRust('OpenRouter OpenRouter freeLLMApi');

    expect(frequencies).toEqual({
      totalTokens: 10,
      frequencies: {
        openrouter: 2,
        open: 2,
        router: 2,
        freellmapi: 1,
        free: 1,
        llm: 1,
        api: 1,
      },
    });
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

  it('판단 경로를 Rust 쪽으로 넘겨 GraphRAG 런타임 재구성을 결정한다', () => {
    expect(
      shouldRebuildGraphRuntimeForGraphStatusRust(
        true,
        'openai:gpt-4o-mini',
        'stale',
        'ready',
        false,
      ),
    ).toBe(true);
    expect(
      shouldRebuildGraphRuntimeForGraphStatusRust(
        false,
        'openai:gpt-4o-mini',
        'stale',
        'ready',
        false,
      ),
    ).toBe(false);
    expect(
      shouldRebuildGraphRuntimeForGraphStatusRust(
        true,
        'openai:gpt-4o-mini',
        'ready',
        'ready',
        false,
      ),
    ).toBe(false);
    expect(shouldRebuildGraphRuntimeForGraphStatusRust(true, '', 'stale', 'ready', false)).toBe(
      false,
    );
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

  it('plans BM25 index mutation and search through Rust', () => {
    const emptyIndex = {
      tokenizerVersion: 2,
      inverted: {},
      docLengths: {},
      docSources: {},
      totalDocs: 0,
      avgDocLength: 1,
    };

    const withApi = planBm25IndexAddDocumentRust(
      emptyIndex,
      'api.md::0',
      'OpenRouter API access key',
      'api.md',
      2,
    );

    expect(withApi).not.toBeNull();
    expect(withApi).toEqual(
      expect.objectContaining({
        tokenizerVersion: 2,
        docLengths: { 'api.md::0': 6 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 6,
      }),
    );
    expect(withApi?.inverted.openrouter).toEqual({ 'api.md::0': 1 });
    expect(withApi?.inverted.open).toEqual({ 'api.md::0': 1 });
    expect(withApi?.inverted.router).toEqual({ 'api.md::0': 1 });

    const withBoth = planBm25IndexAddDocumentRust(
      withApi,
      'other.md::0',
      'Ollama local model',
      'other.md',
      2,
    );
    expect(planBm25SearchRust(withBoth, 'open router')?.map((hit) => hit.docId)).toEqual([
      'api.md::0',
    ]);

    const replaced = planBm25IndexAddDocumentRust(
      withBoth,
      'api.md::0',
      'Ollama remote endpoint',
      'api.md',
      2,
    );
    expect(planBm25SearchRust(replaced, 'open router')).toEqual([]);
    expect(planBm25SearchRust(replaced, 'ollama')?.map((hit) => hit.docId)).toEqual([
      'api.md::0',
      'other.md::0',
    ]);

    const removedBySource = planBm25IndexRemoveSourceRust(replaced, 'api.md', 2);
    expect(removedBySource?.docLengths).toEqual({ 'other.md::0': 3 });
    expect(removedBySource?.docSources).toEqual({ 'other.md::0': 'other.md' });
    expect(planBm25SearchRust(removedBySource, 'endpoint')).toEqual([]);

    const removedByDoc = planBm25IndexRemoveDocumentRust(removedBySource, 'other.md::0', 2);
    expect(removedByDoc).toEqual(emptyIndex);
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
      planRerankResponseRust(
        '결과입니다.\n```json\n{"rankedIds":["b","missing","a","b",3,"c"]}\n```',
        ['a', 'b', 'c'],
      ),
    ).toEqual(['b', 'a', 'c']);

    expect(
      planRerankResponseWithStatusRust(
        '결과입니다.\n```json\n{"rankedIds":["b","missing","a","b",3,"c"]}\n```',
        ['a', 'b', 'c'],
      ),
    ).toEqual({ rankedIds: ['b', 'a', 'c'], rerankStatus: 'applied' });

    expect(planRerankResponseRust('not-json', ['a'])).toEqual([]);
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

  it('assigns ANN vectors to nearest centroids through Rust', () => {
    const assignments = assignVectorClustersRust(
      [
        [1, 0],
        [0, 1],
        [0.8, 0.2],
        [0, 0],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    );

    expect(assignments).toEqual([0, 1, 0, 0]);
  });

  it('recomputes ANN centroids through Rust while preserving empty clusters', () => {
    const centroids = recomputeCentroidsRust(
      [
        [1, 0],
        [0.5, 0.5],
        [0, 1],
      ],
      [0, 0, 2],
      [
        [9, 9],
        [8, 8],
        [7, 7],
      ],
    );

    expect(centroids).toEqual([
      [0.75, 0.25],
      [8, 8],
      [0, 1],
    ]);
  });

  it('resolves ANN cluster count and initial centroids through Rust', () => {
    const centroids = buildInitialCentroidsRust(
      [
        [1, 0],
        [0.7, 0.3],
        [0, 1],
        [-1, 0],
        [0, -1],
      ],
      3,
    );

    expect(centroids).toEqual([
      [1, 0],
      [0, 1],
      [0, -1],
    ]);

    const autoCentroids = buildInitialCentroidsRust(
      Array.from({ length: 20 }, (_, index) => [index, index + 1]),
      0,
    );

    expect(autoCentroids).toHaveLength(4);
    expect(autoCentroids?.[0]).toEqual([0, 1]);
    expect(autoCentroids?.[3]).toEqual([19, 20]);
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

  it('returns BM25 document scores from flat posting data', () => {
    const scores = scoreBm25Rust(
      [
        {
          postings: [
            { docIndex: 0, termFrequency: 2, docLength: 3 },
            { docIndex: 1, termFrequency: 1, docLength: 4 },
          ],
        },
        {
          postings: [{ docIndex: 0, termFrequency: 1, docLength: 3 }],
        },
      ],
      2,
      3.5,
    );

    const firstTermIdf = Math.log((2 - 2 + 0.5) / (2 + 0.5) + 1);
    const secondTermIdf = Math.log((2 - 1 + 0.5) / (1 + 0.5) + 1);
    const bm25 = (idf: number, tf: number, docLength: number) =>
      idf * ((tf * (1.2 + 1)) / (tf + 1.2 * (1 - 0.75 + 0.75 * (docLength / 3.5))));

    expect(scores).not.toBeNull();
    expect(scores?.map((score) => score.index)).toEqual([0, 1]);
    expect(scores?.[0]?.score).toBeCloseTo(bm25(firstTermIdf, 2, 3) + bm25(secondTermIdf, 1, 3));
    expect(scores?.[1]?.score).toBeCloseTo(bm25(firstTermIdf, 1, 4));
  });

  it('returns RRF scores with retrieval source weights', () => {
    const score = calculateRrfScoreRust(
      {
        vector: 1,
        bm25: 3,
        structural: 2,
      },
      0.3,
    );

    const weighted = 0.7 * (1 / (60 + 1)) + 0.3 * (1 / (60 + 3)) + 0.12 * (1 / (60 + 2));
    const total = 0.7 * (1 / (60 + 1)) + 0.3 * (1 / (60 + 1)) + 0.12 * (1 / (60 + 1));

    expect(score).toBeCloseTo(weighted / total);
  });

  it('returns evidence-aware hybrid scores for strong graph sources', () => {
    const score = calculateHybridScoreRust({
      combinedBase: 0.2,
      rrfScore: 0.5,
      sourcePrior: 0.1,
      sourceEvidenceScore: 0.8,
      bestEvidenceRank: 3,
      retrievalSources: ['graph-local'],
    });

    expect(score).toBeCloseTo(0.58 + 0.8 * 0.25 + 0.5 * 0.08);
  });

  it('analyzes retrieval source evidence and priors through Rust', () => {
    const analysis = analyzeRetrievalSourcesRust(
      {
        ann: 0.7,
        structural: 0.9,
        'graph-local': 0.8,
      },
      {
        structural: 4,
        'graph-local': 2,
      },
    );

    expect(analysis).toEqual({
      sourcePrior: 0.28,
      sourceEvidenceScore: 0.9,
      bestEvidenceRank: 2,
      hasGraphOrStructuralEvidence: true,
      hasStrongGraphOrStructuralEvidence: true,
    });
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
        'graph-local': 0.8,
      },
      sourceRanks: {
        vector: 1,
        structural: 4,
        'graph-local': 2,
      },
      retrievalSources: ['vector', 'graph-local'],
    });
    const expectedRrf =
      (0.7 * (1 / 61) + 0.12 * (1 / 64) + 0.2 * (1 / 62)) / ((0.7 + 0.12 + 0.2) * (1 / 61));

    expect(plan).not.toBeNull();
    expect(plan?.combinedBase).toBeCloseTo(0.26);
    expect(plan?.rrfScore).toBeCloseTo(expectedRrf);
    expect(plan?.sourcePrior).toBeCloseTo(0.28);
    expect(plan?.sourceEvidenceScore).toBe(0.9);
    expect(plan?.bestEvidenceRank).toBe(2);
    expect(plan?.hasGraphOrStructuralEvidence).toBe(true);
    expect(plan?.hasStrongGraphOrStructuralEvidence).toBe(true);
    expect(plan?.combinedScore).toBeCloseTo(Math.min(0.58 + 0.9 * 0.25 + expectedRrf * 0.08, 0.88));
    expect(plan?.selectionReason).toBe('strong-graph-evidence');
  });

  it('evaluates RAG relevance threshold decisions through Rust', () => {
    expect(
      isRelevantResultRust({
        combinedScore: 0.1,
        vectorScore: -1,
        bm25Score: 0,
        keywordMatches: 0,
        threshold: 0.5,
        hasBm25: false,
        retrievalSources: ['graph-local'],
        sourceEvidenceScore: 0.8,
        bestEvidenceRank: 3,
      }),
    ).toBe(true);

    expect(
      isRelevantResultRust({
        combinedScore: 0.6,
        vectorScore: 0.2,
        bm25Score: 0.5,
        keywordMatches: 1,
        threshold: 0.5,
        hasBm25: true,
        retrievalSources: ['bm25'],
        sourceEvidenceScore: 0,
      }),
    ).toBe(true);

    expect(
      isRelevantResultRust({
        combinedScore: 0.2,
        vectorScore: 0.2,
        bm25Score: 0,
        keywordMatches: 0,
        threshold: 0.5,
        hasBm25: true,
        retrievalSources: ['bm25'],
        sourceEvidenceScore: 0,
      }),
    ).toBe(false);
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
          retrievalSources: ['graph-local'],
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

  it('plans retrieval candidate merge groups through Rust', () => {
    const plan = planMergedRetrievalCandidatesRust([
      {
        entryIndex: 0,
        source: 'vector',
        sourceScore: 0.4,
        rank: 2,
      },
      {
        entryIndex: 1,
        source: 'bm25',
        sourceScore: 0.8,
        rank: 1,
      },
      {
        entryIndex: 0,
        source: 'bm25',
        sourceScore: 0.9,
        rank: 1,
      },
      {
        entryIndex: 0,
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

  it('returns MMR diverse indexes with same-file penalties', () => {
    const indexes = selectDiverseIndicesRust(
      [
        { score: 1, vector: [1, 0], sourceKey: 1, headingKey: 1 },
        { score: 0.99, vector: [0.999, 0.001], sourceKey: 1, headingKey: 1 },
        { score: 0.96, vector: [0.96, 0.28], sourceKey: 2, headingKey: 0 },
      ],
      2,
    );

    expect(indexes).toEqual([0, 2]);
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

  it('returns graph community assignments and modularity from numeric edges', () => {
    const result = detectCommunitiesRust(4, [0, 2, 1], [1, 3, 2], [1, 1, 0.1], 20);

    expect(result).not.toBeNull();
    expect(result?.assignments).toEqual([0, 0, 1, 1]);
    expect(result?.communityIds).toEqual([0, 1]);
    expect(result?.modularity).toBeGreaterThan(0);
  });

  it('detects GraphRAG communities from string edge records through Rust', () => {
    const result = detectCommunitiesFromEdgesRust(
      [
        { source: 'paul', target: 'barnabas', weight: 1 },
        { source: 'mark', target: 'luke', weight: 1 },
        { source: 'barnabas', target: 'mark', weight: 0.1 },
      ],
      20,
    );

    expect(result).not.toBeNull();
    expect(result?.assignmentsById).toEqual([
      { entityId: 'barnabas', communityId: 1 },
      { entityId: 'luke', communityId: 0 },
      { entityId: 'mark', communityId: 0 },
      { entityId: 'paul', communityId: 1 },
    ]);
    expect(result?.communityIds).toEqual([0, 1]);
    expect(result?.modularity).toBeGreaterThan(0);
  });

  it('aggregates GraphRAG relation edges by unordered endpoint pair', () => {
    const edges = aggregateGraphEdgesRust([2, 1, 2, 0], [1, 2, 0, 3], [0.4, 0.6, 0.2, 0.9], 4);

    expect(edges).toEqual([
      { sourceIndex: 1, targetIndex: 2, weight: 1 },
      { sourceIndex: 0, targetIndex: 2, weight: 0.2 },
      { sourceIndex: 0, targetIndex: 3, weight: 0.9 },
    ]);
  });

  it('plans GraphRAG edge records from entity and relation endpoint strings through Rust', () => {
    expect(
      planGraphEdgeRecordsRust(
        ['entity::b', 'entity::a', 'entity::c'],
        ['entity::b', 'entity::a', 'entity::b', 'entity::c'],
        ['entity::a', 'entity::b', 'missing', 'entity::a'],
        [0.4, 0.6, 0.9, 0.2],
      ),
    ).toEqual([
      { source: 'entity::a', target: 'entity::b', weight: 1 },
      { source: 'entity::a', target: 'entity::c', weight: 0.2 },
    ]);
  });

  it('plans GraphRAG pruning indexes through Rust', () => {
    const plan = planGraphPruneRust({
      filePaths: ['old.md'],
      evidenceFilePaths: ['old.md', 'keep.md'],
      evidenceEntryIds: ['old.md::0', 'keep.md::0'],
      entitySchemaIds: ['default', 'default', 'default'],
      entityEvidenceIndices: [[0], [0, 1], [1]],
      relationSchemaIds: ['default', 'default'],
      relationSourceEntityIndices: [0, 1],
      relationTargetEntityIndices: [1, 2],
      relationEvidenceIndices: [[0], [0, 1]],
      claimEntityIndices: [[0], [0, 1, 2]],
      claimRelationIndices: [[0], [0, 1]],
      claimEvidenceIndices: [[0], [0, 1]],
      communitySchemaIds: ['default', 'other'],
      communityEntityIndices: [[0], [2]],
      communityRelationIndices: [[0], []],
      communityClaimIndices: [[0], []],
      rejectedFactFilePaths: ['old.md', 'keep.md'],
      rejectedFactEntryIds: ['old.md::0', 'keep.md::0'],
      extractionCacheEntryIds: ['old.md::0', 'keep.md::0'],
      pendingMergeExistingEntityIndices: [0, 2],
      pendingMergeCandidateEntityIndices: [2, 1],
    });

    expect(plan).toEqual({
      deletedEvidenceIndices: [0],
      deletedEntityIndices: [0],
      updatedEntityIndices: [1],
      updatedEntityEvidenceIndices: [[1]],
      deletedRelationIndices: [0],
      updatedRelationIndices: [1],
      updatedRelationEvidenceIndices: [[1]],
      deletedClaimIndices: [0],
      updatedClaimIndices: [1],
      updatedClaimEntityIndices: [[1, 2]],
      updatedClaimRelationIndices: [[1]],
      updatedClaimEvidenceIndices: [[1]],
      deletedCommunityIndices: [0],
      deletedRejectedFactIndices: [0],
      deletedExtractionCacheIndices: [0],
      deletedPendingMergeIndices: [0],
    });
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
    expect(planVaultLinkFallbackIndexRust('Romans', ['Paul', 'Romans', 'Romans'])).toBe(1);
    expect(planVaultLinkFallbackIndexRust('Missing', ['Paul', 'Romans'])).toBeNull();
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
        ],
        '확장자 없음',
      ),
    ).toEqual({
      targetTypes: [
        { extension: 'ts', label: '.ts', count: 2 },
        { extension: 'md', label: '.md', count: 1 },
      ],
      excludeRecommendations: [
        { extension: '(none)', label: '확장자 없음', count: 1, reason: 'sensitive' },
        { extension: 'png', label: '.png', count: 1, reason: 'binary' },
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
          recommendationReason: 'unreadable',
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
          recommendationReason: 'unreadable',
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
          line: 3,
          endLine: 5,
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
          line: 0,
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
    expect(planChatContextMentionsRust(['server', 'file', 'folder', 'entity', 'server'])).toEqual({
      fileIndices: [1],
      folderIndices: [2],
      entityIndices: [3],
      serverIndices: [0, 4],
      useAutoRag: true,
      autoRagReason: 'server-and-vault',
    });
    expect(planChatContextMentionsRust(['server'])).toEqual({
      fileIndices: [],
      folderIndices: [],
      entityIndices: [],
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

  it('plans GraphRAG mention context entity and relation indices through Rust', () => {
    expect(
      planGraphMentionContextRust(
        ['PAUL', 'apostle'],
        [
          {
            id: 'entity::paul',
            canonicalName: 'Paul',
            aliases: ['Saul', 'Apostle'],
            typeId: 'person',
            description: '사도 바울',
          },
          {
            id: 'entity::barnabas',
            canonicalName: 'Barnabas',
            aliases: [],
            typeId: 'person',
            description: '동역자',
          },
          {
            id: 'entity::mark',
            canonicalName: 'Mark',
            aliases: ['John Mark'],
            typeId: 'person',
            description: '마가',
          },
        ],
        [
          {
            sourceEntityId: 'entity::paul',
            targetEntityId: 'entity::barnabas',
            relationTypeId: 'worked_with',
            description: '함께 사역함',
          },
          {
            sourceEntityId: 'entity::mark',
            targetEntityId: 'entity::barnabas',
            relationTypeId: 'worked_with',
            description: '바나바와 동행',
          },
          {
            sourceEntityId: 'entity::mark',
            targetEntityId: 'entity::paul',
            relationTypeId: 'wrote_about',
            description: 'Paul 관련 기록',
          },
        ],
      ),
    ).toEqual({
      matchedEntityIndices: [0],
      matchedRelationIndices: [0, 2],
      contextLines: [
        '[Graph Knowledge Context]',
        '',
        '## Matched Entities',
        '- [person] Paul (aka Saul, Apostle)',
        '  사도 바울',
        '',
        '## Related Relations',
        '- Paul → [worked_with] → Barnabas',
        '  함께 사역함',
        '- Mark → [wrote_about] → Paul',
        '  Paul 관련 기록',
      ],
    });
  });

  it('plans GraphRAG claim entity id lookup through Rust normalization', () => {
    expect(
      planGraphClaimEntityIdsRust(
        [' PAUL ', 'Saul', 'Missing', 'Romans'],
        [
          { name: 'Paul', entityId: 'entity::paul' },
          { name: 'Saul', entityId: 'entity::paul' },
          { name: 'Romans', entityId: 'entity::romans' },
        ],
      ),
    ).toEqual(['entity::paul', 'entity::paul', 'entity::romans']);
  });

  it('plans GraphRAG relation endpoint indices through Rust normalization', () => {
    expect(
      planGraphRelationEndpointIndicesRust(
        [
          { source: 'Saul', target: 'Romans' },
          { source: 'Paul', target: 'Missing' },
        ],
        [
          { name: 'Paul', entityIndex: 0 },
          { name: 'Saul', entityIndex: 0 },
          { name: 'Romans', entityIndex: 1 },
        ],
        2,
      ),
    ).toEqual({
      pairs: [{ sourceEntityIndex: 0, targetEntityIndex: 1 }, null],
    });
  });

  it('plans GraphRAG extraction entity and claim type validation through Rust', () => {
    expect(
      planGraphExtractionTypeValidationRust(
        ['person', 'unknown_entity'],
        ['factual_claim', 'unknown_claim'],
        ['person', 'work'],
        ['factual_claim'],
      ),
    ).toEqual({
      entityTypeKnown: [true, false],
      claimTypeKnown: [true, false],
    });
  });

  it('plans GraphRAG community summary groups through Rust', () => {
    expect(
      planGraphCommunitySummaryGroupsRust(
        [
          { entityId: 'entity::paul', communityId: 7 },
          { entityId: 'entity::romans', communityId: 7 },
          { entityId: 'entity::grace', communityId: 8 },
        ],
        ['entity::paul', 'entity::romans', 'entity::grace'],
        [
          { sourceEntityId: 'entity::paul', targetEntityId: 'entity::romans' },
          { sourceEntityId: 'entity::paul', targetEntityId: 'entity::grace' },
        ],
        [
          { entityIds: ['entity::romans'] },
          { entityIds: ['entity::grace', 'entity::paul'] },
          { entityIds: ['entity::missing'] },
        ],
        [7, 8, 9],
      ),
    ).toEqual({
      groups: [
        { entityIndices: [0, 1], relationIndices: [0], claimIndices: [0] },
        { entityIndices: [2], relationIndices: [], claimIndices: [1] },
        { entityIndices: [], relationIndices: [], claimIndices: [] },
      ],
    });
  });

  it('plans GraphRAG markdown file path filtering through Rust', () => {
    expect(
      planGraphRagMarkdownFilePathsRust([
        'Notes/Paul.md',
        'Notes/Romans.MD',
        'Notes/archive.txt',
        'Notes/.md',
        '',
      ]),
    ).toEqual(['Notes/Paul.md', 'Notes/Romans.MD', 'Notes/.md']);
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

  it('plans GraphRAG virtual source verification through Rust', () => {
    expect(
      planContextGraphVerificationRust(
        'graph://community/community::mission',
        '지원하지 않는 GraphRAG 출처입니다.',
      ),
    ).toEqual({
      isGraphSource: true,
      verification: { status: 'verified', graphType: 'community' },
    });
    expect(
      planContextGraphVerificationRust(
        'graph://unknown/source',
        '지원하지 않는 GraphRAG 출처입니다.',
      ),
    ).toEqual({
      isGraphSource: true,
      verification: { status: 'missing', detail: '지원하지 않는 GraphRAG 출처입니다.' },
    });
    expect(
      planContextGraphVerificationRust('note.md', '지원하지 않는 GraphRAG 출처입니다.'),
    ).toEqual({
      isGraphSource: false,
      verification: null,
    });
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

  it('scores GraphRAG entity name matches through Rust', () => {
    expect(normalizeEntityNameRust('  Saul / Paul【Apostle】  ')).toBe('saul paul apostle');
    expect(createEntityIdRust('default', 'person', '  Saul / Paul【Apostle】  ')).toBe(
      'entity::default::person::saul-paul-apostle',
    );
    expect(createEntityIdRust('Def@ult', 'type/1', 'Paul & the apostle')).toBe(
      'entity::def-ult::type-1::paul---the-apostle',
    );

    const exactScore = scoreEntityMatchRust({
      candidateNames: ['Saul'],
      existingNames: ['Paul', 'Saul'],
      candidateDescription: 'Apostle',
      existingDescription: 'Paul Apostle',
      candidateEvidenceIds: [],
      existingEvidenceIds: [],
      sameType: true,
      embeddingScore: 0,
    });

    expect(exactScore).toBe(1);

    const partialScore = scoreEntityMatchRust({
      candidateNames: ['Apostle Paul'],
      existingNames: ['Paul the Apostle'],
      candidateDescription: 'Apostle missionary',
      existingDescription: 'Paul missionary',
      candidateEvidenceIds: ['evidence::acts'],
      existingEvidenceIds: ['evidence::acts'],
      sameType: true,
      embeddingScore: 0,
    });

    expect(partialScore).not.toBeNull();
    expect(partialScore).toBeGreaterThanOrEqual(0.72);
    expect(partialScore).toBeLessThan(1);

    expect(
      planEntityResolutionRust({
        ontologySchemaId: 'default',
        typeId: 'person',
        candidateEntityId: 'entity::default::person::saul',
        autoMergeThreshold: 0.88,
        pendingMergeThreshold: 0.72,
        candidates: [
          {
            entityId: 'entity::default::person::paul',
            ontologySchemaId: 'default',
            typeId: 'person',
            score: 0.71,
          },
          {
            entityId: 'entity::default::person::barnabas',
            ontologySchemaId: 'default',
            typeId: 'person',
            score: 0.73,
          },
          {
            entityId: 'entity::default::place::paul',
            ontologySchemaId: 'default',
            typeId: 'place',
            score: 1,
          },
        ],
      }),
    ).toEqual({
      status: 'pending-merge',
      entityId: 'entity::default::person::saul',
      matchedEntityId: 'entity::default::person::barnabas',
      mergeScore: 0.73,
    });
  });

  it('normalizes Graph extraction names, confidence, and IDs through Rust', () => {
    expect(normalizeGraphNameRust('  Saul / Paul【Apostle】  ')).toBe('saul paul apostle');

    expect(normalizeGraphConfidenceRust(1.4)).toBe(1);
    expect(normalizeGraphConfidenceRust(-0.2)).toBe(0);
    expect(normalizeGraphConfidenceRust(Number.NaN)).toBe(0.5);
    expect(normalizeGraphConfidenceRust('0.9')).toBe(0.5);

    expect(sanitizeGraphIdPartRust('  A+B 가/나:1.2  ')).toBe('a-b-가-나:1.2');
    expect(sanitizeGraphIdPartRust('!!!')).toBe('-');
    expect(createGraphIdRust(['claim', 'factual claim', '가 나', '!!!'])).toBe(
      'claim::factual-claim::가-나::-',
    );
    expect(
      createPendingEntityMergeIdRust('entity::de f@@ult::person::Paul the apostle', 'entity::x'),
    ).toBe('pending-entity-merge::entity::de-fult::person::paul-the-apostle::entity::x');
  });

  it('extracts Graph LLM JSON object text through Rust', () => {
    expect(extractJsonObjectRust('  {"entities":[]}  ')).toBe('{"entities":[]}');
    expect(
      extractJsonObjectRust(['결과입니다.', '```json', '{"claims":[]}', '```'].join('\n')),
    ).toBe('{"claims":[]}');
    expect(extractJsonObjectRust('prefix {"relations":[]} suffix')).toBe('{"relations":[]}');
    expect(extractJsonObjectRust('not-json')).toBeNull();
  });

  it('normalizes extracted Graph payload JSON through Rust', () => {
    const normalized = normalizeExtractedGraphPayloadRust(
      JSON.stringify({
        entities: {
          Base: { type: 'work', aliases: 'Base.base', confidence: 1.2 },
          표: { type_id: 'concept', desc: '  Table view  ' },
        },
        relations: {
          r1: { from: '표', to: 'Base', relation: 'part_of', score: 0.8 },
        },
        claims: [
          {
            subject: 'Base',
            object: '표',
            claim: "The work titled 'Base' contains a table view named '표'.",
            type: 'factual_claim',
            stance: 'supports',
            confidence: 0.7,
          },
        ],
      }),
    );

    expect(normalized).toEqual({
      payload: {
        entities: [
          { name: 'Base', typeId: 'work', aliases: ['Base.base'], confidence: 1.2 },
          { name: '표', typeId: 'concept', description: 'Table view' },
        ],
        relations: [{ source: '표', target: 'Base', relationTypeId: 'part_of', confidence: 0.8 }],
        claims: [
          {
            text: "The work titled 'Base' contains a table view named '표'.",
            claimTypeId: 'factual_claim',
            entityNames: ['Base', '표'],
            stance: 'supports',
            confidence: 0.7,
          },
        ],
      },
      rawFactCount: 4,
    });

    expect(
      normalizeExtractedGraphPayloadRust(
        JSON.stringify({ Paul: { typeId: 'person', description: 'Apostle' } }),
      ),
    ).toEqual({
      payload: {
        entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle' }],
        relations: [],
        claims: [],
      },
      rawFactCount: 1,
    });

    expect(normalizeExtractedGraphPayloadRust(JSON.stringify({ unexpected: true }))).toBeNull();
  });

  it('parses extracted Graph payload raw responses through Rust', () => {
    expect(
      parseExtractedGraphPayloadRust(
        ['결과입니다.', '```json', '{"entities":[{"name":"Paul","typeId":"person"}]}', '```'].join(
          '\n',
        ),
      ),
    ).toEqual({
      ok: true,
      payload: {
        entities: [{ name: 'Paul', typeId: 'person' }],
        relations: [],
        claims: [],
      },
    });
    expect(parseExtractedGraphPayloadRust('not-json')).toEqual({
      ok: false,
      reason: 'invalid-json',
      rawFact: 'not-json',
    });
    expect(parseExtractedGraphPayloadRust(JSON.stringify({ unexpected: true }))).toEqual({
      ok: false,
      reason: 'schema-shape-mismatch',
      rawFact: { unexpected: true },
    });
    expect(
      parseExtractedGraphPayloadRust(JSON.stringify({ entities: [{ name: 'Missing type' }] })),
    ).toEqual({
      ok: false,
      reason: 'schema-shape-mismatch',
      rawFact: { entities: [{ name: 'Missing type' }] },
    });
  });

  it('validates ontology relation domain and range through Rust', () => {
    const input = {
      entityTypeIds: ['person', 'work', 'place'],
      relationTypeIds: ['authored', 'mentions'],
      relationSourceTypeIds: [['person'], ['any']],
      relationTargetTypeIds: [['work'], ['any']],
      relationTypeId: 'authored',
      sourceTypeId: 'person',
      targetTypeId: 'work',
    };

    expect(validateOntologyRelationRust(input)).toEqual({ valid: true });
    expect(
      validateOntologyRelationRust({
        ...input,
        relationTypeId: 'mentions',
        sourceTypeId: 'place',
        targetTypeId: 'person',
      }),
    ).toEqual({ valid: true });
    expect(validateOntologyRelationRust({ ...input, relationTypeId: 'missing' })).toEqual({
      valid: false,
      reason: 'unknown-relation-type',
    });
    expect(validateOntologyRelationRust({ ...input, targetTypeId: 'missing' })).toEqual({
      valid: false,
      reason: 'unknown-entity-type',
    });
    expect(
      validateOntologyRelationRust({
        ...input,
        sourceTypeId: 'place',
        targetTypeId: 'person',
      }),
    ).toEqual({
      valid: false,
      reason: 'relation-domain-range-mismatch',
    });
  });

  it('finds mentioned GraphRAG entities through Rust with hints and Korean particles', () => {
    const matches = findMentionedEntityMatchesRust(
      '바울과 Barnabas 관계를 알려줘',
      [
        {
          ontologySchemaId: 'default',
          canonicalName: 'Paul',
          aliases: ['바울'],
        },
        {
          ontologySchemaId: 'default',
          canonicalName: 'Barnabas',
          aliases: ['바나바'],
        },
        {
          ontologySchemaId: 'other',
          canonicalName: 'Paul',
          aliases: ['바울'],
        },
        {
          ontologySchemaId: 'default',
          canonicalName: 'A',
          aliases: [],
        },
      ],
      'default',
      ['바울'],
    );

    expect(matches).toEqual([
      { index: 0, score: 1 },
      { index: 1, score: 0.94 },
    ]);

    expect(
      findMentionedEntityMatchesRust(
        'Apostle에 대해 알려줘',
        [
          {
            ontologySchemaId: 'default',
            canonicalName: 'A',
            aliases: [],
          },
        ],
        'default',
        [],
      ),
    ).toEqual([]);
  });

  it('plans deterministic GraphRAG query mode through Rust', () => {
    expect(planGraphQueryRust('근거가 어디에 있어?')).toEqual(
      expect.objectContaining({
        type: 'source-seeking',
        queryMode: 'local',
        evidenceFirst: true,
      }),
    );
    expect(planGraphQueryRust('Paul과 Barnabas의 차이를 비교해줘')).toEqual(
      expect.objectContaining({
        type: 'comparative',
        queryMode: 'hybrid',
        traversalDepth: 2,
        entityHints: ['Paul', 'Barnabas'],
      }),
    );
    expect(planGraphQueryRust('평범한 질문')).toEqual(
      expect.objectContaining({
        type: 'ordinary-rag',
        queryMode: 'none',
      }),
    );
  });

  it('plans GraphRAG LLM planner responses through Rust', () => {
    expect(
      planGraphQueryResponseRust(
        '응답입니다.\n```json\n{"type":"relational","queryMode":"hybrid","traversalDepth":2.8,"evidenceFirst":true,"entityHints":["Paul",3," ","Barnabas"]}\n```',
        '평범한 질문',
      ),
    ).toEqual({
      type: 'relational',
      queryMode: 'hybrid',
      traversalDepth: 2,
      evidenceFirst: true,
      entityHints: ['Paul', 'Barnabas'],
    });

    expect(planGraphQueryResponseRust('not-json', '근거가 어디에 있어?')).toEqual(
      expect.objectContaining({
        type: 'source-seeking',
        queryMode: 'local',
        evidenceFirst: true,
      }),
    );
  });

  it('extracts chat mention candidates through Rust', () => {
    const candidates = parseMentionCandidatesRust(
      '@browser @[Project Plan.md] @[Project Plan.md] @[entity: Paul] @Notes/today.md @missing',
    );

    expect(candidates).toEqual([
      { raw: '@[Project Plan.md]', name: 'Project Plan.md' },
      { raw: '@[entity: Paul]', name: 'entity: Paul' },
      { raw: '@browser', name: 'browser' },
      { raw: '@Notes/today.md', name: 'Notes/today.md' },
      { raw: '@missing', name: 'missing' },
    ]);
  });

  it('returns GraphRAG local evidence scores from numeric graph inputs', () => {
    const scores = scoreLocalEvidenceRust({
      entityCount: 3,
      matchEntityIndices: [0],
      matchScores: [0.9],
      matchEvidenceOffsets: [0, 1],
      matchEvidenceIndices: [0],
      relationSourceIndices: [0, 1],
      relationTargetIndices: [1, 2],
      relationConfidences: [0.8, 0.7],
      relationEvidenceOffsets: [0, 1, 2],
      relationEvidenceIndices: [1, 2],
      claimEntityOffsets: [0, 1, 2],
      claimEntityIndices: [0, 1],
      claimConfidences: [0.6, 0.5],
      claimEvidenceOffsets: [0, 1, 2],
      claimEvidenceIndices: [3, 4],
      evidenceCount: 5,
      traversalDepth: 2,
    });

    expect(scores).not.toBeNull();
    expect(scores?.map((score) => score.index)).toEqual([0, 1, 3, 3, 3, 1, 2, 4, 4]);
    expect(scores?.[0]?.score).toBeCloseTo(0.865);
    expect(scores?.[1]?.score).toBeCloseTo(0.72);
    expect(scores?.[2]?.score).toBeCloseTo(0.54);
    expect(scores?.[3]?.score).toBeCloseTo(0.54);
    expect(scores?.[4]?.score).toBeCloseTo(0.54);
    expect(scores?.[5]?.score).toBeCloseTo((0.9 * 0.8) / 1.45);
    expect(scores?.[6]?.score).toBeCloseTo((0.72 * 0.82 * 0.7) / 1.45);
    expect(scores?.[7]?.score).toBeCloseTo((0.72 * 0.82 * 0.5) / 1.35);
    expect(scores?.[8]?.score).toBeCloseTo((0.72 * 0.82 * 0.5) / 1.35);
  });

  it('plans GraphRAG local evidence scores from graph record snapshots through Rust', () => {
    const scores = planLocalEvidenceScoresRust({
      matches: [
        {
          entityId: 'entity::paul',
          entityConfidence: 0.9,
          matchScore: 1,
          evidenceIds: ['evidence::mention'],
        },
      ],
      relations: [
        {
          sourceEntityId: 'entity::paul',
          targetEntityId: 'entity::barnabas',
          confidence: 0.8,
          evidenceIds: ['evidence::relation-1'],
        },
        {
          sourceEntityId: 'entity::barnabas',
          targetEntityId: 'entity::mark',
          confidence: 0.7,
          evidenceIds: ['evidence::relation-2'],
        },
      ],
      claims: [
        {
          entityIds: ['entity::paul'],
          confidence: 0.6,
          evidenceIds: ['evidence::paul-claim'],
        },
        {
          entityIds: ['entity::barnabas'],
          confidence: 0.5,
          evidenceIds: ['evidence::barnabas-claim'],
        },
      ],
      traversalDepth: 2,
    });

    expect(scores).not.toBeNull();
    expect(scores?.map((score) => score.evidenceId)).toEqual([
      'evidence::mention',
      'evidence::relation-1',
      'evidence::paul-claim',
      'evidence::paul-claim',
      'evidence::paul-claim',
      'evidence::relation-1',
      'evidence::relation-2',
      'evidence::barnabas-claim',
      'evidence::barnabas-claim',
    ]);
    expect(scores?.[0]?.score).toBeCloseTo(0.865);
    expect(scores?.[1]?.score).toBeCloseTo(0.8 * 0.9);
    expect(scores?.[2]?.score).toBeCloseTo(0.9 * 0.6);
    expect(scores?.[5]?.score).toBeCloseTo((0.9 * 0.8) / 1.45);
    expect(scores?.[6]?.score).toBeCloseTo((0.72 * 0.82 * 0.7) / 1.45);
    expect(scores?.[7]?.score).toBeCloseTo((0.72 * 0.82 * 0.5) / 1.35);
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
      totalVectors: 14,
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

  it('plans GraphRAG status entry lookups through Rust', () => {
    expect(
      planGraphRagStatusEntryLookupsRust(
        ['note.md::0', 'stale.md::0'],
        ['note.md::0', 'cache-only.md::0'],
      ),
    ).toEqual(['note.md::0', 'stale.md::0', 'cache-only.md::0']);
  });

  it('plans GraphRAG status candidate file snapshot through Rust', () => {
    expect(
      planGraphRagStatusFileSnapshotRust(
        [
          { filePath: 'z.md', vectorCount: 2, processable: true },
          { filePath: 'Base.base', vectorCount: 1, processable: true },
          { filePath: 'foreign.md', vectorCount: 1, processable: false },
          { filePath: 'a.md', vectorCount: 1, processable: true },
          { filePath: 'z.md', vectorCount: 3, processable: true },
        ],
        [
          { filePath: 'fallback.md', processable: true },
          { filePath: 'clip.png', processable: true },
        ],
      ),
    ).toEqual({ fileRecordIndices: [0, 3], totalCandidateFiles: 2 });

    expect(
      planGraphRagStatusFileSnapshotRust(
        [
          { filePath: 'Base.base', vectorCount: 1, processable: true },
          { filePath: 'foreign.md', vectorCount: 1, processable: false },
        ],
        [
          { filePath: 'fallback.md', processable: true },
          { filePath: 'fallback.md', processable: true },
          { filePath: 'clip.png', processable: true },
          { filePath: 'blocked.md', processable: false },
          { filePath: 'second.md', processable: true },
        ],
      ),
    ).toEqual({ fileRecordIndices: [], totalCandidateFiles: 2 });
  });

  it('plans GraphRAG status vector entry snapshot through Rust', () => {
    expect(
      planGraphRagStatusEntrySnapshotRust([
        { id: 'fresh.md::0', filePath: 'fresh.md', processable: true },
        { id: 'Base.base::0', filePath: 'Base.base', processable: true },
        { id: 'foreign.md::0', filePath: 'foreign.md', processable: false },
        { id: 'fresh.md::0', filePath: 'fresh.md', processable: true },
        { id: 'second.md::0', filePath: 'second.md', processable: true },
      ]),
    ).toEqual({ entryIndices: [0, 4] });
  });

  it('plans GraphRAG status summary through Rust', () => {
    const status = planGraphRagStatusRust({
      graphRagEnabled: true,
      isRunning: false,
      schemaErrorCount: 0,
      totalCandidateFiles: 2,
      graphRagMaxFilesPerRun: 50,
      graphRagModel: 'model-new',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      extractionContractVersion: 1,
      fileRecords: [
        { filePath: 'fresh.md', vectorCount: 2 },
        { filePath: 'stale.md', vectorCount: 1 },
      ],
      evidence: [
        {
          filePath: 'fresh.md',
          entryId: 'fresh.md::0',
          contentHash: 'hash-a',
          extractionModelKey: 'model-new',
          processable: true,
        },
        {
          filePath: 'deleted.md',
          entryId: 'deleted.md::0',
          contentHash: 'old',
          extractionModelKey: 'model-new',
          processable: true,
        },
        {
          filePath: 'foreign.md',
          entryId: 'foreign.md::0',
          contentHash: 'foreign',
          extractionModelKey: 'model-new',
          processable: false,
        },
      ],
      rejectedFactFilePaths: ['fresh.md', 'fresh.md', 'bad.md'],
      pendingMergeCount: 2,
      cacheRecords: [
        {
          entryId: 'fresh.md::0',
          contentHash: 'hash-a',
          extractionModelKey: 'model-new',
          ontologySchemaId: 'default',
          ontologyVersion: 1,
          extractionContractVersion: 1,
        },
        {
          entryId: 'fresh.md::1',
          contentHash: 'hash-b',
          extractionModelKey: 'model-new',
          ontologySchemaId: 'default',
          ontologyVersion: 1,
          extractionContractVersion: 1,
        },
        {
          entryId: 'stale.md::0',
          contentHash: 'old-stale',
          extractionModelKey: 'model-old',
          ontologySchemaId: 'default',
          ontologyVersion: 1,
          extractionContractVersion: 1,
        },
      ],
      entries: [
        {
          id: 'fresh.md::0',
          filePath: 'fresh.md',
          contentHash: 'hash-a',
          text: 'unused',
        },
        {
          id: 'fresh.md::1',
          filePath: 'fresh.md',
          contentHash: 'hash-b',
          text: 'unused',
        },
        {
          id: 'stale.md::0',
          filePath: 'stale.md',
          text: 'changed body',
        },
      ],
    });

    expect(status).toEqual({
      state: 'stale',
      totalCandidateFiles: 2,
      graphEvidenceCount: 3,
      rejectedFactCount: 3,
      failedFileCount: 2,
      pendingMergeCount: 2,
      staleFileCount: 3,
      staleFilePaths: ['deleted.md', 'foreign.md', 'stale.md'],
      maxFilesPerRun: 50,
    });

    expect(
      planGraphRagStatusRust({
        graphRagEnabled: false,
        isRunning: false,
        schemaErrorCount: 0,
        totalCandidateFiles: 3,
        graphRagMaxFilesPerRun: 0,
        graphRagModel: 'model-new',
        ontologySchemaId: 'default',
        ontologyVersion: 1,
        extractionContractVersion: 1,
        fileRecords: [],
        evidence: [],
        rejectedFactFilePaths: [],
        pendingMergeCount: 0,
        cacheRecords: [],
        entries: [],
      }),
    ).toEqual({
      state: 'disabled',
      totalCandidateFiles: 3,
      graphEvidenceCount: 0,
      rejectedFactCount: 0,
      failedFileCount: 0,
      pendingMergeCount: 0,
      staleFileCount: 0,
      staleFilePaths: [],
      maxFilesPerRun: 1,
    });
  });

  it('plans GraphRAG run file selection and max-run window through Rust', () => {
    expect(
      planGraphRagRunFileSelectionRust({
        mode: 'full',
        failedFilePaths: ['failed.md'],
        staleFilePaths: ['stale.md'],
        recordFilePaths: [
          { filePath: 'z.md', processable: true },
          { filePath: 'Base.base', processable: true },
          { filePath: 'a.md', processable: false },
          { filePath: 'm.md', processable: true },
          { filePath: 'z.md', processable: true },
        ],
        indexedFilePaths: [{ filePath: 'fallback.md', processable: true }],
        maxFilesPerRun: 1,
      }),
    ).toEqual({
      candidateFilePaths: ['m.md', 'z.md'],
      selectedFilePaths: ['m.md'],
    });

    expect(
      planGraphRagRunFileSelectionRust({
        mode: 'failed',
        failedFilePaths: ['b.md', 'a.base', 'a.md', 'b.md'],
        staleFilePaths: ['stale.md'],
        recordFilePaths: [],
        indexedFilePaths: [],
        maxFilesPerRun: 8,
      }),
    ).toEqual({
      candidateFilePaths: ['a.md', 'b.md'],
      selectedFilePaths: ['a.md', 'b.md'],
    });

    expect(
      planGraphRagRunFileSelectionRust({
        mode: 'stale',
        failedFilePaths: ['failed.md'],
        staleFilePaths: ['deleted.md', 'Base.base', 'stale.md', 'stale.md'],
        recordFilePaths: [],
        indexedFilePaths: [],
        maxFilesPerRun: 1,
      }),
    ).toEqual({
      candidateFilePaths: ['deleted.md', 'stale.md'],
      selectedFilePaths: ['deleted.md'],
    });
  });

  it('plans unsupported GraphRAG prune paths through Rust', () => {
    expect(
      planGraphRagUnsupportedPrunePathsRust(
        [
          { filePath: 'Base.base', processable: false },
          { filePath: 'current.md', processable: true },
          { filePath: 'foreign.md', processable: false },
        ],
        [
          { filePath: 'foreign.md', processable: false },
          { filePath: 'old.canvas', processable: false },
          { filePath: 'current.md', processable: true },
        ],
      ),
    ).toEqual(['Base.base', 'foreign.md', 'old.canvas']);
  });

  it('plans Graph entity merge fields through Rust', () => {
    expect(
      planGraphEntityMergeRust(
        {
          aliases: ['Paul', 'Saul'],
          description: 'apostle',
          confidence: 0.6,
          evidenceIds: ['ev-1', 'ev-2'],
          updatedAt: 1000,
        },
        {
          aliases: ['Paul', 'Apostle Paul'],
          description: 'updated',
          confidence: 0.9,
          evidenceIds: ['ev-2', 'ev-3'],
          updatedAt: 2000,
        },
      ),
    ).toEqual({
      aliases: ['Paul', 'Saul', 'Apostle Paul'],
      description: 'updated',
      confidence: 0.9,
      evidenceIds: ['ev-1', 'ev-2', 'ev-3'],
      updatedAt: 2000,
    });

    expect(
      planGraphEntityMergeRust(
        {
          aliases: ['Paul'],
          description: 'existing description',
          confidence: 0.95,
          evidenceIds: ['ev-1'],
          updatedAt: 1000,
        },
        {
          aliases: ['Paul'],
          description: '',
          confidence: 0.5,
          evidenceIds: ['ev-1'],
          updatedAt: 3000,
        },
      ),
    ).toEqual({
      aliases: ['Paul'],
      description: 'existing description',
      confidence: 0.95,
      evidenceIds: ['ev-1'],
      updatedAt: 3000,
    });
  });

  it('checks Graph extraction cache hits through Rust', () => {
    const cached = {
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'model-a',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      extractionContractVersion: 1,
    };

    expect(isGraphExtractionCacheHitRust(cached, cached)).toBe(true);
    expect(
      isGraphExtractionCacheHitRust(cached, {
        ...cached,
        contentHash: 'hash-b',
      }),
    ).toBe(false);
    expect(
      isGraphExtractionCacheHitRust(cached, {
        ...cached,
        extractionModelKey: 'model-b',
      }),
    ).toBe(false);
    expect(isGraphExtractionCacheHitRust(null, cached)).toBe(false);
  });

  it('plans Graph store deletion indices through Rust', () => {
    expect(
      planGraphDeletionIndicesRust(
        ['old.md', 'keep.md', 'old.md', 'other.md'],
        ['old.md', 'missing.md'],
      ),
    ).toEqual([0, 2]);

    expect(planGraphDeletionIndicesRust(['a', 'b'], [])).toEqual([]);
    expect(planGraphDeletionIndicesRust([], ['a'])).toEqual([]);
  });

  it('plans claim evidence scores and candidate ordering through Rust', () => {
    const scores = planClaimEvidenceScoresRust([
      { confidence: 0.8, evidenceIds: ['a', 'b'] },
      { confidence: 2, evidenceIds: ['b', 'c'] },
      { confidence: -1, evidenceIds: ['', 'd'] },
    ]);

    expect(scores).toEqual([
      { evidenceId: 'a', score: 0.6000000000000001 },
      { evidenceId: 'b', score: 0.6000000000000001 },
      { evidenceId: 'b', score: 1 },
      { evidenceId: 'c', score: 1 },
      { evidenceId: 'd', score: 0 },
    ]);

    expect(planEvidenceCandidateOrderRust(scores ?? [], ['a', 'b', 'c', 'd'])).toEqual([
      { evidenceId: 'b', score: 1 },
      { evidenceId: 'c', score: 1 },
      { evidenceId: 'a', score: 0.6000000000000001 },
      { evidenceId: 'd', score: 0 },
    ]);
  });

  it('plans Graph evidence candidate lookup through Rust', () => {
    expect(
      planGraphEvidenceCandidateLookupRust(
        [
          { evidenceId: 'ev-b', score: 0.9 },
          { evidenceId: 'missing', score: 0.8 },
          { evidenceId: 'ev-a', score: 0.7 },
          { evidenceId: 'ev-b', score: 0.6 },
        ],
        [
          { id: 'ev-a', filePath: 'a.md' },
          { id: 'ev-b', filePath: 'b.md' },
        ],
      ),
    ).toEqual({
      scoreIndices: [0, 2, 3],
      evidenceIndices: [1, 0, 1],
      filePaths: ['b.md', 'a.md'],
    });

    expect(planGraphEvidenceCandidateLookupRust([], [{ id: 'ev-a', filePath: 'a.md' }])).toEqual({
      scoreIndices: [],
      evidenceIndices: [],
      filePaths: [],
    });
  });

  it('plans Graph evidence entry candidates through Rust', () => {
    expect(
      planGraphEvidenceEntryCandidatesRust(
        ['entry-b', 'missing', 'entry-a', 'entry-b', 'entry-c'],
        [
          { id: 'entry-a', compatible: true },
          { id: 'entry-b', compatible: true },
          { id: 'entry-c', compatible: false },
        ],
        3,
      ),
    ).toEqual({
      candidateIndices: [0, 2],
      entryIndices: [1, 0],
    });

    expect(
      planGraphEvidenceEntryCandidatesRust(['entry-a'], [{ id: 'entry-a', compatible: true }], 0),
    ).toEqual({
      candidateIndices: [],
      entryIndices: [],
    });
  });

  it('plans Graph query execution strategy through Rust', () => {
    expect(planGraphQueryExecutionRust('global', 'local', true)).toEqual({
      action: 'global',
      requiresPlanner: false,
    });
    expect(planGraphQueryExecutionRust('local', 'global', false)).toEqual({
      action: 'local',
      requiresPlanner: true,
    });
    expect(planGraphQueryExecutionRust('hybrid', 'none', false)).toEqual({
      action: 'hybrid',
      requiresPlanner: true,
    });
    expect(planGraphQueryExecutionRust('auto', 'none', false)).toEqual({
      action: 'none',
      requiresPlanner: true,
    });
    expect(planGraphQueryExecutionRust('auto', 'hybrid', false)).toEqual({
      action: 'hybrid',
      requiresPlanner: true,
    });
    expect(planGraphQueryExecutionRust('auto', 'global', true)).toEqual({
      action: 'global',
      requiresPlanner: true,
    });
    expect(planGraphQueryExecutionRust('auto', 'local', true)).toEqual({
      action: 'evidence-first',
      requiresPlanner: true,
    });
  });

  it('plans Graph relation schema filtering indexes through Rust', () => {
    expect(
      planGraphSchemaRelationIndicesRust(
        ['daily-notes', 'project-notes', 'daily-notes', 'archive'],
        'daily-notes',
      ),
    ).toEqual([0, 2]);
    expect(
      planGraphSchemaRelationIndicesRust(
        ['daily-notes', 'project-notes', 'daily-notes', 'archive'],
        'missing-schema',
      ),
    ).toEqual([]);
  });

  it('plans Graph community schema filtering indexes through Rust', () => {
    expect(
      planGraphSchemaCommunityIndicesRust(
        ['daily-notes', 'project-notes', 'daily-notes', 'archive'],
        'daily-notes',
      ),
    ).toEqual([0, 2]);
    expect(
      planGraphSchemaCommunityIndicesRust(
        ['daily-notes', 'project-notes', 'daily-notes', 'archive'],
        'missing-schema',
      ),
    ).toEqual([]);
  });

  it('plans Graph community replacement delete ids through Rust', () => {
    expect(
      planGraphCommunityReplacementDeleteIdsRust(
        [
          { id: 'community-a', ontologySchemaId: 'daily-notes' },
          { id: 'community-b', ontologySchemaId: 'project-notes' },
          { id: 'community-c', ontologySchemaId: 'daily-notes' },
        ],
        'daily-notes',
      ),
    ).toEqual(['community-a', 'community-c']);
    expect(
      planGraphCommunityReplacementDeleteIdsRust(
        [{ id: 'community-a', ontologySchemaId: 'daily-notes' }],
        'missing-schema',
      ),
    ).toEqual([]);
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
});
