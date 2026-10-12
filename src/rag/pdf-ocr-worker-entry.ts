import { dispatchHandlers, setAdapter } from 'tesseract.js/src/worker-script/index.js';

interface OcrPacket {
  action: string;
  payload: { langs?: string | Array<string | { code: string; data: Uint8Array }> };
}

// 빌드가 코어와 학습 데이터를 이 worker에 포함하므로 CDN·파일 시스템에 접근하지 않습니다.
const assets = globalThis as typeof globalThis & {
  TesseractCore: (options: unknown) => Promise<unknown>;
  PDF_OCR_LANGUAGES: Record<string, string>;
};
setAdapter({
  getCore: () => Promise.resolve(assets.TesseractCore),
  // 빌드 단계에서 압축을 풀기 때문에 런타임에는 gzip 파서가 필요 없습니다.
  gunzip: () => {
    throw new Error('Unexpected compressed OCR language data.');
  },
  readCache: () => Promise.resolve(undefined),
  writeCache: () => Promise.resolve(),
});

self.onmessage = (event: MessageEvent<OcrPacket>): void => {
  const packet = event.data;
  if (packet.action === 'loadLanguage') {
    const requested = packet.payload.langs;
    // tesseract.js는 호출 경로에 따라 `kor+eng` 문자열이나 `['kor','eng']` 배열을 보냅니다.
    // 두 형태 모두 내장 학습 데이터로 바꿔야 네트워크 폴백이 생기지 않습니다.
    const codes =
      typeof requested === 'string'
        ? requested.split('+')
        : Array.isArray(requested)
          ? requested.map((entry) => (typeof entry === 'string' ? entry : entry.code))
          : [];
    packet.payload.langs = codes.map((code) => {
      const encoded = assets.PDF_OCR_LANGUAGES[code];
      if (!encoded) throw new Error(`OCR language data is unavailable: ${code}`);
      return {
        code,
        data: Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
      };
    });
  }
  dispatchHandlers(packet, (message) => self.postMessage(message));
};
