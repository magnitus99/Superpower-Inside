import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import {
  GeneratedArtifactRegistry,
  GeneratedArtifactDatabase,
  createGeneratedFileAdapter,
} from './generated-artifacts';
import { RetiredArtifactService, createRetiredArtifactHost } from './retired-artifacts';

function fixture() {
  const values = new Map<string, unknown>();
  const storage = {
    loadLocalStorage: (key: string) => values.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const registry = new GeneratedArtifactRegistry(storage, 'fixture-plugin', ['.private-artifacts']);
  const features = [
    {
      id: 'future-feature',
      state: 'supported' as 'supported' | 'retired',
      retiredVersions: [] as number[],
    },
  ];
  const context = () =>
    Promise.resolve({
      pluginId: 'fixture-plugin',
      vaultPrefixes: ['fixture-plugin:unused:'],
      legacyNames: [],
      activeNames: [] as string[],
      legacyFilesSafe: false,
      revision: 1,
      features,
      tracked: registry.read(),
      activeArtifacts: registry.active,
      artifactFileRoots: ['.private-artifacts'],
    });
  return { registry, features, context, values, storage };
}

describe('생성물의 자동 추적과 미래 지원 종료', () => {
  it('기능 구현과 정리 코드를 바꾸지 않고 새 DB를 지원 종료 대상으로 전환한다', async () => {
    const { registry, features, context } = fixture();
    const name = `future-generated-${crypto.randomUUID()}`;
    class FutureDatabase extends GeneratedArtifactDatabase {
      rows!: Dexie.Table<{ id: string; value: string }, string>;
      constructor() {
        super(name, registry.forFeature('future-feature'));
        this.version(1).stores({ rows: 'id' });
      }
    }
    const db = new FutureDatabase();
    await db.rows.put({ id: 'sample', value: '독립 합성 데이터' });
    db.close();
    const service = new RetiredArtifactService(
      createRetiredArtifactHost(
        {
          exists: () => Promise.resolve(false),
        } as unknown as DataAdapter,
        context,
      ),
    );
    expect((await service.scan()).hasArtifacts).toBe(false);
    features[0].state = 'retired';
    const snapshot = await service.scan();
    expect(snapshot.hasArtifacts).toBe(true);
    expect(snapshot.bytes).toBeGreaterThan(0);
    expect(await service.cleanup(snapshot)).toEqual({ failed: 0, changed: false });
    expect((await indexedDB.databases()).some((item) => item.name === name)).toBe(false);
  });

  it('중첩된 새 파일 경로를 추적하며 재시작 후에도 발견하고 현재 기능으로 돌아오면 보호한다', async () => {
    const { registry, features, context, values } = fixture();
    const files = new Map<string, ArrayBuffer>();
    const adapter = {
      exists: (id: string) => Promise.resolve(files.has(id)),
      writeBinary: (id: string, data: ArrayBuffer) => {
        files.set(id, data);
        return Promise.resolve();
      },
      rename: (from: string, to: string) => {
        const data = files.get(from);
        if (data) files.set(to, data);
        files.delete(from);
        return Promise.resolve();
      },
      remove: (id: string) => {
        files.delete(id);
        return Promise.resolve();
      },
      stat: (id: string) =>
        Promise.resolve(
          files.has(id)
            ? { type: 'file', size: files.get(id)?.byteLength ?? 0, mtime: 1.25 }
            : null,
        ),
    };
    const generated = createGeneratedFileAdapter(adapter, registry.forFeature('future-feature'));
    const path = '.private-artifacts/any/nested/new-format.bin';
    await generated.writeBinary(`${path}.tmp`, new ArrayBuffer(123));
    await generated.rename(`${path}.tmp`, path);
    const reopened = new GeneratedArtifactRegistry(
      {
        loadLocalStorage: (key) => values.get(key),
        saveLocalStorage: (key, value) => {
          values.set(key, value);
        },
      },
      'fixture-plugin',
      ['.private-artifacts'],
    );
    expect(reopened.read()).toHaveLength(1);
    const service = new RetiredArtifactService(
      createRetiredArtifactHost(adapter as unknown as DataAdapter, context),
    );
    features[0].state = 'retired';
    const snapshot = await service.scan();
    expect(snapshot.bytes).toBe(123);
    features[0].state = 'supported';
    expect(await service.cleanup(snapshot)).toEqual({ failed: 0, changed: true });
    expect(files.has(path)).toBe(true);
    features[0].state = 'retired';
    expect(await service.cleanup(await service.scan())).toEqual({ failed: 0, changed: false });
    expect(files.size).toBe(0);
  });

  it('추적 정보 저장에 실패하면 실제 데이터를 쓰기 전에 중단한다', async () => {
    const registry = new GeneratedArtifactRegistry(
      {
        loadLocalStorage: () => undefined,
        saveLocalStorage: () => {
          throw new Error('metadata unavailable');
        },
      },
      'fixture-plugin',
      ['.private-artifacts'],
    );
    let written = false;
    const adapter = createGeneratedFileAdapter(
      {
        writeBinary: (_path: string, _value: ArrayBuffer) => {
          written = true;
          return Promise.resolve();
        },
        rename: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      registry.forFeature('future-feature'),
    );
    await expect(
      adapter.writeBinary('.private-artifacts/file.bin', new ArrayBuffer(1)),
    ).rejects.toThrow('metadata unavailable');
    expect(written).toBe(false);
  });

  it('같은 볼트의 다른 저장 계층에서 쓰는 중인 파일도 정리 대상에서 보호한다', async () => {
    const { registry, features, context, storage } = fixture();
    const path = '.private-artifacts/generated.log';
    const adapter = {
      exists: (id: string) => Promise.resolve(id === path),
      stat: () => Promise.resolve({ type: 'file', size: 42, mtime: 1 }),
      writeBinary: () => Promise.resolve(),
      append: (_path: string, _value: string) => pending,
      rename: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    registry.forFeature('future-feature').register('file', path);
    features[0].state = 'retired';
    const service = new RetiredArtifactService(
      createRetiredArtifactHost(adapter as unknown as DataAdapter, context),
    );
    const approved = await service.scan();
    expect(approved.hasArtifacts).toBe(true);
    const concurrent = new GeneratedArtifactRegistry(storage, 'fixture-plugin', [
      '.private-artifacts',
    ]);
    const generated = createGeneratedFileAdapter(adapter, concurrent.forFeature('future-feature'));
    const writing = generated.append(path, '합성 로그');
    expect((await service.scan()).hasArtifacts).toBe(false);
    finish();
    await writing;
    expect((await service.scan()).hasArtifacts).toBe(true);
    expect(await service.cleanup(approved)).toEqual({ failed: 0, changed: true });
  });

  it('삭제 직전의 파일 검사 도중 쓰기가 시작되어도 데이터를 제거하지 않는다', async () => {
    const { registry, features, context } = fixture();
    const path = '.private-artifacts/racing.bin';
    let statCount = 0;
    let removed = false;
    let writing: Promise<void> | undefined;
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const adapter = {
      exists: (id: string) => Promise.resolve(id === path),
      stat: () => {
        if (++statCount === 3) writing = generated.writeBinary(path, new ArrayBuffer(42));
        return Promise.resolve({ type: 'file', size: 42, mtime: 1 });
      },
      writeBinary: (_path: string, _value: ArrayBuffer) => pending,
      rename: () => Promise.resolve(),
      remove: () => {
        removed = true;
        return Promise.resolve();
      },
    };
    const generated = createGeneratedFileAdapter(adapter, registry.forFeature('future-feature'));
    registry.forFeature('future-feature').register('file', path);
    features[0].state = 'retired';
    const service = new RetiredArtifactService(
      createRetiredArtifactHost(adapter as unknown as DataAdapter, context),
    );
    try {
      const approved = await service.scan();
      expect(await service.cleanup(approved)).toEqual({ failed: 1, changed: false });
      expect(writing).toBeDefined();
      expect(removed).toBe(false);
    } finally {
      finish();
      await writing;
    }
  });

  it('기능을 유지하면서 구형 형식만 폐기하고 열린 연결·같은 크기의 재생성을 보호한다', async () => {
    const { registry, features, context } = fixture();
    const name = `format-generation-${crypto.randomUUID()}`;
    const db = new GeneratedArtifactDatabase(name, registry.forFeature('future-feature'));
    db.version(2).stores({ rows: 'id' });
    await db.table('rows').put({ id: 'synthetic', value: '동일 크기 합성 데이터' });
    features[0].retiredVersions = [2];
    const service = new RetiredArtifactService(
      createRetiredArtifactHost(
        {
          exists: () => Promise.resolve(false),
        } as unknown as DataAdapter,
        context,
      ),
    );
    expect((await service.scan()).hasArtifacts).toBe(false);
    db.close();
    const approved = await service.scan();
    expect(approved.hasArtifacts).toBe(true);
    registry.forFeature('future-feature').register('database', name, 2);
    expect(await service.cleanup(approved)).toEqual({ failed: 0, changed: true });
    const supported = features.splice(0);
    expect((await service.scan()).hasArtifacts).toBe(false);
    features.push(...supported);
    await service.cleanup(await service.scan());
  });

  it('기록 손상과 전용 경로 밖의 쓰기·이동·삭제는 실제 I/O 전에 거부한다', async () => {
    const { registry, values } = fixture();
    let mutated = false;
    const adapter = createGeneratedFileAdapter(
      {
        writeBinary: (_path: string, _value: ArrayBuffer) => {
          mutated = true;
          return Promise.resolve();
        },
        rename: (_from: string, _to: string) => {
          mutated = true;
          return Promise.resolve();
        },
        remove: (_path: string) => {
          mutated = true;
          return Promise.resolve();
        },
      },
      registry.forFeature('future-feature'),
    );
    await expect(adapter.writeBinary('notes/user.md', new ArrayBuffer(1))).rejects.toThrow(
      'registry',
    );
    await expect(adapter.rename('notes/user.md', '.private-artifacts/derived.bin')).rejects.toThrow(
      'registry',
    );
    await expect(adapter.remove('notes/user.md')).rejects.toThrow('registry');
    expect(mutated).toBe(false);
    values.set('fixture-plugin:generated-artifacts:v1', { broken: true });
    await expect(
      adapter.writeBinary('.private-artifacts/new.bin', new ArrayBuffer(1)),
    ).rejects.toThrow('registry');
    expect(mutated).toBe(false);
    expect(values.get('fixture-plugin:generated-artifacts:v1')).toEqual({ broken: true });
  });
});

describe('생성물 소유권 등록 실패 격리', () => {
  it('registry 저장소가 손상돼도 DB open과 데이터 접근을 막지 않는다', async () => {
    const throwing = new GeneratedArtifactRegistry(
      {
        loadLocalStorage: () => {
          throw new Error('synthetic registry failure');
        },
        saveLocalStorage: () => {
          throw new Error('synthetic registry failure');
        },
      },
      'fixture-plugin',
      ['.private-artifacts'],
    );
    const db = new GeneratedArtifactDatabase(
      `corrupt-registry-${crypto.randomUUID()}`,
      throwing.forFeature('future-feature'),
    );
    db.version(1).stores({ rows: 'id' });

    await db.open();
    await db.table('rows').put({ id: 'synthetic' });

    expect(await db.table('rows').count()).toBe(1);
    db.close();
  });
});
