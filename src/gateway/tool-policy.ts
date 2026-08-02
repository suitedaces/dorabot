import type { ToolPolicyConfig } from '../config.js';

export type Tier = 'auto-allow' | 'notify' | 'require-approval';

export function isToolAllowed(
  toolName: string,
  channelPolicy?: ToolPolicyConfig,
  globalPolicy?: ToolPolicyConfig,
): boolean {
  const name = cleanToolName(toolName);

  // deny always wins
  const denied = [...(channelPolicy?.deny || []), ...(globalPolicy?.deny || [])];
  if (denied.includes(name)) return false;

  // channel allow list takes precedence
  if (channelPolicy?.allow && channelPolicy.allow.length > 0) {
    return channelPolicy.allow.includes(name);
  }

  // global allow list
  if (globalPolicy?.allow && globalPolicy.allow.length > 0) {
    return globalPolicy.allow.includes(name);
  }

  return true;
}

// strip mcp__<server>__ prefix
export function cleanToolName(name: string): string {
  if (!name || !name.startsWith('mcp__')) return name || 'unknown';
  const idx = name.indexOf('__', 5);
  return idx >= 0 ? name.slice(idx + 2) : name;
}

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
): Tier {
  const name = cleanToolName(toolName);

  if (name === 'Bash' || name === 'bash') {
    const command = (input.command as string) || '';
    return classifyBashCommand(command);
  }

  if (name === 'Write' || name === 'Edit') {
    return 'require-approval';
  }

  if (name === 'browser') {
    return 'require-approval';
  }

  // these are the names the calendar tools actually register under. the old list
  // (schedule_reminder/schedule_recurring/schedule_cron) matched nothing, so
  // scheduling persistence was silently auto-allowed.
  if (name === 'schedule' ||
      name === 'update_schedule' ||
      name === 'cancel_schedule') {
    return 'require-approval';
  }

  // outbound messaging leaves the machine, and attaching a file makes it an
  // exfiltration path. notify at minimum, approve when it carries a payload.
  if (name === 'message') {
    const action = (input.action as string) || '';
    if (action === 'send') {
      return input.media ? 'require-approval' : 'notify';
    }
    return 'notify';
  }

  return 'auto-allow';
}
