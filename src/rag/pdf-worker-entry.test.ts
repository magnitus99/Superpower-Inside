import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  getDocument: vi.fn(),
  createWorker: vi.fn(),
}));
vi.mock('pdfjs-dist', () => ({ getDocument: fixture.getDocument, OPS: { paintImageXObject: 1 } }));
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({}));
vi.mock('tesseract.js', () => ({
  createWorker: fixture.createWorker,
  OEM: { LSTM_ONLY: 1 },
  PSM: { SINGLE_BLOCK: 6 },
}));
vi.mock('./pdf-render', () => ({
  PdfCanvasFactory: class {},
  PdfCMapFactory: class {},
  PdfFontFactory: class {},
}));

const canvases: Array<{ width: number; height: number; pixels: number }> = [];
beforeEach(() => {
  vi.resetModules();
  canvases.length = 0;
  fixture.getDocument.mockReset();
  fixture.createWorker.mockReset();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      pixels: number;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.pixels = width * height;
        canvases.push(this);
      }
      getContext() {
        return {};
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

/** 텍스트 계층과 그리기 연산만 지정하는 합성 페이지입니다. */
function createPage(options: {
  text: string;
  size: readonly [number, number];
  painted?: boolean;
}) {
  const [width, height] = options.size;
  return {
    getTextContent: vi.fn().mockResolvedValue({
      items: options.text ? [{ str: options.text, hasEOL: true }] : [],
    }),
    getOperatorList: vi.fn().mockResolvedValue({ fnArray: options.painted ? [1] : [] }),
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: vi.fn((_options: { viewport: { width: number; height: number } }) => ({
      promise: Promise.resolve(),
    })),
    cleanup: vi.fn(),
  };
}
type PageMock = ReturnType<typeof createPage>;

/** worker 전역과 OCR 자산 왕복을 흉내 내고 최종 응답 한 건을 돌려줍니다. */
async function runExtraction(pages: PageMock[], confidence: number) {
  const document = {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1])),
    destroy: vi.fn(),
  };
  fixture.getDocument.mockReturnValue({ promise: Promise.resolve(document) });
  const ocr = {
    recognize: vi.fn().mockResolvedValue({ data: { text: 'Synthetic image caption', confidence } }),
    setParameters: vi.fn(),
    terminate: vi.fn(),
  };
  fixture.createWorker.mockResolvedValue(ocr);
  let finish: (result: Record<string, unknown>) => void = () => {};
  const result = new Promise<Record<string, unknown>>((resolve) => {
    finish = resolve;
  });
  const scope = {
    onmessage: (_event: MessageEvent) => {},
    postMessage: (message: Record<string, unknown>) => {
      if (message.kind === 'ocr-assets') {
        queueMicrotask(() =>
          scope.onmessage({
            data: { id: 1, kind: 'ocr-assets', url: 'blob:ocr' },
          } as MessageEvent),
        );
      } else if (!message.kind) finish(message);
    },
  };
  vi.stubGlobal('self', scope);
  await import('./pdf-worker-entry');
  scope.onmessage({ data: { id: 1, bytes: new Uint8Array() } } as MessageEvent);
  return { response: await result, document, ocr };
}

it.each([
  { width: 3200, height: 1800, confidence: 90, ok: true },
  { width: 10000, height: 100, confidence: 90, ok: true },
  { width: 500, height: 6000, confidence: 20, ok: true },
])(
  '판형 $width×$height의 메모리 예산과 OCR 신뢰도 $confidence를 지킨다',
  async ({ width, height, confidence, ok }) => {
    const page = createPage({
      text: 'Synthetic link https://example.org/reference',
      size: [width, height],
      painted: true,
    });
    const { response, document, ocr } = await runExtraction([page], confidence);
    expect(response.ok).toBe(ok);
    expect(response.text).toContain('https://example.org/reference');
    if (confidence >= 50) expect(response.text).toContain('Synthetic image caption');
    else {
      expect(response.text).not.toContain('Synthetic image caption');
      expect(response.lowConfidencePages).toBe(1);
    }
    expect(canvases[0]?.pixels).toBeLessThanOrEqual(16_000_000);
    const rendered = page.render.mock.calls[0]?.[0];
    expect(rendered?.viewport.width).toBeLessThanOrEqual(8192);
    expect(rendered?.viewport.height).toBeLessThanOrEqual(8192);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
    expect(ocr.terminate).toHaveBeenCalledOnce();
  },
);

it('신뢰도가 낮은 스캔 페이지 하나가 문서 전체 추출을 막지 않는다', async () => {
  const digital = createPage({ text: 'Synthetic digital body '.repeat(12), size: [612, 792] });
  const scan = createPage({ text: '', size: [612, 792], painted: true });
  const { response } = await runExtraction([digital, scan], 20);
  expect(response.ok).toBe(true);
  expect(response.text).toContain('Synthetic digital body');
  expect(response.text).not.toContain('Synthetic image caption');
  expect(response.segments).toHaveLength(1);
  expect(response.lowConfidencePages).toBe(1);
});

it('저신뢰 스캔뿐인 문서는 ocr-low-confidence로 실패한다', async () => {
  const scan = createPage({ text: '', size: [612, 792], painted: true });
  const { response } = await runExtraction([scan], 20);
  expect(response.ok).toBe(false);
  expect(response.reason).toBe('ocr-low-confidence');
});
