/**
 * one-time cookie migration from the legacy Playwright Chrome profile to the
 * Electron session partition used by the embedded browser.
 *
 * source: `~/.dorabot/browser/profile/Cookies` (Chrome SQLite format, cookies
 * encrypted via macOS Keychain "Chrome Safe Storage" + AES-128-CBC)
 * target: electron session.fromPartition('persist:dora-browser').cookies
 * sentinel: `~/.dorabot/browser-migrated` (skip if present)
 *
 * runs from desktop/electron/main.ts on ready, before any tab opens. if
 * decryption or keychain access fails, logs and writes the sentinel anyway
 * so we don't retry every boot. users can re-login to any site by hand.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Session } from 'electron';

const DORABOT_DIR = join(homedir(), '.dorabot');
const SENTINEL_PATH = join(DORABOT_DIR, 'browser-migrated');
const OLD_PROFILE_DIR = join(DORABOT_DIR, 'browser', 'profile');
const COOKIES_DB_PATH = join(OLD_PROFILE_DIR, 'Cookies');

type ChromeCookieRow = {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer | null;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
};

type ElectronCookie = {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
};

export async function migrateBrowserProfile(targetSession: Session): Promise<void> {
  if (existsSync(SENTINEL_PATH)) return;

  if (!existsSync(COOKIES_DB_PATH)) {
    // no legacy profile, nothing to migrate
    writeSentinel('no_legacy_profile');
    return;
  }

  console.log('[browser-migrate] migrating cookies from legacy profile');

  try {
    const key = derivePbkdfKey();
    const rows = readCookieRows(COOKIES_DB_PATH);
    const cookies = rowsToElectronCookies(rows, key);

    let ok = 0;
    let fail = 0;
    for (const c of cookies) {
      try {
        await targetSession.cookies.set(c);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    console.log(`[browser-migrate] migrated ${ok} cookies (${fail} failed, ${cookies.length} total)`);
    writeSentinel('ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[browser-migrate] failed:', msg);
    writeSentinel(`failed:${msg}`);
  }
}

function derivePbkdfKey(): Buffer {
  // macOS keychain: "Chrome Safe Storage" is the generic password Chromium
  // uses for cookie encryption. Chromium derives a 16-byte AES-128 key via
  // PBKDF2-HMAC-SHA1 with salt='saltysalt', iterations=1003, dklen=16.
  const stdout = execFileSync(
    'security',
    ['find-generic-password', '-ga', 'Chrome Safe Storage', '-w'],
    { encoding: 'utf-8' },
  ).trim();
  if (!stdout) throw new Error('keychain password empty');
  return pbkdf2Sync(stdout, 'saltysalt', 1003, 16, 'sha1');
}

function readCookieRows(dbPath: string): ChromeCookieRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`
      SELECT host_key, name, value, encrypted_value, path, expires_utc,
             is_secure, is_httponly, samesite
      FROM cookies
    `).all() as ChromeCookieRow[];
  } finally {
    db.close();
  }
}

function rowsToElectronCookies(rows: ChromeCookieRow[], key: Buffer): ElectronCookie[] {
  const out: ElectronCookie[] = [];
  for (const r of rows) {
    let value = r.value || '';
    if (!value && r.encrypted_value && r.encrypted_value.length > 0) {
      const decrypted = decryptChromeValue(r.encrypted_value, key);
      if (decrypted === null) continue;
      value = decrypted;
    }
    // Skip cookies with no host
    if (!r.host_key) continue;

    const host = r.host_key.replace(/^\./, '');
    out.push({
      url: `${r.is_secure ? 'https' : 'http'}://${host}${r.path || '/'}`,
      name: r.name,
      value,
      domain: r.host_key,
      path: r.path || '/',
      secure: r.is_secure === 1,
      httpOnly: r.is_httponly === 1,
      expirationDate: chromeMicrosToUnixSeconds(r.expires_utc),
      sameSite: toSameSite(r.samesite),
    });
  }
  return out;
}

function decryptChromeValue(encrypted: Buffer, key: Buffer): string | null {
  // v10 = mac aes-128-cbc with iv of 16 spaces. v11 = linux-only (libsecret).
  // we only handle v10 here; dorabot's bundled chrome only writes v10 on mac.
  if (encrypted.length < 3) return null;
  const prefix = encrypted.subarray(0, 3).toString('utf-8');
  if (prefix !== 'v10') return null;

  const ciphertext = encrypted.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 space bytes

  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf-8');
  } catch {
    return null;
  }
}

function chromeMicrosToUnixSeconds(expiresUtc: number): number | undefined {
  // chrome stores expires_utc as microseconds since 1601-01-01. 0 = session cookie.
  if (!expiresUtc || expiresUtc <= 0) return undefined;
  const EPOCH_DIFF_SECONDS = 11_644_473_600;
  return expiresUtc / 1_000_000 - EPOCH_DIFF_SECONDS;
}

function toSameSite(v: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  // chromium: -1 unspecified, 0 no_restriction, 1 lax, 2 strict
  if (v === 0) return 'no_restriction';
  if (v === 1) return 'lax';
  if (v === 2) return 'strict';
  return 'unspecified';
}

function writeSentinel(status: string): void {
  try {
    writeFileSync(SENTINEL_PATH, `${new Date().toISOString()}\n${status}\n`, 'utf-8');
  } catch {}
}

// keep SENTINEL_PATH visible for callers that want to force re-migration
export { SENTINEL_PATH, COOKIES_DB_PATH };

// optional CLI: `node scripts/migrate-browser-profile.js --dry-run` to just
// list how many decryptable cookies the legacy profile has, without writing
// anything. Runs outside electron, so it only exercises decrypt + DB read.
if (require.main === module) {
  (async () => {
    if (!existsSync(COOKIES_DB_PATH)) {
      console.log('no legacy cookies db at', COOKIES_DB_PATH);
      process.exit(0);
    }
    try {
      const key = derivePbkdfKey();
      const rows = readCookieRows(COOKIES_DB_PATH);
      const cookies = rowsToElectronCookies(rows, key);
      console.log(`legacy profile has ${rows.length} rows, ${cookies.length} decryptable cookies`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('migration dry-run failed:', msg);
      process.exit(1);
    }
  })();
}
