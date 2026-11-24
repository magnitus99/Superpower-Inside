import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DURABILITY_RECEIPT_KEY, isStoreMutationReceipt, readStoreMutationReceipt, stampStoreMutation, type DurabilityMetaRecord } from './durability';

const databases: Dexie[] = [];
function fixture() {
  const db = new Dexie(`durability-fixture:${crypto.randomUUID()}`);
  db.version(1).stores({ meta: 'key', data: 'id' });
  databases.push(db);
  return { db, meta: db.table<DurabilityMetaRecord, string>('meta') };
}

afterEach(async () => {
  for (const db of databases) { db.close(); await Dexie.delete(db.name); }
  databases.length = 0;
});

describe('저장 mutation receipt', () => {
  it('데이터 DB의 write transaction과 meta scope가 없으면 stamp를 거절한다', async () => {
    const { db, meta } = fixture();
    const other = fixture();
    await expect(stampStoreMutation(meta)).rejects.toThrow('rag-durability-transaction-required');
    await expect(db.transaction('r', meta, () => stampStoreMutation(meta))).rejects.toThrow('rag-durability-transaction-required');
    await expect(db.transaction('rw', 'data', () => stampStoreMutation(meta))).rejects.toThrow('rag-durability-transaction-required');
    await expect(other.db.transaction('rw', other.meta, () => stampStoreMutation(meta))).rejects.toThrow('rag-durability-transaction-required');
    expect(await readStoreMutationReceipt(meta)).toBeNull();
  });

  it('읽기는 손상·확장된 wire를 인증하지 않고 stamp는 nonce 필드만 저장한다', async () => {
    const { db, meta } = fixture();
    const valid = { version: 1, incarnation: crypto.randomUUID(), mutation: crypto.randomUUID() };
    for (const value of [null, [], {}, { ...valid, version: 2 }, { ...valid, incarnation: 'invalid' }, { ...valid, mutation: 12 }, { ...valid, extra: 'untrusted-field' }]) {
      expect(isStoreMutationReceipt(value)).toBe(false);
      await meta.put({ key: DURABILITY_RECEIPT_KEY, value });
      expect(await readStoreMutationReceipt(meta)).toBeNull();
    }
    const receipt = await db.transaction('rw', meta, () => stampStoreMutation(meta));
    expect(isStoreMutationReceipt(receipt)).toBe(true);
    expect(Object.keys(receipt).sort()).toEqual(['incarnation', 'mutation', 'version']);
    expect(await readStoreMutationReceipt(meta)).toEqual(receipt);
  });
});
