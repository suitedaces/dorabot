import { utilityProcess, UtilityProcess, app } from 'electron';
import { existsSync, mkdirSync, writeFileSync, openSync } from 'fs';
import { execSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { createConnection } from 'net';
import { is } from '@electron-toolkit/utils';
import { DORABOT_DIR, DORABOT_LOGS_DIR, GATEWAY_LOG_PATH, GATEWAY_TOKEN_PATH } from './dorabot-paths';

// macOS Electron apps launched from Finder/Dock get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
// which doesn't include node, homebrew, nvm, etc. Resolve the real PATH from a login shell.
let resolvedPath: string | null = null;
function getShellPath(): string {
  if (resolvedPath !== null) return resolvedPath;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // Avoid interactive shell startup because many configs assume TTY and can fail/hang.
    resolvedPath = execSync(`${shell} -lc 'echo -n $PATH'`, {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
  } catch {
    resolvedPath = process.env.PATH || '';
  }
  return resolvedPath;
}

export interface GatewayManagerOptions {
  onReady?: () => void;
  onError?: (error: string) => void;
  onExit?: (code: number) => void;
}

export class GatewayManager {
  private process: UtilityProcess | ChildProcess | null = null;
  private opts: GatewayManagerOptions;
  private retries = 0;
  private maxRetries = 3;
  private stopping = false;

  constructor(opts: GatewayManagerOptions = {}) {
    this.opts = opts;
  }

  /** Resolve the gateway entry script path */
  private getGatewayEntryPath(): string {
    if (is.dev) {
      // Dev mode: use the compiled dist in the workspace
      return join(__dirname, '../../../dist/index.js');
    }
    // Production: bundled in app resources
    return join(process.resourcesPath, 'gateway', 'dist', 'index.js');
  }

  private getNodePath(): string {
    const explicitNode = process.env.DORABOT_NODE_PATH;
    if (explicitNode && existsSync(explicitNode)) {
      return explicitNode;
    }

    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const nodePath = execSync(`${shell} -c 'command -v node'`, {
        timeout: 5000,
        encoding: 'utf-8',
      }).trim();
      return nodePath || 'node';
    } catch {
      return 'node';
    }
  }

  /** Ensure ~/.dorabot directory structure exists */
  private ensureDataDir(): void {
    if (!existsSync(DORABOT_DIR)) mkdirSync(DORABOT_DIR, { recursive: true });
    if (!existsSync(DORABOT_LOGS_DIR)) mkdirSync(DORABOT_LOGS_DIR, { recursive: true });
  }

  private isGatewayListening(host: string, port: number, timeoutMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(timeoutMs, () => finish(false));
    });
  }

  /** Wait for gateway token and gateway TCP listener to become available */
  private async waitForReady(proc: UtilityProcess | ChildProcess, timeoutMs = 20000): Promise<void> {
    const tokenPath = GATEWAY_TOKEN_PATH;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      // Process exited/replaced while waiting for readiness
      if (this.process !== proc) {
        throw new Error('Gateway process exited before becoming ready');
      }
      if (existsSync(tokenPath)) {
        const listening = await this.isGatewayListening('127.0.0.1', 18789)
          || await this.isGatewayListening('localhost', 18789);
        if (listening) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Gateway failed to start within timeout');
  }

  async start(): Promise<void> {
    if (this.process) return;
    this.stopping = false;

    this.ensureDataDir();

    const entryPath = this.getGatewayEntryPath();
    if (!existsSync(entryPath)) {
      const msg = `Gateway entry not found: ${entryPath}`;
      console.error(msg);
      if (!this.stopping && this.retries < this.maxRetries) {
        this.retries++;
        console.log(`[gateway-manager] Retrying gateway start (missing entry, attempt ${this.retries}/${this.maxRetries})`);
        this.opts.onError?.(`${msg} (retrying ${this.retries}/${this.maxRetries})`);
        setTimeout(() => this.start(), 1000);
      } else {
        this.opts.onError?.(msg);
      }
      return;
    }

    // Open log file for gateway stdout/stderr
    const logPath = GATEWAY_LOG_PATH;

    console.log(`[gateway-manager] Starting gateway from: ${entryPath}`);

    try {
      if (is.dev) {
        const nodePath = this.getNodePath();
        this.process = spawn(nodePath, [entryPath, '-g'], {
          cwd: join(__dirname, '../../..'),
          env: {
            ...process.env,
            PATH: getShellPath(),
            DORABOT_ELECTRON: '1',
            NO_COLOR: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        this.process = utilityProcess.fork(entryPath, ['-g'], {
          cwd: join(process.resourcesPath, 'gateway'),
          env: {
            ...process.env,
            PATH: getShellPath(),
            DORABOT_ELECTRON: '1',
            NO_COLOR: '1',
          },
          stdio: 'pipe',
        });
      }

      const proc = this.process as any;

      // Log stdout/stderr to file
      const logFd = openSync(logPath, 'a');
      proc.stdout?.on('data', (data: Buffer) => {
        const str = data.toString();
        writeFileSync(logFd, str);
      });
      proc.stderr?.on('data', (data: Buffer) => {
        const str = data.toString();
        writeFileSync(logFd, str);
      });

      proc.on('spawn', () => {
        console.log('[gateway-manager] Gateway process spawned');
      });

      proc.on('exit', (code: number | null) => {
        console.log(`[gateway-manager] Gateway exited with code ${code}`);
        this.process = null;

        if (!this.stopping && this.retries < this.maxRetries) {
          this.retries++;
          console.log(`[gateway-manager] Restarting gateway (attempt ${this.retries}/${this.maxRetries})`);
          setTimeout(() => this.start(), 1000);
        } else {
          this.opts.onExit?.(code ?? 1);
        }
      });

      // Wait for gateway to be ready
      await this.waitForReady(this.process);
      this.retries = 0; // Reset on successful start
      console.log('[gateway-manager] Gateway is ready');
      this.opts.onReady?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gateway-manager] Failed to start gateway: ${msg}`);
      if (!this.stopping && this.retries < this.maxRetries) {
        this.retries++;
        console.log(`[gateway-manager] Retrying gateway start (attempt ${this.retries}/${this.maxRetries})`);
        this.opts.onError?.(`${msg} (retrying ${this.retries}/${this.maxRetries})`);
        setTimeout(() => this.start(), 1000);
      } else {
        this.opts.onError?.(msg);
      }
    }
  }

  stop(): void {
    this.stopping = true;
    if (!this.process) return;

    console.log('[gateway-manager] Stopping gateway...');
    this.process.kill();

    // Force kill after 5 seconds if still alive
    const proc = this.process;
    setTimeout(() => {
      if (proc) {
        try {
          proc.kill();
        } catch {
          // Already dead
        }
      }
    }, 5000);

    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null;
  }
}
