import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { DORABOT_DIR, SKILL_ENV_PATH } from '../workspace.js';
import { getSecretStorageBackend, keychainLoad, keychainStore } from '../auth/keychain.js';

const KEYCHAIN_ACCOUNT = 'skill-env';

type SkillEnvMap = Record<string, string>;

function readSkillEnvFile(): SkillEnvMap {
  try {
    if (!existsSync(SKILL_ENV_PATH)) return {};
    const parsed = JSON.parse(readFileSync(SKILL_ENV_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, String(value).trim()] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function loadSkillEnvMap(): SkillEnvMap {
  const raw = keychainLoad(KEYCHAIN_ACCOUNT);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const entries = Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'string' && value.trim())
          .map(([key, value]) => [key, String(value).trim()] as const);
        return Object.fromEntries(entries);
      }
    } catch {
      // fall through
    }
  }

  return readSkillEnvFile();
}

function persistSkillEnvMap(values: SkillEnvMap): 'keychain' | 'file' {
  const serialized = JSON.stringify(values);
  if (keychainStore(KEYCHAIN_ACCOUNT, serialized)) {
    try {
      if (existsSync(SKILL_ENV_PATH)) rmSync(SKILL_ENV_PATH, { force: true });
    } catch {
      // ignore cleanup failure
    }
    return 'keychain';
  }

  mkdirSync(DORABOT_DIR, { recursive: true });
  writeFileSync(SKILL_ENV_PATH, serialized, { mode: 0o600 });
  chmodSync(SKILL_ENV_PATH, 0o600);
  return 'file';
}

export function getPersistedSkillEnv(name: string): string | undefined {
  const value = loadSkillEnvMap()[name];
  return value?.trim() || undefined;
}

export function getSkillEnvStatus(names: string[]): {
  storageBackend: 'keychain' | 'file';
  values: Record<string, boolean>;
} {
  const env = loadSkillEnvMap();
  const values = Object.fromEntries(names.map(name => [name, Boolean(env[name])]));
  return {
    storageBackend: getSecretStorageBackend(),
    values,
  };
}

export function applyPersistedSkillEnv(): Record<string, string> {
  const env = loadSkillEnvMap();
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  return env;
}

export function mergeSkillEnv(env: Record<string, string>): Record<string, string> {
  const merged = { ...env };
  for (const [key, value] of Object.entries(loadSkillEnvMap())) {
    merged[key] = value;
  }
  return merged;
}

export function saveSkillEnv(values: Record<string, string>): {
  storageBackend: 'keychain' | 'file';
  configured: string[];
} {
  const current = loadSkillEnvMap();
  const next = { ...current };
  const configured: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    next[key] = trimmed;
    process.env[key] = trimmed;
    configured.push(key);
  }

  const storageBackend = persistSkillEnvMap(next);
  return { storageBackend, configured };
}
