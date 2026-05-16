import { describe, expect, it } from 'vitest';
import { MCPRegistry } from './registry';

describe('MCPRegistry', () => {
  it('실패한 서버 이름만 재시도 대상으로 반환한다', () => {
    const registry = new MCPRegistry([
      { name: 'ok', command: 'node' },
      { name: 'failed', command: 'missing-command' },
      { name: 'pending', command: 'npx' },
    ]);

    registry.setConnectionStatus('ok', 'connected');
    registry.setConnectionStatus('failed', 'error', 'command not found');
    registry.setConnectionStatus('pending', 'connecting');

    expect(registry.getFailedServerNames()).toEqual(['failed']);
    expect(registry.getLastError('failed')).toBe('command not found');
  });

  it('실패 서버가 재연결되면 마지막 오류를 지운다', () => {
    const registry = new MCPRegistry([{ name: 'filesystem', command: 'npx' }]);

    registry.setConnectionStatus('filesystem', 'error', 'spawn failed');
    registry.setConnectionStatus('filesystem', 'connected');

    expect(registry.getFailedServerNames()).toEqual([]);
    expect(registry.getLastError('filesystem')).toBeUndefined();
    expect(registry.getConnectedCount()).toBe(1);
  });
});
