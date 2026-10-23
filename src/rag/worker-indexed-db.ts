/** 저장소의 전체 레코드 수를 읽습니다. 색인 예산을 읽기 전에 확인할 때 씁니다. */
export function countWorkerStoreRows(dbName: string, storeName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open(dbName);
    opened.onerror = () => reject(opened.error ?? new Error('Worker database open failed.'));
    opened.onsuccess = () => {
      const database = opened.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.close();
        resolve(0);
        return;
      }
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => {
        database.close();
        resolve(request.result);
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error('Worker database count failed.'));
      };
    };
  });
}

/** 커서마다 왕복하지 않고 제한된 페이지로 작업자 저장소를 읽습니다. */
export function readWorkerStorePages(
  dbName: string,
  storeName: string,
  consume: (records: unknown[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open(dbName);
    opened.onerror = () => reject(opened.error ?? new Error('Worker database open failed.'));
    opened.onsuccess = () => {
      const database = opened.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.close();
        resolve();
        return;
      }
      const transaction = database.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      let failure: Error | undefined;
      const readPage = (range?: IDBKeyRange): void => {
        const keys = store.getAllKeys(range, 128);
        keys.onsuccess = () => {
          const lastKey = keys.result.at(-1);
          if (lastKey === undefined) return;
          const values = store.getAll(range, 128);
          values.onsuccess = () => {
            try {
              consume(values.result as unknown[]);
              if (keys.result.length === 128) readPage(IDBKeyRange.lowerBound(lastKey, true));
            } catch (error) {
              failure = error instanceof Error ? error : new Error(String(error));
              transaction.abort();
            }
          };
        };
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(failure ?? transaction.error ?? new Error('Worker database read aborted.'));
      };
      transaction.onerror = () => {
        database.close();
        reject(failure ?? transaction.error ?? new Error('Worker database read failed.'));
      };
      readPage();
    };
  });
}
