import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

function bootstrapLegacyTables(tempHome: string): void {
  const dorabotDir = join(tempHome, '.dorabot');
  mkdirSync(dorabotDir, { recursive: true });
  const db = new Database(join(dorabotDir, 'dorabot.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.close();
}

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-scheduler-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    bootstrapLegacyTables(tempHome);
    const { startScheduler } = await import('../src/calendar/scheduler.js');

    let runItemCalls = 0;
    let onItemRunCalls = 0;

    const config = {
      model: 'claude-sonnet-4-5-20250929',
      permissionMode: 'default',
      sandbox: { enabled: false, mode: 'off' },
      provider: { name: 'claude' },
      calendar: { tickIntervalMs: 60_000 },
    } as any;

    const scheduler = startScheduler({
      config,
      tickIntervalMs: 60_000,
      runItem: async () => {
        runItemCalls++;
        return {
          sessionId: 'test-session',
          result: 'ok',
          messages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
          durationMs: 5,
          usedMessageTool: false,
        };
      },
      onItemRun: () => {
        onItemRunCalls++;
      },
    });

    const item = scheduler.addItem({
      type: 'event',
      summary: 'test',
      dtstart: new Date(Date.now() + 3600_000).toISOString(),
      message: 'hello',
      enabled: true,
    });

    const result = await scheduler.runItemNow(item.id);

    assert.equal(result.status, 'ran', 'runItemNow should report successful run');
    assert.equal(runItemCalls, 1, 'runItem callback should be used by runItemNow');
    assert.equal(onItemRunCalls, 1, 'onItemRun should fire exactly once for runItemNow');

    scheduler.stop();
    console.log('ok - scheduler runItemNow uses runItem callback and emits onItemRun');
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
