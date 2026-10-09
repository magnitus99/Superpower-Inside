import { initializeChatGPTOAuth, chatGPTOAuth } from '../llm/chatgpt-oauth';
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

/** 실제 계정 없이 OAuth 저장·provider 계약을 검증하기 위한 기기 저장소. */
export function connectTestChatGPT(profileId = 'profile'): Map<string, unknown> {
  const store = new Map<string, unknown>();
  initializeChatGPTOAuth({
    loadLocalStorage: (key) => store.get(key),
    saveLocalStorage: (key, value: unknown) => {
      store.set(key, value);
    },
  });
  store.set(chatGPTOAuth.storageKey(profileId), {
    accessToken: 'oauth-access',
    refreshToken: 'oauth-refresh',
    accountId: 'account',
    expiresAt: Date.now() + 3_600_000,
  });
  return store;
}

export function completedChatGPTResponse(output: unknown[], model = 'selected-model'): string {
  return `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', model, output } })}\n\n`;
}
