/**
 * PDF 원문에서 검색 가능한 본문을 결정적으로 추출하는 전용 worker 진입점입니다.
 *
 * pdf.js는 자체 worker 실행을 전제로 하지만 이 파일은 이미 worker이므로, 내장
 * `pdf.worker`를 fake worker(LoopbackPort)로 같은 스레드에서 실행하고 본문만 돌려줍니다.
 * 덕분에 `main.js`를 늘리지 않고 별도 자산으로 배포할 수 있습니다.
 */
import { getDocument, OPS } from 'pdfjs-dist';
import { createWorker, OEM, PSM, type Worker as OcrWorker } from 'tesseract.js';
import { PdfCanvasFactory, PdfCMapFactory, PdfFontFactory } from './pdf-render';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';

/** 한 번에 처리하는 최대 페이지 수입니다. */
const MAX_PAGES = 2000;
/** 추출 텍스트 최대 문자 수입니다. `source_extract.rs`와 같은 상한을 씁니다. */
const MAX_TEXT_CHARS = 8 * 1024 * 1024;

/** 호스트가 분기할 수 있는 안정적인 실패 코드입니다. */
type PdfFailure = 'corrupt' | 'empty' | 'encrypted' | 'too-large' | 'ocr-low-confidence';

interface PdfWorkerRequest {
  id: number;
  bytes: Uint8Array;
}

interface PdfWorkerSegment {
  label: string;
  startLine: number;
  endLine: number;
}

interface PdfWorkerResponse {
  id: number;
  ok: boolean;
  reason?: PdfFailure;
  text?: string;
  segments?: PdfWorkerSegment[];
  pageCount?: number;
}

// pdf.js는 이 전역이 있으면 내장 worker를 같은 스레드에서 실행합니다.
(globalThis as { pdfjsWorker?: typeof pdfjsWorker }).pdfjsWorker = pdfjsWorker;

let queue = Promise.resolve();
const assetRequests = new Map<number, { resolve(url: string): void; reject(error: Error): void }>();

self.onmessage = (
  event: MessageEvent<PdfWorkerRequest & { kind?: string; url?: string; error?: string }>,
): void => {
  const request = event.data;
  if (request.kind === 'ocr-assets') {
    const pending = assetRequests.get(request.id);
    assetRequests.delete(request.id);
    if (request.url) pending?.resolve(request.url);
    else pending?.reject(new Error(request.error ?? 'OCR assets are unavailable.'));
    return;
  }
  // 여러 소비자가 동시에 읽어도 PDF 렌더와 OCR은 한 파일씩 실행합니다.
  queue = queue.then(() => handleMessage(request));
};

async function handleMessage(request: PdfWorkerRequest): Promise<void> {
  const result = await extract(request.bytes, request.id).catch((error: unknown) => ({
    ok: false,
    reason: failureReason(error),
  }));
  self.postMessage({ id: request.id, ...result } satisfies PdfWorkerResponse);
}

/**
 * 페이지 경계를 구간 라벨로 남기며 본문을 이어 붙입니다.
 *
 * 줄 번호는 `source_extract.rs`의 `push_segment`와 같은 방식으로 셉니다. 그래야 같은
 * 원문이 어느 추출기를 통과해도 청킹과 출처 표시가 같은 위치를 가리킵니다.
 */
