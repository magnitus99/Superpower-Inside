import { getAllTags, type App, type TFile } from 'obsidian';
import { isRagFrontmatterExcludedRust, planTagMentionsRust } from '../rag/rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';

/** 본문 태그와 속성 태그는 Obsidian 캐시에서 읽고 범위 계산은 Rust에 맡긴다. */
export function collectTagMentionFiles(app: App): { files: TFile[]; tags: string[][] } {
  const files: TFile[] = [];
  const tags: string[][] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache || isRagFrontmatterExcludedRust(cache.frontmatter) !== false) continue;
    files.push(file);
    tags.push(getAllTags(cache) ?? []);
  }
  return { files, tags };
}

export function resolveTagMentionFiles(app: App, tag: string): readonly string[] {
  const snapshot = collectTagMentionFiles(app);
  const plan = planTagMentionsRust(snapshot.tags, tag);
  return selectByRustIndices(snapshot.files, plan?.fileIndices, { dedupe: true }).map(
    (file) => file.path,
  );
}
