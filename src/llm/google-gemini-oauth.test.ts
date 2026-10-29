import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestUrlMock = vi.hoisted(() => vi.fn());
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { GoogleGeminiOAuth, type GeminiCredentials } from './google-gemini-oauth';

function store(initial: GeminiCredentials | null) {
  let value = initial;
  return {
    load: () => value,
    save: (_key: string, next: unknown) => {
      value = next as GeminiCredentials | null;
    },
    current: () => value,
  };
}

function credentials(overrides: Partial<GeminiCredentials> = {}): GeminiCredentials {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3_600_000,
    projectId: 'project-1',
    ...overrides,
  };
}

beforeEach(() => {
  requestUrlMock.mockReset();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});

describe('Google Gemini OAuth', () => {
  it('다시 연결한 계정과 이전 조회를 연결 세대로 구분한다', () => {
    const auth = new GoogleGeminiOAuth(store(credentials()));
    expect(auth.getRevision('profile')).toBe(0);
    auth.disconnect('other');
    expect(auth.getRevision('profile')).toBe(0);
    auth.disconnect('profile');
    expect(auth.getRevision('profile')).toBe(1);
    auth.dispose();
  });
  it('저장된 자격 증명을 연결 상태로 읽는다', () => {
    const auth = new GoogleGeminiOAuth(store(credentials()));
    expect(auth.isConnected('profile')).toBe(true);
    auth.disconnect('profile');
    expect(auth.isConnected('profile')).toBe(false);
  });

  it('만료된 토큰을 refresh하고 프로젝트를 보존한다', async () => {
    const state = store(credentials({ expiresAt: Date.now() - 1 }));
    const auth = new GoogleGeminiOAuth(state);
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { access_token: 'new-access', expires_in: 3600 },
    });

    expect(await auth.credentials('profile')).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'refresh',
      projectId: 'project-1',
    });
    expect(requestUrlMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
    });
    const request = requestUrlMock.mock.calls[0]?.[0] as { body?: string } | undefined;
    expect(request?.body ?? '').toContain('refresh_token=refresh');
    expect(state.current()).toMatchObject({ accessToken: 'new-access', projectId: 'project-1' });
  });

  it('브라우저 콜백과 Code Assist 프로젝트 발견으로 자격 증명을 저장한다', async () => {
    const state = store(null);
    const auth = new GoogleGeminiOAuth(state);
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: { access_token: 'login-access', refresh_token: 'login-refresh', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        status: 200,
        json: { cloudaicompanionProject: 'project-from-google' },
      });
    const login = await auth.startLogin('profile');
    const authUrl = new URL(login.url);
    const redirectUri = authUrl.searchParams.get('redirect_uri');
    const oauthState = authUrl.searchParams.get('state');
    if (!redirectUri || !oauthState) throw new Error('redirect state missing');
    const response = await fetch(
      `${redirectUri}?code=synthetic-code&state=${encodeURIComponent(oauthState)}`,
    );
    expect(response.status).toBe(200);
    await login.completed;
    expect(state.current()).toMatchObject({
      accessToken: 'login-access',
      refreshToken: 'login-refresh',
      projectId: 'project-from-google',
    });
  });

  it('연결이 없으면 Gemini 요청 자격 증명을 만들지 않는다', async () => {
    const auth = new GoogleGeminiOAuth(store(null));
    await expect(auth.credentials('profile')).rejects.toThrow();
  });
});
