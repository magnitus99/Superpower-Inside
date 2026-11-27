import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const scripts = dirname(fileURLToPath(import.meta.url));
const context = resolve(scripts, '../.thinkrail/context/_rust-scripts');
const msvcArch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[process.arch];
const toolchain = process.platform === 'win32' && msvcArch ? `1.100.0-${msvcArch}-pc-windows-msvc` : '1.100.0';
const cargoPrefix = ['run', toolchain, 'cargo'];

it('Rust 및 bindgen 버전을 워크스페이스·CLI·CI에서 일치시킨다', async () => {
  const { rustVersion, bindgenVersion, rustTarget } = await import('./rust-tool-versions.mjs');
  const read = (path) => readFileSync(resolve(scripts, '..', path), 'utf8');
  assert.ok(read('rust-toolchain.toml').includes(`channel = "${rustVersion}"`));
  assert.ok(read('rust-toolchain.toml').includes(`targets = ["${rustTarget}"]`));
  assert.ok(read('Cargo.toml').includes(`rust-version = "${rustVersion.replace(/\.0$/u, '')}"`));
  assert.ok(read('crates/rag-wasm/Cargo.toml').includes(`wasm-bindgen = "=${bindgenVersion}"`));
  const workflow = read('.github/workflows/quality.yml');
  assert.ok(workflow.includes(`dtolnay/rust-toolchain@${rustVersion}`));
  assert.ok(workflow.includes(`.local/cache/rust/rustup-${rustVersion}`));
  assert.ok(workflow.includes(`wasm-bindgen-cli@${bindgenVersion}`));
  assert.ok(workflow.includes(`targets: ${rustTarget}`));
});

