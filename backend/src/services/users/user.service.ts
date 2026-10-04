import { env } from '../../config/env';
import mongoose from 'mongoose';
import UserModel from '../../models/users/user.model';
import { UserRole } from '../../types/user.type';
import { KeycloakService } from '../keycloak.service';

export class UserService {
  // 1. PUBLIC: Đăng ký khách hàng mới
  static async registerCustomer(email: string, password: string, displayName: string, phone?: string) {
    // Kiểm tra trùng email trong hệ thống nội bộ trước cho nhanh
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) throw new Error('Email đã được sử dụng');

    // Gọi Keycloak tạo
    const keycloakSub = await KeycloakService.createUser(email, displayName, password);
    
    try {
      // Lưu vào Mongo
      const newUser = await UserModel.create({
        keycloakSub,
        email,
        displayName,
        phone: phone || '',
        role: UserRole.CUSTOMER, // Ép cứng role CUSTOMER
      });
      return newUser;
    } catch (error) {
      // Rollback nếu MongoDB lỗi
      await KeycloakService.deleteUser(keycloakSub);
      throw error;
    }
  }

  // 2. USER: Update Profile
  static async updateMyProfile(keycloakSub: string, displayName: string, phone: string) {
    const user = await UserModel.findOne({ keycloakSub });
    if (!user) throw new Error('User not found');
    
    user.displayName = displayName;
    if (phone) user.phone = phone;
    await user.save();

    // Đồng bộ sang keycloak
    await KeycloakService.updateUser(keycloakSub, displayName, user.email);

    return user;
  }

  // 3. USER: Change Password
  static async changeMyPassword(keycloakSub: string, email: string, oldPassword: string, newPassword: string) {
    // Thử lấy token để xác thực oldPassword
    const KC_TOKEN_URL = `${env.keycloak.baseUrl}/realms/${env.keycloak.realm}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('client_id', env.keycloak.clientId);
    params.append('client_secret', env.keycloak.clientSecret);
    params.append('grant_type', 'password');
    params.append('username', email);
    params.append('password', oldPassword);

    const response = await fetch(KC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error('Mật khẩu cũ không chính xác');
    }

    // Pass cũ chuẩn, gọi Admin API để set pass mới
    await KeycloakService.resetPasswordAdmin(keycloakSub, newPassword);
  }

  // 4. ADMIN: Create User
  static async adminCreateUser(email: string, password: string, displayName: string, role: UserRole, phone?: string) {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error(`Quyền (role) không hợp lệ. Các quyền hợp lệ: ${Object.values(UserRole).join(', ')}`);
    }
    if (role === UserRole.ADMIN) {
      throw new Error('Không được phép tạo tài khoản có quyền ADMIN');
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) throw new Error('Email đã được sử dụng');

    // Tạo bên Keycloak
    const keycloakSub = await KeycloakService.createUser(email, displayName, password);

    try {
      // Lưu Mongo
      const newUser = await UserModel.create({
        keycloakSub,
        email,
        displayName,
        phone: phone || '',
        role: role,
        assignedFacilityId: null // Tạm bỏ qua vì chưa có bảng Facility
      });
      return newUser;
    } catch (error) {
      // Rollback nếu MongoDB lỗi
      await KeycloakService.deleteUser(keycloakSub);
      throw error;
    }
  }

  // 5. ADMIN: Update User General
  static async adminUpdateUser(userId: string, displayName: string, phone: string, email: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new Error('ID tài khoản không hợp lệ');
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản');

    user.displayName = displayName;
    user.phone = phone;
    // Cập nhật Keycloak
    await KeycloakService.updateUser(user.keycloakSub, displayName, email);
    
    user.email = email;
    await user.save();
    return user;
  }

  // 6. ADMIN: Update Role
  static async adminUpdateRole(userId: string, newRole: UserRole) {
    if (!Object.values(UserRole).includes(newRole)) {
      throw new Error(`Quyền (role) không hợp lệ. Các quyền hợp lệ: ${Object.values(UserRole).join(', ')}`);
    }
    if (newRole === UserRole.ADMIN) {
      throw new Error('Cấm phân quyền ADMIN cho người khác');
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) throw new Error('ID tài khoản không hợp lệ');
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản');

    user.role = newRole;
    await user.save();
    return user;
  }

  // 7. ADMIN: Soft Delete
  static async adminSoftDelete(userId: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new Error('ID tài khoản không hợp lệ');
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản');

    user.isActive = false;
    await user.save();

    await KeycloakService.disableUser(user.keycloakSub);
    return user;
  }

  // 8. ADMIN: Get Users
  static async adminGetUsers() {
    return await UserModel.find({}).select('-__v');
  }
}
