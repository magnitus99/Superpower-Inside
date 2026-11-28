/** A short spelling for ONE explicitly selected (facet, verified source) pair in this request. */
export function answerBindings(sourceIds: readonly string[], supported: readonly { id: string; sourceIds: readonly string[] }[]) {
  return sourceIds.flatMap((sourceId, i) => {
    const source = `S${i + 1}`;
    const pairs: { key: string; sourceId: string; facetId: string | null }[] = supported.flatMap((f, j) =>
      f.sourceIds.includes(sourceId) ? [{ key: `F${j + 1}.${source}`, sourceId, facetId: f.id }] : []);
    return pairs.length ? pairs : [{ key: source, sourceId, facetId: null }];
  });
}

/** 단일 답변(null)만 원래 형식을 유지합니다. 비교 답변은 지지 쌍 목록이 비어 있어도
 * 디코딩을 거치며, 출처·항목·종합 검증은 Rust가 담당합니다. */
export function decodeAnswerBindings(response: string, bindings: ReturnType<typeof answerBindings> | null, rejected?: (code: string) => void): string {
  if (bindings === null) return response;
  const reject = (reason: string): string => { rejected?.(reason); return ''; };
  if (response.length > 1_000_000) return reject('response-limit');
  let raw: unknown;
  // Rust는 설명문에서도 JSON을 추출하므로 파싱에 실패한 원문을 그대로 넘기지 않습니다.
  try { raw = JSON.parse(response.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, '$1')); } catch { return reject('invalid-json'); }
  if (!raw || typeof raw !== 'object' || !('paragraphs' in raw) || !Array.isArray(raw.paragraphs)) return reject('invalid-paragraphs');
  if (raw.paragraphs.length > 64) return reject('paragraph-limit');
  const byKey = new Map(bindings.map(b => [b.key,b]));
  const paragraphs = [];
  for (const p of raw.paragraphs as unknown[]) {
    if (!p || typeof p !== 'object' || !('text' in p) || !('supports' in p) || 'sources' in p || 'covers' in p) return reject(`paragraph-${paragraphs.length+1}:mixed-or-missing-supports`);
    if (!Array.isArray(p.supports) || !p.supports.length || p.supports.length > 8 || new Set(p.supports).size !== p.supports.length) return reject(`paragraph-${paragraphs.length+1}:primary-array`);
    const sources = new Set<string>(), covers = new Set<string>();
    for (const key of p.supports as unknown[]) {
      const pair = typeof key === 'string' && byKey.get(key);
      if (!pair || !pair.facetId) return reject(`paragraph-${paragraphs.length+1}:choose-primary-key`);
      sources.add(pair.sourceId);
      if (pair.facetId) covers.add(pair.facetId);
    }
    if ('additional' in p) {
      if (!Array.isArray(p.additional) || p.additional.length + p.supports.length > 8 || new Set(p.additional).size !== p.additional.length) return reject('additional-array');
      for (const key of p.additional as unknown[]) {
        const pair = typeof key === 'string' && byKey.get(key);
        if (!pair || pair.facetId !== null) return reject(`paragraph-${paragraphs.length+1}:additional-key`);
        sources.add(pair.sourceId);
      }
    }
    paragraphs.push({ text: p.text, sources: [...sources], covers: [...covers] });
  }
  return JSON.stringify({ paragraphs });
}
