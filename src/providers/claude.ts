import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFile, execSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult, RunHandle } from './types.js';
import { guardImages } from './image-guard.js';
import { DORABOT_DIR, CLAUDE_KEY_PATH, CLAUDE_OAUTH_PATH } from '../workspace.js';
import { getSecretStorageBackend, keychainDelete, keychainLoad, keychainStore, type SecretStorageBackend } from '../auth/keychain.js';

// ── Node binary resolution ──────────────────────────────────────────
// Electron apps get a minimal PATH. Resolve the full path to node once at startup
// so the SDK can spawn its CLI subprocess regardless of PATH state.
let _nodeBinary: string | null = null;
function resolveNodeBinary(): string {
  if (_nodeBinary) return _nodeBinary;

  // 1. If current process IS node (not Electron), use its path directly
  if (!process.versions.electron && process.execPath) {
    _nodeBinary = process.execPath;
    console.log(`[claude] node binary (execPath): ${_nodeBinary}`);
    return _nodeBinary;
  }

  // 2. Try resolving from login shell (handles nvm, fnm, volta, homebrew)
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    _nodeBinary = execSync(`${shell} -lc 'command -v node'`, {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
    if (_nodeBinary && existsSync(_nodeBinary)) {
      console.log(`[claude] node binary (shell): ${_nodeBinary}`);
      return _nodeBinary;
    }
  } catch { /* continue */ }

  // 3. Check common locations
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    `${process.env.HOME}/.nvm/current/bin/node`,
    `${process.env.HOME}/.fnm/current/bin/node`,
    `${process.env.HOME}/.volta/bin/node`,
  ];
  // Also check nvm versioned paths
  try {
    const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`;
    const defaultAlias = `${nvmDir}/alias/default`;
    if (existsSync(defaultAlias)) {
      const version = readFileSync(defaultAlias, 'utf-8').trim();
      candidates.unshift(`${nvmDir}/versions/node/${version}/bin/node`);
    }
  } catch { /* ignore */ }

  for (const c of candidates) {
    if (existsSync(c)) {
      _nodeBinary = c;
      console.log(`[claude] node binary (fallback): ${_nodeBinary}`);
      return _nodeBinary;
    }
  }

  // 4. Last resort: just "node" and hope PATH is fixed elsewhere
  _nodeBinary = 'node';
  console.log('[claude] node binary: using bare "node" (not resolved)');
  return _nodeBinary;
}

// ── File paths ──────────────────────────────────────────────────────
const KEY_FILE = CLAUDE_KEY_PATH;
const OAUTH_FILE = CLAUDE_OAUTH_PATH;
const KEYCHAIN_API_KEY_ACCOUNT = 'anthropic-api-key';
const KEYCHAIN_OAUTH_ACCOUNT = 'anthropic-oauth';
const REFRESH_LEAD_MS = 30 * 60 * 1000;

// ── OAuth constants (same as Claude Code CLI) ───────────────────────
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'user:inference user:profile';

// ── API key helpers ─────────────────────────────────────────────────
function loadPersistedKey(): string | undefined {
  const keychainValue = keychainLoad(KEYCHAIN_API_KEY_ACCOUNT);
  if (keychainValue) return keychainValue;
  try {
    if (existsSync(KEY_FILE)) {
      const key = readFileSync(KEY_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch { /* ignore */ }
  return undefined;
}

function persistKey(apiKey: string): void {
  const storedInKeychain = keychainStore(KEYCHAIN_API_KEY_ACCOUNT, apiKey);
  if (storedInKeychain) return;
  try {
    mkdirSync(DORABOT_DIR, { recursive: true });
    writeFileSync(KEY_FILE, apiKey, { mode: 0o600 });
    chmodSync(KEY_FILE, 0o600);
  } catch (err) {
    console.error('[claude] failed to persist API key:', err);
  }
}

function clearPersistedKey(): void {
  keychainDelete(KEYCHAIN_API_KEY_ACCOUNT);
  try {
    if (existsSync(KEY_FILE)) writeFileSync(KEY_FILE, '', { mode: 0o600 });
  } catch { /* ignore */ }
}

function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || loadPersistedKey();
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401) return { valid: false, error: 'Invalid API key' };
    if (res.status === 403) return { valid: false, error: 'API key lacks permissions' };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── OAuth token persistence ─────────────────────────────────────────
type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms since epoch
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
      // ignore listener errors
    }
  }
}

export function onClaudeAuthRequired(listener: (reason: string) => void): () => void {
  authRequiredListeners.add(listener);
  return () => authRequiredListeners.delete(listener);
}

export function getClaudeTokenState(): {
  storageBackend: SecretStorageBackend;
  tokenHealth: 'valid' | 'expiring' | 'expired';
  nextRefreshAt?: number;
  reconnectRequired: boolean;
} {
  const tokens = loadOAuthTokens();
  return {
    storageBackend: getSecretStorageBackend(),
    tokenHealth: tokenHealth(tokens),
    nextRefreshAt: nextRefreshAt || undefined,
    reconnectRequired,
  };
}

function loadOAuthTokens(): OAuthTokens | null {
  const raw = keychainLoad(KEYCHAIN_OAUTH_ACCOUNT);
  if (raw) {
    try {
      return JSON.parse(raw) as OAuthTokens;
    } catch {
      // fall through to file
    }
  }
  try {
    if (existsSync(OAUTH_FILE)) {
      return JSON.parse(readFileSync(OAUTH_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function persistOAuthTokens(tokens: OAuthTokens): void {
  reconnectRequired = false;
  const savedToKeychain = keychainStore(KEYCHAIN_OAUTH_ACCOUNT, JSON.stringify(tokens));
  if (savedToKeychain) {
    scheduleTokenRefresh(tokens);
    return;
  }
  try {
    mkdirSync(DORABOT_DIR, { recursive: true });
    writeFileSync(OAUTH_FILE, JSON.stringify(tokens), { mode: 0o600 });
    chmodSync(OAUTH_FILE, 0o600);
    scheduleTokenRefresh(tokens);
  } catch (err) {
    console.error('[claude] failed to persist OAuth tokens:', err);
  }
}

function clearOAuthTokens(): void {
  keychainDelete(KEYCHAIN_OAUTH_ACCOUNT);
  nextRefreshAt = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  try {
    if (existsSync(OAUTH_FILE)) writeFileSync(OAUTH_FILE, '', { mode: 0o600 });
  } catch { /* ignore */ }
}

function tokenHealth(tokens: OAuthTokens | null): 'valid' | 'expiring' | 'expired' {
  if (!tokens) return 'expired';
  if (Date.now() >= tokens.expires_at) return 'expired';
  if (Date.now() >= tokens.expires_at - REFRESH_LEAD_MS) return 'expiring';
  return 'valid';
}

/** Refresh the access token using the refresh token */
async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
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
      console.error(`[claude] token refresh failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + ((data.expires_in || 28800) * 1000),
    };
    persistOAuthTokens(tokens);
    reconnectRequired = false;
    return tokens;
  } catch (err) {
    console.error('[claude] token refresh error:', err);
    emitAuthRequired('OAuth refresh failed');
    return null;
  }
}

