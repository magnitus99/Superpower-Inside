import { readWorkerStorePages } from './worker-indexed-db';
import { Bm25RuntimeIndex, initSync } from '../../generated/rag-wasm/rag_wasm';
import type { BM25WorkerDocument } from './bm25-worker-runtime';
import { TOKENIZER_VERSION } from './tokenizer-version';

export interface BM25WorkerRequest {
  id: number;
  operation:
    | 'initialize'
    | 'rebuild'
    | 'add'
    | 'remove-doc'
    | 'remove-source'
    | 'clear'
    | 'serialize'
    | 'search-top'
    | 'aggregate'
    | 'batch';
  wasmBase64?: string;
  dbName?: string;
  snapshot?: string;
  sinceOrder?: number;
  expectedDocs?: number;
  documents?: BM25WorkerDocument[];
  document?: BM25WorkerDocument;
  target?: string;
  query?: string;
  limit?: number;
  allowedPaths?: readonly string[];
  queries?: readonly { query: string; limit: number }[];
  aggregates?: readonly { query: string; limit: number; allowedPaths?: readonly string[] }[];
}

interface BM25WorkerHit {
  docId: string;
  sourcePath: string;
  score: number;
}

export interface BM25WorkerResponse {
  id: number;
  ready?: boolean;
  tokenizerCurrent?: boolean;
  totalDocs?: number;
  snapshot?: string;
  snapshotRejected?: boolean;
  hits?: BM25WorkerHit[];
  /** 점수 없이 센 질의 일치 인벤토리입니다. TS가 형식을 검증합니다. */
  aggregateJson?: string;
  /** 여러 질의의 검색·집계를 담은 JSON입니다. TS가 형식을 검증합니다. */
  batchJson?: string;
  progress?: {
    processedDocuments: number;
  };
  error?: string;
}

const HYDRATION_PROGRESS_INTERVAL = 128;

let initialized = false;
let runtime: Bm25RuntimeIndex | null = null;

self.onmessage = (event: MessageEvent<BM25WorkerRequest>): void => {
  const request = event.data;
  void handleMessage(request);
};

async function handleMessage(request: BM25WorkerRequest): Promise<void> {
  try {
    if (!initialized) {
      if (!request.wasmBase64) throw new Error('BM25 worker WASM payload is missing.');
      initSync({ module: decodeBase64(request.wasmBase64) });
      initialized = true;
    }
    const response = await handleRequest(request);
    self.postMessage({ id: request.id, ...response } satisfies BM25WorkerResponse);
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies BM25WorkerResponse);
  }
}

