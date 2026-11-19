import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import UserModel from '../../models/users/user.model';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { logOperationalFailure } from '../operations/operational-error.logger';
import { NotificationMethod, NotificationType } from '../../types/notification.type';
import { NotificationService } from '../notifications/notification.service';

const NON_DELIVERABLE_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'demo.com',
  'mailinator.com',
  'localhost',
]);

const NON_DELIVERABLE_TLDS = ['.test', '.local', '.invalid', '.example'];

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONDITION_LABELS: Record<string, string> = {
  GOOD: 'Sạch sẽ, nguyên vẹn',
  EXCELLENT: 'Hoàn hảo',
  NEEDS_CLEANING: 'Cần dọn vệ sinh',
  DAMAGED: 'Có hư hại kết cấu',
};

function formatDateVi(value?: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatDateTimeVi(value?: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatMoneyVi(amount?: number | null): string {
  const num = Number(amount || 0);
  return Number.isFinite(num) ? num.toLocaleString('vi-VN') : '0';
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatFacilityAddress(address: any): string {
  if (!address) return 'Theo địa chỉ cơ sở trên hệ thống';
  if (typeof address === 'string') return address.trim() || 'Theo địa chỉ cơ sở trên hệ thống';
  if (typeof address === 'object') {
    const parts = [address.line1, address.line2, address.ward, address.district, address.city]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }
  return 'Theo địa chỉ cơ sở trên hệ thống';
}

function wrapVaultSpaceTemplate(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; color: #1e293b; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #059669; padding-bottom: 14px; margin-bottom: 20px;">
        <h2 style="margin: 0; color: #059669; font-size: 20px;">VaultSpace</h2>
      </div>
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px;">${escapeHtml(title)}</h3>
      <div style="font-size: 14px; line-height: 1.65; color: #334155;">
        ${bodyHtml}
      </div>
      <p style="margin-top: 24px; font-size: 14px; color: #334155;">
        Trân trọng,<br/>
        <strong>Đội ngũ VaultSpace</strong>
      </p>
      <p style="color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 24px;">
        Email này được gửi tự động từ hệ thống VaultSpace. Vui lòng không trả lời trực tiếp email này.
      </p>
    </div>
  `;
}

export interface ReservationEmailContext {
  toEmail: string;
  fullName: string;
  reservationCode: string;
  facilityName: string;
  facilityAddress: string;
  unitCode: string;
  startDate: string;
  endDate: string;
  signingDeadline: string;
}

export class EmailService {
  static getTransporter() {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  static isDeliverableEmail(email?: string | null): boolean {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_FORMAT_REGEX.test(trimmed)) return false;

    const domain = trimmed.split('@')[1] || '';
    if (NON_DELIVERABLE_DOMAINS.has(domain)) return false;
    if (NON_DELIVERABLE_TLDS.some((tld) => domain.endsWith(tld))) return false;
    return true;
  }

  /**
   * Hàm gửi mail an toàn với cơ chế fallback: không bao giờ throw lỗi ra luồng chính.
   */
  static async safeSendMail(toEmail: string, subject: string, html: string, correlationId: string = randomUUID()): Promise<boolean> {
    try {
      if (!this.isDeliverableEmail(toEmail)) {
        logOperationalFailure({ operation: 'email.send', stage: 'recipient_validation', provider: 'gmail', error: Object.assign(new Error(), { code: 'INVALID_RECIPIENT' }), correlationId, retryable: false });
        return false;
      }
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        logOperationalFailure({ operation: 'email.send', stage: 'configuration', provider: 'gmail', error: Object.assign(new Error(), { code: 'PROVIDER_CONFIGURATION_MISSING' }), correlationId, retryable: false });
        return false;
      }

      const mailOptions = {
        from: `"VaultSpace" <${process.env.GMAIL_USER}>`,
        to: toEmail.trim(),
        subject,
        html,
      };

      const transporter = this.getTransporter();
      await transporter.sendMail(mailOptions);
      return true;
    } catch (error: any) {
      logOperationalFailure({ operation: 'email.send', stage: 'provider_request', provider: 'gmail', error, correlationId });
      return false;
    }
  }

  private static async dispatchNotificationAndEmail(
    reservation: any,
    ctx: ReservationEmailContext,
    payload: {
      type: NotificationType;
      inAppTitle: string;
      summaryLine: string;
      detailText: string;
      emailSubject: string;
      emailHtml: string;
    }
  ): Promise<boolean> {
    const emailSent = await this.safeSendMail(ctx.toEmail, payload.emailSubject, payload.emailHtml);
    const userId = NotificationService.resolveCustomerId(reservation);
    if (userId) {
      const sentVia: NotificationMethod[] = emailSent
        ? [NotificationMethod.IN_APP, NotificationMethod.EMAIL]
        : [NotificationMethod.IN_APP];
      await NotificationService.safeCreate({
        userId,
        type: payload.type,
        title: payload.inAppTitle,
        content: `${payload.summaryLine}\n\nXem thông tin chi tiết trong mục dịch vụ trên VaultSpace.`,
        sentVia,
      });
    }
    return emailSent;
  }

  /**
   * Giữ nguyên hành vi throw cho OTP quên mật khẩu.
   */
  static async sendOtpEmail(toEmail: string, otpCode: string): Promise<void> {
    const correlationId = randomUUID();
    let mailOptions;
    try {
      mailOptions = {
        from: `"VaultSpace" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: '[VaultSpace] Yêu cầu khôi phục mật khẩu',
        html: wrapVaultSpaceTemplate(
          'Khôi phục mật khẩu',
          `
          <p>Chào bạn,</p>
          <p>Bạn vừa yêu cầu khôi phục mật khẩu. Vui lòng sử dụng mã OTP dưới đây để tiếp tục:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; padding: 14px 28px; background-color: #f1f5f9; color: #0f172a; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 6px;">
              ${escapeHtml(otpCode)}
            </span>
          </div>
          <p>Mã OTP này sẽ tự động hết hạn sau <strong>5 phút</strong>.</p>
          <p style="color: #64748b; font-size: 13px;">Nếu bạn không yêu cầu đổi mật khẩu, vui lòng bỏ qua email này. Tuyệt đối không cung cấp mã này cho bất kỳ ai.</p>
          `
        ),
      };
    } catch (error) {
      logOperationalFailure({ operation: 'email.send_otp', stage: 'template_render', provider: 'internal', error, correlationId, retryable: false });
      throw error;
    }

    try {
      const transporter = this.getTransporter();
      await transporter.sendMail(mailOptions);
    } catch (error) {
      logOperationalFailure({ operation: 'email.send_otp', stage: 'provider_request', provider: 'gmail', error, correlationId });
      throw new Error('Hệ thống không thể gửi email lúc này. Vui lòng thử lại sau.');
    }
  }

  static async resolveReservationEmailContext(reservation: any): Promise<ReservationEmailContext | null> {
    try {
      if (!reservation) return null;

      let toEmail = reservation.customerId?.email || '';
      let fullName = reservation.customerId?.fullName || reservation.customerId?.displayName || '';
      if (!toEmail && reservation.customerId) {
        const user: any = await UserModel.findById(reservation.customerId).select('email fullName displayName').lean().exec();
        toEmail = user?.email || '';
        fullName = user?.fullName || user?.displayName || fullName;
      }

      if (!toEmail) return null;

      let facilityName = reservation.facilityId?.name || 'Cơ sở VaultSpace';
      let facilityAddress = reservation.facilityId?.address || '';
      if (!reservation.facilityId?.name && reservation.facilityId) {
        const facility: any = await FacilityModel.findById(reservation.facilityId).select('name address').lean().exec();
        if (facility) {
          facilityName = facility.name || facilityName;
          facilityAddress = facility.address || facilityAddress;
        }
      }

      let unitCode = reservation.storageUnitId?.unitCode || 'Kho tự quản';
      if (!reservation.storageUnitId?.unitCode && reservation.storageUnitId) {
        const unit: any = await StorageUnitModel.findById(reservation.storageUnitId).select('unitCode').lean().exec();
        if (unit?.unitCode) unitCode = unit.unitCode;
      }

      return {
        toEmail,
        fullName: fullName || 'Quý khách',
        reservationCode: reservation.reservationCode || String(reservation._id),
        facilityName,
        facilityAddress: formatFacilityAddress(facilityAddress),
        unitCode,
        startDate: formatDateVi(reservation.startDate),
        endDate: formatDateVi(reservation.endDate),
        signingDeadline: formatDateVi(reservation.signingDeadline),
      };
    } catch (error: any) {
      logOperationalFailure({ operation: 'email.resolve_context', stage: 'context_lookup', provider: 'internal', error, retryable: false });
      return null;
    }
  }

  /**
   * Mốc 0a: Tạo yêu cầu thuê kho tự quản mới thành công
   */
  static async sendReservationCreatedEmail(reservation: any, amountOverride?: number): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const amount = formatMoneyVi(amountOverride ?? reservation.rentalPricingSnapshot?.totalDue ?? reservation.estimatedRent);
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Xác nhận yêu cầu thuê kho ${ctx.reservationCode} – Lưu ý thời hạn ký hợp đồng 3 ngày`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Xác nhận yêu cầu thuê kho tự quản',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>VaultSpace đã tiếp nhận yêu cầu thuê kho tự quản mới của bạn với thông tin như sau:</p>
        <ul>
          <li>Mã đơn thuê: <strong>${escapeHtml(ctx.reservationCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)} (${escapeHtml(ctx.facilityAddress)})</li>
          <li>Mã ô kho: <strong>${escapeHtml(ctx.unitCode)}</strong></li>
          <li>Thời gian thuê dự kiến: Từ ${escapeHtml(ctx.startDate)} đến ${escapeHtml(ctx.endDate)}</li>
          <li>Tổng số tiền cần thanh toán: <strong>${amount} đ</strong></li>
        </ul>
        <p><strong>Lưu ý quan trọng về thời hạn ký hợp đồng:</strong><br/>
        Sau khi hoàn tất thanh toán, bạn có thời hạn <strong>3 ngày</strong> để đến trực tiếp cơ sở kiểm tra kho và ký hợp đồng giấy. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký hợp đồng, đơn thuê sẽ tự động bị hủy (khấu trừ 10% phí giữ kho và hoàn lại 90% số tiền).</p>
        <p>Vui lòng hoàn tất thanh toán trên hệ thống VaultSpace để tiếp tục.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

VaultSpace đã tiếp nhận yêu cầu thuê kho tự quản mới của bạn với thông tin như sau:
- Mã đơn thuê: ${ctx.reservationCode}
- Cơ sở: ${ctx.facilityName} (${ctx.facilityAddress})
- Mã ô kho: ${ctx.unitCode}
- Thời gian thuê dự kiến: Từ ${ctx.startDate} đến ${ctx.endDate}
- Tổng số tiền cần thanh toán: ${amount} đ

Lưu ý quan trọng về thời hạn ký hợp đồng:
Sau khi hoàn tất thanh toán, bạn có thời hạn 3 ngày để đến trực tiếp cơ sở kiểm tra kho và ký hợp đồng giấy. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký hợp đồng, đơn thuê sẽ tự động bị hủy (khấu trừ 10% phí giữ kho và hoàn lại 90% số tiền).

Vui lòng hoàn tất thanh toán trên hệ thống VaultSpace để tiếp tục.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.BOOKING_CREATED,
      inAppTitle: `Tiếp nhận yêu cầu thuê kho ${ctx.unitCode} (${ctx.reservationCode})`,
      summaryLine: `Đã tạo đơn thuê kho ${ctx.unitCode} (${amount} đ) ngày ${todayStr}. Vui lòng thanh toán để giữ kho.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 0b: Tạo yêu cầu gia hạn hợp đồng thành công
   */
  static async sendExtensionCreatedEmail(reservation: any, extItem: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx || !extItem) return false;
    const todayStr = formatDateVi(new Date());
    const amountStr = formatMoneyVi(extItem.amount);
    const newEndStr = formatDateVi(extItem.newEndDate);
    const emailSubject = `[VaultSpace] Xác nhận yêu cầu gia hạn ${extItem.extensionCode} – Lưu ý thời hạn ký phụ lục 3 ngày`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Xác nhận yêu cầu gia hạn hợp đồng',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>VaultSpace đã tiếp nhận yêu cầu gia hạn hợp đồng thuê kho của bạn với thông tin như sau:</p>
        <ul>
          <li>Mã đơn thuê: <strong>${escapeHtml(ctx.reservationCode)}</strong></li>
          <li>Mã phụ lục gia hạn: <strong>${escapeHtml(extItem.extensionCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)}</li>
          <li>Mã ô kho: <strong>${escapeHtml(ctx.unitCode)}</strong></li>
          <li>Thời gian gia hạn thêm: ${extItem.durationMonths} tháng</li>
          <li>Hạn hợp đồng mới dự kiến: ${newEndStr}</li>
          <li>Phí gia hạn cần thanh toán: <strong>${amountStr} đ</strong></li>
        </ul>
        <p><strong>Lưu ý quan trọng về thời hạn ký phụ lục:</strong><br/>
        Sau khi hoàn tất thanh toán, bạn có thời hạn <strong>3 ngày</strong> để đến trực tiếp cơ sở ký bản phụ lục hợp đồng gia hạn giấy. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký phụ lục, yêu cầu gia hạn sẽ tự động bị hủy (khấu trừ 10% phí gia hạn và hoàn lại 90% số tiền).</p>
        <p>Vui lòng hoàn tất thanh toán trên hệ thống VaultSpace để tiếp tục.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

VaultSpace đã tiếp nhận yêu cầu gia hạn hợp đồng thuê kho của bạn với thông tin như sau:
- Mã đơn thuê: ${ctx.reservationCode}
- Mã phụ lục gia hạn: ${extItem.extensionCode}
- Cơ sở: ${ctx.facilityName}
- Mã ô kho: ${ctx.unitCode}
- Thời gian gia hạn thêm: ${extItem.durationMonths} tháng
- Hạn hợp đồng mới dự kiến: ${newEndStr}
- Phí gia hạn cần thanh toán: ${amountStr} đ

Lưu ý quan trọng về thời hạn ký phụ lục:
Sau khi hoàn tất thanh toán, bạn có thời hạn 3 ngày để đến trực tiếp cơ sở ký bản phụ lục hợp đồng gia hạn giấy. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký phụ lục, yêu cầu gia hạn sẽ tự động bị hủy (khấu trừ 10% phí gia hạn và hoàn lại 90% số tiền).

Vui lòng hoàn tất thanh toán trên hệ thống VaultSpace để tiếp tục.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.EXTENSION_CREATED,
      inAppTitle: `Tiếp nhận yêu cầu gia hạn ${extItem.extensionCode} (+${extItem.durationMonths} tháng)`,
      summaryLine: `Đã tạo yêu cầu gia hạn kho ${ctx.unitCode} (+${extItem.durationMonths} tháng, ${amountStr} đ) ngày ${todayStr}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 1: Thuê kho tự quản thanh toán thành công (Chờ xác nhận & bàn giao)
   */
  static async sendRentalPaidEmail(reservation: any, amountOverride?: number): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const amount = formatMoneyVi(amountOverride ?? reservation.rentalPricingSnapshot?.totalDue ?? reservation.estimatedRent);
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Cảm ơn bạn đã thanh toán đơn thuê kho ${ctx.reservationCode}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thanh toán đơn thuê kho thành công',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Cảm ơn bạn đã tin tưởng và hoàn tất thanh toán dịch vụ thuê kho tự quản tại VaultSpace.</p>
        <p><strong>Thông tin đơn thuê của bạn:</strong></p>
        <ul>
          <li>Mã đơn thuê: <strong>${escapeHtml(ctx.reservationCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)} (${escapeHtml(ctx.facilityAddress)})</li>
          <li>Mã ô kho: <strong>${escapeHtml(ctx.unitCode)}</strong></li>
          <li>Thời gian thuê: Từ ${escapeHtml(ctx.startDate)} đến ${escapeHtml(ctx.endDate)}</li>
          <li>Số tiền đã thanh toán: <strong>${amount} đ</strong></li>
        </ul>
        <p><strong>Bước tiếp theo (Thời hạn 3 ngày):</strong><br/>
        Vui lòng đến trực tiếp cơ sở trước ngày <strong>${escapeHtml(ctx.signingDeadline)}</strong> để kiểm tra thực tế ô kho, ký hợp đồng giấy và nhận bàn giao kho cùng mã PIN mở cửa. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký hợp đồng, đơn thuê sẽ tự động bị hủy (khấu trừ 10% phí giữ kho và hoàn lại 90% số tiền).</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Cảm ơn bạn đã tin tưởng và hoàn tất thanh toán dịch vụ thuê kho tự quản tại VaultSpace.

Thông tin đơn thuê của bạn:
- Mã đơn thuê: ${ctx.reservationCode}
- Cơ sở: ${ctx.facilityName} (${ctx.facilityAddress})
- Mã ô kho: ${ctx.unitCode}
- Thời gian thuê: Từ ${ctx.startDate} đến ${ctx.endDate}
- Số tiền đã thanh toán: ${amount} đ

Bước tiếp theo (Thời hạn 3 ngày):
Vui lòng đến trực tiếp cơ sở trước ngày ${ctx.signingDeadline} để kiểm tra thực tế ô kho, ký hợp đồng giấy và nhận bàn giao kho cùng mã PIN mở cửa. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký hợp đồng, đơn thuê sẽ tự động bị hủy (khấu trừ 10% phí giữ kho và hoàn lại 90% số tiền).`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.PAYMENT_SUCCESS,
      inAppTitle: `Thanh toán đơn thuê kho ${ctx.reservationCode} thành công`,
      summaryLine: `Giao dịch thanh toán ${amount} đ cho kho ${ctx.unitCode} thành công ngày ${todayStr}. Hạn ký hợp đồng: ${ctx.signingDeadline}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 2.1: Staff phê duyệt hợp đồng & bàn giao kho thành công (Đính kèm Mã PIN)
   */
  static async sendHandoverPinEmail(reservation: any, accessPinCode?: string): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const pin = accessPinCode || reservation.accessPinCode || '—';
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Bàn giao kho ${ctx.unitCode} thành công – Mã PIN mở cửa của bạn`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Bàn giao kho thành công',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Nhân viên VaultSpace đã xác nhận hợp đồng giấy và hoàn tất bàn giao ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> cho bạn. Hợp đồng thuê kho của bạn hiện đã chính thức có hiệu lực và bạn có thể bắt đầu sử dụng kho ngay bây giờ.</p>
        <p style="font-size: 16px; margin: 18px 0; padding: 14px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; text-align: center;">
          <strong>Mã PIN mở cửa kho: <span style="font-size: 22px; color: #047857; letter-spacing: 3px;">${escapeHtml(pin)}</span></strong>
        </p>
        <p><strong>Cảnh báo bảo mật:</strong> Tuyệt đối không chia sẻ mã PIN này cho người lạ để đảm bảo an toàn tài sản.</p>
        <p><strong>Thông tin sử dụng kho:</strong></p>
        <ul>
          <li>Mã đơn thuê: <strong>${escapeHtml(ctx.reservationCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)} (${escapeHtml(ctx.facilityAddress)})</li>
          <li>Mã ô kho: <strong>${escapeHtml(ctx.unitCode)}</strong></li>
          <li>Thời hạn sử dụng kho: Từ ${escapeHtml(ctx.startDate)} đến ${escapeHtml(ctx.endDate)}</li>
        </ul>
        <p>Chúc bạn có trải nghiệm lưu trữ an toàn và thuận tiện cùng VaultSpace.</p>
      `
    );
    const detailText =
`Bàn giao ô kho ${ctx.unitCode} đã hoàn tất. Thông tin truy cập được gửi qua kênh bảo mật đã xác minh.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.HANDOVER_PIN,
      inAppTitle: `Bàn giao kho ${ctx.unitCode} thành công`,
      summaryLine: `Kho ${ctx.unitCode} (${ctx.reservationCode}) đã được bàn giao ngày ${todayStr}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 2.2: Khách không ưng kho, Staff bấm hủy (Kèm lý do + Lời xin lỗi)
   */
  static async sendStaffCancelledNoReceiveEmail(reservation: any, reason: string): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const amount = formatMoneyVi(reservation.rentalPricingSnapshot?.totalDue ?? reservation.estimatedRent);
    const todayStr = formatDateVi(new Date());
    const finalReason = reason || 'Khách hàng không nhận kho';
    const emailSubject = `[VaultSpace] Xin lỗi và xác nhận hủy đơn thuê kho ${ctx.reservationCode}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Xin lỗi và xác nhận hủy đơn thuê kho',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>VaultSpace chân thành xin lỗi vì ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> tại cơ sở ${escapeHtml(ctx.facilityName)} chưa đáp ứng đúng kỳ vọng và nhu cầu thực tế của bạn.</p>
        <p>Nhân viên cơ sở đã ghi nhận việc bạn không nhận kho và tiến hành hủy đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong>.</p>
        <ul>
          <li>Lý do ghi nhận: ${escapeHtml(finalReason)}</li>
        </ul>
        <p>Đối với số tiền bạn đã thanh toán (${amount} đ), bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn tiền cho bạn trong thời gian sớm nhất. Rất mong có cơ hội được phục vụ bạn ở những lần sau.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

VaultSpace chân thành xin lỗi vì ô kho ${ctx.unitCode} tại cơ sở ${ctx.facilityName} chưa đáp ứng đúng kỳ vọng và nhu cầu thực tế của bạn.

Nhân viên cơ sở đã ghi nhận việc bạn không nhận kho và tiến hành hủy đơn thuê ${ctx.reservationCode}.
- Lý do ghi nhận: ${finalReason}

Đối với số tiền bạn đã thanh toán (${amount} đ), bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn tiền cho bạn trong thời gian sớm nhất. Rất mong có cơ hội được phục vụ bạn ở những lần sau.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.BOOKING_CANCELLED,
      inAppTitle: `Xác nhận hủy đơn thuê kho ${ctx.reservationCode}`,
      summaryLine: `Đơn thuê kho ${ctx.unitCode} đã được hủy ngày ${todayStr}. Bộ phận cơ sở sẽ liên hệ hoàn tiền cho bạn.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 3: Khách gửi Checkout và Staff bấm xác nhận trả kho thành công
   */
  static async sendCheckoutCompletedEmail(reservation: any, condition: string, note?: string): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const conditionLabel = CONDITION_LABELS[condition] || condition || 'Hoàn tất';
    const checkoutDateStr = formatDateTimeVi(reservation.actualCheckoutDate || new Date());
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Xác nhận trả kho thành công – Đơn ${ctx.reservationCode}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Xác nhận hoàn tất trả kho (Checkout)',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Nhân viên VaultSpace đã kiểm tra thực tế và xác nhận hoàn tất thủ tục trả kho cho đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong>.</p>
        <p><strong>Thông tin nghiệm thu trả kho:</strong></p>
        <ul>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)}</li>
          <li>Mã ô kho: <strong>${escapeHtml(ctx.unitCode)}</strong></li>
          <li>Thời gian trả kho thực tế: ${checkoutDateStr}</li>
          <li>Tình trạng kho ghi nhận: ${escapeHtml(conditionLabel)}</li>
          <li>Ghi chú nghiệm thu: ${escapeHtml(note || 'Không có')}</li>
        </ul>
        <p>Cảm ơn bạn đã tin tưởng và đồng hành cùng dịch vụ kho tự quản của VaultSpace. Rất hân hạnh được tiếp tục phục vụ bạn trong tương lai.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Nhân viên VaultSpace đã kiểm tra thực tế và xác nhận hoàn tất thủ tục trả kho cho đơn thuê ${ctx.reservationCode}.

Thông tin nghiệm thu trả kho:
- Cơ sở: ${ctx.facilityName}
- Mã ô kho: ${ctx.unitCode}
- Thời gian trả kho thực tế: ${checkoutDateStr}
- Tình trạng kho ghi nhận: ${conditionLabel}
- Ghi chú nghiệm thu: ${note || 'Không có'}

Cảm ơn bạn đã tin tưởng và đồng hành cùng dịch vụ kho tự quản của VaultSpace. Rất hân hạnh được tiếp tục phục vụ bạn trong tương lai.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.CHECKOUT_COMPLETED,
      inAppTitle: `Hoàn tất trả kho ${ctx.unitCode} (${ctx.reservationCode})`,
      summaryLine: `Đơn thuê kho ${ctx.unitCode} đã được nghiệm thu trả kho thành công ngày ${todayStr}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 4: Khách thanh toán gia hạn hợp đồng thành công
   */
  static async sendExtensionPaidEmail(reservation: any, extItem: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx || !extItem) return false;
    const todayStr = formatDateVi(new Date());
    const amountStr = formatMoneyVi(extItem.amount);
    const newEndStr = formatDateVi(extItem.newEndDate);
    const deadlineStr = formatDateVi(extItem.signingDeadline);
    const emailSubject = `[VaultSpace] Xác nhận thanh toán gia hạn hợp đồng ${extItem.extensionCode}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thanh toán gia hạn hợp đồng thành công',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>VaultSpace đã ghi nhận khoản thanh toán phí gia hạn hợp đồng cho đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong>).</p>
        <p><strong>Thông tin yêu cầu gia hạn:</strong></p>
        <ul>
          <li>Mã phụ lục gia hạn: <strong>${escapeHtml(extItem.extensionCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)}</li>
          <li>Thời gian gia hạn thêm: ${extItem.durationMonths} tháng</li>
          <li>Số tiền đã thanh toán: <strong>${amountStr} đ</strong></li>
          <li>Hạn hợp đồng mới dự kiến: ${newEndStr}</li>
        </ul>
        <p><strong>Bước tiếp theo (Thời hạn 3 ngày):</strong><br/>
        Vui lòng đến trực tiếp cơ sở trước ngày <strong>${deadlineStr}</strong> để ký bản phụ lục hợp đồng gia hạn giấy. Trong thời gian chờ ký phụ lục, kho và mã PIN mở cửa hiện tại của bạn vẫn hoạt động bình thường. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký phụ lục, yêu cầu gia hạn sẽ tự động bị hủy (khấu trừ 10% phí gia hạn và hoàn lại 90% số tiền).</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

VaultSpace đã ghi nhận khoản thanh toán phí gia hạn hợp đồng cho đơn thuê ${ctx.reservationCode} (ô kho ${ctx.unitCode}).

Thông tin yêu cầu gia hạn:
- Mã phụ lục gia hạn: ${extItem.extensionCode}
- Cơ sở: ${ctx.facilityName}
- Thời gian gia hạn thêm: ${extItem.durationMonths} tháng
- Số tiền đã thanh toán: ${amountStr} đ
- Hạn hợp đồng mới dự kiến: ${newEndStr}

Bước tiếp theo (Thời hạn 3 ngày):
Vui lòng đến trực tiếp cơ sở trước ngày ${deadlineStr} để ký bản phụ lục hợp đồng gia hạn giấy. Trong thời gian chờ ký phụ lục, kho và mã PIN mở cửa hiện tại của bạn vẫn hoạt động bình thường. Nếu quá thời hạn 3 ngày mà bạn chưa đến ký phụ lục, yêu cầu gia hạn sẽ tự động bị hủy (khấu trừ 10% phí gia hạn và hoàn lại 90% số tiền).`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.EXTENSION_PAID,
      inAppTitle: `Thanh toán gia hạn ${extItem.extensionCode} thành công`,
      summaryLine: `Giao dịch gia hạn kho ${ctx.unitCode} (${amountStr} đ) thành công ngày ${todayStr}. Hạn ký phụ lục: ${deadlineStr}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 5.1: Staff xác nhận gia hạn xong & gia hạn thành công
   */
  static async sendExtensionConfirmedEmail(reservation: any, extItem: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx || !extItem) return false;
    const newEndDate = formatDateVi(extItem.newEndDate);
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Gia hạn hợp đồng thành công – Hạn mới đến ${newEndDate}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Gia hạn hợp đồng thành công',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Nhân viên VaultSpace đã kiểm tra phụ lục hợp đồng giấy và chính thức kích hoạt gia hạn cho đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong>).</p>
        <p><strong>Chi tiết gia hạn:</strong></p>
        <ul>
          <li>Mã phụ lục: <strong>${escapeHtml(extItem.extensionCode)}</strong></li>
          <li>Cơ sở: ${escapeHtml(ctx.facilityName)}</li>
          <li>Thời gian gia hạn thêm: ${extItem.durationMonths} tháng</li>
          <li>Ngày hết hạn hợp đồng mới: <strong>${newEndDate}</strong></li>
        </ul>
        <p>Mã PIN mở cửa kho hiện tại của bạn vẫn giữ nguyên và tiếp tục sử dụng bình thường đến hết thời hạn mới.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Nhân viên VaultSpace đã kiểm tra phụ lục hợp đồng giấy và chính thức kích hoạt gia hạn cho đơn thuê ${ctx.reservationCode} (ô kho ${ctx.unitCode}).

Chi tiết gia hạn:
- Mã phụ lục: ${extItem.extensionCode}
- Cơ sở: ${ctx.facilityName}
- Thời gian gia hạn thêm: ${extItem.durationMonths} tháng
- Ngày hết hạn hợp đồng mới: ${newEndDate}

Mã PIN mở cửa kho hiện tại của bạn vẫn giữ nguyên và tiếp tục sử dụng bình thường đến hết thời hạn mới.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.EXTENSION_CONFIRMED,
      inAppTitle: `Gia hạn kho ${ctx.unitCode} thành công đến ${newEndDate}`,
      summaryLine: `Phụ lục gia hạn ${extItem.extensionCode} (+${extItem.durationMonths} tháng) đã được duyệt ngày ${todayStr}.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Mốc 5.2: Staff từ chối gia hạn (Kèm lý do)
   */
  static async sendExtensionRejectedEmail(reservation: any, extItem: any, reason: string): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx || !extItem) return false;
    const todayStr = formatDateVi(new Date());
    const amountStr = formatMoneyVi(extItem.amount);
    const emailSubject = `[VaultSpace] Thông báo từ chối yêu cầu gia hạn ${extItem.extensionCode}`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thông báo từ chối yêu cầu gia hạn hợp đồng',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Yêu cầu gia hạn hợp đồng <strong>${escapeHtml(extItem.extensionCode)}</strong> cho đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong>) tại cơ sở ${escapeHtml(ctx.facilityName)} đã bị từ chối xử lý.</p>
        <ul>
          <li>Lý do từ chối: ${escapeHtml(reason)}</li>
        </ul>
        <p>Hạn kết thúc hợp đồng hiện tại của bạn vẫn giữ nguyên tại ngày ${escapeHtml(ctx.endDate)}. Đối với số tiền gia hạn đã thanh toán (${amountStr} đ), bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn tiền 100% cho bạn trong thời gian sớm nhất.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Yêu cầu gia hạn hợp đồng ${extItem.extensionCode} cho đơn thuê ${ctx.reservationCode} (ô kho ${ctx.unitCode}) tại cơ sở ${ctx.facilityName} đã bị từ chối xử lý.
