import { describe, expect, it } from 'vitest';
import { CLAUDE_AGENT_SDK_REASONING_EFFORTS, CLAUDE_MODELS, claudeModelsFromCatalog, claudeReasoningEffortOptions } from './modelCatalog';

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

// rows as supportedModels() returned them on cli 2.1.325 (aliases first, then exact ids)
const CATALOG = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', supportedEffortLevels: ALL, supportsFastMode: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportedEffortLevels: ALL },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
];

describe('claudeModelsFromCatalog', () => {
  it('keys rows on the exact model id and drops the default row', () => {
    const ids = claudeModelsFromCatalog(CATALOG).map(o => o.value);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-6']);
  });

  it('keeps fast mode support and per-model effort levels', () => {
    const options = claudeModelsFromCatalog(CATALOG);
    expect(options.find(o => o.value === 'claude-fable-5-2')?.supportsFastMode).toBe(true);
    expect(options.find(o => o.value === 'claude-sonnet-5-5')?.supportsFastMode).toBe(false);
    const opus46 = options.find(o => o.value === 'claude-opus-4-6');
    expect(claudeReasoningEffortOptions(opus46).map(e => e.value)).toEqual(['low', 'medium', 'high', 'max']);
    const haiku45 = options.find(o => o.value === 'claude-haiku-4-5-20251001');
    expect(claudeReasoningEffortOptions(haiku45)).toEqual([]);
  });

  it('uses our label and description for known ids', () => {
    const fable = claudeModelsFromCatalog(CATALOG).find(o => o.value === 'claude-fable-5-2');
    const known = CLAUDE_MODELS.find(o => o.value === 'claude-fable-5-2');
    expect(fable?.label).toBe(known?.label);
    expect(fable?.description).toBe(known?.description);
  });

  it('keeps the chat model visible when the account no longer lists it', () => {
    const ids = claudeModelsFromCatalog(CATALOG, 'claude-fable-5-1').map(o => o.value);
    expect(ids).toContain('claude-fable-5-1');
  });

  it('falls back to the static list with every effort level when there is no catalog', () => {
    expect(claudeModelsFromCatalog(null)).toBe(CLAUDE_MODELS);
    expect(claudeReasoningEffortOptions(CLAUDE_MODELS[0])).toBe(CLAUDE_AGENT_SDK_REASONING_EFFORTS);
  });
});
