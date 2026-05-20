import { TFile, type App } from 'obsidian';

export interface ReferencedVaultFile {
  file: TFile;
  requestedPath: string;
  content: string;
}

export interface ReferenceExpansionResult {
  references: ReferencedVaultFile[];
  warnings: string[];
}

const DEFAULT_MAX_REFERENCES = 6;

export function extractVaultLinks(content: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  const addLink = (raw: string): void => {
    const normalized = normalizeLinkTarget(raw);
    if (!normalized || shouldIgnoreLinkTarget(normalized)) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    links.push(normalized);
  };

  const wikiRegex = /!?\[\[([^\]]+)\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiRegex.exec(content)) !== null) {
    addLink(wikiMatch[1]);
  }

  const markdownRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRegex.exec(content)) !== null) {
    addLink(markdownMatch[1]);
  }

  return links;
}

export async function expandReferencedVaultFiles(
  sourceFile: TFile,
  sourceContent: string,
  app: App,
  maxReferences = DEFAULT_MAX_REFERENCES,
): Promise<ReferenceExpansionResult> {
  const references: ReferencedVaultFile[] = [];
  const warnings: string[] = [];

  for (const requestedPath of extractVaultLinks(sourceContent).slice(0, maxReferences)) {
    const file = resolveVaultLink(app, sourceFile.path, requestedPath);
    if (!file) {
      warnings.push(`참조 문서를 찾을 수 없습니다: ${requestedPath}`);
      continue;
    }
    if (file.path === sourceFile.path) continue;
    if (references.some((reference) => reference.file.path === file.path)) continue;

    try {
      references.push({
        file,
        requestedPath,
        content: await app.vault.cachedRead(file),
      });
    } catch (err) {
      warnings.push(`참조 문서를 읽을 수 없습니다: ${file.path} (${stringifyError(err)})`);
    }
  }

  return { references, warnings };
}

function resolveVaultLink(app: App, sourcePath: string, rawTarget: string): TFile | null {
  const target = normalizeVaultPath(rawTarget);
  const metadataResolved = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  if (metadataResolved instanceof TFile) return metadataResolved;

  for (const candidate of createPathCandidates(sourcePath, target)) {
    const file = app.vault.getAbstractFileByPath(candidate);
    if (file instanceof TFile) return file;
  }

  return (
    app.vault
      .getMarkdownFiles()
      .find((file) => file.basename === stripMarkdownExtension(target.split('/').pop() ?? target)) ??
    null
  );
}

function createPathCandidates(sourcePath: string, target: string): string[] {
  const sourceFolder = sourcePath.split('/').slice(0, -1).join('/');
  const candidates = [target, ensureMarkdownExtension(target)];
  if (sourceFolder) {
    candidates.push(
      normalizeVaultPath(`${sourceFolder}/${target}`),
      normalizeVaultPath(`${sourceFolder}/${ensureMarkdownExtension(target)}`),
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeLinkTarget(raw: string): string {
  const withoutAlias = raw.split('|')[0] ?? '';
  const withoutHeading = withoutAlias.split('#')[0] ?? '';
  const withoutBlock = withoutHeading.split('^')[0] ?? '';
  return decodeUriSafely(withoutBlock.trim());
}

function normalizeVaultPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function shouldIgnoreLinkTarget(target: string): boolean {
  return (
    target === '' ||
    target.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith('mailto:')
  );
}

function ensureMarkdownExtension(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`;
}

function stripMarkdownExtension(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -3) : path;
}

function decodeUriSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
