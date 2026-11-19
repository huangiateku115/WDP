import mongoose from 'mongoose';
import VisitModel from '../../models/access/managed-access-visit.model';
import SessionModel from '../../models/access/managed-access-session.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import MovementModel from '../../models/inventory-items/item-movement.model';
import { NotificationService } from './notification.service';
import { NotificationType } from '../../types/notification.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { replayManagedStockMovements } from '../inventory-items/managed-cell-stock.domain';
import { notifySessionTransition, notifyVisitTransition } from '../access/managed-access.service';
import { notifyManagedContractAudit, notifyManagedInboundMovement, notifyManagedOutboundMovement,
  notifyManagedRelocationMovement } from './managed-event-notification.producer';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
type BatchResult = { state: 'READY' | 'BLOCKED_INDEX' | 'BLOCKED_DISABLED'; scanned: number; attempted: number; deferred: number; skipped: number; nextAfterId: string | null; hasMore: boolean };

function validate(input: { afterId?: string; limit?: number }) {
  const limit = input.limit ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) throw new TypeError(`limit must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  if (input.afterId !== undefined && !mongoose.Types.ObjectId.isValid(input.afterId)) throw new TypeError('afterId must be a Mongo ObjectId');
  return limit;
}
function empty(state: BatchResult['state']): BatchResult { return { state, scanned: 0, attempted: 0, deferred: 0, skipped: 0, nextAfterId: null, hasMore: false }; }
async function readiness(): Promise<BatchResult['state'] | null> {
  if (!NotificationService.isManagedCustomerEventsEnabled()) return 'BLOCKED_DISABLED';
  if (!(await NotificationService.isIdempotencyReady())) return 'BLOCKED_INDEX';
  return null;
}
async function readPage(model: any, input: { afterId?: string; limit?: number }, fields: string, baseFilter: Record<string, unknown> = {}) {
  const limit = validate(input);
  const rows = await model.find({ ...baseFilter, ...(input.afterId ? { _id: { $gt: new mongoose.Types.ObjectId(input.afterId) } } : {}) })
    .sort({ _id: 1 }).limit(limit + 1).select(fields).lean().exec();
  const hasMore = rows.length > limit, page = rows.slice(0, limit);
  return { page, hasMore, nextAfterId: page.length && hasMore ? String(page[page.length - 1]._id) : null };
}
function eventRevision(audit: any, fallback?: number) {
  const revision = Number(audit?.details?.eventRevision ?? fallback);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export class ManagedCustomerNotificationRecoveryService {
  static async recoverVisitBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(VisitModel, input,
      '_id reservationId customerId facilityId startsAt endsAt revision status audit', { 'audit.action': { $in: ['VISIT_CREATED', 'VISIT_AMENDED', 'VISIT_CANCELLED', 'VISIT_MARKED_MISSED', 'CUSTOMER_CHECKED_IN', 'CUSTOMER_CHECKED_OUT', 'ACCESS_SESSION_EXPIRED', 'SESSION_REVOKED'] } });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const visit of page) {
      for (const audit of visit.audit ?? []) {
        let type: NotificationType | null = null, identity = '', label = '';
        let schedule: { startsAt?: Date | string; endsAt?: Date | string } | undefined;
        if (audit.action === 'VISIT_CREATED') {
          const index = (visit.audit ?? []).indexOf(audit);
          const wasLaterRescheduled = (visit.audit ?? []).slice(index + 1).some((entry: any) => entry.action === 'VISIT_AMENDED' && entry.details?.scheduleChanged === true);
          if ((!audit.details?.startsAt || !audit.details?.endsAt) && wasLaterRescheduled) { deferred++; continue; }
          if (audit.details?.startsAt && audit.details?.endsAt) schedule = { startsAt: audit.details.startsAt, endsAt: audit.details.endsAt };
          type = NotificationType.MANAGED_VISIT_CREATED; identity = `VISIT:${visit._id}:REV:0:CREATED`; label = 'Đã tạo';
        }
        else if (audit.action === 'VISIT_AMENDED' && audit.details?.scheduleChanged === true) {
          const revision = eventRevision(audit);
          if (revision === null || !audit.details?.startsAt || !audit.details?.endsAt) { deferred++; continue; }
          schedule = { startsAt: audit.details.startsAt, endsAt: audit.details.endsAt };
          type = NotificationType.MANAGED_VISIT_RESCHEDULED; identity = `VISIT:${visit._id}:REV:${revision}:RESCHEDULED`; label = 'Đã đổi';
        } else if (audit.action === 'VISIT_CANCELLED') {
          const revision = eventRevision(audit, visit.revision);
          if (revision === null) { deferred++; continue; }
          type = NotificationType.MANAGED_VISIT_CANCELLED; identity = `VISIT:${visit._id}:REV:${revision}:CANCELLED`; label = 'Đã hủy';
        } else if (audit.action === 'VISIT_MARKED_MISSED') {
          const revision = eventRevision(audit, visit.revision);
          if (revision === null) { deferred++; continue; }
          type = NotificationType.MANAGED_VISIT_NO_SHOW; identity = `VISIT:${visit._id}:REV:${revision}:NO_SHOW`; label = 'Đã ghi nhận vắng mặt';
        } else if (audit.action === 'CUSTOMER_CHECKED_IN') {
          const revision = eventRevision(audit);
          if (revision === null) { deferred++; continue; }
          type = NotificationType.MANAGED_VISIT_CHECKED_IN; identity = `VISIT:${visit._id}:REV:${revision}:CHECKED_IN`; label = 'Đã check-in';
        } else if (['CUSTOMER_CHECKED_OUT', 'ACCESS_SESSION_EXPIRED', 'SESSION_REVOKED'].includes(audit.action)) {
          const revision = eventRevision(audit, visit.status === 'COMPLETED' ? visit.revision : undefined);
          if (revision === null) { deferred++; continue; }
          type = NotificationType.MANAGED_VISIT_COMPLETED; identity = `VISIT:${visit._id}:REV:${revision}:COMPLETED`; label = 'Lượt đến kho đã hoàn tất';
        } else { skipped++; continue; }
        attempted++;
        try { if (!(await notifyVisitTransition(visit, type!, identity, label, schedule))) deferred++; } catch { deferred++; }
      }
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }

  static async recoverSessionBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(SessionModel, input,
      '_id reservationId customerId facilityId visitId expiresAt revision status audit', { 'audit.action': { $in: ['SESSION_ACTIVATED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_EXPIRED_CHECKED_OUT'] } });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const session of page) for (const audit of session.audit ?? []) {
      let type: NotificationType | null = null, identity = '', label = '';
      if (audit.action === 'SESSION_ACTIVATED') { type = NotificationType.MANAGED_ACCESS_SESSION_ISSUED; identity = `SESSION:${session._id}:ISSUED`; label = 'Phiên truy cập đã được cấp'; }
      else if (audit.action === 'SESSION_REVOKED') { type = NotificationType.MANAGED_ACCESS_SESSION_REVOKED; identity = `SESSION:${session._id}:REV:${session.revision}:REVOKED`; label = 'Phiên truy cập đã bị thu hồi'; }
      else if (['SESSION_EXPIRED', 'SESSION_EXPIRED_CHECKED_OUT'].includes(audit.action)) { type = NotificationType.MANAGED_ACCESS_SESSION_EXPIRED; identity = `SESSION:${session._id}:EXPIRED`; label = 'Phiên truy cập đã hết hạn'; }
      else { skipped++; continue; }
      attempted++;
      try { if (!(await notifySessionTransition(session, type, identity, label))) deferred++; } catch { deferred++; }
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }

  static async recoverContractBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(ManagedReservationAuditModel,
      { ...input }, '_id reservationId facilityId actorId action details createdAt', { action: ManagedReservationAction.CONTRACT_SIGNED });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const row of page) {
      if (row.action !== ManagedReservationAction.CONTRACT_SIGNED || !row.reservationId || !row.details?.contractId) { skipped++; continue; }
      attempted++;
      const saved = await notifyManagedContractAudit(row);
      if (!saved) deferred++;
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }

  static async recoverOutboundBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(MovementModel, input,
      '_id itemId managedReservationId facilityId customerId type schemaVersion quantity quantityUnit performedAt referenceCode stockEffect',
      { schemaVersion: 4, type: 'OUTBOUND', 'stockEffect.action': 'REMOVE' });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const movement of page) {
      if (movement.schemaVersion !== 4 || movement.type !== 'OUTBOUND' || movement.stockEffect?.action !== 'REMOVE' ||
          !movement.managedReservationId || !movement.itemId || !movement.customerId) { skipped++; continue; }
      const allMovements: any[] = await (MovementModel as any).find({ itemId: movement.itemId, schemaVersion: 4,
        'stockEffect.ledgerRevision': { $lte: movement.stockEffect.ledgerRevision } }).sort({ 'stockEffect.ledgerRevision': 1, _id: 1 }).lean().exec();
      let replay: any;
      try { replay = replayManagedStockMovements(allMovements); } catch { deferred++; continue; }
      const remainingLots = replay.lots.filter((lot: any) => String(lot.reservationId) === String(movement.managedReservationId));
      const remainingInstances = replay.instances.filter((instance: any) => String(instance.reservationId) === String(movement.managedReservationId) && instance.status === 'PLACED');
      const remaining = remainingLots.reduce((sum: number, row: any) => sum + row.quantityOnHand, 0) + remainingInstances.length;
      attempted++;
      const saved = await notifyManagedOutboundMovement(movement, remaining);
      if (!saved) deferred++;
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }

  static async recoverInboundBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(MovementModel, input,
      '_id itemId managedReservationId facilityId customerId type schemaVersion quantity quantityUnit stockEffect',
      { schemaVersion: 4, type: 'INBOUND', 'stockEffect.action': 'ADD' });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const movement of page) {
      attempted++;
      if (!(await notifyManagedInboundMovement(movement))) deferred++;
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }

  static async recoverRelocationBatch(input: { afterId?: string; limit?: number } = {}): Promise<BatchResult> {
    validate(input); const blocked = await readiness(); if (blocked) return empty(blocked);
    const { page, hasMore, nextAfterId } = await readPage(MovementModel, input,
      '_id itemId managedReservationId facilityId customerId type schemaVersion quantity quantityUnit stockEffect',
      { schemaVersion: 4, type: 'RELOCATION', 'stockEffect.action': 'MOVE' });
    let attempted = 0, deferred = 0, skipped = 0;
    for (const movement of page) {
      attempted++;
      if (!(await notifyManagedRelocationMovement(movement))) deferred++;
    }
    return { state: 'READY', scanned: page.length, attempted, deferred, skipped, nextAfterId, hasMore };
  }
}
