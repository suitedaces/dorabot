import { spawn, execFile } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

// codex exec --json event types (from codex-rs/exec/src/exec_events.rs)
// Top-level: thread.started, turn.started, turn.completed, turn.failed, error
// Items: item.started, item.updated, item.completed
//   item_type: assistant_message, reasoning, command_execution, file_change, todo_list, error
type ExecEvent = {
  type: string;
  [key: string]: unknown;
};

function codexBinary(): string {
  return process.env.CODEX_BINARY || 'codex';
}

function codexHome(): string {
  // Use the standard codex home (respects CODEX_HOME env if set, otherwise ~/.codex)
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function codexEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.CODEX_HOME = codexHome();
  if (extra) Object.assign(env, extra);
  return env;
}

function ensureCodexHome(): void {
  const home = codexHome();
  mkdirSync(home, { recursive: true });
}

/** Run a codex CLI command and return stdout */
function runCodexCmd(args: string[], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = execFile(codexBinary(), args, {
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

export class CodexProvider implements Provider {
  readonly name = 'codex';
  private activeProcess: ReturnType<typeof spawn> | null = null;
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
    // v0.77+ uses --with-api-key and reads from stdin
    const { stdout, stderr, code } = await runCodexCmd(['login', '--with-api-key'], apiKey + '\n');
    if (code !== 0) {
      // Fallback: try legacy --api-key flag
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
      const proc = spawn(codexBinary(), ['login'], {
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
    ensureCodexHome();

    const codexConfig = opts.config.provider?.codex;
    const model = codexConfig?.model || undefined; // let codex use its default if not set

    // Build the full prompt with system instructions
    const systemInstruction = opts.systemPrompt
      ? `<system_instructions>\n${opts.systemPrompt}\n</system_instructions>\n\n`
      : '';
    const fullPrompt = `${systemInstruction}${opts.prompt}`;

    // Build CLI args for exec --json
    const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'];
    if (model) {
      args.push('-m', model);
    }
    if (opts.cwd) {
      args.push('-C', opts.cwd);
    }
    args.push(fullPrompt);

    console.log(`[codex] spawning: ${codexBinary()} exec --json ${model ? `-m ${model}` : ''}`);
    const proc = spawn(codexBinary(), args, {
      env: codexEnv({ ...opts.env }),
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.activeProcess = proc;

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trimEnd();
      if (msg) console.error(`[codex:stderr] ${msg}`);
    });

    // JSON-Lines reader on stdout
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    const eventQueue: (ExecEvent | null | Error)[] = [];
    let eventResolve: (() => void) | null = null;

    const pushEvent = (ev: ExecEvent | null | Error) => {
      eventQueue.push(ev);
      if (eventResolve) {
        eventResolve();
        eventResolve = null;
      }
    };

    const nextEvent = (): Promise<ExecEvent | null | Error> => {
      if (eventQueue.length > 0) return Promise.resolve(eventQueue.shift()!);
      return new Promise<ExecEvent | null | Error>((resolve) => {
        eventResolve = () => resolve(eventQueue.shift()!);
      });
    };

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        pushEvent(JSON.parse(trimmed) as ExecEvent);
      } catch {
        console.error(`[codex] failed to parse: ${trimmed.slice(0, 200)}`);
      }
    });

    rl.on('close', () => pushEvent(null));
    proc.on('error', (err) => pushEvent(err));
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[codex] process exited with code ${code}`);
      }
      pushEvent(null);
    });

    // Track state
    let sessionId = '';
    let result = '';
    let lastAgentMessage = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    // Event loop
    while (true) {
      const event = await nextEvent();

      if (event === null) break;

      if (event instanceof Error) {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          result: `Codex error: ${event.message}`,
          session_id: sessionId,
        } as ProviderMessage;
        break;
      }

      switch (event.type) {
        case 'thread.started': {
          sessionId = (event.thread_id as string) || `codex-${Date.now()}`;
          yield {
            type: 'system',
            subtype: 'init',
            session_id: sessionId,
            model: model || 'codex-default',
          } as ProviderMessage;
          break;
        }

        case 'turn.started': {
          // Nothing to emit
          break;
        }

        case 'turn.completed': {
          // Extract usage from turn completion
          const turnUsage = event.usage as Record<string, number> | undefined;
          if (turnUsage) {
            usage.inputTokens = turnUsage.input_tokens || 0;
            usage.outputTokens = turnUsage.output_tokens || 0;
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
          const err = event.error as Record<string, string> | undefined;
          const errMsg = err?.message || 'Turn failed';
          console.error(`[codex] turn failed: ${errMsg}`);

          // If we have a partial result, return it; otherwise return the error
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
          const errMsg = (event.message as string) || 'Unknown Codex error';
          // Don't break on "Reconnecting" errors - those are retries
          if (errMsg.includes('Reconnecting')) {
            console.log(`[codex] ${errMsg}`);
            break;
          }
          console.error(`[codex] error: ${errMsg}`);
          break;
        }

        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
          const item = event.item as Record<string, unknown> | undefined;
          if (!item) break;

          const itemType = (item.item_type as string) || (item.type as string);
          const itemId = (item.id as string) || `item-${Date.now()}`;

          switch (itemType) {
            case 'assistant_message':
            case 'agent_message': {
              const text = (item.text as string) || '';
              if (text) {
                lastAgentMessage = text;
                result = text;
                yield {
                  type: 'assistant',
                  message: {
                    role: 'assistant',
                    content: [{ type: 'text', text }],
                  },
                } as ProviderMessage;
              }
              break;
            }

            case 'reasoning': {
              const text = (item.text as string) || '';
              if (text) {
                yield {
                  type: 'assistant',
                  message: {
                    role: 'assistant',
                    content: [{ type: 'thinking', thinking: text }],
                  },
                } as ProviderMessage;
              }
              break;
            }

            case 'command_execution': {
              const command = (item.command as string) || '';
              const status = item.status as string;
              const output = (item.aggregated_output as string) || '';

              if (event.type === 'item.started') {
                yield {
                  type: 'assistant',
                  message: {
                    role: 'assistant',
                    content: [{
                      type: 'tool_use',
                      id: `codex-${itemId}`,
                      name: 'Bash',
                      input: { command, description: 'Codex shell command' },
                    }],
                  },
                } as ProviderMessage;
              }

              if (event.type === 'item.completed') {
                yield {
                  type: 'result',
                  subtype: 'tool_result',
                  tool_use_id: `codex-${itemId}`,
                  content: [{ type: 'text', text: output || '(no output)' }],
                  is_error: status === 'failed',
                } as ProviderMessage;
              }
              break;
            }

            case 'file_change': {
              if (event.type !== 'item.completed') break;
              const changes = (item.changes as Array<Record<string, string>>) || [];
              const desc = changes
                .map(c => `${c.kind}: ${c.path}`)
                .join('\n') || 'Files modified';

              yield {
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: [{
                    type: 'tool_use',
                    id: `codex-${itemId}`,
                    name: 'Edit',
                    input: { description: desc },
                  }],
                },
              } as ProviderMessage;

              yield {
                type: 'result',
                subtype: 'tool_result',
                tool_use_id: `codex-${itemId}`,
                content: [{ type: 'text', text: desc }],
              } as ProviderMessage;
              break;
            }

            case 'todo_list': {
              // Ignore plan/todo events for now
              break;
            }

            case 'error': {
              const errMsg = (item.message as string) || 'Item error';
              console.error(`[codex] item error: ${errMsg}`);
              break;
            }

            default: {
              console.log(`[codex] unhandled item type: ${itemType}`);
              break;
            }
          }
          break;
        }

        default: {
          console.log(`[codex] unhandled event: ${event.type}`);
          break;
        }
      }

      // Break on terminal events
      if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        break;
      }
    }

    this.cleanup();

    return {
      result,
      sessionId,
      usage,
    };
  }

  private cleanup(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch { /* ignore */ }
      this.activeProcess = null;
    }
  }

  async dispose(): Promise<void> {
    this.cleanup();
    if (this.loginProcess) {
      try {
        this.loginProcess.kill();
      } catch { /* ignore */ }
      this.loginProcess = null;
    }
  }
}
