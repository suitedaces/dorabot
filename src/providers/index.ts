import type { Provider } from './types.js';
import type { Config } from '../config.js';
import { ClaudeProvider } from './claude.js';

export type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

// Singleton instances per provider
const providers = new Map<string, Provider>();

export async function getProvider(config: Config): Promise<Provider> {
  const name = config.provider?.name || 'claude';
  return getProviderByName(name);
}

export async function getProviderByName(name: string): Promise<Provider> {
  if (!providers.has(name)) {
    switch (name) {
      case 'claude':
        providers.set(name, new ClaudeProvider());
        break;
      case 'codex': {
        // Dynamic import to avoid loading codex deps when not needed
        const { CodexProvider } = await import('./codex.js');
        providers.set(name, new CodexProvider());
        break;
      }
      case 'openai-compatible': {
        const { OpenAICompatibleProvider } = await import('./openai-compatible.js');
        providers.set(name, new OpenAICompatibleProvider());
        break;
      }
      default:
        throw new Error(`Unknown provider: ${name}. Supported: claude, codex, openai-compatible`);
    }
  }
  return providers.get(name)!;
}

export async function disposeAllProviders(): Promise<void> {
  for (const provider of providers.values()) {
    await provider.dispose?.();
  }
  providers.clear();
}
