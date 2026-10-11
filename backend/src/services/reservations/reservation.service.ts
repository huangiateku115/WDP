import mongoose, { ClientSession, Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import PricingRuleModel from '../../models/pricing-policy/pricing-rule.model';
import PolicyModel from '../../models/pricing-policy/policy.model';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';
import { VerificationStatus } from '../../types/customer-profile.type';

export class ReservationError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'ReservationError';
  }
}

export class ReservationService {
  
  /**
   * Thuật toán kiểm tra đụng lịch (Overlap)
   * Trả về true nếu bị trùng lịch, false nếu an toàn.
   */
  private static async checkOverlap(
    storageUnitId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    session: ClientSession
  ): Promise<boolean> {
    const now = new Date();

    const overlapQuery = {
      storageUnitId,
      // Đơn mới bắt đầu TRƯỚC khi đơn cũ kết thúc VÀ kết thúc SAU khi đơn cũ bắt đầu
      startDate: { $lt: endDate },
      endDate: { $gt: startDate },
      // Chỉ xét các trạng thái đang chiếm dụng kho
      status: { 
        $in: [
          ReservationStatus.RESERVED, 
          ReservationStatus.CONTRACTED, 
          ReservationStatus.PAID, 
          ReservationStatus.ACTIVE, 
          ReservationStatus.OVERDUE
        ] 
      },
      // Lọc bỏ các đơn RESERVED/CONTRACTED đã quá hạn (expiresAt < now)
      $or: [
        { status: { $in: [ReservationStatus.PAID, ReservationStatus.ACTIVE, ReservationStatus.OVERDUE] } },
        { 
          status: { $in: [ReservationStatus.RESERVED, ReservationStatus.CONTRACTED] }, 
          expiresAt: { $gt: now } 
        }
      ]
    };

    const overlappingBooking = await ReservationModel.exists(overlapQuery).session(session).exec();
    return overlappingBooking !== null;
  }

  /**
   * Tính toán tiền thuê và tiền cọc dựa trên Pricing Policy và thời hạn thuê
   */
  static async calculatePricing(
    pricingPolicyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    estimatedRent: number;
    depositAmount: number;
    durationDays: number;
    basePrice: number;
  }> {
    if (!pricingPolicyId) {
      throw new ReservationError(400, 'pricingPolicyId là bắt buộc.');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new ReservationError(400, 'Khoảng thời gian thuê không hợp lệ.');
    }

    let basePrice = 0;
    const pricingRule = await PricingRuleModel.findById(pricingPolicyId).exec();
    if (pricingRule) {
      basePrice = pricingRule.price;
    } else {
      const policy = await PolicyModel.findById(pricingPolicyId).exec();
      if (policy && typeof policy.config?.price === 'number') {
        basePrice = policy.config.price as number;
      } else {
        throw new ReservationError(400, 'Không tìm thấy chính sách giá (Pricing Policy) hợp lệ.');
      }
    }

    const diffMs = end.getTime() - start.getTime();
    const durationDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const estimatedRent = Math.round((durationDays / 30) * basePrice);
    const depositAmount = durationDays < 30 ? Math.round(basePrice * 0.5) : basePrice;

    return { estimatedRent, depositAmount, durationDays, basePrice };
  }

  /**
   * Tạo Đơn đặt chỗ mới (Áp dụng Transaction & Write-Conflict)
   */
  static async createReservation(data: {
    customerId: string;
    facilityId: string;
    storageUnitId: string;
    startDate: Date;
    endDate: Date;
    pricingPolicyId: string;
  }): Promise<IReservation> {
    
    // 1. Kiểm tra Gate Verification (Bắt buộc KH phải VERIFIED)
    const profile = await CustomerProfileModel.findOne({ userId: data.customerId }).exec();
    if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ReservationError(403, 'Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.');
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new ReservationError(400, 'Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.');
    }

    if (startDate <= new Date()) {
      throw new ReservationError(400, 'Ngày bắt đầu thuê phải nằm trong tương lai.');
    }

    if (endDate <= startDate) {
      throw new ReservationError(400, 'Ngày kết thúc phải lớn hơn ngày bắt đầu.');
    }

    // 2. Tự tính toán tiền thuê và tiền cọc từ Pricing Policy
    const { estimatedRent, depositAmount } = await this.calculatePricing(
      data.pricingPolicyId,
      startDate,
      endDate
    );

    const session = await mongoose.startSession();
    try {
      let createdReservation: IReservation | null = null;
      
      await session.withTransaction(async () => {
        // 3. KHÓA KHO BẰNG WRITE-CONFLICT (Kỹ thuật ép tăng version)
        // Nếu 2 người cùng đặt kho này, lệnh $inc sẽ khiến Mongo lock document này lại.
        // Người đến sau sẽ phải đợi, hoặc bị văng lỗi WriteConflict và retry.
        const unit = await StorageUnitModel.findOneAndUpdate(
          { _id: data.storageUnitId, facilityId: data.facilityId },
          { $inc: { bookingVersion: 1 } },
          { new: true, session }
        ).exec();

        if (!unit) {
          throw new ReservationError(404, 'Không tìm thấy Kho hoặc Kho không thuộc Cơ sở này.');
        }

        // Tạm thời chỉ làm luồng cho LOCKER (SELF_STORAGE)
        if (!unit.size || unit.status === 'INACTIVE' || unit.status === 'MAINTENANCE') {
          throw new ReservationError(400, 'Kho này đang bị khóa hoặc bảo trì, không thể đặt.');
        }

        // 4. THUẬT TOÁN KIỂM TRA OVERLAP
        const isOverlapping = await this.checkOverlap(
          unit._id as Types.ObjectId, 
          startDate, 
          endDate, 
          session
        );

        if (isOverlapping) {
          throw new ReservationError(409, 'Kho này đã có người đặt trong khoảng thời gian bạn chọn. Vui lòng chọn ngày hoặc kho khác.');
        }

        // 5. TẠO ĐƠN ĐẶT CHỖ
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // Hold 24 tiếng theo chuẩn SRS V2

        // Tạo chuỗi random cho Reservation Code (VD: BKG-240101-ABCD)
        const dateString = new Date().toISOString().slice(2,10).replace(/-/g, '');
        const randomString = Math.random().toString(36).substring(2, 6).toUpperCase();
        const reservationCode = `BKG-${dateString}-${randomString}`;

        const reservation = new ReservationModel({
          reservationCode,
          customerId: data.customerId,
          facilityId: data.facilityId,
          serviceType: FacilityServiceType.SELF_STORAGE,
          storageUnitId: unit._id,
          
          startDate,
          endDate,
          
          status: ReservationStatus.RESERVED,
          
          pricingPolicyId: new Types.ObjectId(data.pricingPolicyId),
          estimatedRent,
          depositAmount,
          
          expiresAt, // Đồng hồ đếm ngược 24h
          
          statusHistory: [{
            status: ReservationStatus.RESERVED,
            actorId: data.customerId,
            reason: 'Customer created reservation'
          }]
        });

        await reservation.save({ session });
        createdReservation = reservation;
      });

      return createdReservation!;
    } finally {
      await session.endSession();
    }
  }
}
