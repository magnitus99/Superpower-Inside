import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { PdfSourceCache, PDF_EXTRACTOR_VERSION } from './pdf-source-cache';
import type { PdfSourceText } from './pdf-worker-runtime';

describe('PDF OCR 영속 캐시', () => {
  it('재시작 후 같은 revision만 재사용하고 파일 변경·추출기 변경은 다시 읽는다', async () => {
    const name = `pdf-cache-test-${crypto.randomUUID()}`;
    let cache = new PdfSourceCache(name);
    const source: PdfSourceText = {
      text: '합성 본문',
      segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }],
      completeness: {
        status: 'partial',
        pageCount: 2,
        missingPageCount: 1,
        missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }],
        failures: [],
      },
    };
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

it('현재 추출 계약은 v3와 다르며 손상된 completeness를 저장하지 않는다', async () => {
  expect(PDF_EXTRACTOR_VERSION).not.toBe('pdfjs-5.4.54-tesseract-7-kor-eng-v3');
  const cache = new PdfSourceCache(`pdf-invalid-${crypto.randomUUID()}`);
  try {
    const invalid = {
      text: 'Synthetic text',
      segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }],
      completeness: {
        status: 'complete',
        pageCount: 1,
        missingPageCount: 1,
        missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }],
        failures: [],
      },
    } as PdfSourceText;
    await expect(cache.put('synthetic.pdf', 1, 10, invalid)).rejects.toThrow('invalid');
    expect(await cache.get('synthetic.pdf', 1, 10)).toBeUndefined();
  } finally {
    await cache.delete();
  }
});

it('v3의 completeness 없는 행과 현재 버전 손상 행을 재사용하지 않는다', async () => {
  const name = `pdf-wire-${crypto.randomUUID()}`;
  const cache = new PdfSourceCache(name);
  const raw = new Dexie(name);
  raw.version(1).stores({ sources: 'path, usedAt' });
  try {
    const row = {
      path: 'synthetic.pdf',
      mtime: 1,
      size: 2,
      usedAt: 0,
      source: { text: 'Stored text', segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }] },
    };
    await raw.table('sources').put({ ...row, version: 'pdfjs-5.4.54-tesseract-7-kor-eng-v3' });
    expect(await cache.get(row.path, 1, 2)).toBeUndefined();
    await raw.table('sources').put({ ...row, version: PDF_EXTRACTOR_VERSION });
    expect(await cache.get(row.path, 1, 2)).toBeUndefined();
  } finally {
    raw.close();
    await cache.delete();
  }
});
