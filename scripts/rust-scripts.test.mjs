import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const scripts = dirname(fileURLToPath(import.meta.url));
const context = resolve(scripts, '../.thinkrail/context/_rust-scripts');

// 명령은 기록만 하고 후속 단계가 읽는 파일만 합성합니다. Rust 도구는 실행하지 않습니다.
const fakeHelper = String.raw`
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const hasCommand = (command) => command !== process.env.FIXTURE_MISSING;
function record(kind, command, args, options) {
  const env = options.env ?? process.env;
  appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ kind, command, args,
    cwd: options.cwd ?? root, target: env.CARGO_TARGET_DIR, offline: env.CARGO_NET_OFFLINE,
    toolchain: env.RUSTUP_TOOLCHAIN, path: env.PATH }) + '\n');
  if (process.env.FIXTURE_FAIL && args.includes(process.env.FIXTURE_FAIL)) process.exit(37);
}
export function capture(command, args, options = {}) {
  record('capture', command, args, options);
  return args.includes('which') ? join(root, 'tool chain', 'bin', 'cargo') + '\n' : 'host: fixture-host\n';
}
export function npm(args, options = {}) { record('npm', 'npm', args, options); }
export function run(command, args, options = {}) {
  record('run', command, args, options);
  if (args.includes('--out-dir')) {
    const dir = args[args.indexOf('--out-dir') + 1];
    mkdirSync(dir, { recursive: true });
    for (const file of ['rag_wasm.js', 'rag_wasm.d.ts', 'rag_wasm_bg.wasm']) writeFileSync(join(dir, file), 'synthetic');
  }
  if (args.includes('-Oz')) writeFileSync(args[args.indexOf('-o') + 1], 'optimized');
  if (args.includes('scripts/embed-rag-wasm.mjs')) writeFileSync(join(root, args[2]), 'embedded');
  if (args.includes('scripts/build-rag-wasm.mjs') && process.env.FIXTURE_DRIFT) {
    writeFileSync(join(root, '.local/generated/rag-wasm/rag_wasm.js'), 'changed');
  }
}
`;

function fixture(name) {
  mkdirSync(context, { recursive: true });
  const root = mkdtempSync(join(context, 'synthetic repo #'));
  const script = join(root, 'scripts', `${name}.mjs`);
  mkdirSync(dirname(script));
  for (const file of [`${name}.mjs`, 'artifact-paths.mjs']) {
    copyFileSync(join(scripts, file), join(dirname(script), file));
  }
  writeFileSync(join(dirname(script), 'script-process.mjs'), fakeHelper);
  function put(file, contents) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return path;
  }
  function execute(env = {}, entry = script) {
    const result = spawnSync(process.execPath, [entry], {
      cwd: context,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, HOME: root, USERPROFILE: root, CARGO_TARGET_DIR: '',
        CARGO_NET_OFFLINE: '', RUSTUP_TOOLCHAIN: '', ...env },
    });
    const log = join(root, 'calls.jsonl');
    const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
    return { ...result, calls };
  }
  return { root, put, execute };
}

it('수동 벤치의 원래 인자와 종료 상태를 보존한다', () => {
  const f = fixture('bench-rag-core');
  const result = f.execute({ FIXTURE_FAIL: '--ignored' });
  assert.equal(result.status, 37, result.stderr);
  assert.match(result.stdout, /median ns/u);
  assert.deepEqual(result.calls.map(({ command, args }) => [command, args]), [
    ['cargo', ['test', '--release', '--workspace', 'bench_rag_core_runtime_medians', '--', '--ignored', '--nocapture']],
  ]);
});

it('로컬 Rust 검사는 고정 도구·오프라인 플래그를 적용하고 첫 실패에서 멈춘다', () => {
  const f = fixture('check-rust-local');
  const result = f.execute({ FIXTURE_FAIL: 'clippy' });
  assert.equal(result.status, 37, result.stderr);
  assert.deepEqual(result.calls.map(({ args }) => args), [
    ['which', '--toolchain', '1.96.0', 'cargo'],
    ['run', '1.96.0', 'cargo', 'fmt', '--all', '--check'],
    ['run', '1.96.0', 'cargo', 'clippy', '--workspace', '--all-targets', '--all-features', '--frozen', '--', '-D', 'warnings'],
  ]);
  for (const call of result.calls.slice(1)) {
    assert.equal(resolve(call.cwd), context);
    assert.equal(call.offline, 'true');
    assert.equal(call.target, join(context, '.local/cache/rust/rustup-1.96.0'));
    assert.equal(call.toolchain, '1.96.0');
    assert.ok(call.path.startsWith(join(f.root, 'tool chain', 'bin')));
  }
});

it('WASM 빌드는 지정 target을 사용하고 최적화→패치→내장 순서를 보존한다', () => {
  const f = fixture('build-rag-wasm');
  const wasmOpt = f.put('node_modules/binaryen/bin/wasm-opt', 'synthetic');
  const result = f.execute({ CARGO_TARGET_DIR: 'relative target' });
  assert.equal(result.status, 0, result.stderr);
  const { calls } = result;
  const bindgen = join(f.root, '.local/cache/bindgen');
  const out = join(f.root, '.local/generated/rag-wasm');
  assert.deepEqual(calls.slice(2).map(({ args }) => args), [
    ['run', '1.96.0', 'cargo', 'build', '-p', 'superpower-rag-wasm', '--target', 'wasm32-unknown-unknown', '--release', '--frozen'],
    ['--target', 'web', '--out-dir', bindgen, '--out-name', 'rag_wasm', join(f.root, 'relative target/wasm32-unknown-unknown/release/superpower_rag_wasm.wasm')],
    [wasmOpt, '-Oz', join(bindgen, 'rag_wasm_bg.wasm'), '-o', join(bindgen, 'rag_wasm_bg.optimized.wasm')],
    ['scripts/patch-rag-wasm-dts.mjs', join(out, 'rag_wasm.d.ts')],
    ['scripts/patch-rag-wasm-glue.mjs', join(out, 'rag_wasm.js')],
    ['scripts/embed-rag-wasm.mjs', join(bindgen, 'rag_wasm_bg.wasm'), '.local/generated/rag-wasm-bytes.ts'],
  ]);
  assert.equal(calls[4].command, process.execPath);
  assert.equal(readFileSync(join(bindgen, 'rag_wasm_bg.wasm'), 'utf8'), 'optimized');
});

