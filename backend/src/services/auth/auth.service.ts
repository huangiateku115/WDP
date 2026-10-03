import UserModel from '../../models/users/user.model';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { keycloakConfig } from '../../config/keycloak.config';

const JWKS = createRemoteJWKSet(new URL(keycloakConfig.jwksUri));

export class AuthService {
  static async login(email: string, password: string) {
    const KC_TOKEN_URL = `${process.env.KEYCLOAK_BASE_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'wdp-backend');
    params.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET || '');
    params.append('grant_type', 'password');
    params.append('username', email);
    params.append('password', password);

    const response = await fetch(KC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error('Sai email hoặc mật khẩu');
    }

    const data = await response.json();
    const token = data.access_token;

    // Lấy sub từ token
    const { payload } = await jwtVerify(token, JWKS, { issuer: keycloakConfig.issuer });
    const sub = payload.sub as string;

    // Kiểm tra DB
    const user = await UserModel.findOne({ keycloakSub: sub });
    if (!user) {
      throw new Error('Tài khoản chưa được đăng ký trong hệ thống nội bộ');
    }
    if (!user.isActive) {
      throw new Error('Tài khoản đã bị khóa');
    }

    user.lastLoginAt = new Date();
    await user.save();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user
    };
  }

  static async logout(refreshToken: string) {
    const KC_LOGOUT_URL = `${process.env.KEYCLOAK_BASE_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/logout`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'wdp-backend');
    params.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET || '');
    params.append('refresh_token', refreshToken);

    const response = await fetch(KC_LOGOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error('Đăng xuất thất bại');
    }
  }
}
