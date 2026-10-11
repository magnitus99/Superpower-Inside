import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, runCommand, scriptMain } from './script-process.mjs';
import { createRustRunner } from './rust-process.mjs';
import { buildRagWasm } from './build-rag-wasm.mjs';

export function snapshotDirectory(root) {
  const snapshot = {};
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    snapshot[entry.name] = entry.isDirectory()
      ? snapshotDirectory(join(root, entry.name))
      : readFileSync(join(root, entry.name)).toString('base64');
  }
  return snapshot;
}

scriptMain(import.meta.url, () => {
  const rust = createRustRunner({ security: true });
  rust.prepare();
  for (const tool of ['wasm-bindgen', 'cargo-deny', 'cargo-audit', 'cargo-geiger', 'cargo-vet'])
    rust.run(tool, ['--version']);
  rust.cargo(['fmt', '--all', '--check']);
  rust.cargo(['clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']);
  rust.cargo(['test', '--workspace']);
  rust.cargo(['build', '--workspace', '--target', 'wasm32-unknown-unknown']);
  rust.cargo(['deny', '--workspace', '--locked', 'check']);
  rust.cargo(['audit', '-D', 'warnings']);
  rust.cargo(['vet', '--locked']);
  rust.cargo([
    'geiger',
    '--manifest-path',
    rust.pathForRust(join(repoRoot, 'crates/rag-wasm/Cargo.toml')),
    '--all-features',
    '--all-targets',
    '--locked',
    '--forbid-only',
    '--output-format',
    'Ratio',
  ]);
  runCommand('npm', ['audit', '--audit-level=critical'], { cwd: repoRoot });
  const generated = join(repoRoot, 'generated/rag-wasm');
  const before = snapshotDirectory(generated);
  buildRagWasm(rust);
  if (JSON.stringify(before) !== JSON.stringify(snapshotDirectory(generated))) {
    throw new Error(
      'Rust/WASM 생성 바인딩이 최신 상태가 아닙니다. npm run wasm:build 후 생성 파일을 커밋하세요.',
    );
  }
});
