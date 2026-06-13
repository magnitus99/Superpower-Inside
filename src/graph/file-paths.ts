import { planGraphRagMarkdownFilePathsRust } from '../rag/rust-core';

export type GraphRagFilePathPredicate = (filePath: string) => boolean;

export function isGraphRagMarkdownFilePath(filePath: string): boolean {
  return planGraphRagMarkdownFilePathsRust([filePath])?.length === 1;
}

export function isProcessableGraphRagFilePath(
  filePath: string,
  predicate?: GraphRagFilePathPredicate,
): boolean {
  return isGraphRagMarkdownFilePath(filePath) && (predicate?.(filePath) ?? true);
}

export function filterGraphRagMarkdownFilePaths(filePaths: readonly string[]): string[] {
  return planGraphRagMarkdownFilePathsRust(filePaths) ?? [];
}

export function filterProcessableGraphRagFilePaths(
  filePaths: readonly string[],
  predicate?: GraphRagFilePathPredicate,
): string[] {
  const markdownFilePaths = filterGraphRagMarkdownFilePaths(filePaths);
  if (!predicate) return markdownFilePaths;
  return markdownFilePaths.filter(predicate);
}