function scheduleTokenRefresh(tokens: OAuthTokens): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const runAt = Math.max(Date.now() + 1_000, tokens.expires_at - REFRESH_LEAD_MS);
  nextRefreshAt = runAt;
  const delay = runAt - Date.now();
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const latest = loadOAuthTokens();
    if (!latest) {
      emitAuthRequired('Missing OAuth tokens');
      nextRefreshAt = null;
      return;
    }
    const refreshed = await refreshAccessToken(latest.refresh_token);
    if (!refreshed) {
      emitAuthRequired('OAuth refresh failed');
      nextRefreshAt = null;
      return;
    }
    scheduleTokenRefresh(refreshed);
  }, delay);
  refreshTimer.unref?.();
}

/** Ensure we have a valid access token, refreshing if needed. Sets CLAUDE_CODE_OAUTH_TOKEN env. */
async function ensureOAuthToken(): Promise<string | null> {
  const tokens = loadOAuthTokens();
  if (!tokens) return null;

  if (Date.now() > tokens.expires_at - 300_000) {
    console.log('[claude] access token expired or expiring, refreshing...');
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (!refreshed) {
      emitAuthRequired('OAuth token expired');
      return null;
    }
    scheduleTokenRefresh(refreshed);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = refreshed.access_token;
    return refreshed.access_token;
  }

  scheduleTokenRefresh(tokens);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
  return tokens.access_token;
}

