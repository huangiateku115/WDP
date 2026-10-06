import { env } from '../../config/env';
import UserModel from '../../models/users/user.model';
import { OtpModel } from '../../models/auth/otp.model';
import { EmailService } from '../email/email.service';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { keycloakConfig } from '../../config/keycloak.config';

const JWKS = createRemoteJWKSet(new URL(keycloakConfig.jwksUri));

export class AuthService {
  static async login(email: string, password: string) {
    const KC_TOKEN_URL = `${env.keycloak.baseUrl}/realms/${env.keycloak.realm}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('client_id', env.keycloak.clientId);
    params.append('client_secret', env.keycloak.clientSecret);
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
    const KC_LOGOUT_URL = `${env.keycloak.baseUrl}/realms/${env.keycloak.realm}/protocol/openid-connect/logout`;
    const params = new URLSearchParams();
    params.append('client_id', env.keycloak.clientId);
    params.append('client_secret', env.keycloak.clientSecret);
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

  static async forgotPassword(email: string) {
    const user = await UserModel.findOne({ email });
    if (!user) {
      throw new Error('Email không tồn tại trong hệ thống');
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Upsert OTP (Nếu đã có OTP cũ thì đè lên, TTL sẽ tự reset)
    await OtpModel.findOneAndUpdate(
      { email },
      { otp, createdAt: new Date() },
      { upsert: true, returnDocument: 'after' }
    );

    // Send email
    await EmailService.sendOtpEmail(email, otp);
  }

  static async getAdminToken() {
    const KC_TOKEN_URL = `${process.env.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('client_id', 'admin-cli');
    params.append('username', process.env.KEYCLOAK_ADMIN_USERNAME || 'admin');
    params.append('password', process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin');
    params.append('grant_type', 'password');

    const response = await fetch(KC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error('Không thể lấy Admin Token');
    }

    const data = await response.json();
    return data.access_token;
  }

  static async resetPassword(email: string, otp: string, newPassword: string) {
    // 1. Verify OTP
    const otpRecord = await OtpModel.findOne({ email, otp });
    if (!otpRecord) {
      throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn');
    }

    // 2. Get User
    const user = await UserModel.findOne({ email });
    if (!user) {
      throw new Error('Không tìm thấy người dùng');
    }

    // 3. Reset password in Keycloak
    const adminToken = await this.getAdminToken();
    const KC_RESET_PW_URL = `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${user.keycloakSub}/reset-password`;

    const response = await fetch(KC_RESET_PW_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        type: 'password',
        value: newPassword,
        temporary: false
      })
    });

    if (!response.ok) {
      throw new Error('Cập nhật mật khẩu thất bại trên Keycloak');
    }

    // 4. Xóa OTP sau khi thành công
    await OtpModel.deleteOne({ _id: otpRecord._id });
  }
}
