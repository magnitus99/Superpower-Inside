import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(__dirname, '../..');

describe('Ternlight renderer boundary', () => {
  it('keeps WASM initialization and synchronous inference inside the worker entry', () => {
    const runtime = readSource('src/llm/ternlight-runtime.ts');
    const worker = readSource('src/llm/ternlight-worker-entry.ts');

    expect(runtime).not.toContain('tern_engine_bg.js');
    expect(runtime).not.toContain('WebAssembly.instantiate');
    expect(runtime).toContain('new Worker(workerUrl)');
    expect(worker).toContain('tern_engine_bg.js');
    expect(worker).toContain('new WebAssembly.Instance');
    expect(worker).toContain('texts.map((text) => ternlightGlue.embed(text))');
  });

  it('keeps Ternlight cache memory-only and gates retired storage cleanup behind health checks', () => {
    const main = readSource('main.ts');
    const maintenance = readSource('src/rag/storage-maintenance.ts');

    expect(main).toContain("persistent: profile.strategy !== 'ternlight'");
    expect(main).toContain('runRagStorageMaintenance');
    expect(maintenance.indexOf('inspectHealth(host, expectedFingerprint, true)')).toBeLessThan(
      maintenance.indexOf('const cleanup = await host.cleanupStaleGenerationBatch()'),
    );
    expect(main).toContain('deleteRagIndexedDbGenerations');
  });
});

function readSource(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}
