// 검색 화면과 검색 엔진의 계약.
// 엔진(src/rag/rust-core.ts planIndexedEvidenceRust/verifyIndexedEvidenceRust)이 구절 선택·검증·순위를
// 담당하고, UI는 받은 순서 그대로 그룹핑·강조·표시만 한다.

export interface SearchFilters {
  pathPrefixes?: readonly string[];
  extensions?: readonly string[];
  tags?: readonly string[];
  /** 수정 시각 하한(ms epoch). */
  modifiedAfter?: number;
}

/** 하이브리드 후보 단계의 준비 상태. 초기화 중에는 빈 no-candidate로 확정하지 않는다. */
export type SearchCandidateState = 'ready' | 'indexing' | 'initializing' | 'unavailable';

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  signal?: AbortSignal;
}

export interface SearchHighlight {
  /** quote 텍스트 기준 UTF-16 오프셋. */
  start: number;
  end: number;
}

export interface SearchQueryToken {
  text: string;
  position: number;
  field: string;
  kind: string;
  negated: boolean;
  phraseIndex: number | null;
}

export interface SearchPhrase {
  tokens: readonly string[];
  negated: boolean;
  field: string;
}

/** 엔진이 검증한 원문 구절. 순위·점수·신호는 엔진이 결정하며 UI는 다시 계산하지 않는다. */
export interface SearchEvidence {
  sourceId: string;
  path: string;
  revision: string | null;
  startLine: number;
  endLine: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  score: number;
  rank: number;
  signal: string;
  phraseMatches: number;
  proximityScore: number;
  fieldScore: number;
  exactSignals: readonly string[];
  negatedNearby: boolean;
  duplicateOf: string | null;
  /** 엔진이 제공할 때만 존재하는 quote 기준 강조 구간. 없으면 강조 없이 표시한다. */
  highlights?: readonly SearchHighlight[];
}

export interface SearchDroppedDocuments {
  budget: number;
  belowThreshold: number;
  filtered: number;
}

export interface SearchDiagnostics {
  candidateDepth: number;
  candidateDocuments: number;
  selectedDocuments: number;
  truncated: boolean;
  droppedDocuments: SearchDroppedDocuments;
  unmatchedTerms: readonly string[];
  zeroHitReason: string | null;
}

export interface SearchCoverage {
  /** `all`은 전체 색인, `candidates`는 하이브리드 후보 경로만 검토한 범위입니다. */
  documentScope: 'all' | 'candidates';
  status: 'supported' | 'incomplete' | 'budget-exhausted';
  reviewedDocuments: number;
  unreviewedDocuments: number;
  notIndexedDocuments: number;
}

export interface SearchResponse {
  evidence: readonly SearchEvidence[];
  queryTokens: readonly SearchQueryToken[];
  phrases: readonly SearchPhrase[];
  diagnostics: SearchDiagnostics;
  coverage: SearchCoverage;
  /** 색인 사본과 현재 원문 리비전이 어긋나 제외한 문서 수. */
  staleDocuments: number;
}

/** null은 엔진 미가동·스키마 불일치를 뜻한다. UI는 실패 상태로 표시하고 자체 계산으로 대체하지 않는다. */
export type SearchPort = (request: SearchRequest) => Promise<SearchResponse | null>;

export interface SearchEvidenceGroup {
  path: string;
  evidence: readonly SearchEvidence[];
}

/** 엔진 순위를 유지한 채 파일별로 묶는다. 여기서 점수를 다시 계산하거나 재정렬하지 않는다. */
export function groupEvidenceByPath(evidence: readonly SearchEvidence[]): SearchEvidenceGroup[] {
  const groups = new Map<string, SearchEvidence[]>();
  for (const item of evidence) {
    const group = groups.get(item.path);
    if (group) {
      group.push(item);
      continue;
    }
    groups.set(item.path, [item]);
  }
  return [...groups].map(([path, items]) => ({ path, evidence: items }));
}
