import { Codex } from '@openai/codex-sdk';
import type { ModelReasoningEffort } from '@openai/codex-sdk';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';
import type { ReasoningEffort } from '../config.js';
import { DORABOT_DIR, CODEX_OAUTH_PATH, OPENAI_KEY_PATH } from '../workspace.js';
import { getSecretStorageBackend, keychainDelete, keychainLoad, keychainStore, type SecretStorageBackend } from '../auth/keychain.js';

// ── OAuth constants (same client as Codex CLI) ──────────────────────
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OAUTH_SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

// ── File paths ──────────────────────────────────────────────────────
const CODEX_OAUTH_FILE = CODEX_OAUTH_PATH;
const OPENAI_KEY_FILE = OPENAI_KEY_PATH;
const KEYCHAIN_API_KEY_ACCOUNT = 'openai-api-key';
const KEYCHAIN_OAUTH_ACCOUNT = 'openai-oauth';
const REFRESH_LEAD_MS = 30 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html><html><body><p>Authentication successful. You can close this tab.</p></body></html>`;

// ── Codex home / binary helpers ─────────────────────────────────────

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function ensureCodexHome(): void {
  mkdirSync(codexHome(), { recursive: true });
}

function ensureDorabotDir(): void {
  mkdirSync(DORABOT_DIR, { recursive: true });
}

/**
 * Find the codex binary — prefer the SDK's bundled binary, fall back to global.
 */
function findCodexBinary(): string {
  // 1. Explicit override
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;

  // 2. SDK bundled binary
  try {
    const sdkDir = dirname(fileURLToPath(import.meta.resolve('@openai/codex-sdk')));
    const pkgDir = join(sdkDir, '..');
    const targets: Record<string, Record<string, string>> = {
      linux:  { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
      darwin: { x64: 'x86_64-apple-darwin',       arm64: 'aarch64-apple-darwin' },
      win32:  { x64: 'x86_64-pc-windows-msvc',    arm64: 'aarch64-pc-windows-msvc' },
    };
    const target = targets[process.platform]?.[process.arch];
    if (target) {
      const bin = join(pkgDir, 'vendor', target, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex');
      if (existsSync(bin)) return bin;
    }
  } catch { /* fallthrough */ }

  // 3. Global binary
  return 'codex';
}

const codexBinary = findCodexBinary();

function codexEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.CODEX_HOME = codexHome();
  return env;
}

/** Run a codex CLI command and return stdout */
function runCodexCmd(args: string[], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = execFile(codexBinary, args, {
      env: codexEnv(),
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        code: error ? (error as any).code ?? 1 : 0,
      });
    });
    if (input !== undefined) {
      proc.stdin?.write(input);
      proc.stdin?.end();
    }
  });
}

// ── PKCE helpers ────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── JWT decode ──────────────────────────────────────────────────────

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1]!, 'base64').toString());
  } catch {
    return null;
  }
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
  const id = auth?.chatgpt_account_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// ── Token persistence ───────────────────────────────────────────────

type CodexOAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: string;
};

let nextRefreshAt: number | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectRequired = false;
const authRequiredListeners = new Set<(reason: string) => void>();

function emitAuthRequired(reason: string): void {
  reconnectRequired = true;
  for (const listener of authRequiredListeners) {
    try {
      listener(reason);
    } catch {
      // ignore listener failures
    }
  }
}

export function onCodexAuthRequired(listener: (reason: string) => void): () => void {
  authRequiredListeners.add(listener);
  return () => authRequiredListeners.delete(listener);
}

function tokenHealth(tokens: CodexOAuthTokens | null): 'valid' | 'expiring' | 'expired' {
  if (!tokens) return 'expired';
  if (Date.now() >= tokens.expires_at) return 'expired';
  if (Date.now() >= tokens.expires_at - REFRESH_LEAD_MS) return 'expiring';
  return 'valid';
}

export function getCodexTokenState(): {
  storageBackend: SecretStorageBackend;
  tokenHealth: 'valid' | 'expiring' | 'expired';
  nextRefreshAt?: number;
  reconnectRequired: boolean;
} {
  const tokens = loadCodexOAuthTokens();
  return {
    storageBackend: getSecretStorageBackend(),
    tokenHealth: tokenHealth(tokens),
    nextRefreshAt: nextRefreshAt || undefined,
    reconnectRequired,
  };
}

function loadCodexOAuthTokens(): CodexOAuthTokens | null {
  const raw = keychainLoad(KEYCHAIN_OAUTH_ACCOUNT);
  if (raw) {
    try {
      return JSON.parse(raw) as CodexOAuthTokens;
    } catch {
      // ignore keychain parse errors and fall back to file
    }
  }
  try {
    if (existsSync(CODEX_OAUTH_FILE)) {
      return JSON.parse(readFileSync(CODEX_OAUTH_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function persistCodexOAuthTokens(tokens: CodexOAuthTokens): void {
  reconnectRequired = false;
  const savedToKeychain = keychainStore(KEYCHAIN_OAUTH_ACCOUNT, JSON.stringify(tokens));
  if (savedToKeychain) {
    scheduleCodexRefresh(tokens);
    return;
  }
  try {
    ensureDorabotDir();
    writeFileSync(CODEX_OAUTH_FILE, JSON.stringify(tokens), { mode: 0o600 });
    chmodSync(CODEX_OAUTH_FILE, 0o600);
    scheduleCodexRefresh(tokens);
  } catch (err) {
    console.error('[codex] failed to persist OAuth tokens:', err);
  }
}

function loadPersistedOpenAIKey(): string | undefined {
  const fromKeychain = keychainLoad(KEYCHAIN_API_KEY_ACCOUNT);
  if (fromKeychain) return fromKeychain;
  try {
    if (existsSync(OPENAI_KEY_FILE)) {
      const key = readFileSync(OPENAI_KEY_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch { /* ignore */ }
  return undefined;
}

function persistOpenAIKey(apiKey: string): void {
  const savedToKeychain = keychainStore(KEYCHAIN_API_KEY_ACCOUNT, apiKey);
  if (savedToKeychain) return;
  try {
    ensureDorabotDir();
    writeFileSync(OPENAI_KEY_FILE, apiKey, { mode: 0o600 });
    chmodSync(OPENAI_KEY_FILE, 0o600);
  } catch (err) {
    console.error('[codex] failed to persist API key:', err);
  }
}

function clearPersistedOpenAIKey(): void {
  keychainDelete(KEYCHAIN_API_KEY_ACCOUNT);
  try {
    if (existsSync(OPENAI_KEY_FILE)) {
      writeFileSync(OPENAI_KEY_FILE, '', { mode: 0o600 });
      chmodSync(OPENAI_KEY_FILE, 0o600);
    }
  } catch {
    // ignore
  }
}

function clearCodexOAuthTokens(): void {
  keychainDelete(KEYCHAIN_OAUTH_ACCOUNT);
  nextRefreshAt = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  try {
    if (existsSync(CODEX_OAUTH_FILE)) {
      writeFileSync(CODEX_OAUTH_FILE, '', { mode: 0o600 });
      chmodSync(CODEX_OAUTH_FILE, 0o600);
    }
  } catch {
    // ignore
  }
}

// ── Token exchange & refresh ────────────────────────────────────────

async function exchangeCodexAuthCode(
  code: string,
  verifier: string,
): Promise<CodexOAuthTokens | null> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OAUTH_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: OAUTH_REDIRECT_URI,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[codex] token exchange failed: ${res.status} ${text}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    if (!data.access_token || !data.refresh_token) return null;
    const accountId = getAccountId(data.access_token);
    if (!accountId) {
      console.error('[codex] failed to extract accountId from token');
      return null;
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
    };
  } catch (err) {
    console.error('[codex] token exchange error:', err);
    return null;
  }
}

async function refreshCodexAccessToken(refreshToken: string): Promise<CodexOAuthTokens | null> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!res.ok) {
      console.error(`[codex] token refresh failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    if (!data.access_token || !data.refresh_token) return null;
    const accountId = getAccountId(data.access_token);
    if (!accountId) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
    };
  } catch (err) {
    console.error('[codex] token refresh error:', err);
    emitAuthRequired('OAuth refresh failed');
    return null;
  }
}

