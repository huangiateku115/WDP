import { kcAdminClient, authKeycloakAdmin } from '../config/keycloak-admin.config';

export class KeycloakService {
  /**
   * Tạo User trên Keycloak
   */
  static async createUser(email: string, displayName: string, password?: string): Promise<string> {
    await authKeycloakAdmin();

    const nameParts = displayName.trim().split(' ');
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : displayName;
    const lastName = nameParts.length > 1 ? (nameParts[nameParts.length - 1] as string) : '.';
    
    const userPayload: any = {
      username: email,
      email: email,
      firstName: firstName,
      lastName: lastName,
      enabled: true,
      emailVerified: true,
    };

    if (password) {
      userPayload.credentials = [{
        type: 'password',
        value: password,
        temporary: false
      }];
    }

    const createdUser = await kcAdminClient.users.create(userPayload);
    return createdUser.id;
  }

  /**
   * Cập nhật thông tin chung trên Keycloak
   */
  static async updateUser(id: string, displayName: string, email: string) {
    await authKeycloakAdmin();
    const nameParts = displayName.trim().split(' ');
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : displayName;
    const lastName = nameParts.length > 1 ? (nameParts[nameParts.length - 1] as string) : '.';

    await kcAdminClient.users.update(
      { id },
      { firstName, lastName, email }
    );
  }

  /**
   * Vô hiệu hóa tài khoản (Soft Delete)
   */
  static async disableUser(id: string) {
    await authKeycloakAdmin();
    await kcAdminClient.users.update(
      { id },
      { enabled: false }
    );
  }

  /**
   * Kích hoạt lại tài khoản (Mở khóa)
   */
  static async enableUser(id: string) {
    await authKeycloakAdmin();
    await kcAdminClient.users.update(
      { id },
      { enabled: true }
    );
  }

  /**
   * Đổi mật khẩu (Admin ép đổi)
   */
  static async resetPasswordAdmin(id: string, newPassword: string) {
    await authKeycloakAdmin();
    await kcAdminClient.users.resetPassword({
      id,
      credential: {
        type: 'password',
        value: newPassword,
        temporary: false,
      },
    });
  }

  /**
   * Xóa tài khoản (Xóa cứng - Dùng cho Rollback)
   */
  static async deleteUser(id: string) {
    await authKeycloakAdmin();
    await kcAdminClient.users.del({ id });
  }
}
