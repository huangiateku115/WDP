import dotenv from 'dotenv';

dotenv.config();

export const keycloakConfig = {
  issuer: process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/wdp-realm',
  jwksUri: process.env.KEYCLOAK_JWKS_URI || 'http://localhost:8080/realms/wdp-realm/protocol/openid-connect/certs',
  clientId: process.env.KEYCLOAK_CLIENT_ID || 'wdp-backend',
};