function scheduleCodexRefresh(tokens: CodexOAuthTokens): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const runAt = Math.max(Date.now() + 1_000, tokens.expires_at - REFRESH_LEAD_MS);
  nextRefreshAt = runAt;
  const delay = runAt - Date.now();
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const latest = loadCodexOAuthTokens();
    if (!latest) {
      emitAuthRequired('Missing OAuth tokens');
      nextRefreshAt = null;
      return;
    }
    const refreshed = await refreshCodexAccessToken(latest.refresh_token);
    if (!refreshed) {
      emitAuthRequired('OAuth refresh failed');
      nextRefreshAt = null;
      return;
    }
    persistCodexOAuthTokens(refreshed);
    scheduleCodexRefresh(refreshed);
  }, delay);
  refreshTimer.unref?.();
}

/** Ensure we have a valid access token, refreshing if needed */
async function ensureCodexOAuthToken(): Promise<string | null> {
  const tokens = loadCodexOAuthTokens();
  if (!tokens) return null;

  if (Date.now() > tokens.expires_at - 300_000) {
    console.log('[codex] access token expiring, refreshing...');
    const refreshed = await refreshCodexAccessToken(tokens.refresh_token);
    if (!refreshed) {
      emitAuthRequired('OAuth token expired');
      return null;
    }
    persistCodexOAuthTokens(refreshed);
    scheduleCodexRefresh(refreshed);
    reconnectRequired = false;
    return refreshed.access_token;
  }

  scheduleCodexRefresh(tokens);
  return tokens.access_token;
}

