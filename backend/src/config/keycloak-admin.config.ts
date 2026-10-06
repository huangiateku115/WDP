import KcAdminClient from '@keycloak/keycloak-admin-client';
import { env } from './env';

export const kcAdminClient = new KcAdminClient({
  baseUrl: env.keycloak.baseUrl,
  realmName: env.keycloak.realm,
});

export const authKeycloakAdmin = async () => {
  try {
    await kcAdminClient.auth({
      grantType: 'client_credentials',
      clientId: env.keycloak.clientId,
      clientSecret: env.keycloak.clientSecret,
    });
    console.log('Authenticated with Keycloak Admin API successfully');
  } catch (error) {
    console.error('Failed to authenticate with Keycloak Admin API');
    throw error;
  }
};
