import nodemailer from 'nodemailer';

export class EmailService {
  private static getTransporter() {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }

  static async sendOtpEmail(toEmail: string, otpCode: string): Promise<void> {
    const mailOptions = {
      from: `"Skibidi tolet xin chào tung tung sahur siêu bá khí" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: 'Yêu cầu khôi phục mật khẩu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #333; text-align: center;">Khôi phục mật khẩu</h2>
          <p style="color: #555; font-size: 16px;">Chào bạn,</p>
          <p style="color: #555; font-size: 16px;">Bạn vừa yêu cầu khôi phục mật khẩu. Vui lòng sử dụng mã OTP dưới đây để tiếp tục:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; padding: 15px 30px; background-color: #f4f4f4; color: #333; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 4px;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #555; font-size: 14px;">Mã OTP này sẽ tự động hết hạn sau <strong>5 phút</strong>.</p>
          <p style="color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">Nếu bạn không yêu cầu đổi mật khẩu, vui lòng bỏ qua email này. Tuyệt đối không cung cấp mã này cho bất kỳ ai.</p>
        </div>
      `,
    };

    try {
      const transporter = this.getTransporter();
      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Lỗi khi gửi email:', error);
      throw new Error('Hệ thống không thể gửi email lúc này. Vui lòng thử lại sau.');
    }
  }
}
