import type { App } from 'obsidian';
import type { SuperpowerInsideSettings } from './settings';

export const LOCAL_SETTINGS_KEY = 'superpower-inside:settings';

export interface ResolvedSettingsLoadData {
  raw: Record<string, unknown>;
  migratedFromLegacyData: boolean;
}

export function loadLocalSettings(app: App): unknown {
  return app.loadLocalStorage(LOCAL_SETTINGS_KEY) as unknown;
}

export function saveLocalSettings(app: App, settings: SuperpowerInsideSettings): void {
  app.saveLocalStorage(LOCAL_SETTINGS_KEY, settings);
}

export function resolveSettingsLoadData(
  localRaw: unknown,
  legacyRaw: unknown,
): ResolvedSettingsLoadData {
  const hasLocal = isRecord(localRaw);
  const hasLegacy = isRecord(legacyRaw);
  if (hasLocal && hasLegacy) {
    return {
      raw: mergeSettingsRecords(localRaw, legacyRaw),
      migratedFromLegacyData: false,
    };
  }
  if (hasLocal) {
    return { raw: localRaw, migratedFromLegacyData: false };
  }
  if (hasLegacy) {
    return { raw: legacyRaw, migratedFromLegacyData: true };
  }
  return { raw: {}, migratedFromLegacyData: false };
}

function mergeSettingsRecords(
  localRaw: Record<string, unknown>,
  legacyRaw: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...localRaw,
    ...legacyRaw,
  };
  const rag = mergeNestedRecord(localRaw.rag, legacyRaw.rag);
  if (rag !== undefined) {
    merged.rag = rag;
  }
  const chat = mergeNestedRecord(localRaw.chat, legacyRaw.chat);
  if (chat !== undefined) {
    merged.chat = chat;
  }
  return merged;
}

function mergeNestedRecord(localValue: unknown, legacyValue: unknown): unknown {
  if (isRecord(localValue) && isRecord(legacyValue)) {
    return { ...localValue, ...legacyValue };
  }
  return legacyValue === undefined ? localValue : legacyValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
