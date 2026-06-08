import type { App } from 'obsidian';
import type { SuperpowerInsideSettings } from './settings';

export const LOCAL_SETTINGS_KEY = 'superpower-inside:settings';

export function loadLocalSettings(app: App): unknown {
  return app.loadLocalStorage(LOCAL_SETTINGS_KEY) as unknown;
}

export function saveLocalSettings(app: App, settings: SuperpowerInsideSettings): void {
  app.saveLocalStorage(LOCAL_SETTINGS_KEY, settings);
}
