#!/usr/bin/env tsx
// quick oauth login via gateway rpc

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createInterface } from 'node:readline';

const TOKEN_FILE = join(homedir(), '.dorabot', 'gateway-token');
const token = readFileSync(TOKEN_FILE, 'utf-8').trim();

const ws = new WebSocket('wss://127.0.0.1:18789', {
  rejectUnauthorized: false,
});

let msgId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }
});

function rpc(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ method, params, id }));
  });
}

async function main() {
  await new Promise((res) => ws.once('open', res));

  // auth
  await rpc('auth', { token });
  console.log('[ok] authenticated');

  // start oauth
  const { authUrl } = await rpc('provider.auth.oauth', { provider: 'claude' });
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nAfter authorizing, you\'ll be redirected to a callback page.');
  console.log('Copy the full URL from the address bar and paste it here:\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Callback URL: ', (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  // extract code and state from url
  const url = new URL(answer);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    console.error('No code found in URL');
    process.exit(1);
  }

  const loginId = state ? `${code}#${state}` : code;

  // complete oauth
  const status = await rpc('provider.auth.oauth.complete', { provider: 'claude', loginId });

  if (status.authenticated) {
    console.log('\n[ok] authenticated via', status.method);
    console.log('identity:', status.identity);
  } else {
    console.error('\n[error]', status.error);
    process.exit(1);
  }

  ws.close();
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
