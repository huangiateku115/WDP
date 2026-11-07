import { Request, Response } from 'express';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import { ReservationService, ReservationError } from '../../services/reservations/reservation.service';
import { ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';
import { UserRole } from '../../types/user.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { ContractStatus } from '../../types/contract.type';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import { PaymentPurpose, PaymentStatus, PaymentProvider } from '../../types/payment.type';
import { calculateRentalPaymentBreakdown } from '../../services/payments/payment-accounting';
import mongoose from 'mongoose';

class ReservationControllerError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function hasTransactionErrorLabel(error: any, label: string): boolean {
  return error?.hasErrorLabel?.(label) === true || error?.errorLabels?.includes?.(label) === true;
}

function isTransactionConflict(error: any): boolean {
  return error?.code === 112 || error?.codeName === 'WriteConflict' ||
    error?.name === 'VersionError' || hasTransactionErrorLabel(error, 'TransientTransactionError');
}

function versionCas(value: unknown, field: string): Record<string, unknown> {
  const version = currentVersion(value);
  return version === 0
    ? { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] }
    : { [field]: version };
}

function currentVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function confirmManagedLegacyMockBalance(reservationId: string, customerId: any) {
  const session = await mongoose.startSession();
  try {
    let result: { reservation: any; payment: any } | undefined;
    await session.withTransaction(async () => {
      const reservation = await ReservationModel.findOne({ _id: reservationId,
        serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $ne: 2 }, customerId })
        .session(session).exec();
      if (!reservation) throw new ReservationControllerError(404, 'Managed reservation not found');

      const priorPayment = await ReservationPaymentModel.findOne({ reservationId: reservation._id,
        purpose: PaymentPurpose.BALANCE, status: PaymentStatus.SUCCEEDED }).session(session).exec();
      if (reservation.status === ReservationStatus.PAID && priorPayment &&
          String(reservation.balancePaymentId) === String(priorPayment._id)) {
        result = { reservation, payment: priorPayment };
        return;
      }
      if (priorPayment) throw new ReservationControllerError(409, 'A successful balance payment already exists for this reservation');
      if (reservation.status !== ReservationStatus.CHECKIN_READY) {
        throw new ReservationControllerError(409, 'Managed balance confirmation requires CHECKIN_READY');
      }

      const contract = await ContractModel.findOne({ reservationId: reservation._id }).session(session).exec();
      if (!contract || contract.status !== ContractStatus.SIGNED || !contract.signedProofUrl) {
        throw new ReservationControllerError(409, 'Signed contract proof is required before balance confirmation');
      }
      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
        depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount || 0,
        discountAmount: reservation.discountAmount || 0 });
      const now = new Date();
      const payment = new ReservationPaymentModel({
        reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
        serviceType: reservation.serviceType, purpose: PaymentPurpose.BALANCE, amount: breakdown.balanceDue,
        currency: 'VND', idempotencyKey: `legacy-balance-${reservation._id}`, provider: PaymentProvider.MOCK,
        status: PaymentStatus.SUCCEEDED, succeededAt: now,
      });
      const version = Number(reservation.inventoryVersion ?? 0);
      const versionFilter = version === 0
        ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
        : { inventoryVersion: version };
      const lockedReservation = await ReservationModel.findOneAndUpdate({ _id: reservation._id,
        customerId: reservation.customerId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        bookingFlowVersion: { $ne: 2 }, status: ReservationStatus.CHECKIN_READY,
        activeClosureRequestId: null, $and: [versionFilter] }, {
        $inc: { inventoryVersion: 1 },
        $set: { status: ReservationStatus.PAID, balancePaymentId: payment._id },
        $push: { statusHistory: { status: ReservationStatus.PAID, actorId: customerId,
          reason: 'Balance paid successfully. Ready for physical handover.', createdAt: now } },
      }, { new: true, session, runValidators: true }).exec();
      if (!lockedReservation) throw new ReservationControllerError(409,
        'Managed reservation changed or closure is pending; reload and retry');

      await payment.save({ session });
      result = { reservation: lockedReservation, payment };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (!result) throw new ReservationControllerError(503, 'Balance confirmation outcome is uncertain; retry safely');
    return result;
  } catch (error: any) {
    if (error instanceof ReservationControllerError) throw error;
    if (error?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
        error?.errorLabels?.includes?.('UnknownTransactionCommitResult')) {
      throw new ReservationControllerError(503, 'Balance confirmation outcome is uncertain; retry safely');
    }
    if (error?.code === 11000 || error?.code === 112 || error?.codeName === 'WriteConflict' || error?.name === 'VersionError' ||
        error?.hasErrorLabel?.('TransientTransactionError')) {
      throw new ReservationControllerError(409, 'Managed reservation changed concurrently; reload and retry');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function confirmManagedLegacyMockDeposit(reservationId: string, customerId: any) {
  const session = await mongoose.startSession();
  const idempotencyKey = `managed-legacy-deposit-${reservationId}`;
  let result: { reservation: any; payment: any; contract: any; idempotent: boolean } | undefined;
  let transactionError: any;
  try {
    await session.withTransaction(async () => {
      const reservation = await ReservationModel.findOne({ _id: reservationId, customerId,
        serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $ne: 2 } })
        .session(session).exec();
      if (!reservation) throw new ReservationControllerError(404, 'Managed reservation not found');

      if (reservation.status === ReservationStatus.DEPOSIT_PAID) {
        const payment = reservation.depositPaymentId
          ? await ReservationPaymentModel.findById(reservation.depositPaymentId).session(session).exec()
          : null;
        const contract = payment ? await ContractModel.findOne({ reservationId: reservation._id }).session(session).exec() : null;
        if (!payment || String(payment.reservationId) !== String(reservation._id) ||
            String(payment.customerId) !== String(customerId) || String(payment.facilityId) !== String(reservation.facilityId) ||
            payment.serviceType !== FacilityServiceType.MANAGED_INVENTORY || payment.purpose !== PaymentPurpose.DEPOSIT ||
            payment.provider !== PaymentProvider.MOCK || payment.status !== PaymentStatus.SUCCEEDED || !contract) {
          throw new ReservationControllerError(409, 'Managed deposit state is inconsistent; reconciliation is required');
        }
        result = { reservation, payment, contract, idempotent: true };
        return;
      }
      if (reservation.status !== ReservationStatus.RESERVED) {
        throw new ReservationControllerError(409, 'Managed deposit confirmation requires RESERVED');
      }

      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
        depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount || 0,
        discountAmount: reservation.discountAmount || 0 });
      const existingKey = await ReservationPaymentModel.findOne({ idempotencyKey }).session(session).exec();
      if (existingKey) throw new ReservationControllerError(409, 'Managed deposit idempotency record already exists; reload and retry');
      const priorSucceeded = await ReservationPaymentModel.findOne({ reservationId: reservation._id,
        purpose: PaymentPurpose.DEPOSIT, status: PaymentStatus.SUCCEEDED }).session(session).exec();
      if (priorSucceeded) throw new ReservationControllerError(409, 'A successful deposit already exists for this reservation');

      // Reservation CAS is the first transaction write and serializes this payment transition with the D08 lifecycle fence.
      const version = Number(reservation.inventoryVersion ?? 0);
      const versionFilter = version === 0
        ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
        : { inventoryVersion: version };
      const now = new Date();
      const payment = new ReservationPaymentModel({
        reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
        serviceType: reservation.serviceType, purpose: PaymentPurpose.DEPOSIT,
        amount: breakdown.depositCredit, currency: 'VND', idempotencyKey,
        provider: PaymentProvider.MOCK, providerReference: `MOCK-LEGACY-DEPOSIT-${reservation._id}`,
        status: PaymentStatus.SUCCEEDED, succeededAt: now,
      });
      const lockedReservation = await ReservationModel.findOneAndUpdate({ _id: reservation._id,
        customerId: reservation.customerId, facilityId: reservation.facilityId,
        serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $ne: 2 },
        status: ReservationStatus.RESERVED, activeClosureRequestId: null, $and: [versionFilter] }, {
        $inc: { inventoryVersion: 1 },
        $set: { status: ReservationStatus.DEPOSIT_PAID, depositPaymentId: payment._id,
          paymentSimulation: { simulated: true, provider: 'MOCK', paidAt: now, actorId: customerId } },
        $unset: { expiresAt: 1 },
        $push: { statusHistory: { status: ReservationStatus.DEPOSIT_PAID, actorId: customerId,
          reason: 'Development/test simulated Managed v1 deposit confirmed; no provider settlement occurred.', createdAt: now } },
      }, { new: true, session, runValidators: true }).exec();
      if (!lockedReservation) throw new ReservationControllerError(409,
        'Managed reservation changed or closure is pending; reload and retry');

      await payment.save({ session });

      let contract = await ContractModel.findOne({ reservationId: reservation._id }).session(session).exec();
      if (!contract) {
        const profile = await CustomerProfileModel.findOne({ userId: reservation.customerId })
          .populate('userId', 'fullName email phone').session(session).exec();
        const user: any = profile?.userId || {};
        contract = new ContractModel({
          contractCode: `CTR-${reservation.reservationCode}`,
          reservationId: reservation._id,
          customerId: reservation.customerId,
          customerSnapshot: { identityCard: profile?.identityCard, address: profile?.address,
            taxCode: profile?.taxCode, fullName: user.fullName, email: user.email, phone: user.phone },
          pricingSnapshot: { estimatedRent: reservation.estimatedRent, depositAmount: reservation.depositAmount,
            pricingPolicyId: reservation.pricingPolicyId, totalDue: breakdown.totalDue,
            depositCredit: breakdown.depositCredit, balanceDue: breakdown.balanceDue },
          status: ContractStatus.DRAFT,
        });
        await contract.save({ session });
      }
      result = { reservation: lockedReservation, payment, contract, idempotent: false };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } catch (error: any) {
    transactionError = error;
  } finally {
    await session.endSession();
  }

  if (transactionError) {
    const unknownCommit = transactionError?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
      transactionError?.errorLabels?.includes?.('UnknownTransactionCommitResult');
    const duplicateOrConflict = transactionError?.code === 11000 || transactionError?.code === 112 ||
      transactionError?.codeName === 'WriteConflict' || transactionError?.hasErrorLabel?.('TransientTransactionError');
    const stateConflict = transactionError instanceof ReservationControllerError && transactionError.status === 409;
    if (unknownCommit || duplicateOrConflict || stateConflict) {
      try {
        const committedReservation = await ReservationModel.findOne({ _id: reservationId, customerId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $ne: 2 },
          status: ReservationStatus.DEPOSIT_PAID }).exec();
        if (committedReservation?.depositPaymentId) {
          const payment = await ReservationPaymentModel.findById(committedReservation.depositPaymentId).exec();
          const contract = payment ? await ContractModel.findOne({ reservationId: committedReservation._id }).exec() : null;
          if (payment && String(payment.reservationId) === String(committedReservation._id) &&
              String(payment.customerId) === String(customerId) && String(payment.facilityId) === String(committedReservation.facilityId) &&
              payment.serviceType === FacilityServiceType.MANAGED_INVENTORY && payment.purpose === PaymentPurpose.DEPOSIT &&
              payment.provider === PaymentProvider.MOCK && payment.status === PaymentStatus.SUCCEEDED &&
              payment.idempotencyKey === idempotencyKey && contract) {
            return { reservation: committedReservation, payment, contract, idempotent: true };
          }
        }
      } catch {
        // The durable outcome could not be verified; never report an uncertain transaction as success.
      }
    }
    if (transactionError instanceof ReservationControllerError) throw transactionError;
    if (unknownCommit) throw new ReservationControllerError(503, 'Managed deposit outcome is uncertain; retry safely');
    if (duplicateOrConflict) throw new ReservationControllerError(409, 'Managed reservation changed concurrently; reload and retry');
    throw transactionError;
  }
  if (!result) throw new ReservationControllerError(503, 'Managed deposit outcome is uncertain; retry safely');
  return result;
}

