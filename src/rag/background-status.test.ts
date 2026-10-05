import { describe, expect, it } from 'vitest';
import { shouldRunRagStatusBackgroundRefresh } from './background-status';

describe('RAG 상태 백그라운드 갱신', () => {
  it('자동 갱신을 켠 경우에만 주기적으로 상태를 확인한다', () => {
    expect(shouldRunRagStatusBackgroundRefresh({ autoUpdateEnabled: true })).toBe(true);
    expect(shouldRunRagStatusBackgroundRefresh({ autoUpdateEnabled: false })).toBe(false);
  });
});
