import { Request, Response } from 'express';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import { ReservationService, ReservationError } from '../../services/reservations/reservation.service';
import { ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';
import { UserRole } from '../../types/user.type';

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
    if (req.user!.role === UserRole.FACILITY_MANAGER && req.user!.assignedFacilityId?.toString() !== facilityId.toLowerCase()) {
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
    if (req.user!.role === UserRole.FACILITY_MANAGER && req.user!.assignedFacilityId?.toString() !== String(reservationFacilityId)) {
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
