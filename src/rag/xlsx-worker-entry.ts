import { initSync, XlsxSourceText } from '../../generated/rag-wasm/rag_wasm';

interface XlsxWorkerRequest {
  bytes: Uint8Array;
  wasmBase64: string;
}

/** 파일 하나의 처리만 소유하며 종료하면 WASM의 최대 메모리도 해제됩니다. */
self.onmessage = (event: MessageEvent<XlsxWorkerRequest>): void => {
  try {
    const binary = atob(event.data.wasmBase64);
    const wasmBytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) wasmBytes[index] = binary.charCodeAt(index);
    initSync({ module: wasmBytes });
    const document = new XlsxSourceText(event.data.bytes);
    try {
      const reason = document.reason();
      if (reason) {
        self.postMessage({ ok: false, reason });
        return;
      }
      const segmentsJson = document.segments_json();
      const bytes = document.take_text_bytes();
      if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error('XLSX buffer is unavailable.');
      self.postMessage({ ok: true, bytes, segmentsJson }, { transfer: [bytes.buffer] });
    } finally {
      document.free();
    }
  } catch {
    // 엔진 오류에 원문·파일 경로가 포함될 수 있으므로 안정적인 코드만 반환합니다.
    self.postMessage({ ok: false, reason: 'worker-failed' });
  }
};
