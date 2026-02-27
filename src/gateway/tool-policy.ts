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
  if (!name.startsWith('mcp__')) return name;
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
  channelPolicy?: ToolPolicyConfig,
): Tier {
  const name = cleanToolName(toolName);

  if (name === 'Bash' || name === 'bash') {
    const command = (input.command as string) || '';
    return classifyBashCommand(command);
  }

  if (name === 'Write' || name === 'Edit') {
    return 'require-approval';
  }

  if (name === 'message') {
    // If channel policy explicitly allows message, auto-allow it
    if (channelPolicy?.allow && channelPolicy.allow.includes('message')) {
      return 'auto-allow';
    }
    return 'require-approval';
  }

  if (name === 'browser') {
    return 'require-approval';
  }

  if (name === 'schedule_reminder' ||
      name === 'schedule_recurring' ||
      name === 'schedule_cron') {
    return 'require-approval';
  }

  return 'auto-allow';
}
