import { t } from '../i18n';

export function getMcpDesktopOnlyMessage(): string {
  return t('mcpDesktopOnly');
}

export interface MCPPlatformLike {
  isDesktopApp: boolean;
}

export function isMcpStdioAvailable(platform: MCPPlatformLike): boolean {
  return platform.isDesktopApp;
}
