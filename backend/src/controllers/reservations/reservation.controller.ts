import { Request, Response } from 'express';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import { ReservationService, ReservationError } from '../../services/reservations/reservation.service';
import { ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';
import { UserRole } from '../../types/user.type';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { ContractStatus } from '../../types/contract.type';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import { PaymentPurpose, PaymentStatus, PaymentProvider } from '../../types/payment.type';
import { calculateRentalPaymentBreakdown } from '../../services/payments/payment-accounting';

export const createReservation = async (req: Request, res: Response) => {
  try {
    const { facilityId, storageUnitId, startDate, endDate, pricingPolicyId } = req.body;
    
    if (!facilityId || !storageUnitId || !startDate || !endDate || !pricingPolicyId) {
      return res.status(400).json({ 
        success: false, 
        message: 'facilityId, storageUnitId, startDate, endDate và pricingPolicyId là các trường bắt buộc.' 
      });
    }

    const reservation = await ReservationService.createReservation({
      customerId: req.user!._id.toString(),
      facilityId,
      storageUnitId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      pricingPolicyId
    });
    return res.status(201).json({ success: true, data: reservation });
  } catch (error: any) {
    if (error instanceof ReservationError) {
      return res.status(error.code).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyReservations = async (req: Request, res: Response) => {
  try {
    const reservations = await ReservationModel.find({ customerId: req.user!._id })
      .populate('facilityId', 'name address')
      .populate('storageUnitId', 'unitCode size volumeM3')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: reservations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getReservationsByFacility = async (req: Request, res: Response) => {
  try {
    const facilityId = req.params.facilityId as string;
    if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(req.user!.role as UserRole) && req.user!.assignedFacilityId?.toString() !== facilityId.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Facility is outside assigned scope' });
    }
    const reservations = await ReservationModel.find({ facilityId, serviceType: FacilityServiceType.SELF_STORAGE })
      .populate('customerId', 'fullName email phone')
      .populate('storageUnitId', 'unitCode size status')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: reservations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getReservationById = async (req: Request, res: Response) => {
  try {
    const reservation = await ReservationModel.findOne({ _id: req.params.id, serviceType: FacilityServiceType.SELF_STORAGE } as any)
      .populate('customerId', 'fullName email phone')
      .populate('facilityId', 'name address')
      .populate('storageUnitId', 'unitCode size dimensions status');
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
    if (req.user!.role === UserRole.CUSTOMER && String(reservation.customerId) !== String(req.user!._id)) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }
    const reservationFacilityId = (reservation.facilityId as any)?._id ?? reservation.facilityId;
    if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(req.user!.role as UserRole) && req.user!.assignedFacilityId?.toString() !== String(reservationFacilityId)) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    return res.json({ success: true, data: reservation });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveReservation = async (req: Request, res: Response) => {
  try {
    // Atomic update để chống Duyệt đúp (Race Condition trên nút Approve)
    const reservation = await ReservationModel.findOneAndUpdate(
      { _id: req.params.id, serviceType: FacilityServiceType.SELF_STORAGE, status: ReservationStatus.RESERVED } as any,
      { 
        status: ReservationStatus.CONTRACTED, 
        approvedBy: req.user!._id, 
        approvedAt: new Date(),
        $push: {
          statusHistory: {
            status: ReservationStatus.CONTRACTED,
            actorId: req.user!._id,
            reason: 'FM Approved'
          }
        }
      },
      { new: true }
    );
    if (!reservation) return res.status(409).json({ success: false, message: 'Đơn không tồn tại hoặc không ở trạng thái RESERVED.' });
    
    // Tự động sinh Hợp đồng Nháp (DRAFT)
    const profile = await CustomerProfileModel.findOne({ userId: reservation.customerId }).populate('userId', 'fullName email phone');
    const user: any = profile?.userId || {};
    
    const contract = await ContractModel.create({
      contractCode: `CTR-${reservation.reservationCode}`,
      reservationId: reservation._id,
      customerId: reservation.customerId,
      customerSnapshot: {
        identityCard: profile?.identityCard,
        address: profile?.address,
        taxCode: profile?.taxCode,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone
      },
      pricingSnapshot: {
        estimatedRent: reservation.estimatedRent,
        depositAmount: reservation.depositAmount,
        pricingPolicyId: reservation.pricingPolicyId
      }
    });

    return res.json({ success: true, data: reservation, contract });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectReservation = async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const reservation = await ReservationModel.findOneAndUpdate(
      { _id: req.params.id, serviceType: FacilityServiceType.SELF_STORAGE, status: ReservationStatus.RESERVED } as any,
      { 
        status: ReservationStatus.CANCELLED,
        rejectReason: reason,
        $push: {
          statusHistory: {
            status: ReservationStatus.CANCELLED,
            actorId: req.user!._id,
            reason: `FM Rejected: ${reason}`
          }
        }
      },
      { new: true }
    );
    if (!reservation) return res.status(409).json({ success: false, message: 'Không thể từ chối đơn này.' });
    return res.json({ success: true, data: reservation });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const cancelReservation = async (req: Request, res: Response) => {
  try {
    // Chỉ cho phép Khách hàng hủy nếu chưa đến bước PAID (Theo Safeguard đã chốt)
    const reservation = await ReservationModel.findOneAndUpdate(
      { 
        _id: req.params.id, 
        customerId: req.user!._id,
        serviceType: FacilityServiceType.SELF_STORAGE,
        status: { $in: [ReservationStatus.RESERVED, ReservationStatus.CONTRACTED] } 
      } as any,
      { 
        status: ReservationStatus.CANCELLED,
        $push: {
          statusHistory: {
            status: ReservationStatus.CANCELLED,
            actorId: req.user!._id,
            reason: 'Customer auto cancelled'
          }
        }
      },
      { new: true }
    );
    
    if (!reservation) {
      return res.status(403).json({ success: false, message: 'Không thể hủy. Đơn đã đi vào hiệu lực thanh toán hoặc bạn không có quyền.' });
    }
    return res.json({ success: true, data: reservation });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// API MOCK PAYMENT (Dùng giả lập luồng PayOS webhook)
export const mockPayReservation = async (req: Request, res: Response) => {
  try {
    // This legacy endpoint is a development mock, but it still represents a
    // customer action. Never let another authenticated role pay a customer's
    // reservation through an ID-only update.
    if (req.user?.role !== UserRole.CUSTOMER) {
      return res.status(403).json({ success: false, message: 'Only the reservation owner may use mock payment.' });
    }
    const reservation = await ReservationModel.findOneAndUpdate(
      { _id: req.params.id, customerId: req.user!._id, serviceType: FacilityServiceType.SELF_STORAGE, status: ReservationStatus.CONTRACTED } as any,
      { 
        status: ReservationStatus.PAID,
        $unset: { expiresAt: 1 }, // Xóa bỏ đồng hồ đếm ngược
        $push: {
          statusHistory: {
            status: ReservationStatus.PAID,
            actorId: req.user!._id,
            reason: 'Mock Payment Webhook successful'
          }
        }
      },
      { new: true }
    );
    if (!reservation) {
      const existing = await ReservationModel.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Reservation not found.' });
      }
      if (req.user!.role === UserRole.CUSTOMER && existing.customerId.toString() !== req.user!._id.toString()) {
        return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
      }
      return res.status(409).json({ success: false, message: 'Chưa thể thanh toán. Khách phải được duyệt Hợp đồng (CONTRACTED) trước.' });
    }
    return res.json({ success: true, data: reservation });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const estimateRent = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, pricingPolicyId } = req.body;
    if (!startDate || !endDate || !pricingPolicyId) {
      return res.status(400).json({
        success: false,
        message: 'startDate, endDate và pricingPolicyId là các trường bắt buộc.'
      });
    }

    const result = await ReservationService.calculatePricing(
      pricingPolicyId,
      new Date(startDate),
      new Date(endDate)
    );

    return res.json({
      success: true,
      data: {
        estimatedRent: result.estimatedRent,
        depositAmount: result.depositAmount,
        taxAmount: 0,
        durationDays: result.durationDays,
        basePrice: result.basePrice
      }
    });
  } catch (error: any) {
    if (error instanceof ReservationError) {
      return res.status(error.code).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Khách hàng bắt đầu quy trình nộp cọc (Deposit)
 */
export const initiateDeposit = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }

    if (reservation.status !== ReservationStatus.RESERVED) {
      return res.status(400).json({ success: false, message: 'Đơn không ở trạng thái chờ thanh toán cọc.' });
    }

    const breakdown = calculateRentalPaymentBreakdown({
      rentAmount: reservation.estimatedRent,
      depositAmount: reservation.depositAmount,
      taxAmount: reservation.taxAmount || 0,
      discountAmount: reservation.discountAmount || 0,
    });

    return res.json({
      success: true,
      data: {
        reservationId: reservation._id,
        purpose: PaymentPurpose.DEPOSIT,
        amount: breakdown.depositCredit,
        currency: 'VND',
        breakdown,
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xác nhận thanh toán cọc thành công (Mock PayOS Webhook)
 */
export const confirmMockDeposit = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }

    if (reservation.status !== ReservationStatus.RESERVED) {
      return res.status(400).json({ success: false, message: 'Đơn không ở trạng thái chờ thanh toán cọc.' });
    }

    const breakdown = calculateRentalPaymentBreakdown({
      rentAmount: reservation.estimatedRent,
      depositAmount: reservation.depositAmount,
      taxAmount: reservation.taxAmount || 0,
      discountAmount: reservation.discountAmount || 0,
    });

    // Tạo record thanh toán cọc
    const payment = await ReservationPaymentModel.create({
      reservationId: reservation._id,
      customerId: reservation.customerId,
      facilityId: reservation.facilityId,
      serviceType: reservation.serviceType,
      purpose: PaymentPurpose.DEPOSIT,
      amount: breakdown.depositCredit,
      currency: 'VND',
      idempotencyKey: `deposit-${reservation._id}-${Date.now()}`,
      provider: PaymentProvider.MOCK,
      status: PaymentStatus.SUCCEEDED,
      succeededAt: new Date(),
    });

    reservation.status = ReservationStatus.DEPOSIT_PAID;
    reservation.depositPaymentId = payment._id as any;
    // Chốt cọc: Xóa hạn đếm ngược giữ kho
    (reservation as any).expiresAt = undefined;
    reservation.statusHistory.push({
      status: ReservationStatus.DEPOSIT_PAID,
      actorId: req.user!._id,
      reason: 'Deposit paid successfully. Resource is secured.',
      createdAt: new Date(),
    });
    await reservation.save();

    // Tự động sinh Contract DRAFT sẵn sàng in nếu chưa tồn tại
    let contract = await ContractModel.findOne({ reservationId: reservation._id });
    if (!contract) {
      const profile = await CustomerProfileModel.findOne({ userId: reservation.customerId }).populate('userId', 'fullName email phone');
      const user: any = profile?.userId || {};
      contract = await ContractModel.create({
        contractCode: `CTR-${reservation.reservationCode}`,
        reservationId: reservation._id,
        customerId: reservation.customerId,
        customerSnapshot: {
          identityCard: profile?.identityCard,
          address: profile?.address,
          taxCode: profile?.taxCode,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
        },
        pricingSnapshot: {
          estimatedRent: reservation.estimatedRent,
          depositAmount: reservation.depositAmount,
          pricingPolicyId: reservation.pricingPolicyId,
          totalDue: breakdown.totalDue,
          depositCredit: breakdown.depositCredit,
          balanceDue: breakdown.balanceDue,
        },
        status: ContractStatus.DRAFT,
      });
    }

    return res.json({
      success: true,
      message: 'Thanh toán cọc thành công. Hệ thống đã chốt kho và tạo hợp đồng sẵn sàng in.',
      data: { reservation, payment, contract },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Khách hàng bắt đầu nộp phần tiền còn lại (Balance)
 * CỔNG KHÓA: Hợp đồng phải được Staff xác nhận ký giấy và upload ảnh bằng chứng
 */
export const initiateBalance = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }

    // GATE BẢO VỆ: Hợp đồng phải có ảnh bằng chứng và status SIGNED
    const contract = await ContractModel.findOne({ reservationId: reservation._id });
    if (!contract || contract.status !== ContractStatus.SIGNED || !contract.signedProofUrl) {
      return res.status(409).json({
        success: false,
        message: 'Hợp đồng chưa được Staff xác nhận ký giấy và tải ảnh bằng chứng tại cơ sở. Vui lòng liên hệ nhân viên tại quầy.',
      });
    }

    const breakdown = calculateRentalPaymentBreakdown({
      rentAmount: reservation.estimatedRent,
      depositAmount: reservation.depositAmount,
      taxAmount: reservation.taxAmount || 0,
      discountAmount: reservation.discountAmount || 0,
    });

    return res.json({
      success: true,
      data: {
        reservationId: reservation._id,
        purpose: PaymentPurpose.BALANCE,
        amount: breakdown.balanceDue,
        currency: 'VND',
        breakdown,
        contract: {
          _id: contract._id,
          signedProofUrl: contract.signedProofUrl,
          signedAt: contract.verifiedAt || contract.signedByCustomerAt,
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xác nhận thanh toán phần còn lại (Balance) thành công
 */
export const confirmMockBalance = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }

    // GATE BẢO VỆ
    const contract = await ContractModel.findOne({ reservationId: reservation._id });
    if (!contract || contract.status !== ContractStatus.SIGNED || !contract.signedProofUrl) {
      return res.status(409).json({
        success: false,
        message: 'Hợp đồng chưa được Staff xác nhận ký giấy và tải ảnh bằng chứng tại cơ sở.',
      });
    }

    const breakdown = calculateRentalPaymentBreakdown({
      rentAmount: reservation.estimatedRent,
      depositAmount: reservation.depositAmount,
      taxAmount: reservation.taxAmount || 0,
      discountAmount: reservation.discountAmount || 0,
    });

    const payment = await ReservationPaymentModel.create({
      reservationId: reservation._id,
      customerId: reservation.customerId,
      facilityId: reservation.facilityId,
      serviceType: reservation.serviceType,
      purpose: PaymentPurpose.BALANCE,
      amount: breakdown.balanceDue,
      currency: 'VND',
      idempotencyKey: `balance-${reservation._id}-${Date.now()}`,
      provider: PaymentProvider.MOCK,
      status: PaymentStatus.SUCCEEDED,
      succeededAt: new Date(),
    });

    reservation.status = ReservationStatus.PAID;
    reservation.balancePaymentId = payment._id as any;
    reservation.statusHistory.push({
      status: ReservationStatus.PAID,
      actorId: req.user!._id,
      reason: 'Balance paid successfully. Ready for physical handover.',
      createdAt: new Date(),
    });
    await reservation.save();

    return res.json({
      success: true,
      message: 'Thanh toán số dư (Balance) thành công. Đơn hàng đã sẵn sàng để Staff bàn giao kho.',
      data: { reservation, payment },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Staff bàn giao kho và kích hoạt đơn hàng (Handover)
 */
export const handoverReservation = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (reservation.status !== ReservationStatus.PAID) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể bàn giao đơn đã thanh toán đầy đủ cả cọc và số dư (PAID).',
      });
    }

    reservation.status = ReservationStatus.ACTIVE;
    reservation.handoverByStaffId = req.user!._id;
    reservation.handoverAt = new Date();
    reservation.statusHistory.push({
      status: ReservationStatus.ACTIVE,
      actorId: req.user!._id,
      reason: 'Staff confirmed physical handover. Rental is activated.',
      createdAt: new Date(),
    });
    await reservation.save();

    if (reservation.storageUnitId) {
      await StorageUnitModel.findByIdAndUpdate(reservation.storageUnitId, { status: StorageUnitStatus.OCCUPIED });
    }

    return res.json({
      success: true,
      message: 'Bàn giao kho thành công. Đơn hàng đã chuyển sang trạng thái ACTIVE.',
      data: {
        reservation,
        pinCode: '1234', // Mã PIN mô phỏng được giữ nguyên theo yêu cầu
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

