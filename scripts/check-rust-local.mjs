import { createRustRunner } from './rust-process.mjs';
import { scriptMain } from './script-process.mjs';

scriptMain(import.meta.url, () => {
  const rust = createRustRunner({ local: true });
  rust.cargo(['fmt', '--all', '--check']);
  rust.cargo([
    'clippy',
    '--workspace',
    '--all-targets',
    '--all-features',
    '--frozen',
    '--',
    '-D',
    'warnings',
  ]);
  rust.cargo(['test', '--workspace', '--frozen']);
});
