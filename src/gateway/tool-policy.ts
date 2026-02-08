import type { Config } from '../config.js';

export type Tier = 'auto-allow' | 'notify' | 'require-approval';

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive)/,
  /\brm\s+/,
  /\bmkfs\./,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /curl\s+.*\|\s*(ba)?sh/,
  /wget\s+.*\|\s*(ba)?sh/,
  /\bchmod\s+[0-7]*7[0-7]*/,
  /:()\{\s*:\|:&\s*\};:/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\blaunchctl\s+(unload|remove)/,
  /\bdefaults\s+(delete|write)/,
  /\bfind\s+.*-delete/,
  /\bkill\s+-9/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\bsudo\b/,
  /\bmv\s+/,
  /\bnpm\s+(publish|unpublish)/,
  /\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)/,
];

function classifyBashCommand(command: string): Tier {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return 'require-approval';
  }
  return 'auto-allow';
}

export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>,
  _context?: { isCron?: boolean }
): Tier {
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = (input.command as string) || '';
    return classifyBashCommand(command);
  }

  if (toolName === 'mcp__my-agent__schedule_recurring' ||
      toolName === 'mcp__my-agent__schedule_cron') {
    return 'notify';
  }

  if (toolName === 'mcp__my-agent__message') {
    const action = input.action as string;
    if (action === 'send') return 'notify';
  }

  return 'auto-allow';
}
