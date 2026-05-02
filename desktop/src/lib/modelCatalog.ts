export type ModelOption = {
  value: string;
  label: string;
  requiresApiKey?: boolean;
  description?: string;
  hidden?: boolean;
  deprecated?: boolean;
  researchPreview?: boolean;
  isDefault?: boolean;
  upgrade?: string | null;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
  inputModalities?: string[];
};

export type ReasoningEffortOption = {
  value: string;
  label: string;
  description?: string | null;
};

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_CODEX_MODEL = 'gpt-5.5';

export const CLAUDE_AGENT_SDK_REASONING_EFFORTS: ReasoningEffortOption[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];

const CODEX_FALLBACK_REASONING_EFFORTS: ReasoningEffortOption[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

const CODEX_APP_SERVER_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export const CLAUDE_MODELS: ModelOption[] = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6 (legacy)' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5 (legacy)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (legacy)' },
];

export const CODEX_MODELS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier Codex model for complex coding, research, and real-world work.' },
  { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong Codex model for everyday coding.' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Small, fast, cost-efficient Codex model for simpler coding tasks.' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Coding-optimized Codex model.' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', description: 'Ultra-fast Codex research preview model.', researchPreview: true },
  { value: 'gpt-5.2', label: 'GPT-5.2', description: 'Optimized for professional work and long-running agents.' },
  { value: 'gpt-5-codex', label: 'GPT-5 Codex (deprecated)', deprecated: true },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (deprecated)', deprecated: true },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max (deprecated)', deprecated: true },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex (deprecated)', deprecated: true },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini (deprecated)', deprecated: true },
  { value: 'gpt-5.1', label: 'GPT-5.1 (legacy)', deprecated: true },
  { value: 'gpt-5', label: 'GPT-5 (legacy)', deprecated: true },
  { value: 'codex-mini-latest', label: 'Codex Mini Latest (deprecated)', deprecated: true },
];

export function labelForModel(options: ModelOption[], value: string | null | undefined): string {
  if (!value) return '';
  return options.find((option) => option.value === value)?.label || value;
}

export type CodexCatalogModelLike = {
  id: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string | null }>;
  defaultReasoningEffort?: string | null;
  inputModalities?: string[];
  isDefault?: boolean;
  upgrade?: string | null;
};

function optionFromCatalog(model: CodexCatalogModelLike): ModelOption {
  const fallback = CODEX_MODELS.find(option => option.value === model.id);
  return {
    value: model.id,
    label: model.displayName || fallback?.label || model.id,
    description: model.description || fallback?.description,
    hidden: model.hidden,
    deprecated: fallback?.deprecated,
    researchPreview: fallback?.researchPreview || model.id.includes('spark'),
    isDefault: model.isDefault,
    upgrade: model.upgrade,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts?.map(effort => effort.reasoningEffort),
    inputModalities: model.inputModalities,
  };
}

export function codexReasoningEffortOptions(model?: ModelOption | null): ReasoningEffortOption[] {
  const efforts = model?.supportedReasoningEfforts?.length
    ? model.supportedReasoningEfforts
    : CODEX_FALLBACK_REASONING_EFFORTS.map(effort => effort.value);
  const options = efforts
    .filter(effort => CODEX_APP_SERVER_REASONING_EFFORTS.has(effort))
    .map(effort => ({
      value: effort,
      label: effort,
      description: model?.defaultReasoningEffort === effort ? 'default' : null,
    }));
  return options.length > 0 ? options : CODEX_FALLBACK_REASONING_EFFORTS;
}

export function reasoningEffortIsSupported(options: ReasoningEffortOption[], value: string | null | undefined): value is string {
  return !!value && options.some(option => option.value === value);
}

export function reasoningEffortLabel(options: ReasoningEffortOption[], value: string | null | undefined): string {
  if (!value) return 'auto';
  return options.find(option => option.value === value)?.label || value;
}

export function codexModelsForAuth(method?: string, currentValue?: string | null, catalog?: CodexCatalogModelLike[] | null): ModelOption[] {
  const visible = catalog?.length
    ? catalog
      .filter(model => !model.hidden || model.id === currentValue)
      .map(optionFromCatalog)
    : method === 'api_key'
      ? CODEX_MODELS
      : CODEX_MODELS.filter((option) => !option.requiresApiKey);

  if (currentValue && !visible.some((option) => option.value === currentValue)) {
    const current = CODEX_MODELS.find((option) => option.value === currentValue);
    if (current) return [...visible, current];
  }

  return visible;
}
