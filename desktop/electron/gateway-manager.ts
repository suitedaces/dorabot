import { utilityProcess, UtilityProcess, app } from 'electron';
import { existsSync, readFileSync, mkdirSync, writeFileSync, openSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { is } from '@electron-toolkit/utils';

// macOS Electron apps launched from Finder/Dock get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
// which doesn't include node, homebrew, nvm, etc. Resolve the real PATH from the user's shell.
let resolvedPath: string | null = null;
function getShellPath(): string {
  if (resolvedPath !== null) return resolvedPath;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    resolvedPath = execSync(`${shell} -ilc 'echo -n $PATH'`, {
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
  private process: UtilityProcess | null = null;
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
      return join(__dirname, '../../dist/index.js');
    }
    // Production: bundled in app resources
    return join(process.resourcesPath, 'gateway', 'dist', 'index.js');
  }

  /** Ensure ~/.dorabot directory structure exists */
  private ensureDataDir(): void {
    const dorabotDir = join(homedir(), '.dorabot');
    const logsDir = join(dorabotDir, 'logs');
    if (!existsSync(dorabotDir)) mkdirSync(dorabotDir, { recursive: true });
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  }

  /** Wait for the gateway token file to appear (signals readiness) */
  private waitForReady(timeoutMs = 20000): Promise<void> {
    const tokenPath = join(homedir(), '.dorabot', 'gateway-token');

    return new Promise((resolve, reject) => {
      // If token already exists from a previous run, we're good
      if (existsSync(tokenPath)) {
        resolve();
        return;
      }

      const startTime = Date.now();
      const interval = setInterval(() => {
        if (existsSync(tokenPath)) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Gateway failed to start within timeout'));
        }
      }, 200);
    });
  }

  async start(): Promise<void> {
    if (this.process) return;
    this.stopping = false;

    this.ensureDataDir();

    const entryPath = this.getGatewayEntryPath();
    if (!existsSync(entryPath)) {
      const msg = `Gateway entry not found: ${entryPath}`;
      console.error(msg);
      this.opts.onError?.(msg);
      return;
    }

    // Open log file for gateway stdout/stderr
    const logPath = join(homedir(), '.dorabot', 'logs', 'gateway.log');

    console.log(`[gateway-manager] Starting gateway from: ${entryPath}`);

    try {
      this.process = utilityProcess.fork(entryPath, ['-g'], {
        cwd: is.dev ? join(__dirname, '../..') : join(process.resourcesPath, 'gateway'),
        env: {
          ...process.env,
          PATH: getShellPath(),
          DORABOT_ELECTRON: '1',
          NO_COLOR: '1',
        },
        stdio: 'pipe',
      });

      // Log stdout/stderr to file
      const logFd = openSync(logPath, 'a');
      this.process.stdout?.on('data', (data: Buffer) => {
        const str = data.toString();
        writeFileSync(logFd, str);
      });
      this.process.stderr?.on('data', (data: Buffer) => {
        const str = data.toString();
        writeFileSync(logFd, str);
      });

      this.process.on('spawn', () => {
        console.log('[gateway-manager] Gateway process spawned');
      });

      this.process.on('exit', (code) => {
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
      await this.waitForReady();
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
