import type { App } from 'obsidian';

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
  const ids = getActivePluginIds(app);
  if (ids.length === 0) return '';
  const lines = ids
    .map((id) => {
      const version = getPluginVersion(app, id);
      return version ? `- ${id} (v${version})` : `- ${id}`;
    })
    .join('\n');
  return `\n\n[Active Obsidian Plugins]\n${lines}`;
}
