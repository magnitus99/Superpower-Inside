import type { SourceCitation, SourceValidationWarning } from './types';

export interface SourceReferenceResolver {
  exists(path: string): boolean;
}

interface ExtractedReference {
  label: string;
  target: string;
  kind: 'wikilink' | 'markdown-link' | 'source-id';
}

export function validateAnswerSources(
  content: string,
  citations: SourceCitation[],
  resolver: SourceReferenceResolver,
): SourceValidationWarning[] {
  const verifiedCitationIds = new Set(
    citations.filter((citation) => citation.status === 'verified').map((citation) => citation.id),
  );
  const verifiedPaths = new Set(
    citations
      .filter((citation) => citation.status === 'verified')
      .flatMap((citation) => pathAliases(citation.filePath)),
  );
  const warnings: SourceValidationWarning[] = [];
  const seen = new Set<string>();

  for (const reference of extractSourceReferences(content)) {
    if (reference.kind === 'source-id') {
      if (verifiedCitationIds.has(reference.target)) continue;
      addWarning(warnings, seen, {
        id: `source:${reference.target}`,
        label: reference.label,
        detail: '이번 응답의 검증된 검색 근거에 없는 출처 ID입니다.',
        kind: 'unverified-source',
      });
      continue;
    }

    const aliases = pathAliases(reference.target);
    const isVerified = aliases.some((alias) => verifiedPaths.has(alias));
    const exists = aliases.some((alias) => resolver.exists(alias));
    if (isVerified || exists) continue;

    addWarning(warnings, seen, {
      id: `link:${reference.target}`,
      label: reference.label,
      detail: 'vault에서 확인되지 않은 문서 링크입니다.',
      kind: 'missing-link',
    });
  }

  return warnings;
}

export function extractSourceReferences(content: string): ExtractedReference[] {
  const references: ExtractedReference[] = [];
  const wikiRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiRegex.exec(content)) !== null) {
    const target = wikiMatch[1].trim();
    if (target) references.push({ label: wikiMatch[0], target, kind: 'wikilink' });
  }

  const markdownRegex = /\[[^\]]+\]\(([^)\s]+\.md(?:#[^)]+)?)\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRegex.exec(content)) !== null) {
    const target = decodeURIComponent(markdownMatch[1].split('#')[0] ?? '').trim();
    if (target) references.push({ label: markdownMatch[0], target, kind: 'markdown-link' });
  }

  const sourceRegex = /\bSource\s+(rag-\d+|file-\d+|folder-\d+)\b/gi;
  let sourceMatch: RegExpExecArray | null;
  while ((sourceMatch = sourceRegex.exec(content)) !== null) {
    references.push({
      label: sourceMatch[0],
      target: sourceMatch[1],
      kind: 'source-id',
    });
  }

  return references;
}

function addWarning(
  warnings: SourceValidationWarning[],
  seen: Set<string>,
  warning: SourceValidationWarning,
): void {
  if (seen.has(warning.id)) return;
  seen.add(warning.id);
  warnings.push(warning);
}

function pathAliases(path: string): string[] {
  const withoutHeading = path.split('#')[0] ?? path;
  const normalized = withoutHeading.replace(/^\/+/, '');
  const withoutExtension = normalized.replace(/\.md$/i, '');
  const fileName = normalized.split('/').pop() ?? normalized;
  const basename = fileName.replace(/\.md$/i, '');
  return [
    ...new Set([normalized, `${normalized}.md`, withoutExtension, fileName, basename]),
  ].filter(Boolean);
}
