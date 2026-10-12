import Dexie from 'dexie';
import { updateGeneratedArtifactRegistryRust } from '../rag/rust-core';

export interface GeneratedArtifactRecord {
  kind: 'file' | 'database';
  id: string;
  featureId: string;
  stamp: string;
  formatVersion: number;
}

export interface GeneratedArtifactFeature {
  id: string;
  state: 'supported' | 'retired';
  retiredVersions?: readonly number[];
}

/** 기능의 지원 상태만 선언합니다. 파일명과 저장 세대는 생성 시 자동 기록됩니다. */
export const GENERATED_ARTIFACT_FEATURES: readonly GeneratedArtifactFeature[] = [
  { id: 'rag-vectors', state: 'supported' },
  { id: 'rag-bm25', state: 'supported' },
  { id: 'rag-corpus', state: 'supported' },
  { id: 'pdf-sources', state: 'supported' },
  { id: 'embedding-cache', state: 'supported' },
  { id: 'agent-diagnostics', state: 'supported' },
  { id: 'local-model:ternlight-base', state: 'supported' },
  { id: 'local-model:embeddinggemma-300m', state: 'supported' },
];

interface RegistryStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: unknown): void;
}

type ArtifactLease = { record: GeneratedArtifactRecord; count: number };
const registryLeases = new WeakMap<RegistryStorage, Map<string, Map<string, ArtifactLease>>>();

/** 볼트별 Obsidian 로컬 저장소에 생성물 소유권을 보존합니다. 내용·키는 기록하지 않습니다. */
export class GeneratedArtifactRegistry {
  private readonly key: string;
  private readonly leases: Map<string, ArtifactLease>;

  constructor(
    private readonly storage: RegistryStorage,
    pluginId: string,
    private readonly fileRoots: readonly string[],
  ) {
    this.key = `${pluginId}:generated-artifacts:v1`;
    const scopes = registryLeases.get(storage) ?? new Map<string, Map<string, ArtifactLease>>();
    registryLeases.set(storage, scopes);
    this.leases = scopes.get(this.key) ?? new Map<string, ArtifactLease>();
    scopes.set(this.key, this.leases);
  }

  read(): GeneratedArtifactRecord[] {
    return this.update();
  }

  get active(): GeneratedArtifactRecord[] {
    return [...this.leases.values()].map(({ record }) => record);
  }

  forFeature(featureId: string, formatVersion = 1): GeneratedArtifactBinding {
    return new GeneratedArtifactBinding(this, featureId, formatVersion);
  }

  register(
    kind: GeneratedArtifactRecord['kind'],
    id: string,
    featureId: string,
    formatVersion: number,
  ): void {
    this.update({ kind, id, featureId, stamp: crypto.randomUUID(), formatVersion });
  }

  forget(kind: GeneratedArtifactRecord['kind'], id: string, featureId: string): void {
    this.update({ kind, id, featureId, stamp: crypto.randomUUID(), formatVersion: 1 }, true);
  }

  acquire(kind: GeneratedArtifactRecord['kind'], id: string, featureId: string): () => void {
    const key = `${kind}:${id}`;
    const lease = this.leases.get(key) ?? {
      record: { kind, id, featureId, stamp: '', formatVersion: 1 },
      count: 0,
    };
    lease.count++;
    this.leases.set(key, lease);
    return () => {
      lease.count--;
      if (lease.count === 0) this.leases.delete(key);
    };
  }

  private update(change?: GeneratedArtifactRecord, remove = false): GeneratedArtifactRecord[] {
    const raw = this.storage.loadLocalStorage(this.key);
    const result = updateGeneratedArtifactRegistryRust(raw ?? [], change, this.fileRoots, remove);
    if (!result) throw new Error('Generated artifact registry unavailable');
    if (change) this.storage.saveLocalStorage(this.key, result);
    return result;
  }
}

/** 저장 경계에 전달하는 기능 소유권입니다. */
export class GeneratedArtifactBinding {
  constructor(
    private readonly registry: GeneratedArtifactRegistry,
    private readonly featureId: string,
    private readonly formatVersion: number,
  ) {}

  register(
    kind: GeneratedArtifactRecord['kind'],
    id: string,
    formatVersion = this.formatVersion,
  ): void {
    this.registry.register(kind, id, this.featureId, formatVersion);
  }

  forget(kind: GeneratedArtifactRecord['kind'], id: string): void {
    this.registry.forget(kind, id, this.featureId);
  }

  acquire(kind: GeneratedArtifactRecord['kind'], id: string): () => void {
    return this.registry.acquire(kind, id, this.featureId);
  }
}

/** DB가 준비된 뒤 첫 데이터 접근 전에 소유권을 기록하고 열린 연결을 보호합니다. */
export class GeneratedArtifactDatabase extends Dexie {
  constructor(name: string, ownership: GeneratedArtifactBinding | undefined) {
    super(name);
    let release: (() => void) | undefined;
    this.on(
      'ready',
      () => {
        ownership?.register('database', name, this.verno);
        release ??= ownership?.acquire('database', name);
      },
      true,
    );
    this.on('close', () => {
      release?.();
      release = undefined;
    });
  }
}

interface GeneratedFilePort {
  writeBinary(path: string, value: ArrayBuffer): Promise<void>;
  write?(path: string, value: string): Promise<void>;
  append?(path: string, value: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** 플러그인 전용 파일 I/O만 감쌉니다. Obsidian 전역 adapter나 사용자 노트를 가로채지 않습니다. */
export function createGeneratedFileAdapter<T extends GeneratedFilePort>(
  adapter: T,
  ownership: GeneratedArtifactBinding,
): T {
  const withFile = async (path: string, action: () => Promise<void>): Promise<void> => {
    ownership.register('file', path);
    const release = ownership.acquire('file', path);
    try {
      await action();
    } finally {
      release();
    }
  };
  return new Proxy(adapter, {
    get(target, property) {
      if (property === 'writeBinary')
        return (path: string, value: ArrayBuffer) =>
          withFile(path, () => target.writeBinary(path, value));
      if (property === 'write' && target.write) {
        const write = target.write.bind(target);
        return (path: string, value: string) =>
          withFile(path, () => write.call(target, path, value));
      }
      if (property === 'append' && target.append) {
        const append = target.append.bind(target);
        return (path: string, value: string) => withFile(path, () => append(path, value));
      }
      if (property === 'rename')
        return (from: string, to: string) =>
          withFile(from, () =>
            withFile(to, async () => {
              await target.rename(from, to);
              ownership.forget('file', from);
            }),
          );
      if (property === 'remove')
        return (path: string) =>
          withFile(path, async () => {
            await target.remove(path);
            ownership.forget('file', path);
          });
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value === 'function')
        return (...args: unknown[]): unknown => Reflect.apply(value, target, args);
      return value;
    },
  });
}
