import { env } from './env';

export const keycloakConfig = {
  issuer: env.keycloak.issuer,
  jwksUri: env.keycloak.jwksUri,
  clientId: env.keycloak.clientId,
};
