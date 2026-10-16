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
