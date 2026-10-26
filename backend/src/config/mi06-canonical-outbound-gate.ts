/** New canonical outbound holds remain opt-in and are always disabled in production. */
export function resolveMi06CanonicalOutboundGate(nodeEnv: string, configuredValue?: string): boolean {
  if (nodeEnv === 'production') return false;
  return configuredValue?.trim().toLowerCase() === 'true';
}

/** Canonical confirmation is separately gated so pending holds have no legacy stock-writing fallback. */
export function resolveMi06CanonicalOutboundConfirmationGate(nodeEnv: string, configuredValue?: string): boolean {
  if (nodeEnv === 'production') return false;
  return configuredValue?.trim().toLowerCase() === 'true';
}
