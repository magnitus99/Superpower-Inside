import {
  detect_communities_from_edges_json,
  initSync,
} from '../../generated/rag-wasm/rag_wasm';

interface WorkerRequest {
  id: number;
  wasmBase64?: string;
  edges: unknown[];
  maxIterations: number;
}

interface WorkerResponse {
  id: number;
  result?: string;
  error?: string;
}

let initialized = false;

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, wasmBase64, edges, maxIterations } = event.data;
  try {
    if (!initialized) {
      if (!wasmBase64) throw new Error('Graph worker WASM payload is missing.');
      initSync({ module: decodeBase64(wasmBase64) });
      initialized = true;
    }
    const result = detect_communities_from_edges_json(JSON.stringify(edges), maxIterations);
    self.postMessage({ id, result } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
