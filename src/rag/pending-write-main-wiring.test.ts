import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');

describe('startup 저장소 유지보수 배선', () => {
  it('중단된 쓰기 원장을 먼저 복구한 뒤 저장소 유지보수를 실행한다', () => {
    const recovery = mainSource.indexOf('listPendingWriteRecovery()');
    const maintenance = mainSource.indexOf('runRagStorageMaintenance(');

    expect(recovery).toBeGreaterThan(-1);
    expect(maintenance).toBeGreaterThan(-1);
    expect(recovery).toBeLessThan(maintenance);
    expect(mainSource).toContain("scheduler.scheduleFile(file, 'auto')");
    expect(mainSource).toContain('indexer.removeFile(path)');
  });

  it('VaultIndexer에 Obsidian metadataCache를 넘겨 제목·태그·헤딩 필드를 만든다', () => {
    expect(mainSource).toContain('this.app.metadataCache,');
  });
});
