import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { chunkSourceDocument } from './source-document';
import { clearSourceTextCache, readSourceText } from './source-access';
import { planRagFileIndexabilityRust } from './rust-core';
import * as rustCore from './rust-core';
import { XlsxTestWorker, disposeXlsxTestWorkers } from '../test/xlsx-worker-fixture';
import { disposeXlsxWorker } from './xlsx-worker-runtime';

// PDF 본문은 전용 worker가 만들므로, 여기서는 라우팅만 확인하고 worker는 대체합니다.
vi.mock('./pdf-worker-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('./pdf-worker-runtime')>(),
  configurePdfWorkerAssets: () => undefined,
  extractPdfSourceText: (_vault: unknown, file: { path: string }) =>
    Promise.resolve({
      text: `pdf body for ${file.path}`,
      segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }],
      completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }], failures: [] },
    }),
}));

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
    readBinary: () =>
      Promise.resolve(binary ? binary.slice().buffer : new TextEncoder().encode(text).buffer),
  } as unknown as Vault;
}

const EPUB_ENTRIES = [
  [
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
  ],
  [
    'OEBPS/content.opf',
    '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  ],
  [
    'OEBPS/chapter.xhtml',
    '<html><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>Extracted body text.</p></body></html>',
  ],
] as const;

// 공개 예시나 테스트 볼트에 의존하지 않는 최소 형식별 문서입니다.
const DOCUMENT_CASES: readonly {
  extension: string;
  entries: readonly (readonly [string, string])[];
}[] = [
  { extension: 'epub', entries: EPUB_ENTRIES },
  {
    extension: 'docx',
    entries: [
      [
        'word/document.xml',
        '<w:document><w:p><w:r><w:t>합성 문서 Alpha</w:t></w:r></w:p></w:document>',
      ],
    ],
  },
  {
    extension: 'odt',
    entries: [
      ['content.xml', '<office:document><text:p>합성 문서 Alpha</text:p></office:document>'],
    ],
  },
  {
    extension: 'pptx',
    entries: [
      ['ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>합성 문서 Alpha</a:t></a:r></a:p></p:sld>'],
    ],
  },
  {
    extension: 'xlsx',
    entries: [
      [
        'xl/worksheets/sheet1.xml',
        '<worksheet><sheetData><row><c t="inlineStr"><is><t>합성 문서 Alpha</t></is></c><c><v>42</v></c></row></sheetData></worksheet>',
      ],
    ],
  },
  {
    extension: 'hwpx',
    entries: [
      [
        'Contents/section0.xml',
        '<hs:sec><hp:p><hp:run><hp:t>합성 문서 Alpha</hp:t></hp:run></hp:p></hs:sec>',
      ],
    ],
  },
];

describe('readSourceText', () => {
  it.each(['pdf', 'epub', 'docx', 'dotx', 'odt', 'odp', 'ods', 'pptx', 'potx', 'ppsx', 'xlsx', 'xltx', 'hwpx'])(
    '선언된 %s 확장자도 실제 평문은 엄격 바이트 디코더로 읽는다', async (extension) => {
      const text = '합성 Unicode 𐀀 문서\nplain evidence';
      const vault = createVault(new TextEncoder().encode(text), 'not a fallback');
      const read = vi.spyOn(vault, 'readBinary');
      expect(await readSourceText(vault, createFile(`plain.${extension}`))).toEqual({ text, segments: [] });
      expect(read).toHaveBeenCalledOnce();
    },
  );
  it.each([
    [[0xff, 0xfe, 72, 0, 105, 0], 'Hi'],
    [[0xfe, 0xff, 0, 72, 0, 105], 'Hi'],
    [[72, 0, 105, 0, 33, 0, 32, 0], 'Hi! '],
    [[0, 72, 0, 105, 0, 33, 0, 32], 'Hi! '],
    [[0xff, 0xfe, 0, 0, 72, 0, 0, 0], 'H'],
    [[0, 0, 0xfe, 0xff, 0, 0, 0, 72], 'H'],
    [
      [0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0xb6, 0xf3, 0xb8, 0xb6, 0xb9, 0xd9, 0xbb, 0xe7],
      '가나다라마바사',
    ],
    [
      [
        0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0xb6, 0xf3, 0xb8, 0xb6, 0xb9, 0xd9, 0xbb, 0xe7, 0x81,
        0x41,
      ],
      '가나다라마바사갂',
    ],
    [
      [
        0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd, 0x82, 0xc5, 0x82,
        0xb7, 0x81, 0x42,
      ],
      '日本語の文章です。',
    ],
    [
      [
        0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xce, 0xc4, 0xb1, 0xbe, 0x90, 0x30, 0x81,
        0x30,
      ],
      '中文测试文本𐀀',
    ],
    [
      [
        99, 97, 102, 0xe9, 32, 100, 0xe9, 106, 0xe0, 32, 118, 117, 32, 0x96, 32, 114, 0xe9, 115,
        117, 109, 0xe9,
      ],
      'café déjà vu – résumé',
    ],
  ] satisfies [number[], string][])(
    '실제 독립 바이트를 Rust에서 무손실 디코딩한다: %j',
    async (octets, expected) => {
      const vault = createVault(new Uint8Array(octets), 'cached replacement must not be used');
      const cachedRead = vi.spyOn(vault, 'cachedRead');
      expect(await readSourceText(vault, createFile('synthetic/unknown.opaque'))).toEqual({
        text: expected,
        segments: [],
      });
      expect(cachedRead).not.toHaveBeenCalled();
    },
  );

  it.each(['pdf', 'docx', 'xlsx'])(
    '%s도 Unicode·legacy·ASCII 서명과 실제 손상을 내용으로 구분한다', async (extension) => {
      for (const [bytes, text] of [
        [new Uint8Array([0xff, 0xfe, 72, 0, 105, 0]), 'Hi'],
        [new Uint8Array([27, 36, 66, 70, 124, 75, 92, 56, 108, 27, 40, 66]), '日本語'],
        [new TextEncoder().encode('%PDF-documentation is plain text'), '%PDF-documentation is plain text'],
      ] as const) {
        expect((await readSourceText(createVault(bytes), createFile(`content.${extension}`))).text).toBe(text);
      }
      for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xff, 0xfe, 0, 0xd8])]) {
        await expect(readSourceText(createVault(bytes, 'no fallback'), createFile(`damaged.${extension}`))).rejects.toThrow('Source byte decoding failed');
      }
    },
  );

  it('forceRefresh는 cachedRead 사본이 아니라 현재 바이트를 읽고 빈 파일도 성공으로 구분한다', async () => {
    const vault = createVault(new TextEncoder().encode('current body'), 'stale body');
    const file = createFile('synthetic/current.txt');
    expect((await readSourceText(vault, file, { forceRefresh: true })).text).toBe('current body');
    expect(
      await readSourceText(createVault(new Uint8Array()), createFile('empty.opaque', 1, 0)),
    ).toEqual({ text: '', segments: [] });
    vi.spyOn(vault, 'readBinary').mockRejectedValueOnce(new Error('read failed'));
    await expect(readSourceText(vault, file)).rejects.toThrow('read failed');
  });

  it.each(['txt', 'plist', 'opaque'])(
    '%s 바이너리 위장·손실 디코딩을 cachedRead로 덮지 않는다',
    async (extension) => {
      for (const bytes of [
        new TextEncoder().encode('PK\u0003\u0004fake'),
        new Uint8Array([0xc3, 0x28]),
        new Uint8Array([0xef, 0xbb, 0xbf, 0x6c, 0x6f, 0x73, 0x73, 0x20, 0xe2, 0x82]),
      ]) {
        await expect(
          readSourceText(createVault(bytes, 'pretend success'), createFile(`fake.${extension}`)),
        ).rejects.toThrow('Source byte decoding failed');
      }
    },
  );

  it('원문에 실제 저장된 U+FFFD는 디코딩 손실로 오인하지 않고 보존한다', async () => {
    const text = 'literal \uFFFD remains';
    const vault = createVault(new TextEncoder().encode(text), 'stale copy');
    const cachedRead = vi.spyOn(vault, 'cachedRead');
    expect(await readSourceText(vault, createFile('literal.txt'))).toEqual({ text, segments: [] });
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('WASM 형식 판정 실패 때 전용 문서를 평문으로 읽지 않는다', async () => {
    const policy = vi.spyOn(rustCore, 'isExtractableSourceExtensionRust').mockReturnValue(null);
    const vault = createVault(new TextEncoder().encode('not document'), 'pretend success');
    const cachedRead = vi.spyOn(vault, 'cachedRead');
    const readBinary = vi.spyOn(vault, 'readBinary');
    try {
      await expect(readSourceText(vault, createFile('broken.docx'))).rejects.toThrow(
        'policy is unavailable',
      );
      expect(cachedRead).not.toHaveBeenCalled();
      expect(readBinary).not.toHaveBeenCalled();
    } finally {
      policy.mockRestore();
    }
  });

  it('공유 읽기 소유자만 취소해도 남은 소비자는 성공한다', async () => {
    const bytes = buildStoredZip([
      ['word/document.xml', '<w:document><w:p><w:t>surviving consumer</w:t></w:p></w:document>'],
    ]);
    const vault = createVault(bytes);
    const file = createFile('shared-owner.docx');
    let finish!: (bytes: ArrayBuffer) => void;
    const binary = vi.spyOn(vault, 'readBinary').mockReturnValueOnce(
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
    );
    const owner = new AbortController();
    const first = readSourceText(vault, file, { signal: owner.signal });
    const failure = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = readSourceText(vault, file);
    owner.abort();
    await failure;
    finish(bytes.slice().buffer);
    expect((await second).text).toBe('surviving consumer');
    expect((await readSourceText(vault, file)).text).toBe('surviving consumer');
    expect(binary).toHaveBeenCalledOnce();
  });

  it('forceRefresh 이후 이전 소유자의 늦은 결과는 공유 캐시를 덮어쓰지 않는다', async () => {
    const oldBytes = buildStoredZip([
      ['word/document.xml', '<w:document><w:p><w:t>old body</w:t></w:p></w:document>'],
    ]);
    const newBytes = buildStoredZip([
      ['word/document.xml', '<w:document><w:p><w:t>new body</w:t></w:p></w:document>'],
    ]);
    const vault = createVault(newBytes);
    const file = createFile('stale-owner.docx');
    let finish!: (bytes: ArrayBuffer) => void;
    const binary = vi.spyOn(vault, 'readBinary').mockReturnValueOnce(
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = readSourceText(vault, file);
    expect((await readSourceText(vault, file, { forceRefresh: true })).text).toBe('new body');
    finish(oldBytes.slice().buffer);
    expect((await pending).text).toBe('old body');
    expect((await readSourceText(vault, file)).text).toBe('new body');
    expect(binary).toHaveBeenCalledTimes(2);
  });

  it('공유 추출 소비자가 모두 취소되면 pending을 해제하고 새 요청을 독립 실행한다', async () => {
    const bytes = buildStoredZip([
      [
        'word/document.xml',
        '<w:document><w:p><w:r><w:t>합성 공유 본문</w:t></w:r></w:p></w:document>',
      ],
    ]);
    const vault = createVault(bytes);
    const file = createFile('synthetic/shared-cancel.docx');
    const owner = new AbortController();
    const consumer = new AbortController();
    let resolveRead!: (bytes: ArrayBuffer) => void;
    const readBinary = vi.spyOn(vault, 'readBinary').mockReturnValueOnce(
      new Promise<ArrayBuffer>((resolve) => {
        resolveRead = resolve;
      }),
    );
    let ownerOutcome: unknown;
    let consumerOutcome: unknown;
    const ownerRead = readSourceText(vault, file, { signal: owner.signal });
    const consumerRead = readSourceText(vault, file, { signal: consumer.signal });
    const observed = Promise.all([
      ownerRead.catch((error: unknown) => {
        ownerOutcome = error;
      }),
      consumerRead.catch((error: unknown) => {
        consumerOutcome = error;
      }),
    ]);
    try {
      await vi.waitFor(() => expect(readBinary).toHaveBeenCalledOnce());
      consumer.abort();
      await vi.waitFor(() => expect(consumerOutcome).toMatchObject({ name: 'AbortError' }));
      expect(ownerOutcome).toBeUndefined();
      owner.abort();
      await vi.waitFor(() => expect(ownerOutcome).toMatchObject({ name: 'AbortError' }));
      let freshText: string | undefined;
      const freshRead = readSourceText(vault, file).then((source) => {
        freshText = source.text;
      });
      // 작업자 실패도 즉시 관찰하되 아래 성공 본문 assertion은 그대로 실패시킵니다.
      const freshSettled = freshRead.then(() => undefined, () => undefined);
      try {
        await vi.waitFor(() => expect(freshText).toContain('합성 공유 본문'));
        expect(readBinary).toHaveBeenCalledTimes(2);
      } finally {
        resolveRead(bytes.slice().buffer);
        await freshSettled;
      }
    } finally {
      resolveRead(bytes.slice().buffer);
      await observed;
    }
    expect((await readSourceText(vault, file)).text).toContain('합성 공유 본문');
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)(
    'Markdown 읽기를 즉시 취소하고 늦은 %s 응답이 새 읽기에 영향을 주지 않는다',
    async (settlement) => {
      const file = createFile('synthetic/cancel.md');
      const vault = createVault(null, 'fresh content');
      const controller = new AbortController();
      let resolveRead!: (bytes: ArrayBuffer) => void;
      let rejectRead!: (error: Error) => void;
      const pendingRead = new Promise<ArrayBuffer>((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      });
      const settledRead = pendingRead.then(() => undefined, () => undefined);
      const readBinary = vi.spyOn(vault, 'readBinary').mockReturnValueOnce(pendingRead);
      let outcome: unknown;
      const read = readSourceText(vault, file, { signal: controller.signal });
      const observed = read.catch((error: unknown) => {
        outcome = error;
      });
      try {
        await vi.waitFor(() => expect(readBinary).toHaveBeenCalledOnce());
        controller.abort();
        await vi.waitFor(() => expect(outcome).toMatchObject({ name: 'AbortError' }));
        await expect(
          readSourceText(vault, file, { signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(readBinary).toHaveBeenCalledOnce();
        await expect(
          readSourceText(vault, file, { signal: new AbortController().signal }),
        ).resolves.toEqual({ text: 'fresh content', segments: [] });
      } finally {
        if (settlement === 'resolve') resolveRead(new TextEncoder().encode('stale content').buffer);
        else rejectRead(new Error('late read failure'));
        await settledRead;
        await observed;
      }
      await expect(read).rejects.toMatchObject({ name: 'AbortError' });
      await expect(readSourceText(vault, file)).resolves.toEqual({
        text: 'fresh content',
        segments: [],
      });
    },
  );

  beforeEach(() => {
    clearSourceTextCache();
    vi.stubGlobal('Worker', XlsxTestWorker);
  });

  afterEach(async () => {
    disposeXlsxWorker();
    await disposeXlsxTestWorkers();
    vi.unstubAllGlobals();
  });

  it.each(DOCUMENT_CASES)(
    '$extension의 후보 판정·바이트 읽기·추출·청킹·구간 라벨을 연결한다',
    async ({ extension, entries }) => {
      const bytes = buildStoredZip(entries);
      const file = createFile(`synthetic/source.${extension.toUpperCase()}`, 1, bytes.length);
      const vault = createVault(bytes, '사용하면 안 되는 압축 원문');
      const readBinary = vi.spyOn(vault, 'readBinary');
      const cachedRead = vi.spyOn(vault, 'cachedRead');
      expect(
        planRagFileIndexabilityRust(
          [
            {
              filePath: file.path,
              fileName: file.name,
              extension: file.extension,
              size: bytes.length,
            },
          ],
          [],
          [],
          [],
        )?.candidateIndices,
      ).toEqual([0]);
      const source = await readSourceText(vault, file);
      expect(source.text.trim().length).toBeGreaterThan(0);
      expect(source.segments.length).toBeGreaterThan(0);
      const chunks = chunkSourceDocument(
        file,
        source.text,
        { chunkSize: 200, overlap: 20 },
        source.segments,
      );
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.metadata.heading).toBe(source.segments[0]?.label);
      expect(chunks.every((chunk) => chunk.metadata.filePath === file.path)).toBe(true);
      expect(readBinary).toHaveBeenCalledOnce();
      expect(cachedRead).not.toHaveBeenCalled();
      expect(await readSourceText(vault, file)).toEqual(source);
      expect(readBinary).toHaveBeenCalledOnce();
    },
  );

  it.each(['md', 'txt', 'csv', 'json', 'ts', 'js', 'rs', 'html', 'xml', 'yaml'])(
    '%s 원문은 텍스트 읽기와 청킹을 연결한다',
    async (extension) => {
      const body = '합성 문서 Alpha\nSecond line 42';
      const file = createFile(
        `synthetic/source.${extension}`,
        1,
        new TextEncoder().encode(body).length,
      );
      const vault = createVault(null, body);
      const readBinary = vi.spyOn(vault, 'readBinary');
      expect(
        planRagFileIndexabilityRust(
          [{ filePath: file.path, fileName: file.name, extension, size: file.stat.size }],
          [],
          [],
          [],
        )?.candidateIndices,
      ).toEqual([0]);
      const source = await readSourceText(vault, file);
      expect(source).toEqual({ text: body, segments: [] });
      expect(
        chunkSourceDocument(file, body, { chunkSize: 200, overlap: 0 }).length,
      ).toBeGreaterThan(0);
      expect(readBinary).toHaveBeenCalledOnce();
    },
  );

  it('여러 슬라이드의 본문과 출처 줄이 WASM을 통과한 뒤에도 일치한다', async () => {
    const bodies = ['합성 첫 줄\nSynthetic line', '日本語 😀', 'Third section'];
    const entries = bodies.map((body, index): readonly [string, string] => [
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld>${body
        .split('\n')
        .map((line) => `<a:p><a:t>${line}</a:t></a:p>`)
        .join('')}</p:sld>`,
    ]);
    const source = await readSourceText(
      createVault(buildStoredZip(entries)),
      createFile('synthetic/slides.pptx'),
    );
    const lines = source.text.split('\n');
    expect(source.segments).toHaveLength(bodies.length);
    source.segments.forEach((segment, index) => {
      expect(lines.slice(segment.startLine, segment.endLine + 1).join('\n')).toBe(bodies[index]);
    });
  });

  it.each(DOCUMENT_CASES)(
    '$extension의 손상된 컨테이너는 텍스트 읽기로 대체하지 않는다',
    async ({ extension }) => {
      const vault = createVault(new TextEncoder().encode('PK\u0003\u0004broken-archive'), '대체 본문');
      const cachedRead = vi.spyOn(vault, 'cachedRead');
      await expect(
        readSourceText(vault, createFile(`synthetic/broken.${extension}`)),
      ).rejects.toThrow('corrupt');
      expect(cachedRead).not.toHaveBeenCalled();
    },
  );

  it('약 5MiB XLSX는 후보에 포함되고 본문 외 항목의 크기 때문에 거부되지 않는다', async () => {
    const entries = DOCUMENT_CASES.find((entry) => entry.extension === 'xlsx')?.entries ?? [];
    const bytes = buildStoredZip([
      ...entries,
      ['xl/media/padding.bin', 'x'.repeat(5 * 1024 * 1024)],
    ]);
    const file = createFile('synthetic/large.xlsx', 1, bytes.length);
    expect(
      planRagFileIndexabilityRust(
        [{ filePath: file.path, fileName: file.name, extension: 'xlsx', size: bytes.length }],
        [],
        [],
        [],
      )?.candidateIndices,
    ).toEqual([0]);
    expect((await readSourceText(createVault(bytes), file)).text).toContain('42');
  });

  it('큰 XLSX 본문은 최근 읽기 캐시에 남기지 않는다', async () => {
    const row = `<row><c t="inlineStr"><is><t>${'a'.repeat(1024)}</t></is></c></row>`;
    const bytes = buildStoredZip([
      ['xl/worksheets/sheet1.xml', `<worksheet>${row.repeat(8193)}</worksheet>`],
    ]);
    const source = createVault(bytes);
    const readBinary = vi.spyOn(source, 'readBinary');
    const file = createFile('synthetic/large.xlsx', 1, bytes.length);
    const first = await readSourceText(source, file);
    const second = await readSourceText(source, file);
    expect(first.text.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(second.text).toBe(first.text);
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it.each(['pdf', 'epub', 'docx', 'dotx', 'odt', 'odp', 'ods', 'pptx', 'potx', 'ppsx', 'xlsx', 'xltx', 'hwpx'])(
    '%s 파일 크기 128MiB 경계와 빈 파일을 구분한다',
    (extension) => {
      const sizes = [0, 5 * 1024 * 1024, 128 * 1024 * 1024, 128 * 1024 * 1024 + 1];
      const files = sizes.map((size, index) => ({
        filePath: `synthetic/${index}.${extension}`,
        fileName: `${index}.${extension}`,
        extension,
        size,
      }));
      const plan = planRagFileIndexabilityRust(files, [], [], []);
      expect(plan?.candidateIndices).toEqual([1, 2]);
      expect(plan?.summaryInputs[0]?.recommendationReason).toBe('empty');
      expect(plan?.summaryInputs[3]?.recommendationReason).toBe('too-large');
      expect(plan?.emptyIndices).toEqual([0]);
      expect(plan?.failures).toEqual([{ index: 3, reason: 'memory-budget' }]);
    },
  );

  it('DOTX·POTX·PPSX·XLTX·ODP·ODS 및 UTF-16 BOM 평문 텍스트도 추출·복원한다', async () => {
    const dotx = buildStoredZip([
      [
        'word/document.xml',
        '<w:document><w:body><w:p><w:r><w:t>Word Template</w:t></w:r></w:p></w:body></w:document>',
      ],
    ]);
    expect((await readSourceText(createVault(dotx), createFile('synthetic/doc.dotx'))).text).toBe(
      'Word Template',
    );

    const potx = buildStoredZip([
      ['ppt/slides/slide1.xml', '<p:sld><a:p><a:t>Slide Template</a:t></a:p></p:sld>'],
    ]);
    expect((await readSourceText(createVault(potx), createFile('synthetic/deck.potx'))).text).toBe(
      'Slide Template',
    );
    expect((await readSourceText(createVault(potx), createFile('synthetic/show.ppsx'))).text).toBe(
      'Slide Template',
    );

    const xltx = buildStoredZip([
      [
        'xl/worksheets/sheet1.xml',
        '<worksheet><row><c t="inlineStr"><is><t>Sheet Template</t></is></c></row></worksheet>',
      ],
    ]);
    expect(
      (await readSourceText(createVault(xltx), createFile('synthetic/sheet.xltx'))).text,
    ).toContain('Sheet Template');

    const odp = buildStoredZip([
      [
        'content.xml',
        '<office:document-content><office:body><office:presentation><draw:page><draw:frame><draw:text-box><text:p>ODP Slide</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>',
      ],
    ]);
    expect((await readSourceText(createVault(odp), createFile('synthetic/deck.odp'))).text).toBe(
      'ODP Slide',
    );

    const ods = buildStoredZip([
      [
        'content.xml',
        '<office:document-content><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell><text:p>ODS Cell</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
      ],
    ]);
    expect((await readSourceText(createVault(ods), createFile('synthetic/table.ods'))).text).toBe(
      'ODS Cell',
    );

    const utf16leBytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    const utf16Vault = createVault(utf16leBytes, '\uFFFD\0H\0i\0');
    expect((await readSourceText(utf16Vault, createFile('notes/utf16.txt'))).text).toBe('Hi');
  });

  it.each([
    { bytes: [27, 36, 66, 70, 124, 75, 92, 56, 108, 27, 40, 66], text: '日本語' },
    { bytes: [194, 169, 32, 99, 97, 102, 233, 32, 100, 233, 106, 224, 32, 118, 117, 32, 150, 32, 114, 233, 115, 117, 109, 233], text: 'Â© café déjà vu – résumé' },
  ])('명시 ESC와 UTF-8 유효 접두사가 있는 legacy도 전체 strict 복원한다: $text', async ({ bytes, text }) => {
    expect((await readSourceText(createVault(new Uint8Array(bytes)), createFile('legacy.txt'))).text).toBe(text);
  });

  it('반복 비ASCII 판별 실패는 본문 성공으로 바뀌지 않는다', async () => {
    await expect(readSourceText(createVault(new Uint8Array([255, 255, 255, 255, 255, 255, 10])), createFile('ambiguous.bin'))).rejects.toThrow('ambiguous-encoding');
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

  it('forceRefresh는 추출 캐시를 우회해 최신 원문을 읽는다', async () => {
    let bytes = buildStoredZip(EPUB_ENTRIES);
    const readBinary = vi.fn(() => Promise.resolve(bytes.slice().buffer));
    const source = {
      cachedRead: vi.fn(),
      readBinary,
    } as unknown as Vault;
    const file = createFile('books/refresh.epub', 1, bytes.length);
    const first = await readSourceText(source, file);
    expect(first.text).toContain('Extracted body text.');

    bytes = buildStoredZip(
      EPUB_ENTRIES.map(([path, content]) =>
        path === 'OEBPS/chapter.xhtml'
          ? [path, content.replace('Extracted body text.', 'Fresh body text.')]
          : [path, content],
      ),
    );
    const cached = await readSourceText(source, file);
    expect(cached.text).toBe(first.text);
    const refreshed = await readSourceText(source, file, { forceRefresh: true });
    expect(refreshed.text).toContain('Fresh body text.');
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it('추출 본문의 구간 라벨을 청크 heading으로 승격한다', async () => {
    const file = createFile('books/sample.epub');
    const source = await readSourceText(createVault(buildStoredZip(EPUB_ENTRIES)), file);
    const chunks = chunkSourceDocument(
      file,
      source.text,
      { chunkSize: 200, overlap: 0 },
      source.segments,
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.metadata.heading).toBe('Chapter One');
  });

  it('PDF는 캐시 본문이 아니라 전용 worker 본문을 쓴다', async () => {
    const file = createFile('docs/report.PDF');
    const bytes = new TextEncoder().encode('%PDF-1.7\nsynthetic binary route\n%%EOF');
    const vault = createVault(bytes, 'cached read must not be used');
    const read = vi.spyOn(vault, 'readBinary');
    const extract = vi.spyOn(await import('./pdf-worker-runtime'), 'extractPdfSourceText');
    const source = await readSourceText(vault, file);
    expect(read).toHaveBeenCalledOnce();
    expect(extract.mock.calls.at(-1)?.[3]).toEqual(bytes);
    expect(source.text).toBe('pdf body for docs/report.PDF');
    expect(source.segments.map((segment) => segment.label)).toEqual(['Page 1']);
    expect(source.completeness).toEqual({ status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }], failures: [] });
    const again = await readSourceText(vault, file);
    expect(again).toBe(source);
    expect(again.completeness).toEqual(source.completeness);
  });

  it('손상된 컨테이너는 파일 단위 오류로 알린다', async () => {
    const file = createFile('books/broken.epub');
    await expect(
      readSourceText(createVault(new TextEncoder().encode('PK\u0003\u0004broken-archive')), file),
    ).rejects.toThrow('corrupt');
  });
});
