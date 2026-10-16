import type { App } from 'obsidian';
import { t } from '../i18n';

interface PluginManifestLike {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
}

export interface ActivePluginInfo {
  id: string;
  name?: string;
  version?: string;
  description?: string;
}

/** 공개 타입에 없는 데스크톱 설정 창 접근을 호스트 경계 한곳에 둡니다. */
export function openPluginSettings(app: App, pluginId: string): void {
  const host = app as App & {
    setting: { open(): void; openTabById(id: string): void };
  };
  host.setting.open();
  host.setting.openTabById(pluginId);
}

export function getActivePluginInfo(app: App): ActivePluginInfo[] {
  try {
    const plugins = (app as unknown as Record<string, unknown>).plugins as
      | { plugins?: Record<string, unknown> }
      | undefined;
    if (!plugins?.plugins) return [];
    return Object.entries(plugins.plugins).map(([id, plugin]) => {
      const manifest = readPluginManifest(plugin);
      return {
        id,
        name: manifest?.name,
        version: manifest?.version,
        description: manifest?.description,
      };
    });
  } catch {
    return [];
  }
}

export function formatActivePluginsForPrompt(app: App): string {
  const plugins = getActivePluginInfo(app);
  if (plugins.length === 0) return '';
  const lines = plugins
    .map((plugin) => {
      const label =
        plugin.name && plugin.name !== plugin.id ? `${plugin.name} (${plugin.id})` : plugin.id;
      const version = plugin.version ? ` v${plugin.version}` : '';
      const description = plugin.description ? ` - ${plugin.description}` : '';
      return `- ${label}${version}${description}`;
    })
    .join('\n');
  return [
    `\n\n[Active Obsidian Plugins]\n${lines}`,
    '[Plugin-Aware Generation Rules]',
    t('pluginAwareContext7FirstRule'),
    t('pluginAwareContext7NoGuessRule'),
  ].join('\n');
}

function readPluginManifest(plugin: unknown): PluginManifestLike | null {
  if (typeof plugin !== 'object' || plugin === null) return null;
  const manifest = (plugin as Record<string, unknown>).manifest;
  if (typeof manifest !== 'object' || manifest === null) return null;
  const record = manifest as Record<string, unknown>;
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
  };
}
