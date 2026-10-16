import { TFile, TFolder, getAllTags, type App } from 'obsidian';
import type { QueryResult } from '../rag/query';
import type {
  RetrievalProviderDiagnostic,
  RetrievalProviderReadiness,
} from '../rag/retrieval-pipeline';
import {
  createContextPreviewRust,
  planSourceMetadataRust,
  planNativeVaultFilteredIndicesRust,
  planNativeVaultLexicalBatchRust,
  planNativeVaultLexicalHitRust,
  planNativeVaultLinkPathsRust,
  planNativeVaultListRust,
  planNativeVaultReadRangeRust,
  planNativeVaultSearchRrfRust,
  planNativeVaultStatsRust,
  isExtractableSourceExtensionRust,
  isSourceRevisionCurrentRust,
  normalizeVaultLinkTargetRust,
  type RustNativeVaultToolRequest,
  type RustNativeVaultFilters,
  type RustNativeVaultLexicalState,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';
import type {
  NativeVaultLinksResult,
  NativeVaultListResult,
  NativeVaultReadResult,
  NativeVaultRelatedResult,
  NativeVaultSearchHit,
  NativeVaultSearchResult,
  NativeVaultStatsResult,
  NativeVaultToolPort,
} from './native-vault-tool';
import { truncateUtf8Text } from '../utils/text-budget';
import { readSourceFileSnapshot } from '../rag/source-snapshot';
import { readSourceText } from '../rag/source-access';
import type { SourceProcessingSummary } from '../rag/source-processing';
import { appLogger } from '../utils/logger';

const MAX_READ_LINES = 400;
const LEXICAL_READ_BATCH_SIZE = 8;
const MAX_RETRIEVAL_SOURCES = 8;
const MAX_RELATED_SEED_LINES = 80;
const MAX_RELATED_SEED_BYTES = 12 * 1024;
const MAX_INDEXED_EVIDENCE_LINES = 80;

export interface NativeVaultQueryEngineLike {
  query(
    question: string,
    topK: number,
    minScore?: number,
    filePathPrefixes?: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<QueryResult[]>;
  getLastRetrievalDiagnostics?(): readonly RetrievalProviderDiagnostic[];
  getIndexReadiness?(
    files: readonly { path: string; mtime: number; size: number }[],
  ): Promise<RetrievalProviderReadiness | null>;
}

export interface NativeVaultFileScope {
  listCandidateFiles(): Promise<readonly TFile[]>;
  isCandidateFile(file: TFile): Promise<boolean>;
  /** 명시적으로 지정한 파일 읽기 허용 여부(확장자 제외는 무시, 경로·민감 파일 제외는 유지) */
  isExplicitReadAllowed(file: TFile): Promise<boolean>;
  isPathVisible(path: string): boolean;
}

interface NativeVaultListSnapshot {
  path: string;
  filtersKey: string;
  expectedCursor: number;
  files: readonly TFile[];
}

interface IndexedSearchCandidate {
  query: string;
  queryIndex: number;
  rank: number;
  result: QueryResult;
}

interface IndexedSearchAttempt {
  candidates: IndexedSearchCandidate[];
  diagnosticsByQuery: RetrievalProviderDiagnostic[][];
  indexReadiness: RetrievalProviderReadiness | null;
  inventoryFiles: readonly TFile[] | null;
  failed: boolean;
}

interface LexicalSearchCandidate {
  queryIndex: number;
  rank: number;
  hit: NativeVaultSearchHit;
}

export class ObsidianNativeVaultToolPort implements NativeVaultToolPort {
  private listSnapshot: NativeVaultListSnapshot | null = null;

  constructor(
    private readonly app: App,
    private readonly fileScope: NativeVaultFileScope,
    private readonly getQueryEngine: () => NativeVaultQueryEngineLike | null = () => null,
    private readonly getSourceProcessing?: (
      files: readonly TFile[],
    ) => Promise<SourceProcessingSummary | null>,
  ) {}

  async search(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultSearchResult> {
    throwIfAborted(signal);
    const queries = getSearchQueries(request);
    // 폴더·필터 없이 볼트 전체를 훑는 라이브 폴백에서만 추출 비용이 큰 문서를 건너뜁니다.
    const blindLiveFallback = !request.path.trim() && request.filters === undefined;
    const filteredFiles = request.filters
      ? this.filterFiles(await this.fileScope.listCandidateFiles(), request.filters, request.path)
      : undefined;
    if (
      request.mode === 'exact' ||
      request.mode === 'word' ||
      (request.field !== undefined && request.field !== 'both')
    ) {
      return this.searchLexically(
        request,
        queries,
        filteredFiles ?? (await this.fileScope.listCandidateFiles()),
        signal,
      );
    }
    const indexedAttempt = await this.tryIndexedSearch(request, queries, signal, filteredFiles);
    throwIfAborted(signal);
    if (indexedAttempt !== null) {
      const allowedPaths = filteredFiles
        ? new Set(filteredFiles.map((file) => file.path))
        : undefined;
      const visible = await this.filterVisibleIndexedCandidates(
        indexedAttempt.candidates.filter(
          (candidate) => !allowedPaths || allowedPaths.has(candidate.result.sourcePath),
        ),
      );
      const needsLiveLexicalFallback =
        visible.length === 0 ||
        request.filters !== undefined ||
        shouldUseLiveLexicalFallback(indexedAttempt);
      if (visible.length > 0) {
        const indexedResult = await this.verifyCurrentSearchEvidence(
          buildIndexedSearchResult(request, queries, visible),
          signal,
          visible,
        );
        if (!needsLiveLexicalFallback && indexedResult.hits.length > 0) return indexedResult;
        const files =
          filteredFiles ??
          indexedAttempt.inventoryFiles ??
          (await this.fileScope.listCandidateFiles());
        const lexicalResult = await this.searchLexically(
          request,
          queries,
          files,
          signal,
          blindLiveFallback,
        );
        return lexicalResult.hits.length > 0
          ? mergeIndexedAndLexicalSearchResults(request, queries, indexedResult, lexicalResult)
          : indexedResult;
      }
      if (!needsLiveLexicalFallback) {
        return buildSearchResult(request.query, queries, request.path, request.match, [], {
          // topK 인덱스 miss도 전체 Vault 부재를 증명하지 않습니다.
          truncated: true,
        });
      }
    }

    const files =
      filteredFiles ??
      indexedAttempt?.inventoryFiles ??
      (await this.fileScope.listCandidateFiles());
    return this.searchLexically(request, queries, files, signal, blindLiveFallback);
  }

  async read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultReadResult> {
    throwIfAborted(signal);
    const file = this.resolveVaultFile(request.path);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    if (!(await this.fileScope.isExplicitReadAllowed(file))) {
      throw new Error(t('nativeVaultFileUnreadable', { path: request.path }));
    }
    throwIfAborted(signal);
    const content = (await awaitWithAbort(readSourceText(this.app.vault, file), signal)).text;
    throwIfAborted(signal);
    const lines = content.split('\n');
    const range = planNativeVaultReadRangeRust(
      lines.length,
      request.startLine,
      request.endLine,
      MAX_READ_LINES,
    );
    if (!range) throw new Error(t('nativeVaultReadRangeFailed', { path: request.path }));
    const selectedLines = lines.slice(range.startLine - 1, range.endLine);
    const firstLine = selectedLines[0] ?? '';
    const startOffset = request.startOffset ?? 0;
    if (!isSafeStringOffset(firstLine, startOffset)) {
      throw new Error(t('nativeVaultInvalidLineRange'));
    }
    selectedLines[0] = firstLine.slice(startOffset);
    const selectedContent = selectedLines.join('\n');
    const metadata = planSourceMetadataRust(content) ?? undefined;
    const citation = createCitation(
      file.path,
      range.startLine,
      range.endLine,
      createContextPreviewRust(selectedContent) ?? '',
    );
    return {
      action: 'read',
      path: file.path,
      startLine: range.startLine,
      startOffset,
      endLine: range.endLine,
      nextStartLine: range.truncated ? range.endLine + 1 : null,
      nextStartOffset: range.truncated ? 0 : null,
      totalLines: lines.length,
      truncated: range.truncated,
      content: selectedContent,
      metadata,
      citations: [
        citation,
        ...(metadata?.evidence ?? []).map((passage) =>
          createCitation(file.path, passage.startLine, passage.endLine, passage.content),
        ),
      ],
    };
  }

  async related(
    request: Extract<RustNativeVaultToolRequest, { action: 'related' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultRelatedResult> {
    throwIfAborted(signal);
    const engine = this.getQueryEngine();
    if (!engine) throw new Error(t('nativeVaultPlanUnavailable'));
    const file = this.resolveVaultFile(request.path);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    if (!(await this.fileScope.isExplicitReadAllowed(file))) {
      throw new Error(t('nativeVaultFileUnreadable', { path: request.path }));
    }
    const content = (await awaitWithAbort(readSourceText(this.app.vault, file), signal)).text;
    const lines = content.split('\n');
    const range = planNativeVaultReadRangeRust(
      lines.length,
      request.startLine,
      request.endLine,
      MAX_RELATED_SEED_LINES,
    );
    if (!range) throw new Error(t('nativeVaultInvalidLineRange'));
    const seed = truncateUtf8Text(
      lines.slice(range.startLine - 1, range.endLine).join('\n'),
      MAX_RELATED_SEED_BYTES,
      '',
    ).text;
    if (!seed.trim()) throw new Error(t('nativeVaultPlanUnavailable'));
    const results = await awaitWithAbort(
      engine.query(seed, Math.min(20, request.limit + 4), 0, undefined, {
        ...(signal ? { signal } : {}),
      }),
      signal,
    );
    const relatedResults = results.filter((result) => result.sourcePath !== file.path);
    const candidates = await this.filterVisibleIndexedCandidates(
      relatedResults.slice(0, request.limit).map((result, index) => ({
        query: seed,
        queryIndex: 0,
        rank: index + 1,
        result,
      })),
    );
    const search = await this.verifyCurrentSearchEvidence(
      buildIndexedSearchResult(
        {
          action: 'search',
          query: seed,
          queries: [seed],
          path: '',
          limit: request.limit,
          match: 'any',
        },
        [seed],
        candidates,
      ),
      signal,
      candidates,
    );
    return {
      action: 'related',
      path: file.path,
      startLine: range.startLine,
      endLine: range.endLine,
      hits: search.hits,
      truncated: relatedResults.length > candidates.length,
      citations: search.citations,
    };
  }

  async list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultListResult> {
    throwIfAborted(signal);
    const files = await this.getListCandidateFiles(request.path, request.cursor, request.filters);
    throwIfAborted(signal);
    const plan = planNativeVaultListRust(
      files.map((file) => file.path),
      request.path,
      request.cursor,
      request.limit,
    );
    if (!plan) {
      this.listSnapshot = null;
      throw new Error(t('nativeVaultListFailed'));
    }
    this.listSnapshot =
      plan.nextCursor === null
        ? null
        : {
            path: request.path,
            filtersKey: JSON.stringify(request.filters ?? null),
            expectedCursor: plan.nextCursor,
            files,
          };
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const requestedPath = this.app.vault.getAbstractFileByPath(request.path);
    return {
      action: 'list',
      path: request.path,
      exists:
        this.fileScope.isPathVisible(request.path) &&
        (request.path.length === 0 || plan.total > 0 || requestedPath instanceof TFolder),
      files: plan.paths.flatMap((path) => {
        const file = filesByPath.get(path);
        return file ? [{ path: file.path, modifiedAt: file.stat.mtime, size: file.stat.size }] : [];
      }),
      nextCursor: plan.nextCursor,
      total: plan.total,
      ...(request.filters ? { filters: request.filters, scopeRestricted: true } : {}),
      citations: [],
    };
  }

  async links(
    request: Extract<RustNativeVaultToolRequest, { action: 'links' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultLinksResult> {
    throwIfAborted(signal);
    const files = await this.fileScope.listCandidateFiles();
    throwIfAborted(signal);
    const candidatePaths = new Set(files.map((candidate) => candidate.path));
    const file = this.resolveCandidateFile(request.path, files);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const outgoingCandidates = Object.keys(resolvedLinks[file.path] ?? {}).filter((path) =>
      candidatePaths.has(path),
    );
    const incomingCandidates = Object.entries(resolvedLinks).flatMap(([sourcePath, targets]) =>
      Object.hasOwn(targets, file.path) && candidatePaths.has(sourcePath) ? [sourcePath] : [],
    );
    const outgoing =
      request.direction === 'incoming'
        ? []
        : (planNativeVaultLinkPathsRust(outgoingCandidates, request.limit) ?? []);
    const incoming =
      request.direction === 'outgoing'
        ? []
        : (planNativeVaultLinkPathsRust(incomingCandidates, request.limit) ?? []);
    return {
      action: 'links',
      path: file.path,
      direction: request.direction,
      outgoing,
      incoming,
      totalOutgoing: request.direction === 'incoming' ? 0 : outgoingCandidates.length,
      totalIncoming: request.direction === 'outgoing' ? 0 : incomingCandidates.length,
      truncated:
        outgoing.length < outgoingCandidates.length || incoming.length < incomingCandidates.length,
      citations: [],
    };
  }

  async stats(
    _request: Extract<RustNativeVaultToolRequest, { action: 'stats' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultStatsResult> {
    throwIfAborted(signal);
    const files = await this.fileScope.listCandidateFiles();
    throwIfAborted(signal);
    const plan = planNativeVaultStatsRust(files.map((file) => file.stat.size));
    if (!plan) throw new Error(t('nativeVaultStatsFailed'));
    let processing: SourceProcessingSummary | null | undefined;
    try {
      processing = await this.getSourceProcessing?.(files);
    } catch (error) {
      throwIfAborted(signal);
      appLogger.warn('Source processing diagnostics unavailable.', {
        source: 'agent.vault.stats',
        error,
      });
    }
    throwIfAborted(signal);
    return { action: 'stats', ...plan, ...(processing ? { processing } : {}), citations: [] };
  }

  private async tryIndexedSearch(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    queries: readonly string[],
    signal?: AbortSignal,
    filteredFiles?: readonly TFile[],
  ): Promise<IndexedSearchAttempt | null> {
    const engine = this.getQueryEngine();
    if (!engine) return null;
    if (filteredFiles?.length === 0) return null;

    const candidates: IndexedSearchCandidate[] = [];
    const diagnosticsByQuery: RetrievalProviderDiagnostic[][] = [];
    let indexReadiness: RetrievalProviderReadiness | null = null;
    let inventoryFiles: readonly TFile[] | null = null;
    let failed = false;
    if (engine.getIndexReadiness) {
      try {
        throwIfAborted(signal);
        inventoryFiles = await this.fileScope.listCandidateFiles();
        throwIfAborted(signal);
        indexReadiness = await engine.getIndexReadiness(
          inventoryFiles.map((file) => ({
            path: file.path,
            mtime: file.stat.mtime,
            size: file.stat.size,
          })),
        );
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw error;
        failed = true;
      }
    }
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      const query = queries[queryIndex];
      if (!query) continue;
      try {
        throwIfAborted(signal);
        const results = await awaitWithAbort(
          engine.query(
            query,
            request.limit,
            undefined,
            filteredFiles
              ? filteredFiles.map((file) => file.path)
              : request.path
                ? [request.path]
                : undefined,
            {
              signal,
            },
          ),
          signal,
        );
        throwIfAborted(signal);
        candidates.push(
          ...results.slice(0, request.limit).map((result, index) => ({
            query,
            queryIndex,
            rank: index + 1,
            result,
          })),
        );
        const queryDiagnostics = engine.getLastRetrievalDiagnostics?.() ?? [];
        diagnosticsByQuery.push([...queryDiagnostics]);
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw error;
        failed = true;
        diagnosticsByQuery.push([]);
      }
    }
    return { candidates, diagnosticsByQuery, indexReadiness, inventoryFiles, failed };
  }

  private async filterVisibleIndexedCandidates(
    candidates: readonly IndexedSearchCandidate[],
  ): Promise<IndexedSearchCandidate[]> {
    const visibilityByPath = new Map<string, Promise<boolean>>();
    const visible = await Promise.all(
      candidates.map(async (candidate) => {
        let visibility = visibilityByPath.get(candidate.result.sourcePath);
        if (!visibility) {
          visibility = this.isIndexedPathVisible(candidate.result.sourcePath);
          visibilityByPath.set(candidate.result.sourcePath, visibility);
        }
        return (await visibility) ? candidate : null;
      }),
    );
    return visible.filter((candidate): candidate is IndexedSearchCandidate => candidate !== null);
  }

  private async verifyCurrentSearchEvidence(
    result: NativeVaultSearchResult,
    signal?: AbortSignal,
    candidates: readonly IndexedSearchCandidate[] = [],
  ): Promise<NativeVaultSearchResult> {
    const hits: NativeVaultSearchHit[] = [];
    for (let offset = 0; offset < result.hits.length; offset += LEXICAL_READ_BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = result.hits.slice(offset, offset + LEXICAL_READ_BATCH_SIZE);
      hits.push(
        ...(await Promise.all(
          batch.map((hit) => this.verifyCurrentSearchHit(hit, signal, candidates)),
        )),
      );
    }
    return buildSearchResult(
      result.query,
      result.queries ?? [result.query],
      result.path,
      result.match,
      hits,
      {
        scannedFiles: result.scannedFiles,
        unreadableFiles: result.unreadableFiles,
        totalHits: result.totalHits,
        truncated: result.truncated,
        scopeRestricted: result.scopeRestricted,
        filters: result.filters,
        mode: result.mode,
        field: result.field,
      },
    );
  }

  private async verifyCurrentSearchHit(
    hit: NativeVaultSearchHit,
    signal?: AbortSignal,
    candidates: readonly IndexedSearchCandidate[] = [],
  ): Promise<NativeVaultSearchHit> {
    throwIfAborted(signal);
    const file = this.resolveVaultFile(hit.path);
    if (!file) return hit;
    try {
      const snapshot = await awaitWithAbort(readSourceFileSnapshot(this.app.vault, file), signal);
      throwIfAborted(signal);
      if (!snapshot) return hit;
      const source = candidates.find(
        (candidate) =>
          candidate.result.sourcePath === hit.path &&
          zeroBasedLineToOneBased(candidate.result.chunkRange.startLine) === hit.startLine,
      );
      const metadata = source?.result.entry.metadata;
      if (
        !metadata ||
        !isSourceRevisionCurrentRust(
          {
            filePath: metadata.filePath,
            sourceMtime: metadata.sourceMtime ?? -1,
            sourceSize: metadata.sourceSize ?? -1,
            contentHash: metadata.contentHash ?? '',
          },
          snapshot.revision,
        )
      )
        return hit;
      const content = snapshot.content;
      const lines = content.split('\n');
      const range = planNativeVaultReadRangeRust(
        lines.length,
        hit.startLine,
        hit.endLine ?? null,
        MAX_INDEXED_EVIDENCE_LINES,
      );
      if (!range) return hit;
      const preview = lines.slice(range.startLine - 1, range.endLine).join('\n');
      if (!preview.trim()) return hit;
      const verified = { ...hit };
      delete verified.requiresRead;
      return {
        ...verified,
        startLine: range.startLine,
        endLine: range.endLine,
        preview,
        metadata: planSourceMetadataRust(content) ?? undefined,
        recommendedReadRange: {
          startLine: range.startLine,
          endLine: range.endLine,
        },
        citationStatus: 'verified',
      };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      return hit;
    }
  }

  private async isIndexedPathVisible(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return (
      file instanceof TFile &&
      this.fileScope.isPathVisible(file.path) &&
      (await this.fileScope.isCandidateFile(file))
    );
  }

  private async searchLexically(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    queries: readonly string[],
    files: readonly TFile[],
    signal?: AbortSignal,
    skipExtractedSources = false,
  ): Promise<NativeVaultSearchResult> {
    throwIfAborted(signal);
    const scannableFiles = skipExtractedSources
      ? files.filter((file) => !requiresSourceExtraction(file.extension ?? ''))
      : files;
    const skippedFiles = files.length - scannableFiles.length;
    const scope = planNativeVaultListRust(
      scannableFiles.map((file) => file.path),
      request.path,
      0,
      scannableFiles.length,
    );
    if (!scope) throw new Error(t('nativeVaultSearchScopeFailed'));
    const filesByPath = new Map(scannableFiles.map((file) => [file.path, file]));
    let state: RustNativeVaultLexicalState | null = null;
    for (let offset = 0; offset < scope.paths.length; offset += LEXICAL_READ_BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = scope.paths.slice(offset, offset + LEXICAL_READ_BATCH_SIZE);
      const entries = await Promise.all(
        batch.map(async (path) => {
          const file = filesByPath.get(path);
          if (!file) return { path, content: null };
          try {
            return {
              path,
              content:
                request.field === 'path'
                  ? ''
                  : (await awaitWithAbort(readSourceText(this.app.vault, file), signal)).text,
            };
          } catch {
            return { path, content: null };
          }
        }),
      );
      throwIfAborted(signal);
      state = planNativeVaultLexicalBatchRust(
        { ...request, queries: [...queries] },
        entries,
        state,
      );
      if (!state) throw new Error(t('nativeVaultSearchScopeFailed'));
    }
    const candidates: LexicalSearchCandidate[] = [];
    for (const [queryIndex, stream] of (state?.streams ?? []).entries()) {
      for (const [rankIndex, entry] of stream.entries()) {
        const recommendedReadRange = boundRecommendedReadRange(entry.startLine, entry.endLine);
        candidates.push({
          queryIndex,
          rank: rankIndex + 1,
          hit: {
            path: entry.path,
            startLine: recommendedReadRange.startLine,
            endLine: recommendedReadRange.endLine,
            preview: entry.preview,
            passages: entry.passages,
            metadata: entry.metadata,
            retrievalSources: ['live-lexical'],
            selectionReason: 'keyword',
            matchedQueries: queries[queryIndex] ? [queries[queryIndex]] : [],
            recommendedReadRange,
            citationStatus: 'candidate',
            requiresRead: true,
          },
        });
      }
    }
    const plan = planNativeVaultSearchRrfRust(
      candidates.map((candidate) => ({
        entryId: candidate.hit.path,
        queryIndex: candidate.queryIndex,
        rank: candidate.rank,
      })),
      queries.length,
      request.limit,
    );
    if (!plan) throw new Error(t('nativeVaultSearchScopeFailed'));
    const hits = plan.hits.flatMap((hitPlan) => {
      const representative = candidates[hitPlan.representativeCandidateIndex];
      if (!representative) return [];
      return [
        {
          ...representative.hit,
          score: hitPlan.rrfScore,
          matchedQueries: hitPlan.matchedQueryIndices.flatMap((index) =>
            queries[index] ? [queries[index]] : [],
          ),
        },
      ];
    });
    return buildSearchResult(request.query, queries, request.path, request.match, hits, {
      scannedFiles: state?.scannedFiles ?? 0,
      unreadableFiles: state?.unreadableFiles ?? 0,
      totalHits: state?.totalHits ?? 0,
      truncated: (state?.totalHits ?? 0) > hits.length || skippedFiles > 0,
      ...(skippedFiles > 0 ? { skippedFiles } : {}),
      scopeRestricted:
        request.filters !== undefined || (request.field !== undefined && request.field !== 'both'),
      ...(request.filters ? { filters: request.filters } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.field ? { field: request.field } : {}),
    });
  }

  private filterFiles(
    files: readonly TFile[],
    filters: RustNativeVaultFilters,
    path = '',
  ): readonly TFile[] {
    const scope = planNativeVaultListRust(
      files.map((file) => file.path),
      path,
      0,
      files.length,
    );
    if (!scope) throw new Error(t('nativeVaultSearchScopeFailed'));
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const scoped = scope.paths.flatMap((path) => filesByPath.get(path) ?? []);
    const rows = scoped.map((file) => {
      const cache =
        filters.tags || filters.properties ? this.app.metadataCache.getFileCache?.(file) : null;
      return {
        modifiedAt: file.stat.mtime,
        tags: filters.tags && cache ? (getAllTags(cache) ?? []) : [],
        properties: Object.fromEntries(
          Object.keys(filters.properties ?? {}).flatMap((name) => {
            const value: unknown = cache?.frontmatter?.[name];
            return value === undefined ? [] : [[name, value]];
          }),
        ),
      };
    });
    const indices = planNativeVaultFilteredIndicesRust(rows, filters);
    if (!indices) throw new Error(t('nativeVaultSearchScopeFailed'));
    return indices.flatMap((index) => (scoped[index] ? [scoped[index]] : []));
  }

  private async getListCandidateFiles(
    path: string,
    cursor: number,
    filters?: RustNativeVaultFilters,
  ): Promise<readonly TFile[]> {
    const snapshot = this.listSnapshot;
    const filtersKey = JSON.stringify(filters ?? null);
    if (
      cursor > 0 &&
      snapshot?.path === path &&
      snapshot.expectedCursor === cursor &&
      snapshot.filtersKey === filtersKey
    ) {
      const currentPaths = new Set(
        (await this.fileScope.listCandidateFiles()).map((file) => file.path),
      );
      return snapshot.files.filter((file) => currentPaths.has(file.path));
    }
    this.listSnapshot = null;
    const files = await this.fileScope.listCandidateFiles();
    return filters ? this.filterFiles(files, filters) : files;
  }

  private resolveCandidateFile(path: string, files: readonly TFile[]): TFile | null {
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const resolved = this.resolveVaultFile(path);
    return resolved ? (filesByPath.get(resolved.path) ?? null) : null;
  }

  private resolveVaultFile(rawPath: string): TFile | null {
    const path = normalizeVaultLinkTargetRust(rawPath);
    if (!path) return null;
    const candidates = path.endsWith('.md') ? [path] : [path, `${path}.md`];
    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) return file;
    }
    const resolved = this.app.metadataCache.getFirstLinkpathDest(path, '');
    return resolved instanceof TFile ? resolved : null;
  }
}

function getSearchQueries(
  request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
): string[] {
  const queries = request.queries?.length ? request.queries : [request.query];
  return queries.slice(0, 4);
}

function shouldUseLiveLexicalFallback(attempt: IndexedSearchAttempt): boolean {
  if (attempt.failed) return true;
  if (attempt.indexReadiness && attempt.indexReadiness.readiness !== 'ready') return true;
  return !attempt.diagnosticsByQuery.every(
    (diagnostics) =>
      diagnostics.some(
        (diagnostic) =>
          isCoreRetrievalDiagnostic(diagnostic) &&
          diagnostic.status === 'ok' &&
          diagnostic.readiness === 'ready',
      ) &&
      !diagnostics.some(
        (diagnostic) =>
          isCoreRetrievalDiagnostic(diagnostic) &&
          (diagnostic.status === 'timeout' || diagnostic.status === 'error'),
      ),
  );
}

function isCoreRetrievalDiagnostic(diagnostic: RetrievalProviderDiagnostic): boolean {
  return (
    diagnostic.source === 'vector' ||
    diagnostic.source === 'ann' ||
    diagnostic.source === 'bm25' ||
    diagnostic.source === 'structural'
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new DOMException(t('cancelledLabel'), 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isSafeStringOffset(value: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) return false;
  if (offset === 0 || offset === value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function buildIndexedSearchResult(
  request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  queries: readonly string[],
  candidates: readonly IndexedSearchCandidate[],
): NativeVaultSearchResult {
  const plan = planNativeVaultSearchRrfRust(
    candidates.map((candidate) => ({
      entryId: getIndexedEntryKey(candidate.result),
      queryIndex: candidate.queryIndex,
      rank: candidate.rank,
    })),
    queries.length,
    request.limit,
  );
  if (!plan) throw new Error(t('nativeVaultSearchScopeFailed'));

  const hits = plan.hits.flatMap((hitPlan) => {
    const representative = candidates[hitPlan.representativeCandidateIndex];
    if (!representative) return [];
    const groupedCandidates = hitPlan.candidateIndexes.flatMap((index) =>
      candidates[index] ? [candidates[index]] : [],
    );
    const retrievalSources = collectRetrievalSources(groupedCandidates);
    const evidence = planNativeVaultLexicalHitRust(
      representative.query,
      representative.result.entry.metadata.text,
      request.match,
    );
    const chunkStartLine = zeroBasedLineToOneBased(representative.result.chunkRange.startLine);
    const chunkEndLine =
      representative.result.chunkRange.endLine === undefined
        ? undefined
        : zeroBasedLineToOneBased(representative.result.chunkRange.endLine);
    const recommendedReadRange = boundRecommendedReadRange(chunkStartLine, chunkEndLine);
    return [
      {
        path: representative.result.sourcePath,
        heading: representative.result.entry.metadata.heading,
        startLine: recommendedReadRange.startLine,
        endLine: recommendedReadRange.endLine,
        preview:
          evidence?.preview ??
          createContextPreviewRust(representative.result.entry.metadata.text) ??
          '',
        score: hitPlan.rrfScore,
        retrievalSources,
        selectionReason: representative.result.selectionReason,
        matchedQueries: hitPlan.matchedQueryIndices.flatMap((index) =>
          queries[index] ? [queries[index]] : [],
        ),
        recommendedReadRange,
        citationStatus: 'candidate' as const,
        requiresRead: true as const,
      },
    ];
  });
  return buildSearchResult(request.query, queries, request.path, request.match, hits, {
    totalHits: plan.totalEntries,
    // 각 query의 topK 후보만 융합하므로 결과 수와 무관하게 전체 검색 완료를 뜻하지 않습니다.
    truncated: true,
    scopeRestricted:
      request.filters !== undefined || (request.field !== undefined && request.field !== 'both'),
    filters: request.filters,
    mode: request.mode,
    field: request.field,
  });
}

function mergeIndexedAndLexicalSearchResults(
  request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  queries: readonly string[],
  indexed: NativeVaultSearchResult,
  lexical: NativeVaultSearchResult,
): NativeVaultSearchResult {
  const candidates = [
    ...lexical.hits.map((hit, index) => ({
      hit,
      streamIndex: 0,
      rank: index + 1,
    })),
    ...indexed.hits.map((hit, index) => ({
      hit,
      streamIndex: 1,
      rank: index + 1,
    })),
  ];
  const plan = planNativeVaultSearchRrfRust(
    candidates.map((candidate) => ({
      entryId: candidate.hit.path,
      queryIndex: candidate.streamIndex,
      rank: candidate.rank,
    })),
    2,
    request.limit,
  );
  if (!plan) throw new Error(t('nativeVaultSearchScopeFailed'));

  const hits = plan.hits.flatMap((hitPlan) => {
    const representative = candidates[hitPlan.representativeCandidateIndex];
    if (!representative) return [];
    const groupedHits = hitPlan.candidateIndexes.flatMap((index) =>
      candidates[index] ? [candidates[index].hit] : [],
    );
    const evidenceHit = groupedHits.find((hit) => hit.citationStatus === 'verified');
    return [
      {
        ...representative.hit,
        ...evidenceHit,
        score: hitPlan.rrfScore,
        retrievalSources: collectSearchHitRetrievalSources(groupedHits),
        matchedQueries: collectSearchHitMatchedQueries(groupedHits, queries),
      },
    ];
  });
  return buildSearchResult(request.query, queries, request.path, request.match, hits, {
    scannedFiles: lexical.scannedFiles,
    unreadableFiles: lexical.unreadableFiles,
    totalHits: Math.max(plan.totalEntries, indexed.totalHits, lexical.totalHits),
    truncated: indexed.truncated || lexical.truncated || plan.totalEntries > hits.length,
    scopeRestricted: lexical.scopeRestricted,
    filters: lexical.filters,
    mode: lexical.mode,
    field: lexical.field,
  });
}

function getIndexedEntryKey(result: QueryResult): string {
  const entryId = result.entry.id.trim();
  const range = `${result.chunkRange.startLine}:${result.chunkRange.endLine ?? ''}`;
  return entryId ? `${result.sourcePath}\u0000${entryId}` : `${result.sourcePath}\u0000${range}`;
}

function collectRetrievalSources(candidates: readonly IndexedSearchCandidate[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const source of candidate.result.retrievalSources ?? []) {
      const normalized = source.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      sources.push(normalized);
      if (sources.length >= MAX_RETRIEVAL_SOURCES) return sources;
    }
  }
  return sources;
}

function collectSearchHitRetrievalSources(hits: readonly NativeVaultSearchHit[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    for (const source of hit.retrievalSources ?? []) {
      const normalized = source.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      sources.push(normalized);
      if (sources.length >= MAX_RETRIEVAL_SOURCES) return sources;
    }
  }
  return sources;
}

function collectSearchHitMatchedQueries(
  hits: readonly NativeVaultSearchHit[],
  queries: readonly string[],
): string[] {
  const matched = new Set(hits.flatMap((hit) => hit.matchedQueries ?? []));
  return queries.filter((query) => matched.has(query));
}

function zeroBasedLineToOneBased(value: number): number {
  const converted = value + 1;
  return Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(converted)
    ? converted
    : 1;
}

function normalizeOneBasedLine(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function boundRecommendedReadRange(
  startLine: number,
  endLine: number | undefined,
): { startLine: number; endLine: number } {
  const boundedStart = normalizeOneBasedLine(startLine);
  const requestedEnd =
    endLine !== undefined && Number.isSafeInteger(endLine) && endLine >= boundedStart
      ? endLine
      : boundedStart;
  return {
    startLine: boundedStart,
    endLine: Math.min(requestedEnd, boundedStart + MAX_READ_LINES - 1),
  };
}

function buildSearchResult(
  query: string,
  queries: readonly string[],
  path: string,
  match: 'all' | 'any' | 'phrase',
  rawHits: readonly NativeVaultSearchHit[],
  coverage: {
    scannedFiles?: number;
    unreadableFiles?: number;
    skippedFiles?: number;
    totalHits?: number;
    truncated?: boolean;
    scopeRestricted?: boolean;
    filters?: RustNativeVaultFilters;
    mode?: 'auto' | 'exact' | 'word';
    field?: 'both' | 'content' | 'path';
  } = {},
): NativeVaultSearchResult {
  const hits = rawHits.map((rawHit): NativeVaultSearchHit => {
    const hit = { ...rawHit };
    const status = hit.citationStatus === 'verified' ? 'verified' : 'candidate';
    hit.citationStatus = status;
    if (status === 'verified') delete hit.requiresRead;
    else hit.requiresRead = true;
    return hit;
  });
  const citations = hits.flatMap((hit) => [
    createCitation(
      hit.path,
      hit.startLine,
      hit.endLine,
      hit.preview,
      hit.heading,
      hit.score,
      hit.citationStatus,
      hit.selectionReason,
    ),
    ...((coverage.mode === 'word' && match === 'phrase') || coverage.mode === 'exact'
      ? (hit.passages ?? []).map((passage) =>
          createCitation(
            hit.path,
            passage.startLine,
            passage.endLine,
            passage.content,
            hit.heading,
            hit.score,
            'verified',
            hit.selectionReason,
          ),
        )
      : []),
    ...(hit.metadata?.evidence ?? []).map((passage) =>
      createCitation(hit.path, passage.startLine, passage.endLine, passage.content),
    ),
  ]);
  const totalHits = coverage.totalHits ?? hits.length;
  return {
    action: 'search',
    query,
    queries: [...queries],
    path,
    match,
    hits,
    scannedFiles: coverage.scannedFiles ?? 0,
    unreadableFiles: coverage.unreadableFiles ?? 0,
    ...(coverage.skippedFiles ? { skippedFiles: coverage.skippedFiles } : {}),
    totalHits,
    truncated: coverage.truncated ?? totalHits > hits.length,
    ...(coverage.scopeRestricted ? { scopeRestricted: true } : {}),
    ...(coverage.filters ? { filters: coverage.filters } : {}),
    ...(coverage.mode ? { mode: coverage.mode } : {}),
    ...(coverage.field ? { field: coverage.field } : {}),
    citations,
  };
}

/**
 * 인덱스가 없는 동안의 전체 Vault 라이브 검색에서 본문 추출이 필요한 문서인지 확인합니다.
 * 추출은 문서당 수 초에서 수십 초가 걸릴 수 있어, 색인 검색이 준비되면 그 경로가 담당합니다.
 */
function requiresSourceExtraction(extension: string): boolean {
  return isExtractableSourceExtensionRust(extension) === true;
}

function createCitation(
  filePath: string,
  line: number,
  endLine: number | undefined,
  preview: string,
  heading?: string,
  score?: number,
  status: SourceCitation['status'] = 'verified',
  selectionReason?: SourceCitation['selectionReason'],
): SourceCitation {
  const range = `${line}-${endLine ?? line}`;
  return {
    id: `vault:${filePath}:${range}`,
    filePath,
    heading,
    line,
    endLine,
    score,
    preview,
    status,
    selectionReason,
  };
}