it('WASM 빌드는 설치된 wasm-opt가 없으면 설치하지 않고 실패한다', () => {
  const result = fixture('build-rag-wasm').execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wasm-opt/u);
  assert.equal(result.calls.some(({ args }) => args.includes('install') || args.includes('-Oz')), false);
});

it('보안 검사는 버전 불일치에서 중단하고, 별도 실행에서 원래 검사 및 스냅샷 정리를 보존한다', () => {
  const f = fixture('check-rust-security');
  f.put('rust-toolchain.toml', '[toolchain]\nchannel = "1.95.0"\n');
  const mismatch = f.execute();
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /1\.95\.0/u);
  assert.deepEqual(mismatch.calls, []);

  f.put('rust-toolchain.toml', '[toolchain]\nchannel = "1.96.0"\n');
  f.put('.local/generated/rag-wasm/rag_wasm.js', 'original');
  const result = f.execute({ FIXTURE_DRIFT: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /out of date/u);
  // Homebrew 경로가 있는 호스트에서도 준비는 위 합성 실행기에만 기록됩니다.
  const prepare = result.calls.filter(({ args }) => ['toolchain', 'component', 'target'].includes(args[0]));
  const [probe, ...checks] = result.calls.slice(prepare.length);
  assert.equal(probe.command, prepare.length ? prepare[0].command : 'rustup');
  assert.deepEqual(probe.args, ['run', '1.96.0', 'rustc', '-vV']);
  if (prepare.length) {
    assert.deepEqual(prepare.map(({ args }) => args), [
      ['toolchain', 'install', '1.96.0', '--profile', 'minimal'],
      ['component', 'add', 'clippy', 'rustfmt', '--toolchain', '1.96.0'],
      ['target', 'add', 'wasm32-unknown-unknown', '--toolchain', '1.96.0'],
    ]);
  }
  assert.deepEqual(checks.filter((call) => !prepare.includes(call)).map(({ args }) => args), [
    ['run', '1.96.0', 'cargo', 'fmt', '--all', '--check'],
    ['run', '1.96.0', 'cargo', 'clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings'],
    ['run', '1.96.0', 'cargo', 'test', '--workspace'],
    ['run', '1.96.0', 'cargo', 'build', '--workspace', '--target', 'wasm32-unknown-unknown'],
    ['deny', '--workspace', '--locked', 'check'], ['audit', '-D', 'warnings'], ['vet', '--locked'],
    ['geiger', '--manifest-path', join(f.root, 'crates/rag-wasm/Cargo.toml'), '--all-features', '--all-targets', '--locked', '--forbid-only', '--output-format', 'Ratio'],
    ['audit', '--audit-level=critical'], ['scripts/build-rag-wasm.mjs'],
  ]);
  assert.deepEqual(readdirSync(join(f.root, '.local/cache')), []);
  const failedBuild = f.execute({ FIXTURE_FAIL: 'scripts/build-rag-wasm.mjs' });
  assert.equal(failedBuild.status, 37, failedBuild.stderr);
  assert.deepEqual(readdirSync(join(f.root, '.local/cache')), []);
});

it('설치 명령은 합성 실행기에서만 재시도·버전·추가 기능 인자를 검증한다', () => {
  const f = fixture('install-rust-security-tools');
  const entry = f.put('scripts/install-fixture.mjs', `
    import { installRustSecurityTools } from './install-rust-security-tools.mjs';
    let attempts = 0;
    process.exitCode = await installRustSecurityTools((command, args) => {
      console.log(JSON.stringify([command, ...args]));
      return args[1] === 'wasm-bindgen-cli' && ++attempts < 3 ? 42 : 0;
    }, (milliseconds) => console.log('delay:' + milliseconds));
  `);
  const result = f.execute({}, entry);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split(/\r?\n/u);
  assert.deepEqual(lines.filter((line) => line.startsWith('delay:')), ['delay:10000', 'delay:20000']);
  const installations = lines.filter((line) => line.startsWith('["cargo","install"')).map((line) => JSON.parse(line).slice(2));
  const bindgen = ['wasm-bindgen-cli', '--version', '0.2.123', '--locked', '--force'];
  assert.deepEqual(installations, [bindgen, bindgen, bindgen,
    ['cargo-deny', '--version', '0.19.8', '--locked', '--force'],
    ['cargo-audit', '--version', '0.22.2', '--locked', '--force'],
    ['cargo-geiger', '--version', '0.13.0', '--locked', '--force', '--features', 'vendored-openssl'],
    ['cargo-vet', '--version', '0.10.2', '--locked', '--force'],
  ]);
});

it('Ternlight 누락·checksum 불일치는 설치 출력에 쓰지 않는다', () => {
  const f = fixture('copy-ternlight-assets');
  const missing = f.execute();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /asset is missing/u);
  f.put('node_modules/@ternlight/base/pkg-node/tern_engine_bg.wasm', 'synthetic');
  const invalid = f.execute();
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /checksum mismatch: [0-9a-f]{64}/u);
  assert.equal(existsSync(join(f.root, '.local')), false);
});