async function handleRequest(request: BM25WorkerRequest): Promise<Omit<BM25WorkerResponse, 'id'>> {
  if (request.operation === 'initialize') {
    const snapshot = request.snapshot?.trim() ?? '';
    const sinceOrder = typeof request.sinceOrder === 'number' ? request.sinceOrder : undefined;
    const expectedDocs =
      typeof request.expectedDocs === 'number' && Number.isInteger(request.expectedDocs)
        ? request.expectedDocs
        : undefined;
    let rejected = false;
    if (snapshot.length > 0) {
      try {
        const restored = createRuntime(snapshot);
        const positionStatus = JSON.parse(restored.position_index_status_json()) as {
          complete: boolean;
        };
        // JSON이 조용히 빈 인덱스로 파싱되는 손상도 문서 수 불일치로 잡아낸다.
        if (
          !positionStatus.complete ||
          (expectedDocs !== undefined && restored.total_docs() !== expectedDocs)
        ) {
          restored.free();
          throw new Error('BM25 snapshot document count mismatch.');
        }
        replaceRuntime(restored);
      } catch {
        // 손상된 스냅샷은 버리고 저장된 원문에서 전량 복구한다.
        replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
        rejected = true;
      }
    } else {
      replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
    }
    if (request.dbName) {
      if (sinceOrder !== undefined && snapshot.length > 0 && !rejected) {
        await hydratePersistedDelta(request.dbName, sinceOrder, request.id);
      } else {
        // 거절된 스냅샷은 빈 런타임에서 시작하므로 중복 없는 전량 적재로 취급한다.
        await hydratePersistedDocuments(
          request.dbName,
          request.id,
          snapshot.length === 0 || rejected,
        );
      }
    } else {
      addDocuments(request.documents ?? [], false, request.id);
    }
    return { ...runtimeState(), ...(rejected ? { snapshotRejected: true } : {}) };
  }
  if (request.operation === 'rebuild') {
    replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
    addDocuments(request.documents ?? [], false, request.id);
    return runtimeState();
  }
  if (request.operation === 'serialize') {
    return { ...runtimeState(), snapshot: ensureRuntime().to_json() };
  }
  const active = ensureRuntime();
  if (request.operation === 'add') {
    const document = request.document;
    if (!document) throw new Error('BM25 worker document is missing.');
    active.add_document_fields_json(
      document.id,
      document.text,
      document.sourcePath,
      JSON.stringify({ ...document, path: document.sourcePath }),
      TOKENIZER_VERSION,
    );
  } else if (request.operation === 'remove-doc') {
    active.remove_document(request.target ?? '', TOKENIZER_VERSION);
  } else if (request.operation === 'remove-source') {
    active.remove_source(request.target ?? '', TOKENIZER_VERSION);
  } else if (request.operation === 'clear') {
    replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
  } else if (request.operation === 'search-top') {
    const scores = JSON.parse(
      active.search_top_json(request.query ?? '', Math.max(0, Math.floor(request.limit ?? 0))),
    ) as Array<{ docId: string; score: number }>;
    return {
      ...runtimeState(),
      hits: scores.map(({ docId, score }) => ({
        docId,
        sourcePath: active.source_path_for_doc(docId) || docId,
        score,
      })),
    };
  } else if (request.operation === 'aggregate') {
    return {
      ...runtimeState(),
      aggregateJson: request.allowedPaths === undefined
        ? active.aggregate_json(request.query ?? '', Math.max(0, Math.floor(request.limit ?? 0)))
        : active.aggregate_scoped_json(request.query ?? '', Math.max(0, Math.floor(request.limit ?? 0)), JSON.stringify(request.allowedPaths)),
    };
  } else if (request.operation === 'batch') {
    return {
      ...runtimeState(),
      batchJson: active.batch_search_and_aggregate_json(JSON.stringify({
        queries: request.queries ?? [],
        aggregates: request.aggregates ?? [],
      })),
    };
  }
  return runtimeState();
}

/** 스냅샷 이후 순서만 읽어 tombstone 먼저, 원문 업서트를 나중에 적용합니다. */
async function hydratePersistedDelta(
  dbName: string,
  sinceOrder: number,
  requestId: number,
): Promise<void> {
  let processedDocuments = 0;
  // 삭제 tombstone이 먼저 적용되어야 스냅샷에 남은 문서가 되살아나지 않는다.
  await readWorkerCursorPages(dbName, 'removals', undefined, sinceOrder, (records) => {
    for (const record of records) applyRemovalRecord(record);
  });
  await readWorkerCursorPages(dbName, 'documents', 'order', sinceOrder, (records) => {
    processedDocuments += addDocumentBatch(records.map(parsePersistedDocument), false);
    postHydrationProgress(requestId, processedDocuments);
  });
}

interface BM25RemovalRecord {
  order: number;
  kind: 'clear' | 'remove-doc' | 'remove-source';
  target: string;
}

function applyRemovalRecord(value: unknown): void {
  const record = parseRemovalRecord(value);
  if (record.kind === 'clear') {
    replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
    return;
  }
  if (record.kind === 'remove-doc') {
    ensureRuntime().remove_document(record.target, TOKENIZER_VERSION);
    return;
  }
  ensureRuntime().remove_source(record.target, TOKENIZER_VERSION);
}

function parseRemovalRecord(value: unknown): BM25RemovalRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error('BM25 persisted removal is invalid.');
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (
    typeof record.order !== 'number' ||
    typeof record.target !== 'string' ||
    (kind !== 'clear' && kind !== 'remove-doc' && kind !== 'remove-source')
  ) {
    throw new Error('BM25 persisted removal fields are invalid.');
  }
  return { order: record.order, kind, target: record.target };
}

