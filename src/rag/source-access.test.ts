import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { chunkSourceDocument } from './source-document';
import { clearSourceTextCache, readSourceText } from './source-access';

/** 저장 방식(무압축) zip 항목을 만들기 위한 최소 헬퍼입니다. */
const CRC_TABLE = createCrcTable();

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const entry = CRC_TABLE[(crc ^ byte) & 0xff];
    crc = entry === undefined ? crc : (crc >>> 8) ^ entry;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 무압축 항목만 담은 zip 컨테이너를 만듭니다. */
function buildStoredZip(entries: readonly (readonly [string, string])[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const checksum = crc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...locals, ...centrals, eocd]) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function createFile(path: string, mtime = 1, size = 100): TFile {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.includes('.') ? (name.split('.').pop() ?? '') : '',
    stat: { ctime: mtime, mtime, size },
  } as unknown as TFile;
}

function createVault(binary: Uint8Array | null, text = ''): Vault {
  return {
    cachedRead: () => Promise.resolve(text),
    readBinary: () => Promise.resolve(binary ? binary.slice().buffer : new ArrayBuffer(0)),
  } as unknown as Vault;
}

const EPUB_ENTRIES = [
  ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'],
  [
    'OEBPS/content.opf',
    '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  ],
  [
    'OEBPS/chapter.xhtml',
    '<html><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>Extracted body text.</p></body></html>',
  ],
] as const;

describe('readSourceText', () => {
  beforeEach(() => {
    clearSourceTextCache();
  });

  it('일반 텍스트 파일은 원문을 그대로 돌려준다', async () => {
    const file = createFile('notes/plain.md');
    const source = await readSourceText(createVault(null, 'plain body'), file);
    expect(source.text).toBe('plain body');
    expect(source.segments).toHaveLength(0);
  });

  it('EPUB 컨테이너에서 본문과 구간을 추출한다', async () => {
    const file = createFile('books/sample.epub');
    const source = await readSourceText(createVault(buildStoredZip(EPUB_ENTRIES)), file);
    expect(source.text).toContain('Extracted body text.');
    expect(source.segments.map((segment) => segment.label)).toEqual(['Chapter One']);
  });

  it('추출 본문의 구간 라벨을 청크 heading으로 승격한다', async () => {
    const file = createFile('books/sample.epub');
    const source = await readSourceText(createVault(buildStoredZip(EPUB_ENTRIES)), file);
    const chunks = chunkSourceDocument(file, source.text, { chunkSize: 200, overlap: 0 }, source.segments);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.metadata.heading).toBe('Chapter One');
  });

  it('손상된 컨테이너는 파일 단위 오류로 알린다', async () => {
    const file = createFile('books/broken.epub');
    await expect(
      readSourceText(createVault(new TextEncoder().encode('not-a-zip')), file),
    ).rejects.toThrow(/broken\.epub/u);
  });
});
