import { accessSync, constants, copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { bindgenVersion, cargoPrefix, prependCargoBin, rustTarget } from './rust-tool-versions.mjs';
import { capture, root, run } from './script-process.mjs';

prependCargoBin();
process.env.RUSTUP_AUTO_INSTALL = '0';
const brewRustup = '/opt/homebrew/opt/rustup/bin/rustup';
function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

const rustup = process.platform !== 'win32' && executable(brewRustup) ? brewRustup : 'rustup';
const wasmOpt = join(root, 'node_modules/binaryen/bin/wasm-opt');
if (!statSync(wasmOpt, { throwIfNoEntry: false })?.isFile()) {
  console.error('ERROR: wasm-opt를 찾을 수 없습니다. npm install로 개발 의존성을 설치하세요.');
  process.exit(1);
}
const bindgen = 'wasm-bindgen';
const installedBindgen = capture(bindgen, ['--version']).trim();
if (installedBindgen !== `wasm-bindgen ${bindgenVersion}`) {
  console.error(`ERROR: wasm-bindgen ${bindgenVersion}이 필요합니다 (현재: ${installedBindgen}).`);
  process.exit(1);
}

const outDir = join(root, ARTIFACT_PATHS.generated, 'rag-wasm');
const bindgenDir = join(root, ARTIFACT_PATHS.bindgen);
const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || ARTIFACT_PATHS.rust);
process.env.CARGO_TARGET_DIR = targetDir;
const wasmInput = join(targetDir, rustTarget, 'release', 'superpower_rag_wasm.wasm');
run(rustup, [...cargoPrefix, 'build', '-p', 'superpower-rag-wasm', '--target', rustTarget, '--release', '--frozen']);

rmSync(bindgenDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
run(bindgen, ['--target', 'web', '--out-dir', bindgenDir, '--out-name', 'rag_wasm', wasmInput]);

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