async function extract(bytes: Uint8Array, id: number): Promise<Omit<PdfWorkerResponse, 'id'>> {
  if (bytes.byteLength > 128 * 1024 * 1024) return { ok: false, reason: 'too-large' };
  let ocr: OcrWorker | undefined;
  const document = await getDocument({
    data: bytes,
    CanvasFactory: PdfCanvasFactory,
    CMapReaderFactory: PdfCMapFactory,
    StandardFontDataFactory: PdfFontFactory,
    useWorkerFetch: false,
    disableFontFace: true,
    useWasm: false,
    // 본문 추출에는 글꼴 평가가 필요 없고, 렌더러 CSP에서 안전해야 합니다.
    isEvalSupported: false,
    useSystemFonts: false,
    // pdf.js 내부 경고는 사용자 콘솔을 채우므로 오류만 남깁니다.
    verbosity: 0,
  }).promise;
  try {
    let text = '';
    const segments: PdfWorkerSegment[] = [];
    if (document.numPages > MAX_PAGES) return { ok: false, reason: 'too-large' };
    const pageCount = document.numPages;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      self.postMessage({ id, kind: 'progress', page: pageNumber, pageCount });
      const page = await document.getPage(pageNumber);
      let body = '';
      try {
        body = pageText((await page.getTextContent()).items);
        // 스캔 페이지에 페이지 번호·짧은 머리말만 텍스트로 남아 있는 경우도 읽습니다.
        const hasScannedBody =
          body.length > 0 &&
          body.length < 200 &&
          (await page.getOperatorList()).fnArray.some(
            (operation) =>
              operation === OPS.paintImageXObject ||
              operation === OPS.paintInlineImageXObject ||
              operation === OPS.paintImageXObjectRepeat,
          );
        if (body.length === 0 || hasScannedBody) {
          ocr ??= await createOcrWorker(id);
          const viewport = page.getViewport({ scale: 200 / 72 });
          // 거대한 페이지를 축소해 글자를 잃는 대신 명시적으로 실패시킵니다.
          if (viewport.width * viewport.height > 16_000_000)
            return { ok: false, reason: 'too-large' };
          const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('PDF canvas is unavailable.');
          try {
            // pdf.js 타입은 DOM 캔버스만 선언하지만 worker에서는 동일한 Canvas API를 씁니다.
            await page.render({
              canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: context as unknown as CanvasRenderingContext2D,
              viewport,
            }).promise;
            const image = new Uint8Array(
              await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
            );
            const { data } = await ocr.recognize(new Blob([image], { type: 'image/png' }));
            body = data.text.trim();
            if (body.length > 0 && (!Number.isFinite(data.confidence) || data.confidence < 50)) {
              return { ok: false, reason: 'ocr-low-confidence' };
            }
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      } finally {
        page.cleanup();
      }
      if (body.length === 0) continue;
      if (text.length + body.length + 2 > MAX_TEXT_CHARS) return { ok: false, reason: 'too-large' };
      if (text.length > 0) text += '\n\n';
      const startLine = Math.max(0, lineCount(text) - 1);
      text += body;
      segments.push({ label: `Page ${pageNumber}`, startLine, endLine: lineCount(text) - 1 });
    }
    if (segments.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, text, segments, pageCount: document.numPages };
  } finally {
    await ocr?.terminate();
    await document.destroy();
  }
}

/** pdf.js 텍스트 항목을 원문 줄바꿈 정보와 함께 이어 붙입니다. */
function pageText(items: readonly unknown[]): string {
  let text = '';
  for (const item of items) {
    if (!isTextItem(item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.trim();
}

function isTextItem(item: unknown): item is { str: string; hasEOL: boolean } {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as { str?: unknown; hasEOL?: unknown };
  return typeof candidate.str === 'string' && typeof candidate.hasEOL === 'boolean';
}

/** `source_extract.rs`의 `line_count`와 같은 규칙으로 줄 수를 셉니다. */
function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (const character of text) if (character === '\n') lines++;
  return lines;
}

function failureReason(error: unknown): PdfFailure {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : '';
  return name === 'PasswordException' ? 'encrypted' : 'corrupt';
}

/** OCR 자산은 필요한 페이지가 처음 나올 때만 호스트에서 읽습니다. */
async function createOcrWorker(id: number): Promise<OcrWorker> {
  const url = await new Promise<string>((resolve, reject) => {
    assetRequests.set(id, { resolve, reject });
    self.postMessage({ id, kind: 'ocr-assets' });
  });
  const worker = await createWorker('kor+eng', OEM.LSTM_ONLY, {
    workerPath: url,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: () => self.postMessage({ id, kind: 'heartbeat' }),
    errorHandler: (error: unknown) =>
      self.postMessage({ id, kind: 'ocr-error', reason: String(error) }),
  });
  // 스캔 페이지는 한 덩어리의 본문이므로 SINGLE_BLOCK이 안정적입니다. Chrome wasm의 AUTO
  // 레이아웃 분석은 한글만 있는 페이지에서 빈 결과를 내므로 AUTO 대신 이 모드를 씁니다.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  return worker;
}
