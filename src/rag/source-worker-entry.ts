import * as core from '../../.local/generated/rag-wasm/rag_wasm';
import type { SourcePreparationConfig, SourcePreparationCore, RustSourceTextExtraction } from './rust-core';

export interface SourceWorkerRequest {
  operation: 'source-decode' | 'source-extract' | 'source-read' | 'source-finish';
  protocol?: 'source-preparation-v1';
  bytes: Uint8Array;
  extension?: string;
  preparation?: SourcePreparationConfig;
  source?: RustSourceTextExtraction;
  module: WebAssembly.Module;
}

/** 기존 XLSX 자산 안에서 같은 Rust 코어를 실행하며 문서 알고리즘을 복제하지 않습니다. */
export function handleSourceWorkerRequest(request: SourceWorkerRequest): void {
  try {
    if ((request.operation === 'source-read' || request.operation === 'source-finish') && request.protocol !== 'source-preparation-v1') throw new Error('Invalid source protocol.');
    core.initSync({ module: request.module });
    const preparation = core as unknown as SourcePreparationCore;
    const config = request.preparation ? JSON.stringify(request.preparation) : '';
    const json = request.operation === 'source-decode'
      ? JSON.stringify({ ...(JSON.parse(core.decode_source_bytes_json(request.bytes, true, request.bytes.byteLength)) as object), format: 'text', segments: [] })
      : request.operation === 'source-extract' ? core.extract_source_text_json(request.extension ?? '', request.bytes)
      : request.operation === 'source-finish' ? preparation.prepare_source_text_json(request.extension ?? '', JSON.stringify(request.source), config)
      : preparation.prepare_source_bytes_json(request.extension ?? '', request.bytes, config);
    const result = JSON.parse(json) as { binary?: boolean };
    if (result.binary === true) {
      // 입력 소유권을 반환해 PDF 경로가 재읽기·대형 복사 없이 같은 입력을 이동합니다.
      self.postMessage({ protocol: 'source-preparation-v1', ok: true, json, bytes: request.bytes }, { transfer: [request.bytes.buffer] });
    } else self.postMessage({ protocol: 'source-preparation-v1', ok: true, json });
  } catch {
    self.postMessage({ protocol: 'source-preparation-v1', ok: false, reason: 'source-worker-failed' });
  }
}
