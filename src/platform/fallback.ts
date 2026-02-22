import type { BrowserInstallation, CaptureScreenOptions, PlatformAdapter } from './types.js';

function noop(): void {}

export class FallbackPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'unknown' as const;
  public readonly isMac = false;

  public hasCommand(_command: string): boolean {
    return false;
  }

  public async notify(_title: string, _body: string): Promise<void> {
    noop();
  }

  public async captureScreen(_options: CaptureScreenOptions): Promise<void> {
    throw new Error('Screenshot capture is not supported on this platform.');
  }

  public getChromiumInstallations(): BrowserInstallation[] {
    return [];
  }

  public async quitApplication(_appName: string, _timeoutMs = 5000): Promise<void> {
    noop();
  }
}
