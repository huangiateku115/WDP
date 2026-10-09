import mongoose, { ClientSession, Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
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
   * Tạo Đơn đặt chỗ mới (Áp dụng Transaction & Write-Conflict)
   */
  static async createReservation(data: {
    customerId: string;
    facilityId: string;
    storageUnitId: string;
    startDate: Date;
    endDate: Date;
    pricingPolicyId?: string;
    estimatedRent: number;
    depositAmount: number;
  }): Promise<IReservation> {
    
    // 1. Kiểm tra Gate Verification (Bắt buộc KH phải VERIFIED)
    const profile = await CustomerProfileModel.findOne({ userId: data.customerId }).exec();
    if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ReservationError(403, 'Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.');
    }

    if (data.startDate <= new Date()) {
      throw new ReservationError(400, 'Ngày bắt đầu thuê phải nằm trong tương lai.');
    }

    if (data.endDate <= data.startDate) {
      throw new ReservationError(400, 'Ngày kết thúc phải lớn hơn ngày bắt đầu.');
    }

    const session = await mongoose.startSession();
    try {
      let createdReservation: IReservation | null = null;
      
      await session.withTransaction(async () => {
        // 2. KHÓA KHO BẰNG WRITE-CONFLICT (Kỹ thuật ép tăng version)
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

        // 3. THUẬT TOÁN KIỂM TRA OVERLAP
        const isOverlapping = await this.checkOverlap(
          unit._id as Types.ObjectId, 
          data.startDate, 
          data.endDate, 
          session
        );

        if (isOverlapping) {
          throw new ReservationError(409, 'Kho này đã có người đặt trong khoảng thời gian bạn chọn. Vui lòng chọn ngày hoặc kho khác.');
        }

        // 4. TẠO ĐƠN ĐẶT CHỖ
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
          
          startDate: data.startDate,
          endDate: data.endDate,
          
          status: ReservationStatus.RESERVED,
          
          pricingPolicyId: data.pricingPolicyId,
          estimatedRent: data.estimatedRent,
          depositAmount: data.depositAmount,
          
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
