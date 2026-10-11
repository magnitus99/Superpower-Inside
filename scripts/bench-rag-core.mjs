import { createRustRunner } from './rust-process.mjs';
import { scriptMain } from './script-process.mjs';

scriptMain(import.meta.url, () =>
  createRustRunner().cargo([
    'test',
    '--release',
    '--workspace',
    'bench_rag_core_runtime_medians',
    '--',
    '--ignored',
    '--nocapture',
  ]),
);
