import { Request, Response } from 'express';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { VerificationStatus } from '../../types/customer-profile.type';
import { ReservationStatus } from '../../types/reservation.type';

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;
    let profile = await CustomerProfileModel.findOne({ userId }).populate('userId', 'email phone fullName').exec();
    if (!profile) {
      profile = await CustomerProfileModel.create({ userId });
    }
    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;
    const { identityCard, address, taxCode } = req.body;
    
    // SAFEGUARD: Khóa CCCD nếu đã có hợp đồng đang chạy
    if (identityCard) {
      const activeBookings = await ReservationModel.exists({
        customerId: userId,
        status: { $in: [ReservationStatus.CONTRACTED, ReservationStatus.PAID, ReservationStatus.ACTIVE] }
      });
      if (activeBookings) {
        return res.status(403).json({ success: false, message: 'Không thể cập nhật CCCD do bạn đang có hợp đồng hoạt động (Chống Race Condition).' });
      }
    }
    
    const profile = await CustomerProfileModel.findOneAndUpdate(
      { userId },
      { identityCard, address, taxCode, verificationStatus: VerificationStatus.PENDING },
      { new: true, upsert: true }
    ).populate('userId', 'email phone fullName');
    
    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyProfile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // Profile ID
    const { status, note } = req.body; // VERIFIED or REJECTED
    
    const profile = await CustomerProfileModel.findByIdAndUpdate(
      id,
      { 
        verificationStatus: status, 
        verifiedBy: req.user!._id, 
        verifiedAt: new Date(),
        note 
      },
      { new: true }
    ).populate('userId', 'email phone fullName');
    
    if (!profile) return res.status(404).json({ success: false, message: 'Profile không tồn tại.' });
    
    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const profiles = await CustomerProfileModel.find().populate('userId', 'email phone fullName').exec();
    return res.json({ success: true, data: profiles });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const profile = await CustomerProfileModel.findById(req.params.id).populate('userId', 'email phone fullName').exec();
    if (!profile) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng.' });
    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
