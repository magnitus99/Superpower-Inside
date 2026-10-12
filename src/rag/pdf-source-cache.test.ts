import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PdfSourceCache } from './pdf-source-cache';

describe('PDF OCR 영속 캐시', () => {
  it('재시작 후 같은 revision만 재사용하고 파일 변경·추출기 변경은 다시 읽는다', async () => {
    const name = `pdf-cache-test-${crypto.randomUUID()}`;
    let cache = new PdfSourceCache(name);
    const source = { text: '합성 본문', segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }] };
    try {
      await cache.put('sample.pdf', 1, 100, source);
      cache.close();
      cache = new PdfSourceCache(name);
      expect(await cache.get('sample.pdf', 1, 100)).toEqual(source);
      expect(await cache.get('sample.pdf', 2, 100)).toBeUndefined();
      expect(await cache.get('sample.pdf', 1, 101)).toBeUndefined();
      expect(await cache.get('sample.pdf', 1, 100, 'other-version')).toBeUndefined();
    } finally {
      await cache.delete();
    }
  });
});
