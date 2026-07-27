import { describe, expect, it } from 'vitest';
import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import { getPluginAwareServerNames } from './plugin-aware-context7';

describe('플러그인 인식 Context7 서버 선택', () => {
  it('플러그인 인식 생성이 켜졌고 Context7가 연결되어 있으면 내부 서버 목록에 추가한다', () => {
    const servers = getPluginAwareServerNames({
      mentionedServerNames: ['serper'],
      pluginAwareEnabled: true,
      userText: 'TypeScript API 사용법을 알려줘',
      registry: createRegistry('connected'),
    });

    expect(servers).toEqual(['serper', 'context7']);
  });

  it('Context7가 이미 멘션된 경우 중복 추가하지 않는다', () => {
    const servers = getPluginAwareServerNames({
      mentionedServerNames: ['context7'],
      pluginAwareEnabled: true,
      userText: '아무 질문',
      registry: createRegistry('connected'),
    });

    expect(servers).toEqual(['context7']);
  });

  it('플러그인 인식 생성이 꺼졌거나 Context7가 연결되지 않았으면 추가하지 않는다', () => {
    expect(
      getPluginAwareServerNames({
        mentionedServerNames: [],
        pluginAwareEnabled: false,
        userText: 'TypeScript API',
        registry: createRegistry('connected'),
      }),
    ).toEqual([]);
    expect(
      getPluginAwareServerNames({
        mentionedServerNames: [],
        pluginAwareEnabled: true,
        userText: 'TypeScript API',
        registry: createRegistry('disconnected'),
      }),
    ).toEqual([]);
  });

  it('볼트 지식 질문에는 Context7를 자동으로 추가하지 않는다', () => {
    expect(
      getPluginAwareServerNames({
        mentionedServerNames: [],
        pluginAwareEnabled: true,
        userText: '오로라 프로젝트의 진행 상황을 알려줘',
        registry: createRegistry('connected'),
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
