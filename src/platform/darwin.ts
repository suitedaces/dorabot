import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserInstallation, CaptureScreenOptions, PlatformAdapter } from './types.js';

const execFileAsync = promisify(execFile);

const CHROMIUM_INSTALLATIONS: BrowserInstallation[] = [
  {
    exec: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    appName: 'Google Chrome',
  },
  {
    exec: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    dataDir: join(homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
    appName: 'Brave Browser',
  },
  {
    exec: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
    appName: 'Microsoft Edge',
  },
  {
    exec: '/Applications/Chromium.app/Contents/MacOS/Chromium',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Chromium'),
    appName: 'Chromium',
  },
  {
    exec: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    appName: 'Google Chrome Canary',
  },
];

async function isProcessRunning(pattern: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export class DarwinPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'darwin' as const;
  public readonly isMac = true;

  public hasCommand(command: string): boolean {
    try {
      execFileSync('which', [command], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public async notify(title: string, body: string): Promise<void> {
    try {
      const t = title.replace(/"/g, '\\"');
      const b = body.replace(/"/g, '\\"');
      await execFileAsync('osascript', ['-e', `display notification "${b}" with title "${t}"`]);
    } catch {
      // best effort only
    }
  }

  public async captureScreen(options: CaptureScreenOptions): Promise<void> {
    const cmd = ['-x']; // silent screenshot (no sound)
    if (options.display) {
      cmd.push('-D', String(options.display));
    }
    cmd.push(options.outputPath);
    await execFileAsync('screencapture', cmd, { timeout: options.timeoutMs ?? 10_000 });
  }

  public getChromiumInstallations(): BrowserInstallation[] {
    return CHROMIUM_INSTALLATIONS;
  }

  public async quitApplication(appName: string, timeoutMs = 5000): Promise<void> {
    try {
      await execFileAsync('osascript', ['-e', `tell application "${appName}" to quit`]);
    } catch {
      // app might not be running or not scriptable
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!(await isProcessRunning(appName))) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      await execFileAsync('pkill', ['-f', appName]);
    } catch {
      // ignore if no process left
    }
  }
}
