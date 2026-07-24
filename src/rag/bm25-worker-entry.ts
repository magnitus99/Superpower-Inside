import { Bm25RuntimeIndex, initSync } from '../../generated/rag-wasm/rag_wasm';

const TOKENIZER_VERSION = 2;

interface BM25WorkerDocument {
  id: string;
  text: string;
  sourcePath: string;
}

interface BM25WorkerRequest {
  id: number;
  operation:
    | 'initialize'
    | 'rebuild'
    | 'add'
    | 'remove-doc'
    | 'remove-source'
    | 'clear'
    | 'search-top';
  wasmBase64?: string;
  dbName?: string;
  snapshot?: string;
  documents?: BM25WorkerDocument[];
  document?: BM25WorkerDocument;
  target?: string;
  query?: string;
  limit?: number;
}

interface BM25WorkerHit {
  docId: string;
  sourcePath: string;
  score: number;
}

interface BM25WorkerResponse {
  id: number;
  ready?: boolean;
  tokenizerCurrent?: boolean;
  totalDocs?: number;
  hits?: BM25WorkerHit[];
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
    replaceRuntime(createRuntime(snapshot));
    if (request.dbName) {
      await hydratePersistedDocuments(request.dbName, request.id, snapshot.length === 0);
    } else {
      addDocuments(request.documents ?? [], false, request.id);
    }
    return runtimeState();
  }
  if (request.operation === 'rebuild') {
    replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
    addDocuments(request.documents ?? [], false, request.id);
    return runtimeState();
  }
  const active = ensureRuntime();
  if (request.operation === 'add') {
    const document = request.document;
    if (!document) throw new Error('BM25 worker document is missing.');
    active.add_document(document.id, document.text, document.sourcePath, TOKENIZER_VERSION);
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
  }
  return runtimeState();
}

function hydratePersistedDocuments(
  dbName: string,
  requestId: number,
  knownUnique: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let processedDocuments = 0;
    const batch: BM25WorkerDocument[] = [];
    const openRequest = indexedDB.open(dbName);
    openRequest.onerror = () =>
      reject(openRequest.error ?? new Error('BM25 database open failed.'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains('documents')) {
        database.close();
        resolve();
        return;
      }
      const transaction = database.transaction('documents', 'readonly');
      const cursorRequest = transaction.objectStore('documents').openCursor();
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('BM25 cursor failed.'));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        try {
          if (!cursor) {
            processedDocuments += addDocumentBatch(batch, knownUnique);
            postHydrationProgress(requestId, processedDocuments);
            return;
          }
          batch.push(parsePersistedDocument(cursor.value));
          if (batch.length >= HYDRATION_PROGRESS_INTERVAL) {
            processedDocuments += addDocumentBatch(batch, knownUnique);
            postHydrationProgress(requestId, processedDocuments);
          }
          cursor.continue();
        } catch (error) {
          transaction.abort();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('BM25 read failed.'));
    };
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
    JSON.stringify(documents),
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
