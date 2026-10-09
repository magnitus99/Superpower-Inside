import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readWorkerStorePages } from './worker-indexed-db';

describe('작업자의 IndexedDB 묶음 읽기', () => {
  it('순서와 누락 없이 제한된 페이지를 전달하고 연결을 닫는다', async () => {
    const name = `worker-pages-${crypto.randomUUID()}`;
    const opened = indexedDB.open(name, 1);
    opened.onupgradeneeded = () => opened.result.createObjectStore('documents', { keyPath: 'id' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error ?? new Error('Open failed.'));
    });
    const write = db.transaction('documents', 'readwrite');
    for (let index = 0; index < 600; index++)
      write.objectStore('documents').put({ id: String(index).padStart(4, '0') });
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve();
      write.onerror = () => reject(write.error ?? new Error('Write failed.'));
    });
    db.close();
    const batches: unknown[][] = [];
    await readWorkerStorePages(name, 'documents', (rows) => {
      batches.push(rows);
    });
    expect(batches.map((batch) => batch.length)).toEqual([128, 128, 128, 128, 88]);
    expect(batches.flat()).toHaveLength(600);
    expect(batches.flat().at(-1)).toEqual({ id: '0599' });
    await expect(
      readWorkerStorePages(name, 'documents', () => {
        throw new Error('decode failed');
      }),
    ).rejects.toThrow('decode failed');
    const deletion = indexedDB.deleteDatabase(name);
    await new Promise<void>((resolve, reject) => {
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error ?? new Error('Delete failed.'));
    });
  });
});
