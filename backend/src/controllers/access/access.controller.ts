import { Request, Response } from 'express';
import AccessLogModel from '../../models/access/access-log.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { AccessAction, AccessMethod } from '../../types/access-log.type';
import { ReservationStatus } from '../../types/reservation.type';

export const simulateUnlock = async (req: Request, res: Response) => {
  try {
    const { reservationCode, pinCode } = req.body;
    
    // Tìm Reservation
    const reservation = await ReservationModel.findOne({ reservationCode });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Invalid Reservation' });
    }

    // Giả lập check PIN (Ở hệ thống thật, PIN sẽ sinh và lưu vào DB)
    if (pinCode !== '1234') {
      const log = await AccessLogModel.create({
        reservationId: reservation._id,
        storageUnitId: reservation.storageUnitId!,
        customerId: reservation.customerId,
        action: AccessAction.UNLOCK_FAILED,
        accessMethod: AccessMethod.PIN_CODE,
        reason: 'Sai mã PIN giả lập'
      });
      return res.status(401).json({ success: false, message: 'Sai mã PIN', data: log });
    }

    // Kiểm tra trạng thái Hợp đồng
    if (reservation.status === ReservationStatus.OVERDUE) {
      const log = await AccessLogModel.create({
        reservationId: reservation._id,
        storageUnitId: reservation.storageUnitId!,
        customerId: reservation.customerId,
        action: AccessAction.DENIED_OVERDUE,
        accessMethod: AccessMethod.PIN_CODE,
        reason: 'Khóa do quá hạn thanh toán'
      });
      return res.status(403).json({ success: false, message: 'Kho bị khóa do quá hạn thanh toán.', data: log });
    }

    if (reservation.status !== ReservationStatus.ACTIVE) {
      return res.status(403).json({ success: false, message: 'Từ chối truy cập. Kho chưa được kích hoạt, đã trả kho, hoặc đang bị khóa.' });
    }

    // Mở khóa thành công
    const log = await AccessLogModel.create({
      reservationId: reservation._id,
      storageUnitId: reservation.storageUnitId!,
      customerId: reservation.customerId,
      action: AccessAction.UNLOCK_SUCCESS,
      accessMethod: AccessMethod.PIN_CODE,
      reason: 'Mở cửa thành công'
    });
    
    return res.json({ success: true, message: 'Mở cửa thành công!', data: log });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyAccessLogs = async (req: Request, res: Response) => {
  try {
    const logs = await AccessLogModel.find({ customerId: req.user!._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: logs });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
