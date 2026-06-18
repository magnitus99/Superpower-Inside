import { describe, expect, it } from 'vitest';
import { shouldRunRagStatusBackgroundRefresh } from './background-status';

describe('shouldRunRagStatusBackgroundRefresh', () => {
  it('자동 업데이트와 GraphRAG가 모두 꺼져 있으면 startup status scan을 실행하지 않는다', () => {
    expect(
      shouldRunRagStatusBackgroundRefresh({
        autoUpdateEnabled: false,
        graphRagEnabled: false,
        graphRagAutoSyncEnabled: false,
      }),
    ).toBe(false);
  });

  it('자동 업데이트나 GraphRAG가 켜져 있으면 background status refresh를 유지한다', () => {
    expect(
      shouldRunRagStatusBackgroundRefresh({
        autoUpdateEnabled: true,
        graphRagEnabled: false,
        graphRagAutoSyncEnabled: false,
      }),
    ).toBe(true);
    expect(
      shouldRunRagStatusBackgroundRefresh({
        autoUpdateEnabled: false,
        graphRagEnabled: true,
        graphRagAutoSyncEnabled: false,
      }),
    ).toBe(true);
    expect(
      shouldRunRagStatusBackgroundRefresh({
        autoUpdateEnabled: false,
        graphRagEnabled: false,
        graphRagAutoSyncEnabled: true,
      }),
    ).toBe(true);
  });
});
