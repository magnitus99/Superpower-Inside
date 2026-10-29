import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { requestUrl, type App, type SecretStorage } from 'obsidian';
import { t } from '../i18n';
import { planChatGPTRust } from '../rag/rust-core';
import { readSecretStorage, secretIdSegment } from '../secrets/provider-secrets';
import type { AppLogger } from '../utils/logger';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';

function chatGPTSecretId(profileId: string): string {
  return `superpower-inside-chatgpt-oauth-${secretIdSegment(profileId)}`;
}

/** 보안 저장소 이전 전에 localStorage에 쓰던 키. */
function legacyStorageKey(profileId: string): string {
  return `superpower-inside:chatgpt-oauth:${profileId}`;
}

export interface ChatGPTCredentials {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number;
}

interface CredentialStore {
  load(key: string): unknown;
  save(key: string, value: unknown): void;
}

export class ChatGPTOAuth {
  private pendingLogin: { profileId: string; cancel(): void } | undefined;
  private readonly refreshes = new Map<string, Promise<ChatGPTCredentials>>();
  private readonly revisions = new Map<string, number>();
  private disposed = false;

  constructor(
    private readonly store: CredentialStore,
    private readonly logger?: AppLogger,
    readonly clientVersion = '0.0.0',
  ) {}

  storageKey(profileId: string): string {
    return chatGPTSecretId(profileId);
  }

  private load(profileId: string): ChatGPTCredentials | null {
    return planChatGPTRust<ChatGPTCredentials>({
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
    this.logger?.debug('ChatGPT account disconnected.', { source: 'llm.chatgpt.oauth' });
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
    options: { port?: number; timeoutMs?: number } = {},
  ): Promise<{
    url: string;
    completed: Promise<void>;
    cancel(): void;
  }> {
    if (this.disposed) throw new Error(t('chatGPTOAuthUnavailable'));
    this.pendingLogin?.cancel();
    const revision = (this.revisions.get(profileId) ?? 0) + 1;
    this.revisions.set(profileId, revision);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
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
    const cancel = (): void => finish(new DOMException(t('chatGPTOAuthCancelled'), 'AbortError'));
    const timer = window.setTimeout(
      () => finish(new Error(t('chatGPTOAuthTimeout'))),
      options.timeoutMs ?? 5 * 60_000,
    );
    this.pendingLogin = { profileId, cancel };
    const listen = (port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
    try {
      try {
        await listen(options.port ?? 1455);
      } catch (error) {
        if (
          options.port !== undefined ||
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'EADDRINUSE'
        )
          throw error;
        this.logger?.debug('OAuth callback port busy; using an available loopback port.', {
          source: 'llm.chatgpt.oauth',
        });
        await listen(0);
      }
      if (finished || this.disposed) {
        server.close();
        throw new DOMException(t('chatGPTOAuthCancelled'), 'AbortError');
      }
    } catch {
      const error = new Error(t('chatGPTOAuthUnavailable'));
      finish(error);
      throw error;
    }
    server.on('error', () => finish(new Error(t('chatGPTOAuthUnavailable'))));
    const address = server.address();
    if (!address || typeof address === 'string') {
      cancel();
      throw new Error(t('chatGPTOAuthUnavailable'));
    }
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL('https://auth.openai.com/oauth/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'superpower-inside',
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
        response.writeHead(400).end(t('chatGPTOAuthInvalidCallback'));
        return;
      }
      if (
        request.method !== 'GET' ||
        callback.origin !== new URL(redirectUri).origin ||
        callback.pathname !== '/auth/callback'
      ) {
        response.writeHead(404).end();
        return;
      }
      const result = planChatGPTRust<{ code?: string; denied?: boolean }>({
        operation: 'callback',
        state: callback.searchParams.get('state'),
        expectedState: state,
        code: callback.searchParams.get('code'),
        error: callback.searchParams.get('error'),
      });
      if (!result || exchanging || finished) {
        response.writeHead(400).end(t('chatGPTOAuthInvalidCallback'));
        return;
      }
      if (result.denied || !result.code) {
        response.writeHead(400).end(t('chatGPTOAuthFailed'));
        finish(new Error(t('chatGPTOAuthFailed')));
        return;
      }
      exchanging = true;
      void this.exchange({
        grant_type: 'authorization_code',
        code: result.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
        .then((credentials) => {
          if (finished || this.disposed || this.revisions.get(profileId) !== revision) {
            response.writeHead(400).end(t('chatGPTOAuthCancelled'));
            return;
          }
          this.store.save(this.storageKey(profileId), credentials);
          response.writeHead(200).end(t('chatGPTOAuthBrowserDone'));
          this.logger?.notice('ChatGPT browser login completed.', { source: 'llm.chatgpt.oauth' });
          finish();
        })
        .catch(() => {
          response.writeHead(400).end(t('chatGPTOAuthFailed'));
          this.logger?.warn('ChatGPT token exchange failed.', { source: 'llm.chatgpt.oauth' });
          finish(new Error(t('chatGPTOAuthFailed')));
        });
    });
    this.logger?.info('ChatGPT browser login started.', { source: 'llm.chatgpt.oauth' });
    return { url: url.toString(), completed, cancel };
  }

  async credentials(profileId: string, forceRefresh = false): Promise<ChatGPTCredentials> {
    const existingRefresh = this.refreshes.get(profileId);
    if (existingRefresh) return existingRefresh;
    const current = this.load(profileId);
    if (this.disposed || !current) throw new Error(t('chatGPTOAuthRequired'));
    if (!forceRefresh && current.expiresAt > Date.now() + 60_000) return current;
    const revision = this.revisions.get(profileId);
    const refresh = this.exchange(
      {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      },
      current.accountId,
    )
      .then((credentials) => {
        if (this.disposed || this.revisions.get(profileId) !== revision || !this.load(profileId))
          throw new Error(t('chatGPTOAuthRequired'));
        this.store.save(this.storageKey(profileId), credentials);
        this.logger?.debug('ChatGPT access token refreshed.', { source: 'llm.chatgpt.oauth' });
        return credentials;
      })
      .finally(() => {
        if (this.refreshes.get(profileId) === refresh) this.refreshes.delete(profileId);
      });
    this.refreshes.set(profileId, refresh);
    return refresh;
  }

  private async exchange(
    parameters: Record<string, string>,
    expectedAccountId?: string,
  ): Promise<ChatGPTCredentials> {
    const response = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: CLIENT_ID }).toString(),
      throw: false,
    });
    if (response.status >= 400)
      throw new Error(t('chatGPTOAuthHttpError', { status: response.status }));
    const credentials = planChatGPTRust<ChatGPTCredentials>({
      operation: 'token',
      token: response.json as unknown,
      now: Date.now(),
      refreshToken: parameters.refresh_token,
      expectedAccountId,
    });
    if (!credentials) throw new Error(t('chatGPTOAuthFailed'));
    return credentials;
  }
}

