// codex auth.json already has a login and dorabot still holds an old copy: keep codex's, drop ours
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testHome = join(tmpdir(), `dorabot-codex-legacy-${process.pid}`);
const fakeBin = join(testHome, 'bin');
mkdirSync(fakeBin, { recursive: true });
mkdirSync(join(testHome, '.dorabot'), { recursive: true });
mkdirSync(join(testHome, '.codex'), { recursive: true });
// no `which` = no native keychain, so the real one is never touched
writeFileSync(join(fakeBin, 'which'), '#!/bin/sh\nexit 1\n');
chmodSync(join(fakeBin, 'which'), 0o755);

process.env.HOME = testHome;
process.env.CODEX_HOME = join(testHome, '.codex');
process.env.PATH = `${fakeBin}:${process.env.PATH || ''}`;
delete process.env.OPENAI_API_KEY;

const cliRecord = { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { access_token: 'cli-access', refresh_token: 'cli-refresh', account_id: 'acct-cli' } };
writeFileSync(join(testHome, '.codex', 'auth.json'), JSON.stringify(cliRecord));
writeFileSync(join(testHome, '.dorabot', '.codex-oauth.json'), JSON.stringify({
  access_token: 'stale-access', refresh_token: 'stale-refresh', expires_at: Date.now() - 60 * 86400_000, account_id: 'acct-old',
}));

let fetches = 0;
globalThis.fetch = async () => { fetches++; return new Response('', { status: 401 }); };

try {
  const { CodexProvider } = await import('../src/providers/codex.js');
  const status = await new CodexProvider().getAuthStatus();
  assert.equal(status.authenticated, true);
  assert.equal(status.reconnectRequired, false);
  assert.equal(status.identity, 'ChatGPT (acct-cli)');
  assert.deepEqual(JSON.parse(readFileSync(join(testHome, '.codex', 'auth.json'), 'utf-8')), cliRecord);
  assert.equal(existsSync(join(testHome, '.dorabot', '.codex-oauth.json')), false);
  assert.equal(fetches, 0);
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

console.log('codex legacy oauth: passed');
