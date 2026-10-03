import { Request, Response, NextFunction } from 'express';
import { UserService } from '../../services/users/user.service';

export const registerCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, phone } = req.body;
    const user = await UserService.registerCustomer(email, password, displayName, phone);
    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  res.status(200).json({ success: true, data: req.user });
};

export const updateMyProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { displayName, phone } = req.body;
    const user = await UserService.updateMyProfile((req.user as any).keycloakSub, displayName, phone);
    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const changeMyPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    await UserService.changeMyPassword((req.user as any).keycloakSub, (req.user as any).email, oldPassword, newPassword);
    res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminCreateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, role, phone } = req.body;
    const user = await UserService.adminCreateUser(email, password, displayName, role, phone);
    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    if (error.message.includes('ADMIN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminUpdateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { displayName, phone, email } = req.body;
    const user = await UserService.adminUpdateUser(id, displayName, phone, email);
    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminUpdateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { role } = req.body;
    const user = await UserService.adminUpdateRole(id, role);
    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    if (error.message.includes('ADMIN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminSoftDelete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = await UserService.adminSoftDelete(id);
    res.status(200).json({ success: true, message: 'Đã khóa tài khoản thành công', data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminGetUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await UserService.adminGetUsers();
    res.status(200).json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