// ── Local OAuth callback server ─────────────────────────────────────

type OAuthServer = {
  close: () => void;
  waitForCode: () => Promise<string | null>;
};

function startLocalOAuthServer(expectedState: string): Promise<OAuthServer | null> {
  return new Promise((resolve) => {
    let capturedCode: string | null = null;
    let codeResolve: ((code: string | null) => void) | null = null;

    const server: Server = createServer((req, res) => {
      try {
        const url = new URL(req.url || '', 'http://localhost');
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (state !== expectedState) {
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        }
        capturedCode = code;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);
        if (codeResolve) {
          codeResolve(capturedCode);
          codeResolve = null;
        }
      } catch {
        res.statusCode = 500;
        res.end('Error');
      }
    });

    server.listen(1455, '127.0.0.1', () => {
      resolve({
        close: () => { try { server.close(); } catch { /* ignore */ } },
        waitForCode: () => {
          if (capturedCode !== null) return Promise.resolve(capturedCode);
          return new Promise<string | null>((r) => {
            codeResolve = r;
            setTimeout(() => { r(null); codeResolve = null; }, 120_000);
          });
        },
      });
    });

    server.on('error', () => resolve(null));
  });
}

// ── Auth helpers ────────────────────────────────────────────────────

type CodexAuthOverrides = {
  apiKey?: string;
  suppressStoredKey?: boolean;
  suppressCliAuth?: boolean;
  suppressOAuth?: boolean;
};

function getOpenAIApiKey(overrides?: CodexAuthOverrides): string | undefined {
  const overrideKey = overrides?.apiKey?.trim();
  if (overrideKey) return overrideKey;

  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  if (overrides?.suppressStoredKey || process.env.DORABOT_CODEX_SUPPRESS_STORED_KEY === '1') return undefined;
  return loadPersistedOpenAIKey();
}

