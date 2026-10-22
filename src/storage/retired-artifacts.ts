import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { planRetiredArtifactsRust } from '../rag/rust-core';
import type { AppLogger } from '../utils/logger';
import type { GeneratedArtifactFeature, GeneratedArtifactRecord } from './generated-artifacts';

/** 지원이 끝난 기능이 플러그인 디렉터리에 남긴 파일 이름입니다. */
export const RETIRED_PLUGIN_FILE_NAMES: readonly string[] = [
  'agent-diagnostics.json',
  'agent-diagnostics.ndjson',
  'agent-diagnostics-safe-mode.json',
];

export interface RetiredArtifactContext {
  pluginId: string;
  vaultPrefixes: readonly string[];
  legacyNames: readonly string[];
  activeNames: readonly string[];
  legacyFilesSafe: boolean;
  revision: number;
  features?: readonly GeneratedArtifactFeature[];
  tracked?: readonly GeneratedArtifactRecord[];
  activeArtifacts?: readonly GeneratedArtifactRecord[];
  artifactFileRoots?: readonly string[];
  retiredFileNames?: readonly string[];
}

export interface ArtifactRecord {
  kind: 'file' | 'database';
  id: string;
  bytes: number;
  modified: number;
  stamp?: string;
}

export interface RetiredArtifactSnapshot {
  bytes: number;
  hasArtifacts: boolean;
  capacity: string;
  revision: number;
}

export interface RetiredArtifactPlan extends RetiredArtifactSnapshot {
  records: ArtifactRecord[];
  changed: boolean;
}

export interface RetiredArtifactHost {
  context(this: void): Promise<RetiredArtifactContext>;
  listFiles(this: void): Promise<ArtifactRecord[]>;
  listDatabaseNames(this: void): Promise<string[]>;
  measureDatabase(this: void, name: string): Promise<number>;
  removeFile(this: void, record: ArtifactRecord, revision: number): Promise<void>;
  deleteDatabase(this: void, name: string): Promise<void>;
}

/** 저장 I/O와 폐기 정책을 분리합니다. 조회와 사용자의 삭제 결정 사이에도 현행 데이터를 보호합니다. */
export class RetiredArtifactService {
  private readonly snapshots = new WeakMap<RetiredArtifactSnapshot, readonly ArtifactRecord[]>();
  private cleaning = false;

  constructor(
    private readonly host: RetiredArtifactHost,
    private readonly logger?: Pick<AppLogger, 'debug' | 'warn' | 'notice'>,
  ) {}

  async scan(): Promise<RetiredArtifactSnapshot> {
    const plan = await this.inspect();
    const snapshot = Object.freeze({
      bytes: plan.bytes,
      hasArtifacts: plan.records.length > 0,
      capacity: plan.capacity,
      revision: plan.revision,
    });
    this.snapshots.set(snapshot, plan.records);
    this.logger?.debug('Retired artifact scan completed.', {
      source: 'storage.retirement',
      data: { bytes: plan.bytes, artifactCount: plan.records.length },
    });
    return snapshot;
  }

  async cleanup(snapshot: RetiredArtifactSnapshot): Promise<{ failed: number; changed: boolean }> {
    const approved = this.snapshots.get(snapshot);
    if (!approved) throw new Error('Unknown cleanup snapshot');
    if (this.cleaning) throw new Error('Cleanup already running');
    this.cleaning = true;
    try {
      const latest = await this.inspect();
      const approval = { records: approved, revision: snapshot.revision };
      const deletion = planRetiredArtifactsRust(
        await this.host.context(),
        latest.records,
        approval,
      );
      if (!deletion) throw new Error('Retirement policy unavailable');
      let failed = 0;
      let changed = deletion.changed;
      for (const record of deletion.records) {
        const context = await this.host.context();
        const protectedPlan = planRetiredArtifactsRust(context, [record], {
          records: [record],
          revision: snapshot.revision,
        });
        if (!protectedPlan) throw new Error('Retirement policy unavailable');
        if (protectedPlan.changed) {
          changed = true;
          continue;
        }
        try {
          if (record.kind === 'file') await this.host.removeFile(record, snapshot.revision);
          else await this.host.deleteDatabase(record.id);
        } catch {
          failed++;
        }
      }
      const details = { source: 'storage.retirement', data: { failed, changed } };
      if (failed > 0 || changed) this.logger?.warn('Retired artifact cleanup incomplete.', details);
      else this.logger?.notice('Retired artifact cleanup completed.', details);
      return { failed, changed };
    } finally {
      this.cleaning = false;
    }
  }

