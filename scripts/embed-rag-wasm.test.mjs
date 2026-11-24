import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, '.thinkrail/context/_work/wasm-payload');
mkdirSync(artifacts, { recursive: true });
const fixture = mkdtempSync(join(artifacts, 'fixture-'));
const script = join(root, 'scripts/embed-rag-wasm.mjs');
const helper = join(root, 'src/rag/wasm-payload.ts');
const minimalWasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
// 빈 이름의 독립 합성 custom section: 실제 WASM 파싱과 충분한 반복 데이터를 함께 검사합니다.
const repeatedWasm = Buffer.concat([
  minimalWasm,
  Buffer.from([0, 0x81, 0x80, 0x04, 0]),
  Buffer.alloc(64 * 1024, 65),
]);

function checksum(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

function generate(bytes, name) {
  const input = join(fixture, `${name}.wasm`);
  const output = join(fixture, `${name}.ts`);
  writeFileSync(input, bytes);
  const result = spawnSync(process.execPath, [script, input, output], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 10000,
  });
  return { ...result, output };
}

async function bundle(options) {
  const result = await build({
    ...options,
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'payload',
    platform: options.platform ?? 'browser',
    target: 'es2022',
    minify: true,
    metafile: true,
  });
  const source = result.outputFiles[0].text;
  expect(source).not.toMatch(/\brequire\(|node:|\bBuffer\b/u);
  expect(Object.values(result.metafile.outputs).flatMap((output) => output.imports)).toEqual([]);
  return source;
}

function evaluate(source, nodeHost = false, overrides = {}) {
  const context = { atob, btoa, WebAssembly, ...overrides };
  if (nodeHost) Object.assign(context, { Buffer, process });
  runInNewContext(source, context, { timeout: 5000 });
  return context.payload;
}

async function decoder() {
  const source = await bundle({ entryPoints: [helper] });
  return evaluate(source).restoreWasmBase64;
}

function assertUnavailable(base64) {
  expect(base64).toBe('');
  // ensureRustCore의 기존 initSync 경계는 빈 바이트를 실패로 닫습니다.
  expect(() => new WebAssembly.Module(Buffer.from(base64, 'base64'))).toThrow();
}

describe('압축 내장 WASM 생성·복원 계약', () => {
  it('독립 합성 WASM을 파싱하고 결정적 gzip과 원본 길이·SHA-256을 기록한다', async () => {
    expect(() => new WebAssembly.Module(repeatedWasm)).not.toThrow();
    const first = generate(repeatedWasm, 'repeat');
    const second = generate(repeatedWasm, 'repeat-again');
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const content = readFileSync(first.output, 'utf8');
    expect(content).toBe(readFileSync(second.output, 'utf8'));
    expect(content).toContain('restoreWasmBase64(');
    expect(content).toContain(`${repeatedWasm.length} bytes`);
    expect(content).toContain(createHash('sha256').update(repeatedWasm).digest('hex'));
    const compressed = Buffer.from(
      [...content.matchAll(/'([A-Za-z0-9+/=]+)',/gu)].map((match) => match[1]).join(''),
      'base64',
    );
    expect(compressed.length).toBeLessThan(repeatedWasm.length);
    expect(compressed.readUInt32LE(4)).toBe(0);
    expect(compressed[9]).toBe(255);
    expect(gunzipSync(compressed)).toEqual(repeatedWasm);
    const source = await bundle({ entryPoints: [first.output] });
    for (const nodeHost of [false, true]) {
      const restored = evaluate(source, nodeHost).RAG_WASM_BASE64;
      expect(restored).toBe(repeatedWasm.toString('base64'));
      expect(() => new WebAssembly.Module(Buffer.from(restored, 'base64'))).not.toThrow();
    }
  });

  it('최소 WASM도 Node·브라우저에서 기존 base64 API로 복원한다', async () => {
    const result = generate(minimalWasm, 'minimal');
    expect(result.status, result.stderr).toBe(0);
    const source = await bundle({ entryPoints: [result.output] });
    expect(evaluate(source).RAG_WASM_BASE64).toBe(minimalWasm.toString('base64'));
    // test-document-samples와 같은 Node ESM·data URL 경로도 유지합니다.
    const nodeBundle = await build({
      entryPoints: [result.output],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
    });
    expect(nodeBundle.outputFiles[0].text).not.toContain('zlib');
    const nodePayload = await import(
      `data:text/javascript;base64,${Buffer.from(nodeBundle.outputFiles[0].contents).toString('base64')}`
    );
    expect(nodePayload.RAG_WASM_BASE64).toBe(minimalWasm.toString('base64'));
  });

  it('복원은 공유 모듈 평가당 한 번이고 중복 import가 같은 문자열을 사용한다', async () => {
    const result = generate(repeatedWasm, 'shared');
    expect(result.status, result.stderr).toBe(0);
    const source = await bundle({
      stdin: {
        contents: `import { RAG_WASM_BASE64 as a } from ${JSON.stringify(result.output)};\nimport { RAG_WASM_BASE64 as b } from ${JSON.stringify(result.output)};\nexport { a, b };`,
        resolveDir: root,
      },
    });
    let decodes = 0;
    const payload = evaluate(source, false, {
      atob: (text) => {
        decodes++;
        return atob(text);
      },
    });
    expect(payload.a).toBe(repeatedWasm.toString('base64'));
    expect(payload.b).toBe(payload.a);
    expect(decodes).toBe(1);
  });

  it('손상·잘림·잘못된 헤더·CRC/ISIZE는 import 예외 없이 unavailable로 닫힌다', async () => {
    const restore = await decoder();
    const gzip = gzipSync(repeatedWasm, { level: 9 });
    expect(restore(gzip.toString('base64'), repeatedWasm.length, checksum(gzip))).toBe(
      repeatedWasm.toString('base64'),
    );
    const corruptions = [
      gzip.subarray(0, 7),
      gzip.subarray(0, -1),
      Buffer.from(gzip),
      Buffer.from(gzip),
      Buffer.from(gzip),
      Buffer.from(gzip),
    ];
    corruptions[2][0] ^= 1;
    corruptions[3][12] ^= 127;
    corruptions[4][gzip.length - 8] ^= 1;
    corruptions[5].writeUInt32LE(0xffffffff, gzip.length - 4);
    for (const bytes of corruptions) {
      assertUnavailable(restore(bytes.toString('base64'), repeatedWasm.length, checksum(gzip)));
    }
    assertUnavailable(restore('not base64!', 8, 0));
    assertUnavailable(restore(gzip.toString('base64'), repeatedWasm.length - 1, checksum(gzip)));
    const nonWasm = gzipSync(Buffer.alloc(repeatedWasm.length, 65));
    assertUnavailable(restore(nonWasm.toString('base64'), repeatedWasm.length, checksum(nonWasm)));
  });

  it('고정 예산을 넘는 압축/원본/ISIZE와 위장된 출력 길이도 bounded allocation으로 거절한다', async () => {
    const allocations = [];
    const source = await bundle({ entryPoints: [helper] });
    const restore = evaluate(source, false, {
      Uint8Array: new Proxy(Uint8Array, {
        construct(target, args) {
          if (typeof args[0] === 'number') {
            allocations.push(args[0]);
            if (args[0] > 8 * 1024 * 1024 + 1) throw new Error('할당 예산 초과');
          }
          return Reflect.construct(target, args);
        },
      }),
    }).restoreWasmBase64;
    const gzip = gzipSync(minimalWasm);
    for (const length of [0, -1, NaN, 8.5, 8 * 1024 * 1024 + 1, 0xffffffff]) {
      assertUnavailable(restore(gzip.toString('base64'), length, checksum(gzip)));
    }
    assertUnavailable(restore('A'.repeat(4 * Math.ceil((4 * 1024 * 1024 + 1) / 3)), 8, 0));
    const forged = gzipSync(repeatedWasm);
    forged.writeUInt32LE(8, forged.length - 4);
    assertUnavailable(restore(forged.toString('base64'), 8, checksum(forged)));
    const overBudget = Buffer.from(gzip);
    overBudget.writeUInt32LE(8 * 1024 * 1024 + 1, overBudget.length - 4);
    assertUnavailable(restore(overBudget.toString('base64'), 8, checksum(overBudget)));
    expect(allocations).toContain(9);
    expect(Math.max(...allocations)).toBeLessThanOrEqual(Math.max(32768, forged.length));
  });

  it('복원 환경 오류도 모듈 import를 죽이지 않는다', async () => {
    const result = generate(minimalWasm, 'host-failure');
    expect(result.status, result.stderr).toBe(0);
    const source = await bundle({ entryPoints: [result.output] });
    assertUnavailable(evaluate(source, false, { atob: undefined }).RAG_WASM_BASE64);
    assertUnavailable(
      evaluate(source, false, {
        btoa: () => {
          throw new Error('host');
        },
      }).RAG_WASM_BASE64,
    );
  });

  it('손상된 압축 payload는 실제 ensureRustCore에서도 계산 대체 없이 null로 닫힌다', async () => {
    const result = generate(minimalWasm, 'unavailable');
    expect(result.status, result.stderr).toBe(0);
    const built = await build({
      stdin: {
        contents:
          'export { rankTopKPairsRust, planVectorStoreAddRust } from "./src/rag/rust-core";',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'payload',
      platform: 'browser',
      plugins: [
        {
          name: 'fixture-payload',
          setup(builder) {
            builder.onResolve({ filter: /rag-wasm-bytes$/ }, () => ({ path: result.output }));
          },
        },
      ],
    });
    const core = evaluate(built.outputFiles[0].text, false, {
      TextDecoder,
      TextEncoder,
      atob: () => 'corrupt',
    });
    expect(core.rankTopKPairsRust([1, 0], [[1, 0]], 1)).toBeNull();
    expect(core.planVectorStoreAddRust(['a'], ['a', 'b'])).toBeNull();
  });

  it('gzip 크기 예산을 넘는 실제 WASM은 생성하지 않는다', () => {
    const length = 4 * 1024 * 1024;
    // custom section의 이름 길이 1바이트를 포함하는 ULEB128 길이입니다.
    const wasm = Buffer.concat([
      minimalWasm,
      Buffer.from([0, 0x81, 0x80, 0x80, 0x02, 0]),
      randomBytes(length),
    ]);
    expect(WebAssembly.validate(wasm)).toBe(true);
    expect(gzipSync(wasm).length).toBeGreaterThan(length);
    const result = generate(wasm, 'gzip-over-budget');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gzip 크기 예산 초과');
  });

  it('CLI 인자·입출력 실패와 잘못된 WASM/크기 예산을 1로 종료한다', () => {
    for (const args of [[], ['input.wasm'], ['a', 'b', 'extra'], ['missing.wasm', 'out.ts']]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
    }
    const valid = join(fixture, 'valid.wasm');
    writeFileSync(valid, minimalWasm);
    expect(
      spawnSync(process.execPath, [script, valid, join(fixture, 'extra.ts'), 'extra']).status,
    ).toBe(1);
    const nested = join(fixture, 'nested/embed.ts');
    expect(spawnSync(process.execPath, [script, valid, nested]).status).toBe(0);
    expect(readFileSync(nested, 'utf8')).toContain('RAG_WASM_BASE64');
    expect(spawnSync(process.execPath, [script, valid, fixture], { encoding: 'utf8' }).status).toBe(
      1,
    );
    for (const [name, bytes] of [
      ['bad-header', Buffer.from('not wasm')],
      ['bad-version', Buffer.from([0, 97, 115, 109, 2, 0, 0, 0])],
      ['oversized', Buffer.alloc(8 * 1024 * 1024 + 1)],
    ]) {
      expect(generate(bytes, name).status).toBe(1);
    }
  });
});
