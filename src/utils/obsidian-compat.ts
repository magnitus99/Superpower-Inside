import type { App } from 'obsidian';
import { t } from '../i18n';

interface PluginManifestLike {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
}

interface ActivePluginInfo {
  id: string;
  name?: string;
  version?: string;
  description?: string;
}

export function getActivePluginIds(app: App): string[] {
  try {
    const plugins = (app as unknown as Record<string, unknown>).plugins as
      | { plugins?: Record<string, unknown> }
      | undefined;
    if (!plugins?.plugins) return [];
    return Object.keys(plugins.plugins);
  } catch {
    return [];
  }
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

export function isPluginActive(app: App, pluginId: string): boolean {
  return getActivePluginIds(app).includes(pluginId);
}

export function getPluginVersion(app: App, pluginId: string): string | undefined {
  try {
    const plugins = (app as unknown as Record<string, unknown>).plugins as
      | { plugins?: Record<string, { manifest?: { version?: string } }> }
      | undefined;
    return plugins?.plugins?.[pluginId]?.manifest?.version;
  } catch {
    return undefined;
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
