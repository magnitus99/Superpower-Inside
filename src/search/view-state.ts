import type { SearchHighlight, SearchResponse } from './engine-port';

export interface TextSegment {
  text: string;
  highlighted: boolean;
}

export interface SearchResultCounts {
  passages: number;
  documents: number;
}

export type ModifiedPreset = 'any' | 'week' | 'month' | 'year';

const MODIFIED_PRESET_MS: Record<Exclude<ModifiedPreset, 'any'>, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

/**
 * 엔진이 준 ordered UTF-16 ranges로 DOM 텍스트를 나눈다.
 * 정렬·범위 보정은 엔진 계산 경계이므로 잘못된 구간은 강조 없이 전체 텍스트를 돌려준다.
 */
export function splitHighlightedText(
  text: string,
  highlights: readonly SearchHighlight[],
): TextSegment[] {
  if (text.length === 0) return [];
  let previousEnd = 0;
  for (const { start, end } of highlights) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < previousEnd ||
      end <= start ||
      end > text.length
    ) {
      return [{ text, highlighted: false }];
    }
    previousEnd = end;
  }
  if (highlights.length === 0) return [{ text, highlighted: false }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const { start, end } of highlights) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}

/** 결과 구절 수와 서로 다른 문서 수. 엔진 순위는 그대로 두고 세기만 한다. */
export function countSearchResults(response: SearchResponse): SearchResultCounts {
  const paths = new Set<string>();
  for (const item of response.evidence) paths.add(item.path);
  return { passages: response.evidence.length, documents: paths.size };
}

/** 쉼표·줄바꿈으로 구분한 입력을 중복 없는 목록으로 만든다. */
export function parseFilterList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value.split(/[,\n]/u)) {
    const item = raw.trim();
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}

/** 수정 시점 프리셋을 엔진 필터가 쓰는 ms epoch 하한으로 바꾼다. */
export function modifiedAfterFromPreset(
  preset: string,
  now: number,
): number | undefined {
  if (preset === 'any') return undefined;
  const span = MODIFIED_PRESET_MS[preset as Exclude<ModifiedPreset, 'any'>];
  return span === undefined ? undefined : now - span;
}

/** 원문 위치 표시용 줄 범위. 한 줄이면 숫자만 돌려준다. */
export function formatLineRange(start: number, end?: number): string {
  if (end === undefined || end <= start) return String(start);
  return `${start}–${end}`;
}
