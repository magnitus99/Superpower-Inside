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

  it('Ternlight 캐시는 메모리에만 두고 지원 종료 저장소의 자동 삭제는 실행하지 않는다', () => {
    const main = readSource('main.ts');
    const maintenance = readSource('src/rag/storage-maintenance.ts');

    expect(main).toContain("persistent: profile.strategy !== 'ternlight'");
    expect(main).toContain('runRagStorageMaintenance');
    expect(maintenance).toContain('inspectHealth(host, expectedFingerprint, true)');
    expect(maintenance).not.toContain('cleanupStaleGenerationBatch');
    expect(maintenance).not.toContain('cleanupInactiveVaultDatabaseBatch');
    expect(maintenance).not.toContain('cleanupLegacyFileArtifacts');
    expect(main).toContain('deleteRagIndexedDbGenerations');
  });
});

function readSource(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}
