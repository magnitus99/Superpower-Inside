import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const generatedPayload = fileURLToPath(new URL('../.local/generated/rag-wasm-bytes.ts', import.meta.url));
const snapshots = new Map();

// 성공·실패 모두 경로별 한 snapshot으로 고정해 중복 복원과 다른 payload로의 재시도를 막습니다.
export function readEmbeddedWasmBytes(filePath = generatedPayload) {
  const resolved = path.resolve(filePath);
  if (!snapshots.has(resolved)) snapshots.set(resolved, evaluatePayload(resolved));
  return snapshots.get(resolved);
}

async function evaluatePayload(filePath) {
  const compiled = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(filePath)};`,
      resolveDir: path.dirname(filePath),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const payload = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
  );
  const base64 = payload.RAG_WASM_BASE64;
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new Error(`RAG_WASM_BASE64 export가 없거나 비었습니다(복원·무결성 실패): ${filePath}`);
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) {
    throw new Error(`RAG_WASM_BASE64 export가 유효한 base64가 아닙니다: ${filePath}`);
  }
  try {
    new WebAssembly.Module(bytes);
  } catch (cause) {
    throw new Error(`내장 WASM payload가 손상되었거나 지원하지 않는 버전입니다: ${filePath}`, { cause });
  }
  return bytes;
}
