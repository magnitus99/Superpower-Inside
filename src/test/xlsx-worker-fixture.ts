import { Worker as NodeWorker } from 'node:worker_threads';
import { XLSX_WORKER_SOURCE } from '../../generated/xlsx-worker-source';

const workers = new Set<NodeWorker>();

/** 실제 브라우저용 번들을 Node worker에서 실행하는 호스트 어댑터입니다. */
export class XlsxTestWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly worker: NodeWorker;

  constructor(_url: string) {
    this.worker = new NodeWorker(
      `
      const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage(message, transfer) { parentPort.postMessage(message, transfer); } };
      ${XLSX_WORKER_SOURCE}
      parentPort.on('message', (data) => self.onmessage({ data }));
    `,
      { eval: true },
    );
    workers.add(this.worker);
    this.worker.on('message', (data: unknown) =>
      this.onmessage?.({ data } as MessageEvent<unknown>),
    );
    this.worker.on('error', () => this.onerror?.());
    this.worker.on('messageerror', () => this.onmessageerror?.());
  }

  postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    this.worker.postMessage(
      message,
      transfer.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer),
    );
  }

  terminate(): void {
    void this.worker.terminate();
  }
}

export async function disposeXlsxTestWorkers(): Promise<void> {
  await Promise.all([...workers].map((worker) => worker.terminate()));
  workers.clear();
}
