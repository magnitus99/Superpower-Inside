import Dexie, { type Table } from 'dexie';

export const DURABILITY_RECEIPT_KEY = 'source-durability-v1';

/** 내용이나 비밀을 복제하지 않고 소유 저장소의 변경만 식별합니다. */
export interface StoreMutationReceipt {
  version: 1;
  incarnation: string;
  mutation: string;
}

export interface DurabilityMetaRecord {
  key: string;
  value: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isStoreMutationReceipt(value: unknown): value is StoreMutationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return Object.keys(receipt).length === 3 && receipt.version === 1 &&
    typeof receipt.incarnation === 'string' && UUID.test(receipt.incarnation) &&
    typeof receipt.mutation === 'string' && UUID.test(receipt.mutation);
}

export async function readStoreMutationReceipt(meta: Table<DurabilityMetaRecord, string>): Promise<StoreMutationReceipt | null> {
  const value: unknown = (await meta.get(DURABILITY_RECEIPT_KEY))?.value;
  return isStoreMutationReceipt(value) ? { version: 1, incarnation: value.incarnation, mutation: value.mutation } : null;
}

/** 데이터와 동일한 write transaction 밖에서는 receipt를 만들지 않습니다. */
export async function stampStoreMutation(meta: Table<DurabilityMetaRecord, string>): Promise<StoreMutationReceipt> {
  const transaction = Dexie.currentTransaction;
  if (!transaction || transaction.db !== meta.db || transaction.mode !== 'readwrite' || !transaction.storeNames.includes(meta.name)) {
    throw new Error('rag-durability-transaction-required');
  }
  const previous = await readStoreMutationReceipt(meta);
  const receipt: StoreMutationReceipt = {
    version: 1,
    incarnation: previous?.incarnation ?? crypto.randomUUID(),
    mutation: crypto.randomUUID(),
  };
  await meta.put({ key: DURABILITY_RECEIPT_KEY, value: receipt });
  return receipt;
}
