import { DarwinPlatformAdapter } from './darwin.js';
import { LinuxPlatformAdapter } from './linux.js';
import { FallbackPlatformAdapter } from './fallback.js';
import type { PlatformAdapter } from './types.js';

function createPlatformAdapter(): PlatformAdapter {
  if (process.platform === 'darwin') return new DarwinPlatformAdapter();
  if (process.platform === 'linux') return new LinuxPlatformAdapter();
  return new FallbackPlatformAdapter();
}

export const platformAdapter: PlatformAdapter = createPlatformAdapter();

export type { BrowserInstallation, CaptureScreenOptions, PlatformAdapter } from './types.js';
