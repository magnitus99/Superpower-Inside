import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { requestUrl, type App, type SecretStorage } from 'obsidian';
import { t } from '../i18n';
import { planGeminiRust } from '../rag/rust-core';
import { readSecretStorage, secretIdSegment } from '../secrets/provider-secrets';
import type { AppLogger } from '../utils/logger';

const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal';
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');
const CLIENT_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
};

function geminiSecretId(profileId: string): string {
  return `superpower-inside-gemini-oauth-${secretIdSegment(profileId)}`;
}

export interface GeminiCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId: string;
  email?: string;
}

interface CredentialStore {
  load(key: string): unknown;
  save(key: string, value: unknown): void;
}

interface GeminiProjectPlan {
  projectId?: string;
  tierId?: string;
  needsOnboard?: boolean;
  error?: string;
}

/** Google OAuth와 Cloud Code Assist 프로젝트 발견을 담당한다. */
export class GoogleGeminiOAuth {
  private pendingLogin: { profileId: string; cancel(): void } | undefined;
  private readonly refreshes = new Map<string, Promise<GeminiCredentials>>();
  private readonly revisions = new Map<string, number>();
  private disposed = false;

  constructor(
    private readonly store: CredentialStore,
    private readonly logger?: AppLogger,
  ) {}

  storageKey(profileId: string): string {
    return geminiSecretId(profileId);
  }

  private load(profileId: string): GeminiCredentials | null {
    return planGeminiRust<GeminiCredentials>({
      operation: 'credentials',
      value: this.store.load(this.storageKey(profileId)),
    });
  }

  isConnected(profileId: string): boolean {
    return !this.disposed && this.load(profileId) !== null;
  }

  /** 연결 해제·재로그인 전의 늦은 조회 결과를 구분하는 메모리 세대입니다. */
  getRevision(profileId: string): number {
    return this.revisions.get(profileId) ?? 0;
  }

  disconnect(profileId: string): void {
    this.cancelLogin(profileId);
    this.revisions.set(profileId, (this.revisions.get(profileId) ?? 0) + 1);
    this.store.save(this.storageKey(profileId), null);
    this.logger?.debug('Google Gemini account disconnected.', { source: 'llm.gemini.oauth' });
  }

  dispose(): void {
    this.disposed = true;
    this.pendingLogin?.cancel();
  }

  cancelLogin(profileId: string): void {
    if (this.pendingLogin?.profileId === profileId) this.pendingLogin.cancel();
  }

