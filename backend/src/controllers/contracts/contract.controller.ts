import { Request, Response } from 'express';
import ContractModel from '../../models/contracts/contract.model';
import ReservationModel from '../../models/reservations/reservation.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import { ContractStatus } from '../../types/contract.type';
import { ReservationStatus } from '../../types/reservation.type';

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
      .populate('reservationId', 'reservationCode facilityId storageUnitId startDate endDate status');
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    
    // Check permission: FM, Admin, BOM or the owner
    const isOwner = contract.customerId.toString() === req.user!._id.toString();
    const isStaff = ['ADMIN', 'FACILITY_MANAGER', 'BOM'].includes(req.user!.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    return res.json({ success: true, data: contract });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const signContract = async (req: Request, res: Response) => {
  try {
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
    return res.status(500).json({ success: false, message: error.message });
  }
};
