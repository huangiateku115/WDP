import { randomUUID } from 'node:crypto';

function safeCode(error: any): string | undefined {
  const value = typeof error?.code === 'string' ? error.code : typeof error?.http_code === 'number' ? String(error.http_code) : undefined;
  const known = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAUTH', 'EENVELOPE', 'EMESSAGE', 'ECONNECTION', 'INVALID_RECIPIENT', 'PROVIDER_CONFIGURATION_MISSING']);
  return value && (known.has(value) || ['400', '401', '403', '404', '408', '429', '500', '502', '503', '504'].includes(value)) ? value : undefined;
}
function category(error: any): string {
  const name = String(error?.name ?? ''); const code = String(error?.code ?? '');
  if (/INVALID_RECIPIENT|VALIDATION/i.test(code)) return 'INPUT_VALIDATION';
  if (/CONFIGURATION_MISSING/i.test(code)) return 'CONFIGURATION';
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(`${name} ${code}`)) return 'TIMEOUT';
  if (/auth|credential|unauthor/i.test(`${name} ${code}`)) return 'PROVIDER_AUTH';
  if (/ECONN|ENOTFOUND|network|socket/i.test(`${name} ${code}`)) return 'NETWORK';
  if (error?.http_code || error?.statusCode) return 'PROVIDER_REJECTION';
  return 'OPERATION_FAILURE';
}

export function logOperationalFailure(input: { operation: string; stage: string; provider: string; error: unknown; correlationId?: string; retryable?: boolean; entityType?: string; entityId?: string; durationMs?: number }) {
  const error: any = input.error;
  const record = {
    event: 'OPERATIONAL_FAILURE', timestamp: new Date().toISOString(), correlationId: input.correlationId ?? randomUUID(),
    operation: input.operation, stage: input.stage, provider: input.provider,
    errorCategory: category(error), ...(safeCode(error) ? { errorCode: safeCode(error) } : {}),
    retryable: input.retryable ?? (category(error) === 'TIMEOUT' || category(error) === 'NETWORK'),
    ...(input.entityType ? { entityType: input.entityType } : {}), ...(input.entityId && /^[a-f\d]{24}$/i.test(input.entityId) ? { entityId: input.entityId } : {}),
    ...(Number.isFinite(input.durationMs) && input.durationMs! >= 0 ? { durationMs: Math.round(input.durationMs!) } : {}),
  };
  try { console.error(JSON.stringify(record)); } catch { /* diagnostics must never replace the operation's original result */ }
}
