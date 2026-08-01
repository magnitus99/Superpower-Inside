import { TFile, TFolder, type App } from 'obsidian';
import type { QueryResult } from '../rag/query';
import type {
  RetrievalProviderDiagnostic,
  RetrievalProviderReadiness,
} from '../rag/retrieval-pipeline';
import {
  createContextPreviewRust,
  planFolderLexicalEvidenceIndicesRust,
  planNativeVaultLexicalHitRust,
  planNativeVaultLinkPathsRust,
  planNativeVaultListRust,
  planNativeVaultReadRangeRust,
  planNativeVaultSearchRrfRust,
  planNativeVaultStatsRust,
  type RustNativeVaultToolRequest,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';
import type {
  NativeVaultLinksResult,
  NativeVaultListResult,
  NativeVaultReadResult,
  NativeVaultSearchHit,
  NativeVaultSearchResult,
  NativeVaultStatsResult,
  NativeVaultToolPort,
} from './native-vault-tool';

const MAX_READ_LINES = 400;
const LEXICAL_READ_BATCH_SIZE = 8;
const MAX_RETRIEVAL_SOURCES = 8;

export interface NativeVaultQueryEngineLike {
  query(
    question: string,
    topK: number,
    minScore?: number,
    filePathPrefixes?: readonly string[],
    options?: { fileBackedOnly?: boolean; signal?: AbortSignal },
  ): Promise<QueryResult[]>;
  getLastRetrievalDiagnostics?(): readonly RetrievalProviderDiagnostic[];
  getIndexReadiness?(
    files: readonly { path: string; mtime: number; size: number }[],
  ): Promise<RetrievalProviderReadiness | null>;
}

export interface NativeVaultFileScope {
  listCandidateFiles(): Promise<readonly TFile[]>;
  isCandidateFile(file: TFile): Promise<boolean>;
  isPathVisible(path: string): boolean;
}

interface NativeVaultListSnapshot {
  path: string;
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
  ) {}

  async search(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultSearchResult> {
    throwIfAborted(signal);
    const queries = getSearchQueries(request);
    const indexedAttempt = await this.tryIndexedSearch(request, queries, signal);
    throwIfAborted(signal);
    if (indexedAttempt !== null) {
      const visible = await this.filterVisibleIndexedCandidates(indexedAttempt.candidates);
      const needsLiveLexicalFallback = shouldUseLiveLexicalFallback(indexedAttempt);
      if (visible.length > 0) {
        const indexedResult = buildIndexedSearchResult(request, queries, visible);
        if (!needsLiveLexicalFallback) return indexedResult;
        const files =
          indexedAttempt.inventoryFiles ?? (await this.fileScope.listCandidateFiles());
        const lexicalResult = await this.searchLexically(request, queries, files, signal);
        return lexicalResult.hits.length > 0
          ? mergeIndexedAndLexicalSearchResults(
              request,
              queries,
              indexedResult,
              lexicalResult,
            )
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
      indexedAttempt?.inventoryFiles ?? (await this.fileScope.listCandidateFiles());
    return this.searchLexically(request, queries, files, signal);
  }

  async read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultReadResult> {
    throwIfAborted(signal);
    const file = this.resolveVaultFile(request.path);
    if (!file || !(await this.fileScope.isCandidateFile(file))) {
      throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    }
    throwIfAborted(signal);
    const content = await awaitWithAbort(this.app.vault.cachedRead(file), signal);
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
      citations: [citation],
    };
  }

  async list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultListResult> {
    throwIfAborted(signal);
    const files = await this.getListCandidateFiles(request.path, request.cursor);
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
    return { action: 'stats', ...plan, citations: [] };
  }

  private async tryIndexedSearch(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    queries: readonly string[],
    signal?: AbortSignal,
  ): Promise<IndexedSearchAttempt | null> {
    const engine = this.getQueryEngine();
    if (!engine) return null;

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
            request.path ? [request.path] : undefined,
            { fileBackedOnly: true, signal },
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
  ): Promise<NativeVaultSearchResult> {
    throwIfAborted(signal);
    const scope = planNativeVaultListRust(
      files.map((file) => file.path),
      request.path,
      0,
      files.length,
    );
    if (!scope) throw new Error(t('nativeVaultSearchScopeFailed'));
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const readable: Array<{ file: TFile; content: string }> = [];
    for (let offset = 0; offset < scope.paths.length; offset += LEXICAL_READ_BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = scope.paths.slice(offset, offset + LEXICAL_READ_BATCH_SIZE);
      const entries = await Promise.all(
        batch.map(async (path) => {
          const file = filesByPath.get(path);
          if (!file) return null;
          try {
            return {
              file,
              content: await awaitWithAbort(this.app.vault.cachedRead(file), signal),
            };
          } catch {
            return null;
          }
        }),
      );
      throwIfAborted(signal);
      readable.push(
        ...entries.filter((entry): entry is { file: TFile; content: string } => entry !== null),
      );
    }
    const searchableTexts = readable.map(
      ({ file, content }) => `${file.path}\n${content}`,
    );
    const candidates: LexicalSearchCandidate[] = [];
    const matchedPaths = new Set<string>();
    let lexicalWasTruncated = false;
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      throwIfAborted(signal);
      const query = queries[queryIndex];
      if (!query) continue;
      const matchingIndices =
        planFolderLexicalEvidenceIndicesRust(
          query,
          searchableTexts,
          readable.length,
          request.match,
        ) ?? [];
      for (const matchedIndex of matchingIndices) {
        const matchedPath = readable[matchedIndex]?.file.path;
        if (matchedPath) matchedPaths.add(matchedPath);
      }
      const selectedIndices = matchingIndices.slice(0, request.limit);
      lexicalWasTruncated ||= selectedIndices.length < matchingIndices.length;
      for (let rankIndex = 0; rankIndex < selectedIndices.length; rankIndex++) {
        const entryIndex = selectedIndices[rankIndex];
        const entry = entryIndex === undefined ? undefined : readable[entryIndex];
        if (!entry) continue;
        const evidence = planNativeVaultLexicalHitRust(query, entry.content, request.match);
        const recommendedReadRange = boundRecommendedReadRange(
          evidence?.startLine ?? 1,
          evidence?.endLine,
        );
        candidates.push({
          queryIndex,
          rank: rankIndex + 1,
          hit: {
            path: entry.file.path,
            startLine: recommendedReadRange.startLine,
            endLine: recommendedReadRange.endLine,
            preview: evidence?.preview ?? createContextPreviewRust(entry.content) ?? '',
            retrievalSources: ['live-lexical'],
            selectionReason: 'keyword',
            matchedQueries: [query],
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
      scannedFiles: scope.paths.length,
      unreadableFiles: scope.paths.length - readable.length,
      totalHits: matchedPaths.size,
      truncated: lexicalWasTruncated || matchedPaths.size > hits.length,
    });
  }

  private async getListCandidateFiles(path: string, cursor: number): Promise<readonly TFile[]> {
    const snapshot = this.listSnapshot;
    if (cursor > 0 && snapshot?.path === path && snapshot.expectedCursor === cursor) {
      return snapshot.files;
    }
    this.listSnapshot = null;
    return this.fileScope.listCandidateFiles();
  }

  private resolveCandidateFile(path: string, files: readonly TFile[]): TFile | null {
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const resolved = this.resolveVaultFile(path);
    return resolved ? (filesByPath.get(resolved.path) ?? null) : null;
  }

  private resolveVaultFile(path: string): TFile | null {
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
    const chunkStartLine = zeroBasedLineToOneBased(
      representative.result.chunkRange.startLine,
    );
    const chunkEndLine =
      representative.result.chunkRange.endLine === undefined
        ? undefined
        : zeroBasedLineToOneBased(representative.result.chunkRange.endLine);
    const recommendedReadRange = boundRecommendedReadRange(
      chunkStartLine,
      chunkEndLine,
    );
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
    return [
      {
        ...representative.hit,
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
    truncated:
      indexed.truncated ||
      lexical.truncated ||
      plan.totalEntries > hits.length,
  });
}

function getIndexedEntryKey(result: QueryResult): string {
  const entryId = result.entry.id.trim();
  const range = `${result.chunkRange.startLine}:${result.chunkRange.endLine ?? ''}`;
  return entryId
    ? `${result.sourcePath}\u0000${entryId}`
    : `${result.sourcePath}\u0000${range}`;
}

function collectRetrievalSources(
  candidates: readonly IndexedSearchCandidate[],
): string[] {
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

function collectSearchHitRetrievalSources(
  hits: readonly NativeVaultSearchHit[],
): string[] {
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
  const matched = new Set(
    hits.flatMap((hit) => hit.matchedQueries ?? []),
  );
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
    totalHits?: number;
    truncated?: boolean;
  } = {},
): NativeVaultSearchResult {
  const hits = rawHits.map((rawHit): NativeVaultSearchHit => ({
    ...rawHit,
    citationStatus: 'candidate',
    requiresRead: true,
  }));
  const citations = hits.map((hit) =>
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
  );
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
    totalHits,
    truncated: coverage.truncated ?? totalHits > hits.length,
    citations,
  };
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
