import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { cargoPrefix, prependCargoBin, rustTarget, rustToolchain, rustVersion } from './rust-tool-versions.mjs';
import { hasCommand, npm, root, run } from './script-process.mjs';

prependCargoBin();
const toolchainFile = join(root, 'rust-toolchain.toml');
const fileToolchain = existsSync(toolchainFile)
  ? readFileSync(toolchainFile, 'utf8').match(/^\s*channel\s*=\s*"(.*)"/mu)?.[1]?.trim()
  : undefined;
if (fileToolchain !== rustVersion) {
  console.error(`ERROR: rust-toolchain.toml is '${fileToolchain}'. This project requires '${rustVersion}'.`);
  process.exit(1);
}

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return lstatSync(file).isFile() || lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

const win = process.platform === 'win32';
const brewRustup = '/opt/homebrew/opt/rustup/bin/rustup';
const canPrepareToolchain = !win && executable(brewRustup);
const rustup = canPrepareToolchain ? brewRustup : 'rustup';
const npmCli = process.env.npm_execpath;
const hasWindowsNpm = win && (
  existsSync(join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')) ||
  (process.env.PATH ?? '').split(delimiter).some((dir) => {
    if (!dir) return false;
    const script = join(dir.replace(/^"|"$/gu, ''), 'npm');
    const stat = statSync(script, { throwIfNoEntry: false });
    return stat?.isFile() && stat.size <= 65536 && /^#![^\r\n]*\bnode(?:\.exe)?(?:\s|$)/u.test(readFileSync(script, 'utf8'));
  })
);
if (!(npmCli && existsSync(npmCli)) && !hasCommand('npm') && !hasWindowsNpm) {
  console.error('ERROR: npm 명령을 찾을 수 없습니다. Node.js가 설치되어 있는지 확인하세요.');
  process.exit(1);
}

// 기존 명시적 Homebrew 준비 경로만 유지합니다. PATH의 rustup으로 설치를 확대하지 않습니다.
if (canPrepareToolchain) {
  run(rustup, ['toolchain', 'install', rustToolchain, '--profile', 'minimal']);
  run(rustup, ['component', 'add', 'clippy', 'rustfmt', '--toolchain', rustToolchain]);
  run(rustup, ['target', 'add', rustTarget, '--toolchain', rustToolchain]);
}
process.env.CARGO_TARGET_DIR = join(root, ARTIFACT_PATHS.rust, `rustup-${rustVersion}`);

for (const tool of ['wasm-bindgen', 'cargo-deny', 'cargo-audit', 'cargo-geiger', 'cargo-vet']) {
  if (!hasCommand(tool)) {
    console.error(`ERROR: ${tool} 명령을 찾을 수 없습니다. brew 또는 cargo로 먼저 설치해야 합니다.`);
    process.exit(1);
  }
}

for (const [label, args] of [
  ['rustfmt', ['fmt', '--all', '--check']],
  ['clippy', ['clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']],
  ['unit tests', ['test', '--workspace']],
  ['wasm target build', ['build', '--workspace', '--target', rustTarget]],
]) {
  console.log(`==> ${label}`);
  run(rustup, [...cargoPrefix, ...args]);
}

for (const args of [
  ['deny', '--workspace', '--locked', 'check'],
  ['audit', '-D', 'warnings'],
  ['vet', '--locked'],
  ['geiger', '--manifest-path', join(root, 'crates/rag-wasm/Cargo.toml'), '--all-features', '--all-targets', '--locked', '--forbid-only', '--output-format', 'Ratio'],
]) {
  console.log(`==> cargo-${args[0]}`);
  run(rustup, [...cargoPrefix, ...args]);
}
console.log('==> npm audit (critical)');
npm(['audit', '--audit-level=critical']);

// 플랫폼별 diff 바이너리 없이 기존 glue 디렉터리의 파일·내용을 대조합니다.
function* differences(before, after, path) {
  const a = lstatSync(before, { throwIfNoEntry: false });
  const b = lstatSync(after, { throwIfNoEntry: false });
  if (!a || !b || a.isDirectory() !== b.isDirectory() || a.isSymbolicLink() !== b.isSymbolicLink()) {
    yield path;
  } else if (a.isDirectory()) {
    const names = new Set([...readdirSync(before), ...readdirSync(after)]);
    for (const name of [...names].sort()) {
      yield* differences(join(before, name), join(after, name), `${path}/${name}`);
    }
  } else if (a.isSymbolicLink() ? readlinkSync(before) !== readlinkSync(after) :
    !a.isFile() || !b.isFile() || !readFileSync(before).equals(readFileSync(after))) {
    yield path;
  }
}

const cache = dirname(join(root, ARTIFACT_PATHS.rust));
mkdirSync(cache, { recursive: true });
const snapshot = mkdtempSync(join(cache, 'wasm-snapshot.'));
const cleanup = () => rmSync(snapshot, { recursive: true, force: true });
// run()은 자식 실패 시 즉시 종료하므로 exit에서도 이번 스냅샷만 정리합니다.
process.once('exit', cleanup);
try {
  const generated = `${ARTIFACT_PATHS.generated}/rag-wasm`;
  const before = join(snapshot, generated);
  const after = join(root, generated);
  mkdirSync(dirname(before), { recursive: true });
  if (existsSync(after)) cpSync(after, before, { recursive: true, verbatimSymlinks: true });

  console.log('==> wasm bindings');
  run(process.execPath, ['scripts/build-rag-wasm.mjs']);
  let count = 0;
  for (const file of differences(before, after, generated)) {
    console.log(`Different bindings: ${file}`);
    if (++count === 240) break;
  }
  if (count) {
    console.error('ERROR: Rust/WASM generated bindings are out of date. Run npm run wasm:build and commit .local/generated/rag-wasm.');
    process.exitCode = 1;
  }
} finally {
  cleanup();
  process.removeListener('exit', cleanup);
}
