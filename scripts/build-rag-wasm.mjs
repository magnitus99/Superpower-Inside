import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { repoRoot, runCommand, scriptMain } from './script-process.mjs';
import { createRustRunner } from './rust-process.mjs';

export function buildRagWasm(rust = createRustRunner()) {
  rust.prepare();
  rust.cargo([
    'build',
    '-p',
    'superpower-rag-wasm',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
  ]);
  const bindgenDir = join(repoRoot, 'target/rag-wasm-bindgen');
  const outDir = join(repoRoot, 'generated/rag-wasm');
  rmSync(bindgenDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  rust.run('wasm-bindgen', [
    '--target',
    'web',
    '--out-dir',
    rust.pathForRust(bindgenDir),
    '--out-name',
    'rag_wasm',
    rust.pathForRust(
      join(rust.targetDir, 'wasm32-unknown-unknown/release/superpower_rag_wasm.wasm'),
    ),
  ]);
  const wasm = join(bindgenDir, 'rag_wasm_bg.wasm');
  const optimized = join(bindgenDir, 'rag_wasm_bg.optimized.wasm');
  const require = createRequire(import.meta.url);
  runCommand(
    process.execPath,
    [require.resolve('binaryen/bin/wasm-opt'), '-Oz', wasm, '-o', optimized],
    { cwd: repoRoot },
  );
  renameSync(optimized, wasm);
  for (const file of ['rag_wasm.js', 'rag_wasm.d.ts'])
    copyFileSync(join(bindgenDir, file), join(outDir, file));
  for (const [script, args] of [
    ['patch-rag-wasm-dts.mjs', [join(outDir, 'rag_wasm.d.ts')]],
    ['patch-rag-wasm-glue.mjs', [join(outDir, 'rag_wasm.js')]],
    ['embed-rag-wasm.mjs', [wasm, join(repoRoot, 'src/rag/rag-wasm-bytes.ts')]],
  ])
    runCommand(process.execPath, [join(repoRoot, 'scripts', script), ...args], { cwd: repoRoot });
}

scriptMain(import.meta.url, () => buildRagWasm());
