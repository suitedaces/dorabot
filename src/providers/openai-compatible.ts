import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Config } from '../config.js';
import { DORABOT_DIR, OPENAI_COMPATIBLE_KEY_PATH } from '../workspace.js';
import { getSecretStorageBackend, keychainDelete, keychainLoad, keychainStore } from '../auth/keychain.js';
import { CodexProvider, isCodexInstalled } from './codex.js';
import type {
  Provider,
  ProviderAuthStatus,
  ProviderMessage,
  ProviderQueryResult,
  ProviderRunOptions,
} from './types.js';

const OPENAI_COMPATIBLE_KEY_FILE = OPENAI_COMPATIBLE_KEY_PATH;
const KEYCHAIN_API_KEY_ACCOUNT = 'openai-compatible-api-key';

function ensureDorabotDir(): void {
  mkdirSync(DORABOT_DIR, { recursive: true });
}

function normalizeBaseUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

function loadPersistedOpenAICompatibleKey(): string | undefined {
  const fromKeychain = keychainLoad(KEYCHAIN_API_KEY_ACCOUNT);
  if (fromKeychain) return fromKeychain;
  try {
    if (existsSync(OPENAI_COMPATIBLE_KEY_FILE)) {
      const key = readFileSync(OPENAI_COMPATIBLE_KEY_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function persistOpenAICompatibleKey(apiKey: string): void {
  const savedToKeychain = keychainStore(KEYCHAIN_API_KEY_ACCOUNT, apiKey);
  if (savedToKeychain) return;

  try {
    ensureDorabotDir();
    writeFileSync(OPENAI_COMPATIBLE_KEY_FILE, apiKey, { mode: 0o600 });
    chmodSync(OPENAI_COMPATIBLE_KEY_FILE, 0o600);
  } catch (err) {
    console.error('[openai-compatible] failed to persist API key:', err);
  }
}

function clearPersistedOpenAICompatibleKey(): void {
  keychainDelete(KEYCHAIN_API_KEY_ACCOUNT);
  try {
    if (existsSync(OPENAI_COMPATIBLE_KEY_FILE)) {
      writeFileSync(OPENAI_COMPATIBLE_KEY_FILE, '', { mode: 0o600 });
      chmodSync(OPENAI_COMPATIBLE_KEY_FILE, 0o600);
    }
  } catch {
    // ignore
  }
}

function getOpenAICompatibleApiKey(): string | undefined {
  const envKey = process.env.OPENAI_COMPATIBLE_API_KEY?.trim();
  if (envKey) return envKey;
  return loadPersistedOpenAICompatibleKey();
}

export function hasOpenAICompatibleAuth(): boolean {
  return !!getOpenAICompatibleApiKey();
}

export async function listOpenAICompatibleModels(config: Config): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.provider?.openaiCompatible?.baseUrl);
  if (!baseUrl) {
    throw new Error('OpenAI-compatible base URL is not set');
  }

  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const apiKey = getOpenAICompatibleApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch models: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Model list request failed: HTTP ${res.status}${body ? ` - ${body.slice(0, 200)}` : ''}`);
  }

  const payload = await res.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
  const models = Array.isArray(payload?.data)
    ? payload.data
      .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
      .filter((id) => id.length > 0)
    : [];

  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

function buildPatchedConfig(config: Config, apiKey: string | undefined): Config {
  const compat = config.provider?.openaiCompatible;
  const mergedCodexConfig = {
    ...config.provider?.codex,
    model: compat?.model ?? config.provider?.codex?.model,
    sandboxMode: compat?.sandboxMode ?? config.provider?.codex?.sandboxMode,
    approvalPolicy: compat?.approvalPolicy ?? config.provider?.codex?.approvalPolicy,
    networkAccess: compat?.networkAccess ?? config.provider?.codex?.networkAccess,
    webSearch: compat?.webSearch ?? config.provider?.codex?.webSearch,
    baseUrl: normalizeBaseUrl(compat?.baseUrl),
    authOverrides: {
      apiKey,
      suppressStoredKey: true,
      suppressOAuth: true,
      suppressCliAuth: true,
    },
  } as any;

  return {
    ...config,
    provider: {
      ...config.provider,
      codex: mergedCodexConfig,
    },
  };
}

export class OpenAICompatibleProvider implements Provider {
  readonly name = 'openai-compatible';
  private readonly codex = new CodexProvider();

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const installed = await isCodexInstalled();
    if (!installed) {
      return { ready: false, reason: 'codex binary not found. Install with: npm i -g @openai/codex' };
    }

    const auth = await this.getAuthStatus();
    if (!auth.authenticated) {
      return { ready: false, reason: auth.error || 'Not authenticated. Use provider.auth.apiKey.' };
    }

    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const storageBackend = getSecretStorageBackend();
    const apiKey = getOpenAICompatibleApiKey();
    if (apiKey) {
      return {
        authenticated: true,
        method: 'api_key',
        identity: process.env.OPENAI_COMPATIBLE_API_KEY ? 'env:OPENAI_COMPATIBLE_API_KEY' : 'managed key',
        storageBackend,
      };
    }

    return {
      authenticated: false,
      method: 'api_key',
      error: 'Not authenticated with OpenAI-compatible provider',
      storageBackend,
      tokenHealth: 'expired',
    };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      clearPersistedOpenAICompatibleKey();
    } else {
      persistOpenAICompatibleKey(trimmed);
    }
    return this.getAuthStatus();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const compatApiKey = getOpenAICompatibleApiKey();
    const patchedConfig = buildPatchedConfig(opts.config, compatApiKey);
    return yield* this.codex.query({
      ...opts,
      config: patchedConfig,
    });
  }

  async dispose(): Promise<void> {
    await this.codex.dispose?.();
  }
}
