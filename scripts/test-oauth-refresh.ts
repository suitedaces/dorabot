import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canReuseAccessTokenAfterRefreshFailure } from '../src/providers/oauth-refresh.js';

const now = 1_000_000;

assert.equal(canReuseAccessTokenAfterRefreshFailure(now + 1, false, false, now), true);
assert.equal(canReuseAccessTokenAfterRefreshFailure(now, false, false, now), false);
assert.equal(canReuseAccessTokenAfterRefreshFailure(now + 1, true, false, now), false);
assert.equal(canReuseAccessTokenAfterRefreshFailure(now + 1, false, true, now), false);

const testHome = join(tmpdir(), `dorabot-oauth-refresh-${process.pid}`);
const fakeBin = join(testHome, 'bin');
const dorabotDir = join(testHome, '.dorabot');
mkdirSync(fakeBin, { recursive: true });
mkdirSync(dorabotDir, { recursive: true });

for (const command of ['which', 'claude']) {
  const path = join(fakeBin, command);
  writeFileSync(path, '#!/bin/sh\nexit 1\n');
  chmodSync(path, 0o755);
}

process.env.HOME = testHome;
process.env.CODEX_HOME = join(testHome, '.codex');
process.env.PATH = `${fakeBin}:${process.env.PATH || ''}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.OPENAI_API_KEY;

const expiresAt = Date.now() + 240_000;
writeFileSync(join(dorabotDir, '.claude-oauth.json'), JSON.stringify({
  access_token: 'claude-access',
  refresh_token: 'claude-refresh',
  expires_at: expiresAt,
}));
writeFileSync(join(dorabotDir, '.codex-oauth.json'), JSON.stringify({
  access_token: 'codex-access',
  refresh_token: 'codex-refresh',
  expires_at: expiresAt,
  account_id: 'account-1',
}));

let refreshRequests = 0;
let refreshStatus = 503;
globalThis.fetch = async () => {
  refreshRequests++;
  return new Response('', { status: refreshStatus });
};

try {
  const [{ ClaudeProvider }, { CodexProvider }] = await Promise.all([
    import('../src/providers/claude.js'),
    import('../src/providers/codex.js'),
  ]);

  const claudeStatus = await new ClaudeProvider().getAuthStatus();
  assert.equal(claudeStatus.authenticated, true);
  assert.equal(claudeStatus.reconnectRequired, false);
  assert.equal(claudeStatus.tokenHealth, 'expiring');

  const codexStatus = await new CodexProvider().getAuthStatus();
  assert.equal(codexStatus.authenticated, true);
  assert.equal(codexStatus.reconnectRequired, false);
  assert.equal(codexStatus.tokenHealth, 'expiring');
  assert.equal(refreshRequests, 2);

  const expiredAt = Date.now() - 1;
  writeFileSync(join(dorabotDir, '.claude-oauth.json'), JSON.stringify({
    access_token: 'claude-access',
    refresh_token: 'claude-refresh',
    expires_at: expiredAt,
  }));
  writeFileSync(join(dorabotDir, '.codex-oauth.json'), JSON.stringify({
    access_token: 'codex-access',
    refresh_token: 'codex-refresh',
    expires_at: expiredAt,
    account_id: 'account-1',
  }));

  const expiredClaudeStatus = await new ClaudeProvider().getAuthStatus();
  assert.equal(expiredClaudeStatus.authenticated, false);
  assert.equal(expiredClaudeStatus.reconnectRequired, false);

  const expiredCodexStatus = await new CodexProvider().getAuthStatus();
  assert.equal(expiredCodexStatus.authenticated, false);
  assert.equal(expiredCodexStatus.reconnectRequired, false);

  refreshStatus = 400;
  writeFileSync(join(dorabotDir, '.claude-oauth.json'), JSON.stringify({
    access_token: 'claude-access',
    refresh_token: 'claude-refresh',
    expires_at: Date.now() + 240_000,
  }));
  writeFileSync(join(dorabotDir, '.codex-oauth.json'), JSON.stringify({
    access_token: 'codex-access',
    refresh_token: 'codex-refresh',
    expires_at: Date.now() + 240_000,
    account_id: 'account-1',
  }));

  const rejectedClaudeStatus = await new ClaudeProvider().getAuthStatus();
  assert.equal(rejectedClaudeStatus.authenticated, false);
  assert.equal(rejectedClaudeStatus.reconnectRequired, true);

  const rejectedCodexStatus = await new CodexProvider().getAuthStatus();
  assert.equal(rejectedCodexStatus.authenticated, false);
  assert.equal(rejectedCodexStatus.reconnectRequired, true);
  assert.equal(refreshRequests, 6);
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

console.log('oauth refresh fallback: passed');
