import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import {
  configurePdfWorkerAssets,
  disposePdfWorker,
  extractPdfSourceText,
} from './pdf-worker-runtime';

const { downloadAsset } = vi.hoisted(() => ({ downloadAsset: vi.fn() }));
vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path,
  requestUrl: downloadAsset,
}));

/** 2페이지 합성 PDF입니다. 실제 볼트 문서가 아니라 추출 계약 검증용 바이트입니다. */
const SAMPLE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUg' +
  'L1BhZ2VzIC9LaWRzIFszIDAgUiA1IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu' +
  'dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29u' +
  'dGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcwMCBU' +
  'ZCAoRmlyc3QgcGFnZSBib2R5IHRleHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFy' +
  'ZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDcgMCBSID4+ID4+IC9D' +
  'b250ZW50cyA2IDAgUiA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDUyID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgNzIgNzAw' +
  'IFRkIChTZWNvbmQgcGFnZSBib2R5IHRleHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PCAvVHlwZSAvRm9udCAv' +
  'U3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgPj4KZW5kb2JqCnhy' +
  'ZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAx' +
  'MjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzQ4IDAwMDAwIG4gCjAwMDAwMDA0NzQgMDAwMDAgbiAKMDAw' +
  'MDAwMDU3NiAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDggL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjY3MwolJUVPRgo=';

const WORKER_SOURCE = readFileSync(
  new URL('../../.local/plugin/pdf-worker.js', import.meta.url),
  'utf8',
);
const OCR_SOURCE = readFileSync(
  new URL('../../.local/plugin/pdf-ocr-worker.js', import.meta.url),
  'utf8',
);
const assetBytes = (source: string): ArrayBuffer => new TextEncoder().encode(source).buffer;

afterEach(() => {
  disposePdfWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  downloadAsset.mockReset();
});

describe('PDF worker bundle', () => {
  it('probe가 반환한 입력을 재읽기 없이 이동하고 다른 파일 취소를 격리한다', async () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor(url: string) { super(url); workers.push(this); }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:isolated');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    configurePdfWorkerAssets('isolated');
    const vault = createVault(new ArrayBuffer(2));
    const read = vi.spyOn(vault, 'readBinary');
    const controller = new AbortController();
    const firstBytes = new Uint8Array([1, 2]);
    const secondBytes = new Uint8Array([3, 4]);
    const first = extractPdfSourceText(vault, { path: 'first.pdf', stat: { size: 2 } } as TFile, { signal: controller.signal }, firstBytes);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = extractPdfSourceText(vault, { path: 'second.pdf', stat: { size: 2 } } as TFile, {}, secondBytes);
    await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(2));
    const worker = workers[0];
    expect((worker.posted[0] as { bytes?: Uint8Array }).bytes).toBe(firstBytes);
    expect((worker.posted[1] as { bytes?: Uint8Array }).bytes).toBe(secondBytes);
    expect(read).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(false);
    worker.deliver?.({ id: worker.posted[0].id, kind: 'ocr-assets' });
    expect(worker.posted[2]).toMatchObject({ id: worker.posted[0].id, kind: 'ocr-assets', error: 'PDF extraction aborted.' });
    worker.deliver?.({ id: worker.posted[0].id, ok: true, ...completeSource('ignored late result') });
    worker.deliver?.({ id: worker.posted[1].id, ok: true, ...completeSource('surviving body') });
    await expect(second).resolves.toEqual(completeSource('surviving body'));
  });
  it('OCR 자산을 읽는 도중 취소해도 handshake를 한 번 해제하고 다른 PDF를 진행한다', async () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor(url: string) { super(url); workers.push(this); }
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ocr-cancel');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    configurePdfWorkerAssets('ocr-cancel');
    const vault = createVault(new ArrayBuffer(2));
    const originalRead = vault.adapter.readBinary.bind(vault.adapter);
    let releaseAssets!: (bytes: ArrayBuffer) => void;
    const assets = new Promise<ArrayBuffer>((resolve) => { releaseAssets = resolve; });
    const assetRead = vi.spyOn(vault.adapter, 'readBinary').mockImplementation((path) => path.endsWith('/pdf-ocr-worker.js') ? assets : originalRead(path));
    const controller = new AbortController();
    const first = extractPdfSourceText(vault, { path: 'first.pdf', stat: { size: 2 } } as TFile, { signal: controller.signal }, new Uint8Array([1, 2]));
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = extractPdfSourceText(vault, { path: 'second.pdf', stat: { size: 2 } } as TFile, {}, new Uint8Array([3, 4]));
    const secondOutcome = second.then((value) => ({ ok: true, value }), () => ({ ok: false }));
    try {
      await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(2));
      const worker = workers[0];
      const id = worker.posted[0].id;
      worker.deliver?.({ id, kind: 'ocr-assets' });
      await vi.waitFor(() => expect(assetRead.mock.calls.some(([path]) => path.endsWith('/pdf-ocr-worker.js'))).toBe(true));
      controller.abort();
      await rejected;
      expect(worker.terminated).toBe(false);
      expect(worker.posted.filter((message) => message.id === id && message.kind === 'ocr-assets')).toEqual([{ id, kind: 'ocr-assets', error: 'PDF extraction aborted.' }]);
      worker.deliver?.({ id, ok: true, ...completeSource('ignored late result') });
      worker.deliver?.({ id: worker.posted[1].id, ok: true, ...completeSource('surviving body') });
      await expect(secondOutcome).resolves.toEqual({ ok: true, value: completeSource('surviving body') });
      releaseAssets(assetBytes(OCR_SOURCE));
      await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
      expect(worker.posted.filter((message) => message.id === id && message.kind === 'ocr-assets')).toHaveLength(1);
    } finally { releaseAssets(assetBytes(OCR_SOURCE)); }
  });

  it('합성 PDF의 페이지별 본문과 구간 경계를 추출한다', async () => {
    const worker = await createNodeWorker();
    try {
      const bytes = new Uint8Array(Buffer.from(SAMPLE_PDF_BASE64, 'base64'));
      await expect(request(worker, bytes)).resolves.toEqual({
        id: 1,
        ok: true,
        pageCount: 2,
        // 저신뢰로 건너뛴 스캔 페이지가 없으면 0입니다.
        lowConfidencePages: 0,
        completeness: {
          status: 'complete',
          pageCount: 2,
          missingPageCount: 0,
          missingPages: [],
          failures: [],
        },
        text: 'First page body text\n\nSecond page body text',
        segments: [
          { label: 'Page 1', startLine: 0, endLine: 0 },
          { label: 'Page 2', startLine: 2, endLine: 2 },
        ],
      });

      await expect(request(worker, new TextEncoder().encode('not-a-pdf'), 2)).resolves.toEqual({
        id: 2,
        ok: false,
        reason: 'corrupt',
      });
    } finally {
      await worker.terminate();
    }
  });
});