  async startLogin(
    profileId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ url: string; completed: Promise<void>; cancel(): void }> {
    if (this.disposed) throw new Error(t('geminiOAuthUnavailable'));
    this.pendingLogin?.cancel();
    const revision = (this.revisions.get(profileId) ?? 0) + 1;
    this.revisions.set(profileId, revision);
    const state = randomBytes(32).toString('base64url');
    const server = createServer();
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    let resolveLogin: () => void = () => {};
    let rejectLogin: (error: Error) => void = () => {};
    const completed = new Promise<void>((resolve, reject) => {
      resolveLogin = resolve;
      rejectLogin = reject;
    });
    void completed.catch(() => undefined);
    let finished = false;
    let exchanging = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (error) server.closeAllConnections();
      if (this.pendingLogin?.cancel === cancel) this.pendingLogin = undefined;
      if (error) rejectLogin(error);
      else resolveLogin();
    };
    const cancel = (): void => finish(new DOMException(t('geminiOAuthCancelled'), 'AbortError'));
    const timer = window.setTimeout(
      () => finish(new Error(t('geminiOAuthTimeout'))),
      options.timeoutMs ?? 5 * 60_000,
    );
    this.pendingLogin = { profileId, cancel };
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch {
      const error = new Error(t('geminiOAuthUnavailable'));
      finish(error);
      throw error;
    }
    server.on('error', () => finish(new Error(t('geminiOAuthUnavailable'))));
    const address = server.address();
    if (!address || typeof address === 'string') {
      cancel();
      throw new Error(t('geminiOAuthUnavailable'));
    }
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
    server.on('request', (request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Connection', 'close');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      let callback: URL;
      try {
        callback = new URL(request.url ?? '/', redirectUri);
      } catch {
        response.writeHead(400).end(t('geminiOAuthInvalidCallback'));
        return;
      }
      if (
        request.method !== 'GET' ||
        callback.origin !== new URL(redirectUri).origin ||
        callback.pathname !== '/oauth2callback'
      ) {
        response.writeHead(404).end();
        return;
      }
      if (callback.searchParams.get('state') !== state) {
        response.writeHead(400).end(t('geminiOAuthInvalidCallback'));
        return;
      }
      if (callback.searchParams.get('error')) {
        response.writeHead(400).end(t('geminiOAuthFailed'));
        finish(new Error(t('geminiOAuthFailed')));
        return;
      }
      const code = callback.searchParams.get('code');
      if (!code || exchanging || finished) {
        response.writeHead(400).end(t('geminiOAuthInvalidCallback'));
        return;
      }
      exchanging = true;
      void this.exchangeCode(code, redirectUri)
        .then(async (tokens) => {
          if (finished || this.disposed || this.revisions.get(profileId) !== revision) {
            response.writeHead(400).end(t('geminiOAuthCancelled'));
            return;
          }
          const projectId = await this.discoverProject(tokens.accessToken);
          const credentials: GeminiCredentials = { ...tokens, projectId };
          this.store.save(this.storageKey(profileId), credentials);
          response.writeHead(200).end(t('geminiOAuthBrowserDone'));
          this.logger?.notice('Google Gemini login completed.', { source: 'llm.gemini.oauth' });
          finish();
        })
        .catch((error: unknown) => {
          response.writeHead(400).end(t('geminiOAuthFailed'));
          this.logger?.warn('Google Gemini login failed.', {
            source: 'llm.gemini.oauth',
            error,
          });
          finish(error instanceof Error ? error : new Error(t('geminiOAuthFailed')));
        });
    });
    this.logger?.info('Google Gemini login started.', { source: 'llm.gemini.oauth' });
    return { url: url.toString(), completed, cancel };
  }

  async credentials(profileId: string, forceRefresh = false): Promise<GeminiCredentials> {
    const existingRefresh = this.refreshes.get(profileId);
    if (existingRefresh) return existingRefresh;
    const current = this.load(profileId);
    if (this.disposed || !current) throw new Error(t('geminiOAuthRequired'));
    if (!forceRefresh && current.expiresAt > Date.now() + 60_000) return current;
    const revision = this.revisions.get(profileId);
    const refresh = this.exchange(
      {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      },
      { projectId: current.projectId, email: current.email },
    )
      .then((credentials) => {
        if (this.disposed || this.revisions.get(profileId) !== revision || !this.load(profileId))
          throw new Error(t('geminiOAuthRequired'));
        if (!credentials.projectId) credentials.projectId = current.projectId;
        this.store.save(this.storageKey(profileId), credentials);
        this.logger?.debug('Google Gemini access token refreshed.', {
          source: 'llm.gemini.oauth',
        });
        return credentials;
      })
      .finally(() => {
        if (this.refreshes.get(profileId) === refresh) this.refreshes.delete(profileId);
      });
    this.refreshes.set(profileId, refresh);
    return refresh;
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<GeminiCredentials> {
    return this.exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  }

  private async exchange(
    parameters: Record<string, string>,
    preserved: { projectId?: string; email?: string } = {},
  ): Promise<GeminiCredentials> {
    const response = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...parameters,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
      throw: false,
    });
    if (response.status >= 400) {
      throw new Error(t('geminiOAuthHttpError', { status: response.status }));
    }
    const credentials = planGeminiRust<GeminiCredentials>({
      operation: 'token',
      token: response.json as unknown,
      now: Date.now(),
      refreshToken: parameters.refresh_token,
      projectId: preserved.projectId,
      email: preserved.email,
    });
    if (!credentials) throw new Error(t('geminiOAuthFailed'));
    if (!credentials.projectId && preserved.projectId) credentials.projectId = preserved.projectId;
    if (!credentials.email && preserved.email) credentials.email = preserved.email;
    return credentials;
  }

  private async discoverProject(accessToken: string): Promise<string> {
    const load = await this.codeAssistRequest('loadCodeAssist', {
      metadata: CLIENT_METADATA,
    }, accessToken);
    let plan = planGeminiRust<GeminiProjectPlan>({ operation: 'project', load });
    if (!plan) throw new Error(t('geminiOAuthProjectFailed'));
    if (plan.projectId) return plan.projectId;
    if (!plan.needsOnboard || !plan.tierId) {
      throw new Error(plan.error ?? t('geminiOAuthProjectRequired'));
    }
    let onboard = await this.codeAssistRequest(
      'onboardUser',
      { tierId: plan.tierId, metadata: CLIENT_METADATA },
      accessToken,
    );
    const operationName =
      onboard && typeof onboard === 'object'
        ? (onboard as Record<string, unknown>).name
        : undefined;
    if (typeof operationName === 'string' && operationName) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (onboard && (onboard as Record<string, unknown>).done === true) break;
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
        onboard = await this.codeAssistGet(operationName, accessToken);
      }
    }
    plan = planGeminiRust<GeminiProjectPlan>({
      operation: 'project',
      load,
      onboard,
    });
    if (!plan?.projectId) throw new Error(plan?.error ?? t('geminiOAuthProjectRequired'));
    return plan.projectId;
  }

  private async codeAssistRequest(
    method: string,
    body: Record<string, unknown> | undefined,
    accessToken: string,
  ): Promise<unknown> {
    return this.codeAssistFetch(`${CODE_ASSIST_URL}:${method}`, accessToken, body);
  }

  private async codeAssistGet(name: string, accessToken: string): Promise<unknown> {
    return this.codeAssistFetch(`${CODE_ASSIST_URL}/${name}`, accessToken);
  }

  private async codeAssistFetch(
    url: string,
    accessToken: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await requestUrl({
      url,
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'X-Goog-Api-Client': 'gl-node/22.17.0',
        'Client-Metadata': JSON.stringify(CLIENT_METADATA),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      throw: false,
    });
    if (response.status >= 400) {
      throw new Error(t('geminiOAuthProjectFailed'));
    }
    return response.json;
  }
}

function createSecretStorageStore(storage: SecretStorage): CredentialStore {
  return {
    load: (id) => {
      const raw = storage.getSecret(id);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    // 삭제 API가 없어 빈 값이 연결 해제 표시가 된다.
    save: (id, value) => {
      storage.setSecret(id, value === null ? '' : JSON.stringify(value));
    },
  };
}

function createUninitializedAuth(logger?: AppLogger): GoogleGeminiOAuth {
  return new GoogleGeminiOAuth(
    {
      load: () => null,
      save: () => {
        throw new Error(t('geminiOAuthUnavailable'));
      },
    },
    logger,
  );
}

export let googleGeminiOAuth = createUninitializedAuth();

export function initializeGoogleGeminiOAuth(app: App, logger?: AppLogger): GoogleGeminiOAuth {
  googleGeminiOAuth.dispose();
  const storage = readSecretStorage(app);
  googleGeminiOAuth = storage
    ? new GoogleGeminiOAuth(createSecretStorageStore(storage), logger)
    : createUninitializedAuth(logger);
  return googleGeminiOAuth;
}
