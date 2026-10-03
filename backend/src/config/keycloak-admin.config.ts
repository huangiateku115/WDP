import KcAdminClient from '@keycloak/keycloak-admin-client';
import dotenv from 'dotenv';

dotenv.config();

const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL || '';
const keycloakRealm = process.env.KEYCLOAK_REALM || 'wdp-realm';
const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID || 'wdp-backend';
const keycloakClientSecret = process.env.KEYCLOAK_CLIENT_SECRET || '';

// Khởi tạo instance của Keycloak Admin Client
export const kcAdminClient = new KcAdminClient({
  baseUrl: keycloakBaseUrl,
  realmName: keycloakRealm,
});

// Hàm xác thực (Lấy Token Server-to-Server)
export const authKeycloakAdmin = async () => {
  try {
    await kcAdminClient.auth({
      grantType: 'client_credentials',
      clientId: keycloakClientId,
      clientSecret: keycloakClientSecret,
    });
    console.log('✅ Authenticated with Keycloak Admin API successfully!');
  } catch (error) {
    console.error('❌ Failed to authenticate with Keycloak Admin API:', error);
    throw error;
  }
};
