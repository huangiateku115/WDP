/**
 * Resolves the MI-06B repeated-inbound gate without coupling it to MI-06A ledger writes.
 * Production is always forced off; callers must still keep operational routes unwired
 * until a separately approved rollout.
 */
export function resolveMi06BRepeatedInboundGate(nodeEnv: string, configuredValue?: string): boolean {
  if (nodeEnv === 'production') return false;
  return configuredValue?.trim().toLowerCase() === 'true';
}
