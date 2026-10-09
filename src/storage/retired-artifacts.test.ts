import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  RetiredArtifactService,
  createRetiredArtifactHost,
  measureDatabasePayload,
  type RetiredArtifactHost,
  type ArtifactRecord,
} from './retired-artifacts';
import type { DataAdapter } from 'obsidian';

function fixture() {
  const files = new Map([['.superpower-inside/vectors.json', { bytes: 100, modified: 1.25 }]]);
  const context = {
    pluginId: 'superpower-inside',
    vaultPrefixes: ['superpower-inside:rag-v2:vault:'],
    legacyNames: ['superpower-inside:vault:KnowledgeGraph'],
    activeNames: [] as string[],
    legacyFilesSafe: true,
    revision: 1,
  };
  const host: RetiredArtifactHost = {
    context: () => Promise.resolve(context),
    listFiles: () =>
      Promise.resolve([...files].map(([id, record]) => ({ kind: 'file', id, ...record }))),
    listDatabaseNames: () =>
      Promise.resolve(['superpower-inside:vault:KnowledgeGraph', 'unrelated']),
    measureDatabase: vi.fn(() => Promise.resolve(200)),
    removeFile: vi.fn((record: ArtifactRecord) => {
      files.delete(record.id);
      return Promise.resolve();
    }),
    deleteDatabase: vi.fn(() => Promise.resolve()),
  };
  return { host, context, files, service: new RetiredArtifactService(host) };
}

describe('지원 종료 생성물 정리', () => {
  it('빈 DB도 삭제 선택을 제공하고 조회 실패는 삭제로 이어지지 않는다', async () => {
    const { service, host, files } = fixture();
    files.clear();
    vi.mocked(host.measureDatabase).mockResolvedValueOnce(0);
    expect(await service.scan()).toMatchObject({ hasArtifacts: true, bytes: 0 });
    vi.mocked(host.measureDatabase).mockRejectedValueOnce(new Error('read failed'));
    await expect(service.scan()).rejects.toThrow('read failed');
    expect(host.deleteDatabase).not.toHaveBeenCalled();
  });
  it('조회만으로 삭제하지 않고 폐기 대상으로 판정된 DB만 측정한다', async () => {
    const { service, host } = fixture();
    expect(await service.scan()).toMatchObject({ bytes: 300, capacity: '0.01' });
    expect(host.measureDatabase).toHaveBeenCalledExactlyOnceWith(
      'superpower-inside:vault:KnowledgeGraph',
    );
    expect(host.removeFile).not.toHaveBeenCalled();
    expect(host.deleteDatabase).not.toHaveBeenCalled();
  });

  it('사용자가 본 스냅샷의 대상만 삭제하고 일부 실패는 재시도할 수 있다', async () => {
    const { service, host, files } = fixture();
    const snapshot = await service.scan();
    files.set('.superpower-inside/bm25-index.json', { bytes: 50, modified: 1 });
    vi.mocked(host.deleteDatabase).mockRejectedValueOnce(new Error('blocked'));
    expect(await service.cleanup(snapshot)).toEqual({ failed: 1, changed: false });
    expect(files.has('.superpower-inside/bm25-index.json')).toBe(true);
    expect((await service.scan()).bytes).toBe(250);
  });

  it('조회 이후 수정된 파일과 새로 활성화된 DB는 삭제하지 않는다', async () => {
    const { service, host, files, context } = fixture();
    const snapshot = await service.scan();
    files.set('.superpower-inside/vectors.json', { bytes: 101, modified: 2 });
    context.activeNames = ['superpower-inside:vault:KnowledgeGraph'];
    expect(await service.cleanup(snapshot)).toEqual({ failed: 0, changed: true });
    expect(host.removeFile).not.toHaveBeenCalled();
    expect(host.deleteDatabase).not.toHaveBeenCalled();
  });

  it('초기화 세대가 바뀌거나 발급하지 않은 스냅샷이면 삭제하지 않는다', async () => {
    const { service, context, host } = fixture();
    const snapshot = await service.scan();
    context.revision++;
    expect((await service.cleanup(snapshot)).changed).toBe(true);
    await expect(service.cleanup({ ...snapshot })).rejects.toThrow('snapshot');
    expect(host.removeFile).not.toHaveBeenCalled();
  });
});

describe('IndexedDB 용량과 삭제 I/O', () => {
  async function database(value?: unknown): Promise<IDBDatabase> {
    const request = indexedDB.open(`artifact-measure-${crypto.randomUUID()}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Database open failed'));
    });
    if (value !== undefined) {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put(value, 'key');
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Database write failed'));
      });
    }
    return db;
  }

  it('직렬화한 키·값과 바이너리의 크기를 포함하고 연결을 닫는다', async () => {
    const value = { text: '독립 합성 데이터', binary: new Uint8Array(64) };
    const db = await database(value);
    const name = db.name;
    db.close();
    const expected = new Blob([
      JSON.stringify(['key', { text: value.text, binary: null }]),
      new Uint8Array(64),
    ]).size;
    expect(await measureDatabasePayload(name)).toBe(expected);
    const host = createRetiredArtifactHost({} as DataAdapter, () =>
      Promise.resolve(fixture().context),
    );
    await host.deleteDatabase(name);
    expect((await indexedDB.databases()).some((item) => item.name === name)).toBe(false);
  });

  it('직렬화할 수 없는 값과 사라진 DB는 실패하고 DB를 새로 만들지 않는다', async () => {
    const db = await database({ value: 1n });
    const name = db.name;
    db.close();
    await expect(measureDatabasePayload(name)).rejects.toThrow('aborted');
    const missing = `missing-${crypto.randomUUID()}`;
    await expect(measureDatabasePayload(missing)).rejects.toThrow('inspection failed');
    expect((await indexedDB.databases()).some((item) => item.name === missing)).toBe(false);
    const host = createRetiredArtifactHost({} as DataAdapter, () =>
      Promise.resolve(fixture().context),
    );
    await host.deleteDatabase(name);
  });

  it('다른 연결이 삭제를 막으면 실제 삭제가 끝날 때까지 완료로 보고하지 않는다', async () => {
    const db = await database();
    const host = createRetiredArtifactHost({} as DataAdapter, () =>
      Promise.resolve(fixture().context),
    );
    let completed = false;
    const deleting = host.deleteDatabase(db.name).then(() => {
      completed = true;
    });
    await new Promise<void>((resolve) => {
      db.onversionchange = () => resolve();
    });
    expect(completed).toBe(false);
    db.close();
    await deleting;
    expect(completed).toBe(true);
  });
});