// ── PKCE helpers ────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── CLI auth detection ──────────────────────────────────────────────

// resolved once at startup, never blocks the event loop again
let _cliHasAuth: boolean | null = null;

/** Check if the Claude CLI has its own valid auth. Cached after first call. */
function cliHasOwnAuth(): boolean {
  if (_cliHasAuth !== null) return _cliHasAuth;
  try {
    const raw = execSync('claude auth status', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '' },
    }).toString().trim();
    const data = JSON.parse(raw);
    _cliHasAuth = data?.loggedIn === true;
  } catch {
    _cliHasAuth = false;
  }
  console.log(`[claude] CLI has own auth: ${_cliHasAuth}`);
  return _cliHasAuth;
}

// ── Auth method enum ────────────────────────────────────────────────

export type AuthMethod = 'api_key' | 'cli_keychain' | 'dorabot_oauth' | 'none';

/** Determine which auth method will be used (no side effects) */
export function getActiveAuthMethod(): AuthMethod {
  if (getApiKey()) return 'api_key';
  if (cliHasOwnAuth()) return 'cli_keychain';
  const tokens = loadOAuthTokens();
  if (tokens?.access_token) return 'dorabot_oauth';
  return 'none';
}

/** Check if dorabot's OAuth token is expired or expiring soon */
export function isOAuthTokenExpired(): boolean {
  const tokens = loadOAuthTokens();
  if (!tokens) return true;
  return Date.now() > tokens.expires_at - 300_000;
}

// ── Detection helpers (exported for gateway provider.detect) ────────

/** Check if we have persisted OAuth tokens (doesn't validate them) */
export function hasOAuthTokens(): boolean {
  const tokens = loadOAuthTokens();
  return !!tokens?.access_token;
}

export async function isClaudeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

export { getApiKey };

// ── Provider ────────────────────────────────────────────────────────

