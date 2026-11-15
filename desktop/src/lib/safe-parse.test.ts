import { describe, expect, it } from 'vitest';
import { safeParse } from './safe-parse';

// a bash input the way the model streams it: heredoc, paths, escaped quotes, backslashes, unicode
const COMMAND = [
  "mkdir -p /tmp/x && cd /tmp/x && cat > a.ts <<'EOF'",
  'const w = window as any;',
  'console.log("hi \\"quoted\\" and a \\\\ backslash", \'single\', "café");',
  'if (a) { b(); }',
  'EOF',
  'echo "done: $HOME" | sed \'s/\\t/ /g\'',
].join('\n');
const FULL = JSON.stringify({ command: COMMAND, description: 'Write a file', timeout: 60000 });

describe('safeParse on streaming prefixes', () => {
  it('only ever extends the command, never falls back or shrinks', () => {
    let started = false;
    for (let n = 1; n <= FULL.length; n++) {
      const command = safeParse(FULL.slice(0, n)).command;
      if (typeof command === 'string' && command) started = true;
      if (!started) continue;
      expect(typeof command).toBe('string');
      expect(COMMAND.startsWith(command)).toBe(true);
    }
    expect(started).toBe(true);
  });

  it('parses the complete input exactly', () => {
    expect(safeParse(FULL)).toEqual(JSON.parse(FULL));
  });

  it('drops a key that has no value yet', () => {
    expect(safeParse('{"command": "ls", "descr')).toEqual({ command: 'ls' });
    expect(safeParse('{"command": "ls", "description":')).toEqual({ command: 'ls', description: null });
  });

  it('returns an empty object for empty input', () => {
    expect(safeParse('')).toEqual({});
  });
});
