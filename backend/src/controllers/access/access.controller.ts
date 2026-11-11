import { Request, Response } from 'express';
import AccessLogModel from '../../models/access/access-log.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { AccessAction, AccessMethod } from '../../types/access-log.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ContractStatus } from '../../types/contract.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { UserRole } from '../../types/user.type';

export const simulateUnlock = async (req: Request, res: Response) => {
  try {
    const { reservationCode, reservationId, pinCode } = req.body;

    if (!pinCode || typeof pinCode !== 'string') {
      return res.status(400).json({ success: false, message: 'Thiếu mã PIN truy cập.' });
    }

    const query: any = {};
    if (reservationCode) {
      query.reservationCode = reservationCode;
    } else if (reservationId) {
      query._id = reservationId;
    } else {
      return res.status(400).json({ success: false, message: 'Thiếu mã đơn đặt chỗ (reservationCode hoặc reservationId).' });
    }

    // 1. Tìm Reservation
    const reservation = await ReservationModel.findOne(query);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Invalid Reservation' });
    }

    // Kiểm tra quyền: nếu là Customer thì phải là chủ sở hữu của đơn
    if (req.user && req.user.role === UserRole.CUSTOMER && String(reservation.customerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền mở khóa cho đơn thuê này.' });
    }

    // 2. Kiểm tra nếu đơn bị quá hạn thanh toán (OVERDUE)
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

    // 3. Kiểm tra trạng thái Reservation phải là ACTIVE
    if (reservation.status !== ReservationStatus.ACTIVE) {
      return res.status(403).json({
        success: false,
        message: 'Từ chối truy cập. Kho chưa được kích hoạt, đã trả kho, hoặc đang bị khóa.'
      });
    }

    // 4. Kiểm tra hợp đồng liên quan: Nếu có thì phải ở trạng thái SIGNED
    const contract = await ContractModel.findOne({
      $or: [{ reservationId: reservation._id }, { reservationCode: reservation.reservationCode }]
    });
    if (contract && contract.status !== ContractStatus.SIGNED) {
      return res.status(403).json({
        success: false,
        message: 'Từ chối truy cập. Hợp đồng chưa được ký hoặc đã bị chấm dứt.'
      });
    }

    // 5. Kiểm tra thời hạn thuê
    const now = new Date();
    if (reservation.endDate && new Date(reservation.endDate).getTime() < now.getTime()) {
      return res.status(403).json({
        success: false,
        message: 'Từ chối truy cập. Thời hạn hợp đồng thuê đã kết thúc.'
      });
    }

    // 6. Kiểm tra StorageUnit liên quan: phải ở trạng thái OCCUPIED
    if (reservation.storageUnitId) {
      const storageUnit = await StorageUnitModel.findById(reservation.storageUnitId);
      if (storageUnit && storageUnit.status !== StorageUnitStatus.OCCUPIED) {
        return res.status(403).json({
          success: false,
          message: 'Từ chối truy cập. Kho không ở trạng thái đang sử dụng (OCCUPIED).'
        });
      }
    }

    // 7. Kiểm tra mã PIN động
    const expectedPin = reservation.accessPinCode || '1234';
    if (pinCode.trim() !== expectedPin) {
      const log = await AccessLogModel.create({
        reservationId: reservation._id,
        storageUnitId: reservation.storageUnitId!,
        customerId: reservation.customerId,
        action: AccessAction.UNLOCK_FAILED,
        accessMethod: AccessMethod.PIN_CODE,
        reason: 'Sai mã PIN truy cập'
      });
      return res.status(401).json({ success: false, message: 'Sai mã PIN', data: log });
    }

    // 8. Mở khóa thành công
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
