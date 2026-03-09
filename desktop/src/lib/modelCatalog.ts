export type ModelOption = {
  value: string;
  label: string;
  requiresApiKey?: boolean;
};

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_CODEX_MODEL = 'gpt-5-codex';

export const CLAUDE_MODELS: ModelOption[] = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5 (legacy)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (legacy)' },
];

export const CODEX_MODELS: ModelOption[] = [
  { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro (API key only)', requiresApiKey: true },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'codex-mini-latest', label: 'Codex Mini Latest (deprecated)' },
];

export function labelForModel(options: ModelOption[], value: string | null | undefined): string {
  if (!value) return '';
  return options.find((option) => option.value === value)?.label || value;
}

export function codexModelsForAuth(method?: string, currentValue?: string | null): ModelOption[] {
  const visible = method === 'api_key'
    ? CODEX_MODELS
    : CODEX_MODELS.filter((option) => !option.requiresApiKey);

  if (currentValue && !visible.some((option) => option.value === currentValue)) {
    const current = CODEX_MODELS.find((option) => option.value === currentValue);
    if (current) return [...visible, current];
  }

  return visible;
}
