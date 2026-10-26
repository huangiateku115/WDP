import dotenv from 'dotenv';
import { resolveMi06BRepeatedInboundGate } from './mi06b-feature-gate';
import { resolveMi06CanonicalOutboundConfirmationGate, resolveMi06CanonicalOutboundGate } from './mi06-canonical-outbound-gate';
import { resolveMi06CanonicalRelocationGate } from './mi06-canonical-relocation-gate';
dotenv.config({ quiet: true });

export class ConfigurationError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required`);
  return value;
}

function httpUrl(name: string, value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return value;
  } catch {
    throw new ConfigurationError(`${name} must be a valid HTTP(S) URL without credentials`);
  }
}

function loadEnvironment() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('PORT must be an integer from 1 to 65535');
  }
  const mongoUrl = required('MONGO_URL');
  if (!/^mongodb(?:\+srv)?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(mongoUrl)) {
    throw new ConfigurationError('MONGO_URL must be a valid MongoDB connection URI');
  }
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new ConfigurationError('NODE_ENV must be development, test, or production');
  }
  const baseUrl = httpUrl('KEYCLOAK_BASE_URL', required('KEYCLOAK_BASE_URL')).replace(/\/$/, '');
  const corsOrigins = (process.env.CORS_ORIGINS ?? (nodeEnv === 'development'
    ? 'http://localhost:5173,http://127.0.0.1:5173' : '')).split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    httpUrl('CORS_ORIGINS', origin);
    if (new URL(origin).origin !== origin) throw new ConfigurationError('CORS_ORIGINS must contain origins without paths or trailing slashes');
  }
  const realm = process.env.KEYCLOAK_REALM?.trim() || 'wdp-realm';
  const issuer = httpUrl('KEYCLOAK_ISSUER', process.env.KEYCLOAK_ISSUER || `${baseUrl}/realms/${realm}`);
  return {
    port, mongoUrl, nodeEnv, corsOrigins,
    // MI-06 ledger writes remain explicitly opt-in and are never enabled in production in this phase.
    mi06StockLedgerWritesEnabled: nodeEnv !== 'production' && process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() === 'true',
    // MI-06B repeated inbound is an independent, non-operational foundation gate.
    mi06RepeatedInboundEnabled: resolveMi06BRepeatedInboundGate(nodeEnv, process.env.MI06_REPEATED_INBOUND_ENABLED),
    // Canonical outbound request/hold writes are independently gated and require the stock write gate too.
    mi06CanonicalOutboundRequestsEnabled: resolveMi06CanonicalOutboundGate(nodeEnv, process.env.MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED) &&
      nodeEnv !== 'production' && process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() === 'true',
    // Canonical outbound confirmation is independent and opt-in; never active in production.
    mi06CanonicalOutboundConfirmationsEnabled: resolveMi06CanonicalOutboundConfirmationGate(nodeEnv, process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED) &&
      nodeEnv !== 'production' && process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() === 'true',
    // Canonical relocation is independently opt-in and remains forced off in production.
    mi06CanonicalRelocationsEnabled: resolveMi06CanonicalRelocationGate(nodeEnv, process.env.MI06_CANONICAL_RELOCATIONS_ENABLED) &&
      nodeEnv !== 'production' && process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() === 'true',
    keycloak: {
      baseUrl, realm, issuer,
      jwksUri: httpUrl('KEYCLOAK_JWKS_URI', process.env.KEYCLOAK_JWKS_URI || `${issuer}/protocol/openid-connect/certs`),
      clientId: process.env.KEYCLOAK_CLIENT_ID?.trim() || 'wdp-backend',
      clientSecret: required('KEYCLOAK_CLIENT_SECRET'),
    },
  };
}
export const env = loadEnvironment();
