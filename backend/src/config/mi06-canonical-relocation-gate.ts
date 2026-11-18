/** Canonical relocation is opt-in, requires the stock ledger gate, and is always off in production. */
export function resolveMi06CanonicalRelocationGate(nodeEnv: string, configuredValue?: string): boolean {
  return nodeEnv !== 'production' && configuredValue?.trim().toLowerCase() === 'true';
}
