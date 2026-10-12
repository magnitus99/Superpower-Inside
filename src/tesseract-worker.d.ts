/** 버전을 고정한 Tesseract worker의 어댑터 경계입니다. */
declare module 'tesseract.js/src/worker-script/index.js' {
  export function setAdapter(adapter: {
    getCore(): Promise<unknown>;
    gunzip(bytes: Uint8Array): Uint8Array;
    readCache(): Promise<undefined>;
    writeCache(): Promise<void>;
  }): void;
  export function dispatchHandlers(packet: unknown, send: (message: unknown) => void): void;
}
