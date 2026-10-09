import type { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { toggleDocumentExclusion } from './document-exclusion';

describe('문서 제외 토글', () => {
  it.each([
    [undefined, false],
    [false, false],
    [true, true],
    ['true', true],
    ['false', false],
    [0, true],
    [1, true],
    ['트루', true],
    ['', true],
    [null, true],
  ])(
    '값 %s의 현재 제외 상태 %s를 반전하고 해제할 때 속성을 삭제한다',
    async (value, initiallyExcluded) => {
      const frontmatter: Record<string, unknown> = {
        title: '원래 제목',
        tags: ['원래 태그'],
        'superpower-inside-exclude': value,
      };
      const processFrontMatter = vi.fn(
        (_file: TFile, update: (value: Record<string, unknown>) => void) => {
          update(frontmatter);
          return Promise.resolve();
        },
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;
      const file = { path: 'result1.md', extension: 'md' } as TFile;
      await expect(toggleDocumentExclusion(app, file)).resolves.toBe(!initiallyExcluded);
      if (initiallyExcluded) {
        expect(frontmatter).not.toHaveProperty('superpower-inside-exclude');
      } else {
        expect(frontmatter['superpower-inside-exclude']).toBe(true);
      }
      await expect(toggleDocumentExclusion(app, file)).resolves.toBe(Boolean(initiallyExcluded));
      if (initiallyExcluded) {
        expect(frontmatter['superpower-inside-exclude']).toBe(true);
      } else {
        expect(frontmatter).not.toHaveProperty('superpower-inside-exclude');
      }
      expect(frontmatter.title).toBe('원래 제목');
      expect(frontmatter.tags).toEqual(['원래 태그']);
    },
  );

  it('쓰기 실패를 성공으로 표시하지 않는다', async () => {
    const app = {
      fileManager: { processFrontMatter: () => Promise.reject(new Error('write failed')) },
    } as unknown as App;
    await expect(toggleDocumentExclusion(app, { extension: 'md' } as TFile)).rejects.toThrow(
      'write failed',
    );
  });

  it('YAML 편집을 지원하지 않는 파일은 호스트의 조용한 무동작 전에 거부한다', async () => {
    const processFrontMatter = vi.fn();
    const app = { fileManager: { processFrontMatter } } as unknown as App;
    await expect(toggleDocumentExclusion(app, { extension: 'txt' } as TFile)).rejects.toThrow();
    expect(processFrontMatter).not.toHaveBeenCalled();
  });
});
