import { TFile, type App } from 'obsidian';
import type {
  IndexedEvidenceCandidate,
  IndexedEvidenceInventory,
  IndexedVaultCorpus,
} from '../agent/indexed-vault-review';
import type { QueryResult, RAGQueryEngine } from '../rag/query';
import { planIndexedSearchQueriesRust, type IndexedSearchPlan } from '../rag/rust-core';
import { readSourceText } from '../rag/source-access';
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
  settings?: Pick<SuperpowerInsideSettings, 'rag' | 'chat'>;
  /** 재색인·초기화 중에는 부분 색인으로 답하지 않습니다. */
  isIndexing?: () => boolean;
}

const MAIN_CANDIDATE_LIMIT = 64;
const SUBJECT_CANDIDATE_LIMIT = 32;
const MAX_HYBRID_FACETS = 3;

type IndexedSearchCandidate = IndexedEvidenceCandidate & { queryIndex?: number };

interface HybridCandidateResolution {
  candidates: readonly IndexedSearchCandidate[] | undefined;
  state: SearchCandidateState;
  failedFacetIds: readonly string[];
}

/** 색인 사본과 현재 원문 리비전(mtime:size)을 대조하는 reader. */
export function createVaultRevisionReader(app: App): (path: string) => Promise<string | null> {
  return async (path) => {
    const stat = await app.vault.adapter.stat(path);
    return stat ? `${stat.mtime}:${stat.size}` : null;
  };
}

/** 답변 전에 채택 문서의 현재 원문과 revision을 읽는 로컬 vault reader를 만듭니다. */
export function createVaultSourceReader(
  app: App,
): (path: string, signal?: AbortSignal) => Promise<IndexedEvidenceSourceSnapshot> {
  return async (path, signal) => {
    try {
      signal?.throwIfAborted();
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return { revision: null, text: null };
      const before = await app.vault.adapter.stat(path);
      if (!before) return { revision: null, text: null };
      const source = await readSourceText(app.vault, file, { signal, forceRefresh: true });
      signal?.throwIfAborted();
      const after = await app.vault.adapter.stat(path);
      if (!after || before.mtime !== after.mtime || before.size !== after.size) {
        return { revision: null, text: null };
      }
      return {
        revision: `${after.mtime}:${after.size}`,
        text: source.text,
      };
    } catch {
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
): Promise<IndexedSearchSource | null> {
  const corpus = host.documentCorpus;
  if (!corpus) return null;
  const sourceReader = createVaultSourceReader(host.app);
  const indexedPaths = await corpus.getIndexedFilePaths();
  if (signal?.aborted) return null;
  const inventory = await collectInventory(host, indexedPaths);
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
      inventory,
      searchPlan: undefined,
      revisionReader: createVaultRevisionReader(host.app),
      sourceReader,
    };
  }
  const candidateResolution =
    indexedPaths.length === 0
      ? {
          candidates: undefined,
          state: host.isIndexing?.() === true ? ('indexing' as const) : ('unavailable' as const),
          failedFacetIds: [],
        }
      : host.isIndexing?.() === true
        ? { candidates: undefined, state: 'indexing' as const, failedFacetIds: [] }
        : await collectHybridCandidates(host.ragEngine, searchPlan, signal);
  return {
    corpus,
    getIndexedPaths: () => Promise.resolve(indexedPaths),
    candidates: candidateResolution.candidates,
    candidatesState: candidateResolution.state,
    inventory,
    searchPlan: { ...searchPlan, failedFacetIds: candidateResolution.failedFacetIds },
    revisionReader: createVaultRevisionReader(host.app),
    sourceReader,
  };
}

/**
 * 색인 완료 수와 허용 범위 대비 미색인 수를 센다.
 * metadata 때문에 엔진 입력에서 빠진 경로는 chat이 unreviewedCount에 가산한다.
 */
async function collectInventory(
  host: IndexedSearchDepsHost,
  indexedPaths: readonly string[],
): Promise<IndexedEvidenceInventory> {
  const candidatePaths = await listCandidatePaths(host);
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
    const source = await collectIndexedSearchSource(host, request.query, request.signal);
    if (!source) return null;
    return createIndexedSearchPort(source)(request);
  };
}

/**
 * 기존 하이브리드 query engine 결과를 엔진 후보 신호로 옮긴다.
 * 후보 신호를 못 만들면 색인 본문만으로 검색하고 그 사실을 로그에 남긴다.
 */
async function collectHybridCandidates(
  engine: RAGQueryEngine | null,
  plan: IndexedSearchPlan,
  signal?: AbortSignal,
): Promise<HybridCandidateResolution> {
  if (!engine) {
    return { candidates: undefined, state: 'initializing', failedFacetIds: [] };
  }
  signal?.throwIfAborted();
  const facets = plan.facets.slice(0, MAX_HYBRID_FACETS);
  const outcomes = await Promise.all(
    facets.map(async (facet) => {
      signal?.throwIfAborted();
      try {
        const results = await engine.query(
          facet.query,
          facet.kind === 'question' ? MAIN_CANDIDATE_LIMIT : SUBJECT_CANDIDATE_LIMIT,
          undefined,
          undefined,
          { signal, fastCandidates: true },
        );
        return { facet, results, failed: false } as const;
      } catch (error) {
        if (signal?.aborted) throw error;
        appLogger.warn('Hybrid facet candidates unavailable; preserving other facet results.', {
          source: 'search.candidates',
          error,
        });
        return { facet, results: [] as QueryResult[], failed: true } as const;
      }
    }),
  );
  signal?.throwIfAborted();
  const failedFacetIds = outcomes.filter((outcome) => outcome.failed).map(({ facet }) => facet.id);
  if (outcomes.length > 0 && failedFacetIds.length === outcomes.length) {
    return {
      candidates: undefined,
      state: engine.getCandidateReadiness?.() ?? 'unavailable',
      failedFacetIds,
    };
  }
  const candidates: IndexedSearchCandidate[] = [];
  for (const outcome of outcomes) {
    if (outcome.failed) continue;
    outcome.results.forEach((result, index) => {
      const candidate: IndexedSearchCandidate = {
        path: result.sourcePath,
        startLine: result.entry.metadata.startLine + 1,
        endLine:
          result.entry.metadata.endLine === undefined
            ? undefined
            : result.entry.metadata.endLine + 1,
        score: result.combinedScore,
        source: candidateSource(result),
        rank: index + 1,
      };
      if (plan.mode === 'comparison') candidate.queryIndex = outcome.facet.queryIndex;
      candidates.push(candidate);
    });
  }
  if (candidates.length === 0) {
    return {
      candidates: undefined,
      state: engine.getCandidateReadiness?.() ?? 'ready',
      failedFacetIds,
    };
  }
  return {
    candidates,
    state: 'ready',
    failedFacetIds,
  };
}

function candidateSource(result: QueryResult): IndexedEvidenceCandidate['source'] {
  const sources = result.retrievalSources ?? [];
  if (sources.includes('structural')) return 'structural';
  if (sources.includes('ann')) return 'ann';
  if (sources.includes('vector')) return 'vector';
  if (sources.includes('bm25')) return 'bm25';
  return result.bm25Score >= result.vectorScore ? 'bm25' : 'vector';
}
