import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';

type GatewayMsg = {
  id?: number;
  event?: string;
  data?: any;
  result?: any;
  error?: string;
  seq?: number;
};

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function connectAuthed(url: string, token: string): Promise<{
  ws: WebSocket;
  events: GatewayMsg[];
  rpc: (method: string, params?: Record<string, unknown>) => Promise<any>;
}> {
  const ws = new WebSocket(url);
  const events: GatewayMsg[] = [];
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
  let rpcId = 0;

  ws.on('message', (raw) => {
    let msg: GatewayMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.event) events.push(msg);
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const rpc = async (method: string, params?: Record<string, unknown>) => {
    const id = ++rpcId;
    const promise = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ method, params, id }));
    });
    return promise;
  };

  await rpc('auth', { token });
  return { ws, events, rpc };
}

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-reconnect-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  const { loadConfig } = await import('../src/config.js');
  const { startGateway } = await import('../src/gateway/server.js');
  const { GATEWAY_TOKEN_PATH } = await import('../src/workspace.js');

  const dorabotDir = join(tempHome, '.dorabot');
  mkdirSync(dorabotDir, { recursive: true });
  const bootstrapDb = new Database(join(dorabotDir, 'dorabot.db'));
  bootstrapDb.exec(`
    CREATE TABLE IF NOT EXISTS board_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  bootstrapDb.close();

  const port = 19891;
  const host = '127.0.0.1';
  const wsUrl = `ws://${host}:${port}`;
  const config = await loadConfig();
  config.gateway = { ...(config.gateway || {}), tls: false, host, port, streamV2: true };
  config.channels = {
    ...(config.channels || {}),
    whatsapp: { ...(config.channels?.whatsapp || {}), enabled: false },
    telegram: { ...(config.channels?.telegram || {}), enabled: false },
  };
  config.calendar = { enabled: false };
  config.cron = { enabled: false };

  const gateway = await startGateway({ config, host, port });
  const token = readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();
  const sessionKey = 'desktop:dm:test-reconnect-replay';

  try {
    const c1 = await connectAuthed(wsUrl, token);
    await c1.rpc('sessions.subscribe', {
      sessionKeys: [sessionKey],
      lastSeq: 0,
      lastSeqBySession: { [sessionKey]: 0 },
      limit: 2000,
    });

    for (let i = 1; i <= 3; i++) {
      gateway.broadcast({
        event: 'agent.message',
        data: {
          sessionKey,
          source: 'test',
          message: { message: { content: [{ type: 'text', text: `chunk-${i}` }] } },
          timestamp: Date.now(),
        },
      });
    }

    await waitFor(() => {
      const seqs = c1.events.filter(e => e.event === 'agent.message').map(e => e.seq).filter((v): v is number => typeof v === 'number');
      return seqs.length >= 3 ? seqs : undefined;
    }, 2000, 'initial stream');

    const lastSeenSeq = Math.max(...c1.events.map(e => e.seq || 0));
    c1.ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));

    for (let i = 4; i <= 7; i++) {
      gateway.broadcast({
        event: 'agent.message',
        data: {
          sessionKey,
          source: 'test',
          message: { message: { content: [{ type: 'text', text: `chunk-${i}` }] } },
          timestamp: Date.now(),
        },
      });
    }

    const c2 = await connectAuthed(wsUrl, token);
    await c2.rpc('sessions.subscribe', {
      sessionKeys: [sessionKey],
      lastSeq: lastSeenSeq,
      lastSeqBySession: { [sessionKey]: lastSeenSeq },
      limit: 2000,
    });

    const replayed = await waitFor(() => {
      const rows = c2.events.filter(e => e.event === 'agent.message' && typeof e.seq === 'number') as Array<GatewayMsg & { seq: number }>;
      if (rows.length < 4) return undefined;
      return rows;
    }, 3000, 'replayed events');

    const replaySeqs = replayed.map(r => r.seq);
    assert.equal(new Set(replaySeqs).size, replaySeqs.length, 'replay should not duplicate seq values');
    assert(replaySeqs.every(seq => seq > lastSeenSeq), 'replay should only contain events newer than last seen seq');

    c2.ws.close();
    console.log('ok - reconnect replay preserves seq continuity with no duplicates');
  } finally {
    await gateway.close();
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
