import { Request, Response } from 'express';
import { AuthService } from '../../services/auth/auth.service';
import { LoginHistoryService } from '../../services/audit/loginHistory.service';
import { LoginEventType, LoginStatus, LoginFailureReason } from '../../types/audit.type';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      LoginHistoryService.record(req, {
        attemptedEmail: email || 'UNKNOWN',
        eventType: LoginEventType.LOGIN,
        status: LoginStatus.FAILURE,
        failureReason: LoginFailureReason.WRONG_CREDENTIALS,
      });
      res.status(400).json({ success: false, message: 'Vui lòng cung cấp email và password' });
      return;
    }

    const result = await AuthService.login(email, password);
    
    // Đăng nhập thành công
    LoginHistoryService.record(req, {
      userId: result.user._id.toString(),
      attemptedEmail: email,
      eventType: LoginEventType.LOGIN,
      status: LoginStatus.SUCCESS,
    });
    
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    let failureReason = LoginFailureReason.SYSTEM_ERROR;
    if (error.message.includes('Sai email hoặc mật khẩu')) failureReason = LoginFailureReason.WRONG_CREDENTIALS;
    if (error.message.includes('Tài khoản đã bị khóa')) failureReason = LoginFailureReason.ACCOUNT_DISABLED;
    if (error.message.includes('chưa được đăng ký')) failureReason = LoginFailureReason.ACCOUNT_NOT_SYNCED;

    LoginHistoryService.record(req, {
      attemptedEmail: req.body?.email || 'UNKNOWN',
      eventType: LoginEventType.LOGIN,
      status: LoginStatus.FAILURE,
      failureReason,
    });

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

    // Ghi log (Nếu route có middleware requireAuth, ta có thể lấy req.user)
    const userId = (req as any).user?._id;
    LoginHistoryService.record(req, {
      userId,
      eventType: LoginEventType.LOGOUT,
      status: LoginStatus.SUCCESS,
    });

    res.status(200).json({ success: true, message: 'Đăng xuất thành công' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ success: false, message: 'Vui lòng cung cấp email' });
      return;
    }

    await AuthService.forgotPassword(email);
    res.status(200).json({ success: true, message: 'Mã OTP đã được gửi đến email của bạn' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      res.status(400).json({ success: false, message: 'Vui lòng cung cấp đầy đủ email, otp và newPassword' });
      return;
    }

    await AuthService.resetPassword(email, otp, newPassword);
    
    // Ghi log Audit: User đổi mật khẩu qua forgot-password
    // (Bởi vì lúc này user chưa đăng nhập nên không có req.user, ta phải log thủ công hoặc bỏ qua)
    // Để an toàn, ta tạm bỏ qua hoặc log bằng hệ thống LoginHistory
    LoginHistoryService.record(req, {
      attemptedEmail: email,
      eventType: LoginEventType.LOGIN,
      status: LoginStatus.SUCCESS, // Hack tí để mượn chỗ ghi log =))
    });

    res.status(200).json({ success: true, message: 'Khôi phục mật khẩu thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
