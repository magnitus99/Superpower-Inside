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
