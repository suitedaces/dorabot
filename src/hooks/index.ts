import { exec } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// hook event types (matching Claude SDK v0.3.258)
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PreModelSwitch'
  | 'PostModelSwitch'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded';

export type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
};

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  agent_id?: string;
  agent_type?: string;
};

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  agent_id?: string;
  agent_type?: string;
};

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
};

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd';
  reason: string;
};

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
  agent_id: string;
  agent_type: string;
};

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
};

export type SetupHookInput = BaseHookInput & {
  hook_event_name: 'Setup';
};

export type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: 'TeammateIdle';
  agent_id: string;
};

export type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCompleted';
  task_id: string;
  tool_use_id: string;
};

export type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: 'ConfigChange';
  key: string;
  value: unknown;
};

export type ElicitationHookInput = BaseHookInput & {
  hook_event_name: 'Elicitation';
  elicitation_id: string;
  message: string;
  fields: ElicitationField[];
};

export type ElicitationField = {
  name: string;
  type: 'text' | 'select' | 'boolean' | 'number';
  label: string;
  description?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default_value?: unknown;
};

export type ElicitationResultHookInput = BaseHookInput & {
  hook_event_name: 'ElicitationResult';
  elicitation_id: string;
  values: Record<string, unknown>;
};

export type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeCreate';
  worktree_path: string;
  branch: string;
};

export type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeRemove';
  worktree_path: string;
};

export type InstructionsLoadedHookInput = BaseHookInput & {
  hook_event_name: 'InstructionsLoaded';
  files: string[];
};

// model switch: 'command' = /model or /config, 'picker' = interactive picker,
// 'sdk' = headless set_model (which is how the gateway's agent.setModel arrives)
export type ModelSwitchSource = 'command' | 'picker' | 'sdk';

export type PreModelSwitchHookInput = BaseHookInput & {
  hook_event_name: 'PreModelSwitch';
  from_model: string;
  to_model: string;
  /** what was asked for: an alias like "opus", a full id, or null for "default" */
  requested_model: string | null;
  source: ModelSwitchSource;
};

export type PostModelSwitchHookInput = BaseHookInput & {
  hook_event_name: 'PostModelSwitch';
  from_model: string;
  to_model: string;
  requested_model: string | null;
  source: ModelSwitchSource;
};

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ConfigChangeHookInput
  | ElicitationHookInput
  | ElicitationResultHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput
  | InstructionsLoadedHookInput
  | PreModelSwitchHookInput
  | PostModelSwitchHookInput;

export type HookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
};

export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;

export type HookCallbackMatcher = {
  matcher?: string;
  hooks: HookCallback[];
};

// bash command validation hook
const bashValidationHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return { continue: true };

  const toolInput = input.tool_input as { command?: string };
  const command = toolInput.command || '';

  // block dangerous commands
  const dangerous = [
    /rm\s+-rf\s+\//,
    /rm\s+-rf\s+~/,
    /rm\s+-rf\s+\.\.\//,
    /mkfs\./,
    /dd\s+if=/,
    />\s*\/dev\/sd/,
    /curl\s+.*\|\s*(ba)?sh/,
    /wget\s+.*\|\s*(ba)?sh/,
    /chmod\s+777/,
    /:()\{\s*:\|:&\s*\};:/,
    /shutdown|reboot|halt/,
    /launchctl\s+unload/,
    /defaults\s+delete/,
    /find\s+\/\s+-delete/,
  ];

  for (const pattern of dangerous) {
    if (pattern.test(command)) {
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Blocked dangerous command pattern: ${pattern}`,
        },
      };
    }
  }

  return { continue: true };
};

// typecheck after .ts edits in the project
const typecheckHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PostToolUse') return { continue: true };

  const toolInput = input.tool_input as { file_path?: string };
  const filePath = toolInput.file_path;
  if (!filePath || !filePath.endsWith('.ts')) return { continue: true };

  const resolved = resolve(filePath);
  if (!resolved.startsWith(PROJECT_ROOT + '/src/')) return { continue: true };

  const output = await new Promise<string>((resolve) => {
    exec('npx tsc --noEmit 2>&1', { cwd: PROJECT_ROOT, timeout: 30000 }, (_err, stdout, stderr) => {
      resolve((stdout || stderr || '').trim());
    });
  });

  if (output) {
    return {
      continue: true,
      systemMessage: `typecheck failed after editing ${filePath}. fix these errors before continuing:\n\n${output.slice(0, 3000)}`,
    };
  }
  return { continue: true };
};

// session tracking hook
const sessionTrackingHook: HookCallback = async (input) => {
  if (input.hook_event_name === 'SessionStart') {
    console.log(`Session started: ${input.session_id} (source: ${input.source})`);
  } else if (input.hook_event_name === 'SessionEnd') {
    console.log(`Session ended: ${input.session_id} (reason: ${input.reason})`);
  }
  return { continue: true };
};

// model switch tracking — a run can change model mid-conversation (gateway
// agent.setModel arrives as source 'sdk'), so the model in the init event is not
// necessarily the model that produced a later turn.
const modelSwitchHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PostModelSwitch') return { continue: true };
  const requested = input.requested_model ?? 'default';
  console.log(
    `[model] ${input.from_model} → ${input.to_model} (requested: ${requested}, source: ${input.source})`
  );
  return { continue: true };
};

// default hooks configuration
export function createDefaultHooks(config: Config): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    SessionStart: [
      { hooks: [sessionTrackingHook] },
    ],
    PostModelSwitch: [
      { hooks: [modelSwitchHook] },
    ],
    PostToolUse: [
      { matcher: 'Write', hooks: [typecheckHook] },
      { matcher: 'Edit', hooks: [typecheckHook] },
    ],
  };
}

// custom hook builder
export function createHook(callback: HookCallback, matcher?: string): HookCallbackMatcher {
  return {
    matcher,
    hooks: [callback],
  };
}

// merge hooks
export function mergeHooks(
  base: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  override: Partial<Record<HookEvent, HookCallbackMatcher[]>>
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const result = { ...base };

  for (const [event, matchers] of Object.entries(override)) {
    const key = event as HookEvent;
    if (result[key]) {
      result[key] = [...result[key]!, ...matchers];
    } else {
      result[key] = matchers;
    }
  }

  return result;
}
