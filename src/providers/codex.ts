import { createServer, type Server } from 'node:http';
import { execFile, execSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult, ProviderInputItem } from './types.js';
import type { ReasoningEffort, CodexCliConfigValue, CodexMcpOauthCredentialsStore } from '../config.js';
import { DORABOT_DIR, CODEX_OAUTH_PATH, OPENAI_KEY_PATH, TMP_DIR } from '../workspace.js';
import { getSecretStorageBackend, keychainDelete, keychainLoad, keychainStore, type SecretStorageBackend } from '../auth/keychain.js';
import { guardImages } from './image-guard.js';
import { isLoggedInCodexStatusText, summarizeCodexCliAuthRecord } from './codex-auth-state.js';
import { mergeSkillEnv } from '../skills/env.js';

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
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;

  const localBin = join(projectRoot(), 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
  if (existsSync(localBin)) return localBin;

  return 'codex';
}

const codexBinary = findCodexBinary();

export type CodexModelCatalogEntry = {
  id: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string | null }>;
  defaultReasoningEffort?: string | null;
  inputModalities?: string[];
  supportsPersonality?: boolean;
  isDefault?: boolean;
  upgrade?: string | null;
  upgradeInfo?: unknown;
  availabilityNux?: unknown;
  additionalSpeedTiers?: unknown[];
};

export type CodexAccountInfo = {
  type?: string;
  email?: string;
  planType?: string;
};

export type CodexModelCatalog = {
  account: CodexAccountInfo | null;
  requiresOpenaiAuth: boolean;
  models: CodexModelCatalogEntry[];
  source: 'app-server';
};

export type CodexAppServerSnapshot = CodexModelCatalog & {
  config: unknown;
  configLayers: unknown[] | null;
  configOrigins: Record<string, unknown>;
  experimentalFeatures: unknown[];
  skills: unknown[];
  plugins: unknown;
  apps: unknown[];
  mcpServers: unknown[];
  rateLimits: unknown | null;
  configRequirements: unknown | null;
};

type CodexAppReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type AppServerUserInput =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

function resolveNodeBinary(): string {
  if (!process.versions.electron && process.execPath) return process.execPath;

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const resolved = execSync(`${shell} -lc 'command -v node'`, {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // fall through
  }

  return 'node';
}

function projectRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function resolveTsxBinary(): string | null {
  const local = join(projectRoot(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (existsSync(local)) return local;

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const resolved = execSync(`${shell} -lc 'command -v tsx'`, {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
    return resolved || null;
  } catch {
    return null;
  }
}

function pickMcpChildEnv(baseEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'CODEX_HOME']) {
    const value = baseEnv[key];
    if (value) env[key] = value;
  }
  return mergeSkillEnv(env);
}

function getDorabotMcpServerSpec(baseEnv: Record<string, string>): { command: string; args: string[]; env: Record<string, string> } {
  const providerDir = dirname(fileURLToPath(import.meta.url));
  const builtServer = join(providerDir, '..', 'tools', 'mcp-stdio-server.js');
  if (existsSync(builtServer)) {
    return {
      command: resolveNodeBinary(),
      args: [builtServer],
      env: pickMcpChildEnv(baseEnv),
    };
  }

  const sourceServer = join(providerDir, '..', 'tools', 'mcp-stdio-server.ts');
  const tsxBinary = resolveTsxBinary();
  if (tsxBinary && existsSync(sourceServer)) {
    return {
      command: tsxBinary,
      args: [sourceServer],
      env: pickMcpChildEnv(baseEnv),
    };
  }

  throw new Error('dorabot MCP stdio server entrypoint not found');
}

function normalizeMcpServerEnv(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') return undefined;

  const normalized = Object.fromEntries(
    Object.entries(env as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => [key, String(item)]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function copyMcpOption(target: Record<string, unknown>, config: Record<string, unknown>, from: string, to = from): void {
  const value = config[from];
  if (value === undefined || value === null) return;
  target[to] = value;
}

function normalizeCodexMcpServers(rawServers: unknown, baseEnv: Record<string, string>): Record<string, Record<string, unknown>> | undefined {
  if (!rawServers || typeof rawServers !== 'object') return undefined;

  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [name, rawConfig] of Object.entries(rawServers as Record<string, unknown>)) {
    if (!rawConfig || typeof rawConfig !== 'object') continue;
    const config = rawConfig as Record<string, unknown>;

    if (name === 'dorabot-tools' || config.type === 'sdk' || 'instance' in config) {
      mcpServers[name] = getDorabotMcpServerSpec(baseEnv);
      continue;
    }

    if (typeof config.command === 'string') {
      const args = Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === 'string')
        : undefined;
      const env = normalizeMcpServerEnv(config.env);
      const server: Record<string, unknown> = {
        command: config.command,
        ...(args && args.length > 0 ? { args } : {}),
        ...(env ? { env } : {}),
      };
      copyMcpOption(server, config, 'cwd');
      copyMcpOption(server, config, 'enabled');
      copyMcpOption(server, config, 'startup_timeout_sec');
      copyMcpOption(server, config, 'tool_timeout_sec');
      copyMcpOption(server, config, 'enabled_tools');
      copyMcpOption(server, config, 'disabled_tools');
      copyMcpOption(server, config, 'env_vars');
      mcpServers[name] = server;
      continue;
    }

    if (typeof config.url === 'string') {
      const httpHeaders = normalizeStringRecord(config.http_headers || config.headers);
      const server: Record<string, unknown> = { url: config.url };
      copyMcpOption(server, config, 'enabled');
      copyMcpOption(server, config, 'startup_timeout_sec');
      copyMcpOption(server, config, 'tool_timeout_sec');
      copyMcpOption(server, config, 'enabled_tools');
      copyMcpOption(server, config, 'disabled_tools');
      copyMcpOption(server, config, 'bearer_token_env_var');
      if (httpHeaders) server.http_headers = httpHeaders;
      mcpServers[name] = server;
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

function isCodexCliConfigValue(value: unknown): value is CodexCliConfigValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isCodexCliConfigValue);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isCodexCliConfigValue);
}

function normalizeCodexCliConfig(rawConfig: unknown): Record<string, CodexCliConfigValue> {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return {};
  const config: Record<string, CodexCliConfigValue> = {};
  for (const [key, value] of Object.entries(rawConfig as Record<string, unknown>)) {
    if (isCodexCliConfigValue(value)) config[key] = value;
  }
  return config;
}

function extractMcpServersFromConfig(config: Record<string, CodexCliConfigValue>): Record<string, Record<string, unknown>> | undefined {
  const rawMcpServers = config.mcp_servers;
  if (!rawMcpServers || typeof rawMcpServers !== 'object' || Array.isArray(rawMcpServers)) return undefined;
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(rawMcpServers as Record<string, unknown>)) {
    if (server && typeof server === 'object' && !Array.isArray(server)) {
      servers[name] = server as Record<string, unknown>;
    }
  }
  return Object.keys(servers).length > 0 ? servers : undefined;
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function stripDataUri(data: string): string {
  return data.includes(',') ? data.split(',')[1] : data;
}

async function prepareCodexInput(
  prompt: string,
  images?: ProviderRunOptions['images'],
  extraItems: ProviderInputItem[] = [],
): Promise<{ input: AppServerUserInput[]; cleanup: () => void }> {
  if (!images?.length) {
    return { input: [{ type: 'text', text: prompt, text_elements: [] }, ...extraItems], cleanup: () => {} };
  }

  mkdirSync(TMP_DIR, { recursive: true });

  const { valid, warnings } = await guardImages(images);
  const promptText = warnings.length
    ? `${prompt}\n\n[Image warning: ${warnings.join('; ')}]`
    : prompt;

  if (!valid.length) {
    return { input: [{ type: 'text', text: promptText, text_elements: [] }, ...extraItems], cleanup: () => {} };
  }

  const tempPaths: string[] = [];
  const input: AppServerUserInput[] = [{ type: 'text', text: promptText, text_elements: [] }, ...extraItems];

  try {
    for (const image of valid) {
      const ext = extensionForMediaType(image.mediaType);
      const path = join(TMP_DIR, `codex-image-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`);
      writeFileSync(path, Buffer.from(stripDataUri(image.data), 'base64'));
      tempPaths.push(path);
      input.push({ type: 'localImage', path });
    }
  } catch (err) {
    for (const path of tempPaths) {
      try { unlinkSync(path); } catch {}
    }
    throw err;
  }

  return {
    input,
    cleanup: () => {
      for (const path of tempPaths) {
        try { unlinkSync(path); } catch {}
      }
    },
  };
}

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

type JsonRpcResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string } | string;
};

function jsonRpcErrorMessage(error: JsonRpcResponse['error']): string {
  if (!error) return 'unknown JSON-RPC error';
  if (typeof error === 'string') return error;
  return error.message || JSON.stringify(error);
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve));
      },
    };
  }
}