function getCodexApiKey(overrides?: CodexAuthOverrides): string | undefined {
  // Prefer managed key, then env, then codex CLI auth.json
  const managed = getOpenAIApiKey(overrides);
  if (managed) return managed;
  if (overrides?.suppressCliAuth || process.env.DORABOT_CODEX_SUPPRESS_CLI_AUTH === '1') return undefined;
  const authFile = join(codexHome(), 'auth.json');
  if (existsSync(authFile)) {
    try {
      const data = JSON.parse(readFileSync(authFile, 'utf-8'));
      return data.api_key || data.token || data.access_token || undefined;
    } catch { /* ignore */ }
  }
  return undefined;
}

/** Resolve the best available API key — managed key, OAuth token, or codex auth.json */
async function resolveCodexApiKey(overrides?: CodexAuthOverrides): Promise<string | undefined> {
  // 1. Managed API key or env
  const apiKey = getCodexApiKey(overrides);
  if (apiKey) return apiKey;
  if (overrides?.suppressOAuth || process.env.DORABOT_CODEX_SUPPRESS_OAUTH === '1') return undefined;
  // 2. Managed OAuth token (with auto-refresh)
  const oauthToken = await ensureCodexOAuthToken();
  if (oauthToken) return oauthToken;
  return undefined;
}

export async function isCodexInstalled(): Promise<boolean> {
  try {
    const { code } = await runCodexCmd(['--version']);
    return code === 0;
  } catch {
    return false;
  }
}

export function hasCodexAuth(): boolean {
  return !!getCodexApiKey() || !!loadCodexOAuthTokens();
}

// ── Reasoning effort mapping ────────────────────────────────────────

const EFFORT_MAP: Record<ReasoningEffort, ModelReasoningEffort> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
};

// ── Provider ────────────────────────────────────────────────────────

export class CodexProvider implements Provider {
  readonly name = 'codex';
  private activeAbort: AbortController | null = null;
  private pendingOAuth: { verifier: string; state: string; server: OAuthServer } | null = null;

  constructor() {
    const oauth = loadCodexOAuthTokens();
    if (oauth) scheduleCodexRefresh(oauth);
  }

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    try {
      const { code } = await runCodexCmd(['--version']);
      if (code !== 0) {
        return { ready: false, reason: 'codex binary not found or not working. Install with: npm i -g @openai/codex' };
      }
    } catch {
      return { ready: false, reason: 'codex binary not found. Install with: npm i -g @openai/codex' };
    }

