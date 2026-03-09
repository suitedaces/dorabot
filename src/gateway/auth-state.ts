import type { ProviderName } from '../config.js';
import type { ProviderAuthStatus } from '../providers/types.js';

export type ProviderAuthGate = {
  providerName: ProviderName;
  method: 'api_key' | 'oauth' | 'none';
  expired: boolean;
  reconnectRequired: boolean;
  authenticated: boolean;
  error?: string;
};

export type AuthRecoveryAction = 'retry' | 'reauth' | 'error';

export function buildProviderAuthGate(providerName: ProviderName, status: ProviderAuthStatus): ProviderAuthGate {
  return {
    providerName,
    method: status.authenticated ? (status.method || 'none') : 'none',
    expired: status.reconnectRequired === true || status.tokenHealth === 'expired',
    reconnectRequired: status.reconnectRequired === true,
    authenticated: status.authenticated,
    error: status.error,
  };
}

export function classifyAuthRecovery(gate: ProviderAuthGate): AuthRecoveryAction {
  if (gate.authenticated) return 'retry';
  if (gate.reconnectRequired) return 'reauth';
  return 'error';
}
