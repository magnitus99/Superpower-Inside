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
  error?: string;
}

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
    replaceRuntime(createRuntime(request.snapshot));
    const documents = request.dbName
      ? await readPersistedDocuments(request.dbName)
      : (request.documents ?? []);
    addDocuments(documents);
    return runtimeState();
  }
  if (request.operation === 'rebuild') {
    replaceRuntime(new Bm25RuntimeIndex(TOKENIZER_VERSION));
    addDocuments(request.documents ?? [], true);
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

function readPersistedDocuments(dbName: string): Promise<BM25WorkerDocument[]> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName);
    openRequest.onerror = () =>
      reject(openRequest.error ?? new Error('BM25 database open failed.'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains('documents')) {
        database.close();
        resolve([]);
        return;
      }
      const transaction = database.transaction('documents', 'readonly');
      const documents: BM25WorkerDocument[] = [];
      const cursorRequest = transaction.objectStore('documents').openCursor();
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('BM25 cursor failed.'));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const value = cursor.value as BM25WorkerDocument;
        documents.push({ id: value.id, text: value.text, sourcePath: value.sourcePath });
        cursor.continue();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(documents);
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

function addDocuments(documents: readonly BM25WorkerDocument[], knownUnique = false): void {
  const active = ensureRuntime();
  for (const document of documents) {
    if (knownUnique) {
      active.add_new_document(document.id, document.text, document.sourcePath, TOKENIZER_VERSION);
    } else {
      active.add_document(document.id, document.text, document.sourcePath, TOKENIZER_VERSION);
    }
  }
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
