import { Request, Response } from 'express';
import InspectionModel from '../../models/inspections/inspection.model';
import { InspectionStatus, InspectionType, UnitCondition } from '../../types/inspection.type';
import ReservationModel from '../../models/reservations/reservation.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { ReservationStatus } from '../../types/reservation.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';

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
    const inspection = await InspectionModel.findOneAndUpdate(
      { _id: req.params.id, status: InspectionStatus.DRAFT } as any,
      { status: InspectionStatus.COMPLETED },
      { new: true }
    );
    if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found or already completed' });
    
    // Nếu là CHECK_IN hoàn tất -> Update Reservation thành ACTIVE và StorageUnit thành OCCUPIED
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
      await StorageUnitModel.findByIdAndUpdate(inspection.storageUnitId, {
        status: StorageUnitStatus.OCCUPIED
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
