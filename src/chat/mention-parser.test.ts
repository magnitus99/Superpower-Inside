import { describe, expect, it } from 'vitest';
import { parseMentions, type MentionResolver } from './mention-parser';

function resolver(): MentionResolver {
  const servers = new Set(['browser', 'filesystem']);
  const files = new Set(['Notes/today.md', 'Project Plan.md']);
  const folders = new Set(['Notes', 'Projects/Alpha']);
  return {
    isServer: (name) => servers.has(name),
    isFile: (name) => files.has(name),
    isFolder: (name) => folders.has(name),
  };
}

describe('parseMentions', () => {
  it('일반 파일, 폴더, MCP 서버 멘션을 분류한다', () => {
    expect(parseMentions('@browser @Notes/today.md @Notes', resolver())).toEqual([
      { raw: '@browser', type: 'server', name: 'browser' },
      { raw: '@Notes/today.md', type: 'file', name: 'Notes/today.md' },
      { raw: '@Notes', type: 'folder', name: 'Notes' },
    ]);
  });

  it('공백이 있는 경로는 브래킷 표기법으로 파싱한다', () => {
    expect(parseMentions('검토해줘 @[Project Plan.md]', resolver())).toEqual([
      { raw: '@[Project Plan.md]', type: 'file', name: 'Project Plan.md' },
    ]);
  });

  it('같은 대상은 표기법이 달라도 한 번만 반환한다', () => {
    expect(parseMentions('@[Project Plan.md] @[Project Plan.md]', resolver())).toEqual([
      { raw: '@[Project Plan.md]', type: 'file', name: 'Project Plan.md' },
    ]);
  });

  it('알 수 없는 멘션은 버린다', () => {
    expect(parseMentions('@missing @filesystem', resolver())).toEqual([
      { raw: '@filesystem', type: 'server', name: 'filesystem' },
    ]);
  });
});
