import { GRAPH_COMMUNITY_WORKER_SOURCE } from '../../generated/graph-community-worker-source';
import { RAG_WASM_BASE64 } from '../rag/rag-wasm-bytes';
import {
  detectCommunitiesFromEdgesRust,
  detectLeidenHierarchyFromEdgesRust,
  type RustCommunityDetectionByIdResult,
  type RustCommunityHierarchyResult,
} from '../rag/rust-core';
import type { CommunityEdge } from './community-detector';

export interface GraphCommunityComputePort {
  detect(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityDetectionByIdResult>;
  detectHierarchy(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    maxLevels: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityHierarchyResult>;
}

export class InlineGraphCommunityCompute implements GraphCommunityComputePort {
  detect(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityDetectionByIdResult> {
    throwIfAborted(signal);
    const result = detectCommunitiesFromEdgesRust(edges, maxIterations);
    if (result === null) return Promise.reject(new Error('Graph community calculation failed.'));
    return Promise.resolve(result);
  }

  detectHierarchy(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    maxLevels: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityHierarchyResult> {
    throwIfAborted(signal);
    const result = detectLeidenHierarchyFromEdgesRust(edges, maxIterations, maxLevels);
    if (result === null) return Promise.reject(new Error('Graph community hierarchy failed.'));
    return Promise.resolve(result);
  }
}

export class WorkerGraphCommunityCompute implements GraphCommunityComputePort {
  constructor(private readonly createWorker: GraphWorkerFactory = createBrowserWorker) {}

  detect(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityDetectionByIdResult> {
    return this.request(edges, maxIterations, undefined, 'flat', parseWorkerResult, signal);
  }

  detectHierarchy(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    maxLevels: number,
    signal?: AbortSignal,
  ): Promise<RustCommunityHierarchyResult> {
    return this.request(
      edges,
      maxIterations,
      maxLevels,
      'hierarchy',
      parseWorkerHierarchyResult,
      signal,
    );
  }

  private request<T>(
    edges: readonly CommunityEdge[],
    maxIterations: number,
    maxLevels: number | undefined,
    operation: 'flat' | 'hierarchy',
    parse: (value: string | undefined) => T | null,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    const { worker, dispose } = this.createWorker();
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        dispose();
      };
      const abort = (): void => {
        finish();
        reject(new DOMException('Graph community calculation cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      worker.setOnError((event): void => {
        finish();
        reject(new Error(event.message || 'Graph community worker failed.'));
      });
      worker.setOnMessage((event: MessageEvent<WorkerResponse>): void => {
        finish();
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }
        const result = parse(event.data.result);
        if (result === null) {
          reject(new Error('Graph community worker returned an invalid result.'));
          return;
        }
        resolve(result);
      });
      worker.postMessage({
        id: 1,
        wasmBase64: RAG_WASM_BASE64,
        edges,
        maxIterations,
        maxLevels,
        operation,
      });
    });
  }
}

export interface WorkerResponse {
  id: number;
  result?: string;
  error?: string;
}

export interface GraphWorkerHandle {
  worker: GraphWorkerAdapter;
  dispose: () => void;
}

export interface GraphWorkerAdapter {
  setOnError(handler: (event: ErrorEvent) => void): void;
  setOnMessage(handler: (event: MessageEvent<WorkerResponse>) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type GraphWorkerFactory = () => GraphWorkerHandle;

export function createGraphCommunityCompute(): GraphCommunityComputePort {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    return new InlineGraphCommunityCompute();
  }
  return new WorkerGraphCommunityCompute();
}

function parseWorkerResult(value: string | undefined): RustCommunityDetectionByIdResult | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isUnknownArray(parsed.assignmentsById)) return null;
    if (!isUnknownArray(parsed.communityIds) || typeof parsed.modularity !== 'number') return null;
    if (
      !parsed.assignmentsById.every(
        (assignment) =>
          isRecord(assignment) &&
          typeof assignment.entityId === 'string' &&
          isNonNegativeInteger(assignment.communityId),
      ) ||
      !parsed.communityIds.every(isNonNegativeInteger) ||
      !Number.isFinite(parsed.modularity)
    ) {
      return null;
    }
    const assignmentsById = parsed.assignmentsById.map((assignment) => {
      if (!isRecord(assignment)) throw new Error('Invalid graph community assignment.');
      return {
        entityId: String(assignment.entityId),
        communityId: Number(assignment.communityId),
      };
    });
    return {
      assignmentsById,
      communityIds: parsed.communityIds.map(Number),
      modularity: parsed.modularity,
    };
  } catch {
    return null;
  }
}

function parseWorkerHierarchyResult(value: string | undefined): RustCommunityHierarchyResult | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isUnknownArray(parsed.levels)) return null;
    const levels = parsed.levels.map((level) => {
      if (!isRecord(level) || !isNonNegativeInteger(level.level)) return null;
      const detection = parseWorkerResult(JSON.stringify(level));
      return detection === null ? null : { ...detection, level: level.level };
    });
    if (levels.some((level) => level === null)) return null;
    return { levels: levels.filter((level): level is NonNullable<typeof level> => level !== null) };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Graph community calculation cancelled.', 'AbortError');
  }
}

function createBrowserWorker(): GraphWorkerHandle {
  const workerUrl = URL.createObjectURL(
    new Blob([GRAPH_COMMUNITY_WORKER_SOURCE], { type: 'text/javascript' }),
  );
  const browserWorker = new Worker(workerUrl);
  return {
    worker: {
      setOnError: (handler) => {
        browserWorker.onerror = handler;
      },
      setOnMessage: (handler) => {
        browserWorker.onmessage = handler;
      },
      postMessage: (message) => browserWorker.postMessage(message),
      terminate: () => browserWorker.terminate(),
    },
    dispose: () => URL.revokeObjectURL(workerUrl),
  };
}
