import { readFileSync } from 'node:fs';
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

const WORKER_SOURCE = readFileSync(new URL('../../pdf-worker.js', import.meta.url), 'utf8');
const OCR_SOURCE = readFileSync(new URL('../../pdf-ocr-worker.js', import.meta.url), 'utf8');
const assetBytes = (source: string): ArrayBuffer => new TextEncoder().encode(source).buffer;

afterEach(() => {
  disposePdfWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  downloadAsset.mockReset();
});

describe('PDF worker bundle', () => {
  it('합성 PDF의 페이지별 본문과 구간 경계를 추출한다', async () => {
    const worker = createNodeWorker();
    try {
      const bytes = new Uint8Array(Buffer.from(SAMPLE_PDF_BASE64, 'base64'));
      await expect(request(worker, bytes)).resolves.toEqual({
        id: 1,
        ok: true,
        pageCount: 2,
        // 저신뢰로 건너뛴 스캔 페이지가 없으면 0입니다.
        lowConfidencePages: 0,
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
    worker.deliver?.({ id, ok: true, text: 'extracted body', segments: [] });
    await expect(result).resolves.toEqual({ text: 'extracted body', segments: [] });
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
      text: 'body',
      segments: [],
    });
    await expect(success).resolves.toEqual({ text: 'body', segments: [] });

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
  readonly posted: Array<{ id: number }> = [];
  terminated = false;

  constructor(_url: string) {}

  postMessage(message: unknown): void {
    this.posted.push(message as { id: number });
    this.deliver = (data) => this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function createNodeWorker(): NodeWorker {
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    // pdf.js의 캔버스 계층은 로드 시 DOMMatrix를 요구하지만 본문 추출에는 쓰지 않습니다.
    globalThis.DOMMatrix = class { translate(){return this} scale(){return this} invertSelf(){return this} multiplySelf(){return this} preMultiplySelf(){return this} };
    globalThis.self = { postMessage(message) { parentPort.postMessage(message); } };
    ${WORKER_SOURCE}
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
