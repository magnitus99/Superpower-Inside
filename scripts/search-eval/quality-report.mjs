// 앱 내부의 중간 파일과 최종 공개 보고서는 같은 쓰기 전 허용 목록을 사용합니다.
export function publicReport(value) {
  const keys = new Set(('schemaVersion status reason scope semantic rows ledger required found missing uniqueUsefulRecall duplication noise deliveredBytes density citationFailures hardLeakage noAnswerPass dossierBytes passed discoveryMissing oracleDocuments oraclePassages oracleOccurrences current aggregationPass firstLoss cappedRecall baseline densityImproved provider embedding network releases suppressedOutput').split(' '));
  const labels = new Set(('passed failed blocked synthetic-product-runtime vault-product-runtime unverified-no-prepared-vectors unknown none discovery verification dossier engine-only-snapshot-required engine-only-snapshot-unavailable independent-gold-required quality-attempt-blocked quality-vault-blocked quality-loop-blocked').split(' '));
  function copy(entry) {
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (typeof entry === 'string' && labels.has(entry)) return entry;
    if (Array.isArray(entry)) return Array.from(entry, copy);
    if (entry && typeof entry === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(entry)) {
        if (!keys.has(key)) throw new Error('quality-output-blocked');
        result[key] = copy(value);
      }
      return result;
    }
    throw new Error('quality-output-blocked');
  }
  return copy(value);
}