function createUninitializedAuth(logger?: AppLogger, clientVersion = '0.0.0'): ChatGPTOAuth {
  return new ChatGPTOAuth(
    {
      load: () => null,
      save: () => {
        throw new Error(t('chatGPTOAuthUnavailable'));
      },
    },
    logger,
    clientVersion,
  );
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

export let chatGPTOAuth = createUninitializedAuth();

/** 이전 버전이 localStorage에 두었던 자격 증명을 보안 저장소로 옮긴다. */
export function migrateChatGPTCredentials(app: App, profileIds: string[]): number {
  const storage = readSecretStorage(app);
  if (!storage) return 0;
  let migrated = 0;
  for (const profileId of profileIds) {
    const id = chatGPTSecretId(profileId);
    if (storage.getSecret(id)) continue;
    const credentials = planChatGPTRust<ChatGPTCredentials>({
      operation: 'credentials',
      value: app.loadLocalStorage(legacyStorageKey(profileId)) as unknown,
    });
    if (!credentials) continue;
    try {
      storage.setSecret(id, JSON.stringify(credentials));
    } catch {
      continue;
    }
    app.saveLocalStorage(legacyStorageKey(profileId), null);
    migrated += 1;
  }
  return migrated;
}

export function initializeChatGPTOAuth(
  app: App,
  logger?: AppLogger,
  clientVersion = '0.0.0',
): ChatGPTOAuth {
  chatGPTOAuth.dispose();
  const storage = readSecretStorage(app);
  chatGPTOAuth = storage
    ? new ChatGPTOAuth(createSecretStorageStore(storage), logger, clientVersion)
    : createUninitializedAuth(logger, clientVersion);
  return chatGPTOAuth;
}
