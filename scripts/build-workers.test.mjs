import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('작업 디렉터리와 무관하게 worker를 생성하고 Electron에서도 브라우저용 ONNX를 선택한다', async () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = mkdtempSync(join(tmpdir(), 'superpower-workers-'));
  const workers = [
    ['rag/bm25', 'bm25', 'BM25'],
    ['rag/vector-search', 'vector-search', 'VECTOR_SEARCH'],
    ['llm/ternlight', 'ternlight', 'TERNLIGHT'],
  ];
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(join(repo, 'scripts/build-workers.mjs'), join(root, 'scripts/build-workers.mjs'));
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
    mkdirSync(join(root, 'src/llm'), { recursive: true });
    const gemmaEntry = readFileSync(join(repo, 'src/llm/embeddinggemma-worker-entry.ts'), 'utf8');
    writeFileSync(
      join(root, 'src/llm/embeddinggemma-worker-entry.ts'),
      `${gemmaEntry}\nglobalThis.workerKind = "GEMMA";\nglobalThis.workerWasm = env.backends.onnx.wasm;`,
    );
    for (const [entry, , constant] of workers) {
      const path = join(root, `src/${entry}-worker-entry.ts`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `globalThis.workerKind = ${JSON.stringify(constant)};`);
    }
    writeFileSync(join(root, 'src/rag/pdf-worker-entry.ts'), 'globalThis.workerKind = "PDF";');
    copyFileSync(join(repo, 'src/rag/pdf-ocr-worker-entry.ts'), join(root, 'src/rag/pdf-ocr-worker-entry.ts'));
    execFileSync(process.execPath, [join(root, 'scripts/build-workers.mjs')], { cwd: tmpdir() });
    for (const [, output, constant] of workers) {
      const source = readFileSync(join(root, `generated/${output}-worker-source.ts`), 'utf8');
      const encoded = source.match(/export const \w+ = (.+);/u)?.[1];
      expect(source).toContain(`export const ${constant}_WORKER_SOURCE = `);
      expect(encoded).toBeDefined();
      expect(JSON.parse(encoded)).toContain(`workerKind="${constant}"`);
    }
    const gemmaSource = readFileSync(join(root, 'embeddinggemma-worker.js'), 'utf8');
    expect(gemmaSource).toContain('workerKind="GEMMA"');
    // PDF worker는 main.js에 흡수하지 않고 별도 릴리스 자산으로 남아야 합니다.
    expect(readFileSync(join(root, 'pdf-worker.js'), 'utf8')).toContain('workerKind="PDF"');
    expect(readFileSync(join(root, 'pdf-ocr-worker.js'), 'utf8')).toContain('PDF_OCR_LANGUAGES');
    // Electron이 worker에 process를 노출해도 브라우저용 ONNX 백엔드를 선택해야 합니다.
    for (const process of [undefined, { release: { name: 'node' }, versions: { node: '22.0.0' }, platform: 'darwin', arch: 'arm64' }]) {
      const context = {
        process,
        self: { constructor: { name: 'DedicatedWorkerGlobalScope' } },
        navigator: {},
        fetch,
      };
      runInNewContext(gemmaSource, context);
      expect(context.workerWasm).toBeDefined();
      expect(context.self.onmessage).toBeTypeOf('function');
    }
    // 별도 로더도 Node의 process를 무시하고 전달받은 WASM 바이너리를 사용해야 합니다.
    const runtimeSource = readFileSync(join(root, 'embeddinggemma-runtime.mjs'), 'utf8');
    const { default: createRuntime } = await import(
      `data:text/javascript;base64,${Buffer.from(runtimeSource).toString('base64')}`
    );
    const runtime = await createRuntime({
      wasmBinary: readFileSync(join(root, 'embeddinggemma-runtime.wasm')),
      locateFile: (file) => `https://example.invalid/${file}`,
      numThreads: 1,
    });
    expect(runtime.HEAPU8).toBeInstanceOf(Uint8Array);
    const manifest = readFileSync(join(root, 'generated/embeddinggemma-assets.ts'), 'utf8');
    expect(manifest).toContain('embeddinggemma-runtime.wasm');
    expect(manifest).toContain('onnx/model.onnx_data');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
