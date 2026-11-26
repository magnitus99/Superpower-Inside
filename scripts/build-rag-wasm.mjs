import { accessSync, constants, copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { capture, hasCommand, root, run } from './script-process.mjs';

const toolchain = '1.96.0';
const home = homedir();
const cargoHomeBin = join(home, '.cargo', 'bin');
const initialPath = process.env.PATH ?? '';
process.env.PATH = `${cargoHomeBin}${delimiter}${initialPath}`;
const brewPrefix = '/opt/homebrew/opt/rustup/bin';
const exe = process.platform === 'win32' ? '.exe' : '';
const brewRustup = join(brewPrefix, 'rustup');
const brewCargo = join(brewPrefix, 'cargo');
function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

const brewRustupAvailable = process.platform !== 'win32' && executable(brewRustup);
const rustup = brewRustupAvailable ? brewRustup : 'rustup';
const cargo = process.platform !== 'win32' && executable(brewCargo) ? brewCargo : 'cargo';
const hasRustup = brewRustupAvailable || hasCommand(rustup);

// 설치된 도구만 사용합니다. rustup proxy가 기본 도구를 준비하기 전에 고정 버전을 확인합니다.
if (hasRustup) {
  run(rustup, ['run', toolchain, 'rustc', '--version'], { stdio: ['inherit', 'ignore', 'inherit'] });
}
const version = hasRustup ? capture(rustup, ['run', toolchain, 'rustc', '-vV']) : capture('rustc', ['-vV']);
const host = version.match(/^host: (.+)$/mu)?.[1]?.trim() ?? '';
const toolchainBin = join(home, '.rustup', 'toolchains', `${toolchain}-${host}`, 'bin');
if (statSync(toolchainBin, { throwIfNoEntry: false })?.isDirectory()) {
  process.env.PATH = [cargoHomeBin, toolchainBin, initialPath].join(delimiter);
  process.env.RUSTC = join(toolchainBin, `rustc${exe}`);
  process.env.RUSTDOC = join(toolchainBin, `rustdoc${exe}`);
}

const outDir = join(root, ARTIFACT_PATHS.generated, 'rag-wasm');
const bindgenDir = join(root, ARTIFACT_PATHS.bindgen);
const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || ARTIFACT_PATHS.rust);
process.env.CARGO_TARGET_DIR = targetDir;
const wasmInput = join(targetDir, 'wasm32-unknown-unknown/release/superpower_rag_wasm.wasm');
const cargoPrefix = hasRustup ? ['run', toolchain, 'cargo'] : [];
run(hasRustup ? rustup : cargo, [...cargoPrefix, 'build', '-p', 'superpower-rag-wasm', '--target', 'wasm32-unknown-unknown', '--release', '--frozen']);

rmSync(bindgenDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const homeBindgen = join(cargoHomeBin, `wasm-bindgen${exe}`);
const bindgen = executable(homeBindgen) ? homeBindgen : 'wasm-bindgen';
run(bindgen, ['--target', 'web', '--out-dir', bindgenDir, '--out-name', 'rag_wasm', wasmInput]);

const wasmOpt = join(root, 'node_modules/binaryen/bin/wasm-opt');
if (!statSync(wasmOpt, { throwIfNoEntry: false })?.isFile()) {
  console.error('ERROR: wasm-opt를 찾을 수 없습니다. npm install로 개발 의존성을 설치하세요.');
  process.exit(1);
}

const wasm = join(bindgenDir, 'rag_wasm_bg.wasm');
const optimizedWasm = join(bindgenDir, 'rag_wasm_bg.optimized.wasm');
run(process.execPath, [wasmOpt, '-Oz', wasm, '-o', optimizedWasm]);
renameSync(optimizedWasm, wasm);

const glue = join(outDir, 'rag_wasm.js');
const declarations = join(outDir, 'rag_wasm.d.ts');
copyFileSync(join(bindgenDir, 'rag_wasm.js'), glue);
copyFileSync(join(bindgenDir, 'rag_wasm.d.ts'), declarations);
run(process.execPath, ['scripts/patch-rag-wasm-dts.mjs', declarations]);
run(process.execPath, ['scripts/patch-rag-wasm-glue.mjs', glue]);
run(process.execPath, ['scripts/embed-rag-wasm.mjs', wasm, `${ARTIFACT_PATHS.generated}/rag-wasm-bytes.ts`]);