type AppServerRequestHandler = (message: JsonRpcResponse) => Promise<unknown>;

class CodexAppServerClient {
  private readonly child: ReturnType<typeof spawn>;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly notifications = new AsyncQueue<JsonRpcResponse>();
  private nextId = 1;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private closed = false;
  private requestHandler: AppServerRequestHandler | null;

  private constructor(env: Record<string, string>, requestHandler?: AppServerRequestHandler | null) {
    this.requestHandler = requestHandler || null;
    this.child = spawn(codexBinary, ['app-server'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.once('error', (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    this.child.once('exit', (code, signal) => {
      if (this.closed) return;
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      this.failAll(new Error(`Codex app-server exited with ${detail}${this.stderrBuffer ? `: ${this.stderrBuffer.slice(0, 500)}` : ''}`));
    });
    this.child.stderr?.on('data', (chunk) => { this.stderrBuffer += chunk.toString(); });
    this.child.stdout?.on('data', (chunk) => this.readStdout(chunk.toString()));
  }

  static async start(args: { env?: Record<string, string>; requestHandler?: AppServerRequestHandler | null } = {}): Promise<CodexAppServerClient> {
    ensureCodexHome();
    const client = new CodexAppServerClient(args.env || codexEnv(), args.requestHandler);
    await client.request('initialize', {
      clientInfo: {
        name: 'dorabot',
        title: 'Dorabot',
        version: process.env.npm_package_version || 'unknown',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    client.notify('initialized', {});
    return client;
  }

  setRequestHandler(handler: AppServerRequestHandler | null): void {
    this.requestHandler = handler;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new Error('Codex app-server is closed');
    const id = this.nextId++;
    const message: Record<string, unknown> = { method, id };
    if (params !== undefined) message.params = params;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.send(message);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    const message: Record<string, unknown> = { method };
    if (params !== undefined) message.params = params;
    this.send(message);
  }

  respond(id: number, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: number, message: string): void {
    this.send({ id, error: { code: -32000, message } });
  }

  events(): AsyncIterable<JsonRpcResponse> {
    return this.notifications;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.notifications.close();
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Codex app-server closed'));
    }
    this.pending.clear();
    try { this.child.kill(); } catch { /* ignore */ }
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin?.write(JSON.stringify(message) + '\n');
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      newline = this.stdoutBuffer.indexOf('\n');
      if (!line) continue;

      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(jsonRpcErrorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      const id = message.id;
      if (!this.requestHandler) {
        this.respondError(id, `Unhandled server request: ${message.method}`);
        return;
      }
      this.requestHandler(message)
        .then(result => this.respond(id, result ?? {}))
        .catch(err => this.respondError(id, err instanceof Error ? err.message : String(err)));
      return;
    }

    if (message.method) this.notifications.push(message);
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.notifications.close();
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function getCodexModelCatalog(): Promise<CodexModelCatalog> {
  const client = await CodexAppServerClient.start();
  try {
    const accountResult = await client.request('account/read', { refreshToken: false }) as {
      account?: CodexAccountInfo | null;
      requiresOpenaiAuth?: boolean;
    };
    return {
      account: accountResult.account || null,
      requiresOpenaiAuth: accountResult.requiresOpenaiAuth ?? true,
      models: await listCodexModels(client),
      source: 'app-server',
    };
  } finally {
    client.close();
  }
}

async function listCodexModels(client: CodexAppServerClient): Promise<CodexModelCatalogEntry[]> {
  const models: CodexModelCatalogEntry[] = [];
  let cursor: string | null | undefined;
  do {
    const result = await client.request('model/list', {
      includeHidden: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    }) as { data?: CodexModelCatalogEntry[]; nextCursor?: string | null };
    if (Array.isArray(result?.data)) {
      models.push(...result.data.filter(model => typeof model?.id === 'string' && model.id.length > 0));
    }
    cursor = result?.nextCursor;
  } while (cursor);
  return models;
}

async function listPaged(client: CodexAppServerClient, method: string, params: Record<string, unknown>): Promise<unknown[]> {
  const data: unknown[] = [];
  let cursor: string | null | undefined;
  do {
    const result = await client.request(method, { ...params, ...(cursor ? { cursor } : {}) }) as { data?: unknown[]; nextCursor?: string | null };
    if (Array.isArray(result?.data)) data.push(...result.data);
    cursor = result?.nextCursor;
  } while (cursor);
  return data;
}

function normalizeMentionName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function markerNamesFromPrompt(prompt: string): Set<string> {
  const names = new Set<string>();
  for (const match of prompt.matchAll(/(?:^|\s)\$([a-zA-Z0-9][a-zA-Z0-9_-]{0,80})\b/g)) {
    names.add(match[1]!);
  }
  return names;
}

function addUniqueInputItem(items: ProviderInputItem[], item: ProviderInputItem): void {
  if (items.some(existing => existing.type === item.type && existing.path === item.path)) return;
  items.push(item);
}

async function resolveCodexStructuredInputItems(
  client: CodexAppServerClient,
  prompt: string,
  cwd: string,
  explicitItems: ProviderInputItem[] | undefined,
): Promise<ProviderInputItem[]> {
  const items: ProviderInputItem[] = [];
  for (const item of explicitItems || []) {
    if ((item.type === 'skill' || item.type === 'mention') && item.name && item.path) {
      addUniqueInputItem(items, item);
    }
  }

  const markers = markerNamesFromPrompt(prompt);
  if (markers.size === 0) return items;

  const skillsResult = await client.request('skills/list', { cwds: [cwd], forceReload: false })
    .catch(() => ({ data: [] })) as { data?: Array<{ skills?: Array<Record<string, unknown>> }> };
  for (const group of skillsResult.data || []) {
    for (const skill of group.skills || []) {
      const name = typeof skill.name === 'string' ? skill.name : '';
      const path = typeof skill.path === 'string' ? skill.path : '';
      if (name && path && markers.has(name)) addUniqueInputItem(items, { type: 'skill', name, path });
    }
  }

  const apps = await listPaged(client, 'app/list', { limit: 100, forceRefetch: false }).catch(() => []);
  for (const app of apps as Array<Record<string, unknown>>) {
    const id = typeof app.id === 'string' ? app.id : '';
    const name = typeof app.name === 'string' ? app.name : id;
    if (!id) continue;
    const candidates = new Set([id, normalizeMentionName(id), normalizeMentionName(name)]);
    if ([...markers].some(marker => candidates.has(marker) || candidates.has(normalizeMentionName(marker)))) {
      addUniqueInputItem(items, { type: 'mention', name, path: `app://${id}` });
    }
  }

  return items;
}

export async function getCodexAppServerSnapshot(cwd?: string): Promise<CodexAppServerSnapshot> {
  const client = await CodexAppServerClient.start();
  try {
    const accountResult = await client.request('account/read', { refreshToken: false }) as {
      account?: CodexAccountInfo | null;
      requiresOpenaiAuth?: boolean;
    };

    const [
      models,
      configResult,
      experimentalFeatures,
      skillsResult,
      plugins,
      apps,
      mcpServers,
      rateLimits,
      configRequirements,
    ] = await Promise.all([
      listCodexModels(client),
      client.request('config/read', { includeLayers: true, ...(cwd ? { cwd } : {}) }).catch(err => ({ error: err instanceof Error ? err.message : String(err) })),
      listPaged(client, 'experimentalFeature/list', { limit: 100 }).catch(() => []),
      client.request('skills/list', { cwds: cwd ? [cwd] : [], forceReload: true }).catch(err => ({ error: err instanceof Error ? err.message : String(err), data: [] })),
      client.request('plugin/list', { ...(cwd ? { cwds: [cwd] } : {}) }).catch(err => ({ error: err instanceof Error ? err.message : String(err) })),
      listPaged(client, 'app/list', { limit: 100, forceRefetch: false }).catch(() => []),
      listPaged(client, 'mcpServerStatus/list', { limit: 100, detail: 'full' }).catch(() => []),
      client.request('account/rateLimits/read', undefined).catch(err => ({ error: err instanceof Error ? err.message : String(err) })),
      client.request('configRequirements/read', undefined).catch(err => ({ error: err instanceof Error ? err.message : String(err) })),
    ]);

    const configRead = configResult as { config?: unknown; layers?: unknown[] | null; origins?: Record<string, unknown> };
    const skillsRead = skillsResult as { data?: unknown[] };

    return {
      account: accountResult.account || null,
      requiresOpenaiAuth: accountResult.requiresOpenaiAuth ?? true,
      models,
      source: 'app-server',
      config: configRead.config ?? configResult,
      configLayers: configRead.layers ?? null,
      configOrigins: configRead.origins ?? {},
      experimentalFeatures,
      skills: Array.isArray(skillsRead.data) ? skillsRead.data : [],
      plugins,
      apps,
      mcpServers,
      rateLimits,
      configRequirements,
    };
  } finally {
    client.close();
  }
}

const CODEX_APP_SERVER_RPC_METHODS = new Set([
  'account/read',
  'account/login/start',
  'account/login/cancel',
  'account/logout',
  'account/rateLimits/read',
  'account/sendAddCreditsNudgeEmail',
  'getAuthStatus',
  'thread/list',
  'thread/start',
  'thread/resume',
  'thread/read',
  'thread/turns/list',
  'thread/loaded/list',
  'thread/name/set',
  'thread/goal/set',
  'thread/goal/get',
  'thread/goal/clear',
  'thread/metadata/update',
  'thread/archive',
  'thread/unsubscribe',
  'thread/unarchive',
  'thread/compact/start',
  'thread/shellCommand',
  'thread/approveGuardianDeniedAction',
  'thread/backgroundTerminals/clean',
  'thread/rollback',
  'thread/fork',
  'thread/inject_items',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'review/start',
  'command/exec',
  'command/exec/write',
  'command/exec/resize',
  'command/exec/terminate',
  'model/list',
  'modelProvider/capabilities/read',
  'experimentalFeature/list',
  'experimentalFeature/enablement/set',
  'collaborationMode/list',
  'skills/list',
  'skills/config/write',
  'hooks/list',
  'marketplace/add',
  'marketplace/remove',
  'marketplace/upgrade',
  'plugin/list',
  'plugin/read',
  'plugin/install',
  'plugin/uninstall',
  'app/list',
  'device/key/create',
  'device/key/public',
  'device/key/sign',
  'mcpServer/oauth/login',
  'config/mcpServer/reload',
  'mcpServerStatus/list',
  'mcpServer/resource/read',
  'mcpServer/tool/call',
  'feedback/upload',
  'config/read',
  'config/value/write',
  'config/batchWrite',
  'configRequirements/read',
  'externalAgentConfig/detect',
  'externalAgentConfig/import',
  'getConversationSummary',
  'gitDiffToRemote',
  'fs/readFile',
  'fs/writeFile',
  'fs/createDirectory',
  'fs/getMetadata',
  'fs/readDirectory',
  'fs/remove',
  'fs/copy',
  'fs/watch',
  'fs/unwatch',
  'windowsSandbox/setupStart',
  'fuzzyFileSearch',
]);

let sharedCodexAppServerRpcClient: CodexAppServerClient | null = null;

async function getSharedCodexAppServerRpcClient(): Promise<CodexAppServerClient> {
  if (sharedCodexAppServerRpcClient && !sharedCodexAppServerRpcClient.isClosed()) {
    return sharedCodexAppServerRpcClient;
  }
  sharedCodexAppServerRpcClient = await CodexAppServerClient.start();
  return sharedCodexAppServerRpcClient;
}

export function closeCodexAppServerRpcClient(): void {
  sharedCodexAppServerRpcClient?.close();
  sharedCodexAppServerRpcClient = null;
}

export async function callCodexAppServer(method: string, params?: unknown): Promise<unknown> {
  if (!CODEX_APP_SERVER_RPC_METHODS.has(method)) {
    throw new Error(`Codex app-server RPC is not exposed: ${method}`);
  }
  const client = await getSharedCodexAppServerRpcClient();
  try {
    return await client.request(method, params);
  } catch (err) {
    if (client.isClosed()) sharedCodexAppServerRpcClient = null;
    throw err;
  }
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
  id_token?: string;
};

type CodexCliAuthStatus = {
  method: 'api_key' | 'oauth';
  identity?: string;
  storageBackend: SecretStorageBackend;
};

let nextRefreshAt: number | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectRequired = false;
let lastAuthRequiredEmit = 0;
const AUTH_REQUIRED_COOLDOWN_MS = 60_000;
let cachedCliAuthStatus: CodexCliAuthStatus | null | undefined;
const authRequiredListeners = new Set<(reason: string) => void>();

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function emitAuthRequired(reason: string): void {
  reconnectRequired = true;
  const now = Date.now();
  if (now - lastAuthRequiredEmit < AUTH_REQUIRED_COOLDOWN_MS) return;
  lastAuthRequiredEmit = now;
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

function loadCodexCliAuthRecord(): Record<string, unknown> | null {
  const authFile = join(codexHome(), 'auth.json');
  if (!existsSync(authFile)) return null;
  try {
    const raw = JSON.parse(readFileSync(authFile, 'utf-8'));
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function persistCodexCliAuthRecord(record: Record<string, unknown>): void {
  try {
    ensureCodexHome();
    const authFile = join(codexHome(), 'auth.json');
    writeFileSync(authFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    chmodSync(authFile, 0o600);
    cachedCliAuthStatus = undefined;
  } catch (err) {
    console.error('[codex] failed to persist CLI auth.json:', err);
  }
}

function syncDorabotOAuthToCodexCli(tokens: CodexOAuthTokens): void {
  const existing = loadCodexCliAuthRecord();
  const existingTokens = existing?.tokens;
  const existingIdToken = existingTokens && typeof existingTokens === 'object'
    ? asNonEmptyString((existingTokens as Record<string, unknown>).id_token)
    : undefined;

  persistCodexCliAuthRecord({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      ...(tokens.id_token || existingIdToken ? { id_token: tokens.id_token || existingIdToken } : {}),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: tokens.account_id,
    },
    last_refresh: new Date().toISOString(),
  });
}

function persistCodexOAuthTokens(tokens: CodexOAuthTokens): void {
  reconnectRequired = false;
  const savedToKeychain = keychainStore(KEYCHAIN_OAUTH_ACCOUNT, JSON.stringify(tokens));
  syncDorabotOAuthToCodexCli(tokens);
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

async function getCodexCliAuthStatus(): Promise<CodexCliAuthStatus | null> {
  if (cachedCliAuthStatus !== undefined) return cachedCliAuthStatus;

  const summary = summarizeCodexCliAuthRecord(loadCodexCliAuthRecord());
  if (summary) {
    cachedCliAuthStatus = {
      ...summary,
      storageBackend: 'file',
    };
    return cachedCliAuthStatus;
  }

  try {
    const { stdout, stderr, code } = await runCodexCmd(['login', 'status']);
    const text = `${stdout}\n${stderr}`.trim();
    if (code === 0 && isLoggedInCodexStatusText(text)) {
      const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || 'Logged in';
      cachedCliAuthStatus = {
        method: /api key/i.test(firstLine) ? 'api_key' : 'oauth',
        identity: /using\s+(.+)$/i.test(firstLine)
          ? firstLine.replace(/^.*using\s+/i, '').trim()
          : 'Codex CLI',
        storageBackend: 'keychain',
      };
      return cachedCliAuthStatus;
    }
  } catch {
    // fall through
  }

  cachedCliAuthStatus = null;
  return cachedCliAuthStatus;
}

function invalidateCodexAuthCache(): void {
  cachedCliAuthStatus = undefined;
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
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; id_token?: string };
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
      ...(data.id_token ? { id_token: data.id_token } : {}),
    };
  } catch (err) {
    console.error('[codex] token exchange error:', err);
    return null;
  }
}

async function refreshCodexAccessToken(refreshToken: string, previousIdToken?: string): Promise<CodexOAuthTokens | null> {
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
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; id_token?: string };
    if (!data.access_token || !data.refresh_token) return null;
    const accountId = getAccountId(data.access_token);
    if (!accountId) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
      ...(data.id_token || previousIdToken ? { id_token: data.id_token || previousIdToken } : {}),
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
    // Retry refresh up to 3 times with exponential backoff
    let refreshed: CodexOAuthTokens | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      refreshed = await refreshCodexAccessToken(latest.refresh_token, latest.id_token);
      if (refreshed) break;
      if (attempt < 2) {
        const backoff = (attempt + 1) * 5_000;
        console.log(`[codex] token refresh attempt ${attempt + 1} failed, retrying in ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    if (!refreshed) {
      emitAuthRequired('OAuth refresh failed after retries');
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
    const refreshed = await refreshCodexAccessToken(tokens.refresh_token, tokens.id_token);
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

function getOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || loadPersistedOpenAIKey();
}

async function resolveCodexAuthState(): Promise<{ apiKey?: string; status: ProviderAuthStatus }> {
  const storageBackend = getSecretStorageBackend();
  const explicitApiKey = getOpenAIApiKey();
  if (explicitApiKey) {
    return {
      apiKey: explicitApiKey,
      status: {
        authenticated: true,
        method: 'api_key',
        identity: process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : 'managed key',
        storageBackend,
      },
    };
  }

  const oauthTokens = loadCodexOAuthTokens();
  if (oauthTokens) {
    const token = await ensureCodexOAuthToken();
    const latest = loadCodexOAuthTokens() || oauthTokens;
    if (token) {
      syncDorabotOAuthToCodexCli(latest);
      return {
        status: {
          authenticated: true,
          method: 'oauth',
          identity: `ChatGPT (${latest.account_id})`,
          storageBackend,
          tokenHealth: tokenHealth(latest),
          nextRefreshAt: nextRefreshAt || undefined,
          reconnectRequired,
        },
      };
    }
  }

  const cliAuth = await getCodexCliAuthStatus();
  if (cliAuth) {
    return {
      status: {
        authenticated: true,
        method: cliAuth.method,
        identity: cliAuth.identity,
        storageBackend: cliAuth.storageBackend,
        tokenHealth: 'valid',
      },
    };
  }

  if (oauthTokens) {
    const latest = loadCodexOAuthTokens() || oauthTokens;
    return {
      status: {
        authenticated: false,
        method: 'oauth',
        error: 'OAuth token expired. Reconnect required.',
        storageBackend,
        tokenHealth: tokenHealth(latest),
        nextRefreshAt: nextRefreshAt || undefined,
        reconnectRequired: true,
      },
    };
  }

  return {
    status: {
      authenticated: false,
      error: 'Not authenticated with Codex',
      storageBackend,
      tokenHealth: 'expired',
    },
  };
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
  return !!getOpenAIApiKey() || !!loadCodexOAuthTokens() || !!summarizeCodexCliAuthRecord(loadCodexCliAuthRecord());
}

// ── Reasoning effort mapping ────────────────────────────────────────

const EFFORT_MAP: Record<ReasoningEffort, CodexAppReasoningEffort> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
  xhigh: 'xhigh',
};

function appServerConfigForRun(
  codexConfig: NonNullable<ProviderRunOptions['config']['provider']>['codex'] | undefined,
  mergedMcpServers: Record<string, Record<string, unknown>> | undefined,
  mcpOauthCredentialsStore: CodexMcpOauthCredentialsStore,
  cwd: string,
): Record<string, CodexCliConfigValue> {
  const config = normalizeCodexCliConfig(codexConfig?.config);
  if (codexConfig?.baseUrl) config.openai_base_url = codexConfig.baseUrl;
  if (codexConfig?.webSearch) config.web_search = codexConfig.webSearch;
  if (codexConfig?.skipGitRepoCheck !== undefined) config.skip_git_repo_check = codexConfig.skipGitRepoCheck;
  config.mcp_oauth_credentials_store = mcpOauthCredentialsStore;
  if (mergedMcpServers) config.mcp_servers = mergedMcpServers as CodexCliConfigValue;

  const additionalDirectories = normalizeStringArray(codexConfig?.additionalDirectories);
  if ((codexConfig?.sandboxMode || 'danger-full-access') === 'workspace-write' || additionalDirectories?.length) {
    config.sandbox_workspace_write = {
      writable_roots: [cwd, ...(additionalDirectories || [])],
      network_access: codexConfig?.networkAccess ?? true,
      exclude_tmpdir_env_var: false,
      exclude_slash_tmp: false,
    };
  }
  return config;
}

function serviceTierFromConfig(config: Record<string, CodexCliConfigValue>): 'fast' | 'flex' | undefined {
  return config.service_tier === 'fast' || config.service_tier === 'flex' ? config.service_tier : undefined;
}

function reasoningSummaryFromConfig(config: Record<string, CodexCliConfigValue>): 'auto' | 'none' | 'concise' | 'detailed' | undefined {
  const value = config.model_reasoning_summary;
  return value === 'auto' || value === 'none' || value === 'concise' || value === 'detailed' ? value : undefined;
}

function sandboxPolicyForRun(
  sandboxMode: string,
  cwd: string,
  additionalDirectories: string[] | undefined,
  networkAccess: boolean,
): Record<string, unknown> {
  if (sandboxMode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (sandboxMode === 'read-only') return { type: 'readOnly', networkAccess };
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd, ...(additionalDirectories || [])],
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function isToolAllowedDecision(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const behavior = (result as Record<string, unknown>).behavior;
  return behavior !== 'deny';
}

function textFromUnknownContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(textFromUnknownContent).filter(Boolean).join('\n');
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.message === 'string') return record.message;
  return JSON.stringify(record);
}

async function handleCodexServerRequest(message: JsonRpcResponse, opts: ProviderRunOptions): Promise<unknown> {
  const method = message.method || '';
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;

  if (method === 'item/commandExecution/requestApproval') {
    if (!opts.canUseTool) return { decision: 'decline' };
    const input = {
      command: typeof params.command === 'string' ? params.command : '',
      cwd: typeof params.cwd === 'string' ? params.cwd : opts.cwd,
      reason: typeof params.reason === 'string' ? params.reason : undefined,
    };
    const decision = await opts.canUseTool('Bash', input, {});
    return { decision: isToolAllowedDecision(decision) ? 'accept' : 'decline' };
  }

  if (method === 'execCommandApproval') {
    if (!opts.canUseTool) return { decision: 'denied' };
    const command = Array.isArray(params.command) ? params.command.map(String).join(' ') : '';
    const input = {
      command,
      cwd: typeof params.cwd === 'string' ? params.cwd : opts.cwd,
      reason: typeof params.reason === 'string' ? params.reason : undefined,
    };
    const decision = await opts.canUseTool('Bash', input, {});
    return { decision: isToolAllowedDecision(decision) ? 'approved' : 'denied' };
  }

  if (method === 'item/fileChange/requestApproval') {
    if (!opts.canUseTool) return { decision: 'decline' };
    const input = {
      description: typeof params.reason === 'string' ? params.reason : 'Codex file change',
      grantRoot: typeof params.grantRoot === 'string' ? params.grantRoot : undefined,
    };
    const decision = await opts.canUseTool('Edit', input, {});
    return { decision: isToolAllowedDecision(decision) ? 'accept' : 'decline' };
  }

  if (method === 'applyPatchApproval') {
    if (!opts.canUseTool) return { decision: 'denied' };
    const input = {
      description: typeof params.reason === 'string' ? params.reason : 'Codex file change',
      grantRoot: typeof params.grantRoot === 'string' ? params.grantRoot : undefined,
      fileChanges: params.fileChanges,
    };
    const decision = await opts.canUseTool('Edit', input, {});
    return { decision: isToolAllowedDecision(decision) ? 'approved' : 'denied' };
  }

  if (method === 'item/permissions/requestApproval') {
    const requested = params.permissions && typeof params.permissions === 'object'
      ? params.permissions as Record<string, unknown>
      : {};
    if (!opts.canUseTool) return { permissions: {}, scope: 'turn' };
    const decision = await opts.canUseTool('Bash', {
      reason: typeof params.reason === 'string' ? params.reason : 'Codex permission request',
      permissions: requested,
      cwd: typeof params.cwd === 'string' ? params.cwd : opts.cwd,
    }, {});
    if (!isToolAllowedDecision(decision)) return { permissions: {}, scope: 'turn' };
    const permissions: Record<string, unknown> = {};
    if (requested.network && typeof requested.network === 'object') permissions.network = requested.network;
    if (requested.fileSystem && typeof requested.fileSystem === 'object') permissions.fileSystem = requested.fileSystem;
    return { permissions, scope: 'turn' };
  }

  if (method === 'item/tool/requestUserInput') {
    if (!opts.canUseTool) return { answers: {} };
    const questions = Array.isArray(params.questions) ? params.questions as Array<Record<string, unknown>> : [];
    const routedQuestions = questions.map((question) => ({
      question: String(question.question || question.header || 'Question'),
      header: String(question.header || 'Question'),
      options: Array.isArray(question.options)
        ? (question.options as Array<Record<string, unknown>>).map(option => ({
            label: String(option.label || ''),
            description: String(option.description || ''),
          }))
        : [{ label: 'OK', description: '' }],
    }));
    const decision = await opts.canUseTool('AskUserQuestion', { questions: routedQuestions }, {});
    const updated = decision && typeof decision === 'object'
      ? (decision as Record<string, unknown>).updatedInput as Record<string, unknown> | undefined
      : undefined;
    const rawAnswers = updated?.answers && typeof updated.answers === 'object'
      ? updated.answers as Record<string, unknown>
      : {};
    const answers: Record<string, { answers: string[] }> = {};
    questions.forEach((question, index) => {
      const id = String(question.id || index);
      const text = String(question.question || question.header || 'Question');
      const value = rawAnswers[text] || rawAnswers[id] || routedQuestions[index]?.options?.[0]?.label || '';
      answers[id] = { answers: [String(value)] };
    });
    return { answers };
  }

  if (method === 'account/chatgptAuthTokens/refresh') {
    const accessToken = await ensureCodexOAuthToken();
    const latest = loadCodexOAuthTokens();
    if (!accessToken || !latest) throw new Error('No ChatGPT OAuth token available');
    return {
      accessToken,
      chatgptAccountId: latest.account_id,
      chatgptPlanType: null,
    };
  }

  if (method === 'mcpServer/elicitation/request') {
    return { action: 'decline', content: null, _meta: null };
  }

  if (method === 'item/tool/call') {
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: `Dynamic tool calls are not implemented in Dorabot for ${String(params.tool || 'unknown')}.` }],
    };
  }

  throw new Error(`Unhandled Codex app-server request: ${method}`);
}

// ── Provider ────────────────────────────────────────────────────────

export class CodexProvider implements Provider {
  readonly name = 'codex';
  private activeAbort: AbortController | null = null;
  private pendingOAuth: { verifier: string; state: string; server: OAuthServer } | null = null;

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
      return (await resolveCodexAuthState()).status;
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
    invalidateCodexAuthCache();
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
    const model = codexConfig?.model || 'gpt-5.5';
    const reasoningEffort = opts.config.reasoningEffort;
    const mcpOauthCredentialsStore = (codexConfig?.mcpOauthCredentialsStore || 'file') as CodexMcpOauthCredentialsStore;

    const authState = await resolveCodexAuthState();
    if (!authState.status.authenticated) {
      const result = `Codex error: ${authState.status.error || 'Not authenticated with Codex'}`;
      yield {
        type: 'result',
        subtype: 'error_max_turns',
        result,
        session_id: opts.resumeId || '',
      } as ProviderMessage;
      return {
        result,
        sessionId: opts.resumeId || '',
        usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      };
    }

    const appEnv: Record<string, string> = {
      ...codexEnv(),
      ...opts.env,
      CODEX_HOME: codexHome(),
    };
    if (authState.apiKey) {
      appEnv.OPENAI_API_KEY = authState.apiKey;
      appEnv.CODEX_API_KEY = authState.apiKey;
    }

    const mcpServers = normalizeCodexMcpServers(opts.mcpServer, appEnv);
    const codexCliConfig = normalizeCodexCliConfig(codexConfig?.config);
    const configuredMcpServers = extractMcpServersFromConfig(codexCliConfig);
    const mergedMcpServers = configuredMcpServers || mcpServers
      ? { ...(configuredMcpServers || {}), ...(mcpServers || {}) }
      : undefined;

    const modelReasoningEffort = reasoningEffort ? EFFORT_MAP[reasoningEffort] : undefined;
    const additionalDirectories = normalizeStringArray(codexConfig?.additionalDirectories);
    const appServerConfig = appServerConfigForRun(codexConfig, mergedMcpServers, mcpOauthCredentialsStore, opts.cwd);
    const serviceTier = serviceTierFromConfig(appServerConfig);
    const reasoningSummary = reasoningSummaryFromConfig(appServerConfig);
    const sandboxMode = (codexConfig?.sandboxMode as string) || 'danger-full-access';
    const networkAccess = codexConfig?.networkAccess ?? true;
    const sandboxPolicy = sandboxPolicyForRun(sandboxMode, opts.cwd, additionalDirectories, networkAccess);

    const threadParams = {
      model,
      cwd: opts.cwd,
      approvalPolicy: (codexConfig?.approvalPolicy as any) || 'never',
      sandbox: sandboxMode,
      config: appServerConfig,
      serviceName: 'dorabot',
      developerInstructions: opts.systemPrompt,
      ...(serviceTier ? { serviceTier } : {}),
    };

    const abort = opts.abortController || new AbortController();
    this.activeAbort = abort;

    let sessionId = opts.resumeId || '';
    let currentTurnId = '';
    let result = '';
    let lastAgentMessage = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
    let active = true;
    let emittedInit = false;
    let turnDone = false;
    let client: CodexAppServerClient | null = null;
    const pendingInputCleanups = new Set<() => void>();

    const se = (ev: Record<string, unknown>): ProviderMessage =>
      ({ type: 'stream_event', event: ev } as ProviderMessage);
    const itemTexts = new Map<string, string>();
    const startedBlocks = new Set<string>();
    const toolItems = new Set<string>();
    const toolOutputTexts = new Map<string, string>();

    const startTextBlock = function*(itemId: string, blockType: 'text' | 'thinking'): Generator<ProviderMessage> {
      if (startedBlocks.has(itemId)) return;
      startedBlocks.add(itemId);
      yield se({ type: 'content_block_start', content_block: { type: blockType } });
    };

    const appendText = function*(itemId: string, blockType: 'text' | 'thinking', text: string): Generator<ProviderMessage> {
      if (!text) return;
      yield* startTextBlock(itemId, blockType);
      yield se({
        type: 'content_block_delta',
        delta: blockType === 'text'
          ? { type: 'text_delta', text }
          : { type: 'thinking_delta', thinking: text },
      });
      itemTexts.set(itemId, (itemTexts.get(itemId) || '') + text);
    };

    const stopBlock = function*(itemId: string): Generator<ProviderMessage> {
      if (!startedBlocks.has(itemId)) return;
      yield se({ type: 'content_block_stop' });
      startedBlocks.delete(itemId);
      itemTexts.delete(itemId);
    };

    const emitToolUse = function*(itemId: string, name: string, input: Record<string, unknown>): Generator<ProviderMessage> {
      const toolId = `codex-${itemId}`;
      if (!toolItems.has(itemId)) {
        toolItems.add(itemId);
        yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name } });
        yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
        yield se({ type: 'content_block_stop' });
        yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input }] } } as ProviderMessage;
      }
    };

    const emitToolResult = function*(itemId: string, text: string, isError = false): Generator<ProviderMessage> {
      toolItems.delete(itemId);
      toolOutputTexts.delete(itemId);
      yield {
        type: 'result',
        subtype: 'tool_result',
        tool_use_id: `codex-${itemId}`,
        content: [{ type: 'text', text: text || '(no output)' }],
        is_error: isError,
      } as ProviderMessage;
    };

    const emitToolOutputDelta = function*(itemId: string, text: string): Generator<ProviderMessage> {
      if (!itemId || !text) return;
      toolOutputTexts.set(itemId, (toolOutputTexts.get(itemId) || '') + text);
      yield {
        type: 'result',
        subtype: 'tool_output_delta',
        tool_use_id: `codex-${itemId}`,
        content: [{ type: 'text', text }],
      } as ProviderMessage;
    };

    const describeFileChanges = (changes: any[]): string => (
      changes.map((change: any) => `${change.kind}: ${change.path}`).join('\n') || 'Files modified'
    );

    const emitFileChangeToolUse = function*(itemId: string, changes: any[]): Generator<ProviderMessage> {
      const firstPath = changes[0]?.path || '';
      const desc = describeFileChanges(changes);
      const isCreate = changes.length === 1 && changes[0]?.kind === 'add';
      yield* emitToolUse(itemId, isCreate ? 'Write' : 'Edit', { file_path: firstPath, description: desc });
    };

    const handleNotification = function*(message: JsonRpcResponse): Generator<ProviderMessage> {
      const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
      if (params.threadId && params.threadId !== sessionId) return;
      if (params.turnId && currentTurnId && params.turnId !== currentTurnId) return;

      if (message.method === 'thread/started') {
        const thread = params.thread as Record<string, unknown> | undefined;
        sessionId = String(thread?.id || sessionId || `codex-${Date.now()}`);
        if (!emittedInit) {
          emittedInit = true;
          yield { type: 'system', subtype: 'init', session_id: sessionId, model } as ProviderMessage;
        }
        return;
      }

      if (message.method === 'turn/started') {
        const turn = params.turn as Record<string, unknown> | undefined;
        currentTurnId = String(turn?.id || currentTurnId);
        return;
      }

      if (message.method === 'item/agentMessage/delta') {
        const itemId = String(params.itemId || '');
        const delta = typeof params.delta === 'string' ? params.delta : '';
        yield* appendText(itemId, 'text', delta);
        return;
      }

      if (message.method === 'item/reasoning/textDelta' || message.method === 'item/reasoning/summaryTextDelta') {
        const itemId = String(params.itemId || '');
        const delta = typeof params.delta === 'string' ? params.delta : '';
        yield* appendText(itemId, 'thinking', delta);
        return;
      }

      if (message.method === 'item/commandExecution/outputDelta' || message.method === 'item/fileChange/outputDelta') {
        const itemId = String(params.itemId || '');
        const delta = typeof params.delta === 'string' ? params.delta : '';
        yield* emitToolOutputDelta(itemId, delta);
        return;
      }

      if (message.method === 'item/fileChange/patchUpdated') {
        const itemId = String(params.itemId || '');
        const changes = Array.isArray(params.changes) ? params.changes : [];
        yield* emitFileChangeToolUse(itemId, changes);
        yield* emitToolOutputDelta(itemId, `${describeFileChanges(changes)}\n`);
        return;
      }

      if (message.method === 'item/mcpToolCall/progress') {
        const itemId = String(params.itemId || '');
        const progress = typeof params.message === 'string' ? params.message : '';
        yield* emitToolOutputDelta(itemId, progress ? `${progress}\n` : '');
        return;
      }

      if (message.method === 'item/started' || message.method === 'item/completed') {
        const item = params.item as Record<string, any> | undefined;
        if (!item) return;

        if (item.type === 'commandExecution') {
          yield* emitToolUse(item.id, 'Bash', { command: item.command, cwd: item.cwd });
          if (message.method === 'item/completed') {
            yield* emitToolResult(item.id, item.aggregatedOutput || '(no output)', item.status === 'failed' || item.status === 'declined');
          }
          return;
        }

        if (item.type === 'mcpToolCall') {
          yield* emitToolUse(item.id, item.tool || 'unknown', item.arguments || {});
          if (message.method === 'item/completed') {
            const text = item.error?.message || textFromUnknownContent(item.result?.content) || textFromUnknownContent(item.result?.structuredContent) || '(no result)';
            yield* emitToolResult(item.id, text, item.status === 'failed');
          }
          return;
        }

        if (item.type === 'webSearch') {
          yield* emitToolUse(item.id, 'WebSearch', { query: item.query, action: item.action });
          if (message.method === 'item/completed') {
            yield* emitToolResult(item.id, `Searched: ${item.query || ''}`);
          }
          return;
        }

        if (item.type === 'fileChange') {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          yield* emitFileChangeToolUse(item.id, changes);
          if (message.method === 'item/completed') {
            const desc = describeFileChanges(changes);
            yield* emitToolResult(item.id, desc, item.status === 'failed' || item.status === 'declined');
          }
          return;
        }

        if (item.type === 'dynamicToolCall') {
          yield* emitToolUse(item.id, item.tool || 'dynamicTool', item.arguments || {});
          if (message.method === 'item/completed') {
            const text = textFromUnknownContent(item.contentItems) || item.error?.message || item.status || '(no result)';
            yield* emitToolResult(item.id, text, item.status === 'failed');
          }
          return;
        }

        if (item.type === 'imageView') {
          yield* emitToolUse(item.id, 'imageView', { path: item.path });
          if (message.method === 'item/completed') yield* emitToolResult(item.id, String(item.path || ''));
          return;
        }

        if (item.type === 'imageGeneration') {
          yield* emitToolUse(item.id, 'imageGeneration', { status: item.status, prompt: item.revisedPrompt });
          if (message.method === 'item/completed') yield* emitToolResult(item.id, item.savedPath || item.result || item.status || '');
          return;
        }

        if (item.type === 'contextCompaction') {
          if (message.method === 'item/started') yield { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } } as ProviderMessage;
          if (message.method === 'item/completed') yield { type: 'stream_event', event: { type: 'content_block_stop' } } as ProviderMessage;
          return;
        }

        if (item.type === 'agentMessage' && message.method === 'item/completed') {
          const text = String(item.text || '');
          const prev = itemTexts.get(item.id) || '';
          const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
          if (delta) yield* appendText(item.id, 'text', delta);
          yield* stopBlock(item.id);
          lastAgentMessage = text || lastAgentMessage;
          result = lastAgentMessage || result;
          if (text) yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } } as ProviderMessage;
          return;
        }

        if (item.type === 'reasoning' && message.method === 'item/completed') {
          const text = [...(item.summary || []), ...(item.content || [])].join('\n');
          const prev = itemTexts.get(item.id) || '';
          const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
          if (delta) yield* appendText(item.id, 'thinking', delta);
          yield* stopBlock(item.id);
          if (text) yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }] } } as ProviderMessage;
          return;
        }
      }

      if (message.method === 'thread/tokenUsage/updated') {
        const tokenUsage = params.tokenUsage as Record<string, any> | undefined;
        const last = tokenUsage?.last || tokenUsage?.total;
        if (last) {
          usage.inputTokens = Number(last.input_tokens || last.inputTokens || last.input || usage.inputTokens || 0);
          usage.outputTokens = Number(last.output_tokens || last.outputTokens || last.output || usage.outputTokens || 0);
        }
        return;
      }

      if (message.method === 'turn/completed') {
        const turn = params.turn as Record<string, any> | undefined;
        if (turn?.status === 'failed') {
          const errMsg = turn.error?.message || 'Turn failed';
          result = lastAgentMessage || `Codex error: ${errMsg}`;
          yield { type: 'result', subtype: 'error_max_turns', result, session_id: sessionId } as ProviderMessage;
        } else {
          result = lastAgentMessage || result;
          yield {
            type: 'result',
            result,
            session_id: sessionId,
            usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
            total_cost_usd: 0,
          } as ProviderMessage;
        }
        turnDone = true;
        return;
      }

      if (message.method === 'error') {
        const error = params.error as Record<string, unknown> | undefined;
        const errMsg = String(error?.message || params.message || 'Codex app-server error');
        result = lastAgentMessage || `Codex error: ${errMsg}`;
        yield { type: 'result', subtype: 'error_max_turns', result, session_id: sessionId } as ProviderMessage;
        turnDone = true;
      }
    };

    try {
      client = await CodexAppServerClient.start({
        env: appEnv,
        requestHandler: (message) => handleCodexServerRequest(message, opts),
      });
      const structuredInputItems = await resolveCodexStructuredInputItems(client, opts.prompt, opts.cwd, opts.inputItems);
      const { input, cleanup } = await prepareCodexInput(opts.prompt, opts.images, structuredInputItems);
      pendingInputCleanups.add(cleanup);

      const threadResult = opts.resumeId
        ? await client.request('thread/resume', { threadId: opts.resumeId, ...threadParams, excludeTurns: true })
        : await client.request('thread/start', threadParams);
      const thread = (threadResult as Record<string, any>).thread;
      sessionId = String(thread?.id || sessionId || `codex-${Date.now()}`);
      if (!emittedInit) {
        emittedInit = true;
        yield { type: 'system', subtype: 'init', session_id: sessionId, model } as ProviderMessage;
      }

      const turnResult = await client.request('turn/start', {
        threadId: sessionId,
        input,
        cwd: opts.cwd,
        approvalPolicy: (codexConfig?.approvalPolicy as any) || 'never',
        sandboxPolicy,
        model,
        ...(serviceTier ? { serviceTier } : {}),
        ...(modelReasoningEffort ? { effort: modelReasoningEffort } : {}),
        ...(reasoningSummary ? { summary: reasoningSummary } : {}),
        ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
      }) as Record<string, any>;
      cleanup();
      pendingInputCleanups.delete(cleanup);
      currentTurnId = String(turnResult.turn?.id || currentTurnId);

      opts.onRunReady?.({
        get active() { return active; },
        inject(text: string, images?: ProviderRunOptions['images'], inputItems?: ProviderInputItem[]): boolean {
          if (!active || !client || !currentTurnId) return false;
          resolveCodexStructuredInputItems(client, text, opts.cwd, inputItems)
            .then(items => prepareCodexInput(text, images, items))
            .then(({ input: steerInput, cleanup: steerCleanup }) => {
              pendingInputCleanups.add(steerCleanup);
              return client!.request('turn/steer', {
                threadId: sessionId,
                expectedTurnId: currentTurnId,
                input: steerInput,
              }).finally(() => {
                steerCleanup();
                pendingInputCleanups.delete(steerCleanup);
              });
            })
            .catch(err => console.error('[codex] failed to steer turn:', err));
          return true;
        },
        close() {
          active = false;
          abort.abort();
        },
        async interrupt() {
          if (client && currentTurnId) {
            await client.request('turn/interrupt', { threadId: sessionId, turnId: currentTurnId }).catch(() => {});
          }
          abort.abort();
        },
        async mcpServerStatus() {
          if (!client) return [];
          const response = await client.request('mcpServerStatus/list', { limit: 100, detail: 'full' }) as { data?: unknown[] };
          return response.data || [];
        },
      });

      console.log(`[codex] ${opts.resumeId ? 'resumed' : 'started'} app-server thread: model=${model} effort=${modelReasoningEffort || 'default'} threadId=${sessionId}`);
      for await (const notification of client.events()) {
        if (abort.signal.aborted || !active) break;
        for (const providerMessage of handleNotification(notification)) {
          yield providerMessage;
        }
        if (turnDone) break;
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
    } finally {
      active = false;
      this.activeAbort = null;
      for (const cleanup of pendingInputCleanups) {
        try { cleanup(); } catch { /* ignore */ }
      }
      client?.close();
    }

    return {
      result,
      sessionId,
      usage,
    };
  }

  invalidateAuthCache(): void {
    invalidateCodexAuthCache();
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
    closeCodexAppServerRpcClient();
  }
}