describe('PDF worker client', () => {
  it('기본 설치에 PDF 자산이 없어도 자동 확보 후 같은 읽기를 계속하며 OCR은 필요할 때만 확보한다', async () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: string) {
          super(url);
          workers.push(this);
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:automatic');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    configurePdfWorkerAssets('automatic');
    const vault = createVault(new ArrayBuffer(2));
    const files = new Map<string, ArrayBuffer>();
    vault.adapter.exists = vi.fn((path: string) => Promise.resolve(files.has(path)));
    vault.adapter.readBinary = vi.fn((path: string) => {
      const bytes = files.get(path);
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('ENOENT'));
    });
    vault.adapter.writeBinary = vi.fn((path: string, bytes: ArrayBuffer) => {
      files.set(path, bytes);
      return Promise.resolve();
    });
    vault.adapter.remove = vi.fn((path: string) => {
      files.delete(path);
      return Promise.resolve();
    });
    vault.adapter.rename = vi.fn((from: string, to: string) => {
      const bytes = files.get(from);
      if (!bytes) return Promise.reject(new Error('ENOENT'));
      files.set(to, bytes);
      files.delete(from);
      return Promise.resolve();
    });
    downloadAsset.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve({
        status: 200,
        arrayBuffer: assetBytes(url.endsWith('/pdf-worker.js') ? WORKER_SOURCE : OCR_SOURCE),
      }),
    );
    const result = extractPdfSourceText(vault, {
      path: 'synthetic.pdf',
      stat: { size: 2 },
    } as TFile);
    await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
    expect(downloadAsset).toHaveBeenCalledTimes(1);
    expect(files.has('.obsidian/plugins/automatic/pdf-worker.js')).toBe(true);
    const worker = workers[0];
    const id = worker.posted[0].id;
    worker.deliver?.({ id, kind: 'ocr-assets' });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    expect(downloadAsset).toHaveBeenCalledTimes(2);
    expect(files.has('.obsidian/plugins/automatic/pdf-ocr-worker.js')).toBe(true);
    expect([...files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false);
    worker.deliver?.({ id, ok: true, ...completeSource('extracted body') });
    await expect(result).resolves.toEqual(completeSource('extracted body'));
  });
  it('OCR 자산을 필요할 때만 읽고 진행 응답을 결과로 오인하지 않으며 취소 시 자원을 해제한다', async () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: string) {
          super(url);
          workers.push(this);
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    configurePdfWorkerAssets('test-ocr');
    const vault = createVault(new ArrayBuffer(2));
    const readAsset = vi.spyOn(vault.adapter, 'readBinary');
    const progress = vi.fn();
    const controller = new AbortController();
    const file = { path: 'synthetic.pdf', stat: { size: 2 } } as TFile;
    const result = extractPdfSourceText(vault, file, {
      signal: controller.signal,
      onProgress: progress,
    });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
    const worker = workers[0];
    const id = worker.posted[0].id;
    expect(readAsset).toHaveBeenCalledTimes(1);
    worker.deliver?.({ id, kind: 'progress', page: 2, pageCount: 8 });
    expect(progress).toHaveBeenCalledWith(2, 8);
    worker.deliver?.({ id, kind: 'ocr-assets' });
    await vi.waitFor(() => expect(readAsset).toHaveBeenCalledTimes(2));
    expect(readAsset.mock.calls[1]?.[0]).toContain('pdf-ocr-worker.js');
    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(revoke).toHaveBeenCalled();
  });
  it('worker 응답을 본문으로 돌려주고 실패 사유를 파일 오류로 알린다', async () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: string) {
          super(url);
          workers.push(this);
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    configurePdfWorkerAssets('superpower-inside');

    const file = {
      path: 'docs/report.pdf',
      extension: 'pdf',
      stat: { mtime: 1, size: 2 },
    } as TFile;
    const vault = createVault(new ArrayBuffer(2));

    const success = extractPdfSourceText(vault, file);
    await vi.waitFor(() => expect(last(workers)?.posted).toHaveLength(1));
    last(workers)?.deliver?.({
      id: last(workers)?.posted[0].id,
      ok: true,
      ...completeSource('body'),
    });
    await expect(success).resolves.toEqual(completeSource('body'));

    const failed = extractPdfSourceText(vault, file);
    await vi.waitFor(() => expect(last(workers)?.posted).toHaveLength(2));
    last(workers)?.deliver?.({ id: last(workers)?.posted[1].id, ok: false, reason: 'empty' });
    await expect(failed).rejects.toThrow(/report\.pdf \(empty\)/u);
  });
});

