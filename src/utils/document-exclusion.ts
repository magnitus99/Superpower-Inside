import type { App, TFile } from 'obsidian';
import { isRagFrontmatterExcludedRust } from '../rag/rust-core';

export const TOGGLE_DOCUMENT_EXCLUSION_COMMAND_ID = 'toggle-document-exclusion';

/** Obsidian의 원자적 YAML 편집으로 본문과 다른 속성을 보존합니다. */
export async function toggleDocumentExclusion(app: App, file: TFile): Promise<boolean> {
  if (file.extension !== 'md') throw new Error('Frontmatter editing requires a Markdown file.');
  let excluded = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const current = isRagFrontmatterExcludedRust(frontmatter);
    if (current === null) throw new Error('Frontmatter exclusion policy is unavailable.');
    excluded = !current;
    if (excluded) {
      frontmatter['superpower-inside-exclude'] = true;
    } else {
      delete frontmatter['superpower-inside-exclude'];
    }
  });
  return excluded;
}
