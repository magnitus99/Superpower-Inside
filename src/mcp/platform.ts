export const MCP_DESKTOP_ONLY_MESSAGE =
  'MCP stdio transport는 Obsidian 데스크톱 앱에서만 사용할 수 있습니다.';

export interface MCPPlatformLike {
  isDesktopApp: boolean;
}

export function isMcpStdioAvailable(platform: MCPPlatformLike): boolean {
  return platform.isDesktopApp;
}