  private async inspect(): Promise<RetiredArtifactPlan> {
    const context = await this.host.context();
    const [files, names] = await Promise.all([
      this.host.listFiles(),
      this.host.listDatabaseNames(),
    ]);
    const candidates = planRetiredArtifactsRust(context, [
      ...files,
      ...names.map((id): ArtifactRecord => ({ kind: 'database', id, bytes: 0, modified: 0 })),
    ]);
    if (!candidates) throw new Error('Retirement policy unavailable');
    const records: ArtifactRecord[] = [];
    for (const record of candidates.records) {
      records.push(
        record.kind === 'database'
          ? { ...record, bytes: await this.host.measureDatabase(record.id) }
          : record,
      );
    }
    const current = await this.host.context();
    if (current.revision !== context.revision) throw new Error('Storage changed during scan');
    const plan = planRetiredArtifactsRust(current, records);
    if (!plan) throw new Error('Retirement policy unavailable');
    return plan;
  }
}

export function createRetiredArtifactHost(
  adapter: DataAdapter,
  context: RetiredArtifactHost['context'],
): RetiredArtifactHost {
  return {
    context,
    listFiles: async () => {
      const directory = '.superpower-inside';
      const records: ArtifactRecord[] = [];
      const current = await context();
      const tracked = planRetiredArtifactsRust(
        current,
        (current.tracked ?? []).map(({ kind, id }) => ({ kind, id, bytes: 0, modified: 0 })),
      );
      if (!tracked) throw new Error('Generated artifact discovery unavailable');
      const files = (await adapter.exists(directory)) ? (await adapter.list(directory)).files : [];
      for (const record of tracked.records) {
        if (record.kind === 'file') files.push(record.id);
      }
      for (const id of files) {
        const stat = await adapter.stat(id);
        if (stat?.type === 'file')
          records.push({ kind: 'file', id, bytes: stat.size, modified: stat.mtime });
      }
      return records;
    },
    listDatabaseNames: () => Dexie.getDatabaseNames(),
    measureDatabase: measureDatabasePayload,
    removeFile: async (record, revision) => {
      const stat = await adapter.stat(record.id);
      if (stat?.type !== 'file' || stat.size !== record.bytes || stat.mtime !== record.modified) {
        throw new Error('Retired file changed before deletion');
      }
      // stat을 기다리는 동안 시작된 쓰기·재생성·재초기화도 삭제 직전에 다시 보호합니다.
      const plan = planRetiredArtifactsRust(await context(), [record], {
        records: [record],
        revision,
      });
      if (!plan || plan.changed || plan.records.length !== 1) {
        throw new Error('Retired file ownership changed before deletion');
      }
      await adapter.remove(record.id);
    },
    deleteDatabase: (name) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Retired database deletion failed'));
        // blocked 요청은 취소할 수 없습니다. 완료까지 기다려 뒤늦은 삭제를 실패로 오인하지 않습니다.
      }),
  };
}

/** 브라우저는 DB별 디스크 사용량을 제공하지 않으므로 키·직렬화 데이터·바이너리 크기를 측정합니다. */
export function measureDatabasePayload(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => reject(new Error('Retired database inspection failed'));
    request.onblocked = () => reject(new Error('Retired database inspection blocked'));
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.length === 0) {
        db.close();
        resolve(0);
        return;
      }
      const transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      let bytes = 0;
      transaction.oncomplete = () => {
        db.close();
        resolve(bytes);
      };
      transaction.onabort = () => {
        db.close();
        reject(new Error('Retired database inspection aborted'));
      };
      db.onversionchange = () => db.close();
      for (const store of Array.from(db.objectStoreNames)) {
        const cursorRequest = transaction.objectStore(store).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          try {
            const parts: BlobPart[] = [];
            const serialized = JSON.stringify(
              [cursor.primaryKey, cursor.value],
              (_key, value: unknown) => {
                if (value instanceof ArrayBuffer || value instanceof Blob) {
                  parts.push(value);
                  return null;
                }
                if (ArrayBuffer.isView(value)) {
                  parts.push(
                    new Uint8Array(
                      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
                    ),
                  );
                  return null;
                }
                return value;
              },
            );
            parts.push(serialized);
            bytes += new Blob(parts).size;
            cursor.continue();
          } catch {
            transaction.abort();
          }
        };
      }
    };
  });
}
