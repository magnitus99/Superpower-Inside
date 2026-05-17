import { describe, expect, it } from 'vitest';
import { shouldAppendMcpPathHint } from './errors';

describe('shouldAppendMcpPathHint', () => {
  it('상대 명령어가 ENOENT로 실패하면 PATH 힌트를 표시한다', () => {
    expect(shouldAppendMcpPathHint('npx', 'spawn npx ENOENT')).toBe(true);
    expect(shouldAppendMcpPathHint('uvx', 'spawn uvx ENOENT')).toBe(true);
  });

  it('절대경로 명령어나 ENOENT가 아닌 오류에는 PATH 힌트를 표시하지 않는다', () => {
    expect(shouldAppendMcpPathHint('/opt/homebrew/bin/npx', 'spawn npx ENOENT')).toBe(false);
    expect(shouldAppendMcpPathHint('npx', 'permission denied')).toBe(false);
  });
});
