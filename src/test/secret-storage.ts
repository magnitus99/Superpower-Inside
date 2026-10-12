import type { App } from 'obsidian';

export interface FakeSecretStorage {
  values: Map<string, string>;
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  listSecrets(): string[];
}

/** SecretStorage 계약(id 규칙 포함)을 흉내 내는 테스트용 보안 저장소. */
export function createFakeSecretStorage(initial: Record<string, string> = {}): FakeSecretStorage {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, secret) => {
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid secret id: ${id}`);
      values.set(id, secret);
    },
    listSecrets: () => [...values.keys()],
  };
}

export function createAppWithSecretStorage(storage: FakeSecretStorage): App {
  return { secretStorage: storage } as unknown as App;
}
