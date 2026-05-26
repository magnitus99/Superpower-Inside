import type { App } from 'obsidian';
import type { SuperpowerInsideSettings } from './settings';

export const LOCAL_SETTINGS_KEY = 'superpower-inside:settings';

export function loadLocalSettings(app: App): unknown {
  return app.loadLocalStorage(LOCAL_SETTINGS_KEY) as unknown;
}

export function saveLocalSettings(app: App, settings: SuperpowerInsideSettings): void {
  app.saveLocalStorage(LOCAL_SETTINGS_KEY, settings);
}

export async function removeLegacyDataJson(app: App, pluginId: string): Promise<void> {
  const configDir = app.vault.configDir || '.obsidian';
  const path = `${configDir}/plugins/${pluginId}/data.json`;
  try {
    if (await app.vault.adapter.exists(path)) {
      await app.vault.adapter.remove(path);
    }
  } catch (err) {
    console.warn('[Superpower Inside] Failed to remove legacy data.json after migration.', err);
  }
}
