import { describe, expect, it } from 'vitest';
import {
  InlineGraphCommunityCompute,
  WorkerGraphCommunityCompute,
  type GraphWorkerHandle,
  type WorkerResponse,
} from './community-compute';

describe('Graph community compute', () => {
  it('지원 환경에서는 edge 계산을 Worker 메시지 경계로 전달한다', async () => {
    const fakeWorker = new FakeWorker();
    const compute = new WorkerGraphCommunityCompute(
      (): GraphWorkerHandle => ({ worker: fakeWorker, dispose: () => undefined }),
    );
    const resultPromise = compute.detect([{ source: 'a', target: 'b', weight: 0.8 }], 20);

    expect(fakeWorker.lastRequest).toEqual(
      expect.objectContaining({
        edges: [{ source: 'a', target: 'b', weight: 0.8 }],
        maxIterations: 20,
      }),
    );
    fakeWorker.respond({
      id: 1,
      result: JSON.stringify({
        assignmentsById: [
          { entityId: 'a', communityId: 0 },
          { entityId: 'b', communityId: 0 },
        ],
        communityIds: [0],
        modularity: 0.25,
      }),
    });

    await expect(resultPromise).resolves.toEqual({
      assignmentsById: [
        { entityId: 'a', communityId: 0 },
        { entityId: 'b', communityId: 0 },
      ],
      communityIds: [0],
      modularity: 0.25,
    });
    expect(fakeWorker.terminated).toBe(true);
  });

  it('Worker 미지원 테스트 어댑터도 동일한 비동기 포트 계약을 지킨다', async () => {
    const compute = new InlineGraphCommunityCompute();
    const result = await compute.detect([{ source: 'a', target: 'b', weight: 1 }], 20);

    expect(result.assignmentsById).toHaveLength(2);
    expect(result.communityIds).toHaveLength(1);
  });
});

class FakeWorker {
  private onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  lastRequest: unknown;
  terminated = false;

  setOnError(handler: (event: ErrorEvent) => void): void {
    void handler;
  }

  setOnMessage(
    handler: (event: MessageEvent<WorkerResponse>) => void,
  ): void {
    this.onmessage = handler;
  }

  postMessage(message: unknown): void {
    this.lastRequest = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(data: WorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}
