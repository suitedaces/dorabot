import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  DORABOT_CONFIG_PATH,
  GATEWAY_TOKEN_PATH,
  LEGACY_CODEX_AUTH_PATH,
  SESSIONS_DIR,
  SKILLS_DIR,
  TLS_DIR,
  WHATSAPP_AUTH_DIR,
  toHomeAlias,
} from './workspace.js';

let loadedConfigPath: string | undefined;

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'delegate';

export type SandboxMode = 'off' | 'non-main' | 'all';
export type SandboxScope = 'session' | 'agent' | 'shared';
export type WorkspaceAccess = 'none' | 'ro' | 'rw';

export type SandboxSettings = {
  enabled?: boolean;
  mode?: SandboxMode;
  scope?: SandboxScope;
  workspaceAccess?: WorkspaceAccess;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: {
    enabled?: boolean;
    allowLocalBinding?: boolean;
    allowUnixSockets?: string[];
  };
};

export type ToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
};

export type AgentDefinition = {
  description: string;
  tools?: string[];
  prompt: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
};

export type CronConfig = {
  enabled?: boolean;
  jobsFile?: string;
};

export type CalendarConfig = {
  enabled?: boolean;
  tickIntervalMs?: number;
};

export type WhatsAppChannelConfig = {
  enabled?: boolean;
  authDir?: string;
  accountId?: string;
  dmPolicy?: 'open' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  tools?: ToolPolicyConfig;
  allowedPaths?: string[];
  deniedPaths?: string[];
};

export type TelegramChannelConfig = {
  enabled?: boolean;
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  dmPolicy?: 'open' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  tools?: ToolPolicyConfig;
  allowedPaths?: string[];
  deniedPaths?: string[];
};

export type ChannelsConfig = {
  whatsapp?: WhatsAppChannelConfig;
  telegram?: TelegramChannelConfig;
};

export type GatewayConfig = {
  port?: number;
  host?: string;
  enabled?: boolean;
  tls?: boolean;
  streamV2?: boolean;
  allowedOrigins?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
};

export type BrowserConfig = {
  enabled?: boolean;
  executablePath?: string;
  cdpPort?: number;
  profileDir?: string;
  headless?: boolean;
};

export type AutonomyMode = 'supervised' | 'autonomous';

export type SecurityConfig = {
  approvalMode?: 'approve-sensitive' | 'autonomous' | 'lockdown';
  tools?: ToolPolicyConfig;
};

export type ProviderName = 'claude' | 'codex' | 'openai-compatible' | 'minimax';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max';

export type ThinkingMode = 'adaptive' | 'disabled' | { type: 'enabled'; budgetTokens: number };

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';
export type CodexWebSearchMode = 'disabled' | 'cached' | 'live';

export type CodexProviderConfig = {
  authMethod?: 'oauth' | 'api_key';
  model?: string;
  sandboxMode?: CodexSandboxMode;
  approvalPolicy?: CodexApprovalPolicy;
  networkAccess?: boolean;
  webSearch?: CodexWebSearchMode;
};

export type OpenAICompatibleProviderConfig = {
  model?: string;
  baseUrl?: string;
  sandboxMode?: CodexSandboxMode;
  approvalPolicy?: CodexApprovalPolicy;
  networkAccess?: boolean;
  webSearch?: CodexWebSearchMode;
};

export type ProviderConfig = {
  name: ProviderName;
  codex?: CodexProviderConfig;
  openaiCompatible?: OpenAICompatibleProviderConfig;
};

export type McpServerEntry = {
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

export type Config = {
  provider: ProviderConfig;
  model: string;
  reasoningEffort?: ReasoningEffort;
  thinking?: ThinkingMode;
  maxBudgetUsd?: number;
  permissionMode: PermissionMode;
  autonomy?: AutonomyMode;
  skills: {
    enabled: string[];
    disabled: string[];
    dirs: string[];
  };
  agents: Record<string, AgentDefinition>;
  sandbox: SandboxSettings;
  cron?: CronConfig;
  calendar?: CalendarConfig;
  channels?: ChannelsConfig;
  gateway?: GatewayConfig;
  browser?: BrowserConfig;
  security?: SecurityConfig;
  mcpServers?: Record<string, McpServerEntry>;
  maxTurns?: number;
  userName?: string;
  userTimezone?: string;
  sessionDir: string;
  cwd: string;
};

const DEFAULT_CONFIG: Config = {
  provider: { name: 'claude' },
  model: 'claude-sonnet-4-5-20250929',
  permissionMode: 'default',
  skills: {
    enabled: [],
    disabled: [],
    dirs: [
      join(process.cwd(), 'skills'),
      SKILLS_DIR,
    ],
  },
  agents: {},
  sandbox: {
    enabled: false,
    autoAllowBashIfSandboxed: false,
  },
  sessionDir: SESSIONS_DIR,
  cwd: process.env.DORABOT_ELECTRON ? join(homedir(), 'Desktop') : process.cwd(),
};

export async function loadConfig(configPath?: string): Promise<Config> {
  const paths = [
    configPath,
    join(process.cwd(), 'dorabot.config.json'),
    DORABOT_CONFIG_PATH,
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        const userConfig = JSON.parse(content);
        loadedConfigPath = p;
        return mergeConfig(DEFAULT_CONFIG, userConfig);
      } catch {
        // ignore parse errors, use defaults
      }
    }
  }

  return DEFAULT_CONFIG;
}

function mergeConfig(base: Config, override: Partial<Config>): Config {
  return {
    ...base,
    ...override,
    provider: {
      ...base.provider,
      ...override.provider,
    },
    skills: {
      ...base.skills,
      ...override.skills,
    },
    sandbox: {
      ...base.sandbox,
      ...override.sandbox,
    },
    agents: {
      ...base.agents,
      ...override.agents,
    },
  };
}

export function getConfigValue<K extends keyof Config>(config: Config, key: K): Config[K] {
  return config[key];
}

export function getConfigPath(): string {
  return loadedConfigPath || DORABOT_CONFIG_PATH;
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export const ALWAYS_DENIED = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws',
  toHomeAlias(WHATSAPP_AUTH_DIR),
  toHomeAlias(GATEWAY_TOKEN_PATH),
  toHomeAlias(LEGACY_CODEX_AUTH_PATH),
  toHomeAlias(TLS_DIR),
  '~/.config/nanoclaw',
];

export function isPathAllowed(
  targetPath: string,
  config: Config,
  channelOverride?: { allowedPaths?: string[]; deniedPaths?: string[] },
): boolean {
  const home = homedir();
  let resolved: string;
  try {
    resolved = realpathSync(targetPath);
  } catch {
    resolved = resolve(targetPath);
  }

  // denied: always_denied + global + channel-specific (all merged)
  const globalDenied = config.gateway?.deniedPaths || ALWAYS_DENIED;
  const channelDenied = channelOverride?.deniedPaths || [];
  const denied = [...globalDenied, ...channelDenied].map(p => resolve(p.replace(/^~/, home)));
  if (denied.some(d => resolved.startsWith(d))) return false;

  // allowed: channel-specific overrides global if set
  const allowedRaw = channelOverride?.allowedPaths?.length
    ? channelOverride.allowedPaths
    : (config.gateway?.allowedPaths || [home, '/tmp']);
  const allowed = allowedRaw.map(p => resolve(p.replace(/^~/, home)));
  return allowed.some(a => resolved.startsWith(a));
}
