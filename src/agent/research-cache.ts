import Dexie from 'dexie';
import type { SourceCitation } from '../chat/types';
import { createContentHashRust } from '../rag/rust-core';

export interface VaultResearchCacheKey {
  path: string;
  modifiedAt: number;
  size: number;
  question: string;
  namespace: string;
}

export interface VaultResearchCacheValue {
  content: string;
  citations: SourceCitation[];
}

export interface VaultResearchCache {
  get(key: VaultResearchCacheKey): Promise<VaultResearchCacheValue | null>;
  put(key: VaultResearchCacheKey, value: VaultResearchCacheValue): Promise<void>;
  close(): void;
}

interface ResearchSummaryRecord extends VaultResearchCacheValue {
  key: string;
  fingerprint: string;
  path: string;
  updatedAt: number;
}

class ResearchCacheDB extends Dexie {
  summaries!: Dexie.Table<ResearchSummaryRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ summaries: 'key, path, updatedAt' });
  }
}

const DEFAULT_MAX_RECORDS = 20_000;
const MAINTENANCE_WRITE_INTERVAL = 100;

export class IndexedDbVaultResearchCache implements VaultResearchCache {
  private readonly db: ResearchCacheDB;
  private writesSinceMaintenance = 0;
  private nextUpdateOrder = Date.now() * 1_000;

  constructor(
    dbName = 'SuperpowerInsideVaultResearchCache',
    private readonly maxRecords = DEFAULT_MAX_RECORDS,
  ) {
    this.db = new ResearchCacheDB(dbName);
  }

  async get(key: VaultResearchCacheKey): Promise<VaultResearchCacheValue | null> {
    await this.ensureOpen();
    const identity = createCacheIdentity(key);
    if (!identity) return null;
    const record = await this.db.summaries.get(identity.key);
    return record?.fingerprint === identity.fingerprint
      ? { content: record.content, citations: record.citations.map((citation) => ({ ...citation })) }
      : null;
  }

  async put(key: VaultResearchCacheKey, value: VaultResearchCacheValue): Promise<void> {
    await this.ensureOpen();
    const identity = createCacheIdentity(key);
    if (!identity) return;
    await this.db.summaries.put({
      key: identity.key,
      fingerprint: identity.fingerprint,
      path: key.path,
      content: value.content,
      citations: value.citations.map((citation) => ({ ...citation })),
      updatedAt: this.nextUpdatedAt(),
    });
    this.writesSinceMaintenance++;
    if (this.writesSinceMaintenance >= MAINTENANCE_WRITE_INTERVAL) {
      this.writesSinceMaintenance = 0;
      await this.pruneOldestRecords();
    }
  }

  close(): void {
    // Obsidian may reuse the same ItemView instance after a leaf is detached and
    // reopened. Keep Dexie's default auto-open behavior so the cache remains a
    // transparent optimization instead of permanently disabling itself.
    this.db.close();
  }

  private async ensureOpen(): Promise<void> {
    if (!this.db.isOpen()) await this.db.open();
  }

  private async pruneOldestRecords(): Promise<void> {
    const count = await this.db.summaries.count();
    const excess = Math.max(0, count - Math.max(1, Math.floor(this.maxRecords)));
    if (excess === 0) return;
    const staleKeys = await this.db.summaries.orderBy('updatedAt').limit(excess).primaryKeys();
    await this.db.summaries.bulkDelete(staleKeys);
  }

  private nextUpdatedAt(): number {
    this.nextUpdateOrder = Math.max(this.nextUpdateOrder + 1, Date.now() * 1_000);
    return this.nextUpdateOrder;
  }
}

function createCacheIdentity(
  input: VaultResearchCacheKey,
): { key: string; fingerprint: string } | null {
  const fingerprint = JSON.stringify([
    input.namespace,
    input.question,
    input.path,
    input.modifiedAt,
    input.size,
  ]);
  const hash = createContentHashRust(fingerprint);
  return hash ? { key: `research-summary:v1:${hash}`, fingerprint } : null;
}