- Lý do từ chối: ${reason}

Hạn kết thúc hợp đồng hiện tại của bạn vẫn giữ nguyên tại ngày ${ctx.endDate}. Đối với số tiền gia hạn đã thanh toán (${amountStr} đ), bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn tiền 100% cho bạn trong thời gian sớm nhất.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.EXTENSION_REJECTED,
      inAppTitle: `Từ chối yêu cầu gia hạn ${extItem.extensionCode}`,
      summaryLine: `Yêu cầu gia hạn kho ${ctx.unitCode} đã bị từ chối ngày ${todayStr}. Hạn thuê giữ nguyên (${ctx.endDate}).`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Cron 1a: Quá hạn ký hợp đồng 3 ngày đối với đơn thuê kho mới
   */
  static async sendSigningSlaExpiredRentalEmail(reservation: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const total = Number(reservation.rentalPricingSnapshot?.totalDue ?? reservation.estimatedRent ?? 0);
    const penalty = Math.round(total * 0.1);
    const refund = total - penalty;
    const todayStr = formatDateVi(new Date());
    const emailSubject = `[VaultSpace] Hủy đơn thuê kho ${ctx.reservationCode} do quá hạn ký hợp đồng 3 ngày`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thông báo hủy đơn do quá thời hạn ký hợp đồng',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Đơn thuê kho <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> tại cơ sở ${escapeHtml(ctx.facilityName)}) đã quá thời hạn <strong>3 ngày</strong> (hạn chót: ${escapeHtml(ctx.signingDeadline)}) nhưng bạn chưa đến cơ sở để ký hợp đồng giấy.</p>
        <p>Theo quy định của VaultSpace, hệ thống đã tự động hủy đơn thuê này và giải phóng ô kho.</p>
        <p><strong>Thông tin chi phí phạt và hoàn tiền:</strong></p>
        <ul>
          <li>Tổng số tiền đã thanh toán: ${formatMoneyVi(total)} đ</li>
          <li>Chi phí phạt quá hạn (10%): ${formatMoneyVi(penalty)} đ</li>
          <li>Số tiền được hoàn lại (90%): <strong>${formatMoneyVi(refund)} đ</strong></li>
        </ul>
        <p>Bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn lại 90% số tiền cho bạn trong thời gian sớm nhất.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Đơn thuê kho ${ctx.reservationCode} (ô kho ${ctx.unitCode} tại cơ sở ${ctx.facilityName}) đã quá thời hạn 3 ngày (hạn chót: ${ctx.signingDeadline}) nhưng bạn chưa đến cơ sở để ký hợp đồng giấy.

Theo quy định của VaultSpace, hệ thống đã tự động hủy đơn thuê này và giải phóng ô kho.

Thông tin chi phí phạt và hoàn tiền:
- Tổng số tiền đã thanh toán: ${formatMoneyVi(total)} đ
- Chi phí phạt quá hạn (10%): ${formatMoneyVi(penalty)} đ
- Số tiền được hoàn lại (90%): ${formatMoneyVi(refund)} đ

Bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn lại 90% số tiền cho bạn trong thời gian sớm nhất.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.SIGNING_SLA_EXPIRED,
      inAppTitle: `Hủy đơn ${ctx.reservationCode} do quá hạn ký 3 ngày`,
      summaryLine: `Đơn thuê kho ${ctx.unitCode} bị hủy tự động ngày ${todayStr} (hoàn 90%: ${formatMoneyVi(refund)} đ).`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Cron 1b: Quá hạn ký phụ lục 3 ngày đối với yêu cầu gia hạn
   */
  static async sendSigningSlaExpiredExtensionEmail(reservation: any, extItem: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx || !extItem) return false;
    const total = Number(extItem.amount ?? 0);
    const penalty = Math.round(total * 0.1);
    const refund = total - penalty;
    const todayStr = formatDateVi(new Date());
    const deadlineStr = formatDateVi(extItem.signingDeadline);
    const emailSubject = `[VaultSpace] Hủy yêu cầu gia hạn ${extItem.extensionCode} do quá hạn ký phụ lục 3 ngày`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thông báo hủy yêu cầu gia hạn do quá thời hạn ký phụ lục',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Yêu cầu gia hạn hợp đồng <strong>${escapeHtml(extItem.extensionCode)}</strong> của đơn thuê <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> tại cơ sở ${escapeHtml(ctx.facilityName)}) đã quá thời hạn <strong>3 ngày</strong> (hạn chót: ${deadlineStr}) nhưng bạn chưa đến cơ sở để ký phụ lục hợp đồng giấy.</p>
        <p>Theo quy định của VaultSpace, hệ thống đã tự động hủy yêu cầu gia hạn này. Đơn thuê gốc và mã PIN hiện tại của bạn vẫn giữ nguyên theo thời hạn hợp đồng cũ (${escapeHtml(ctx.endDate)}).</p>
        <p><strong>Thông tin chi phí phạt và hoàn tiền:</strong></p>
        <ul>
          <li>Phí gia hạn đã thanh toán: ${formatMoneyVi(total)} đ</li>
          <li>Chi phí phạt quá hạn (10%): ${formatMoneyVi(penalty)} đ</li>
          <li>Số tiền được hoàn lại (90%): <strong>${formatMoneyVi(refund)} đ</strong></li>
        </ul>
        <p>Bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn lại 90% số tiền cho bạn trong thời gian sớm nhất.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Yêu cầu gia hạn hợp đồng ${extItem.extensionCode} của đơn thuê ${ctx.reservationCode} (ô kho ${ctx.unitCode} tại cơ sở ${ctx.facilityName}) đã quá thời hạn 3 ngày (hạn chót: ${deadlineStr}) nhưng bạn chưa đến cơ sở để ký phụ lục hợp đồng giấy.

Theo quy định của VaultSpace, hệ thống đã tự động hủy yêu cầu gia hạn này. Đơn thuê gốc và mã PIN hiện tại của bạn vẫn giữ nguyên theo thời hạn hợp đồng cũ (${ctx.endDate}).

Thông tin chi phí phạt và hoàn tiền:
- Phí gia hạn đã thanh toán: ${formatMoneyVi(total)} đ
- Chi phí phạt quá hạn (10%): ${formatMoneyVi(penalty)} đ
- Số tiền được hoàn lại (90%): ${formatMoneyVi(refund)} đ

Bộ phận quản lý cơ sở sẽ liên hệ và hoàn thành thủ tục hoàn lại 90% số tiền cho bạn trong thời gian sớm nhất.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.SIGNING_SLA_EXPIRED,
      inAppTitle: `Hủy gia hạn ${extItem.extensionCode} do quá hạn ký 3 ngày`,
      summaryLine: `Yêu cầu gia hạn kho ${ctx.unitCode} bị hủy tự động ngày ${todayStr} (hoàn 90%: ${formatMoneyVi(refund)} đ).`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Cron 2: Nhắc nhở sắp hết hạn thuê (Trước 7 ngày & 3 ngày)
   */
  static async sendExpiringSoonReminderEmail(reservation: any, daysLeft: number): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const emailSubject = `[VaultSpace] Nhắc nhở: Hợp đồng thuê kho ${ctx.unitCode} còn ${daysLeft} ngày nữa sẽ hết hạn`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Nhắc nhở sắp hết hạn hợp đồng thuê kho',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>VaultSpace xin thông báo hợp đồng thuê kho <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> tại cơ sở ${escapeHtml(ctx.facilityName)}) của bạn chỉ còn <strong>${daysLeft} ngày</strong> nữa sẽ hết hạn vào ngày <strong>${escapeHtml(ctx.endDate)}</strong>.</p>
        <p><strong>Hướng dẫn xử lý trước khi hết hạn:</strong></p>
        <ul>
          <li><strong>Nếu bạn muốn tiếp tục thuê kho:</strong> Vui lòng truy cập mục Kho của tôi trên VaultSpace và chọn <strong>Gia hạn thuê kho</strong> trước ngày ${escapeHtml(ctx.endDate)}.</li>
          <li><strong>Nếu bạn muốn kết thúc thuê kho:</strong> Vui lòng dọn sạch toàn bộ tài sản bên trong ô kho và bấm <strong>Yêu cầu trả kho (Checkout)</strong> trước ngày ${escapeHtml(ctx.endDate)} để nhân viên cơ sở kiểm tra nghiệm thu đúng hạn, tránh phát sinh chi phí quá hạn.</li>
        </ul>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

VaultSpace xin thông báo hợp đồng thuê kho ${ctx.reservationCode} (ô kho ${ctx.unitCode} tại cơ sở ${ctx.facilityName}) của bạn chỉ còn ${daysLeft} ngày nữa sẽ hết hạn vào ngày ${ctx.endDate}.

Hướng dẫn xử lý trước khi hết hạn:
- Nếu bạn muốn tiếp tục thuê kho: Vui lòng truy cập mục Kho của tôi trên VaultSpace và chọn Gia hạn thuê kho trước ngày ${ctx.endDate}.
- Nếu bạn muốn kết thúc thuê kho: Vui lòng dọn sạch toàn bộ tài sản bên trong ô kho và bấm Yêu cầu trả kho (Checkout) trước ngày ${ctx.endDate} để nhân viên cơ sở kiểm tra nghiệm thu đúng hạn, tránh phát sinh chi phí quá hạn.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.EXPIRING_SOON,
      inAppTitle: `Kho ${ctx.unitCode} sắp hết hạn (còn ${daysLeft} ngày)`,
      summaryLine: `Hợp đồng thuê kho ${ctx.unitCode} (${ctx.reservationCode}) sẽ hết hạn vào ngày ${ctx.endDate}. Vui lòng gia hạn hoặc checkout.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }

  /**
   * Cron 3: Thông báo quá hạn thuê (Khi vượt qua endDate)
   */
  static async sendOverdueRentalEmail(reservation: any): Promise<boolean> {
    const ctx = await this.resolveReservationEmailContext(reservation);
    if (!ctx) return false;
    const emailSubject = `[VaultSpace] Cảnh báo quá hạn: Hợp đồng thuê kho ${ctx.unitCode} đã hết hạn`;
    const emailHtml = wrapVaultSpaceTemplate(
      'Thông báo hợp đồng thuê kho đã quá hạn',
      `
        <p>Chào ${escapeHtml(ctx.fullName)},</p>
        <p>Hợp đồng thuê kho <strong>${escapeHtml(ctx.reservationCode)}</strong> (ô kho <strong>${escapeHtml(ctx.unitCode)}</strong> tại cơ sở ${escapeHtml(ctx.facilityName)}) của bạn đã quá hạn kể từ ngày <strong>${escapeHtml(ctx.endDate)}</strong>.</p>
        <p>Việc tiếp tục lưu giữ tài sản sau khi hết hạn hợp đồng có thể phát sinh phí lưu kho quá hạn theo ngày và các khoản phí liên quan theo chính sách của VaultSpace.</p>
        <p>Vui lòng liên hệ trực tiếp quản lý cơ sở ${escapeHtml(ctx.facilityName)} để làm thủ tục tất toán công nợ, gia hạn đặc biệt hoặc hoàn tất dọn đồ và trả kho trong vòng <strong>3 ngày</strong> tới trước khi VaultSpace áp dụng chính sách xử lý quá hạn.</p>
      `
    );
    const detailText =
`Chào ${ctx.fullName},

Hợp đồng thuê kho ${ctx.reservationCode} (ô kho ${ctx.unitCode} tại cơ sở ${ctx.facilityName}) của bạn đã quá hạn kể từ ngày ${ctx.endDate}.

Việc tiếp tục lưu giữ tài sản sau khi hết hạn hợp đồng có thể phát sinh phí lưu kho quá hạn theo ngày và các khoản phí liên quan theo chính sách của VaultSpace.

Vui lòng liên hệ trực tiếp quản lý cơ sở ${ctx.facilityName} để làm thủ tục tất toán công nợ, gia hạn đặc biệt hoặc hoàn tất dọn đồ và trả kho trong vòng 3 ngày tới trước khi VaultSpace áp dụng chính sách xử lý quá hạn.`;

    return this.dispatchNotificationAndEmail(reservation, ctx, {
      type: NotificationType.OVERDUE_ALERT,
      inAppTitle: `Cảnh báo quá hạn: Kho ${ctx.unitCode} đã hết hạn`,
      summaryLine: `Hợp đồng thuê kho ${ctx.unitCode} (${ctx.reservationCode}) đã quá hạn từ ngày ${ctx.endDate}. Vui lòng xử lý trong 3 ngày.`,
      detailText,
      emailSubject,
      emailHtml,
    });
  }
}

// The templates are inline, so wrap the public render/send methods at the service boundary.
// This catches interpolation and payload construction failures before safeSendMail is entered.
const TEMPLATE_EMAIL_METHODS = [
  'sendReservationCreatedEmail', 'sendExtensionCreatedEmail', 'sendRentalPaidEmail', 'sendHandoverPinEmail',
  'sendStaffCancelledNoReceiveEmail', 'sendCheckoutCompletedEmail', 'sendExtensionPaidEmail',
  'sendExtensionConfirmedEmail', 'sendExtensionRejectedEmail', 'sendSigningSlaExpiredRentalEmail',
  'sendSigningSlaExpiredExtensionEmail', 'sendExpiringSoonReminderEmail', 'sendOverdueRentalEmail',
] as const;

for (const method of TEMPLATE_EMAIL_METHODS) {
  const original = (EmailService as any)[method].bind(EmailService);
  (EmailService as any)[method] = async (...args: any[]) => {
    const correlationId = randomUUID();
    try { return await original(...args); }
    catch (error) {
      logOperationalFailure({ operation: `email.${method}`, stage: 'template_render', provider: 'internal', error,
        correlationId, retryable: false });
      throw error;
    }
  };
}
