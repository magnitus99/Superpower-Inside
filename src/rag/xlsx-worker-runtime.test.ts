import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { extractXlsxSourceText, disposeXlsxWorker } from './xlsx-worker-runtime';
import { XlsxTestWorker, disposeXlsxTestWorkers } from '../test/xlsx-worker-fixture';

const file = { path: 'synthetic/source.xlsx', extension: 'xlsx', stat: { size: 100 } } as TFile;
type MockVault = Omit<Vault, 'readBinary'> & {
  readBinary: ReturnType<typeof vi.fn<() => Promise<ArrayBuffer>>>;
};
const vault = (bytes = new ArrayBuffer(4)): MockVault =>
  ({ readBinary: vi.fn(() => Promise.resolve(bytes)) }) as unknown as MockVault;

class PendingWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(_url: string) {
    pendingWorkers.push(this);
  }
}
const pendingWorkers: PendingWorker[] = [];

beforeEach(() => {
  pendingWorkers.length = 0;
  vi.stubGlobal('Worker', PendingWorker);
});
afterEach(async () => {
  disposeXlsxWorker();
  await disposeXlsxTestWorkers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('XLSX 워커 실행 경계', () => {
  it('생성된 실제 워커가 손상 파일을 실패로 반환한다', async () => {
    vi.stubGlobal('Worker', XlsxTestWorker);
    await expect(extractXlsxSourceText(vault(), file)).rejects.toMatchObject({ reason: 'corrupt' });
  });

  it('워커가 없으면 메인 스레드 추출로 대체하지 않는다', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(extractXlsxSourceText(vault(), file)).rejects.toMatchObject({
      reason: 'worker-unavailable',
    });
  });

  it('메모리 예산 밖 원본은 읽기 전에 거부한다', async () => {
    const source = vault();
    await expect(
      extractXlsxSourceText(source, {
        ...file,
        stat: { ...file.stat, size: 128 * 1024 * 1024 + 1 },
      }),
    ).rejects.toMatchObject({ reason: 'memory-budget' });
    expect(source.readBinary).not.toHaveBeenCalled();
  });

  it('동시 요청은 원본 읽기부터 순차 실행하고 완료 시 워커를 종료한다', async () => {
    const source = vault();
    const first = extractXlsxSourceText(source, file);
    const second = extractXlsxSourceText(source, file);
    await vi.waitFor(() => expect(pendingWorkers).toHaveLength(1));
    expect(source.readBinary).toHaveBeenCalledTimes(1);
    pendingWorkers[0]?.onmessage?.({
      data: {
        ok: true,
        bytes: new TextEncoder().encode('Alpha'),
        segmentsJson: '[{"label":"Sheet 1","startLine":0,"endLine":0}]',
      },
    } as MessageEvent<unknown>);
    await expect(first).resolves.toMatchObject({ text: 'Alpha' });
    expect(pendingWorkers[0]?.terminate).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(pendingWorkers).toHaveLength(2));
    pendingWorkers[1]?.onmessage?.({
      data: { ok: false, reason: 'memory-budget', bytes: new TextEncoder().encode('partial') },
    } as MessageEvent<unknown>);
    await expect(second).rejects.toMatchObject({ reason: 'memory-budget' });
    expect(pendingWorkers[1]?.terminate).toHaveBeenCalledOnce();
  });

  it('시간 예산 초과 시 종료하며 부분 본문을 반환하지 않는다', async () => {
    vi.useFakeTimers();
    const result = extractXlsxSourceText(vault(), file);
    const assertion = expect(result).rejects.toMatchObject({ reason: 'time-budget' });
    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
    expect(pendingWorkers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('취소와 늦은 응답은 성공 결과를 만들지 않는다', async () => {
    const controller = new AbortController();
    const result = extractXlsxSourceText(vault(), file, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(pendingWorkers).toHaveLength(1));
    controller.abort();
    await assertion;
    pendingWorkers[0]?.onmessage?.({
      data: { ok: true, bytes: new TextEncoder().encode('late'), segmentsJson: '[]' },
    } as MessageEvent<unknown>);
    expect(pendingWorkers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('잘못된 구간 경계는 성공으로 받아들이지 않는다', async () => {
    const result = extractXlsxSourceText(vault(), file);
    const assertion = expect(result).rejects.toMatchObject({ reason: 'worker-failed' });
    await vi.waitFor(() => expect(pendingWorkers).toHaveLength(1));
    pendingWorkers[0]?.onmessage?.({
      data: {
        ok: true,
        bytes: new TextEncoder().encode('Alpha'),
        segmentsJson: '[{"label":"Sheet 1","startLine":2,"endLine":1}]',
      },
    } as MessageEvent<unknown>);
    await assertion;
  });
});
