import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-scheduler-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
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