function last(workers: readonly FakeWorker[]): FakeWorker | undefined {
  return workers.at(-1);
}

function createVault(bytes: ArrayBuffer): Vault {
  return {
    configDir: '.obsidian',
    readBinary: () => Promise.resolve(bytes.slice(0)),
    adapter: {
      exists: () => Promise.resolve(true),
      readBinary: (path: string) =>
        Promise.resolve(
          assetBytes(path.endsWith('/pdf-ocr-worker.js') ? OCR_SOURCE : WORKER_SOURCE),
        ),
    },
  } as unknown as Vault;
}

/** 클라이언트만 검증하므로 worker는 요청을 모아 두고 테스트가 직접 응답합니다. */
class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  deliver: ((data: unknown) => void) | null = null;
  readonly posted: Array<{ id: number; kind?: string; error?: string }> = [];
  terminated = false;
  failPost = false;

  constructor(_url: string) {}

  postMessage(message: unknown): void {
    if (this.failPost) throw new Error('Synthetic post failure');
    this.posted.push(message as { id: number });
    this.deliver = (data) => this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function createNodeWorker(): Promise<NodeWorker> {
  const renderAssets: Record<string, string> = {};
  for (const directory of ['cmaps', 'standard_fonts']) {
    const base = new URL(`../../node_modules/pdfjs-dist/${directory}/`, import.meta.url);
    for (const file of readdirSync(base)) {
      if (/\.(bcmap|pfb|ttf)$/.test(file))
        renderAssets[`${directory}/${file}`] = readFileSync(new URL(file, base)).toString('base64');
    }
  }
  const bundle = await build({
    entryPoints: ['src/rag/pdf-worker-entry.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    logLevel: 'silent',
    define: { process: 'undefined', 'globalThis.process': 'undefined' },
    plugins: [
      {
        name: 'pdf-host-test-assets',
        setup(builder) {
          builder.onResolve({ filter: /^pdf-render-assets$/ }, () => ({
            path: 'assets',
            namespace: 'pdf-test',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'pdf-test' }, () => ({
            contents: `export const renderAssets = ${JSON.stringify(renderAssets)};`,
          }));
        },
      },
    ],
  });
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    // pdf.js의 캔버스 계층은 로드 시 DOMMatrix를 요구하지만 본문 추출에는 쓰지 않습니다.
    globalThis.DOMMatrix = class { translate(){return this} scale(){return this} invertSelf(){return this} multiplySelf(){return this} preMultiplySelf(){return this} };
    globalThis.self = { postMessage(message) {
      if (globalThis.pdfActionExecuted) throw new Error('Saved PDF action was executed.');
      parentPort.postMessage(message);
    } };
    globalThis.fetch = () => { throw new Error('Network is forbidden in PDF host tests.'); };
    ${bundle.outputFiles[0].text}
    parentPort.on('message', (data) => { globalThis.self.onmessage({ data }); });
  `;
  return new NodeWorker(bootstrap, { eval: true });
}

function request(worker: NodeWorker, bytes: Uint8Array, id = 1): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: Record<string, unknown>): void => {
      if (response.id !== id || response.kind) return;
      worker.off('message', onMessage);
      resolve(response);
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
    worker.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  });
}

function completeSource(text: string) {
  return {
    text,
    segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }],
    completeness: {
      status: 'complete',
      pageCount: 1,
      missingPageCount: 0,
      missingPages: [],
      failures: [],
    },
  };
}

/** 각 문자열은 본문과 독립된 저장 PDF 객체에만 존재합니다. */
function savedPartsPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [8 0 R 10 0 R] >> /Metadata 11 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R 7 0 R 8 0 R 9 0 R 13 0 R 14 0 R] >>',
    stream('BT /F1 12 Tf 72 700 Td (Digital synthetic body) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /T (Stored reviewer) /Contents (Annotation exclusive fact) /RC (<body xmlns="http://www.w3.org/1999/xhtml"><p>Rich exclusive fact</p></body>) /Popup 7 0 R >>',
    '<< /Type /Annot /Subtype /Popup /Rect [10 10 30 30] /Parent 6 0 R >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Saved field) /V (Form exclusive fact) /Rect [10 40 90 70] /P 3 0 R /AA << /K << /S /JavaScript /JS (globalThis.pdfActionExecuted = true;) >> >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [10 80 90 100] /A << /S /URI /URI (https://example.invalid/no-network) >> >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /Rect [0 0 10 10] /T (Detached field) /V (Detached exclusive fact) >>',
    stream(
      '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">XMP exclusive fact</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
      '/Type /Metadata /Subtype /XML',
    ),
    '<< /Title (Metadata exclusive fact) /Author (Synthetic author) /CustomFact (Custom exclusive fact) >>',
    '<< /Type /Annot /Subtype /Text /Rect [20 20 40 40] /Contents (Popup exclusive fact) /Popup 14 0 R >>',
    '<< /Type /Annot /Subtype /Popup /Rect [20 20 40 40] /Parent 13 0 R >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 12 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}
function stream(text: string, attributes = ''): string {
  return `<< /Length ${Buffer.byteLength(text)} ${attributes} >>\nstream\n${text}\nendstream`;
}

it('설치 pdf.js로 합성 저장 주석·팝업·양식·Info/XMP를 추출한다', async () => {
  const worker = await createNodeWorker();
  try {
    const result = await request(worker, savedPartsPdf());
    expect(result.ok).toBe(true);
    for (const fact of [
      'Annotation exclusive fact',
      'Rich exclusive fact',
      'Popup exclusive fact',
      'Form exclusive fact',
      'Detached exclusive fact',
      'Metadata exclusive fact',
      'Custom exclusive fact',
      'XMP exclusive fact',
    ]) {
      expect(result.text).toContain(fact);
    }
    expect(result.text).not.toContain('pdfActionExecuted');
    expect(result.completeness).toEqual({
      status: 'complete',
      pageCount: 1,
      missingPageCount: 0,
      missingPages: [],
      failures: [],
    });
  } finally {
    await worker.terminate();
  }
});

function clientFixture() {
  const workers: FakeWorker[] = [];
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor(url: string) {
        super(url);
        workers.push(this);
      }
    },
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:client');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  configurePdfWorkerAssets('client');
  const vault = createVault(new ArrayBuffer(2));
  const file = { path: 'synthetic.pdf', stat: { size: 2 } } as TFile;
  return { workers, vault, file };
}

it.each([
  {},
  { ok: true, text: 'body', segments: [] },
  {
    ok: true,
    ...completeSource('body'),
    completeness: {
      status: 'complete',
      pageCount: 1,
      missingPageCount: 1,
      missingPages: [{ pageNumber: 1, reason: 'ocr-empty' }],
      failures: [],
    },
  },
  {
    ok: true,
    ...completeSource('body'),
    segments: [{ label: 'Page 1', startLine: -1, endLine: 0 }],
  },
  {
    ok: true,
    ...completeSource('body'),
    segments: [{ label: 'Page 1', startLine: 0, endLine: 4 }],
  },
  { kind: 'progress', page: 3, pageCount: 2 },
  { kind: 'unknown' },
  { ok: true, ...completeSource('body'), pageCount: 2 },
  { ok: true, ...completeSource('body'), lowConfidencePages: -1 },
  { ok: false, reason: 'invented-reason' },
])('손상 wire를 성공이나 빈 본문으로 바꾸지 않는다: %#', async (payload) => {
  const { workers, vault, file } = clientFixture();
  const result = extractPdfSourceText(vault, file);
  const rejected = expect(result).rejects.toThrow('invalid');
  await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
  workers[0].deliver?.({ id: workers[0].posted[0].id, ...payload });
  await rejected;
  expect(workers[0].terminated).toBe(true);
});

it('부분 추출의 본문·누락 주소를 그대로 반환하고 전체 실패도 구조화한다', async () => {
  const { workers, vault, file } = clientFixture();
  const completeness = {
    status: 'partial',
    pageCount: 2,
    missingPageCount: 1,
    missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }],
    failures: [],
  };
  const result = extractPdfSourceText(vault, file);
  await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
  workers[0].deliver?.({
    id: workers[0].posted[0].id,
    ok: true,
    ...completeSource('body'),
    completeness,
  });
  await expect(result).resolves.toEqual({ ...completeSource('body'), completeness });
  const failed = extractPdfSourceText(vault, file);
  const rejected = expect(failed).rejects.toMatchObject({
    name: 'PdfSourceExtractionError',
    completeness,
  });
  await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(2));
  workers[0].deliver?.({
    id: workers[0].posted[1].id,
    ok: false,
    reason: 'ocr-empty',
    completeness,
  });
  await rejected;
});

it('heartbeat는 timeout을 연장하지만 무응답은 작업자와 자산을 정리한다', async () => {
  const { workers, vault, file } = clientFixture();
  const result = extractPdfSourceText(vault, file);
  const rejected = expect(result).rejects.toThrow('timeout');
  await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
  vi.useFakeTimers();
  const id = workers[0].posted[0].id;
  workers[0].deliver?.({ id, kind: 'heartbeat' });
  await vi.advanceTimersByTimeAsync(119_000);
  expect(workers[0].terminated).toBe(false);
  workers[0].deliver?.({ id, kind: 'heartbeat' });
  await vi.advanceTimersByTimeAsync(120_001);
  await rejected;
  expect(workers[0].terminated).toBe(true);
});

it('OCR 자산 응답 postMessage 실패를 미처리 rejection으로 남기지 않는다', async () => {
  const { workers, vault, file } = clientFixture();
  const result = extractPdfSourceText(vault, file);
  const rejected = expect(result).rejects.toThrow('asset message failed');
  await vi.waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
  const id = workers[0].posted[0].id;
  workers[0].failPost = true;
  workers[0].deliver?.({ id, kind: 'ocr-assets' });
  await rejected;
  expect(workers[0].terminated).toBe(true);
});

it('초기 PDF 요청 postMessage 실패도 pending과 worker를 정리한다', async () => {
  const { workers, vault, file } = clientFixture();
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor(url: string) {
        super(url);
        this.failPost = true;
        workers.push(this);
      }
    },
  );
  await expect(extractPdfSourceText(vault, file)).rejects.toThrow('Synthetic post failure');
  expect(workers[0].terminated).toBe(true);
});
