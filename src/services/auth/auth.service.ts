import UserModel from '../../models/users/user.model';
import { IUser } from '../../types/user.type';

export const syncUserWithKeycloak = async (tokenPayload: any): Promise<IUser> => {
  const keycloakSub = tokenPayload.sub;
  const email = tokenPayload.email;
  // Keycloak thường trả về name hoặc preferred_username
  const displayName = tokenPayload.name || tokenPayload.preferred_username || email.split('@')[0]; 

  if (!keycloakSub || !email) {
    throw new Error('Token payload is missing required fields (sub, email)');
  }

  let user = await UserModel.findOne({ keycloakSub });

  if (!user) {
    // Tạo user mới nếu chưa tồn tại
    user = await UserModel.create({
      keycloakSub,
      email,
      displayName,
      lastLoginAt: new Date(),
    });
  } else {
    // Cập nhật last login và các thông tin cơ bản có thể bị thay đổi trên Keycloak
    user.lastLoginAt = new Date();
    user.email = email;
    user.displayName = displayName;
    await user.save();
  }

  return user;
};
