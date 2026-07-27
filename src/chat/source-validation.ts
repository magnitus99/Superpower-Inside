import { t } from '../i18n';
import {
  planSourceReferencesRust,
  planSourceValidationInputsRust,
  planSourceValidationWarningsRust,
} from '../rag/rust-core';
import type { SourceCitation, SourceValidationWarning } from './types';

export interface SourceReferenceResolver {
  exists(path: string): boolean;
}

export function validateAnswerSources(
  content: string,
  citations: SourceCitation[],
  resolver: SourceReferenceResolver,
): SourceValidationWarning[] {
  const references = planSourceReferencesRust(content) ?? [];
  const validationInputs = planSourceValidationInputsRust(
    references,
    citations.map((citation) => citation.id),
    citations.map((citation) => citation.filePath),
    citations.map((citation) => citation.status ?? ''),
  );
  const existingAliases: string[] = [];
  for (const alias of validationInputs?.aliasCandidates ?? []) {
    if (resolver.exists(alias)) {
      existingAliases.push(alias);
    }
  }
  const warnings = planSourceValidationWarningsRust(
    references,
    validationInputs?.verifiedCitationIds ?? [],
    validationInputs?.verifiedPaths ?? [],
    existingAliases,
  );

  return (warnings ?? []).map((warning) => ({
    ...warning,
    detail:
      warning.kind === 'unverified-source'
        ? t('sourceUnverifiedIdWarning')
        : t('sourceMissingVaultLinkWarning'),
  }));
}
