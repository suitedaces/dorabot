export type ModelOption = {
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
  supportsFastMode?: boolean;
  fastModeDescription?: string;
};

export type ReasoningEffortOption = {
  value: string;
  label: string;
  description?: string | null;
};

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const DEFAULT_CODEX_MODEL = 'gpt-6.1-sol';

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

const CODEX_APP_SERVER_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

// offline fallbacks only (signed out, gateway down). the pickers use the sdk lists; text copied from them.
export const CLAUDE_MODELS: ModelOption[] = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5', description: 'For complex work and everyday tasks', isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], supportsFastMode: true },
  { value: 'claude-fable-5-2', label: 'Fable 5.2', description: 'For your toughest challenges', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], supportsFastMode: true },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', description: 'Most efficient for simpler tasks', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5', description: 'Fastest for quick answers', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

export const CODEX_MODELS: ModelOption[] = [
  { value: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model for coding and everyday work.', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { value: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'GPT-6.1 Terra Codex model.', defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { value: 'gpt-6-sol', label: 'GPT-6-Sol', description: 'Previous generation workhorse model.', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { value: 'gpt-6-luna', label: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
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
  isDefault?: boolean;
  serviceTiers?: Array<{ id: string; name?: string; description?: string }>;
};

function optionFromCodexCatalog(model: CodexCatalogModelLike): ModelOption {
  const fast = model.serviceTiers?.find(t => t.name?.toLowerCase() === 'fast');
  return {
    value: model.id,
    label: model.displayName || model.id,
    description: model.description,
    isDefault: model.isDefault,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts?.map(effort => effort.reasoningEffort),
    supportsFastMode: !!fast,
    ...(fast?.description ? { fastModeDescription: fast.description } : {}),
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

// codex's own picker list: everything it does not mark hidden
export function codexModelsFromCatalog(catalog: CodexCatalogModelLike[] | null | undefined, currentValue?: string | null): ModelOption[] {
  if (!catalog?.length) return CODEX_MODELS;
  const options = catalog
    .filter(model => !model.hidden || model.id === currentValue)
    .map(optionFromCodexCatalog);
  if (currentValue && !options.some(option => option.value === currentValue)) {
    options.push({ value: currentValue, label: currentValue });
  }
  return options;
}

export type ClaudeCatalogModelLike = {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description?: string;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
};

function optionFromClaudeCatalog(row: ClaudeCatalogModelLike, id: string, isDefault: boolean): ModelOption {
  return {
    value: id,
    label: row.displayName,
    description: row.description,
    isDefault,
    supportedReasoningEfforts: row.supportedEffortLevels ?? [],
    supportsFastMode: !!row.supportsFastMode,
  };
}

// the sdk lists family aliases (opus, fable, sonnet, haiku) that point at each family's current
// model, then every exact id it still accepts. the picker shows the alias targets, keyed on the
// exact id since chats pin exact ids. an older model only shows while a chat is on it.
export function claudeModelsFromCatalog(catalog: ClaudeCatalogModelLike[] | null | undefined, currentValue?: string | null): ModelOption[] {
  if (!catalog?.length) return CLAUDE_MODELS;
  const defaultId = catalog.find(row => row.value === 'default')?.resolvedModel;
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const row of catalog) {
    if (row.value === 'default' || !row.resolvedModel || row.resolvedModel === row.value) continue;
    if (seen.has(row.resolvedModel)) continue;
    seen.add(row.resolvedModel);
    options.push(optionFromClaudeCatalog(row, row.resolvedModel, row.resolvedModel === defaultId));
  }
  if (currentValue && !seen.has(currentValue)) {
    const exact = catalog.find(row => (row.resolvedModel || row.value) === currentValue);
    options.push(exact ? optionFromClaudeCatalog(exact, currentValue, false) : { value: currentValue, label: currentValue });
  }
  return options;
}

// no catalog (offline, signed out): offer every level and let the cli clamp
export function claudeReasoningEffortOptions(model?: ModelOption | null): ReasoningEffortOption[] {
  if (!model?.supportedReasoningEfforts) return CLAUDE_AGENT_SDK_REASONING_EFFORTS;
  return CLAUDE_AGENT_SDK_REASONING_EFFORTS.filter(effort => model.supportedReasoningEfforts!.includes(effort.value));
}
