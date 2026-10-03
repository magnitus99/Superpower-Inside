import { planGraphRagSourceFilePathsRust } from '../rag/rust-core';

export type GraphRagFilePathPredicate = (filePath: string) => boolean;

export function isGraphRagSourceFilePath(filePath: string): boolean {
  return planGraphRagSourceFilePathsRust([filePath])?.length === 1;
}

export function isProcessableGraphRagFilePath(
  filePath: string,
  predicate?: GraphRagFilePathPredicate,
): boolean {
  return isGraphRagSourceFilePath(filePath) && (predicate?.(filePath) ?? true);
}

export function filterGraphRagSourceFilePaths(filePaths: readonly string[]): string[] {
  return planGraphRagSourceFilePathsRust(filePaths) ?? [];
}

export function filterProcessableGraphRagFilePaths(
  filePaths: readonly string[],
  predicate?: GraphRagFilePathPredicate,
): string[] {
  const sourceFilePaths = filterGraphRagSourceFilePaths(filePaths);
  if (!predicate) return sourceFilePaths;
  return sourceFilePaths.filter(predicate);
}
