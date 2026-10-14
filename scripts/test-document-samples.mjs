// 지정한 로컬 예시 디렉터리만 검사하며 파일명과 본문은 출력하지 않습니다.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

const directory = process.argv[2];
assert(directory, '검사할 예시 디렉터리를 지정하세요.');
const root = new URL('../', import.meta.url);
const compiled = await build({
  stdin: {
    contents:
      "export * from './src/rag/rust-core'; export { chunkSourceDocument } from './src/rag/source-document'; export { XLSX_WORKER_SOURCE } from './generated/xlsx-worker-source'; export { RAG_WASM_BASE64 } from './src/rag/rag-wasm-bytes';",
    resolveDir: root.pathname,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const core = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
);
const formats = new Set([
  'pdf',
  'epub',
  'docx',
  'odt',
  'pptx',
  'xlsx',
  'hwpx',
  'md',
  'txt',
  'csv',
  'json',
  'ts',
  'html',
]);
const summary = new Map();
let failures = 0;
for (const entry of await readdir(directory, { withFileTypes: true })) {
  const extension = extname(entry.name).slice(1).toLowerCase();
  if (!entry.isFile() || !formats.has(extension)) continue;
  const bytes = new Uint8Array(await readFile(resolve(directory, entry.name)));
  const file = {
    path: `synthetic/source.${extension}`,
    name: `source.${extension}`,
    basename: 'source',
    extension,
    stat: { size: bytes.length, mtime: 1, ctime: 1 },
  };
  const row = summary.get(extension) ?? { checked: 0, passed: 0, reasons: {} };
  row.checked++;
  try {
    const plan = core.planRagFileIndexabilityRust(
      [{ filePath: file.path, fileName: file.name, extension, size: bytes.length }],
      [],
      [],
      [],
    );
    assert.deepEqual(plan?.candidateIndices, [0], 'candidate');
    const source =
      extension === 'pdf'
        ? await extractPdf(bytes)
        : extension === 'xlsx'
          ? await extractXlsx(bytes)
          : core.isExtractableSourceExtensionRust(extension)
            ? core.extractSourceTextRust(extension, bytes)
            : { ok: true, text: new TextDecoder().decode(bytes), segments: [] };
    assert(source?.ok, source?.reason ?? 'unavailable');
    assert(source.text.trim(), 'empty');
    const chunks = core.chunkSourceDocument(
      file,
      source.text,
      { chunkSize: 1000, overlap: 100 },
      source.segments,
    );
    assert(chunks.length > 0, 'chunks');
    assert(
      chunks.every((chunk) => chunk.metadata.filePath === file.path),
      'source-path',
    );
    row.passed++;
  } catch (error) {
    // 원문이나 파일 경로를 포함할 수 있는 오류 메시지는 공개하지 않습니다.
    const reason =
      [
        'too-large',
        'corrupt',
        'empty',
        'encrypted',
        'candidate',
        'chunks',
        'source-path',
        'unavailable',
        'memory-budget',
        'xml-token-budget',
        'time-budget',
        'worker-failed',
      ].find((code) => error.message === code) ?? 'extraction';
    row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
    failures++;
  }
  summary.set(extension, row);
}

/** 제품과 같은 워커·스트리밍 경로를 검사하며 동기 JSON 추출로 대체하지 않습니다. */
async function extractXlsx(bytes) {
  const worker = new Worker(
    `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage(message, transfer) { parentPort.postMessage(message, transfer); } };
    ${core.XLSX_WORKER_SOURCE}
    parentPort.on('message', (data) => self.onmessage({ data }));
  `,
    { eval: true },
  );
  try {
    const result = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('time-budget')), 60000);
      worker.once('message', (message) => {
        clearTimeout(timer);
        accept(message);
      });
      worker.once('error', () => {
        clearTimeout(timer);
        reject(new Error('worker-failed'));
      });
      worker.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('worker-failed'));
      });
      worker.postMessage({ bytes, wasmBase64: core.RAG_WASM_BASE64 }, [bytes.buffer]);
    });
    if (!result.ok) return result;
    return {
      ok: true,
      text: new TextDecoder('utf-8', { fatal: true }).decode(result.bytes),
      segments: JSON.parse(result.segmentsJson),
    };
  } finally {
    await worker.terminate();
  }
}
assert(summary.size > 0, '지원 형식의 예시 파일이 없습니다.');
console.log(JSON.stringify(Object.fromEntries(summary), null, 2));
process.exitCode = failures > 0 ? 1 : 0;

/** 실제 배포 PDF worker를 사용하며 OCR 자산 요청은 별도 검증으로 남깁니다. */
async function extractPdf(bytes) {
  const source = await readFile(new URL('../pdf-worker.js', import.meta.url), 'utf8');
  const worker = new Worker(
    `
    const { parentPort } = require('node:worker_threads');
    globalThis.DOMMatrix = class { translate(){return this} scale(){return this} invertSelf(){return this} multiplySelf(){return this} preMultiplySelf(){return this} };
    globalThis.self = { postMessage(message) { parentPort.postMessage(message); } };
    ${source}
    parentPort.on('message', (data) => globalThis.self.onmessage({ data }));
  `,
    { eval: true },
  );
  try {
    return await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 60000);
      worker.on('message', (message) => {
        if (message.kind === 'progress') return;
        clearTimeout(timer);
        if (message.kind) reject(new Error('ocr-unavailable'));
        else accept(message);
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`worker-exit-${code}`));
      });
      worker.postMessage({ id: 1, bytes }, [bytes.buffer]);
    });
  } finally {
    await worker.terminate();
  }
}
