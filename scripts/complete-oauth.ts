import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

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
  await rpc('auth', { token });

  const loginId = process.argv[2];
  if (!loginId) {
    console.error('usage: tsx scripts/complete-oauth.ts <loginId>');
    process.exit(1);
  }
  const status = await rpc('provider.auth.oauth.complete', { provider: 'claude', loginId });

  if (status.authenticated) {
    console.log('✓ authenticated via', status.method);
    console.log('✓ identity:', status.identity);
  } else {
    console.error('✗ error:', status.error);
    process.exit(1);
  }

  ws.close();
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
