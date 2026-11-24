import * as core from '../../.local/generated/rag-wasm/rag_wasm';
import type { LiteralScannerInput, LiteralSourceBlock } from './literal-core';

export type LiteralWorkerCommand =
  | { operation: 'init'; module: WebAssembly.Module; input: LiteralScannerInput }
  | { operation: 'append'; block: LiteralSourceBlock }
  | { operation: 'seal' | 'summary' }
  | { operation: 'page'; maxMatches: number; maxBytes: number };
export type LiteralWorkerRequest = { protocol: 'literal-source-v1'; id: number } & LiteralWorkerCommand;
export interface LiteralWorkerResponse {
  protocol: 'literal-source-v1'; id: number; operation: string; ok: boolean; json?: string; reason?: string;
}
const REASONS = new Set(['invalid-input', 'invalid-block', 'incomplete-input', 'source-hash', 'memory-budget', 'not-ready', 'not-sealed', 'invalid-page', 'output-budget', 'projection-failed', 'count-overflow']);
class WorkerFailure extends Error {
  constructor(readonly reason: string) { super('worker-failed'); }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nativeResult(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!record(value)) throw new Error('worker-failed');
  if (value.ok !== true) throw new WorkerFailure(typeof value.reason === 'string' && REASONS.has(value.reason) ? value.reason : 'worker-failed');
  return value;
}

/** 한 private worker가 opaque scanner 하나만 소유합니다. 테스트에서도 realm별 handler를 분리합니다. */
export function createLiteralWorkerHandler(post: (response: LiteralWorkerResponse) => void): (request: unknown) => void {
  let scanner: core.LiteralSourceScanner | undefined;
  let lastId = 0;
  let closed = false;
  return (request) => {
    const id = record(request) && Number.isSafeInteger(request.id) ? request.id as number : 0;
    const operation = record(request) && typeof request.operation === 'string' && ['init', 'append', 'seal', 'page', 'summary'].includes(request.operation) ? request.operation : 'invalid';
    let json = '{"ok":true}';
    try {
      if (closed || !record(request) || request.protocol !== 'literal-source-v1' || id !== lastId + 1 || operation === 'invalid') throw new Error('worker-failed');
      lastId = id;
      if (operation === 'init') {
        if (scanner || !(request.module instanceof WebAssembly.Module) || !record(request.input)) throw new Error('worker-failed');
        core.initSync({ module: request.module });
        scanner = new core.LiteralSourceScanner(JSON.stringify(request.input));
        const ready: unknown = JSON.parse(scanner.summary_json());
        if (!record(ready) || ready.ok !== false || ready.reason !== 'not-ready') {
          nativeResult(scanner.summary_json());
          throw new Error('worker-failed');
        }
      } else {
        if (!scanner) throw new Error('worker-failed');
        if (operation === 'append') {
          if (!record(request.block)) throw new Error('worker-failed');
          if (!scanner.append_block_json(JSON.stringify(request.block))) { nativeResult(scanner.summary_json()); throw new Error('worker-failed'); }
        } else if (operation === 'seal') {
          if (!scanner.seal_input()) { nativeResult(scanner.summary_json()); throw new Error('worker-failed'); }
        } else if (operation === 'page') {
          if (!Number.isSafeInteger(request.maxMatches) || (request.maxMatches as number) < 1 || (request.maxMatches as number) > 256 || !Number.isSafeInteger(request.maxBytes) || (request.maxBytes as number) < 1 || (request.maxBytes as number) > 1024 * 1024) throw new WorkerFailure('invalid-page');
          json = scanner.next_page_json(request.maxMatches as number, request.maxBytes as number);
          nativeResult(json);
        } else {
          json = scanner.summary_json(); nativeResult(json);
          scanner.free(); scanner = undefined; closed = true;
        }
      }
      post({ protocol: 'literal-source-v1', id, operation, ok: true, json });
    } catch (error) {
      closed = true;
      try { scanner?.free(); } finally {
        scanner = undefined;
        post({ protocol: 'literal-source-v1', id, operation, ok: false, reason: error instanceof WorkerFailure ? error.reason : 'worker-failed' });
      }
    }
  };
}

export const handleLiteralWorkerRequest = createLiteralWorkerHandler((response) => self.postMessage(response));
