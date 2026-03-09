export type CodexCliAuthSummary = {
  method: 'api_key' | 'oauth';
  identity?: string;
};

type CodexCliTokenRecord = {
  access_token?: unknown;
  refresh_token?: unknown;
  account_id?: unknown;
};

type CodexCliAuthRecord = {
  auth_mode?: unknown;
  OPENAI_API_KEY?: unknown;
  api_key?: unknown;
  token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  account_id?: unknown;
  tokens?: CodexCliTokenRecord | null;
};

export type CodexAuthSource = 'managed_api_key' | 'cli_auth' | 'dorabot_oauth' | 'none';

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function summarizeCodexCliAuthRecord(record: unknown): CodexCliAuthSummary | null {
  if (!record || typeof record !== 'object') return null;

  const data = record as CodexCliAuthRecord;
  const nestedTokens = data.tokens && typeof data.tokens === 'object' ? data.tokens : null;
  const authMode = asNonEmptyString(data.auth_mode);

  const apiKey = asNonEmptyString(data.api_key) || asNonEmptyString(data.OPENAI_API_KEY);
  if (apiKey || authMode === 'api_key') {
    return { method: 'api_key', identity: 'Codex CLI (API key)' };
  }

  const accessToken = asNonEmptyString(nestedTokens?.access_token)
    || asNonEmptyString(data.access_token)
    || asNonEmptyString(data.token);
  const refreshToken = asNonEmptyString(nestedTokens?.refresh_token) || asNonEmptyString(data.refresh_token);

  if (!accessToken && !refreshToken) return null;

  const accountId = asNonEmptyString(nestedTokens?.account_id) || asNonEmptyString(data.account_id);
  return {
    method: 'oauth',
    identity: accountId ? `ChatGPT (${accountId})` : 'Codex CLI (ChatGPT)',
  };
}

export function pickCodexAuthSource(input: {
  hasManagedApiKey: boolean;
  hasCliAuth: boolean;
  hasDorabotOAuth: boolean;
}): CodexAuthSource {
  if (input.hasManagedApiKey) return 'managed_api_key';
  if (input.hasCliAuth) return 'cli_auth';
  if (input.hasDorabotOAuth) return 'dorabot_oauth';
  return 'none';
}

export function isLoggedInCodexStatusText(text: string): boolean {
  return /logged in/i.test(text) && !/not logged in/i.test(text);
}
