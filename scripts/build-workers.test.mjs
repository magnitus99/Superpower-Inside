import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('작업 디렉터리와 무관하게 세 worker를 독립된 번들과 기존 상수명으로 생성한다', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = mkdtempSync(join(tmpdir(), 'superpower-workers-'));
  const workers = [
    ['rag/bm25', 'bm25', 'BM25'],
    ['rag/vector-search', 'vector-search', 'VECTOR_SEARCH'],
    ['llm/ternlight', 'ternlight', 'TERNLIGHT'],
  ];
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(join(repo, 'scripts/build-workers.mjs'), join(root, 'scripts/build-workers.mjs'));
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
    for (const [entry, , constant] of workers) {
      const path = join(root, `src/${entry}-worker-entry.ts`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `globalThis.workerKind = ${JSON.stringify(constant)};`);
    }
    execFileSync(process.execPath, [join(root, 'scripts/build-workers.mjs')], { cwd: tmpdir() });
    for (const [, output, constant] of workers) {
      const source = readFileSync(join(root, `generated/${output}-worker-source.ts`), 'utf8');
      const encoded = source.match(/export const \w+ = (.+);/u)?.[1];
      expect(source).toContain(`export const ${constant}_WORKER_SOURCE = `);
      expect(encoded).toBeDefined();
      expect(JSON.parse(encoded)).toContain(`workerKind="${constant}"`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
