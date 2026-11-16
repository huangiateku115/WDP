import ReservationModel from '../models/reservations/reservation.model';
import StorageUnitModel from '../models/storage-units/storage-unit.model';
import ContractModel from '../models/contracts/contract.model';
import { IReservation, ReservationStatus } from '../types/reservation.type';
import { StorageUnitStatus } from '../types/storage-unit.type';
import { ContractStatus } from '../types/contract.type';
import { FacilityServiceType } from '../types/facility.type';
import { EmailService } from '../services/email/email.service';

const sleep = (ms: number) => (process.env.NODE_ENV === 'test' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

export interface SlaCheckResult {
  checkedAt: Date;
  processedCount: number;
  cancelledReservations: Array<{
    reservationId: string;
    reservationCode: string;
    storageUnitId?: string;
    signingDeadline: Date;
    penaltyPercent: number;
  }>;
}

/**
 * Quét các đơn Self-Storage đã thanh toán (PAID) nhưng quá hạn 3 ngày (signingDeadline)
 * mà khách hàng chưa đến cơ sở ký hợp đồng giấy.
 * Tự động hủy đơn, phạt 10% phí giữ kho (hoàn 90% ngoài hệ thống), và giải phóng kho về AVAILABLE.
 */
export async function checkSigningSla(checkTime: Date = new Date()): Promise<SlaCheckResult> {
  const expiredReservations = (await ReservationModel.find({
    serviceType: FacilityServiceType.SELF_STORAGE,
    // New full-upfront bookings require manual review after the signing deadline.
    // Phase 7 owns any cancellation/retention/refund policy; never auto-release here.
    rentalPaymentFlow: { $ne: 'FULL_UPFRONT_V1' },
    status: ReservationStatus.PAID,
    signingDeadline: { $lte: checkTime },
    paperContractProofUrl: { $in: [null, undefined, ''] }
  } as any).exec()) as any[];

  const cancelledReservations: SlaCheckResult['cancelledReservations'] = [];

  for (const reservation of expiredReservations) {
    const now = new Date();
    reservation.status = ReservationStatus.CANCELLED;
    reservation.cancellationReason = 'SIGNING_SLA_EXPIRED';
    reservation.refundPenaltyPercent = 10; // Phạt 10% theo SLA giữ kho, hoàn 90% bằng tay ngoài hệ thống
    reservation.statusHistory.push({
      status: ReservationStatus.CANCELLED,
      reason: 'Quá thời hạn 3 ngày không đến cơ sở ký hợp đồng giấy (Phạt 10%, quản lý hoàn 90% bằng tay ngoài hệ thống)',
      createdAt: now
    });
    await reservation.save();

    // Giải phóng StorageUnit về AVAILABLE
    if (reservation.storageUnitId) {
      await StorageUnitModel.findByIdAndUpdate(reservation.storageUnitId, {
        $set: { status: StorageUnitStatus.AVAILABLE }
      });
    }

    // Hủy Contract liên kết
    await ContractModel.findOneAndUpdate(
      { reservationId: reservation._id },
      { $set: { status: ContractStatus.TERMINATED, updatedAt: now } }
    );

    cancelledReservations.push({
      reservationId: reservation._id.toString(),
      reservationCode: reservation.reservationCode,
      storageUnitId: reservation.storageUnitId?.toString(),
      signingDeadline: reservation.signingDeadline!,
      penaltyPercent: 10
    });

    await EmailService.sendSigningSlaExpiredRentalEmail(reservation).catch(() => {});
    await sleep(200);
  }

  // Quét các yêu cầu gia hạn đã thanh toán (PAID) nhưng quá hạn 3 ngày chưa ký phụ lục giấy
  const expiredExtensionReservations = (await ReservationModel.find({
    'extendContract': {
      $elemMatch: {
        status: 'PAID',
        signingDeadline: { $lte: checkTime },
        paperProofUrl: { $in: [null, undefined, ''] }
      }
    }
  }).exec()) as any[];

  for (const res of expiredExtensionReservations) {
    let modified = false;
    const cancelledExts: any[] = [];
    for (const ext of res.extendContract || []) {
      if (ext.status === 'PAID' && ext.signingDeadline && ext.signingDeadline <= checkTime && !ext.paperProofUrl) {
        ext.status = 'CANCELLED';
        ext.rejectionReason = 'SIGNING_SLA_EXPIRED';
        ext.updatedAt = checkTime;
        res.statusHistory.push({
          status: res.status,
          reason: `Yêu cầu gia hạn ${ext.extensionCode} bị hủy do quá hạn 3 ngày không đến ký phụ lục giấy (Phạt 10%, hoàn 90% ngoài hệ thống)`,
          createdAt: checkTime
        });
        cancelledExts.push(ext);
        modified = true;
      }
    }
    if (modified) {
      await res.save();
      for (const ext of cancelledExts) {
        await EmailService.sendSigningSlaExpiredExtensionEmail(res, ext).catch(() => {});
        await sleep(200);
      }
    }
  }

  return {
    checkedAt: checkTime,
    processedCount: cancelledReservations.length,
    cancelledReservations
  };
}
