import dotenv from 'dotenv';
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
    keycloak: {
      baseUrl, realm, issuer,
      jwksUri: httpUrl('KEYCLOAK_JWKS_URI', process.env.KEYCLOAK_JWKS_URI || `${issuer}/protocol/openid-connect/certs`),
      clientId: process.env.KEYCLOAK_CLIENT_ID?.trim() || 'wdp-backend',
      clientSecret: required('KEYCLOAK_CLIENT_SECRET'),
    },
  };
}
export const env = loadEnvironment();
