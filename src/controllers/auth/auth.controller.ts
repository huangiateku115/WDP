import { Request, Response } from 'express';
import { AuthService } from '../../services/auth/auth.service';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Vui lòng cung cấp email và password' });
      return;
    }

    const result = await AuthService.login(email, password);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(401).json({ success: false, message: error.message });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, message: 'Vui lòng cung cấp refreshToken' });
      return;
    }

    await AuthService.logout(refreshToken);
    res.status(200).json({ success: true, message: 'Đăng xuất thành công' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
