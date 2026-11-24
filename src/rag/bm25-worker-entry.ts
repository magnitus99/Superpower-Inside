import { readWorkerStorePages } from './worker-indexed-db';
import { Bm25RuntimeIndex, initSync } from '../../.local/generated/rag-wasm/rag_wasm';
import type {
  BM25WorkerDocument,
  BM25WorkerRequest,
  BM25WorkerResponse,
} from './bm25-worker-runtime';
import { TOKENIZER_VERSION } from './tokenizer-version';

export type { BM25WorkerRequest, BM25WorkerResponse } from './bm25-worker-runtime';

const HYDRATION_PROGRESS_INTERVAL = 128;

let initialized = false;
let runtime: Bm25RuntimeIndex | null = null;
let sessionId: string | null = null;
let appliedRevision: number | null = null;
let pendingRevision: number | null = null;
let nextPart = 0;
let processing = Promise.resolve();
const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function proofState(): Pick<
  BM25WorkerResponse,
  'sessionId' | 'appliedRevision' | 'pendingRevision' | 'nextPart'
> {
  return { sessionId, appliedRevision, pendingRevision, nextPart };
}

function isMutation(operation: BM25WorkerRequest['operation']): boolean {
  return ['rebuild', 'add', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(
    operation,
  );
}

function validateRequest(request: BM25WorkerRequest): void {
  if (
    typeof request !== 'object' ||
    request === null ||
    !Number.isSafeInteger(request.id) ||
    request.id < 1 ||
    typeof request.sessionId !== 'string' ||
    !SESSION_PATTERN.test(request.sessionId) ||
    !Number.isSafeInteger(request.revision) ||
    request.revision < 0 ||
    !Number.isSafeInteger(request.part) ||
    request.part < 0 ||
    typeof request.finalPart !== 'boolean'
  )
    throw new Error('Invalid BM25 worker protocol.');
  if (request.operation === 'initialize') {
    if (request.revision !== 0 || request.part !== 0 || !request.finalPart)
      throw new Error('Invalid BM25 worker initialization.');
    sessionId = request.sessionId;
    appliedRevision = null;
    pendingRevision = null;
    nextPart = 0;
    return;
  }
  if (request.sessionId !== sessionId || appliedRevision === null)
    throw new Error('BM25 worker requires initialization.');
  if (isMutation(request.operation)) {
    if (request.revision !== appliedRevision + 1 || request.part !== nextPart)
      throw new Error('Invalid BM25 worker mutation sequence.');
  } else if (!['serialize', 'search-top', 'aggregate', 'batch'].includes(request.operation)) {
    throw new Error('Invalid BM25 worker operation.');
  }
}

self.onmessage = (event: MessageEvent<BM25WorkerRequest>): void => {
  const request = event.data;
  processing = processing.then(() => handleMessage(request));
};

async function handleMessage(request: BM25WorkerRequest): Promise<void> {
  try {
    validateRequest(request);
    if (!initialized) {
      if (!request.wasmBase64) throw new Error('BM25 worker WASM payload is missing.');
      initSync({ module: decodeBase64(request.wasmBase64) });
      initialized = true;
    }
    const response = await handleRequest(request);
    if (request.operation === 'initialize') appliedRevision = 0;
    else if (isMutation(request.operation)) {
      if (request.finalPart) {
        appliedRevision = request.revision;
        pendingRevision = null;
        nextPart = 0;
      } else {
        pendingRevision = request.revision;
        nextPart = request.part + 1;
      }
    }
    self.postMessage({ id: request.id, ...response, ...proofState() } satisfies BM25WorkerResponse);
  } catch (error) {
    appliedRevision = null;
    pendingRevision = null;
    nextPart = 0;
    self.postMessage({
      id: request?.id ?? 0,
      ...proofState(),
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
  if (request.operation === 'replace-source') {
    const documents = request.documents;
    if (
      !request.target ||
      !documents ||
      documents.length > 128 ||
      documents.some((document) => document.sourcePath !== request.target)
    )
      throw new Error('Invalid BM25 source replacement.');
    if (request.removeFirst) active.remove_source(request.target, TOKENIZER_VERSION);
    addDocuments(documents, false, request.id);
  } else if (request.operation === 'add') {
    const document = request.document;
    if (!document) throw new Error('BM25 worker document is missing.');
    const added = active.add_document_fields_json(
      document.id,
      document.text,
      document.sourcePath,
      JSON.stringify({ ...document, path: document.sourcePath }),
      TOKENIZER_VERSION,
    );
    if (added !== 1) throw new Error('BM25 worker document validation failed.');
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
      aggregateJson:
        request.allowedPaths === undefined
          ? active.aggregate_json(request.query ?? '', Math.max(0, Math.floor(request.limit ?? 0)))
          : active.aggregate_scoped_json(
              request.query ?? '',
              Math.max(0, Math.floor(request.limit ?? 0)),
              JSON.stringify(request.allowedPaths),
            ),
    };
  } else if (request.operation === 'batch') {
    return {
      ...runtimeState(),
      batchJson: active.batch_search_and_aggregate_json(
        JSON.stringify({
          queries: request.queries ?? [],
          aggregates: request.aggregates ?? [],
          ...(request.allowedPaths !== undefined ? { allowedPaths: request.allowedPaths } : {}),
        }),
      ),
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
    ...proofState(),
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
    ...proofState(),
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
