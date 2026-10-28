import { initializeGoogleGeminiOAuth, googleGeminiOAuth } from '../llm/google-gemini-oauth';
import { createAppWithSecretStorage, createFakeSecretStorage, type FakeSecretStorage } from './secret-storage';

/** 실제 Google 계정 없이 OAuth 저장·provider 계약을 검증하기 위한 기기 보안 저장소. */
export function connectTestGemini(profileId = 'profile'): FakeSecretStorage {
  const storage = createFakeSecretStorage();
  initializeGoogleGeminiOAuth(createAppWithSecretStorage(storage));
  storage.setSecret(
    googleGeminiOAuth.storageKey(profileId),
    JSON.stringify({
      accessToken: 'gemini-access',
      refreshToken: 'gemini-refresh',
      expiresAt: Date.now() + 3_600_000,
      projectId: 'gemini-project',
    }),
  );
  return storage;
}
