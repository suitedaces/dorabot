import { execFileSync } from 'node:child_process';

const SERVICE_NAME = 'dorabot';

export type SecretStorageBackend = 'keychain' | 'file';

function hasCommand(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function canUseNativeKeychain(): boolean {
  if (process.platform === 'darwin') return hasCommand('security');
  if (process.platform === 'linux') return hasCommand('secret-tool');
  return false;
}

export function getSecretStorageBackend(): SecretStorageBackend {
  return canUseNativeKeychain() ? 'keychain' : 'file';
}

export function keychainStore(account: string, secret: string): boolean {
  if (!canUseNativeKeychain()) return false;

  try {
    if (process.platform === 'darwin') {
      execFileSync('security', [
        'add-generic-password',
        '-a', account,
        '-s', SERVICE_NAME,
        '-w', secret,
        '-U',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      return true;
    }

    if (process.platform === 'linux') {
      execFileSync('secret-tool', [
        'store',
        '--label', `DoraBot ${account}`,
        'service', SERVICE_NAME,
        'account', account,
      ], {
        input: secret,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function keychainLoad(account: string): string | undefined {
  if (!canUseNativeKeychain()) return undefined;

  try {
    if (process.platform === 'darwin') {
      const value = execFileSync('security', [
        'find-generic-password',
        '-a', account,
        '-s', SERVICE_NAME,
        '-w',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
      }).trim();
      return value || undefined;
    }

    if (process.platform === 'linux') {
      const value = execFileSync('secret-tool', [
        'lookup',
        'service', SERVICE_NAME,
        'account', account,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
      }).trim();
      return value || undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function keychainDelete(account: string): boolean {
  if (!canUseNativeKeychain()) return false;

  try {
    if (process.platform === 'darwin') {
      execFileSync('security', [
        'delete-generic-password',
        '-a', account,
        '-s', SERVICE_NAME,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      return true;
    }

    if (process.platform === 'linux') {
      execFileSync('secret-tool', [
        'clear',
        'service', SERVICE_NAME,
        'account', account,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

