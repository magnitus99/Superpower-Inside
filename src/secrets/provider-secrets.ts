import type { App, SecretStorage } from 'obsidian';
import type {
  CustomOpenAIProviderConfig,
  ProviderConfig,
  ProviderKey,
  ProviderProfileConfig,
  SuperpowerInsideSettings,
} from '../settings';
import { appLogger } from '../utils/logger';

export type ProviderKeyState = 'present' | 'missing-on-device' | 'unset';

export type ProviderSecretConfig =
  | ProviderConfig
  | ProviderProfileConfig
  | CustomOpenAIProviderConfig;

const SECRET_PREFIX = 'superpower-inside-';
/** SecretStorage id는 소문자 영숫자와 대시만 허용한다. */
const SECRET_ID_PATTERN = /^[a-z0-9-]+$/;

const LEGACY_SECRET_BASES: Record<ProviderKey, string> = {
  openai: `${SECRET_PREFIX}openai`,
  claude: `${SECRET_PREFIX}claude`,
  ollama: `${SECRET_PREFIX}ollama`,
  ollamaCloud: `${SECRET_PREFIX}ollama-cloud`,
  openRouter: `${SECRET_PREFIX}open-router`,
};

/** 프로파일·커스텀 프로바이더처럼 고유 id를 가진 설정의 비밀값 이름 기준. */
function providerSecretBaseForId(id: string): string {
  return `${SECRET_PREFIX}${secretIdSegment(id)}`;
}

/** SecretStorage를 쓸 수 없는 환경이면 null. */
export function readSecretStorage(app: App): SecretStorage | null {
  const storage = app.secretStorage as SecretStorage | undefined;
  if (!storage) return null;
  return typeof storage.getSecret === 'function' &&
    typeof storage.setSecret === 'function' &&
    typeof storage.listSecrets === 'function'
    ? storage
    : null;
}

/** 프로바이더 설정에서 비밀값 이름을 파생할 때 쓰는 id 조각. */
export function secretIdSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'provider';
}

function providerSecretConfigs(
  settings: SuperpowerInsideSettings,
): Array<{ config: ProviderSecretConfig; base: string }> {
  const entries: Array<{ config: ProviderSecretConfig; base: string }> = [];
  for (const key of Object.keys(LEGACY_SECRET_BASES) as ProviderKey[]) {
    entries.push({ config: settings[key], base: LEGACY_SECRET_BASES[key] });
  }
  for (const provider of settings.customOpenAIProviders) {
    entries.push({ config: provider, base: providerSecretBaseForId(provider.id) });
  }
  for (const profile of settings.providerProfiles) {
    entries.push({ config: profile, base: providerSecretBaseForId(profile.id) });
  }
  return entries;
}

function writeSecret(storage: SecretStorage, id: string, value: string): boolean {
  try {
    storage.setSecret(id, value);
    return true;
  } catch (error) {
    appLogger.warn('Secret storage rejected a write.', { source: 'secrets.storage', error });
    return false;
  }
}

/** 쓰이지 않는 이름을 피해 비밀값 이름을 확보한다. */
function allocateSecretId(storage: SecretStorage, base: string): string {
  const taken = new Set(storage.listSecrets());
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function ensureSecretId(storage: SecretStorage, config: ProviderSecretConfig, base: string): string {
  const existing = config.apiKeySecret;
  if (existing && SECRET_ID_PATTERN.test(existing)) return existing;
  const id = allocateSecretId(storage, base);
  config.apiKeySecret = id;
  return id;
}

/** 평문 키를 보안 저장소로 옮긴다. 기록에 성공한 항목만 changed로 집계해 평문 유실을 막는다. */
export function migrateProviderKeysToKeychain(
  app: App,
  settings: SuperpowerInsideSettings,
): { changed: boolean; migrated: number } {
  const storage = readSecretStorage(app);
  if (!storage) return { changed: false, migrated: 0 };
  let changed = false;
  let migrated = 0;
  for (const { config, base } of providerSecretConfigs(settings)) {
    const value = config.apiKey.trim();
    if (!value) continue;
    const id = ensureSecretId(storage, config, base);
    if (storage.getSecret(id)) {
      changed = true;
      continue;
    }
    if (!writeSecret(storage, id, value)) continue;
    migrated += 1;
    changed = true;
  }
  return { changed, migrated };
}

/** 보안 저장소 값으로 메모리 apiKey를 채운다. 보안 저장소를 못 쓰면 로드된 값을 그대로 둔다. */
export function hydrateProviderApiKeys(app: App, settings: SuperpowerInsideSettings): void {
  const storage = readSecretStorage(app);
  if (!storage) return;
  for (const { config } of providerSecretConfigs(settings)) {
    config.apiKey = config.apiKeySecret ? (storage.getSecret(config.apiKeySecret) ?? '') : '';
  }
}

/** 저장용 사본에서 키 원문을 제거한다. 비밀값 이름은 남긴다. */
export function settingsForPersistence(
  settings: SuperpowerInsideSettings,
): SuperpowerInsideSettings {
  const clone = structuredClone(settings);
  for (const { config } of providerSecretConfigs(clone)) {
    config.apiKey = '';
    delete config.relayApiKey;
  }
  return clone;
}

/** 메모리의 키 원문을 보안 저장소에 반영한다. 저장 직전에 호출한다. */
export function persistProviderApiKeys(app: App, settings: SuperpowerInsideSettings): number {
  const storage = readSecretStorage(app);
  if (!storage) return 0;
  let written = 0;
  for (const { config, base } of providerSecretConfigs(settings)) {
    const value = config.apiKey.trim();
    if (!value && !config.apiKeySecret) continue;
    if (writeSecret(storage, ensureSecretId(storage, config, base), value)) written += 1;
  }
  return written;
}

export function providerKeyState(config: ProviderSecretConfig): ProviderKeyState {
  if (config.apiKey.trim()) return 'present';
  return config.apiKeySecret ? 'missing-on-device' : 'unset';
}

/** 리셋 시 이 플러그인이 만든 보안 저장소 항목을 무효화한다. 삭제 API가 없어 빈 값으로 대체한다. */
export function neutralizeProviderSecrets(app: App, settings: SuperpowerInsideSettings): number {
  const storage = readSecretStorage(app);
  if (!storage) return 0;
  let count = 0;
  for (const { config, base } of providerSecretConfigs(settings)) {
    const id = config.apiKeySecret ?? base;
    if (storage.getSecret(id) === null) continue;
    if (writeSecret(storage, id, '')) count += 1;
  }
  return count;
}