export class ClaudeProvider implements Provider {
  readonly name = 'claude';
  private _cachedAuth: ProviderAuthStatus | null = null;
  // PKCE state for in-flight OAuth
  private _pkceVerifier: string | null = null;
  private _pkceState: string | null = null;
  private _pkceLoginId: string | null = null;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      const saved = loadPersistedKey();
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
    // only set env token if CLI can't handle auth itself.
    // CLI subprocess prioritizes env var over its own keychain, and the env
    // token can't be refreshed mid-run.
    const method = getActiveAuthMethod();
    if (method === 'dorabot_oauth') {
      const tokens = loadOAuthTokens();
      if (tokens?.access_token) {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
        scheduleTokenRefresh(tokens);
      }
    }
    console.log(`[claude] auth method: ${method}`);
  }

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const status = await this.getAuthStatus();
    if (!status.authenticated) {
      return { ready: false, reason: status.error || 'Not authenticated.' };
    }
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const method = getActiveAuthMethod();
    if (this._cachedAuth && (method === 'api_key' || method === 'cli_keychain')) {
      return this._cachedAuth;
    }
    switch (method) {
      case 'api_key': {
        const v = await validateApiKey(getApiKey()!);
        if (v.valid) {
          this._cachedAuth = {
            authenticated: true,
            method: 'api_key',
            identity: 'Anthropic API key',
            storageBackend: getSecretStorageBackend(),
          };
          return this._cachedAuth;
        }
        return {
          authenticated: false,
          method: 'api_key',
          error: v.error,
          storageBackend: getSecretStorageBackend(),
        };
      }
      case 'cli_keychain':
        this._cachedAuth = {
          authenticated: true,
          method: 'oauth',
          identity: 'Claude CLI (keychain)',
          storageBackend: 'keychain',
          tokenHealth: 'valid',
        };
        return this._cachedAuth;
      case 'dorabot_oauth': {
        const token = await ensureOAuthToken();
        const tokens = loadOAuthTokens();
        const tokenState = getClaudeTokenState();
        if (token) {
          this._cachedAuth = {
            authenticated: true,
            method: 'oauth',
            identity: 'Claude subscription',
            storageBackend: tokenState.storageBackend,
            tokenHealth: tokenHealth(tokens),
            nextRefreshAt: tokenState.nextRefreshAt,
            reconnectRequired: tokenState.reconnectRequired,
          };
          return this._cachedAuth;
        }
        // token expired and refresh failed — needs re-auth
        return {
          authenticated: false,
          method: 'oauth',
          error: 'OAuth token expired. Re-authentication required.',
          storageBackend: tokenState.storageBackend,
          tokenHealth: tokenState.tokenHealth,
          nextRefreshAt: tokenState.nextRefreshAt,
          reconnectRequired: true,
        };
      }
      default:
        return {
          authenticated: false,
          error: 'Not authenticated. Sign in with your Claude account or provide an API key.',
          storageBackend: getSecretStorageBackend(),
          tokenHealth: 'expired',
        };
    }
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    const v = await validateApiKey(apiKey);
    if (!v.valid) {
      return { authenticated: false, method: 'api_key', error: v.error };
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    persistKey(apiKey);
    reconnectRequired = false;
    this._cachedAuth = {
      authenticated: true,
      method: 'api_key',
      identity: 'Anthropic API key',
      storageBackend: getSecretStorageBackend(),
    };
    return this._cachedAuth;
  }

  /**
   * Start OAuth PKCE flow. Returns the authorization URL for the user to open.
   * The user will authorize, get redirected, and paste the auth code back.
   */
  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    const loginId = `claude-oauth-${Date.now()}`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString('hex');

    this._pkceVerifier = codeVerifier;
    this._pkceState = state;
    this._pkceLoginId = loginId;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${OAUTH_AUTHORIZE_URL}?${params}`;
    return { authUrl, loginId };
  }

  /**
   * Complete OAuth by exchanging the auth code for tokens.
   * The loginId is the code#state string the user pastes from the callback page.
   */
  async completeOAuthLogin(loginId: string): Promise<ProviderAuthStatus> {
    if (!this._pkceVerifier || !this._pkceState) {
      return { authenticated: false, error: 'No pending OAuth flow. Start login first.' };
    }

    const parts = loginId.split('#');
    const code = parts[0];
    const returnedState = parts[1];

    if (!code) {
      return { authenticated: false, error: 'Invalid auth code.' };
    }

    if (returnedState !== this._pkceState) {
      return { authenticated: false, error: 'OAuth state mismatch — possible CSRF. Please retry login.' };
    }

    try {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          state: returnedState || this._pkceState || '',
          redirect_uri: OAUTH_REDIRECT_URI,
          client_id: OAUTH_CLIENT_ID,
          code_verifier: this._pkceVerifier,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[claude] token exchange failed: ${res.status} ${body}`);
        // don't clear PKCE state — let user retry with a new code
        return { authenticated: false, error: `Token exchange failed (${res.status})` };
      }

      const data = await res.json() as { access_token: string; refresh_token: string; expires_in?: number };

      const tokens: OAuthTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + ((data.expires_in || 28800) * 1000),
      };

      persistOAuthTokens(tokens);
      process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
      scheduleTokenRefresh(tokens);

      this._pkceVerifier = null;
      this._pkceState = null;
      this._pkceLoginId = null;

      reconnectRequired = false;
      this._cachedAuth = {
        authenticated: true,
        method: 'oauth',
        identity: 'Claude subscription',
        storageBackend: getSecretStorageBackend(),
        tokenHealth: tokenHealth(tokens),
        nextRefreshAt: nextRefreshAt || undefined,
      };
      return this._cachedAuth;
    } catch (err) {
      return { authenticated: false, error: err instanceof Error ? err.message : 'Token exchange failed' };
    }
  }

  resetAuth(): void {
    this._cachedAuth = null;
    _cliHasAuth = null;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    clearPersistedKey();
    clearOAuthTokens();
    reconnectRequired = false;
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    // refresh env token for dorabot_oauth only (cli_keychain handles its own)
    const method = getActiveAuthMethod();
    if (method === 'dorabot_oauth') {
      await ensureOAuthToken();
    }

    // ── Async generator message feed (buffett pattern) ──────────────
    // Instead of passing a string prompt to query(), we create an async
    // generator that keeps the SDK CLI process alive for message injection.
    // SDK constraint: string prompt → isSingleUserTurn=true → closes stdin
    // after first result. AsyncIterable prompt → keeps stdin open.

    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

    type UserMsg = {
      type: 'user';
      session_id: string;
      message: { role: 'user'; content: ContentBlock[] };
      parent_tool_use_id: null;
    };

    const messageQueue: UserMsg[] = [];
    let waitingForMessage: ((msg: UserMsg) => void) | null = null;
    let closed = false;

    const makeUserMsg = async (text: string, images?: import('./types.js').ImageAttachment[]): Promise<UserMsg> => {
      const content: ContentBlock[] = [];
      if (images?.length) {
        const { valid, warnings } = await guardImages(images);
        for (const img of valid) {
          content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
        }
        if (warnings.length) {
          text += '\n\n[Image warning: ' + warnings.join('; ') + ']';
        }
      }
      content.push({ type: 'text', text });
      return {
        type: 'user',
        session_id: '',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      };
    };

    // Seed the queue with the initial prompt (async for image processing)
    const seedReady = makeUserMsg(opts.prompt, opts.images).then(msg => messageQueue.push(msg));

    async function* messageGenerator(): AsyncGenerator<UserMsg, void, unknown> {
      await seedReady;
      while (!closed && !opts.abortController?.signal.aborted) {
        if (messageQueue.length > 0) {
          yield messageQueue.shift()!;
        } else {
          const msg = await new Promise<UserMsg>((resolve) => {
            waitingForMessage = resolve;
          });
          waitingForMessage = null;
          if (closed || opts.abortController?.signal.aborted) break;
          yield msg;
        }
      }
    }

    // Create RunHandle for the gateway to inject messages
    // SDK query methods are attached after q is created (deferred binding)
    let queryRef: ReturnType<typeof query> | null = null;

    const handle: RunHandle = {
      get active() { return !closed; },
      inject(text: string, images?: import('./types.js').ImageAttachment[]): boolean {
        if (closed) return false;
        makeUserMsg(text, images).then(msg => {
          if (closed) return;
          if (waitingForMessage) {
            waitingForMessage(msg);
          } else {
            messageQueue.push(msg);
          }
        });
        return true;
      },
      close() {
        closed = true;
        if (waitingForMessage) {
          waitingForMessage({
            type: 'user',
            session_id: '',
            message: { role: 'user', content: [{ type: 'text', text: '' }] },
            parent_tool_use_id: null,
          });
        }
      },
      async interrupt() { await queryRef?.interrupt(); },
      async setModel(model: string) { await queryRef?.setModel(model); },
      async setPermissionMode(mode: string) { await queryRef?.setPermissionMode(mode as any); },
      async stopTask(taskId: string) { await (queryRef as any)?.stopTask?.(taskId); },
      async mcpServerStatus() { return queryRef?.mcpServerStatus() ?? []; },
      async reconnectMcpServer(name: string) { await (queryRef as any)?.reconnectMcpServer?.(name); },
      async toggleMcpServer(name: string, enabled: boolean) { await (queryRef as any)?.toggleMcpServer?.(name, enabled); },
    };

    // Notify caller that the handle is ready (before SDK query starts)
    opts.onRunReady?.(handle);

    // ── Map effort + thinking config ──────────────────────────────────
    const EFFORT_MAP: Record<string, 'low' | 'medium' | 'high' | 'max'> = {
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max',
    };
    const effort = opts.config.reasoningEffort
      ? EFFORT_MAP[opts.config.reasoningEffort]
      : undefined;

    // Build thinking config
    let thinking: { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' } | undefined;
    const thinkingCfg = opts.config.thinking;
    if (thinkingCfg === 'adaptive') {
      thinking = { type: 'adaptive' };
    } else if (thinkingCfg === 'disabled') {
      thinking = { type: 'disabled' };
    } else if (thinkingCfg && typeof thinkingCfg === 'object' && 'type' in thinkingCfg) {
      thinking = thinkingCfg as any;
    }

    // ── SDK query with async generator prompt ───────────────────────
    // Resolve node binary for spawnClaudeCodeProcess (fixes ENOENT in Electron)
    const nodePath = resolveNodeBinary();

    const q = query({
      prompt: messageGenerator() as any,
      options: {
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        tools: { type: 'preset', preset: 'claude_code' } as any,
        disallowedTools: ['EnterPlanMode', 'ExitPlanMode'],
        agents: opts.agents as any,
        hooks: opts.hooks as any,
        mcpServers: opts.mcpServer as any,
        resume: opts.resumeId,
        permissionMode: opts.config.permissionMode as any,
        allowDangerouslySkipPermissions: opts.config.permissionMode === 'bypassPermissions',
        sandbox: opts.sandbox as any,
        cwd: opts.cwd,
        env: opts.env,
        maxTurns: opts.maxTurns,
        maxBudgetUsd: opts.config.maxBudgetUsd,
        effort,
        thinking,
        includePartialMessages: true,
        canUseTool: opts.canUseTool as any,
        abortController: opts.abortController,
        stderr: (data: string) => console.error(`[claude:stderr] ${data.trimEnd()}`),
        // Custom spawner: use resolved node path instead of bare "node" lookup
        spawnClaudeCodeProcess: (spawnOpts: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; signal: AbortSignal }) => {
          // If the SDK resolved a native binary, use it directly. Otherwise use our resolved node.
          const cmd = spawnOpts.command === 'node' ? nodePath : spawnOpts.command;
          const proc = spawn(cmd, spawnOpts.args, {
            cwd: spawnOpts.cwd,
            env: spawnOpts.env as NodeJS.ProcessEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            signal: spawnOpts.signal,
          });
          return {
            stdin: proc.stdin!,
            stdout: proc.stdout!,
            get killed() { return proc.killed; },
            get exitCode() { return proc.exitCode; },
            kill: proc.kill.bind(proc),
            on: proc.on.bind(proc),
            once: proc.once.bind(proc),
            off: proc.off.bind(proc),
          };
        },
      } as any,
    });

    // Bind SDK query methods to the handle for gateway access
    queryRef = q;

    let result = '';
    let sessionId = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    try {
      for await (const msg of q) {
        yield msg as ProviderMessage;

        const m = msg as Record<string, unknown>;
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
          sessionId = m.session_id as string;
        }
        if (m.type === 'assistant' && m.message) {
          const content = (m.message as any)?.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === 'text') result = b.text;
            }
          }
        }
        if (m.type === 'result') {
          result = (m.result as string) || result;
          sessionId = (m.session_id as string) || sessionId;
          const u = m.usage as Record<string, number> | undefined;
          usage = {
            inputTokens: u?.input_tokens || 0,
            outputTokens: u?.output_tokens || 0,
            totalCostUsd: (m.total_cost_usd as number) || 0,
          };
        }
      }
    } finally {
      closed = true;
    }

    return { result, sessionId, usage };
  }
}
