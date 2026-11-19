import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import NotificationModel from '../../models/notifications/notification.model';
import { NotificationMethod, NotificationServiceType, NotificationType } from '../../types/notification.type';
import { logOperationalFailure } from '../operations/operational-error.logger';
import { NotificationRecipientResolver } from './notification-recipient-resolver.service';

export interface CreateInAppNotificationParams {
  userId: string | mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  content: string;
  sentVia: NotificationMethod[];
  serviceType?: NotificationServiceType;
  facilityId?: string | mongoose.Types.ObjectId;
  relatedEntityId?: string | mongoose.Types.ObjectId;
  eventIdentity?: string;
  correlationId?: string;
}

export class NotificationService {
  static resolveCustomerId(reservation: any): string | null {
    const rawId = reservation?.customerId?._id ?? reservation?.customerId;
    const userId = String(rawId ?? '');
    return mongoose.Types.ObjectId.isValid(userId) ? userId : null;
  }

  private static async hasDedupeIndex(): Promise<boolean> {
    try {
      const indexes = await NotificationModel.collection.indexes();
      return indexes.some(index => {
        const key = index.key as Record<string, unknown> | undefined;
        const partial = index.partialFilterExpression?.eventKey as Record<string, unknown> | undefined;
        return index.name === 'uniq_notification_user_event_key' && index.unique === true &&
          !!key && Object.keys(key).length === 2 && Object.keys(key)[0] === 'userId' && Object.keys(key)[1] === 'eventKey' &&
          key.userId === 1 && key.eventKey === 1 &&
          !!partial && Object.keys(partial).length === 1 && partial.$type === 'string';
      });
    } catch {
      return false;
    }
  }

  static async isIdempotencyReady(): Promise<boolean> {
    return this.hasDedupeIndex();
  }

  static isManagedV3DeliveryEnabled(): boolean {
    return process.env.MANAGED_V3_FULL_PAYMENT_NOTIFICATIONS_ENABLED?.trim().toLowerCase() === 'true';
  }

  static isManagedCustomerEventsEnabled(): boolean {
    return process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED?.trim().toLowerCase() === 'true';
  }

  /** Persist an event after its durable Managed V3 transition. The caller must pass owner fields from that record. */
  static async notifyManagedCustomerEvent(input: {
    userId: string; type: NotificationType; title: string; content: string;
    facilityId: string; relatedEntityId: string; eventIdentity: string;
  }): Promise<boolean> {
    if (!this.isManagedCustomerEventsEnabled()) return false;
    return this.safeCreate({ ...input, serviceType: 'MANAGED_INVENTORY', sentVia: [NotificationMethod.IN_APP] });
  }

  /**
   * Legacy callers without event identity keep their existing insert behavior.
   * Idempotent callers fail closed until the required unique MongoDB index is provisioned.
   */
  static async safeCreate(params: CreateInAppNotificationParams): Promise<boolean> {
    const correlationId = params.correlationId ?? randomUUID();
    const userId = String(params.userId ?? '');
    if (!mongoose.Types.ObjectId.isValid(userId)) return false;
    const document: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId), type: params.type, title: params.title,
      content: params.content, isRead: false,
      sentVia: Array.isArray(params.sentVia) ? params.sentVia : [NotificationMethod.IN_APP],
      ...(params.serviceType ? { serviceType: params.serviceType } : {}),
      ...(params.facilityId && mongoose.Types.ObjectId.isValid(String(params.facilityId))
        ? { facilityId: new mongoose.Types.ObjectId(String(params.facilityId)) } : {}),
      ...(params.relatedEntityId && mongoose.Types.ObjectId.isValid(String(params.relatedEntityId))
        ? { relatedEntityId: new mongoose.Types.ObjectId(String(params.relatedEntityId)) } : {}),
      ...(params.eventIdentity ? { eventKey: createHash('sha256').update(
        `${params.serviceType ?? 'SELF_STORAGE'}:${userId}:${params.type}:${params.eventIdentity}`,
      ).digest('hex') } : {}),
      ...(params.eventIdentity ? { correlationId } : {}),
    };
    try {
      if (params.eventIdentity) {
        if (!(await this.hasDedupeIndex())) {
          logOperationalFailure({ operation: 'notification.persist', stage: 'dedupe_index_unavailable', provider: 'mongodb',
            error: Object.assign(new Error(), { code: 'NOTIFICATION_DEDUPE_INDEX_UNAVAILABLE' }), correlationId, retryable: true });
          return false;
        }
        const eventKey = document.eventKey as string;
        const result = await (NotificationModel as mongoose.Model<any>).updateOne({ userId: document.userId, eventKey },
          { $setOnInsert: document }, { upsert: true }).exec();
        return result.acknowledged === true;
      }
      await NotificationModel.create(document);
      return true;
    } catch (error: any) {
      if (error?.code === 11000 && params.eventIdentity) return true;
      logOperationalFailure({ operation: 'notification.persist', stage: 'persistence', provider: 'mongodb', error, correlationId, retryable: true });
      return false;
    }
  }

  /** Called only after the backend has committed a verified Managed V3 Full Rent settlement. */
  static async notifyManagedFullPaymentVerified(reservation: any, payment: any, correlationId: string = randomUUID()): Promise<boolean> {
    if (!this.isManagedV3DeliveryEnabled()) return false;
    if (!reservation?._id || !payment?._id || reservation.serviceType !== 'MANAGED_INVENTORY' || reservation.bookingFlowVersion !== 3 ||
        reservation.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || reservation.status !== 'PAID' ||
        String(reservation.fullPaymentId) !== String(payment._id) || String(payment.reservationId) !== String(reservation._id) ||
        String(payment.customerId) !== String(reservation.customerId) || String(payment.facilityId) !== String(reservation.facilityId) ||
        payment.serviceType !== 'MANAGED_INVENTORY' || payment.provider !== 'PAYOS' || payment.status !== 'SUCCEEDED' ||
        payment.providerSettlementStatus !== 'VERIFIED' || payment.applicationStatus !== 'APPLIED' || payment.purpose !== 'FULL_RENT') return false;
    const userId = await NotificationRecipientResolver.resolveReservationCustomer(reservation);
    if (!userId) return false;
    const captureIdentity = payment.providerCaptures?.find((capture: any) => /^[a-f\d]{64}$/i.test(capture?.eventHash ?? ''))?.eventHash;
    if (!captureIdentity) return false;
    const facilityId = String(reservation.facilityId ?? '');
    const total = Number(reservation.rentalPricingSnapshot?.totalDue ?? payment.amount);
    const amount = Number.isFinite(total) ? total.toLocaleString('vi-VN') : '—';
    return this.safeCreate({
      userId, type: NotificationType.MANAGED_FULL_PAYMENT_VERIFIED,
      title: `Đã xác nhận thanh toán đơn Managed ${reservation.reservationCode ?? ''}`.trim(),
      content: `Khoản thanh toán toàn phần ${amount} đ cho dịch vụ lưu kho đã được xác minh. Bạn có thể tiếp tục theo dõi trạng thái hợp đồng trên VaultSpace.`,
      sentVia: [NotificationMethod.IN_APP], serviceType: 'MANAGED_INVENTORY', facilityId,
      relatedEntityId: String(payment._id), eventIdentity: `PAYOS_CAPTURE:${captureIdentity}`, correlationId,
    });
  }
}
