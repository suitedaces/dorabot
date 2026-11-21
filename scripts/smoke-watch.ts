// manual smoke: scratch gateway under a temp HOME, one real model turn sets a watch,
// then we check session stamping, the change push, and the wake turn. needs claude auth.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from 'node:http';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';

type Msg = { id?: number; result?: unknown; error?: string; event?: string; data?: any };

async function until<T>(fn: () => T | undefined, label: string, ms: number): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'dorabot-smoke-watch-'));
  const realHome = process.env.HOME!;
  // read the login keychain before HOME moves: `security` finds it under ~/Library
  const kc = JSON.parse(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', process.env.USER || 'ishan', '-w'], { encoding: 'utf-8' }).trim());
  process.env.HOME = home;
  const dir = join(home, '.dorabot');
  mkdirSync(dir, { recursive: true });
  // the scratch home has no cli login: borrow the cli's access token as a dorabot oauth file.
  // access token only, no refresh token, so nothing here can rotate the real credentials.
  writeFileSync(join(dir, '.claude-oauth.json'), JSON.stringify({ access_token: kc.claudeAiOauth.accessToken, expires_at: Date.now() + 3 * 3600_000 }));
  void realHome;
  const boot = new Database(join(dir, 'dorabot.db'));
  boot.exec('CREATE TABLE IF NOT EXISTS board_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value TEXT);');
  boot.close();

  const { loadConfig } = await import('../src/config.js');
  const { startGateway } = await import('../src/gateway/server.js');
  const { GATEWAY_TOKEN_PATH, GATEWAY_SOCKET_PATH } = await import('../src/workspace.js');
  const config = await loadConfig();
  config.model = 'claude-fable-5-1';
  config.cwd = process.cwd();
  config.permissionMode = 'bypassPermissions';
  (config as any).autonomy = 'manual';
  config.security = { ...(config.security || {}), approvalMode: 'autonomous' } as any;
  config.channels = { whatsapp: { enabled: false }, telegram: { enabled: false } } as any;
  config.calendar = { enabled: false } as any;
  (config as any).cron = { enabled: false };

  const gateway = await startGateway({ config, socketPath: GATEWAY_SOCKET_PATH });
  const token = readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();

  const ws = new WebSocket('ws://localhost', { agent: new Agent({ socketPath: GATEWAY_SOCKET_PATH }) });
  const events: Msg[] = [];
  const pending = new Map<number, (m: Msg) => void>();
  let n = 0;
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString()) as Msg;
    if (typeof m.id === 'number') { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.event) events.push(m);
  });
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const rpc = (method: string, params?: Record<string, unknown>) => new Promise<any>((res, rej) => {
    const id = ++n; pending.set(id, m => m.error ? rej(new Error(m.error)) : res(m.result));
    ws.send(JSON.stringify({ method, params, id }));
  });
  await rpc('auth', { token });
  const beat = setInterval(() => { rpc('ping').catch(() => {}); }, 10_000);

  const chatId = 'watch-smoke';
  const sessionKey = `desktop:dm:${chatId}`;
  const flag = join(home, 'flag.txt');
  writeFileSync(flag, 'running\n');
  await rpc('sessions.subscribe', { sessionKeys: [sessionKey], lastSeq: 0, lastSeqBySession: { [sessionKey]: 0 }, limit: 500 });
  const runsDone = () => events.filter(e => e.event === 'status.update' && e.data?.sessionKey === sessionKey && e.data?.activeRun === false).length;

  try {
    console.log('turn 1: agent sets a change watch and a wake watch');
    await rpc('chat.send', {
      chatId,
      prompt: `Call the watch tool twice, nothing else, then reply "ok". 1) summary "clock", command "date +%S", intervalSec 30. 2) summary "flag", command "cat ${flag}", intervalSec 30, until "^DONE", notify "done", wake true. Leave sessionKey/channel/chatId empty.`,
    });
    await until(() => runsDone() >= 1 ? true : undefined, 'turn 1 to finish', 180_000);

    const db = new Database(join(dir, 'dorabot.db'), { readonly: true });
    const watches = (db.prepare('SELECT data FROM watches').all() as { data: string }[]).map(r => JSON.parse(r.data));
    console.log('watches:', watches.map(w => ({ id: w.id, summary: w.summary, sessionKey: w.sessionKey, channel: w.channel, until: w.until, wake: w.wake })));
    assert.equal(watches.length, 2, 'two watches set');
    for (const w of watches) assert.equal(w.sessionKey, sessionKey, 'canUseTool stamped the session');
    const clock = watches.find(w => w.summary.toLowerCase().includes('clock'))!;
    const flagW = watches.find(w => w.until)!;

    console.log('waiting for the clock change push (baseline tick, then one more)');
    const change = await until(() => events.find(e => e.event === 'agent.notice' && e.data?.message?.subtype === 'watch' && e.data.message.watch_id === clock.id), 'clock change notice', 120_000);
    console.log('change notice:', change.data.message);
    assert.equal(change.data.sessionKey, sessionKey);
    assert.equal(change.data.message.reason, 'change');
    const persisted = db.prepare("SELECT content FROM messages WHERE type='system' AND content LIKE '%\"subtype\":\"watch\"%'").all() as { content: string }[];
    assert.ok(persisted.length >= 1, 'notice persisted to the session');

    console.log('flipping the flag, waiting for done + wake turn');
    writeFileSync(flag, 'DONE all 40\n');
    const done = await until(() => events.find(e => e.event === 'agent.notice' && e.data?.message?.subtype === 'watch' && e.data.message.watch_id === flagW.id && e.data.message.reason === 'done'), 'flag done notice', 120_000);
    console.log('done notice:', done.data.message);
    const wake = await until(() => events.find(e => e.event === 'agent.user_message' && e.data?.source === `watch/${flagW.id}`), 'wake turn start', 60_000).catch(err => {
      console.log('events after done:', events.slice(events.indexOf(done)).map(e => `${e.event} ${JSON.stringify(e.data).slice(0, 160)}`).join('\n'));
      throw err;
    });
    console.log('wake prompt:', String(wake.data.prompt).slice(0, 120));
    await until(() => runsDone() >= 2 ? true : undefined, 'wake turn to finish', 180_000);
    const rows = (db.prepare('SELECT data FROM watches').all() as { data: string }[]).map(r => JSON.parse(r.data));
    console.log('final:', rows.map(w => ({ id: w.id, status: w.status, ticks: w.ticks, pushes: w.pushes })));
    assert.equal(rows.find(w => w.id === flagW.id)!.status, 'done');
    db.close();
    console.log('ok - watch smoke: session stamped, change pushed + persisted, done + wake turn ran');
  } finally {
    clearInterval(beat);
    ws.close();
    await gateway.close();
    rmSync(home, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), err => { console.error('SMOKE FAILED:', err); process.exit(1); });
