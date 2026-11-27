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
  PdfBinaryDataFactory: class {},
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
function createPage(options: { text: string; size: readonly [number, number]; painted?: boolean }) {
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
    getAnnotations: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  };
}
type PageMock = ReturnType<typeof createPage>;

/** worker 전역과 OCR 자산 왕복을 흉내 내고 최종 응답 한 건을 돌려줍니다. */
async function runExtraction(
  pages: PageMock[],
  confidence: number,
  ocrText = 'Synthetic image caption',
  failures: {
    metadata?: boolean;
    fields?: boolean;
    terminate?: boolean;
    parameters?: boolean;
  } = {},
) {
  const document = {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1])),
    destroy: vi.fn(),
    getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
    getFieldObjects: vi.fn().mockResolvedValue(null),
  };
  if (failures.metadata)
    document.getMetadata.mockRejectedValue(new Error('Synthetic metadata failure'));
  if (failures.fields)
    document.getFieldObjects.mockRejectedValue(new Error('Synthetic fields failure'));
  fixture.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: document.destroy });
  const ocr = {
    recognize: vi.fn().mockResolvedValue({ data: { text: ocrText, confidence } }),
    setParameters: vi.fn(),
    terminate: vi.fn(),
  };
  if (failures.terminate)
    ocr.terminate.mockRejectedValue(new Error('Synthetic termination failure'));
  if (failures.parameters)
    ocr.setParameters.mockRejectedValue(new Error('Synthetic parameter failure'));
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

it('저장된 주석·팝업·양식 값만 읽고 action과 외부 주소는 실행하지 않는다', async () => {
  const page = createPage({ text: 'Digital body', size: [612, 792] });
  page.getAnnotations.mockResolvedValue([
    {
      id: 'note',
      contentsObj: { str: 'Saved comment' },
      titleObj: { str: 'Saved author' },
      richText: { str: 'Rich comment' },
    },
    { id: 'popup', contentsObj: { str: 'Saved popup' } },
    {
      id: 'field',
      fieldName: 'Saved name',
      fieldValue: ['Stored value', 'Other value'],
      alternativeText: 'Field description',
      actions: { K: ['throw new Error("must not run")'] },
    },
    {
      id: 'link',
      url: 'https://example.invalid/no-fetch',
      actions: { A: ['must not index action'] },
    },
  ]);
  const { response } = await runExtraction([page], 90);
  expect(response.text).toContain('Saved comment');
  expect(response.text).toContain('Saved popup');
  expect(response.text).toContain('Stored value');
  expect(response.text).toContain('Rich comment');
  expect(response.text).not.toContain('must not index action');
  expect(response.text).not.toContain('throw new Error');
});

it('빈 OCR은 나머지 유효 본문과 별개인 누락 페이지로 보존한다', async () => {
  const digital = createPage({ text: 'Valid body', size: [612, 792] });
  const scan = createPage({ text: '', size: [612, 792], painted: true });
  const { response } = await runExtraction([digital, scan], 90, '');
  expect(response.ok).toBe(true);
  expect(response.completeness).toEqual({
    status: 'partial',
    pageCount: 2,
    missingPageCount: 1,
    missingPages: [{ pageNumber: 2, reason: 'ocr-empty' }],
    failures: [],
  });
  expect(response.segments).toEqual([{ label: 'Page 1', startLine: 0, endLine: 0 }]);
});

it('페이지·주석·문서 부가텍스트 실패를 유효 본문과 분리하고 모든 페이지를 정리한다', async () => {
  const valid = createPage({ text: 'Retained digital body', size: [612, 792] });
  valid.getAnnotations.mockRejectedValue(new Error('Synthetic annotations failure'));
  const broken = createPage({ text: '', size: [612, 792] });
  broken.getTextContent.mockRejectedValue(new Error('Synthetic page failure'));
  const { response, document } = await runExtraction([valid, broken], 90, '', {
    metadata: true,
    fields: true,
  });
  expect(response.ok).toBe(true);
  expect(response.text).toBe('Retained digital body');
  expect(response.completeness).toEqual({
    status: 'partial',
    pageCount: 2,
    missingPageCount: 1,
    missingPages: [{ pageNumber: 2, reason: 'page-error' }],
    failures: [
      { part: 'annotations', pageNumber: 1, reason: 'extract-error' },
      { part: 'fields', reason: 'extract-error' },
      { part: 'metadata', reason: 'extract-error' },
    ],
  });
  expect(valid.cleanup).toHaveBeenCalledOnce();
  expect(broken.cleanup).toHaveBeenCalledOnce();
  expect(document.destroy).toHaveBeenCalledOnce();
});

