import { TFile, type App } from 'obsidian';
import { t } from '../i18n';
import {
  extractVaultLinksRust,
  planReferenceFileIndicesRust,
  planVaultLinkCandidatesRust,
  planVaultLinkFallbackIndexRust,
} from '../rag/rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';

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
  const rustLinks = extractVaultLinksRust(content);
  return rustLinks ?? [];
}

export async function expandReferencedVaultFiles(
  sourceFile: TFile,
  sourceContent: string,
  app: App,
  maxReferences = DEFAULT_MAX_REFERENCES,
): Promise<ReferenceExpansionResult> {
  const references: ReferencedVaultFile[] = [];
  const warnings: string[] = [];
  const candidates: Array<{ file: TFile; requestedPath: string }> = [];

  for (const requestedPath of extractVaultLinks(sourceContent).slice(0, maxReferences)) {
    const file = resolveVaultLink(app, sourceFile.path, requestedPath);
    if (!file) {
      warnings.push(t('referenceMissingWarning', { path: requestedPath }));
      continue;
    }
    candidates.push({ file, requestedPath });
  }

  const selectedIndices =
    planReferenceFileIndicesRust(
      sourceFile.path,
      candidates.map((candidate) => candidate.file.path),
    ) ?? [];
  const selectedCandidates = selectByRustIndices(candidates, selectedIndices, { dedupe: true });
  for (const candidate of selectedCandidates) {
    try {
      references.push({
        file: candidate.file,
        requestedPath: candidate.requestedPath,
        content: await app.vault.cachedRead(candidate.file),
      });
    } catch (err) {
      warnings.push(
        t('referenceReadFailedWarning', {
          path: candidate.file.path,
          error: stringifyError(err),
        }),
      );
    }
  }

  return { references, warnings };
}

function resolveVaultLink(app: App, sourcePath: string, rawTarget: string): TFile | null {
  const plan = planVaultLinkCandidatesRust(sourcePath, rawTarget);
  if (!plan) return null;

  const metadataResolved = app.metadataCache.getFirstLinkpathDest(
    plan.candidates[0] ?? rawTarget,
    sourcePath,
  );
  if (metadataResolved instanceof TFile) return metadataResolved;

  for (const candidate of plan.candidates) {
    const file = app.vault.getAbstractFileByPath(candidate);
    if (file instanceof TFile) return file;
  }

  const markdownFiles = app.vault.getMarkdownFiles();
  const fallbackIndex = planVaultLinkFallbackIndexRust(
    plan.fallbackBasename,
    markdownFiles.map((file) => file.basename),
  );
  return fallbackIndex === null ? null : markdownFiles[fallbackIndex] ?? null;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
