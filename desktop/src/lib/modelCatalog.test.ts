import { describe, expect, it } from 'vitest';
import {
  CLAUDE_AGENT_SDK_REASONING_EFFORTS,
  CLAUDE_MODELS,
  CODEX_MODELS,
  claudeModelsFromCatalog,
  claudeReasoningEffortOptions,
  codexModelsFromCatalog,
  codexReasoningEffortOptions,
} from './modelCatalog';

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

// rows as supportedModels() returned them on cli 2.1.325 (aliases first, then exact ids)
const CATALOG = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', description: 'For your toughest challenges', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportedEffortLevels: ALL },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportedEffortLevels: ALL },
  { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', supportedEffortLevels: ALL },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
];

describe('claudeModelsFromCatalog', () => {
  it('shows the current model of each family, keyed on the exact id', () => {
    const ids = claudeModelsFromCatalog(CATALOG).map(o => o.value);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  });

  it('takes label, description and the default flag from the sdk', () => {
    const options = claudeModelsFromCatalog(CATALOG);
    const fable = options.find(o => o.value === 'claude-fable-5-2');
    expect(fable?.label).toBe('Fable 5.2');
    expect(fable?.description).toBe('For your toughest challenges');
    expect(options.filter(o => o.isDefault).map(o => o.value)).toEqual(['claude-opus-5-5']);
  });

  it('keeps fast mode support and per-model effort levels', () => {
    const options = claudeModelsFromCatalog(CATALOG);
    expect(options.find(o => o.value === 'claude-fable-5-2')?.supportsFastMode).toBe(true);
    expect(options.find(o => o.value === 'claude-sonnet-5-5')?.supportsFastMode).toBe(false);
    const opus46 = claudeModelsFromCatalog(CATALOG, 'claude-opus-4-6').find(o => o.value === 'claude-opus-4-6');
    expect(claudeReasoningEffortOptions(opus46).map(e => e.value)).toEqual(['low', 'medium', 'high', 'max']);
    const haiku45 = claudeModelsFromCatalog(CATALOG, 'claude-haiku-4-5-20251001').find(o => o.value === 'claude-haiku-4-5-20251001');
    expect(claudeReasoningEffortOptions(haiku45)).toEqual([]);
  });

  it('keeps an older chat model visible while the chat is on it', () => {
    const options = claudeModelsFromCatalog(CATALOG, 'claude-fable-5-1');
    expect(options.find(o => o.value === 'claude-fable-5-1')?.label).toBe('Fable 5.1');
    expect(claudeModelsFromCatalog(CATALOG, 'claude-gone-1').map(o => o.value)).toContain('claude-gone-1');
  });

  it('falls back to the static list with every effort level when there is no catalog', () => {
    expect(claudeModelsFromCatalog(null)).toBe(CLAUDE_MODELS);
    expect(claudeReasoningEffortOptions({ value: 'x', label: 'x' })).toBe(CLAUDE_AGENT_SDK_REASONING_EFFORTS);
  });
});

// rows as model/list returned them on codex 0.169.0
const CODEX_CATALOG = [
  {
    id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', description: 'Latest workhorse model for coding and everyday work.', isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffort => ({ reasoningEffort })),
    serviceTiers: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }],
  },
  { id: 'gpt-reserve', displayName: 'GPT-Reserve', hidden: true },
  { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', supportedReasoningEfforts: ALL.map(reasoningEffort => ({ reasoningEffort })) },
];

describe('codexModelsFromCatalog', () => {
  it('lists what codex does not hide, with its own labels', () => {
    const options = codexModelsFromCatalog(CODEX_CATALOG);
    expect(options.map(o => o.value)).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
    expect(options[0].label).toBe('GPT-6.1-Sol');
    expect(options[0].isDefault).toBe(true);
  });

  it('turns the Fast service tier into fast mode support', () => {
    const [sol, luna] = codexModelsFromCatalog(CODEX_CATALOG);
    expect(sol.supportsFastMode).toBe(true);
    expect(sol.fastModeDescription).toBe('2x speed, increased usage');
    expect(luna.supportsFastMode).toBe(false);
  });

  it('keeps the configured model visible when codex no longer lists it', () => {
    expect(codexModelsFromCatalog(CODEX_CATALOG, 'gpt-5.6-luna').map(o => o.value)).toContain('gpt-5.6-luna');
    expect(codexModelsFromCatalog(CODEX_CATALOG, 'gpt-reserve').map(o => o.value)).toContain('gpt-reserve');
  });

  it('uses per-model effort levels', () => {
    const [sol, luna] = codexModelsFromCatalog(CODEX_CATALOG);
    expect(codexReasoningEffortOptions(sol).map(e => e.value)).toContain('ultra');
    expect(codexReasoningEffortOptions(luna).map(e => e.value)).not.toContain('ultra');
  });

  it('falls back to the static list when there is no catalog', () => {
    expect(codexModelsFromCatalog(null)).toBe(CODEX_MODELS);
  });
});
