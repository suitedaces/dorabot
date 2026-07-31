import type { Provider } from './types.js';
import type { Config, ProviderName } from '../config.js';
import { PROVIDER_NAMES } from '../config.js';
import { ClaudeProvider } from './claude.js';

export type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

// Singleton instances per provider
const providers = new Map<string, Provider>();

export async function getProvider(config: Config): Promise<Provider> {
  const name = config.provider?.name || 'claude';
  return getProviderByName(name);
}

export async function getProviderByName(requested: string): Promise<Provider> {
  // Fall back rather than throw. A config naming a provider that does not exist
  // used to make every run fail with "Unknown provider" and there was no way to
  // correct it from inside the app, because changing the setting also needs a
  // working run. Stored configs can still name providers that were removed, so
  // this has to degrade to something usable.
  let name: ProviderName = 'claude';
  if ((PROVIDER_NAMES as readonly string[]).includes(requested)) {
    name = requested as ProviderName;
  } else {
    console.error(`[provider] unknown provider "${requested}", falling back to claude`);
  }

  if (!providers.has(name)) {
    if (name === 'codex') {
      // Dynamic import to avoid loading codex deps when not needed
      const { CodexProvider } = await import('./codex.js');
      providers.set(name, new CodexProvider());
    } else {
      providers.set(name, new ClaudeProvider());
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
