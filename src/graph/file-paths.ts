export type GraphRagFilePathPredicate = (filePath: string) => boolean;

export function isGraphRagMarkdownFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md');
}

export function isProcessableGraphRagFilePath(
  filePath: string,
  predicate?: GraphRagFilePathPredicate,
): boolean {
  return isGraphRagMarkdownFilePath(filePath) && (predicate?.(filePath) ?? true);
}

export function filterGraphRagMarkdownFilePaths(filePaths: readonly string[]): string[] {
  return filePaths.filter(isGraphRagMarkdownFilePath);
}

export function filterProcessableGraphRagFilePaths(
  filePaths: readonly string[],
  predicate?: GraphRagFilePathPredicate,
): string[] {
  const markdownFilePaths = filterGraphRagMarkdownFilePaths(filePaths);
  if (!predicate) return markdownFilePaths;
  return markdownFilePaths.filter(predicate);
}
