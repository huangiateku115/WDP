import ReservationModel from '../models/reservations/reservation.model';
import { ReservationStatus } from '../types/reservation.type';
import { FacilityServiceType } from '../types/facility.type';
import { EmailService } from '../services/email/email.service';

const sleep = (ms: number) =>
  process.env.NODE_ENV === 'test' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

function utcDayBounds(baseDate: Date, offsetDays: number): { start: Date; end: Date } {
  const target = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + offsetDays, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 23, 59, 59, 999)
  );
  return { start: target, end };
}

export interface ExpirationCheckResult {
  checkedAt: Date;
  reminded7Days: number;
  reminded3Days: number;
  notifiedOverdue: number;
}

/**
 * Cron nhắc nhở sắp hết hạn (7 ngày, 3 ngày) và cảnh báo quá hạn (hôm qua).
 * Không chỉnh sửa dữ liệu hay trạng thái trong Database.
 */
export async function checkRentalExpiration(checkTime: Date = new Date()): Promise<ExpirationCheckResult> {
  const day7 = utcDayBounds(checkTime, 7);
  const day3 = utcDayBounds(checkTime, 3);
  const dayMinus1 = utcDayBounds(checkTime, -1);

  const baseFilter = {
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    'checkoutRequest.status': { $ne: 'PENDING' },
  };

  // 1. Nhắc trước 7 ngày
  const expiring7Days = (await (ReservationModel as any)
    .find({
      ...baseFilter,
      endDate: { $gte: day7.start, $lte: day7.end },
    })
    .lean()
    .exec()) as any[];

  let reminded7Days = 0;
  for (const res of expiring7Days) {
    const sent = await EmailService.sendExpiringSoonReminderEmail(res, 7).catch(() => false);
    if (sent) reminded7Days++;
    await sleep(200);
  }

  // 2. Nhắc trước 3 ngày
  const expiring3Days = (await (ReservationModel as any)
    .find({
      ...baseFilter,
      endDate: { $gte: day3.start, $lte: day3.end },
    })
    .lean()
    .exec()) as any[];

  let reminded3Days = 0;
  for (const res of expiring3Days) {
    const sent = await EmailService.sendExpiringSoonReminderEmail(res, 3).catch(() => false);
    if (sent) reminded3Days++;
    await sleep(200);
  }

  // 3. Cảnh báo quá hạn thuê (endDate rơi vào ngày hôm qua)
  const overdueList = (await (ReservationModel as any)
    .find({
      ...baseFilter,
      endDate: { $gte: dayMinus1.start, $lte: dayMinus1.end },
    })
    .lean()
    .exec()) as any[];

  let notifiedOverdue = 0;
  for (const res of overdueList) {
    const sent = await EmailService.sendOverdueRentalEmail(res).catch(() => false);
    if (sent) notifiedOverdue++;
    await sleep(200);
  }

  return {
    checkedAt: checkTime,
    reminded7Days,
    reminded3Days,
    notifiedOverdue,
  };
}
