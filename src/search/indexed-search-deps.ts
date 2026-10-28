import { TFile, getAllTags, type App } from 'obsidian';
import { t } from '../i18n';
import type {
  IndexedEvidenceCandidate,
  IndexedEvidenceInventory,
  IndexedMatchCount,
  IndexedVaultCorpus,
} from '../agent/indexed-vault-review';
import type { QueryResult, RAGExhaustiveBm25Match, RAGQueryEngine } from '../rag/query';
import type { RetrievalProviderDiagnostic } from '../rag/retrieval-pipeline';
import { planIndexedSearchQueriesRust, planNativeVaultFilteredIndicesRust, scopeIndexedDiscoveryRust, type IndexedSearchPlan, type RustIndexedEvidenceFilters } from '../rag/rust-core';
import { readSourceText } from '../rag/source-access';
import { createContentHash } from '../rag/hash';
import { chunkSourceDocument } from '../rag/source-document';
import type { SuperpowerInsideSettings } from '../settings';
import { appLogger } from '../utils/logger';
import { getRagCandidateFiles } from '../utils/vault';
import {
  createIndexedSearchPort,
  type IndexedEvidenceSourceSnapshot,
  type IndexedSearchSource,
} from './engine-adapter';
import type { SearchCandidateState, SearchPort } from './engine-port';

/** 색인 본문·BM25 기록·파일 인덱스 기록을 함께 들고 있는 저장소. */
export interface IndexedSearchCorpus extends IndexedVaultCorpus {
  getIndexedFilePaths(): Promise<string[]>;
}

/** 플러그인이 검색 화면과 채팅에 같은 방식으로 넘기는 검색 의존성. */
export interface IndexedSearchDepsHost {
  app: App;
  ragEngine: RAGQueryEngine | null;
  documentCorpus: IndexedSearchCorpus | null;
  /** 허용 범위 전체 경로. 없으면 미색인 수는 알 수 없어 0으로 둔다. */
  getCandidatePaths?: () => Promise<readonly string[]>;
  /** 허용 범위 전체 수. 비용 큰 볼트 열거를 피할 때 사용합니다. */
  getCandidateCount?: () => number | undefined;
  settings?: Pick<SuperpowerInsideSettings, 'rag' | 'chat'>;
  /** 재색인·초기화 중에는 부분 색인으로 답하지 않습니다. */
  isIndexing?: () => boolean;
}

const MAIN_CANDIDATE_LIMIT = 256;
const SUBJECT_CANDIDATE_LIMIT = 96;
const MAX_HYBRID_FACETS = 3;
// 소스별 예약 슬롯과 최대 3개 facet의 원문 검증 예산을 함께 확보합니다.
const EXHAUSTIVE_REVIEW_PATH_LIMIT = 96;
const MAX_QUERY_VARIANTS = 3;
const REVIEW_PATHS_PER_SOURCE = 8;
/**
 * 의미 후보 질의 하나가 기다릴 수 있는 시간입니다. 볼트 전체 벡터 색인은 첫 질의에서 만들어지고
 * 이후 질의는 수백 ms면 끝나므로, 검색 화면도 채팅과 같은 후보를 받도록 여유를 둡니다.
 */
const SEMANTIC_CANDIDATE_TIMEOUT_MS = 8_000;

type IndexedSearchCandidate = IndexedEvidenceCandidate & { queryIndex?: number };

interface HybridCandidateResolution {
  candidates: readonly IndexedSearchCandidate[] | undefined;
  state: SearchCandidateState;
  failedFacetIds: readonly string[];
  exhaustiveReview: boolean;
  diagnostics?: readonly RetrievalProviderDiagnostic[];
}

/** 색인 사본과 현재 원문 리비전(mtime:size)을 대조하는 reader. */
export function createVaultRevisionReader(app: App): (path: string) => Promise<string | null> {
  return async (path) => {
    const file = app.vault.getAbstractFileByPath?.(path);
    if (file instanceof TFile) return `${file.stat.mtime}:${file.stat.size}`;
    const stat = await app.vault.adapter.stat(path);
    return stat ? `${stat.mtime}:${stat.size}` : null;
  };
}

