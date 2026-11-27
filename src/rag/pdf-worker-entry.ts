/**
 * PDF 원문에서 검색 가능한 본문을 결정적으로 추출하는 전용 worker 진입점입니다.
 *
 * pdf.js는 자체 worker 실행을 전제로 하지만 이 파일은 이미 worker이므로, 내장
 * `pdf.worker`를 fake worker(LoopbackPort)로 같은 스레드에서 실행하고 본문만 돌려줍니다.
 * 덕분에 `main.js`를 늘리지 않고 별도 자산으로 배포할 수 있습니다.
 */
import { getDocument, OPS } from 'pdfjs-dist';
import { createWorker, OEM, PSM, type Worker as OcrWorker } from 'tesseract.js';
import { PdfCanvasFactory, PdfBinaryDataFactory } from './pdf-render';
import { recognizePdfPage } from './pdf-page-ocr';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import type { PdfCompleteness } from './pdf-worker-runtime';

/** 한 번에 처리하는 최대 페이지 수입니다. */
const MAX_PAGES = 2000;
/** 추출 텍스트 최대 문자 수입니다. `source_extract.rs`와 같은 상한을 씁니다. */
const MAX_TEXT_CHARS = 8 * 1024 * 1024;

/** 호스트가 분기할 수 있는 안정적인 실패 코드입니다. */
type PdfFailure =
  | 'corrupt'
  | 'empty'
  | 'encrypted'
  | 'too-large'
  | 'ocr-low-confidence'
  | 'ocr-empty';

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
  /** 신뢰도 게이트로 본문에서 제외한 스캔 페이지 수입니다. */
  lowConfidencePages?: number;
  completeness?: PdfCompleteness;
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
  queue = queue.then(() => handleMessage(request)).catch(() => undefined);
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
  const loading = getDocument({
    data: bytes,
    CanvasFactory: PdfCanvasFactory,
    BinaryDataFactory: PdfBinaryDataFactory,
    disableWorkerRendering: true,
    useWorkerFetch: false,
    disableFontFace: true,
    useWasm: false,
    useSystemFonts: false,
    // pdf.js 내부 경고는 사용자 콘솔을 채우므로 오류만 남깁니다.
    verbosity: 0,
  });
  let document: Awaited<typeof loading.promise>;
  try {
    document = await loading.promise;
  } catch (error) {
    await loading.destroy();
    throw error;
  }
  try {
    let text = '';
    let nextLine = 0;
    let lowConfidencePages = 0;
    const completeness: PdfCompleteness = {
      status: 'complete',
      pageCount: document.numPages,
      missingPageCount: 0,
      missingPages: [],
      failures: [],
    };
    const segments: PdfWorkerSegment[] = [];
    const fieldIds = new Set<string>();
    const append = (body: string, label: string): void => {
      if (!body.trim()) return;
      if (text.length + body.length + 2 > MAX_TEXT_CHARS)
        throw new RangeError('PDF text is too-large.');
      if (text.length > 0) text += '\n\n';
      const startLine = nextLine;
      text += body;
      const endLine = startLine + lineCount(body) - 1;
      segments.push({ label, startLine, endLine });
      nextLine = endLine + 2;
    };
    if (document.numPages > MAX_PAGES) return { ok: false, reason: 'too-large' };
    const pageCount = document.numPages;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      self.postMessage({ id, kind: 'progress', page: pageNumber, pageCount });
      let page: Awaited<ReturnType<typeof document.getPage>> | undefined;
      let body = '';
      let missingReason: PdfCompleteness['missingPages'][number]['reason'] | undefined;
      try {
        page = await document.getPage(pageNumber);
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
          const original = page.getViewport({ scale: 1 });
          // 파일 크기와 판형을 구분하고 캔버스 메모리·변 길이 안에서 최대 해상도를 씁니다.
          const scale = Math.min(
            200 / 72,
            Math.sqrt(16_000_000 / (original.width * original.height)),
            8192 / original.width,
            8192 / original.height,
          );
          const viewport = page.getViewport({ scale });
          const canvas = new OffscreenCanvas(
            Math.max(1, Math.floor(viewport.width)),
            Math.max(1, Math.floor(viewport.height)),
          );
          const context = canvas.getContext('2d');
          if (!context) throw new Error('PDF canvas is unavailable.');
          try {
            // pdf.js 타입은 DOM 캔버스만 선언하지만 worker에서는 동일한 Canvas API를 씁니다.
            await page.render({
              canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: context as unknown as CanvasRenderingContext2D,
              viewport,
            }).promise;
            const image = await canvas.convertToBlob({ type: 'image/png' });
            const data = await recognizePdfPage(ocr, image);
            const recognized = data.text.trim();
            // 신뢰도가 낮은 페이지는 OCR 본문만 버리고 나머지 페이지 추출은 계속합니다.
            if (
              recognized.length > 0 &&
              (!Number.isFinite(data.confidence) || data.confidence < 50)
            ) {
              lowConfidencePages += 1;
              missingReason = 'ocr-low-confidence';
            } else if (recognized) {
              // OCR이 생략·오인식한 본문과 링크도 원래 텍스트 계층에서 보존합니다.
              body = body ? `${body}\n${recognized}` : recognized;
            } else {
              missingReason = 'ocr-empty';
            }
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      } catch {
        missingReason = 'page-error';
      }
      try {
        if (missingReason) completeness.missingPages.push({ pageNumber, reason: missingReason });
        append(body, `Page ${pageNumber}`);
        if (page) {
          let annotations: unknown[] = [];
          try {
            annotations = (await page.getAnnotations({ intent: 'any' })) as unknown[];
          } catch {
            completeness.failures.push({
              part: 'annotations',
              pageNumber,
              reason: 'extract-error',
            });
          }
          const popupIds = new Set(
            annotations
              .filter(isRecord)
              .map((annotation) => annotation.popupRef)
              .filter((value): value is string => typeof value === 'string'),
          );
          for (const [index, annotation] of annotations.entries()) {
            if (
              !isRecord(annotation) ||
              (typeof annotation.id === 'string' && popupIds.has(annotation.id))
            )
              continue;
            if (typeof annotation.id === 'string' && annotation.fieldName !== undefined)
              fieldIds.add(annotation.id);
            append(savedAnnotationText(annotation), `Page ${pageNumber} · Annotation ${index + 1}`);
          }
        }
      } finally {
        page?.cleanup();
      }
    }
    let fields: Map<string, object[]> | null = null;
    try {
      fields = await document.getFieldObjects();
    } catch {
      completeness.failures.push({ part: 'fields', reason: 'extract-error' });
    }
    for (const [name, objects] of fields ?? []) {
      for (const field of objects) {
        if (!isRecord(field) || (typeof field.id === 'string' && fieldIds.has(field.id))) continue;
        const fieldText = savedStrings([name, field.value]);
        // getFieldObjects의 page는 0부터 시작하며 -1은 페이지 없는 필드입니다.
        const page =
          typeof field.page === 'number' &&
          Number.isInteger(field.page) &&
          field.page >= 0 &&
          field.page < pageCount
            ? `Page ${field.page + 1} · `
            : '';
        append(fieldText, `${page}Field ${name}`);
      }
    }
    let metadata: Awaited<ReturnType<typeof document.getMetadata>> | undefined;
    try {
      metadata = await document.getMetadata();
    } catch {
      completeness.failures.push({ part: 'metadata', reason: 'extract-error' });
    }
    if (metadata) {
      for (const [key, value] of Object.entries(metadata.info)) {
        // pdf.js가 만든 boolean/version/fingerprint 값은 저장된 검색 텍스트가 아닙니다.
        if (key === 'PDFFormatVersion') continue;
        if (key === 'Custom' && value instanceof Map) {
          for (const [customKey, customValue] of value as Map<string, unknown>)
            append(savedStrings([customValue]), `Metadata · ${customKey}`);
        } else append(savedStrings([value]), `Metadata · ${key}`);
      }
      if (metadata.metadata) {
        for (const [key, value] of metadata.metadata as unknown as Iterable<[string, unknown]>) {
          append(savedStrings([value]), `Metadata · ${key}`);
        }
      }
    }
    completeness.missingPageCount = completeness.missingPages.length;
    completeness.status =
      completeness.missingPages.length + completeness.failures.length > 0 ? 'partial' : 'complete';
    if (segments.length === 0)
      return {
        ok: false,
        reason:
          lowConfidencePages > 0
            ? 'ocr-low-confidence'
            : completeness.failures.length > 0 ||
                completeness.missingPages.some((page) => page.reason === 'page-error')
              ? 'corrupt'
              : completeness.missingPages.length > 0
                ? 'ocr-empty'
                : 'empty',
        completeness,
      };
    return { ok: true, text, segments, pageCount, lowConfidencePages, completeness };
  } finally {
    try {
      await ocr?.terminate();
    } finally {
      await loading.destroy();
    }
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
  return name === 'PasswordException'
    ? 'encrypted'
    : name === 'RangeError'
      ? 'too-large'
      : 'corrupt';
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
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    return worker;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 허용된 저장 문자열만 사용하며 action/attachment/HTML을 탐색하거나 실행하지 않습니다. */
function savedStrings(values: readonly unknown[]): string {
  const strings: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (typeof item !== 'string' || !item.trim() || seen.has(item)) continue;
      seen.add(item);
      strings.push(item);
    }
  }
  return strings.join('\n');
}

function savedAnnotationText(annotation: Record<string, unknown>): string {
  const objectText = (value: unknown): unknown => (isRecord(value) ? value.str : undefined);
  return savedStrings([
    objectText(annotation.titleObj),
    objectText(annotation.contentsObj),
    objectText(annotation.richText),
    annotation.fieldName,
    annotation.alternativeText,
    annotation.fieldValue,
    annotation.url,
  ]);
}
