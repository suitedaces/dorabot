import { existsSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// one-time migration from ~/.my-agent/ to ~/.dorabot/
export function migrateDataDir(): void {
  const oldDir = join(homedir(), '.my-agent');
  const newDir = join(homedir(), '.dorabot');

  if (existsSync(oldDir) && !existsSync(newDir)) {
    try {
      renameSync(oldDir, newDir);
      console.log(`[migrate] moved ${oldDir} → ${newDir}`);
    } catch (err) {
      console.error(`[migrate] failed to move ${oldDir} → ${newDir}:`, err);
      // don't block startup — new dir will be created as needed
    }
  }
}
