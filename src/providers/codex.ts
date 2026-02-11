import { Codex } from '@openai/codex-sdk';
import type { ThreadEvent, ModelReasoningEffort } from '@openai/codex-sdk';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';
import type { ReasoningEffort } from '../config.js';

// ── Codex home / binary helpers ─────────────────────────────────────

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function ensureCodexHome(): void {
  mkdirSync(codexHome(), { recursive: true });
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

// ── Auth helpers ────────────────────────────────────────────────────

function getCodexApiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const authFile = join(codexHome(), 'auth.json');
  if (existsSync(authFile)) {
    try {
      const data = JSON.parse(readFileSync(authFile, 'utf-8'));
      return data.api_key || data.token || data.access_token || undefined;
    } catch { /* ignore */ }
  }
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
  return !!getCodexApiKey();
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
  private loginProcess: ReturnType<typeof spawn> | null = null;

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
      const { stdout, stderr } = await runCodexCmd(['login', 'status']);
      const output = stdout + stderr;

      if (output.includes('Logged in') || output.includes('authenticated') || output.includes('API key') || output.includes('ChatGPT')) {
        const method = output.includes('ChatGPT') ? 'oauth' : 'api_key';
        return { authenticated: true, method };
      }

      // Check auth.json directly
      const authFile = join(codexHome(), 'auth.json');
      if (existsSync(authFile)) {
        try {
          const authData = JSON.parse(readFileSync(authFile, 'utf-8'));
          if (authData.api_key || authData.token || authData.access_token) {
            return { authenticated: true, method: authData.api_key ? 'api_key' : 'oauth' };
          }
        } catch { /* ignore */ }
      }

      // OPENAI_API_KEY env fallback
      if (process.env.OPENAI_API_KEY) {
        return { authenticated: true, method: 'api_key', identity: 'env:OPENAI_API_KEY' };
      }

      return { authenticated: false, error: 'Not authenticated with Codex' };
    } catch (e) {
      return { authenticated: false, error: `Auth check failed: ${e}` };
    }
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    ensureCodexHome();
    const { stdout, stderr, code } = await runCodexCmd(['login', '--with-api-key'], apiKey + '\n');
    if (code !== 0) {
      const legacy = await runCodexCmd(['login', '--api-key', apiKey]);
      if (legacy.code !== 0) {
        return { authenticated: false, error: `Login failed: ${stderr || stdout || legacy.stderr || legacy.stdout}` };
      }
    }
    return this.getAuthStatus();
  }

  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    ensureCodexHome();

    return new Promise((resolve, reject) => {
      const loginId = `login-${Date.now()}`;
      const proc = spawn(codexBinary, ['login'], {
        env: codexEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.loginProcess = proc;

      let output = '';
      const collectOutput = (data: Buffer) => {
        output += data.toString();
        const urlMatch = output.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          resolve({ authUrl: urlMatch[1], loginId });
        }
      };

      proc.stdout?.on('data', collectOutput);
      proc.stderr?.on('data', collectOutput);

      proc.on('error', (err) => {
        this.loginProcess = null;
        reject(new Error(`OAuth login failed: ${err.message}`));
      });

      proc.on('exit', () => {
        this.loginProcess = null;
      });

      setTimeout(() => {
        if (this.loginProcess === proc) {
          proc.kill();
          this.loginProcess = null;
          reject(new Error(`OAuth login timed out. Output: ${output}`));
        }
      }, 15_000);
    });
  }

  async completeOAuthLogin(_loginId: string): Promise<ProviderAuthStatus> {
    if (this.loginProcess) {
      await new Promise<void>((resolve) => {
        const proc = this.loginProcess!;
        const timer = setTimeout(() => {
          proc.kill();
          resolve();
        }, 60_000);
        proc.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.loginProcess = null;
    }
    return this.getAuthStatus();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const codexConfig = opts.config.provider?.codex;
    const model = codexConfig?.model || undefined;
    const reasoningEffort = opts.config.reasoningEffort;

    // Resolve API key (env > auth.json)
    const apiKey = getCodexApiKey();

    // Create SDK instance
    const codex = new Codex({
      apiKey,
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

    console.log(`[codex] ${opts.resumeId ? 'resuming' : 'starting'} thread: model=${model || 'default'} effort=${modelReasoningEffort || 'default'}${opts.resumeId ? ` threadId=${opts.resumeId}` : ''}`);

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
                if (item.text) {
                  lastAgentMessage = item.text;
                  result = item.text;
                  yield {
                    type: 'assistant',
                    message: {
                      role: 'assistant',
                      content: [{ type: 'text', text: item.text }],
                    },
                  } as ProviderMessage;
                }
                break;
              }

              case 'reasoning': {
                if (item.text) {
                  yield {
                    type: 'assistant',
                    message: {
                      role: 'assistant',
                      content: [{ type: 'thinking', thinking: item.text }],
                    },
                  } as ProviderMessage;
                }
                break;
              }

              case 'command_execution': {
                if (event.type === 'item.started') {
                  yield {
                    type: 'assistant',
                    message: {
                      role: 'assistant',
                      content: [{
                        type: 'tool_use',
                        id: `codex-${item.id}`,
                        name: 'Bash',
                        input: { command: item.command, description: 'Codex shell command' },
                      }],
                    },
                  } as ProviderMessage;
                }

                if (event.type === 'item.completed') {
                  yield {
                    type: 'result',
                    subtype: 'tool_result',
                    tool_use_id: `codex-${item.id}`,
                    content: [{ type: 'text', text: item.aggregated_output || '(no output)' }],
                    is_error: item.status === 'failed',
                  } as ProviderMessage;
                }
                break;
              }

              case 'file_change': {
                if (event.type !== 'item.completed') break;
                const desc = item.changes
                  .map(c => `${c.kind}: ${c.path}`)
                  .join('\n') || 'Files modified';

                yield {
                  type: 'assistant',
                  message: {
                    role: 'assistant',
                    content: [{
                      type: 'tool_use',
                      id: `codex-${item.id}`,
                      name: 'Edit',
                      input: { description: desc },
                    }],
                  },
                } as ProviderMessage;

                yield {
                  type: 'result',
                  subtype: 'tool_result',
                  tool_use_id: `codex-${item.id}`,
                  content: [{ type: 'text', text: desc }],
                } as ProviderMessage;
                break;
              }

              case 'mcp_tool_call': {
                if (event.type === 'item.started') {
                  yield {
                    type: 'assistant',
                    message: {
                      role: 'assistant',
                      content: [{
                        type: 'tool_use',
                        id: `codex-${item.id}`,
                        name: `mcp:${item.server}/${item.tool}`,
                        input: item.arguments,
                      }],
                    },
                  } as ProviderMessage;
                }
                if (event.type === 'item.completed') {
                  const text = item.error?.message
                    || (item.result?.content?.map((b: any) => b.text || '').join('\n'))
                    || '(no result)';
                  yield {
                    type: 'result',
                    subtype: 'tool_result',
                    tool_use_id: `codex-${item.id}`,
                    content: [{ type: 'text', text }],
                    is_error: item.status === 'failed',
                  } as ProviderMessage;
                }
                break;
              }

              case 'web_search': {
                if (event.type === 'item.started') {
                  yield {
                    type: 'assistant',
                    message: {
                      role: 'assistant',
                      content: [{
                        type: 'tool_use',
                        id: `codex-${item.id}`,
                        name: 'WebSearch',
                        input: { query: item.query },
                      }],
                    },
                  } as ProviderMessage;
                }
                break;
              }

              case 'todo_list':
                break;

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
    if (this.loginProcess) {
      try {
        this.loginProcess.kill();
      } catch { /* ignore */ }
      this.loginProcess = null;
    }
  }
}
