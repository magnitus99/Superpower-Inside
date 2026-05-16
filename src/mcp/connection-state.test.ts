import { describe, expect, it } from 'vitest';
import { getMcpConnectionState } from './connection-state';

describe('getMcpConnectionState', () => {
  it('등록된 서버가 없으면 idle 상태를 반환한다', () => {
    expect(
      getMcpConnectionState({
        totalCount: 0,
        connectedCount: 0,
        failedCount: 0,
        isConnecting: false,
      }),
    ).toBe('idle');
  });

  it('연결 시도 중이면 connecting 상태를 우선한다', () => {
    expect(
      getMcpConnectionState({
        totalCount: 2,
        connectedCount: 1,
        failedCount: 1,
        isConnecting: true,
      }),
    ).toBe('connecting');
  });

  it('모든 서버가 연결되면 connected 상태를 반환한다', () => {
    expect(
      getMcpConnectionState({
        totalCount: 2,
        connectedCount: 2,
        failedCount: 0,
        isConnecting: false,
      }),
    ).toBe('connected');
  });

  it('일부 서버만 실패하면 partial-error 상태를 반환한다', () => {
    expect(
      getMcpConnectionState({
        totalCount: 2,
        connectedCount: 1,
        failedCount: 1,
        isConnecting: false,
      }),
    ).toBe('partial-error');
  });

  it('연결된 서버 없이 실패만 있으면 error 상태를 반환한다', () => {
    expect(
      getMcpConnectionState({
        totalCount: 2,
        connectedCount: 0,
        failedCount: 2,
        isConnecting: false,
      }),
    ).toBe('error');
  });
});
