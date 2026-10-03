import { describe, expect, it } from 'vitest';
import {
  filterGraphRagSourceFilePaths,
  filterProcessableGraphRagFilePaths,
  isGraphRagSourceFilePath,
  isProcessableGraphRagFilePath,
} from './file-paths';

describe('GraphRAG file path policy', () => {
  it('지원 본문 경로는 확장자에 상관없이 그래프에 연결한다', () => {
    expect(isGraphRagSourceFilePath('Notes/Paul.md')).toBe(true);
    expect(isGraphRagSourceFilePath('Notes/Romans.MD')).toBe(true);
    expect(isGraphRagSourceFilePath('Notes/archive.txt')).toBe(true);
    expect(filterGraphRagSourceFilePaths(['a.md', 'b.MD', 'c.canvas', 'd.md'])).toEqual([
      'a.md',
      'b.MD',
      'c.canvas',
      'd.md',
    ]);
  });

  it('공통 파일 정책이 제외한 경로는 그래프에서도 제외한다', () => {
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
