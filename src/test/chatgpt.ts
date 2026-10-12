import { initializeChatGPTOAuth, chatGPTOAuth } from '../llm/chatgpt-oauth';
import { createAppWithSecretStorage, createFakeSecretStorage, type FakeSecretStorage } from './secret-storage';
import type { RequestUrlResponse, RequestUrlResponsePromise } from 'obsidian';

export function requestUrlPromise(
  response: Promise<RequestUrlResponse>,
): RequestUrlResponsePromise {
  return Object.assign(response, {
    text: Promise.resolve(''),
    json: Promise.resolve({}),
    arrayBuffer: Promise.resolve(new ArrayBuffer(0)),
  });
}

/** 실제 계정 없이 OAuth 저장·provider 계약을 검증하기 위한 기기 보안 저장소. */
export function connectTestChatGPT(profileId = 'profile'): FakeSecretStorage {
  const storage = createFakeSecretStorage();
  initializeChatGPTOAuth(createAppWithSecretStorage(storage));
  storage.setSecret(
    chatGPTOAuth.storageKey(profileId),
    JSON.stringify({
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh',
      accountId: 'account',
      expiresAt: Date.now() + 3_600_000,
    }),
  );
  return storage;
}

export function completedChatGPTResponse(output: unknown[], model = 'selected-model'): string {
  return `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', model, output } })}\n\n`;
}
