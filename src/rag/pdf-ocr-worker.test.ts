import { describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('tesseract.js/src/worker-script/index.js', () => ({
  dispatchHandlers: dispatch,
  setAdapter: vi.fn(),
}));

describe('로컬 OCR worker', () => {
  it('내장 언어 바이트를 전달하고 외부 다운로드 없이 처리한다', async () => {
    vi.stubGlobal('PDF_OCR_LANGUAGES', { kor: 'AQ==', eng: 'Ag==' });
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', scope);
    try {
      vi.resetModules();
      await import('./pdf-ocr-worker-entry');
      scope.onmessage?.({
        data: { action: 'loadLanguage', payload: { langs: 'kor+eng' } },
      } as MessageEvent);
      expect(dispatch.mock.calls[0]?.[0]).toEqual({
        action: 'loadLanguage',
        payload: {
          langs: [
            { code: 'kor', data: new Uint8Array([1]) },
            { code: 'eng', data: new Uint8Array([2]) },
          ],
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('언어 배열로 요청해도 내장 바이트로 채운다', async () => {
    vi.stubGlobal('PDF_OCR_LANGUAGES', { kor: 'AQ==', eng: 'Ag==' });
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', scope);
    try {
      dispatch.mockClear();
      vi.resetModules();
      await import('./pdf-ocr-worker-entry');
      scope.onmessage?.({
        data: { action: 'loadLanguage', payload: { langs: ['kor', 'eng'] } },
      } as MessageEvent);
      expect(dispatch.mock.calls[0]?.[0]).toEqual({
        action: 'loadLanguage',
        payload: {
          langs: [
            { code: 'kor', data: new Uint8Array([1]) },
            { code: 'eng', data: new Uint8Array([2]) },
          ],
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('알 수 없는 언어 코드는 네트워크 대신 명시적으로 실패한다', async () => {
    vi.stubGlobal('PDF_OCR_LANGUAGES', { eng: 'Ag==' });
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', scope);
    try {
      dispatch.mockClear();
      vi.resetModules();
      await import('./pdf-ocr-worker-entry');
      expect(() =>
        scope.onmessage?.({
          data: { action: 'loadLanguage', payload: { langs: 'kor+eng' } },
        } as MessageEvent),
      ).toThrow('OCR language data is unavailable: kor');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
