/** 문서 누락을 줄이면서 키워드와 의미 검색을 함께 사용하는 기본값입니다. */
export const DEFAULT_SEARCH_QUALITY = {
  minScore: 0.3,
  enableBM25: true,
  bm25Weight: 0.3,
} as const;

/** 기본 청크 분할 값입니다. 인덱스 세대(청킹 계약)의 기준값으로도 사용합니다. */
export const DEFAULT_CHUNK_CONTRACT = {
  chunkSize: 1000,
  overlap: 100,
} as const;
