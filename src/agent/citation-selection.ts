import { t } from '../i18n';
import { planResearchCitationIndicesRust } from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';

const DEFAULT_FALLBACK_LIMIT = 4;

export function selectAnswerCitations(
  content: string,
  citations: readonly SourceCitation[],
  fallbackLimit = DEFAULT_FALLBACK_LIMIT,
): SourceCitation[] {
  const indices = planResearchCitationIndicesRust(
    content,
    citations.map((citation) => citation.id),
    citations.map((citation) => citation.filePath),
    fallbackLimit,
  );
  if (!indices) throw new Error(t('sourceCitationSelectionFailed'));
  return indices.flatMap((index) => {
    const citation = citations[index];
    return citation ? [citation] : [];
  });
}

/** 사용자에게 표시하는 답변에는 실제 언급된 출처만 연결합니다. */
export function selectDisplayedAnswerCitations(
  content: string,
  citations: readonly SourceCitation[],
): SourceCitation[] {
  return selectAnswerCitations(content, citations, 0);
}

/**
 * 교정 답변이 검증된 source ID를 실수로 지워도 교정 전후에 실제 언급된 출처 카드를 보존합니다.
 * 교정 후 출처를 먼저 두고 같은 ID는 한 번만 반환합니다.
 */
export function selectGroundedRepairCitations(
  originalContent: string,
  repairedContent: string,
  citations: readonly SourceCitation[],
): SourceCitation[] {
  const selected = [
    ...selectDisplayedAnswerCitations(repairedContent, citations),
    ...selectDisplayedAnswerCitations(originalContent, citations),
  ];
  const seen = new Set<string>();
  return selected.filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}