/** 답변 전에 채택 문서의 현재 원문과 revision을 읽는 로컬 vault reader를 만듭니다. */
export function createVaultSourceReader(
  app: App,
  forceRefresh = true,
  chunkConfig?: Pick<SuperpowerInsideSettings['rag'], 'chunkSize' | 'overlap'>,
): (path: string, signal?: AbortSignal) => Promise<IndexedEvidenceSourceSnapshot> {
  return async (path, signal) => {
    try {
      signal?.throwIfAborted();
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return { revision: null, text: null };
      const before = await app.vault.adapter.stat(path);
      if (!before) return { revision: null, text: null };
      const source = await readSourceText(app.vault, file, { signal, forceRefresh });
      signal?.throwIfAborted();
      const after = await app.vault.adapter.stat(path);
      if (!after || before.mtime !== after.mtime || before.size !== after.size) {
        return { revision: null, text: null };
      }
      let chunks: IndexedEvidenceSourceSnapshot['chunks'] = [];
      if (chunkConfig) {
        try {
          chunks = chunkSourceDocument(file, source.text, chunkConfig, source.segments).map(
            (chunk) => ({
              text: chunk.text,
              startLine: chunk.metadata.startLine,
              endLine: chunk.metadata.endLine,
            }),
          );
        } catch (error) {
          appLogger.debug('Current source chunking failed; using raw verification window.', {
            source: 'search.source-read',
            data: { extension: file.extension ?? '' },
            error,
          });
        }
      }
      return {
        revision: `${after.mtime}:${after.size}`,
        text: source.text,
        contentHash: createContentHash(source.text),
        ...(chunks.length > 0 ? { chunks } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      appLogger.debug('Vault source read failed; treating the document as stale.', {
        source: 'search.source-read',
        data: { extension: path.split('.').pop() ?? '' },
        error,
      });
      return { revision: null, text: null };
    }
  };
}

/**
 * 질의 하나에 대해 색인 저장소·후보 신호·리비전 reader를 한 번에 모은다.
 * 순위 병합은 엔진이 하고 여기서는 같은 질의에 같은 입력을 보장한다.
 */
export async function collectIndexedSearchSource(
  host: IndexedSearchDepsHost,
  query: string,
  signal?: AbortSignal,
  question = query,
  forceRefreshSources = true,
  semanticTimeoutMs = SEMANTIC_CANDIDATE_TIMEOUT_MS,
  loadQueryVariants?: () => Promise<readonly string[]>,
  restriction?: { scopes: readonly string[]; filters?: RustIndexedEvidenceFilters },
): Promise<
  (IndexedSearchSource & { diagnostics?: readonly RetrievalProviderDiagnostic[] }) | null
> {
  const corpus = host.documentCorpus;
  if (!corpus) return null;
  const startedAt = performance.now();
  const sourceReader = createVaultSourceReader(host.app, forceRefreshSources, host.settings?.rag);
  const allIndexedPaths = await corpus.getIndexedFilePaths();
  const allowedPaths = await resolveIndexedSearchPaths(host, allIndexedPaths, restriction);
  const indexedPaths = allowedPaths;
  const indexedPathsMs = performance.now() - startedAt;
  if (signal?.aborted) return null;
  const inventoryStartedAt = performance.now();
  const inventory = await collectInventory(host, indexedPaths, restriction);
  const inventoryMs = performance.now() - inventoryStartedAt;
  if (signal?.aborted) return null;
  const searchPlan = planIndexedSearchQueriesRust({
    question,
    scoringQuestion: query,
    scopes: [],
  });
  if (!searchPlan) {
    return {
      corpus,
      getIndexedPaths: () => Promise.resolve(indexedPaths),
      candidates: undefined,
      candidatesState: 'unavailable',
      exhaustiveReview: false,
      inventory,
      searchPlan: undefined,
      revisionReader: createVaultRevisionReader(host.app),
      sourceReader,
    };
  }
  // facet 검색과 term 집계를 한 batch로 가져와 후보·인벤토리가 같은 색인 호출을 공유합니다.
  // batch가 실패하면 후보는 기존 개별 경로로, 집계는 기존 term 루프로 되돌아갑니다.
  const bm25Batch =
    searchPlan && indexedPaths.length > 0 && host.isIndexing?.() !== true
      ? await collectBm25Batch(host.ragEngine, searchPlan, signal, indexedPaths)
      : null;
  const candidateStartedAt = performance.now();
  let candidateResolution: HybridCandidateResolution =
    indexedPaths.length === 0
      ? {
          candidates: undefined,
          state: host.isIndexing?.() === true ? ('indexing' as const) : ('unavailable' as const),
          failedFacetIds: [],
          exhaustiveReview: false,
        }
      : host.isIndexing?.() === true
        ? {
            candidates: undefined,
            state: 'indexing' as const,
            failedFacetIds: [],
            exhaustiveReview: false,
          }
        : await collectHybridCandidates(
            host.ragEngine,
            searchPlan,
            signal,
            semanticTimeoutMs,
            bm25Batch?.matches,
          );
  // 원래 질의가 0건이어도 언어 변형으로 첫 후보를 발견할 수 있습니다.
  const queryVariants =
    host.ragEngine && indexedPaths.length > 0 && host.isIndexing?.() !== true
      ? await loadQueryVariants?.()
      : undefined;
  signal?.throwIfAborted();
  if (queryVariants && queryVariants.length > 0) {
    const extra = await collectVariantCandidates(
      host.ragEngine,
      queryVariants,
      signal,
      semanticTimeoutMs,
    );
    if (extra.length > 0) {
      candidateResolution = {
        ...candidateResolution,
        candidates: mergeCandidateLists(candidateResolution.candidates ?? [], extra),
        state: 'ready',
      };
    }
  }
  const candidatesMs = performance.now() - candidateStartedAt;
  const reviewPaths = candidateResolution.exhaustiveReview
    ? selectExhaustiveReviewPaths(indexedPaths, candidateResolution.candidates)
    : undefined;
  const reviewPathSet = new Set(reviewPaths ?? []);
  const matchStartedAt = performance.now();
  const matchInventory =
    bm25Batch && bm25Batch.inventories.length > 0
      ? bm25Batch.inventories
      : await collectMatchInventory(host.ragEngine, searchPlan, signal, indexedPaths);
  const matchMs = performance.now() - matchStartedAt;
  appLogger.debug('Indexed search source collected.', {
    source: 'search.source',
    data: {
      indexedPaths: indexedPaths.length,
      reviewPaths: reviewPaths?.length ?? null,
      candidates: candidateResolution.candidates?.length ?? 0,
      exhaustiveReview: candidateResolution.exhaustiveReview,
      indexedPathsMs,
      inventoryMs,
      candidatesMs,
      matchMs,
      totalMs: performance.now() - startedAt,
    },
  });
  return {
    corpus,
    queryVariants: queryVariants?.slice(0, MAX_QUERY_VARIANTS),
    getIndexedPaths: () => Promise.resolve(indexedPaths),
    candidates: candidateResolution.exhaustiveReview
      ? candidateResolution.candidates?.filter((candidate) => reviewPathSet.has(candidate.path))
      : candidateResolution.candidates,
    discoveryCandidates: candidateResolution.candidates,
    reviewPaths,
    exhaustiveReview: candidateResolution.exhaustiveReview,
    candidatesState: candidateResolution.state,
    diagnostics: candidateResolution.diagnostics,
    inventory,
    ...(matchInventory ? { matchInventory } : {}),
    searchPlan: { ...searchPlan, failedFacetIds: candidateResolution.failedFacetIds },
    revisionReader: createVaultRevisionReader(host.app),
    sourceReader,
  };
}

/** facet 계획에서 중복 없는 집계 term을 만듭니다. */
function planTerms(plan: IndexedSearchPlan): string[] {
  const terms: string[] = [];
  for (const facet of plan.facets) {
    for (const term of facet.terms) {
      const normalized = term.trim();
      if (normalized.length === 0 || terms.includes(normalized)) continue;
      terms.push(normalized);
    }
  }
  return terms;
}

/** Rust batch 집계를 dossier 인벤토리 행으로 옮깁니다. */
function toMatchInventory(
  term: string,
  aggregate: NonNullable<
    Awaited<ReturnType<RAGQueryEngine['queryMatchInventory']>>
  >,
): IndexedMatchCount {
  return {
    query: term,
    totalDocuments: aggregate.totalDocuments,
    totalChunks: aggregate.totalChunks,
    totalOccurrences: aggregate.totalOccurrences,
    documents: aggregate.documents.map(({ sourcePath, occurrences }) => ({
      sourcePath,
      occurrences,
    })),
  };
}

/**
 * facet 검색과 term 집계를 한 worker 요청으로 가져옵니다.
 * 실패하면 호출자가 기존 개별 경로로 되돌아가도록 null을 돌려줍니다.
 */
async function collectBm25Batch(
  engine: RAGQueryEngine | null,
  plan: IndexedSearchPlan,
  signal: AbortSignal | undefined,
  allowedPaths: readonly string[],
): Promise<{
  matches: readonly (readonly RAGExhaustiveBm25Match[])[];
  inventories: readonly IndexedMatchCount[];
} | null> {
  if (!engine) return null;
  const facets = plan.facets.slice(0, MAX_HYBRID_FACETS);
  if (facets.length === 0) return { matches: [], inventories: [] };
  const terms = planTerms(plan);
  // Rust batch 상한과 맞춘다. 넘으면 개별 term 경로가 정확히 처리한다.
  if (terms.length > 128) return null;
  try {
    const result = await engine.queryBm25Batch(
      facets.map((facet) => ({ query: facet.query })),
      terms.map((term) => ({
        query: term,
        limit: Math.max(1, allowedPaths.length || 40),
      })),
      allowedPaths,
      signal,
    );
    if (!result) return null;
    return {
      matches: result.matches,
      inventories: terms.flatMap((term, index) => {
        const aggregate = result.inventories[index];
        return aggregate ? [toMatchInventory(term, aggregate)] : [];
      }),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    appLogger.warn('BM25 facet batch unavailable; falling back to individual facets.', {
      source: 'search.candidates',
      error,
    });
    return null;
  }
}

/**
 * 질의 facet의 핵심 term마다 색인 전체 일치 집계를 모읍니다.
 * 질문 문장 전체를 세면 조사·상투어가 수치를 부풀리므로 facet이 고른 term만 셉니다.
 * 집계는 점수·순위가 아니므로 후보를 자르거나 정렬하는 데 쓰지 않습니다.
 */
async function collectMatchInventory(
  engine: RAGQueryEngine | null,
  plan: IndexedSearchPlan,
  signal?: AbortSignal,
  allowedPaths?: readonly string[],
): Promise<readonly IndexedMatchCount[] | undefined> {
  if (!engine) return undefined;
  const terms: string[] = [];
  for (const facet of plan.facets) {
    for (const term of facet.terms) {
      const normalized = term.trim();
      if (normalized.length === 0 || terms.includes(normalized)) continue;
      terms.push(normalized);
    }
  }
  const counts: IndexedMatchCount[] = [];
  for (const term of terms) {
    signal?.throwIfAborted();
    try {
      const aggregate = await engine.queryMatchInventory(term, Math.max(1, allowedPaths?.length ?? 40), signal, allowedPaths);
      if (!aggregate) continue;
      counts.push({
        query: term,
        totalDocuments: aggregate.totalDocuments,
        totalChunks: aggregate.totalChunks,
        totalOccurrences: aggregate.totalOccurrences,
        documents: aggregate.documents.map(({ sourcePath, occurrences }) => ({
          sourcePath,
          occurrences,
        })),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // 집계가 없어도 근거 기반 답변은 계속한다. 수치 없이 답한 사실은 dossier가 알린다.
      appLogger.warn('Match inventory unavailable; continuing without aggregate counts.', {
        source: 'search.source',
        error,
      });
      break;
    }
  }
  return counts.length > 0 ? counts : undefined;
}

/** 현재 접근·폴더·태그 범위를 집계와 후속 조사에 동일하게 적용합니다. */
export async function resolveIndexedSearchPaths(
  host: IndexedSearchDepsHost,
  paths: readonly string[],
  restriction?: { scopes: readonly string[]; filters?: RustIndexedEvidenceFilters },
): Promise<string[]> {
  const allowedPaths = await listCandidatePaths(host) ?? paths;
  const scoped = scopeIndexedDiscoveryRust({
    originalPaths: paths, allowedPaths,
    originalScopes: restriction?.scopes ?? [], scopes: restriction?.scopes ?? [],
  });
  if (!scoped) throw new Error(t('nativeVaultSearchScopeFailed'));
  if (!restriction?.filters) return scoped;
  const files = scoped.flatMap((path) => {
    const file = host.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? [file] : [];
  });
  const rows = files.map((file) => {
    const cache = host.app.metadataCache.getFileCache(file);
    return {
      modifiedAt: file.stat.mtime,
      tags: cache ? getAllTags(cache) ?? [] : [],
      properties: cache?.frontmatter ?? {},
    };
  });
  const indices = planNativeVaultFilteredIndicesRust(rows, {
    tags: restriction.filters.tags ? [...restriction.filters.tags] : undefined,
    modifiedAfter: restriction.filters.modifiedAfter,
  });
  if (!indices) throw new Error(t('nativeVaultSearchScopeFailed'));
  return indices.flatMap((index) => files[index] ? [files[index].path] : []);
}

/**
 * 전체 lexical match 중 원문 검증에 쓸 상위 경로만 고릅니다.
 * 한 facet이 검토 예산을 독점하지 않도록 비교 질의는 facet별 순위를 번갈아 선택합니다.
 */
function selectExhaustiveReviewPaths(
  indexedPaths: readonly string[],
  candidates: readonly IndexedSearchCandidate[] | undefined,
): string[] {
  const indexed = new Set(indexedPaths);
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const source of ['structural', 'ann', 'vector', 'bm25', undefined] as const) {
    const grouped = new Map<number, Map<string, IndexedSearchCandidate>>();
    for (const candidate of candidates ?? []) {
      if (!indexed.has(candidate.path) || (source && candidate.source !== source)) continue;
      const group = candidate.queryIndex ?? 0;
      const byPath = grouped.get(group) ?? new Map<string, IndexedSearchCandidate>();
      const current = byPath.get(candidate.path);
      if (!current || candidate.rank < current.rank) byPath.set(candidate.path, candidate);
      grouped.set(group, byPath);
    }
    const groups = new Map<number, string[]>();
    for (const [group, byPath] of grouped) {
      groups.set(
        group,
        [...byPath.values()]
          .sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path))
          .map((candidate) => candidate.path),
      );
    }
    const limit = source
      ? Math.min(EXHAUSTIVE_REVIEW_PATH_LIMIT, selected.length + REVIEW_PATHS_PER_SOURCE)
      : EXHAUSTIVE_REVIEW_PATH_LIMIT;
    const cursors = new Map<number, number>();
    while (selected.length < limit) {
      let added = false;
      for (const group of [...groups.keys()].sort((left, right) => left - right)) {
        const paths = groups.get(group) ?? [];
        let cursor = cursors.get(group) ?? 0;
        while (cursor < paths.length && seen.has(paths[cursor] ?? '')) cursor += 1;
        const path = paths[cursor];
        cursors.set(group, cursor + 1);
        if (!path) continue;
        seen.add(path);
        selected.push(path);
        added = true;
        if (selected.length >= limit) break;
      }
      if (!added) break;
    }
  }
  return selected;
}

/**
 * 색인 완료 수와 허용 범위 대비 미색인 수를 센다.
 * metadata 때문에 엔진 입력에서 빠진 경로는 chat이 unreviewedCount에 가산한다.
 */
async function collectInventory(
  host: IndexedSearchDepsHost,
  indexedPaths: readonly string[],
  restriction?: { scopes: readonly string[]; filters?: RustIndexedEvidenceFilters },
): Promise<IndexedEvidenceInventory> {
  const candidateCount = restriction ? undefined : host.getCandidateCount?.();
  if (Number.isSafeInteger(candidateCount) && candidateCount !== undefined && candidateCount >= 0) {
    return {
      indexedCount: indexedPaths.length,
      unreviewedCount: 0,
      notIndexedCount: Math.max(0, candidateCount - indexedPaths.length),
    };
  }
  const allCandidatePaths = await listCandidatePaths(host);
  const candidatePaths = allCandidatePaths && restriction
    ? await resolveIndexedSearchPaths(host, allCandidatePaths, restriction) : allCandidatePaths;
  const indexed = new Set(indexedPaths);
  return {
    indexedCount: indexedPaths.length,
    unreviewedCount: 0,
    notIndexedCount: candidatePaths
      ? candidatePaths.filter((path) => !indexed.has(path)).length
      : 0,
  };
}

async function listCandidatePaths(
  host: IndexedSearchDepsHost,
): Promise<readonly string[] | undefined> {
  if (host.getCandidatePaths) return host.getCandidatePaths();
  if (!host.settings) return undefined;
  const files = await getRagCandidateFiles(host.app.vault, host.settings.rag, host.settings.chat);
  return files.map((file) => file.path);
}

/** 검색 화면이 쓰는 포트. 색인 저장소가 없으면 화면은 사용 불가 상태를 표시한다. */
export function createPluginSearchPort(host: IndexedSearchDepsHost): SearchPort {
  return async (request) => {
    const source = await collectIndexedSearchSource(
      host,
      request.query,
      request.signal,
      request.query,
      false,
    );
    if (!source) return null;
    return createIndexedSearchPort({ ...source, verifyCurrentSource: false })(request);
  };
}

/**
 * 기존 하이브리드 query engine 결과를 엔진 후보 신호로 옮긴다.
 * 후보 신호를 못 만들면 색인 본문만으로 검색하고 그 사실을 로그에 남긴다.
 */
/** 언어 변형 후보는 원래 질문의 보조 신호이며 비교 facet 귀속을 새로 만들지 않습니다. */
async function collectVariantCandidates(
  engine: RAGQueryEngine | null,
  variants: readonly string[],
  signal?: AbortSignal,
  semanticTimeoutMs = SEMANTIC_CANDIDATE_TIMEOUT_MS,
): Promise<IndexedSearchCandidate[]> {
  if (!engine) return [];
  const collected: IndexedSearchCandidate[] = [];
  const limited = variants.slice(0, MAX_QUERY_VARIANTS);
  for (const variant of limited) {
    signal?.throwIfAborted();
    const plan = planIndexedSearchQueriesRust({
      question: variant,
      scoringQuestion: variant,
      scopes: [],
    });
    if (!plan) continue;
    const resolution = await collectHybridCandidates(engine, plan, signal, semanticTimeoutMs);
    for (const candidate of resolution.candidates ?? []) {
      collected.push({ ...candidate, queryIndex: 0 });
    }
  }
  return collected;
}

/** 같은 (queryIndex, source, path) 후보는 좋은 순위만 남깁니다. */
function mergeCandidateLists(
  base: readonly IndexedSearchCandidate[],
  extra: readonly IndexedSearchCandidate[],
): IndexedSearchCandidate[] {
  const merged = new Map<string, IndexedSearchCandidate>();
  for (const candidate of [...base, ...extra]) {
    const key = `${candidate.queryIndex ?? 0}\u0000${candidate.source}\u0000${candidate.path}`;
    const current = merged.get(key);
    if (!current || candidate.rank < current.rank) merged.set(key, candidate);
  }
  return [...merged.values()];
}

async function collectHybridCandidates(
  engine: RAGQueryEngine | null,
  plan: IndexedSearchPlan,
  signal?: AbortSignal,
  semanticTimeoutMs = SEMANTIC_CANDIDATE_TIMEOUT_MS,
  bm25ByFacet?: readonly (readonly RAGExhaustiveBm25Match[])[],
): Promise<HybridCandidateResolution> {
  if (!engine) {
    return {
      candidates: undefined,
      state: 'initializing',
      failedFacetIds: [],
      exhaustiveReview: false,
    };
  }
  signal?.throwIfAborted();
  const facets = plan.facets.slice(0, MAX_HYBRID_FACETS);
  const outcomes = await Promise.all(
    facets.map(async (facet, facetIndex) => {
      const semanticStartedAt = performance.now();
      let semanticDurationMs = 0;
      const [bm25Outcome, semanticOutcome] = await Promise.allSettled([
        bm25ByFacet
          ? Promise.resolve(bm25ByFacet[facetIndex] ?? [])
          : Promise.resolve().then(() => engine.queryBm25Exhaustive(facet.query, undefined, signal)),
        querySemanticCandidates(engine, facet, signal, semanticTimeoutMs).finally(() => {
          semanticDurationMs = performance.now() - semanticStartedAt;
        }),
      ]);
      if (signal?.aborted) {
        const rejected = [bm25Outcome, semanticOutcome].find(
          (outcome) => outcome.status === 'rejected',
        );
        throw signal.reason ?? (rejected?.status === 'rejected' ? rejected.reason : undefined);
      }
      if (bm25Outcome.status === 'rejected') {
        appLogger.warn('Exhaustive BM25 unavailable; preserving semantic candidates.', {
          source: 'search.candidates',
          error: bm25Outcome.reason,
        });
      }
      const diagnostics: RetrievalProviderDiagnostic[] = [];
      if (semanticOutcome.status === 'rejected') {
        const error =
          semanticOutcome.reason instanceof Error
            ? semanticOutcome.reason
            : new Error('semantic-candidate-error');
        diagnostics.push({
          providerId: `semantic:${facet.id}`,
          source: 'vector',
          status: error.name === 'TimeoutError' ? 'timeout' : 'error',
          durationMs: semanticDurationMs,
          candidateCount: 0,
          readiness: 'degraded',
          estimatedCost: 'low',
          error: error.message,
        });
        appLogger.warn('Hybrid facet candidates unavailable; preserving exhaustive BM25.', {
          source: 'search.candidates',
          error: semanticOutcome.reason,
        });
      }
      const bm25 =
        bm25Outcome.status === 'fulfilled' && bm25Outcome.value !== null ? bm25Outcome.value : null;
      return {
        facet,
        bm25,
        semantic:
          semanticOutcome.status === 'fulfilled' ? semanticOutcome.value : ([] as QueryResult[]),
        failed: bm25 === null,
        diagnostics,
      } as const;
    }),
  );
  signal?.throwIfAborted();
  const diagnostics = outcomes.flatMap((outcome) => outcome.diagnostics);
  const failedFacetIds = outcomes.filter((outcome) => outcome.failed).map(({ facet }) => facet.id);
  const exhaustiveReview =
    outcomes.length > 0 &&
    failedFacetIds.length === 0 &&
    outcomes.some((outcome) => (outcome.bm25?.length ?? 0) > 0 || outcome.semantic.length > 0);
  const candidates: IndexedSearchCandidate[] = [];
  for (const outcome of outcomes) {
    outcome.bm25?.forEach((match) => {
      const candidate: IndexedSearchCandidate = {
        path: match.path,
        ...(match.startLine !== undefined ? { startLine: match.startLine } : {}),
        ...(match.endLine !== undefined ? { endLine: match.endLine } : {}),
        score: match.score,
        source: 'bm25',
        rank: match.rank,
      };
      if (plan.mode === 'comparison') candidate.queryIndex = outcome.facet.queryIndex;
      candidates.push(candidate);
    });
    outcome.semantic.forEach((result, index) => {
      const candidate: IndexedSearchCandidate = {
        path: result.sourcePath,
        startLine: result.entry.metadata.startLine,
        endLine: result.entry.metadata.endLine,
        score: result.combinedScore,
        source: candidateSource(result),
        rank: index + 1,
      };
      if (plan.mode === 'comparison') candidate.queryIndex = outcome.facet.queryIndex;
      candidates.push(candidate);
    });
  }
  if (candidates.length === 0 && !exhaustiveReview) {
    return {
      candidates: undefined,
      state: engine.getCandidateReadiness?.() ?? 'ready',
      diagnostics,
      failedFacetIds,
      exhaustiveReview,
    };
  }
  return {
    candidates,
    state: 'ready',
    diagnostics,
    failedFacetIds,
    exhaustiveReview,
  };
}

async function querySemanticCandidates(
  engine: RAGQueryEngine,
  facet: IndexedSearchPlan['facets'][number],
  signal?: AbortSignal,
  timeoutMs = SEMANTIC_CANDIDATE_TIMEOUT_MS,
): Promise<QueryResult[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timerHost = typeof window === 'undefined' ? globalThis : window;
  let timeout: ReturnType<typeof timerHost.setTimeout> | undefined;
  const timedOut = new Promise<QueryResult[]>((_, reject) => {
    timeout = timerHost.setTimeout(() => {
      const error = new DOMException('semantic-candidate-timeout', 'TimeoutError');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    const results = await Promise.race([
      engine.query(
        facet.query,
        facet.kind === 'question' ? MAIN_CANDIDATE_LIMIT : SUBJECT_CANDIDATE_LIMIT,
        undefined,
        undefined,
        { signal: controller.signal, excludedProviderIds: ['bm25'] },
      ),
      timedOut,
    ]);
    signal?.throwIfAborted();
    return results;
  } finally {
    if (timeout !== undefined) timerHost.clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function candidateSource(result: QueryResult): IndexedEvidenceCandidate['source'] {
  const sources = result.retrievalSources ?? [];
  if (sources.includes('structural')) return 'structural';
  if (sources.includes('ann')) return 'ann';
  if (sources.includes('vector')) return 'vector';
  if (sources.includes('bm25')) return 'bm25';
  return result.bm25Score >= result.vectorScore ? 'bm25' : 'vector';
}