/** 기본키 또는 인덱스 커서를 순서대로 읽어 페이지 단위로 소비합니다. */
function readWorkerCursorPages(
  dbName: string,
  storeName: string,
  indexName: string | undefined,
  sinceOrder: number,
  consume: (records: unknown[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open(dbName);
    opened.onerror = () => reject(opened.error ?? new Error('BM25 worker database open failed.'));
    opened.onsuccess = () => {
      const database = opened.result;
      const finish = (error?: Error): void => {
        database.close();
        if (error) reject(error);
        else resolve();
      };
      if (!database.objectStoreNames.contains(storeName)) {
        finish();
        return;
      }
      const transaction = database.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const source = indexName ? store.index(indexName) : store;
      const buffer: unknown[] = [];
      let failure: Error | undefined;
      const consumeBuffer = (): void => {
        if (buffer.length === 0) return;
        try {
          consume(buffer.splice(0));
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };
      const cursorRequest = source.openCursor(IDBKeyRange.lowerBound(sinceOrder, true));
      cursorRequest.onsuccess = () => {
        if (failure) return;
        const cursor = cursorRequest.result;
        if (!cursor) return;
        buffer.push(cursor.value);
        if (buffer.length >= HYDRATION_PROGRESS_INTERVAL) {
          consumeBuffer();
          if (failure) return;
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => {
        failure ??= cursorRequest.error ?? new Error('BM25 worker cursor failed.');
      };
      transaction.oncomplete = () => {
        consumeBuffer();
        finish(failure);
      };
      transaction.onabort = () =>
        finish(failure ?? transaction.error ?? new Error('BM25 worker delta read aborted.'));
      transaction.onerror = () =>
        finish(failure ?? transaction.error ?? new Error('BM25 worker delta read failed.'));
    };
  });
}

async function hydratePersistedDocuments(
  dbName: string,
  requestId: number,
  knownUnique: boolean,
): Promise<void> {
  let processedDocuments = 0;
  await readWorkerStorePages(dbName, 'documents', (records) => {
    processedDocuments += addDocumentBatch(records.map(parsePersistedDocument), knownUnique);
    postHydrationProgress(requestId, processedDocuments);
  });
}

function createRuntime(snapshot: string | undefined): Bm25RuntimeIndex {
  const raw = snapshot?.trim() ?? '';
  return raw.length > 0
    ? Bm25RuntimeIndex.from_json(raw, TOKENIZER_VERSION)
    : new Bm25RuntimeIndex(TOKENIZER_VERSION);
}

function addDocuments(
  documents: readonly BM25WorkerDocument[],
  knownUnique = false,
  requestId?: number,
): void {
  let processedDocuments = 0;
  for (let offset = 0; offset < documents.length; offset += HYDRATION_PROGRESS_INTERVAL) {
    const batch = documents.slice(offset, offset + HYDRATION_PROGRESS_INTERVAL);
    processedDocuments += addDocumentBatch(batch, knownUnique);
    if (requestId !== undefined) {
      postHydrationProgress(requestId, processedDocuments);
    }
  }
}

function addDocumentBatch(documents: BM25WorkerDocument[], knownUnique: boolean): number {
  if (documents.length === 0) return 0;
  const expected = documents.length;
  const added = ensureRuntime().add_documents_json(
    JSON.stringify(documents.map((document) => ({ ...document, path: document.sourcePath }))),
    TOKENIZER_VERSION,
    knownUnique,
  );
  documents.length = 0;
  if (added !== expected) {
    throw new Error('BM25 worker document batch validation failed.');
  }
  return added;
}

function postHydrationProgress(requestId: number, processedDocuments: number): void {
  if (processedDocuments <= 0) return;
  self.postMessage({
    id: requestId,
    progress: { processedDocuments },
  } satisfies BM25WorkerResponse);
}

function parsePersistedDocument(value: unknown): BM25WorkerDocument {
  if (typeof value !== 'object' || value === null) {
    throw new Error('BM25 persisted document is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.text !== 'string' ||
    typeof record.sourcePath !== 'string'
  ) {
    throw new Error('BM25 persisted document fields are invalid.');
  }
  return {
    id: record.id,
    text: record.text,
    sourcePath: record.sourcePath,
    path: record.sourcePath,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(Array.isArray(record.headings) && record.headings.every((item) => typeof item === 'string')
      ? { headings: record.headings }
      : typeof record.heading === 'string'
        ? { headings: [record.heading] }
        : {}),
    ...(Array.isArray(record.tags) && record.tags.every((item) => typeof item === 'string')
      ? { tags: record.tags }
      : {}),
  };
}

function runtimeState(): Omit<BM25WorkerResponse, 'id'> {
  const active = ensureRuntime();
  return {
    ready: active.is_ready(),
    tokenizerCurrent: active.is_tokenizer_current(TOKENIZER_VERSION),
    totalDocs: active.total_docs(),
  };
}

function ensureRuntime(): Bm25RuntimeIndex {
  runtime ??= new Bm25RuntimeIndex(TOKENIZER_VERSION);
  return runtime;
}

function replaceRuntime(next: Bm25RuntimeIndex): void {
  runtime?.free();
  runtime = next;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
