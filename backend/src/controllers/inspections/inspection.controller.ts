import { Request, Response } from 'express';
import InspectionModel from '../../models/inspections/inspection.model';
import { InspectionStatus, InspectionType, UnitCondition } from '../../types/inspection.type';
import ReservationModel from '../../models/reservations/reservation.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { ReservationStatus } from '../../types/reservation.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { FacilityServiceType } from '../../types/facility.type';
import mongoose from 'mongoose';

class InspectionActivationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function hasTransactionErrorLabel(error: any, label: string): boolean {
  return error?.hasErrorLabel?.(label) === true || error?.errorLabels?.includes?.(label) === true;
}

function isTransactionConflict(error: any): boolean {
  return error?.code === 112 || error?.codeName === 'WriteConflict' || error?.name === 'VersionError' ||
    hasTransactionErrorLabel(error, 'TransientTransactionError');
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

export const createInspection = async (req: Request, res: Response) => {
  try {
    const inspection = new InspectionModel({
      ...req.body,
      inspectedBy: req.user!._id
    });
    await inspection.save();
    return res.status(201).json({ success: true, data: inspection });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInspections = async (req: Request, res: Response) => {
  try {
    const filter: any = {};
    if (req.query.reservationId) filter.reservationId = req.query.reservationId;
    if (req.query.storageUnitId) filter.storageUnitId = req.query.storageUnitId;
    
    const inspections = await InspectionModel.find(filter)
      .populate('reservationId', 'reservationCode customerId startDate endDate status')
      .populate('facilityId', 'name')
      .populate('storageUnitId', 'unitCode')
      .populate('inspectedBy', 'fullName email')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: inspections });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const completeInspection = async (req: Request, res: Response) => {
  try {
    const before = await InspectionModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Inspection not found or already completed' });

    if (before.type === InspectionType.CHECK_IN) {
      if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
        return res.status(404).json({ success: false, message: 'Self-Storage CHECK_IN activation is disabled in this environment pending payment verification.' });
      }
      if (before.status !== InspectionStatus.DRAFT) {
        return res.status(409).json({ success: false, message: 'Inspection is already completed.' });
      }

      const linkedReservation = await ReservationModel.findById(before.reservationId).exec();
      if (linkedReservation?.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
        return res.status(409).json({ success: false, message: 'Managed Inventory quota activation does not use Self Storage inspections.' });
      }
      if (!linkedReservation || linkedReservation.serviceType !== FacilityServiceType.SELF_STORAGE ||
          linkedReservation.status !== ReservationStatus.PAID) {
        return res.status(409).json({ success: false, message: 'CHECK_IN activation requires a PAID Self-Storage Reservation.' });
      }
      const reservationFacilityId = String(linkedReservation.facilityId).toLowerCase();
      if (!req.user?.assignedFacilityId || String(req.user.assignedFacilityId).toLowerCase() !== reservationFacilityId ||
          String(before.facilityId).toLowerCase() !== reservationFacilityId ||
          !linkedReservation.storageUnitId || String(before.storageUnitId).toLowerCase() !== String(linkedReservation.storageUnitId).toLowerCase()) {
        return res.status(404).json({ success: false, message: 'Inspection or Reservation not found.' });
      }
      const storageUnit = await StorageUnitModel.findOne({
        _id: before.storageUnitId,
        facilityId: linkedReservation.facilityId,
        deletedAt: { $exists: false },
      }).exec();
      if (!storageUnit) {
        return res.status(409).json({ success: false, message: 'Inspection, Reservation and StorageUnit linkage is invalid.' });
      }

      const session = await mongoose.startSession();
      let completedInspection: any = null;
      let transactionError: any = null;
      try {
        await session.withTransaction(async () => {
          completedInspection = null;
          // Match Self-Storage booking: serialize on StorageUnit before touching Inspection or Reservation.
          const storageUnitWriter: any = StorageUnitModel;
          const inspectionWriter: any = InspectionModel;
          const reservationWriter: any = ReservationModel;
          const lockedUnit = await storageUnitWriter.findOneAndUpdate({
            _id: before.storageUnitId,
            facilityId: before.facilityId,
            deletedAt: { $exists: false },
            ...versionCas(storageUnit.bookingVersion, 'bookingVersion'),
          }, { $inc: { bookingVersion: 1 } },
          { new: true, session }).exec();
          if (!lockedUnit) throw new InspectionActivationError(409, 'StorageUnit changed before CHECK_IN activation.');

          const activated = await reservationWriter.findOneAndUpdate({
            _id: linkedReservation._id,
            serviceType: FacilityServiceType.SELF_STORAGE,
            status: ReservationStatus.PAID,
            facilityId: linkedReservation.facilityId,
            storageUnitId: linkedReservation.storageUnitId,
            ...versionCas(linkedReservation.__v, '__v'),
          }, { $set: { status: ReservationStatus.ACTIVE },
            $inc: { __v: 1 },
            $push: { statusHistory: { status: ReservationStatus.ACTIVE, actorId: req.user!._id,
              reason: 'Hoàn tất bàn giao kho (CHECK_IN)', createdAt: new Date() } } },
          { new: true, session }).exec();
          if (!activated) throw new InspectionActivationError(409, 'Reservation changed before CHECK_IN activation.');

          completedInspection = await inspectionWriter.findOneAndUpdate({
            _id: before._id,
            status: InspectionStatus.DRAFT,
            type: InspectionType.CHECK_IN,
            reservationId: linkedReservation._id,
            facilityId: linkedReservation.facilityId,
            storageUnitId: linkedReservation.storageUnitId,
            ...versionCas(before.__v, '__v'),
          }, { $set: { status: InspectionStatus.COMPLETED }, $inc: { __v: 1 } }, { new: true, session }).exec();
          if (!completedInspection) throw new InspectionActivationError(409, 'Inspection changed before CHECK_IN activation.');

          const occupiedUnit = await storageUnitWriter.findOneAndUpdate({
            _id: before.storageUnitId,
            facilityId: before.facilityId,
            deletedAt: { $exists: false },
            bookingVersion: currentVersion(storageUnit.bookingVersion) + 1,
          }, { $set: { status: StorageUnitStatus.OCCUPIED } }, { new: true, session }).exec();
          if (!occupiedUnit) throw new InspectionActivationError(409, 'StorageUnit changed before CHECK_IN could be committed.');
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } catch (error: any) {
        transactionError = error;
      } finally {
        await session.endSession();
      }

      if (transactionError) {
        if (hasTransactionErrorLabel(transactionError, 'UnknownTransactionCommitResult')) {
          try {
            const inspectionReader: any = InspectionModel;
            const reservationReader: any = ReservationModel;
            const durableInspection = await inspectionReader.findOne({
              _id: before._id, type: InspectionType.CHECK_IN, status: InspectionStatus.COMPLETED,
              reservationId: linkedReservation._id, facilityId: linkedReservation.facilityId,
              storageUnitId: linkedReservation.storageUnitId,
            }).exec();
            const durableReservation = await reservationReader.findOne({
              _id: linkedReservation._id, serviceType: FacilityServiceType.SELF_STORAGE,
              status: ReservationStatus.ACTIVE, facilityId: linkedReservation.facilityId,
              storageUnitId: linkedReservation.storageUnitId,
              statusHistory: { $elemMatch: { status: ReservationStatus.ACTIVE, actorId: req.user!._id,
                reason: 'Hoàn tất bàn giao kho (CHECK_IN)' } },
            }).exec();
            const durableUnit = await StorageUnitModel.findOne({
              _id: linkedReservation.storageUnitId, facilityId: linkedReservation.facilityId,
              deletedAt: { $exists: false }, status: StorageUnitStatus.OCCUPIED,
            }).exec();
            if (durableInspection && durableReservation && durableUnit) completedInspection = durableInspection;
            else return res.status(503).json({ success: false, message: 'CHECK_IN outcome is uncertain; verify state before retrying.' });
          } catch {
            return res.status(503).json({ success: false, message: 'CHECK_IN outcome is uncertain; verify state before retrying.' });
          }
        } else if (transactionError instanceof InspectionActivationError) {
          return res.status(transactionError.status).json({ success: false, message: transactionError.message });
        } else if (isTransactionConflict(transactionError)) {
          return res.status(409).json({ success: false, message: 'Inspection, Reservation or StorageUnit changed concurrently; reload and retry.' });
        } else {
          throw transactionError;
        }
      }
      if (!completedInspection) return res.status(503).json({ success: false, message: 'CHECK_IN outcome is uncertain; verify state before retrying.' });
      return res.json({ success: true, data: completedInspection });
    }

    const linkedReservation = await ReservationModel.findById(before.reservationId).select('serviceType').exec();
    if (linkedReservation?.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
      return res.status(409).json({ success: false, message: 'Managed Inventory quota activation does not use Self Storage inspections.' });
    }
    const inspection = await InspectionModel.findOneAndUpdate(
      { _id: req.params.id, status: InspectionStatus.DRAFT } as any,
      { status: InspectionStatus.COMPLETED }, { new: true }
    );
    if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found or already completed' });
    
    // Nếu là CHECK_IN hoàn tất -> Update Reservation thành ACTIVE (giữ nguyên trạng thái vận hành AVAILABLE của StorageUnit để cho phép đặt lịch các ngày khác)
    if (inspection.type === InspectionType.CHECK_IN) {
      await ReservationModel.findByIdAndUpdate(inspection.reservationId, {
        status: ReservationStatus.ACTIVE,
        $push: {
          statusHistory: {
            status: ReservationStatus.ACTIVE,
            actorId: req.user!._id,
            reason: 'Hoàn tất bàn giao kho (CHECK_IN)'
          }
        }
      });
    } else if (inspection.type === InspectionType.CHECK_OUT) {
      // Nếu là CHECK_OUT hoàn tất -> Chuyển Reservation thành CHECKED_OUT và dọn dẹp StorageUnit
      await ReservationModel.findByIdAndUpdate(inspection.reservationId, {
        status: ReservationStatus.CHECKED_OUT,
        $push: {
          statusHistory: {
            status: ReservationStatus.CHECKED_OUT,
            actorId: req.user!._id,
            reason: 'Hoàn tất nghiệm thu trả kho (CHECK_OUT)'
          }
        }
      });
      
      // Nếu kho bị hỏng hoặc bẩn thì chuyển sang MAINTENANCE để dọn dẹp, ngược lại là AVAILABLE
      const nextUnitStatus = (inspection.condition === UnitCondition.DAMAGED || inspection.condition === UnitCondition.NEEDS_CLEANING)
        ? StorageUnitStatus.MAINTENANCE
        : StorageUnitStatus.AVAILABLE;

      await StorageUnitModel.findByIdAndUpdate(inspection.storageUnitId, {
        status: nextUnitStatus
      });
    }
    
    return res.json({ success: true, data: inspection });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
