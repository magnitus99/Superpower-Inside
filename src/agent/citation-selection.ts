import { t } from '../i18n';
import { planResearchCitationIndicesRust } from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';

const DEFAULT_FALLBACK_LIMIT = 12;

export function selectAnswerCitations(
  content: string,
  citations: readonly SourceCitation[],
  fallbackLimit = DEFAULT_FALLBACK_LIMIT,
): SourceCitation[] {
  const indices = planResearchCitationIndicesRust(
    content,
    citations.map((citation) => citation.id),
    fallbackLimit,
  );
  if (!indices) throw new Error(t('sourceCitationSelectionFailed'));
  return indices.flatMap((index) => {
    const citation = citations[index];
    return citation ? [citation] : [];
  });
}
