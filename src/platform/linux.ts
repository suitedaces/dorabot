import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserInstallation, CaptureScreenOptions, PlatformAdapter } from './types.js';

const execFileAsync = promisify(execFile);

const CHROMIUM_INSTALLATIONS: BrowserInstallation[] = [
  {
    exec: 'google-chrome-stable',
    dataDir: join(homedir(), '.config', 'google-chrome'),
    appName: 'google-chrome',
  },
  {
    exec: 'google-chrome',
    dataDir: join(homedir(), '.config', 'google-chrome'),
    appName: 'google-chrome',
  },
  {
    exec: 'chromium-browser',
    dataDir: join(homedir(), '.config', 'chromium'),
    appName: 'chromium',
  },
  {
    exec: 'chromium',
    dataDir: join(homedir(), '.config', 'chromium'),
    appName: 'chromium',
  },
  {
    exec: 'brave-browser',
    dataDir: join(homedir(), '.config', 'BraveSoftware', 'Brave-Browser'),
    appName: 'brave-browser',
  },
  {
    exec: 'microsoft-edge-stable',
    dataDir: join(homedir(), '.config', 'microsoft-edge'),
    appName: 'microsoft-edge',
  },
  {
    exec: 'microsoft-edge',
    dataDir: join(homedir(), '.config', 'microsoft-edge'),
    appName: 'microsoft-edge',
  },
];

type LinuxScreenshotCommand = {
  binary: string;
  args: (opts: CaptureScreenOptions) => string[];
};

const SCREENSHOT_COMMANDS: LinuxScreenshotCommand[] = [
  { binary: 'gnome-screenshot', args: (opts) => ['-f', opts.outputPath] },
  { binary: 'grim', args: (opts) => [opts.outputPath] },
  { binary: 'import', args: (opts) => ['-window', 'root', opts.outputPath] },
  { binary: 'maim', args: (opts) => [opts.outputPath] },
  { binary: 'scrot', args: (opts) => [opts.outputPath] },
];

async function isProcessRunning(pattern: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export class LinuxPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'linux' as const;
  public readonly isMac = false;

  public hasCommand(command: string): boolean {
    try {
      execFileSync('which', [command], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public async notify(title: string, body: string): Promise<void> {
    if (!this.hasCommand('notify-send')) return;
    try {
      await execFileAsync('notify-send', [title, body]);
    } catch {
      // notifications are optional
    }
  }

  public async captureScreen(options: CaptureScreenOptions): Promise<void> {
    const match = SCREENSHOT_COMMANDS.find((cmd) => this.hasCommand(cmd.binary));
    if (!match) {
      throw new Error(
        'No supported screenshot command found. Install one of: gnome-screenshot, grim, import, maim, scrot.'
      );
    }
    await execFileAsync(match.binary, match.args(options), { timeout: options.timeoutMs ?? 10_000 });
  }

  public getChromiumInstallations(): BrowserInstallation[] {
    return CHROMIUM_INSTALLATIONS;
  }

  public async quitApplication(appName: string, timeoutMs = 5000): Promise<void> {
    try {
      await execFileAsync('pkill', ['-f', appName]);
    } catch {
      // process may not be running
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!(await isProcessRunning(appName))) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
