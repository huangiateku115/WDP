import { Request, Response } from 'express';
import ContractModel from '../../models/contracts/contract.model';
import ReservationModel from '../../models/reservations/reservation.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import { ContractStatus } from '../../types/contract.type';
import { ReservationStatus } from '../../types/reservation.type';
import mongoose from 'mongoose';
import { FacilityServiceType } from '../../types/facility.type';
import ManagedFacilityCapacityModel from '../../models/reservations/managed-facility-capacity.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { ManagedCheckinError, ManagedCheckinService } from '../../services/reservations/managed-checkin.service';
import { CloudinaryService } from '../../services/upload/cloudinary.service';

class ContractControllerError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function transactionVersionFilter(versionInput: unknown) {
  const version = Number(versionInput ?? 0);
  return version === 0 ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: version };
}

function assertManagedProofFacilityScope(actor: any, facilityId: any) {
  if ([ 'FACILITY_STAFF', 'FACILITY_MANAGER' ].includes(actor.role) &&
      (!actor.assignedFacilityId || String(actor.assignedFacilityId) !== String(facilityId))) {
    throw new ContractControllerError(404, 'Contract not found');
  }
}

export const getMyContracts = async (req: Request, res: Response) => {
  try {
    const contracts = await ContractModel.find({ customerId: req.user!._id })
      .populate('reservationId', 'reservationCode facilityId storageUnitId startDate endDate status')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: contracts });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getContractById = async (req: Request, res: Response) => {
  try {
    const contract = await ContractModel.findById(req.params.id)
      .populate('reservationId', 'reservationCode facilityId storageUnitId startDate endDate status serviceType');
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    
    // Check permission: FM, Admin, BOM or the owner
    const isOwner = contract.customerId.toString() === req.user!._id.toString();
    const isStaff = ['ADMIN', 'FACILITY_MANAGER', 'FACILITY_STAFF', 'BOM'].includes(req.user!.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }
    if (['FACILITY_MANAGER', 'FACILITY_STAFF'].includes(req.user!.role)) {
      const reservation: any = contract.reservationId;
      if (!req.user!.assignedFacilityId || String(reservation?.facilityId?._id ?? reservation?.facilityId) !== req.user!.assignedFacilityId.toString()) {
        return res.status(404).json({ success: false, message: 'Contract not found' });
      }
    }
    
    return res.json({ success: true, data: contract });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getContractByReservationId = async (req: Request, res: Response) => {
  try {
    const reservationId = req.params.reservationId;
    const contract: any = await (ContractModel as any).findOne({ reservationId })
      .populate('reservationId', 'reservationCode facilityId storageUnitId startDate endDate status serviceType')
      .populate('customerId', 'fullName email phone');
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found for this reservation.' });

    const customerId = contract.customerId?._id ?? contract.customerId;
    const isOwner = customerId?.toString() === req.user!._id.toString();
    const isStaff = ['ADMIN', 'FACILITY_MANAGER', 'FACILITY_STAFF', 'BOM'].includes(req.user!.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
    }
    return res.json({ success: true, data: contract });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const signContract = async (req: Request, res: Response) => {
  try {
    const contracts: any = ContractModel;
    const reservations: any = ReservationModel;
    const existing: any = await contracts.findOne({ _id: req.params.id, customerId: req.user!._id });
    if (existing) {
      const linkedReservation = await reservations.findById(existing.reservationId).select('serviceType facilityId bookingFlowVersion').exec();
      if (linkedReservation?.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
        if (linkedReservation.bookingFlowVersion === 2) {
          const signed = await ManagedCheckinService.signContract(req.params.id, req.user! as any);
          return res.json({ success: true, data: signed });
        }
        if (linkedReservation.bookingFlowVersion === 3) {
          const signed = await ManagedCheckinService.signV3Contract(req.params.id, req.user! as any, 'CUSTOMER');
          return res.json({ success: true, data: signed });
        }
        const session = await mongoose.startSession();
        try {
          let signed: any = null;
          await session.withTransaction(async () => {
            const capacityLock = await ManagedFacilityCapacityModel.findOneAndUpdate(
              { facilityId: linkedReservation.facilityId }, { $inc: { bookingVersion: 1 } }, { new: true, session },
            ).exec();
            if (!capacityLock) return;
            const managedContract = await contracts.findOne({ _id: existing._id, customerId: req.user!._id, status: ContractStatus.DRAFT }).session(session).exec();
            if (!managedContract) return;
            const reservation = await reservations.findOne({ _id: managedContract.reservationId, customerId: req.user!._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, status: ReservationStatus.CONTRACTED, expiresAt: { $gt: new Date() } }).session(session).exec();
            if (!reservation) return;
            managedContract.status = ContractStatus.SIGNED;
            managedContract.signedByCustomerAt = new Date();
            await managedContract.save({ session });
            await new ManagedReservationAuditModel({
              facilityId: reservation.facilityId, reservationId: reservation._id, actorId: req.user!._id,
              action: ManagedReservationAction.CONTRACT_SIGNED, fromStatus: ContractStatus.DRAFT, toStatus: ContractStatus.SIGNED,
            }).save({ session });
            signed = managedContract;
          }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
          if (!signed) return res.status(409).json({ success: false, message: 'Managed contract requires an active, held CONTRACTED reservation.' });
          return res.json({ success: true, data: signed });
        } finally { await session.endSession(); }
      }
    }
    const contract = await ContractModel.findOneAndUpdate(
      { _id: req.params.id, customerId: req.user!._id, status: ContractStatus.DRAFT } as any,
      { 
        status: ContractStatus.SIGNED, 
        signedByCustomerAt: new Date() 
      },
      { new: true }
    );
    if (!contract) return res.status(400).json({ success: false, message: 'Contract cannot be signed (not found or already signed).' });
    return res.json({ success: true, data: contract });
  } catch (error: any) {
    if (error instanceof ManagedCheckinError) return res.status(error.status).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Staff xác nhận đơn đã ký giấy và tải ảnh chụp bằng chứng hợp đồng lên Cloudinary.
 * Cổng này mở khóa quyền thanh toán BALANCE (Đợt 2) cho Khách hàng.
 */
export const confirmSignedPaper = async (req: Request, res: Response) => {
  try {
    const contractId = req.params.id;
    const contract = await ContractModel.findById(contractId);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Hợp đồng không tồn tại.' });
    }

    const reservation = await ReservationModel.findById(contract.reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Đơn đặt chỗ liên kết không tồn tại.' });
    }

    if (reservation.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
      assertManagedProofFacilityScope(req.user!, reservation.facilityId);
      if (reservation.bookingFlowVersion === 3) {
        return res.status(409).json({ success: false, message: 'Managed V3 contracts require the versioned digital-signature flow.' });
      }
      if (reservation.status === ReservationStatus.CHECKIN_READY && contract.status === ContractStatus.SIGNED &&
          contract.signedProofPublicId && contract.verifiedAt) {
        return res.json({ success: true, message: 'Signed-paper proof was already confirmed.', data: { contract, reservation } });
      }
      if (reservation.bookingFlowVersion === 2) {
        return res.status(409).json({ success: false,
          message: 'Version 2 Managed contracts must use the versioned digital-signature and balance flow.' });
      }
      if (reservation.activeClosureRequestId ||
          ![ReservationStatus.CONTRACTED, ReservationStatus.DEPOSIT_PAID].includes(reservation.status)) {
        return res.status(409).json({ success: false,
          message: 'Managed signed-paper confirmation requires an eligible pre-activation reservation with no pending closure.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng tải lên ảnh chụp bằng chứng hợp đồng giấy đã ký.' });
      }

      // The external upload precedes MongoDB commit. If the transaction definitely aborts,
      // delete only this newly uploaded, unattached asset. Unknown commit outcomes are not deleted.
      const uploadResult = await CloudinaryService.uploadBuffer(req.file.buffer, 'wdp/signed-contracts');
      let transactionResult: { contract: any; reservation: any; replayed: boolean } | undefined;
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await ReservationModel.findOne({ _id: reservation._id,
            serviceType: FacilityServiceType.MANAGED_INVENTORY }).session(session).exec();
          if (!current) throw new ContractControllerError(404, 'Đơn đặt chỗ liên kết không tồn tại.');
          assertManagedProofFacilityScope(req.user!, current.facilityId);
          if (current.bookingFlowVersion === 3) {
            throw new ContractControllerError(409, 'Managed V3 contracts require the versioned digital-signature flow.');
          }
          if (current.bookingFlowVersion === 2) {
            throw new ContractControllerError(409, 'Version 2 Managed contracts must use the versioned digital-signature and balance flow.');
          }

          const currentContract = await ContractModel.findOne({ _id: contract._id, reservationId: current._id }).session(session).exec();
          if (!currentContract) throw new ContractControllerError(404, 'Hợp đồng không tồn tại.');
          if (current.status === ReservationStatus.CHECKIN_READY && currentContract.status === ContractStatus.SIGNED &&
              currentContract.signedProofPublicId && currentContract.verifiedAt) {
            transactionResult = { contract: currentContract, reservation: current, replayed: true };
            return;
          }
          if (current.activeClosureRequestId ||
              ![ReservationStatus.CONTRACTED, ReservationStatus.DEPOSIT_PAID].includes(current.status)) {
            throw new ContractControllerError(409,
              'Managed signed-paper confirmation requires an eligible pre-activation reservation with no pending closure.');
          }
          if (![ContractStatus.DRAFT, ContractStatus.SIGNED].includes(currentContract.status)) {
            throw new ContractControllerError(409, 'Contract is not eligible for signed-paper confirmation.');
          }

          const now = new Date();
          const updatedReservation = await ReservationModel.findOneAndUpdate({
            _id: current._id,
            serviceType: FacilityServiceType.MANAGED_INVENTORY,
            bookingFlowVersion: { $nin: [2, 3] },
            status: { $in: [ReservationStatus.CONTRACTED, ReservationStatus.DEPOSIT_PAID] },
            activeClosureRequestId: null,
            $and: [transactionVersionFilter(current.inventoryVersion)],
          }, {
            $inc: { inventoryVersion: 1 },
            $set: { status: ReservationStatus.CHECKIN_READY },
            $push: { statusHistory: { status: ReservationStatus.CHECKIN_READY, actorId: req.user!._id,
              reason: 'Staff confirmed signed paper contract with proof image', createdAt: now } },
          }, { new: true, session, runValidators: true }).exec();
          if (!updatedReservation) throw new ContractControllerError(409,
            'Managed reservation changed or closure is pending; reload and retry.');

          currentContract.signedProofUrl = uploadResult.secureUrl;
          currentContract.signedProofPublicId = uploadResult.publicId;
          currentContract.signedProofUploadedAt = now;
          currentContract.verifiedByStaff = req.user!._id;
          currentContract.verifiedAt = now;
          if (req.body.paperContractNumber) currentContract.paperContractNumber = req.body.paperContractNumber;
          currentContract.status = ContractStatus.SIGNED;
          await currentContract.save({ session });
          await new ManagedReservationAuditModel({ facilityId: updatedReservation.facilityId,
            reservationId: updatedReservation._id, actorId: req.user!._id,
            action: ManagedReservationAction.CONTRACT_SIGNED,
            fromStatus: current.status, toStatus: ContractStatus.SIGNED,
            details: { contractId: currentContract._id, paperProofVerified: true,
              paperContractNumber: currentContract.paperContractNumber } }).save({ session });
          transactionResult = { contract: currentContract, reservation: updatedReservation, replayed: false };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } catch (error: any) {
        const unknownCommit = error?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
          error?.errorLabels?.includes?.('UnknownTransactionCommitResult');
        if (unknownCommit) {
          // Resolve only when both durable records point to this exact uploaded asset.
          const committedContract = await ContractModel.findOne({ _id: contract._id,
            reservationId: reservation._id, signedProofPublicId: uploadResult.publicId });
          const committedReservation = await ReservationModel.findOne({ _id: reservation._id,
            serviceType: FacilityServiceType.MANAGED_INVENTORY, status: ReservationStatus.CHECKIN_READY });
          if (committedContract && committedReservation) {
            return res.json({ success: true, message: 'Xác nhận hợp đồng giấy và tải ảnh bằng chứng lên Cloudinary thành công.',
              data: { contract: committedContract, reservation: committedReservation } });
          }
          throw new ContractControllerError(503, 'Contract confirmation outcome is uncertain; retry safely.');
        }
        try { await CloudinaryService.deleteAsset(uploadResult.publicId); } catch { /* best-effort cleanup of this unattached upload */ }
        if (error instanceof ContractControllerError) throw error;
        if (error?.code === 11000 || error?.code === 112 || error?.codeName === 'WriteConflict' ||
            error?.name === 'VersionError' || error?.hasErrorLabel?.('TransientTransactionError')) {
          throw new ContractControllerError(409, 'Managed reservation or contract changed concurrently; reload and retry.');
        }
        throw error;
      } finally {
        await session.endSession();
      }

      if (!transactionResult) throw new ContractControllerError(503, 'Contract confirmation outcome is uncertain; retry safely.');
      if (transactionResult.replayed) {
        try { await CloudinaryService.deleteAsset(uploadResult.publicId); } catch { /* best-effort cleanup of duplicate upload */ }
      }
      return res.json({ success: true,
        message: 'Xác nhận hợp đồng giấy và tải ảnh bằng chứng lên Cloudinary thành công.',
        data: { contract: transactionResult.contract, reservation: transactionResult.reservation } });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng tải lên ảnh chụp bằng chứng hợp đồng giấy đã ký.' });
    }

    // Upload file ảnh lên Cloudinary folder wdp/signed-contracts
    const uploadResult = await CloudinaryService.uploadBuffer(req.file.buffer, 'wdp/signed-contracts');

    contract.signedProofUrl = uploadResult.secureUrl;
    contract.signedProofPublicId = uploadResult.publicId;
    contract.signedProofUploadedAt = new Date();
    contract.verifiedByStaff = req.user!._id;
    contract.verifiedAt = new Date();
    if (req.body.paperContractNumber) {
      contract.paperContractNumber = req.body.paperContractNumber;
    }
    contract.status = ContractStatus.SIGNED;
    await contract.save();

    // Cập nhật trạng thái đơn đặt chỗ sang CHECKIN_READY để mở quyền thanh toán Balance
    reservation.status = ReservationStatus.CHECKIN_READY;
    reservation.statusHistory.push({
      status: ReservationStatus.CHECKIN_READY,
      actorId: req.user!._id,
      reason: 'Staff confirmed signed paper contract with proof image',
      createdAt: new Date(),
    });
    await reservation.save();

    return res.json({
      success: true,
      message: 'Xác nhận hợp đồng giấy và tải ảnh bằng chứng lên Cloudinary thành công.',
      data: { contract, reservation },
    });
  } catch (error: any) {
    if (error instanceof ContractControllerError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getContractPrintData = async (req: Request, res: Response) => {
  try {
    const contract = await ContractModel.findById(req.params.id)
      .populate('reservationId')
      .populate('customerId', 'fullName email phone');
    if (!contract) return res.status(404).json({ success: false, message: 'Hợp đồng không tồn tại.' });
    return res.json({ success: true, data: contract });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