// 명령은 기록만 하고 후속 단계가 읽는 파일만 합성합니다. Rust 도구는 실행하지 않습니다.
const fakeHelper = String.raw`
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const hasCommand = () => true;
function record(kind, command, args, options) {
  const env = options.env ?? process.env;
  appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ kind, command, args,
    cwd: options.cwd ?? root, target: env.CARGO_TARGET_DIR, offline: env.CARGO_NET_OFFLINE,
    toolchain: env.RUSTUP_TOOLCHAIN, path: env.PATH }) + '\n');
  if (process.env.FIXTURE_FAIL && args.includes(process.env.FIXTURE_FAIL)) process.exit(37);
}
export function capture(command, args, options = {}) {
  record('capture', command, args, options);
  return args.includes('which') ? join(root, 'tool chain', 'bin', 'cargo') + '\n' :
    (process.env.FIXTURE_BINDGEN_VERSION ?? 'wasm-bindgen 0.2.130') + '\n';
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

function fixture(name, { useRealProcessHelper = false } = {}) {
  mkdirSync(context, { recursive: true });
  const root = mkdtempSync(join(context, 'synthetic repo #'));
  const script = join(root, 'scripts', `${name}.mjs`);
  mkdirSync(dirname(script));
  const files = [`${name}.mjs`, 'artifact-paths.mjs', 'rust-tool-versions.mjs'];
  if (useRealProcessHelper) files.push('script-process.mjs', 'run-node-tool.mjs');
  for (const file of files) {
    copyFileSync(join(scripts, file), join(dirname(script), file));
  }
  if (!useRealProcessHelper) writeFileSync(join(dirname(script), 'script-process.mjs'), fakeHelper);
  function put(file, contents, options) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, options);
    return path;
  }
  function execute(env = {}, entry = script) {
    const result = spawnSync(process.execPath, [entry], {
      cwd: context,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, HOME: root, USERPROFILE: root, CARGO_HOME: '', CARGO_TARGET_DIR: '',
        CARGO_NET_OFFLINE: '', RUSTUP_TOOLCHAIN: '', ...env },
    });
    const log = join(root, 'calls.jsonl');
    const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
    return { ...result, calls };
  }
  return { root, put, execute };
}

it('수동 벤치는 고정 도구로 오프라인 실행하고 종료 상태를 보존한다', () => {
  const f = fixture('bench-rag-core');
  const result = f.execute({ FIXTURE_FAIL: '--ignored' });
  assert.equal(result.status, 37, result.stderr);
  assert.match(result.stdout, /median ns/u);
  assert.deepEqual(result.calls.map(({ command, args }) => [command, args]), [
    ['rustup', [...cargoPrefix, 'test', '--release', '--workspace', '--frozen', 'bench_rag_core_runtime_medians', '--', '--ignored', '--nocapture']],
  ]);
  assert.equal(result.calls[0].target, join(f.root, '.local/cache/rust'));
});

it('로컬 Rust 검사는 고정 도구·오프라인 플래그를 적용하고 첫 실패에서 멈춘다', () => {
  const f = fixture('check-rust-local');
  const result = f.execute({ FIXTURE_FAIL: 'clippy' });
  assert.equal(result.status, 37, result.stderr);
  assert.deepEqual(result.calls.map(({ args }) => args), [
    ['which', '--toolchain', toolchain, 'cargo'],
    [...cargoPrefix, 'fmt', '--all', '--check'],
    [...cargoPrefix, 'clippy', '--workspace', '--all-targets', '--all-features', '--frozen', '--', '-D', 'warnings'],
  ]);
  for (const call of result.calls.slice(1)) {
    assert.equal(resolve(call.cwd), context);
    assert.equal(call.offline, 'true');
    assert.equal(call.target, join(context, '.local/cache/rust/rustup-1.100.0'));
    assert.equal(call.toolchain, toolchain);
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
  assert.deepEqual(calls.map(({ args }) => args), [
    ['--version'],
    [...cargoPrefix, 'build', '-p', 'superpower-rag-wasm', '--target', 'wasm32-unknown-unknown', '--release', '--frozen'],
    ['--target', 'web', '--out-dir', bindgen, '--out-name', 'rag_wasm', join(f.root, 'relative target/wasm32-unknown-unknown/release/superpower_rag_wasm.wasm')],
    [wasmOpt, '-Oz', join(bindgen, 'rag_wasm_bg.wasm'), '-o', join(bindgen, 'rag_wasm_bg.optimized.wasm')],
    ['scripts/patch-rag-wasm-dts.mjs', join(out, 'rag_wasm.d.ts')],
    ['scripts/patch-rag-wasm-glue.mjs', join(out, 'rag_wasm.js')],
    ['scripts/embed-rag-wasm.mjs', join(bindgen, 'rag_wasm_bg.wasm'), '.local/generated/rag-wasm-bytes.ts'],
  ]);
  assert.equal(calls[3].command, process.execPath);
  assert.equal(readFileSync(join(bindgen, 'rag_wasm_bg.wasm'), 'utf8'), 'optimized');
});

it('WASM 빌드는 설치된 wasm-opt가 없으면 설치하지 않고 실패한다', () => {
  const result = fixture('build-rag-wasm').execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wasm-opt/u);
  assert.equal(result.calls.some(({ args }) => args.includes('install') || args.includes('-Oz')), false);
});

it('WASM 빌드는 bindgen 버전이 다르면 컴파일과 생성물 쓰기 전에 중단한다', () => {
  const f = fixture('build-rag-wasm');
  f.put('node_modules/binaryen/bin/wasm-opt', 'synthetic');
  const existing = f.put('.local/generated/rag-wasm/rag_wasm.js', 'original');
  const result = f.execute({ FIXTURE_BINDGEN_VERSION: 'wasm-bindgen 0.2.123' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wasm-bindgen 0\.2\.130/u);
  assert.deepEqual(result.calls.map(({ command, args }) => [command, args]), [['wasm-bindgen', ['--version']]]);
  assert.equal(readFileSync(existing, 'utf8'), 'original');
});

it('보안 검사는 버전 불일치에서 중단하고, 별도 실행에서 원래 검사 및 스냅샷 정리를 보존한다', () => {
  const f = fixture('check-rust-security');
  f.put('rust-toolchain.toml', '[toolchain]\nchannel = "1.95.0"\n');
  const mismatch = f.execute();
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /1\.95\.0/u);
  assert.deepEqual(mismatch.calls, []);

  f.put('rust-toolchain.toml', '[toolchain]\nchannel = "1.100.0"\n');
  f.put('.local/generated/rag-wasm/rag_wasm.js', 'original');
  const result = f.execute({ FIXTURE_DRIFT: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /out of date/u);
  // Homebrew 경로가 있는 호스트에서도 준비는 위 합성 실행기에만 기록됩니다.
  const prepare = result.calls.filter(({ args }) => ['toolchain', 'component', 'target'].includes(args[0]));
  const checks = result.calls.slice(prepare.length);
  assert.equal(checks[0].command, prepare.length ? prepare[0].command : 'rustup');
  if (prepare.length) {
    assert.deepEqual(prepare.map(({ args }) => args), [
      ['toolchain', 'install', toolchain, '--profile', 'minimal'],
      ['component', 'add', 'clippy', 'rustfmt', '--toolchain', toolchain],
      ['target', 'add', 'wasm32-unknown-unknown', '--toolchain', toolchain],
    ]);
  }
  assert.deepEqual(checks.map(({ args }) => args), [
    [...cargoPrefix, 'fmt', '--all', '--check'],
    [...cargoPrefix, 'clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings'],
    [...cargoPrefix, 'test', '--workspace'],
    [...cargoPrefix, 'build', '--workspace', '--target', 'wasm32-unknown-unknown'],
    [...cargoPrefix, 'deny', '--workspace', '--locked', 'check'],
    [...cargoPrefix, 'audit', '-D', 'warnings'],
    [...cargoPrefix, 'vet', '--locked'],
    [...cargoPrefix, 'geiger', '--manifest-path', join(f.root, 'crates/rag-wasm/Cargo.toml'), '--all-features', '--all-targets', '--locked', '--forbid-only', '--output-format', 'Ratio'],
    ['audit', '--audit-level=critical'], ['scripts/build-rag-wasm.mjs'],
  ]);
  assert.deepEqual(readdirSync(join(f.root, '.local/cache')), []);
  const failedBuild = f.execute({ FIXTURE_FAIL: 'scripts/build-rag-wasm.mjs' });
  assert.equal(failedBuild.status, 37, failedBuild.stderr);
  assert.deepEqual(readdirSync(join(f.root, '.local/cache')), []);
});

const exe = process.platform === 'win32' ? '.exe' : '';

function runInstaller(scenario) {
  const f = fixture('install-rust-security-tools', { useRealProcessHelper: true });
  const cargoHome = join(f.root, 'cargo home');
  const installed = (binary) => join(cargoHome, 'bin', `${binary}${exe}`);
  // PATH에 같은 이름의 오래된 도구가 있어도 이번 설치의 성공으로 처리하면 안 됩니다.
  f.put(`.local/bin/wasm-bindgen${exe}`, 'stale', { mode: 0o755 });
  const entry = f.put('scripts/install-fixture.mjs', `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { installRustSecurityTools } from './install-rust-security-tools.mjs';
    let attempts = 0;
    const scenario = process.env.FIXTURE_SCENARIO;
    process.exitCode = await installRustSecurityTools((command, args) => {
      console.log(JSON.stringify([command, ...args]));
      if (args.length === 1 && args[0] === '--version') return scenario === 'bad-version' ? 37 : 0;
      const pkg = args[4];
      if (scenario === 'retry' && pkg === 'wasm-bindgen-cli' && ++attempts < 3) return 42;
      const binary = pkg === 'wasm-bindgen-cli' ? 'wasm-bindgen' : pkg;
      const output = join(process.env.CARGO_HOME, 'bin', binary + ${JSON.stringify(exe)});
      if (scenario === 'directory') mkdirSync(output, { recursive: true });
      else if (scenario !== 'missing') {
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, 'synthetic', { mode: 0o755 });
      }
      return 0;
    }, (milliseconds) => console.log('delay:' + milliseconds));
  `);
  const result = f.execute({ CARGO_HOME: cargoHome, CARGO_INSTALL_ROOT: join(f.root, 'other root'), FIXTURE_SCENARIO: scenario }, entry);
  const lines = result.stdout.split(/\r?\n/u);
  const commands = lines.filter((line) => line.startsWith('[')).map((line) => JSON.parse(line));
  const install = (pkg, version, ...flags) => [
    'rustup', ...cargoPrefix, 'install', pkg, '--version', version, '--locked', '--force', '--root', cargoHome, ...flags,
  ];
  return { result, commands, installed, install, delays: lines.filter((line) => line.startsWith('delay:')) };
}

it('설치는 재시도 후 절대 경로로 각 버전을 확인하고 geiger 기능 인자를 그대로 전달한다', () => {
  const { result, commands, installed, install, delays } = runInstaller('retry');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(delays, ['delay:10000', 'delay:20000']);
  const bindgen = install('wasm-bindgen-cli', '0.2.130');
  assert.deepEqual(commands, [bindgen, bindgen, bindgen, [installed('wasm-bindgen'), '--version'],
    install('cargo-deny', '0.19.8'), [installed('cargo-deny'), '--version'],
    install('cargo-audit', '0.22.2'), [installed('cargo-audit'), '--version'],
    install('cargo-geiger', '0.13.0', '--features', 'vendored-openssl'), [installed('cargo-geiger'), '--version'],
    install('cargo-vet', '0.10.2'), [installed('cargo-vet'), '--version'],
  ]);
});

it.each(['missing', 'directory'])('설치 후 실행 파일이 없으면(%s) PATH로 대체하거나 다음 도구를 설치하지 않는다', (scenario) => {
  const { result, commands, install, delays } = runInstaller(scenario);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /wasm-bindgen 실행 파일을 찾을 수 없습니다/u);
  assert.deepEqual(commands, [install('wasm-bindgen-cli', '0.2.130')]);
  assert.deepEqual(delays, []);
});

it('설치 후 버전 검사에 실패하면 해당 종료 코드를 보존하고 다음 도구를 설치하지 않는다', () => {
  const { result, commands, installed, install, delays } = runInstaller('bad-version');
  assert.equal(result.status, 37, result.stderr);
  assert.deepEqual(commands, [install('wasm-bindgen-cli', '0.2.130'), [installed('wasm-bindgen'), '--version']]);
  assert.deepEqual(delays, []);
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
