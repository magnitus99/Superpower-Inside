import { describe, expect, it } from 'vitest';
import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import { getPluginAwareServerNames } from './plugin-aware-context7';

describe('플러그인 인식 Context7 서버 선택', () => {
  it('플러그인 인식 생성이 켜졌고 Context7가 연결되어 있으면 내부 서버 목록에 추가한다', () => {
    const servers = getPluginAwareServerNames({
      mentionedServerNames: ['serper'],
      pluginAwareEnabled: true,
      registry: createRegistry('connected'),
    });

    expect(servers).toEqual(['serper', 'context7']);
  });

  it('Context7가 이미 멘션된 경우 중복 추가하지 않는다', () => {
    const servers = getPluginAwareServerNames({
      mentionedServerNames: ['context7'],
      pluginAwareEnabled: true,
      registry: createRegistry('connected'),
    });

    expect(servers).toEqual(['context7']);
  });

  it('플러그인 인식 생성이 꺼졌거나 Context7가 연결되지 않았으면 추가하지 않는다', () => {
    expect(
      getPluginAwareServerNames({
        mentionedServerNames: [],
        pluginAwareEnabled: false,
        registry: createRegistry('connected'),
      }),
    ).toEqual([]);
    expect(
      getPluginAwareServerNames({
        mentionedServerNames: [],
        pluginAwareEnabled: true,
        registry: createRegistry('disconnected'),
      }),
    ).toEqual([]);
  });
});

function createRegistry(status: MCPServerConnectionStatus) {
  return {
    getEnabledServers: () => [
      { name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    ],
    getConnectionStatus: (name: string) => (name === 'context7' ? status : 'disconnected'),
  };
}
