import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mergeSkillEnv } from './skills/env.js';
import { TMP_DIR } from './workspace.js';


// Resolve shell PATH once at startup (Electron apps get minimal /usr/bin:/bin:/usr/sbin:/sbin)
let _resolvedShellPath: string | null = null;
export function getShellPath(): string {
  if (_resolvedShellPath !== null) return _resolvedShellPath;
  const currentPath = process.env.PATH || '';

  // If PATH already has common node locations, skip shell resolution
  if (currentPath.includes('nvm') || currentPath.includes('homebrew') || currentPath.includes('fnm') || currentPath.includes('/usr/local/bin')) {
    _resolvedShellPath = currentPath;
    return _resolvedShellPath;
  }

  // Resolve from login shell
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    _resolvedShellPath = execSync(`${shell} -lc 'echo -n $PATH'`, {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
  } catch {
    _resolvedShellPath = currentPath;
  }

  // Append common node binary locations as fallback
  const fallbackPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.nvm/current/bin`,
    `${process.env.HOME}/.fnm/current/bin`,
    `${process.env.HOME}/.volta/bin`,
    `${process.env.HOME}/.local/bin`,
  ];
  for (const p of fallbackPaths) {
    if (!_resolvedShellPath.includes(p)) {
      _resolvedShellPath += `:${p}`;
    }
  }

  return _resolvedShellPath;
}

// Resolve full environment from user's login shell once at startup.
// macOS GUI apps (Electron) inherit a minimal launchd env that's missing
// everything the user sets in .zshrc / .bash_profile (NVM, GOPATH, etc.).
let _resolvedShellEnv: Record<string, string> | null = null;
export function getShellEnv(): Record<string, string> {
  if (_resolvedShellEnv) return { ..._resolvedShellEnv };
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // Use a unique marker so we ignore any stdout noise from .zshrc/.bashrc
    // (welcome messages, neofetch, fortune, etc.)
    const marker = '__DORABOT_ENV_START_8f3a__';
    const raw = execSync(
      `${shell} -lc 'echo ${marker} && env'`,
      { timeout: 5000, encoding: 'utf-8' },
    );
    // Only parse lines after the marker
    const markerIdx = raw.indexOf(marker);
    const envSection = markerIdx >= 0 ? raw.slice(markerIdx + marker.length + 1) : raw;
    const env: Record<string, string> = {};
    // Parse KEY=VALUE lines. Env var names match [A-Za-z_][A-Za-z_0-9]*.
    // Multiline values are rare; accumulate into the last key when a line
    // doesn't look like a new variable assignment.
    let lastKey = '';
    for (const line of envSection.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)/);
      if (m) {
        lastKey = m[1];
        env[lastKey] = m[2];
      } else if (lastKey && line) {
        env[lastKey] += '\n' + line;
      }
    }
    _resolvedShellEnv = env;
  } catch {
    // Fallback: use process.env as-is
    _resolvedShellEnv = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined) _resolvedShellEnv[key] = val;
    }
  }
  return { ..._resolvedShellEnv };
}

// clean env for SDK subprocess - strip vscode vars that cause file watcher crashes
export function cleanEnvForSdk(): Record<string, string> {
  const env = mergeSkillEnv(getShellEnv());
  // Strip vars that cause issues in the SDK subprocess
  for (const key of Object.keys(env)) {
    if (key.startsWith('VSCODE_')) delete env[key];
  }
  delete env.GIT_ASKPASS;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  // Ensure PATH includes node binary locations (critical for Electron)
  env.PATH = getShellPath();
  // use a clean tmpdir so SDK file watcher doesn't hit socket files
  const sdkTmp = TMP_DIR;
  mkdirSync(sdkTmp, { recursive: true });
  env.TMPDIR = sdkTmp;
  return env;
}
