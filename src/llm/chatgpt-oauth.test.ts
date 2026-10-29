import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';
import {
  ChatGPTOAuth,
  initializeChatGPTOAuth,
  migrateChatGPTCredentials,
} from './chatgpt-oauth';
import { requestUrlPromise } from '../test/chatgpt';
import { createAppWithSecretStorage, createFakeSecretStorage } from '../test/secret-storage';

const requestMock = vi.mocked(requestUrl);
const accessToken = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account' } })).toString('base64url')}.signature`;

function visit(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
}

function setup() {
  const store = new Map<string, unknown>();
  const auth = new ChatGPTOAuth({
    load: (key) => store.get(key),
    save: (key, value) => {
      store.set(key, value);
    },
  });
  return { auth, store };
}

beforeEach(() => requestMock.mockReset());

describe('ChatGPT 브라우저 OAuth', () => {
  it('연결 세대는 해당 프로필의 연결 해제에서만 바뀐다', () => {
    const { auth } = setup();
    expect(auth.getRevision('profile')).toBe(0);
    auth.disconnect('other');
    expect(auth.getRevision('profile')).toBe(0);
    auth.disconnect('profile');
    expect(auth.getRevision('profile')).toBe(1);
    auth.dispose();
  });
  it('로그인 제한 시간이 지나면 콜백을 닫고 인증을 저장하지 않는다', async () => {
    const { auth } = setup();
    try {
      const login = await auth.startLogin('timeout', { port: 0, timeoutMs: 20 });
      await expect(login.completed).rejects.toThrow();
      expect(auth.isConnected('timeout')).toBe(false);
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      auth.dispose();
    }
  });

  it('다른 연결 해제는 진행 중 로그인에 영향을 주지 않으며 해당 연결 삭제는 취소한다', async () => {
    const { auth } = setup();
    try {
      const login = await auth.startLogin('logging-in', { port: 0 });
      auth.disconnect('another');
      const callback = new URL(new URL(login.url).searchParams.get('redirect_uri') ?? '');
      expect(await visit(callback.toString())).toBe(400);
      const completion = expect(login.completed).rejects.toMatchObject({ name: 'AbortError' });
      auth.disconnect('logging-in');
      await completion;
    } finally {
      auth.dispose();
    }
  });

  it('정상 갱신은 회전한 토큰을 저장하고 잘못된 계정의 갱신 결과를 거부한다', async () => {
    const { auth, store } = setup();
    try {
      store.set(auth.storageKey('profile'), {
        accessToken,
        refreshToken: 'old',
        accountId: 'account',
        expiresAt: 1,
      });
      requestMock.mockResolvedValueOnce({
        status: 200,
        json: { access_token: accessToken, refresh_token: 'rotated', expires_in: 3600 },
        text: '',
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      });
      expect((await auth.credentials('profile')).refreshToken).toBe('rotated');
      const differentToken = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'different-account' } })).toString('base64url')}.signature`;
      requestMock.mockResolvedValueOnce({
        status: 200,
        json: { access_token: differentToken, refresh_token: 'wrong', expires_in: 3600 },
        text: '',
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      });
      await expect(auth.credentials('profile', true)).rejects.toThrow();
      expect((await auth.credentials('profile')).accountId).toBe('account');
      expect((await auth.credentials('profile')).refreshToken).toBe('rotated');
    } finally {
      auth.dispose();
    }
  });

  it('인증 URL 방문 후 콜백을 자동 수신하고 PKCE로 교환해 기기 저장소에 보관한다', async () => {
    const { auth, store } = setup();
    const login = await auth.startLogin('profile', { port: 0 });
    try {
      const url = new URL(login.url);
      const redirect = url.searchParams.get('redirect_uri');
      const callback = new URL(redirect ?? '');
      callback.searchParams.set('state', url.searchParams.get('state') ?? '');
      callback.searchParams.set('code', 'authorization-code');
      requestMock.mockResolvedValueOnce({
        status: 200,
        json: { access_token: accessToken, refresh_token: 'refresh', expires_in: 3600 },
        text: '',
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      });
      expect(await visit(callback.toString())).toBe(200);
      await login.completed;
      expect(auth.isConnected('profile')).toBe(true);
      expect(store.size).toBe(1);
      const request = requestMock.mock.calls[0]?.[0];
      if (!request || typeof request === 'string' || typeof request.body !== 'string')
        throw new Error('토큰 요청 누락');
      const body = new URLSearchParams(request.body);
      expect(body.get('redirect_uri')).toBe(redirect);
      expect(body.get('code')).toBe('authorization-code');
      expect(
        createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url'),
      ).toBe(url.searchParams.get('code_challenge'));
      const restored = new ChatGPTOAuth({
        load: (key) => store.get(key),
        save: (key, value) => {
          store.set(key, value);
        },
      });
      expect((await restored.credentials('profile')).accountId).toBe('account');
    } finally {
      auth.dispose();
    }
  });

  it('잘못된 state와 경로는 토큰을 교환하지 않고 정상 콜백을 계속 기다린다', async () => {
    const { auth } = setup();
    const login = await auth.startLogin('profile', { port: 0 });
    const completed = login.completed.catch((error: unknown) => error);
    try {
      const callback = new URL(new URL(login.url).searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('state', 'wrong');
      callback.searchParams.set('code', 'attacker');
      expect(await visit(callback.toString())).toBe(400);
      callback.pathname = '/wrong';
      expect(await visit(callback.toString())).toBe(404);
      expect(requestMock).not.toHaveBeenCalled();
      login.cancel();
      expect(await completed).toMatchObject({ name: 'AbortError' });
      expect(auth.isConnected('profile')).toBe(false);
    } finally {
      auth.dispose();
    }
  });

  it('만료 토큰 갱신을 한 번만 실행하고 로그아웃 후 늦은 결과를 저장하지 않는다', async () => {
    const { auth, store } = setup();
    store.set(auth.storageKey('profile'), {
      accessToken,
      refreshToken: 'old',
      accountId: 'account',
      expiresAt: 1,
    });
    let resolveRefresh: ((value: Awaited<ReturnType<typeof requestUrl>>) => void) | undefined;
    requestMock.mockImplementationOnce(() =>
      requestUrlPromise(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      ),
    );
    const first = auth.credentials('profile');
    const second = auth.credentials('profile');
    const results = Promise.allSettled([first, second]);
    auth.disconnect('profile');
    resolveRefresh?.({
      status: 200,
      json: { access_token: accessToken, refresh_token: 'new', expires_in: 3600 },
      text: '',
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    expect((await results).every((result) => result.status === 'rejected')).toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(auth.isConnected('profile')).toBe(false);
  });
});

describe('ChatGPT 보안 저장소 기록', () => {
  it('자격 증명을 보안 저장소에 JSON으로 보관하고 연결 해제 시 값을 비운다', () => {
    const storage = createFakeSecretStorage();
    const auth = initializeChatGPTOAuth(createAppWithSecretStorage(storage));
    try {
      expect(auth.storageKey('Profile_1')).toBe('superpower-inside-chatgpt-oauth-profile-1');
      storage.setSecret(
        auth.storageKey('profile'),
        JSON.stringify({
          accessToken,
          refreshToken: 'refresh',
          accountId: 'account',
          expiresAt: Date.now() + 60_000,
        }),
      );

      expect(auth.isConnected('profile')).toBe(true);
      expect(JSON.parse(storage.getSecret(auth.storageKey('profile')) ?? '')).toMatchObject({
        refreshToken: 'refresh',
      });

      auth.disconnect('profile');

      expect(auth.isConnected('profile')).toBe(false);
      expect(storage.getSecret(auth.storageKey('profile'))).toBe('');
    } finally {
      auth.dispose();
    }
  });

  it('이전 localStorage 자격 증명을 보안 저장소로 옮기고 남은 항목을 지운다', () => {
    const storage = createFakeSecretStorage();
    const local = new Map<string, unknown>([
      [
        'superpower-inside:chatgpt-oauth:profile',
        { accessToken, refreshToken: 'legacy', accountId: 'account', expiresAt: 1 },
      ],
    ]);
    const app = {
      secretStorage: storage,
      loadLocalStorage: (key: string) => local.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => {
        local.set(key, value);
      },
    } as unknown as App;

    expect(migrateChatGPTCredentials(app, ['profile'])).toBe(1);
    expect(JSON.parse(storage.getSecret('superpower-inside-chatgpt-oauth-profile') ?? '')).toMatchObject(
      { refreshToken: 'legacy' },
    );
    expect(local.get('superpower-inside:chatgpt-oauth:profile')).toBeNull();
    expect(migrateChatGPTCredentials(app, ['profile'])).toBe(0);
  });
});
