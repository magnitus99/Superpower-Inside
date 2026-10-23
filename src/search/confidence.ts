/**
 * 검색 근거의 확신도를 3단으로 나눕니다.
 *
 * 상용 검색·AI 답변의 관행을 따릅니다. Google은 결과가 부족하면 "Showing results for …",
 * AI 모드는 해석이 갈릴 때 답변 뒤에 대안 해석을 붙입니다. Elasticsearch는 `min_score`로
 * 하위 후보를 잘라내지만, 우리는 잘라내는 대신 **신뢰도만 표시**해 근거를 잃지 않습니다.
 *
 * 판정은 세 신호를 함께 봅니다.
 * - 근거 개수: 하나뿐이면 2·3위와 비교할 수 없어 확신을 높이기 어렵습니다.
 * - 최고점 대비 2위 격차: 2위가 최고점의 60% 이상이면 해석이 갈릴 수 있습니다.
 * - 경로 다양성: 후보가 모두 같은 파일이면 서로 다른 근거가 아닙니다.
 */

/** 근거 확신도. */
export type IndexedSearchConfidence = 'high' | 'medium' | 'low';

export interface IndexedSearchConfidenceInput {
  /** 검토 대상으로 채택된 근거 개수. */
  evidenceCount: number;
  /** 채택된 근거의 최고 점수(없으면 0). */
  topScore: number;
  /** 두 번째로 높은 근거 점수(없으면 0). */
  secondScore: number;
  /** 채택된 근거가 걸친 서로 다른 문서 경로 수. */
  distinctPathCount: number;
}

/** 2위가 최고점의 이 비율 이상이면 해석이 갈릴 수 있다고 봅니다. */
const AMBIGUOUS_RATIO = 0.6;
/** 이 개수 미만의 근거만 있으면 확신을 높게 보지 않습니다. */
const THIN_EVIDENCE_COUNT = 2;

/**
 * 근거 확신도를 판정합니다.
 * @param input 판정에 쓰는 신호
 * @returns `high` | `medium` | `low`
 */
export function classifyIndexedSearchConfidence(
  input: IndexedSearchConfidenceInput,
): IndexedSearchConfidence {
  const evidenceCount = Math.max(0, Math.trunc(input.evidenceCount));
  if (evidenceCount === 0) return 'low';
  const distinctPathCount = Math.max(0, Math.trunc(input.distinctPathCount));
  const topScore = Number.isFinite(input.topScore) ? Math.max(0, input.topScore) : 0;
  const secondScore = Number.isFinite(input.secondScore) ? Math.max(0, input.secondScore) : 0;
  if (topScore <= 0) return 'low';
  // 서로 다른 문서가 하나뿐이면 격차를 비교할 대상이 없습니다.
  const ambiguous = secondScore > 0 && secondScore >= topScore * AMBIGUOUS_RATIO;
  const thin = evidenceCount < THIN_EVIDENCE_COUNT || distinctPathCount < THIN_EVIDENCE_COUNT;
  if (ambiguous && thin) return 'low';
  if (ambiguous || thin) return 'medium';
  return 'high';
}

/**
 * 확신도가 높지 않을 때 답변에 덧붙일 대안 해석 후보를 고릅니다.
 *
 * 답변을 막고 되묻는 대신, 답변을 그대로 보여 주고 뒤에 "다른 해석"을 붙이는 방식입니다.
 * @param paths 후보 경로(점수 내림차순)
 * @param limit 최대 개수
 * @returns 경로 목록(중복 없음)
 */
export function selectAlternativeInterpretations(
  paths: readonly string[],
  limit = 2,
): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  const maximum = Math.max(0, Math.trunc(limit));
  if (maximum === 0) return selected;
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    selected.push(path);
    if (selected.length >= maximum) break;
  }
  return selected;
}

/**
 * 근거 목록에서 확신도와 다른 해석 후보를 계산합니다.
 *
 * 점수는 문서 단위 최고점으로 묶어 비교합니다. 한 문서의 구절 여러 개가 상위를 차지해도
 * 그것은 해석이 갈리는 신호가 아니기 때문입니다.
 * @param evidence 경로와 점수를 가진 근거 목록
 */
export function summarizeIndexedConfidence(
  evidence: readonly { path: string; score: number }[],
): { confidence: IndexedSearchConfidence; alternatives: readonly string[] } {
  const bestByPath = new Map<string, number>();
  for (const item of evidence) {
    const current = bestByPath.get(item.path);
    if (current === undefined || item.score > current) bestByPath.set(item.path, item.score);
  }
  const ranked = [...bestByPath.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const confidence = classifyIndexedSearchConfidence({
    evidenceCount: evidence.length,
    topScore: ranked[0]?.[1] ?? 0,
    secondScore: ranked[1]?.[1] ?? 0,
    distinctPathCount: ranked.length,
  });
  if (confidence === 'high') return { confidence, alternatives: [] };
  return {
    confidence,
    alternatives: selectAlternativeInterpretations(ranked.map(([path]) => path)),
  };
}
