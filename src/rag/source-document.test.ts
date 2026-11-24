import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { buildSearchText, chunkSourceDocument, chunkSourceFile } from './source-document';
import * as rustCore from './rust-core';

const file = {
  path: 'synthetic.pdf',
  extension: 'pdf',
  basename: 'synthetic',
  stat: { mtime: 1, size: 20 },
} as TFile;
const config = { chunkSize: 1000, overlap: 20 };

describe('추출 문서 구간 청킹', () => {
  it('페이지 경계를 넘지 않고 절대 1base 좌표를 유지한다', () => {
    const chunks = chunkSourceDocument(file, 'First\n\nSecond\nTail', config, [
      { label: 'Page 1', startLine: 0, endLine: 0 },
      { label: 'Page 2', startLine: 2, endLine: 3 },
    ]);
    expect(
      chunks.map((chunk) => [
        chunk.text,
        chunk.metadata.heading,
        chunk.metadata.startLine,
        chunk.metadata.endLine,
      ]),
    ).toEqual([
      ['First', 'Page 1', 1, 1],
      ['Second\nTail', 'Page 2', 3, 4],
    ]);
    expect(buildSearchText(file, chunks[1])).toContain('Heading: Page 2');
    expect(chunks[1].text).not.toContain('Page 2');
  });
  it('구간이 없으면 기존 Markdown 구조·식별자와 동일하다', () => {
    const markdown = { ...file, path: 'synthetic.md', extension: 'md' };
    const text = '# Heading\n\n[[Link]] ![[Embed]]\n\n```ts\nconst a = 1;\n```';
    expect(chunkSourceDocument(markdown, text, config)).toEqual(
      chunkSourceFile(markdown, text, config),
    );
  });
  it('출처 라벨만 바뀌면 본문·hash·id는 바뀌지 않는다', () => {
    const chunks = (label: string) =>
      chunkSourceDocument(file, 'Stored text', config, [{ label, startLine: 0, endLine: 0 }]);
    const first = chunks('Page 1')[0];
    const second = chunks('Annotation 1')[0];
    expect(first.text).toBe(second.text);
    expect(first.id).toBe(second.id);
    expect(first.chunkHash).toBe(second.chunkHash);
    expect(first.metadata.heading).not.toBe(second.metadata.heading);
  });
  it('겹친 구간은 잘못 인용하지 않고 실패한다', () => {
    expect(() =>
      chunkSourceDocument(file, 'a\nb', config, [
        { label: 'a', startLine: 0, endLine: 1 },
        { label: 'b', startLine: 1, endLine: 1 },
      ]),
    ).toThrow('unavailable');
  });
  it('Rust 실패를 TS 주소 계산으로 대신하지 않는다', () => {
    const spy = vi.spyOn(rustCore, 'planSourceSegmentChunksRust').mockReturnValue(null);
    try {
      expect(() =>
        chunkSourceDocument(file, 'body', config, [{ label: 'Page 1', startLine: 0, endLine: 0 }]),
      ).toThrow('unavailable');
    } finally {
      spy.mockRestore();
    }
  });
});
