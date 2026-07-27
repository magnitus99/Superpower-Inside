import { describe, expect, it } from 'vitest';
import {
  filterGraphRagMarkdownFilePaths,
  filterProcessableGraphRagFilePaths,
  isGraphRagMarkdownFilePath,
  isProcessableGraphRagFilePath,
} from './file-paths';

describe('GraphRAG file path policy', () => {
  it('markdown extension 판정은 대소문자를 보존한 Rust plan 결과를 따른다', () => {
    expect(isGraphRagMarkdownFilePath('Notes/Paul.md')).toBe(true);
    expect(isGraphRagMarkdownFilePath('Notes/Romans.MD')).toBe(true);
    expect(isGraphRagMarkdownFilePath('Notes/archive.txt')).toBe(false);
    expect(filterGraphRagMarkdownFilePaths(['a.md', 'b.MD', 'c.canvas', 'd.md'])).toEqual([
      'a.md',
      'b.MD',
      'd.md',
    ]);
  });

  it('host predicate는 Rust markdown filtering 이후에만 적용한다', () => {
    const predicate = (filePath: string): boolean => !filePath.includes('/Archive/');

    expect(isProcessableGraphRagFilePath('Notes/Paul.md', predicate)).toBe(true);
    expect(isProcessableGraphRagFilePath('Notes/Archive/Paul.md', predicate)).toBe(false);
    expect(isProcessableGraphRagFilePath('Notes/Archive/Paul.txt', predicate)).toBe(false);
    expect(
      filterProcessableGraphRagFilePaths(
        ['Notes/Paul.md', 'Notes/Archive/Paul.md', 'Notes/Archive/Paul.txt'],
        predicate,
      ),
    ).toEqual(['Notes/Paul.md']);
  });
});