it('OCR 초기화 실패에서도 OCR·문서를 정리하고 유효 페이지를 남긴다', async () => {
  const valid = createPage({ text: 'Valid text', size: [612, 792] });
  const scan = createPage({ text: '', size: [612, 792] });
  const { response, document, ocr } = await runExtraction([valid, scan], 90, '', {
    parameters: true,
  });
  expect(response.ok).toBe(true);
  expect(response.text).toBe('Valid text');
  expect(response.completeness).toMatchObject({
    missingPages: [{ pageNumber: 2, reason: 'page-error' }],
  });
  expect(ocr.terminate).toHaveBeenCalledOnce();
  expect(scan.cleanup).toHaveBeenCalledOnce();
  expect(document.destroy).toHaveBeenCalledOnce();
});

it('OCR 종료 실패가 문서 destroy를 건너뛰지 않는다', async () => {
  const scan = createPage({ text: '', size: [612, 792] });
  const { response, document } = await runExtraction([scan], 90, 'Valid OCR', { terminate: true });
  expect(response.ok).toBe(false);
  expect(document.destroy).toHaveBeenCalledOnce();
});

it('저신뢰 OCR의 누락 주소는 실패 응답에도 남는다', async () => {
  const scan = createPage({ text: '', size: [612, 792] });
  const { response } = await runExtraction([scan], 20);
  expect(response).toMatchObject({
    ok: false,
    reason: 'ocr-low-confidence',
    completeness: {
      status: 'partial',
      pageCount: 1,
      missingPageCount: 1,
      missingPages: [{ pageNumber: 1, reason: 'ocr-low-confidence' }],
      failures: [],
    },
  });
  expect(response.segments).toBeUndefined();
});

it('암호 문서 로딩 실패에서도 loading task를 정리하고 해제를 시도하지 않는다', async () => {
  const destroy = vi.fn();
  fixture.getDocument.mockImplementation(() => ({
    promise: Promise.reject(
      Object.assign(new Error('Synthetic password'), { name: 'PasswordException' }),
    ),
    destroy,
  }));
  const responses: unknown[] = [];
  const scope = {
    onmessage: (_event: MessageEvent) => {},
    postMessage: (message: unknown) => {
      responses.push(message);
    },
  };
  vi.stubGlobal('self', scope);
  await import('./pdf-worker-entry');
  scope.onmessage({ data: { id: 1, bytes: new Uint8Array() } } as MessageEvent);
  await vi.waitFor(() => expect(responses).toEqual([{ id: 1, ok: false, reason: 'encrypted' }]));
  expect(destroy).toHaveBeenCalledOnce();
  expect(fixture.createWorker).not.toHaveBeenCalled();
});

it('최종 postMessage 실패가 다음 PDF의 직렬 큐를 깨뜨리지 않는다', async () => {
  const page = createPage({ text: 'Retained body', size: [612, 792] });
  const document = {
    numPages: 1,
    getPage: vi.fn().mockResolvedValue(page),
    getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
    getFieldObjects: vi.fn().mockResolvedValue(null),
    destroy: vi.fn(),
  };
  fixture.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: document.destroy });
  const responses: Record<string, unknown>[] = [];
  const scope = {
    onmessage: (_event: MessageEvent) => {},
    postMessage: (message: Record<string, unknown>) => {
      if (message.id === 1 && !message.kind) throw new Error('Synthetic post failure');
      responses.push(message);
    },
  };
  vi.stubGlobal('self', scope);
  await import('./pdf-worker-entry');
  scope.onmessage({ data: { id: 1, bytes: new Uint8Array() } } as MessageEvent);
  scope.onmessage({ data: { id: 2, bytes: new Uint8Array() } } as MessageEvent);
  await vi.waitFor(() =>
    expect(responses.some((response) => response.id === 2 && response.ok === true)).toBe(true),
  );
  expect(document.destroy).toHaveBeenCalledTimes(2);
});
