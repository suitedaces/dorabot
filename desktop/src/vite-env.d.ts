/// <reference types="vite/client" />

import type { ElectronAPI } from '../electron/preload';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_GATEWAY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