    const auth = await this.getAuthStatus();
    if (!auth.authenticated) {
      return { ready: false, reason: auth.error || 'Not authenticated. Use provider.auth.apiKey or provider.auth.oauth' };
    }

    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    ensureCodexHome();
    try {
      const storageBackend = getSecretStorageBackend();
      // 1. Managed OAuth tokens (dorabot-managed)
      const oauthTokens = loadCodexOAuthTokens();
      if (oauthTokens) {
        const token = await ensureCodexOAuthToken();
        const latest = loadCodexOAuthTokens() || oauthTokens;
        if (!token) {
          return {
            authenticated: false,
            method: 'oauth',
            error: 'OAuth token expired. Reconnect required.',
            storageBackend,
            tokenHealth: tokenHealth(latest),
            nextRefreshAt: nextRefreshAt || undefined,
            reconnectRequired: true,
          };
        }
        return {
          authenticated: true,
          method: 'oauth',
          identity: `ChatGPT (${latest.account_id})`,
          storageBackend,
          tokenHealth: tokenHealth(latest),
          nextRefreshAt: nextRefreshAt || undefined,
          reconnectRequired,
        };
      }

      // 2. Managed API key or env
      const apiKey = getOpenAIApiKey();
      if (apiKey) {
        return {
          authenticated: true,
          method: 'api_key',
          identity: process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : 'managed key',
          storageBackend,
        };
      }

      // 3. Codex CLI auth.json
      const authFile = join(codexHome(), 'auth.json');
      if (existsSync(authFile)) {
        try {
          const authData = JSON.parse(readFileSync(authFile, 'utf-8'));
          if (authData.api_key || authData.token || authData.access_token) {
            return {
              authenticated: true,
              method: authData.api_key ? 'api_key' : 'oauth',
              storageBackend: 'file',
            };
          }
        } catch { /* ignore */ }
      }

      return {
        authenticated: false,
        error: 'Not authenticated with Codex',
        storageBackend,
        tokenHealth: 'expired',
      };
    } catch (e) {
      return {
        authenticated: false,
        error: `Auth check failed: ${e}`,
        storageBackend: getSecretStorageBackend(),
      };
    }
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    ensureCodexHome();
    // Persist to dorabot-managed file
    persistOpenAIKey(apiKey);
    reconnectRequired = false;
    // Also try to register with codex CLI
    await runCodexCmd(['login', '--with-api-key'], apiKey + '\n').catch(() => {});
    return this.getAuthStatus();
  }

  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    ensureCodexHome();

    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = randomBytes(16).toString('hex');

    const server = await startLocalOAuthServer(state);
    if (!server) {
      throw new Error('Failed to start local OAuth callback server on port 1455');
    }

    const params = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: OAUTH_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    const authUrl = `${OAUTH_AUTHORIZE_URL}?${params}`;
    const loginId = `oauth-${Date.now()}`;

    this.pendingOAuth = { verifier, state, server };

    return { authUrl, loginId };
  }

  async completeOAuthLogin(_loginId: string): Promise<ProviderAuthStatus> {
    if (!this.pendingOAuth) {
      return { authenticated: false, error: 'No pending OAuth login' };
    }

    const { verifier, server } = this.pendingOAuth;
    try {
      const code = await server.waitForCode();
      if (!code) {
        return { authenticated: false, error: 'OAuth callback timed out or was cancelled' };
      }

      const tokens = await exchangeCodexAuthCode(code, verifier);
      if (!tokens) {
        return { authenticated: false, error: 'Token exchange failed' };
      }

      persistCodexOAuthTokens(tokens);
      scheduleCodexRefresh(tokens);
      reconnectRequired = false;
      return this.getAuthStatus();
    } finally {
      server.close();
      this.pendingOAuth = null;
    }
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const codexConfig = opts.config.provider?.codex;
    const model = codexConfig?.model || undefined;
    const baseUrl = typeof (codexConfig as any)?.baseUrl === 'string'
      ? ((codexConfig as any).baseUrl as string).trim() || undefined
      : undefined;
    const authOverrides = (codexConfig as any)?.authOverrides as CodexAuthOverrides | undefined;
    const reasoningEffort = opts.config.reasoningEffort;

    // Resolve API key (managed key > OAuth token > codex auth.json)
    const apiKey = await resolveCodexApiKey(authOverrides);

    // Create SDK instance
    const codex = new Codex({
      apiKey,
      baseUrl,
      codexPathOverride: codexBinary !== 'codex' ? codexBinary : undefined,
    });

    // Map reasoning effort
    const modelReasoningEffort = reasoningEffort ? EFFORT_MAP[reasoningEffort] : undefined;

    const threadOpts = {
      model,
      workingDirectory: opts.cwd,
      sandboxMode: (codexConfig?.sandboxMode as any) || 'danger-full-access',
      skipGitRepoCheck: true,
      modelReasoningEffort,
      approvalPolicy: (codexConfig?.approvalPolicy as any) || 'never',
      networkAccessEnabled: codexConfig?.networkAccess ?? true,
      webSearchMode: (codexConfig?.webSearch as any) || undefined,
    };

    // Resume existing thread or start a new one
    const thread = opts.resumeId
      ? codex.resumeThread(opts.resumeId, threadOpts)
      : codex.startThread(threadOpts);

    // Only prepend system instructions on the first message (new thread).
    // Resumed threads already have the system prompt from their initial turn.
    const fullPrompt = opts.resumeId
      ? opts.prompt
      : opts.systemPrompt
        ? `<system_instructions>\n${opts.systemPrompt}\n</system_instructions>\n\n${opts.prompt}`
        : opts.prompt;

    console.log(
      `[codex] ${opts.resumeId ? 'resuming' : 'starting'} thread: model=${model || 'default'} effort=${modelReasoningEffort || 'default'}${opts.resumeId ? ` threadId=${opts.resumeId}` : ''}`
    );

    // Run with streaming
    const abort = opts.abortController || new AbortController();
    this.activeAbort = abort;

    const { events } = await thread.runStreamed(fullPrompt, {
      signal: abort.signal,
    });

    // Track state — seed sessionId from resumeId so it's set even if
    // the SDK doesn't emit thread.started on a resumed thread
    let sessionId = opts.resumeId || '';
    let result = '';
    let lastAgentMessage = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    // stream event helpers — emit Claude-compatible stream_events so the gateway
    // and frontend handle Codex through the exact same code path as Claude
    const se = (ev: Record<string, unknown>): ProviderMessage =>
      ({ type: 'stream_event', event: ev } as ProviderMessage);
    const itemTexts = new Map<string, string>();
    const startedBlocks = new Set<string>();

    try {
      for await (const event of events) {
        switch (event.type) {
          case 'thread.started': {
            sessionId = event.thread_id || sessionId || `codex-${Date.now()}`;
            yield {
              type: 'system',
              subtype: 'init',
              session_id: sessionId,
              model: model || 'codex-default',
            } as ProviderMessage;
            break;
          }

          case 'turn.started':
            break;

          case 'turn.completed': {
            if (event.usage) {
              usage.inputTokens = event.usage.input_tokens || 0;
              usage.outputTokens = event.usage.output_tokens || 0;
            }
            result = lastAgentMessage || result;
            yield {
              type: 'result',
              result,
              session_id: sessionId,
              usage: {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
              },
              total_cost_usd: 0,
            } as ProviderMessage;
            break;
          }

          case 'turn.failed': {
            const errMsg = event.error?.message || 'Turn failed';
            console.error(`[codex] turn failed: ${errMsg}`);
            result = lastAgentMessage || `Codex error: ${errMsg}`;
            yield {
              type: 'result',
              subtype: 'error_max_turns',
              result,
              session_id: sessionId,
            } as ProviderMessage;
            break;
          }

          case 'error': {
            if (event.message?.includes('Reconnecting')) {
              console.log(`[codex] ${event.message}`);
              break;
            }
            console.error(`[codex] error: ${event.message}`);
            break;
          }

          case 'item.started':
          case 'item.updated':
          case 'item.completed': {
            const item = event.item;
            if (!item) break;

            switch (item.type) {
              case 'agent_message': {
                const text = item.text || '';
                if (!text && event.type === 'item.completed') break;
                const prev = itemTexts.get(item.id) || '';

                if (!startedBlocks.has(item.id)) {
                  startedBlocks.add(item.id);
                  yield se({ type: 'content_block_start', content_block: { type: 'text' } });
                }

                const delta = text.slice(prev.length);
                if (delta) {
                  yield se({ type: 'content_block_delta', delta: { type: 'text_delta', text: delta } });
                  itemTexts.set(item.id, text);
                }

                if (event.type === 'item.completed') {
                  yield se({ type: 'content_block_stop' });
                  startedBlocks.delete(item.id);
                  itemTexts.delete(item.id);
                  lastAgentMessage = text;
                  result = text;
                  yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } } as ProviderMessage;
                }
                break;
              }

              case 'reasoning': {
                const text = item.text || '';
                if (!text && event.type === 'item.completed') break;
                const prev = itemTexts.get(item.id) || '';

                if (!startedBlocks.has(item.id)) {
                  startedBlocks.add(item.id);
                  yield se({ type: 'content_block_start', content_block: { type: 'thinking' } });
                }

                const delta = text.slice(prev.length);
                if (delta) {
                  yield se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: delta } });
                  itemTexts.set(item.id, text);
                }

                if (event.type === 'item.completed') {
                  yield se({ type: 'content_block_stop' });
                  startedBlocks.delete(item.id);
                  itemTexts.delete(item.id);
                  yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }] } } as ProviderMessage;
                }
                break;
              }

              case 'command_execution': {
                const toolId = `codex-${item.id}`;
                if (event.type === 'item.started') {
                  yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'Bash' } });
                  yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: item.command }) } });
                  yield se({ type: 'content_block_stop' });
                  yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: item.command } }] } } as ProviderMessage;
                }
                if (event.type === 'item.completed') {
                  yield {
                    type: 'result', subtype: 'tool_result', tool_use_id: toolId,
                    content: [{ type: 'text', text: item.aggregated_output || '(no output)' }],
                    is_error: item.status === 'failed',
                  } as ProviderMessage;
                }
                break;
              }

              case 'file_change': {
                if (event.type !== 'item.completed') break;
                const changes = item.changes || [];
                const firstPath = changes[0]?.path || '';
                const desc = changes.map(c => `${c.kind}: ${c.path}`).join('\n') || 'Files modified';
                const isCreate = changes.length === 1 && changes[0]?.kind === 'add';
                const toolName = isCreate ? 'Write' : 'Edit';
                const toolId = `codex-${item.id}`;
                const input = { file_path: firstPath, description: desc };

                yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: toolName } });
                yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
                yield se({ type: 'content_block_stop' });
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: toolName, input }] } } as ProviderMessage;
                yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: desc }] } as ProviderMessage;
                break;
              }

              case 'mcp_tool_call': {
                const toolId = `codex-${item.id}`;
                const tool = item.tool || 'unknown';
                if (!startedBlocks.has(item.id)) {
                  startedBlocks.add(item.id);
                  const input = item.arguments || {};
                  yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: tool } });
                  yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
                  yield se({ type: 'content_block_stop' });
                  yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: tool, input }] } } as ProviderMessage;
                }
                if (event.type === 'item.completed') {
                  startedBlocks.delete(item.id);
                  const text = item.error?.message
                    || (item.result?.content?.map((b: any) => b.text || '').join('\n'))
                    || '(no result)';
                  yield {
                    type: 'result', subtype: 'tool_result', tool_use_id: toolId,
                    content: [{ type: 'text', text }],
                    is_error: item.status === 'failed',
                  } as ProviderMessage;
                }
                break;
              }

              case 'web_search': {
                const toolId = `codex-${item.id}`;
                if (!startedBlocks.has(item.id)) {
                  startedBlocks.add(item.id);
                  yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'WebSearch' } });
                  yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: item.query }) } });
                  yield se({ type: 'content_block_stop' });
                  yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'WebSearch', input: { query: item.query } }] } } as ProviderMessage;
                }
                if (event.type === 'item.completed') {
                  startedBlocks.delete(item.id);
                  yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: `Searched: ${item.query}` }] } as ProviderMessage;
                }
                break;
              }

              case 'todo_list': {
                if (event.type !== 'item.completed') break;
                const todos = (item as any).items || [];
                const toolId = `codex-${item.id}`;
                const input = { todos: todos.map((t: any) => ({ content: t.text, status: t.completed ? 'completed' : 'in_progress', activeForm: t.text })) };

                yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'TodoWrite' } });
                yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
                yield se({ type: 'content_block_stop' });
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'TodoWrite', input }] } } as ProviderMessage;
                yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: 'Plan updated' }] } as ProviderMessage;
                break;
              }

              case 'error': {
                console.error(`[codex] item error: ${item.message}`);
                break;
              }
            }
            break;
          }
        }

        // Break on terminal events
        if (event.type === 'turn.completed' || event.type === 'turn.failed') {
          break;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.log('[codex] run aborted');
      } else {
        console.error(`[codex] stream error: ${err}`);
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          result: `Codex error: ${err?.message || err}`,
          session_id: sessionId,
        } as ProviderMessage;
      }
    }

    this.activeAbort = null;

    return {
      result,
      sessionId,
      usage,
    };
  }

  async dispose(): Promise<void> {
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
    if (this.pendingOAuth) {
      this.pendingOAuth.server.close();
      this.pendingOAuth = null;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      nextRefreshAt = null;
    }
  }
}
