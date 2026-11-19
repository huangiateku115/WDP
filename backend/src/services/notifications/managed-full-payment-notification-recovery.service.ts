import mongoose from 'mongoose';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { FacilityServiceType } from '../../types/facility.type';
import { PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { NotificationService } from './notification.service';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

export interface ManagedPaymentNotificationRecoveryResult {
  state: 'READY' | 'BLOCKED_INDEX' | 'BLOCKED_DISABLED';
  scanned: number;
  attempted: number;
  deferred: number;
  skipped: number;
  nextAfterId: string | null;
  hasMore: boolean;
}

/** Bounded, idempotent recovery from durable verified Payment + Reservation state. */
export class ManagedFullPaymentNotificationRecoveryService {
  static async recoverBatch(input: { afterId?: string; limit?: number } = {}): Promise<ManagedPaymentNotificationRecoveryResult> {
    const limit = input.limit ?? DEFAULT_BATCH_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
      throw new TypeError(`limit must be an integer between 1 and ${MAX_BATCH_SIZE}`);
    }
    if (input.afterId !== undefined && !mongoose.Types.ObjectId.isValid(input.afterId)) {
      throw new TypeError('afterId must be a Mongo ObjectId');
    }
    const empty = { state: 'BLOCKED_INDEX' as const, scanned: 0, attempted: 0, deferred: 0,
      skipped: 0, nextAfterId: null, hasMore: false };
    if (!NotificationService.isManagedV3DeliveryEnabled()) return { ...empty, state: 'BLOCKED_DISABLED' };
    if (!(await NotificationService.isIdempotencyReady())) return empty;

    const filter: Record<string, unknown> = {
      serviceType: FacilityServiceType.MANAGED_INVENTORY,
      provider: PaymentProvider.PAYOS,
      purpose: PaymentPurpose.FULL_RENT,
      status: PaymentStatus.SUCCEEDED,
      providerSettlementStatus: ProviderSettlementStatus.VERIFIED,
      applicationStatus: PaymentApplicationStatus.APPLIED,
      providerCaptures: { $elemMatch: { eventHash: { $type: 'string' } } },
      ...(input.afterId ? { _id: { $gt: new mongoose.Types.ObjectId(input.afterId) } } : {}),
    };
    const rows = await (ReservationPaymentModel as any).find(filter).sort({ _id: 1 }).limit(limit + 1)
      .select('_id reservationId providerCaptures').lean().exec();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextAfterId = page.length && hasMore ? String(page[page.length - 1]._id) : null;
    if (!page.length) return { state: 'READY', scanned: 0, attempted: 0, deferred: 0, skipped: 0, nextAfterId, hasMore };

    const reservationIds = [...new Map(page.map((row: any) => [String(row.reservationId), row.reservationId])).values()];
    const reservations = await (ReservationModel as any).find({ _id: { $in: reservationIds },
      serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).lean().exec();
    const byId = new Map(reservations.map((row: any) => [String(row._id), row]));
    let attempted = 0, deferred = 0, skipped = 0;
    for (const payment of page) {
      const reservation = byId.get(String(payment.reservationId));
      const capture = payment.providerCaptures?.find((entry: any) => /^[a-f\d]{64}$/i.test(entry?.eventHash ?? ''));
      if (!reservation || !capture) { skipped++; continue; }
      attempted++;
      try {
        const persisted = await NotificationService.notifyManagedFullPaymentVerified(reservation, payment,
          `RECOVERY:${capture.eventHash}`);
        if (!persisted) deferred++;
      } catch {
        deferred++;
      }
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }
}
