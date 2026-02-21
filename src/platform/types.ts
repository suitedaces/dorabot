export type BrowserInstallation = {
  exec: string;
  dataDir: string;
  appName: string;
};

export type CaptureScreenOptions = {
  outputPath: string;
  display?: number;
  timeoutMs?: number;
};

export interface PlatformAdapter {
  readonly platform: NodeJS.Platform | 'unknown';
  readonly isMac: boolean;
  notify(title: string, body: string): Promise<void>;
  captureScreen(options: CaptureScreenOptions): Promise<void>;
  getChromiumInstallations(): BrowserInstallation[];
  hasCommand(command: string): boolean;
  quitApplication(appName: string, timeoutMs?: number): Promise<void>;
}
