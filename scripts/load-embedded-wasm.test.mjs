import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { readEmbeddedWasmBytes } from './load-embedded-wasm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, '.thinkrail/context/_work/wasm-loader');
mkdirSync(artifacts, { recursive: true });
const fixture = mkdtempSync(join(artifacts, 'fixture-'));
const minimalWasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function source(name, contents) {
  const file = join(fixture, `${name}.ts`);
  writeFileSync(file, contents);
  return file;
}

function compressed(name) {
  const input = join(fixture, `${name}.wasm`);
  const output = join(fixture, `${name}.ts`);
  writeFileSync(input, minimalWasm);
  const result = spawnSync(process.execPath, [join(root, 'scripts/embed-rag-wasm.mjs'), input, output], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return output;
}

describe('Node 공통 내장 WASM 로더', () => {
  it('따옴표 청크가 아니라 실제 raw export의 평가 결과를 읽는다', async () => {
    const file = source('raw', `const unrelated = 'not a payload';
      const bytes: number[] = [0, 97, 115, 109, 1, 0, 0, 0];
      export const RAG_WASM_BASE64 = Buffer.from(bytes).toString('base64');`);
    expect(await readEmbeddedWasmBytes(file)).toEqual(minimalWasm);
  });

  it('실제 생성된 gzip 모듈을 Node ESM/data URL에서 복원하고 브라우저 조건과 일치한다', async () => {
    const file = compressed('gzip');
    expect(await readEmbeddedWasmBytes(file)).toEqual(minimalWasm);
    const browser = await build({
      entryPoints: [file], bundle: true, write: false, platform: 'browser', format: 'esm',
    });
    const payload = await import(`data:text/javascript;base64,${Buffer.from(browser.outputFiles[0].contents).toString('base64')}`);
    expect(Buffer.from(payload.RAG_WASM_BASE64, 'base64')).toEqual(minimalWasm);
  });

  it.each([
    ['missing', 'export const OTHER = "AGFzbQEAAAA=";'],
    ['wrong-type', 'export const RAG_WASM_BASE64 = 42;'],
    ['empty', 'export const RAG_WASM_BASE64 = "";'],
    ['base64', 'export const RAG_WASM_BASE64 = "not base64!";'],
    ['version', 'export const RAG_WASM_BASE64 = "AGFzbQIAAAA=";'],
    ['corrupt', 'export const RAG_WASM_BASE64 = "AGFzbQEAAAAB";'],
  ])('%s payload를 명확히 거절한다', async (name, contents) => {
    await expect(readEmbeddedWasmBytes(source(name, contents))).rejects.toThrow(/WASM|RAG_WASM_BASE64/u);
  });

  it('압축 체크섬 불일치는 빈 export로 실패하며 raw 문자열로 폴백하지 않는다', async () => {
    const file = compressed('checksum');
    const original = readFileSync(file, 'utf8');
    // 생성기 인자를 해석하지 않고 실제 복원 함수에 잘못된 체크섬을 전달합니다.
    writeFileSync(file, original.replace('restoreWasmBase64([', '((chunks, length) => restoreWasmBase64(chunks, length, -1))(['));
    await expect(readEmbeddedWasmBytes(file)).rejects.toThrow(/RAG_WASM_BASE64/u);
  });

  it('동시·반복 호출과 같은 모듈의 경로 별칭은 한 번만 복원한 snapshot을 공유한다', async () => {
    const file = compressed('shared');
    const marker = `__wasmLoader_${Date.now()}`;
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nglobalThis[${JSON.stringify(marker)}] = (globalThis[${JSON.stringify(marker)}] ?? 0) + 1;`);
    try {
      const first = readEmbeddedWasmBytes(file);
      const second = readEmbeddedWasmBytes(`${dirname(file)}/./shared.ts`);
      expect(second).toBe(first);
      const bytes = await first;
      expect(await second).toBe(bytes);
      writeFileSync(file, 'throw new Error("재평가 금지");');
      expect(await readEmbeddedWasmBytes(file)).toBe(bytes);
      expect(globalThis[marker]).toBe(1);
    } finally {
      delete globalThis[marker];
    }
  });

  it('실패도 snapshot에 고정해 나중 raw payload로 조용히 재시도하지 않는다', async () => {
    const file = source('failed-snapshot', 'export const RAG_WASM_BASE64 = "";');
    const failed = readEmbeddedWasmBytes(file);
    await expect(failed).rejects.toThrow(/RAG_WASM_BASE64/u);
    writeFileSync(file, `export const RAG_WASM_BASE64 = ${JSON.stringify(minimalWasm.toString('base64'))};`);
    expect(readEmbeddedWasmBytes(file)).toBe(failed);
    await expect(readEmbeddedWasmBytes(file)).rejects.toThrow(/RAG_WASM_BASE64/u);
  });

  it('현재 generated payload로 실제 WASM을 초기화한다', async () => {
    const bytes = await readEmbeddedWasmBytes();
    const glue = readFileSync(join(root, '.local/generated/rag-wasm/rag_wasm.js'));
    const module = await import(`data:text/javascript;base64,${glue.toString('base64')}`);
    module.initSync({ module: bytes });
    expect(module.tokenizer_version()).toBeGreaterThan(0);
    expect(await readEmbeddedWasmBytes(join(root, '.local/generated/rag-wasm-bytes.ts'))).toBe(bytes);
  });
});