export const createReservation = async (req: Request, res: Response) => {
  try {
    const { facilityId, storageUnitId, startDate, endDate, pricingPolicyId } = req.body;
    
    if (!facilityId || !storageUnitId || !startDate || !endDate || !pricingPolicyId) {
      return res.status(400).json({ 
        success: false, 
        message: 'facilityId, storageUnitId, startDate, endDate và pricingPolicyId là các trường bắt buộc.' 
      });
    }

    const idempotencyHeader = (typeof req.get === 'function' ? req.get('Idempotency-Key') : undefined)
      ?? req.headers?.['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : undefined;
    const input = {
      customerId: req.user!._id.toString(),
      facilityId,
      storageUnitId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      pricingPolicyId
    };
    if (idempotencyKey) {
      const result = await ReservationService.createReservationWithOutcome({ ...input, idempotencyKey });
      return res.status(result.replayed ? 200 : 201).json({ success: true, data: result.reservation });
    }
    const reservation = await ReservationService.createReservation(input);
    return res.status(201).json({ success: true, data: reservation });
  } catch (error: any) {
    if (error instanceof ReservationError) {
      return res.status(error.code).json({
        success: false,
        message: error.message,
        ...(error.details ? error.details : {})
      });
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
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return res.status(404).json({ success: false, message: 'Mock payment is disabled in this environment.' });
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

    if (reservation.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ success: false, message: 'Managed mock deposit confirmation is disabled in production.' });
      }
      if ((reservation as any).bookingFlowVersion === 2) {
        return res.status(409).json({ success: false, message: 'Use the versioned Managed deposit confirmation endpoint.' });
      }
      const simulationEnvironment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
      if (!simulationEnvironment || process.env.MI_MOCK_PAYMENT_ENABLED !== 'true') {
        return res.status(404).json({ success: false, message: 'Managed mock deposit confirmation is disabled.' });
      }
      const result = await confirmManagedLegacyMockDeposit(String(reservationId), req.user!._id);
      return res.json({ success: true,
        message: 'Managed v1 simulated deposit confirmed; no real provider settlement occurred.',
        data: { reservation: result.reservation, payment: result.payment, contract: result.contract } });
    }

    // Self-Storage MOCK deposits are simulation-only. Do not let this generic
    // endpoint record an unverified MOCK payment as successful in production.
    if (reservation.serviceType === FacilityServiceType.SELF_STORAGE && process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'Mock deposit confirmation is disabled in production.' });
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
    if (error instanceof ReservationControllerError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
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
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'Mock payment confirmation is disabled in production.' });
    }
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }

    if (reservation.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
      if ((reservation as any).bookingFlowVersion === 2) {
        return res.status(409).json({ success: false,
          message: 'Use the versioned Managed balance confirmation endpoint for this reservation.' });
      }
      const result = await confirmManagedLegacyMockBalance(String(reservationId), req.user!._id);
      return res.json({ success: true,
        message: 'Thanh toán số dư (Balance) thành công. Đơn hàng đã sẵn sàng để Staff bàn giao kho.',
        data: result });
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
    if (error instanceof ReservationControllerError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Staff bàn giao kho và kích hoạt đơn hàng (Handover)
 * Giữ nguyên trạng thái vận hành vật lý của StorageUnit (AVAILABLE) để không khóa cứng các đơn đặt ở khung ngày khác.
 */
export const handoverReservation = async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return res.status(404).json({ success: false, message: 'Self-Storage handover is disabled in this environment pending payment verification.' });
    }
    const reservationId = req.params.id;
    const reservation = await ReservationModel.findById(reservationId);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    if (reservation.serviceType !== FacilityServiceType.SELF_STORAGE) {
      return res.status(409).json({ success: false, message: 'Managed Inventory must use its dedicated activation workflow.' });
    }

    const facilityId = String(reservation.facilityId);
    if (!req.user?.assignedFacilityId || String(req.user.assignedFacilityId).toLowerCase() !== facilityId.toLowerCase()) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }

    if (!reservation.storageUnitId) {
      return res.status(409).json({ success: false, message: 'Reservation has no linked StorageUnit.' });
    }
    if (reservation.status === ReservationStatus.ACTIVE) {
      const replayUnit = await StorageUnitModel.findOne({
        _id: reservation.storageUnitId,
        facilityId: reservation.facilityId,
        deletedAt: { $exists: false },
      }).exec();
      if (replayUnit && String(reservation.handoverByStaffId) === String(req.user!._id) && reservation.handoverAt &&
          replayUnit.status === StorageUnitStatus.OCCUPIED) {
        return res.json({ success: true,
          message: 'Bàn giao kho đã được hoàn tất trước đó.',
          data: { reservation, pinCode: '1234' } });
      }
    }
    if (reservation.status !== ReservationStatus.PAID) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể bàn giao đơn đã thanh toán đầy đủ cả cọc và số dư (PAID).',
      });
    }
    const storageUnit = await StorageUnitModel.findOne({
      _id: reservation.storageUnitId,
      facilityId: reservation.facilityId,
      deletedAt: { $exists: false },
    }).exec();
    if (!storageUnit) {
      return res.status(409).json({ success: false, message: 'Reservation and StorageUnit Facility linkage is invalid.' });
    }

    const session = await mongoose.startSession();
    let activatedReservation: any = null;
    let transactionError: any = null;
    try {
      await session.withTransaction(async () => {
        activatedReservation = null;
        // Match ReservationService.createReservation: the StorageUnit bookingVersion write is first.
        const storageUnitWriter: any = StorageUnitModel;
        const reservationWriter: any = ReservationModel;
        const lockedUnit = await storageUnitWriter.findOneAndUpdate({
          _id: reservation.storageUnitId,
          facilityId: reservation.facilityId,
          deletedAt: { $exists: false },
          ...versionCas(storageUnit.bookingVersion, 'bookingVersion'),
        }, { $inc: { bookingVersion: 1 } },
        { new: true, session }).exec();
        if (!lockedUnit) throw new ReservationControllerError(409, 'StorageUnit changed before handover.');

        const handoverAt = new Date();
        activatedReservation = await reservationWriter.findOneAndUpdate({
          _id: reservation._id,
          facilityId: reservation.facilityId,
          serviceType: FacilityServiceType.SELF_STORAGE,
          storageUnitId: reservation.storageUnitId,
          status: ReservationStatus.PAID,
          ...versionCas(reservation.__v, '__v'),
        }, {
          $set: { status: ReservationStatus.ACTIVE, handoverByStaffId: req.user!._id, handoverAt },
          $inc: { __v: 1 },
          $push: { statusHistory: { status: ReservationStatus.ACTIVE, actorId: req.user!._id,
            reason: 'Staff confirmed physical handover. Rental is activated.', createdAt: handoverAt } },
        }, { new: true, session }).exec();
        if (!activatedReservation) throw new ReservationControllerError(409, 'Reservation changed before handover; reload and retry.');

        const occupiedUnit = await storageUnitWriter.findOneAndUpdate({
          _id: reservation.storageUnitId,
          facilityId: reservation.facilityId,
          deletedAt: { $exists: false },
          bookingVersion: currentVersion(storageUnit.bookingVersion) + 1,
        }, { $set: { status: StorageUnitStatus.OCCUPIED } }, { new: true, session }).exec();
        if (!occupiedUnit) throw new ReservationControllerError(409, 'StorageUnit changed before handover could be committed.');
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error: any) {
      transactionError = error;
    } finally {
      await session.endSession();
    }

    if (transactionError) {
      if (hasTransactionErrorLabel(transactionError, 'UnknownTransactionCommitResult')) {
        try {
          const reservationReader: any = ReservationModel;
          const durableReservation = await reservationReader.findOne({
            _id: reservation._id, facilityId: reservation.facilityId, serviceType: FacilityServiceType.SELF_STORAGE,
            storageUnitId: reservation.storageUnitId, status: ReservationStatus.ACTIVE,
            handoverByStaffId: req.user!._id, handoverAt: { $exists: true },
          }).exec();
          const durableUnit = await StorageUnitModel.findOne({
            _id: reservation.storageUnitId, facilityId: reservation.facilityId,
            deletedAt: { $exists: false }, status: StorageUnitStatus.OCCUPIED,
          }).exec();
          if (durableReservation && durableUnit) activatedReservation = durableReservation;
          else return res.status(503).json({ success: false, message: 'Handover outcome is uncertain; verify state before retrying.' });
        } catch {
          return res.status(503).json({ success: false, message: 'Handover outcome is uncertain; verify state before retrying.' });
        }
      } else if (transactionError instanceof ReservationControllerError) {
        return res.status(transactionError.status).json({ success: false, message: transactionError.message });
      } else if (isTransactionConflict(transactionError)) {
        return res.status(409).json({ success: false, message: 'Reservation or StorageUnit changed concurrently; reload and retry.' });
      } else {
        throw transactionError;
      }
    }
    if (!activatedReservation) return res.status(503).json({ success: false, message: 'Handover outcome is uncertain; verify state before retrying.' });

    return res.json({
      success: true,
      message: 'Bàn giao kho thành công. Đơn hàng đã chuyển sang trạng thái ACTIVE.',
      data: {
        reservation: activatedReservation,
        pinCode: '1234', // Mã PIN mô phỏng được giữ nguyên theo yêu cầu
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
