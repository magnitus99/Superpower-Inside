import { describe, expect, it } from 'vitest';
import { isMcpStdioAvailable } from './platform';

describe('MCP platform guard', () => {
  it('데스크톱 앱에서만 stdio MCP를 허용한다', () => {
    expect(isMcpStdioAvailable({ isDesktopApp: true })).toBe(true);
    expect(isMcpStdioAvailable({ isDesktopApp: false })).toBe(false);
  });
});
