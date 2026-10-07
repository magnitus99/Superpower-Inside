import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workers = [
  ['rag/bm25', 'bm25', 'BM25'],
  ['rag/vector-search', 'vector-search', 'VECTOR_SEARCH'],
  ['llm/ternlight', 'ternlight', 'TERNLIGHT'],
];

await mkdir(resolve(root, 'generated'), { recursive: true });
for (const [entry, output, constant] of workers) {
  const result = await build({
    entryPoints: [resolve(root, `src/${entry}-worker-entry.ts`)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error(`${constant} worker 번들이 생성되지 않았습니다.`);
  await writeFile(
    resolve(root, `generated/${output}-worker-source.ts`),
    `// 이 파일은 scripts/build-workers.mjs가 생성합니다. 직접 수정하지 마세요.\nexport const ${constant}_WORKER_SOURCE = ${JSON.stringify(source)};\n`,
    'utf8',
  );
}

// Electron의 process와 관계없이 worker와 별도 WASM 로더가 브라우저 환경을 사용합니다.
const browserDefines = { process: 'undefined', 'globalThis.process': 'undefined' };
const gemma = await build({
  entryPoints: [resolve(root, 'src/llm/embeddinggemma-worker-entry.ts')],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  define: browserDefines,
  minify: true, legalComments: 'none',
});
await writeFile(resolve(root, 'embeddinggemma-worker.js'), gemma.outputFiles[0].contents);
const runtimeFiles = [
  ['ort-wasm-simd-threaded.wasm', 'embeddinggemma-runtime.wasm'],
  ['ort-wasm-simd-threaded.mjs', 'embeddinggemma-runtime.mjs'],
];
for (const [source, target] of runtimeFiles) {
  const sourcePath = resolve(root, `node_modules/onnxruntime-web/dist/${source}`);
  if (source.endsWith('.mjs')) {
    const result = await transform(await readFile(sourcePath, 'utf8'), {
      define: browserDefines, format: 'esm', target: 'es2022', minify: true, legalComments: 'none',
    });
    await writeFile(resolve(root, target), result.code);
  } else {
    await copyFile(sourcePath, resolve(root, target));
  }
}
const assets = [];
for (const file of ['embeddinggemma-worker.js', ...runtimeFiles.map(([, target]) => target)]) {
  const bytes = await readFile(resolve(root, file));
  assets.push({ file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: '' });
}
const revision = '5090578d9565bb06545b4552f76e6bc2c93e4a66';
for (const [file, size, sha256] of [
  ['config.json', 1765, '6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b'],
  ['tokenizer.json', 20323312, '4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47'],
  ['tokenizer_config.json', 1156830, '3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a'],
  ['special_tokens_map.json', 662, '2f7b0adf4fb469770bb1490e3e35df87b1dc578246c5e7e6fc76ecf33213a397'],
  ['added_tokens.json', 35, '50b2f405ba56a26d4913fd772089992252d7f942123cc0a034d96424221ba946'],
  ['onnx/model.onnx', 479932, 'ea91fd315a7c152d427d231746f0f811a1ac93beaba656abfdf2b24e091265e4'],
  ['onnx/model.onnx_data', 1234521088, 'ef835ae565d8695236652475903078e8ed794c7c35faf1164d78ec3238e8a88d'],
]) {
  assets.push({file, size, sha256, url: `https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/${revision}/${file}`});
}
await writeFile(resolve(root, 'generated/embeddinggemma-assets.ts'),
  `// 이 파일은 scripts/build-workers.mjs가 생성합니다. 직접 수정하지 마세요.\nexport const EMBEDDINGGEMMA_ASSETS = ${JSON.stringify(assets, null, 2)} as const;\n`);
