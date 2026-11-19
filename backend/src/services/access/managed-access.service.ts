import { createHash } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import VisitModel from '../../models/access/managed-access-visit.model';
import SessionModel from '../../models/access/managed-access-session.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import PaymentModel from '../../models/payments/reservation-payment.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import UserModel from '../../models/users/user.model';
import FacilityModel from '../../models/facilities/facility.model';
import { ContractStatus } from '../../types/contract.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { IUser, UserRole } from '../../types/user.type';
import { ACCESS_SESSION_MAX_DURATION_MINUTES, IManagedAccessSession, IManagedAccessVisit, ManagedAccessAudit, ManagedAccessPurpose, ManagedAccessVisitPurpose, ManagedAccessSessionStatus as SS, ManagedAccessVisitStatus as VS } from '../../types/managed-access.type';
import { PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { accessSessionCoversReservations, isAccessSessionAllowed, sessionExpiry, sessionIsCurrent } from './managed-access-policy';
import { isManagedVisitDateBookable, managedVisitDateRange, managedVisitSlots, MANAGED_VISIT_MAX_DAYS_AHEAD } from './managed-visit-schedule';
import { NotificationService } from '../notifications/notification.service';
import { NotificationRecipientResolver } from '../notifications/notification-recipient-resolver.service';
import { NotificationType } from '../../types/notification.type';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
export class ManagedAccessError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export async function notifyVisitTransition(visit: any, type: NotificationType, eventIdentity: string, statusLabel: string,
  schedule?: { startsAt?: Date | string; endsAt?: Date | string }): Promise<boolean> {
  try {
    if (!NotificationService.isManagedCustomerEventsEnabled()) return false;
    if (!visit?._id || !visit?.customerId || !visit?.facilityId || !visit?.reservationId) return false;
    const reservation: any = await ReservationModel.findOne({ _id: visit.reservationId, customerId: visit.customerId,
      facilityId: visit.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).select('_id customerId').lean().exec();
    if (!reservation) return false;
    const userId = await NotificationRecipientResolver.resolveReservationCustomer(reservation);
    if (!userId) return false;
    const facility: any = await FacilityModel.findById(visit.facilityId).select('name').lean().exec();
    const start = new Date(schedule?.startsAt ?? visit.startsAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return NotificationService.notifyManagedCustomerEvent({ userId, type,
      title: `${statusLabel} lịch đến kho`,
      content: `${facility?.name || 'Cơ sở Managed Inventory'} · ${start}. Mã lịch: ${String(visit._id)}.`,
      facilityId: String(visit.facilityId), relatedEntityId: String(visit._id), eventIdentity });
  } catch { return false; /* notification failure must never change the committed access operation */ }
}
export async function notifySessionTransition(session: any, type: NotificationType, eventIdentity: string, statusLabel: string): Promise<boolean> {
  try {
    if (!NotificationService.isManagedCustomerEventsEnabled()) return false;
    if (!session?._id || !session?.customerId || !session?.facilityId) return false;
    const userId = await NotificationRecipientResolver.resolveReservationCustomer({ customerId: session.customerId });
    if (!userId) return false;
    const facility: any = await FacilityModel.findById(session.facilityId).select('name').lean().exec();
    const until = session.expiresAt ? new Date(session.expiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
    return NotificationService.notifyManagedCustomerEvent({ userId, type,
      title: statusLabel,
      content: `${facility?.name || 'Cơ sở Managed Inventory'}${until ? ` · Phiên có hiệu lực đến ${until}` : ''}. Tham chiếu: ${String(session._id)}.`,
      facilityId: String(session.facilityId), relatedEntityId: String(session._id), eventIdentity });
  } catch { return false; /* notification failure must never change the committed access operation */ }
}
function fail(status: number, code: string, message: string): never { throw new ManagedAccessError(status, code, message); }
const asId = (v: unknown, name: string) => { if (typeof v !== 'string' || !/^[a-f\d]{24}$/i.test(v)) fail(400, 'INVALID_INPUT', `${name} không hợp lệ.`); return new Types.ObjectId(v); };
const reqKey = (v: unknown) => { if (typeof v !== 'string' || !/^[\w.:/-]{8,160}$/.test(v)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ (8–160 ký tự).'); return v; };
const plain = (v: unknown, keys: string[], label: string) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v as object).some(k => !keys.includes(k))) fail(400, 'INVALID_INPUT', `${label} không hợp lệ.`); return v as Record<string, unknown>; };
const actorData = (actor: Actor) => ({ actorId: actor._id, actorRole: actor.role });
function scope(actor: Actor, facilityId: Types.ObjectId) {
  if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role) || !actor.assignedFacilityId || !actor.assignedFacilityId.equals(facilityId)) fail(403, 'FACILITY_SCOPE_DENIED', 'Cơ sở nằm ngoài phạm vi được phân công.');
}
function requireRole(actor: Actor, roles: UserRole[]) { if (!roles.includes(actor.role)) fail(403, 'ROLE_DENIED', 'Vai trò không được phép thực hiện thao tác này.'); }
function iso(v: unknown, label: string) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) fail(400, 'INVALID_INPUT', `${label} phải là thời gian ISO UTC.`);
  const d = new Date(v), normalized = v.replace(/Z$/, v.includes('.') ? 'Z' : '.000Z'); if (!Number.isFinite(d.getTime()) || d.toISOString() !== normalized) fail(400, 'INVALID_INPUT', `${label} không hợp lệ.`); return d;
}
function audit(action: string, actor: Actor, at: Date, details?: Record<string, unknown>): ManagedAccessAudit { return { action, ...actorData(actor), at, ...(details ? { details } : {}) }; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function markMissedVisits(filter: Record<string, unknown>, now: Date, limit = 500) {
  const rows = await VisitModel.find({ ...filter, status: VS.SCHEDULED, endsAt: { $lte: now } })
    .select('_id revision').sort({ endsAt: 1, _id: 1 }).limit(limit).lean().exec();
  if (!rows.length) return 0;
  const result = await VisitModel.bulkWrite(rows.map(row => ({ updateOne: {
    filter: { _id: row._id, status: VS.SCHEDULED, endsAt: { $lte: now } },
    update: { $set: { status: VS.MISSED }, $inc: { revision: 1 }, $push: { audit: {
      action: 'VISIT_MARKED_MISSED', actorRole: 'SYSTEM', at: now,
      details: { reason: 'Scheduled window ended without Staff check-in', eventRevision: Number(row.revision ?? 0) + 1 },
    } } },
  } })), { ordered: false });
  if (NotificationService.isManagedCustomerEventsEnabled()) {
    try {
      const persisted = await VisitModel.find({ _id: { $in: rows.map(row => row._id) }, status: VS.MISSED,
        'audit.action': 'VISIT_MARKED_MISSED' }).lean().exec();
      for (const visit of persisted) {
        const event = [...(visit.audit ?? [])].reverse().find((entry: any) => entry.action === 'VISIT_MARKED_MISSED');
        const revision = Number(event?.details?.eventRevision ?? visit.revision);
        if (Number.isSafeInteger(revision) && revision >= 0) await notifyVisitTransition(visit, NotificationType.MANAGED_VISIT_NO_SHOW,
          `VISIT:${visit._id}:REV:${revision}:NO_SHOW`, 'Đã ghi nhận vắng mặt');
      }
    } catch { /* a missed Visit remains persisted; the bounded Visit recovery can retry its event */ }
  }
  return result.modifiedCount;
}
function windowInput(input: Record<string, unknown>, now: Date) {
  const startsAt = iso(input.startsAt, 'startsAt'), endsAt = iso(input.endsAt, 'endsAt');
  if (startsAt < new Date(now.getTime() - 5 * 60_000) || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 8 * 60 * 60_000) fail(400, 'INVALID_VISIT_WINDOW', 'Khung giờ phải hợp lệ, tối đa 8 tiếng và không bắt đầu quá 5 phút trong quá khứ.');
  const startsAtDateVN = new Date(startsAt.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
  if (!isManagedVisitDateBookable(startsAtDateVN, now)) fail(400, 'VISIT_DATE_OUT_OF_RANGE', `Chỉ có thể đặt hoặc sửa lịch đến kho trong ${MANAGED_VISIT_MAX_DAYS_AHEAD} ngày tới.`);
  return { startsAt, endsAt };
}
function v3Purpose(value: unknown): ManagedAccessPurpose {
  if (!Object.values(ManagedAccessPurpose).includes(value as ManagedAccessPurpose)) fail(400, 'INVALID_PURPOSE', 'Mục đích truy cập không hợp lệ.'); return value as ManagedAccessPurpose;
}
export function normalizedReservationScope(primaryId: Types.ObjectId, input: unknown, allowMissing = false) {
  if (input === undefined && allowMissing) return [primaryId];
  if (!Array.isArray(input) || input.length === 0) fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation scope phải là danh sách không rỗng.');
  let ids: Types.ObjectId[];
  try { ids = input.map(value => {
    if (!(value instanceof Types.ObjectId) && (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))) throw new Error('invalid id');
    return new Types.ObjectId(String(value));
  }); }
  catch { return fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation scope chứa ID không hợp lệ.'); }
  const normalized = ids.map(value => value.toHexString());
  if (new Set(normalized).size !== normalized.length || !ids.some(value => value.equals(primaryId))) {
    fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation scope phải có primary ID và không được trùng.');
  }
  return [primaryId, ...ids.filter(value => !value.equals(primaryId)).sort((a, b) => a.toHexString().localeCompare(b.toHexString()))];
}
async function findCustomerReservation(reservationId: Types.ObjectId, customerId: Types.ObjectId) {
  const r = await ReservationModel.findOne({ _id: reservationId, customerId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).exec();
  if (!r) fail(404, 'RESERVATION_NOT_FOUND', 'Không tìm thấy đơn thuê Managed Inventory V3.'); return r;
}
async function assertFacility(facilityId: Types.ObjectId) {
  const f = await FacilityModel.findOne({ _id: facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).select('_id').lean().exec();
  if (!f) fail(409, 'FACILITY_UNAVAILABLE', 'Cơ sở Managed Inventory không khả dụng.');
}
async function availableVisitSlots(reservation: IReservation, date: unknown, now: Date, dbSession?: mongoose.ClientSession,
  facilitySnapshot?: any, excludeVisitId?: unknown) {
  if (!managedVisitDateRange(date)) fail(400, 'INVALID_VISIT_DATE', 'Ngày đến kho không hợp lệ.');
  if (!isManagedVisitDateBookable(date, now)) fail(400, 'VISIT_DATE_OUT_OF_RANGE', `Chỉ có thể đặt lịch đến kho trong ${MANAGED_VISIT_MAX_DAYS_AHEAD} ngày tới.`);
  const facility: any = facilitySnapshot ?? await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
    serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).select('name managedVisitSchedule')
    .session(dbSession ?? null).lean().exec();
  if (!facility) fail(409, 'FACILITY_UNAVAILABLE', 'Cơ sở Managed Inventory không khả dụng.');
  const schedule = facility.managedVisitSchedule;
  if (!schedule) fail(409, 'VISIT_SCHEDULE_NOT_CONFIGURED', 'Cơ sở chưa cấu hình giờ hoạt động và thời lượng lịch đến kho.');
  const day = managedVisitDateRange(date);
  if (!day) fail(400, 'INVALID_VISIT_DATE', 'Ngày đến kho không hợp lệ.');
  const [staffCapacity, visits] = await Promise.all([
    UserModel.countDocuments({ role: UserRole.FACILITY_STAFF, assignedFacilityId: reservation.facilityId, isActive: true }).session(dbSession ?? null).exec(),
    (VisitModel as any).find({ facilityId: reservation.facilityId, status: { $in: [VS.SCHEDULED, VS.CHECKED_IN] },
      startsAt: { $lt: day.end }, endsAt: { $gt: day.start }, ...(excludeVisitId ? { _id: { $ne: excludeVisitId } } : {}) })
      .select('startsAt endsAt').session(dbSession ?? null).lean().exec(),
  ]);
  let slots: Array<{ startsAt: string; endsAt: string }>;
  try {
    slots = managedVisitSlots({ date, schedule, now, reservationStartDate: reservation.startDate,
      reservationEndDate: reservation.endDate, staffCapacity,
      overlappingVisitCount: (startsAt, endsAt) => visits.filter((visit: any) => visit.startsAt < endsAt && visit.endsAt > startsAt).length });
  } catch (error: any) {
    if (error?.message === 'VISIT_DATE_INVALID') fail(400, 'INVALID_VISIT_DATE', 'Ngày đến kho không hợp lệ.');
    if (error?.message === 'VISIT_DATE_OUT_OF_RANGE') fail(400, 'VISIT_DATE_OUT_OF_RANGE', `Chỉ có thể đặt lịch đến kho trong ${MANAGED_VISIT_MAX_DAYS_AHEAD} ngày tới.`);
    fail(409, 'VISIT_SCHEDULE_INVALID', 'Cấu hình giờ hoạt động của Facility không hợp lệ.');
  }
  return { slots, facility };
}
async function activeCells(reservation: IReservation, session?: mongoose.ClientSession, at?: Date) {
  const dateFilter = at
    ? { startDate: { $lte: at }, endDate: { $gt: at } }
    : { startDate: { $lte: reservation.startDate }, endDate: { $gte: reservation.endDate } };
  const rows = await CellAllocationModel.find({ reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    cellId: { $in: reservation.allocatedCellIds ?? [] }, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] }, ...dateFilter })
    .select('cellId').session(session ?? null).lean().exec();
  const ids = [...new Set(rows.map(x => String(x.cellId)))];
  if (!reservation.allocatedCellIds?.length || ids.length !== reservation.allocatedCellIds.length) fail(409, 'ALLOCATION_INVALID', 'Cell allocation không còn hợp lệ cho Reservation.');
  return reservation.allocatedCellIds;
}
async function cellsCoveringWindow(reservation: IReservation, startsAt: Date, endsAt: Date, session?: mongoose.ClientSession) {
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date) || !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt || startsAt < reservation.startDate || endsAt > reservation.endDate) {
    fail(409, 'ALLOCATION_INVALID', 'Khung giờ không nằm trọn trong kỳ phân bổ Cell của Reservation.');
  }
  const rows = await CellAllocationModel.find({ reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    cellId: { $in: reservation.allocatedCellIds ?? [] }, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] },
    startDate: { $lte: startsAt }, endDate: { $gte: endsAt } }).select('cellId').session(session ?? null).lean().exec();
  const ids = [...new Set(rows.map(row => String(row.cellId)))];
  if (!reservation.allocatedCellIds?.length || ids.length !== reservation.allocatedCellIds.length) {
    fail(409, 'ALLOCATION_INVALID', 'Cell allocation không bao phủ toàn bộ Visit hoặc không còn đúng Customer/Facility.');
  }
  return reservation.allocatedCellIds;
}
const systemAudit = (action: string, at: Date, details?: Record<string, unknown>): ManagedAccessAudit => ({ action, actorRole: 'SYSTEM', at, ...(details ? { details } : {}) });
function sessionReservationScopeFilter(reservationIds: Types.ObjectId[]) {
  return { $or: [{ reservationId: { $in: reservationIds } }, { scopedReservationIds: { $in: reservationIds } }] };
}
export function activeSessionScopeFilter(reservationIds: Types.ObjectId[], at: Date) {
  return { ...sessionReservationScopeFilter(reservationIds), status: SS.ACTIVE, expiresAt: { $gt: at } };
}
async function reconcileExpiredReservationSessions(reservationIds: Types.ObjectId[], now: Date, dbSession: mongoose.ClientSession) {
  const rows = await SessionModel.find({ ...sessionReservationScopeFilter(reservationIds), status: SS.ACTIVE, expiresAt: { $lte: now } })
    .sort({ expiresAt: 1 }).session(dbSession).lean().exec();
  for (const row of rows) {
    const ended = await SessionModel.findOneAndUpdate({ _id: row._id, status: SS.ACTIVE, expiresAt: { $lte: now } },
      { $set: { status: SS.EXPIRED, endedAt: row.expiresAt }, $inc: { revision: 1 },
        $push: { audit: systemAudit('SESSION_EXPIRED', row.expiresAt, { visitId: String(row.visitId), reconciliationAt: now.toISOString() }) } },
      { returnDocument: 'after', session: dbSession }).exec();
    if (!ended) continue;
    const closed: any = await (VisitModel as any).findOneAndUpdate({ _id: ended.visitId, reservationId: ended.reservationId, status: VS.CHECKED_IN },
      { $set: { status: VS.COMPLETED, checkedOutAt: ended.expiresAt }, $inc: { revision: 1 },
        $push: { audit: systemAudit('ACCESS_SESSION_EXPIRED', ended.expiresAt, { sessionId: String(ended._id) }) } },
      { returnDocument: 'after', session: dbSession }).exec();
    if (!closed) fail(409, 'EXPIRY_RECONCILIATION_CONFLICT', 'Expired Session Visit state is inconsistent; reconciliation was rolled back.');
  }
}
function visitIdemHash(input: Record<string, unknown>, reservationId: Types.ObjectId) { return hash({ reservationId: String(reservationId), additionalReservationIds: input.additionalReservationIds ?? [], startsAt: input.startsAt, endsAt: input.endsAt, note: input.note ?? '' }); }
function legacyVisitIdemHash(input: Record<string, unknown>, reservationId: Types.ObjectId) { return hash({ reservationId: String(reservationId), additionalReservationIds: input.additionalReservationIds ?? [], purpose: input.purpose, startsAt: input.startsAt, endsAt: input.endsAt, note: input.note ?? '' }); }
function facilityVisitIdemHash(input: Record<string, unknown>, facilityId: Types.ObjectId) { return hash({ facilityId: String(facilityId), startsAt: input.startsAt, endsAt: input.endsAt, note: input.note ?? '' }); }
const SESSION_RESERVATION_MIN_REMAINING_MS = 7 * 24 * 60 * 60_000;
function visitScopeEnd(endsAt: Date) { return new Date(endsAt.getTime() + SESSION_RESERVATION_MIN_REMAINING_MS); }

export class ManagedAccessService {
  static async visitAvailability(reservationIdInput: unknown, dateInput: unknown, actor: Actor, facilityIdInput?: unknown) {
    requireRole(actor, [UserRole.CUSTOMER]);
    const now = new Date();
    // Legacy deep links may still pass a Reservation. New Customer booking is date based;
    // the backend returns slots for facilities where this Customer has an eligible rental.
    if (reservationIdInput !== undefined && reservationIdInput !== null && reservationIdInput !== '') {
      const reservation = await findCustomerReservation(asId(reservationIdInput, 'reservationId'), actor._id);
      if (![ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE].includes(reservation.status) || reservation.endDate <= now) {
        fail(409, 'RESERVATION_NOT_VISIT_READY', 'Reservation chưa đủ điều kiện đặt lịch đến kho.');
      }
      const result = await availableVisitSlots(reservation, dateInput, now);
      return { timeZone: 'Asia/Ho_Chi_Minh', slotDurationMinutes: result.facility.managedVisitSchedule.slotDurationMinutes,
        capacityBasis: 'ACTIVE_STAFF_ACCOUNTS_MINUS_OVERLAPPING_VISITS', staffAssignmentRequired: true, slots: result.slots };
    }

    const day = managedVisitDateRange(dateInput);
    if (!day) fail(400, 'INVALID_VISIT_DATE', 'Ngày đến kho không hợp lệ.');
    if (!isManagedVisitDateBookable(dateInput, now)) fail(400, 'VISIT_DATE_OUT_OF_RANGE', `Chỉ có thể đặt lịch đến kho trong ${MANAGED_VISIT_MAX_DAYS_AHEAD} ngày tới.`);
    const facilityId = facilityIdInput ? asId(facilityIdInput, 'facilityId') : undefined;
    const scopeEnd = new Date(day.start.getTime() + SESSION_RESERVATION_MIN_REMAINING_MS);
    let reservationQuery: any = ReservationModel.find({ customerId: actor._id, ...(facilityId ? { facilityId } : {}),
      serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
      startDate: { $lte: now }, endDate: { $gt: scopeEnd } });
    reservationQuery = reservationQuery.sort({ facilityId: 1, startDate: 1, _id: 1 }).limit(101);
    const eligibleReservations: IReservation[] = await reservationQuery.lean().exec();
    if (eligibleReservations.length > 100) fail(409, 'RESERVATION_SCOPE_TOO_LARGE', 'Có quá nhiều đơn thuê để tìm lịch an toàn. Hãy chọn lại sau hoặc liên hệ Facility.');
    const groups = new Map<string, IReservation[]>();
    for (const reservation of eligibleReservations) {
      const key = String(reservation.facilityId), rows = groups.get(key) ?? [];
      rows.push(reservation); groups.set(key, rows);
    }
    const slots: Array<{ startsAt: string; endsAt: string; facilityId: string; facilityName: string }> = [];
    let slotDurationMinutes: number | undefined;
    for (const [groupFacilityId, rows] of groups) {
      const seen = new Set<string>();
      for (const reservation of rows) {
        const result = await availableVisitSlots(reservation, dateInput, now);
        slotDurationMinutes = result.facility.managedVisitSchedule.slotDurationMinutes;
        for (const slot of result.slots) {
          const key = `${slot.startsAt}|${slot.endsAt}`;
          if (seen.has(key)) continue;
          seen.add(key);
          slots.push({ ...slot, facilityId: groupFacilityId, facilityName: result.facility.name || 'Cơ sở Managed Inventory' });
        }
      }
    }
    slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.facilityName.localeCompare(right.facilityName));
    return { timeZone: 'Asia/Ho_Chi_Minh', slotDurationMinutes: slotDurationMinutes ?? null,
      capacityBasis: 'ACTIVE_STAFF_ACCOUNTS_MINUS_OVERLAPPING_VISITS', staffAssignmentRequired: true,
      reservationScopeAvailable: eligibleReservations.length > 0,
      reservationScopePolicy: 'ACTIVE_SAME_FACILITY_WITH_MORE_THAN_7_DAYS_REMAINING_AT_VISIT', slots };
  }

  static async createVisit(body: unknown, actor: Actor, idempotencyHeader: unknown) {
    // `purpose` is accepted only to reconcile a previously submitted legacy request;
    // it is intentionally ignored for all new Visit authorization decisions.
    requireRole(actor, [UserRole.CUSTOMER]); const input = plain(body, ['reservationId', 'facilityId', 'additionalReservationIds', 'purpose', 'startsAt', 'endsAt', 'note'], 'Lịch đến kho');
    if (input.purpose !== undefined) v3Purpose(input.purpose);
    const requestedReservationId = input.reservationId === undefined ? undefined : asId(input.reservationId, 'reservationId');
    const requestedFacilityId = input.facilityId === undefined ? undefined : asId(input.facilityId, 'facilityId');
    if (!requestedReservationId && !requestedFacilityId) fail(400, 'INVALID_INPUT', 'Cần cơ sở để đặt lịch đến kho.');
    if (requestedReservationId && requestedFacilityId) fail(400, 'INVALID_INPUT', 'Chỉ gửi facilityId; không cần chọn Reservation khi đặt lịch mới.');
    const now = new Date(), window = windowInput(input, now);
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)) fail(400, 'INVALID_INPUT', 'Ghi chú tối đa 500 ký tự.');
    const key = reqKey(idempotencyHeader), requestHash = requestedFacilityId ? facilityVisitIdemHash(input, requestedFacilityId) : visitIdemHash(input, requestedReservationId!);
    const replay = await VisitModel.findOne({ customerId: actor._id, idempotencyKey: key }).exec();
    if (replay) {
      const legacyHashMatches = requestedReservationId && replay.requestHash === legacyVisitIdemHash(input, requestedReservationId);
      if (replay.requestHash !== requestHash && !legacyHashMatches) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với nội dung khác.');
      return replay;
    }
    let reservation: IReservation;
    if (requestedReservationId) reservation = await findCustomerReservation(requestedReservationId, actor._id);
    else {
      const minimumEnd = visitScopeEnd(window.endsAt);
      let anchorQuery: any = (ReservationModel as any).findOne({ customerId: actor._id, facilityId: requestedFacilityId,
        serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
        startDate: { $lte: now }, endDate: { $gt: minimumEnd } });
      reservation = await anchorQuery.sort({ startDate: 1, _id: 1 }).exec();
      if (!reservation) fail(409, 'RESERVATION_VISIT_SCOPE_UNAVAILABLE', 'Không có đơn thuê Managed đang hoạt động tại cơ sở này và còn hơn 7 ngày tính từ lượt đến kho.');
    }
    const reservationId = new Types.ObjectId(String(reservation._id));
    if (requestedFacilityId && !reservation.facilityId.equals(requestedFacilityId)) fail(404, 'FACILITY_NOT_FOUND', 'Không tìm thấy cơ sở có đơn thuê đủ điều kiện.');
    const requestedAdditionalIds = input.additionalReservationIds === undefined ? [] : Array.isArray(input.additionalReservationIds) && input.additionalReservationIds.length <= 20
      ? [...new Set(input.additionalReservationIds.map(value => String(asId(value, 'additionalReservationId'))))].map(value => new Types.ObjectId(value))
      : fail(400, 'INVALID_RESERVATION_SCOPE', 'Danh sách Reservation bổ sung không hợp lệ.');
    if (requestedAdditionalIds.some(value => value.equals(reservationId))) fail(400, 'INVALID_RESERVATION_SCOPE', 'Reservation bổ sung không được trùng Reservation chính.');
    if (![ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE].includes(reservation.status) || reservation.endDate <= now || window.startsAt < reservation.startDate || window.endsAt > reservation.endDate || reservation.endDate <= visitScopeEnd(window.endsAt)) fail(409, 'RESERVATION_NOT_VISIT_READY', 'Đơn thuê phải còn hiệu lực trong khung giờ đã chọn và còn hơn 7 ngày để được đưa vào Session.');
    const date = new Date(window.startsAt.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    const session = await mongoose.startSession();
    let created: any;
    try {
      await session.withTransaction(async () => {
        const facility: any = await FacilityModel.findOneAndUpdate({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
          serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } },
        { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session }).select('managedVisitSchedule').exec();
        if (!facility) fail(409, 'FACILITY_UNAVAILABLE', 'Cơ sở Managed Inventory không khả dụng.');
        const latestReservation = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3,
          status: { $in: [ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE] },
          startDate: { $lte: window.startsAt }, endDate: { $gt: visitScopeEnd(window.endsAt) } }).session(session).exec();
        if (!latestReservation || (requestedFacilityId && (latestReservation.status !== ReservationStatus.ACTIVE || latestReservation.startDate > now))) fail(409, 'RESERVATION_NOT_VISIT_READY', 'Reservation đã thay đổi hoặc khung giờ không còn nằm trong kỳ thuê đủ điều kiện.');
        const availability = await availableVisitSlots(latestReservation, date, new Date(), session, facility);
        if (!availability.slots.some(slot => Date.parse(slot.startsAt) === window.startsAt.getTime() && Date.parse(slot.endsAt) === window.endsAt.getTime())) {
          fail(409, 'VISIT_SLOT_UNAVAILABLE', 'Khung giờ vừa hết hạn hoặc không còn khả dụng. Hãy tải lại danh sách khung giờ.');
        }
        const cells = await cellsCoveringWindow(latestReservation, window.startsAt, window.endsAt, session);
        const activeReservations: any[] = await ReservationModel.find({ customerId: actor._id, facilityId: reservation.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
          startDate: { $lte: now }, endDate: { $gt: visitScopeEnd(window.endsAt) } }).session(session).sort({ startDate: 1, _id: 1 }).limit(101).lean().exec();
        if (activeReservations.length > 100) fail(409, 'RESERVATION_SCOPE_TOO_LARGE', 'Phạm vi có quá nhiều Reservation để cấp Session an toàn. Hãy liên hệ Facility.');
        const activeIds = new Set(activeReservations.map(row => String(row._id)));
        if (requestedAdditionalIds.some(value => !activeIds.has(String(value)))) fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation bổ sung không còn hoạt động hoặc không thuộc Customer/Facility này.');
        const scopedReservationIds = [...new Set([String(reservationId), ...activeReservations.map(row => String(row._id))])]
          .map(value => new Types.ObjectId(value)).sort((a, b) => a.toString().localeCompare(b.toString()));
        if (scopedReservationIds.length > 100) fail(409, 'RESERVATION_SCOPE_TOO_LARGE', 'Phạm vi có quá nhiều Reservation để cấp Session an toàn. Hãy liên hệ Facility.');
        if (!scopedReservationIds.some(value => value.equals(reservationId))) scopedReservationIds.unshift(reservationId);
        const additionalReservations = activeReservations.filter(row => !new Types.ObjectId(String(row._id)).equals(reservationId));
        let scopedCells: Types.ObjectId[] = [...cells];
        for (const target of additionalReservations) {
          if (!target.handoverAt || !target.handoverByStaffId || target.activeClosureRequestId) fail(409, 'INVALID_RESERVATION_SCOPE', 'Một Reservation đang hoạt động chưa hoàn tất bàn giao hoặc đang đóng; không thể cấp phạm vi chung.');
          const targetContract: any = await ContractModel.findOne({ reservationId: target._id, customerId: actor._id, status: ContractStatus.SIGNED }).session(session).lean().exec();
          const targetActive = targetContract?.contentVersions?.find((version: any) => version.version === targetContract.currentContentVersion);
          if (!targetActive || !targetContract.signatures?.some((row: any) => row.version === targetActive.version && row.contentHash === targetActive.contentHash && row.signerRole === UserRole.CUSTOMER) ||
              !targetContract.signatures?.some((row: any) => row.version === targetActive.version && row.contentHash === targetActive.contentHash && [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(row.signerRole))) fail(409, 'CONTRACT_NOT_SIGNED', 'Reservation đích cần có hợp đồng hiện hành đã ký.');
          scopedCells = [...scopedCells, ...await cellsCoveringWindow(target as any, window.startsAt, window.endsAt, session)];
        }
        const rows = await VisitModel.create([{ reservationId, customerId: actor._id, facilityId: reservation.facilityId,
          scopedReservationIds,
          purpose: ManagedAccessVisitPurpose.WAREHOUSE_VISIT, ...window, ...(typeof input.note === 'string' ? { note: input.note.trim() } : {}), idempotencyKey: key,
          requestHash, revision: 0, assignmentHistory: [],
          audit: [audit('VISIT_CREATED', actor, now, { eventRevision: 0, startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString(),
            visitType: ManagedAccessVisitPurpose.WAREHOUSE_VISIT, scopedReservationIds: scopedReservationIds.map(String), allowedCellIds: scopedCells.map(String) })] }], { session });
        created = rows[0];
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const raced = await VisitModel.findOne({ customerId: actor._id, idempotencyKey: key }).exec();
      if (!raced) throw error;
      if (raced.requestHash !== requestHash && raced.requestHash !== legacyVisitIdemHash(input, reservationId)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với nội dung khác.');
      return raced;
    } finally { await session.endSession(); }
    if (!created) fail(503, 'VISIT_CREATE_OUTCOME_UNKNOWN', 'Chưa xác minh được kết quả tạo lịch. Hãy tải lại lịch trước khi gửi lại.');
    await notifyVisitTransition(created, NotificationType.MANAGED_VISIT_CREATED, `VISIT:${created._id}:REV:${created.revision}:CREATED`, 'Đã tạo');
    return created;
  }
  static async myVisits(actor: Actor) {
    requireRole(actor, [UserRole.CUSTOMER]);
    await markMissedVisits({ customerId: actor._id }, new Date());
    return VisitModel.find({ customerId: actor._id }).sort({ startsAt: -1 }).populate('assignedStaffId', 'displayName').lean().exec();
  }
  static async visitDetail(visitId: unknown, actor: Actor) {
    const id = asId(visitId, 'visitId'); let visit = await VisitModel.findById(id).populate('assignedStaffId', 'displayName').exec();
    if (!visit) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.');
    if (actor.role === UserRole.CUSTOMER && !visit.customerId.equals(actor._id)) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.');
    if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) { scope(actor, visit.facilityId); if (actor.role === UserRole.FACILITY_STAFF && !visit.assignedStaffId?.equals(actor._id)) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch được giao.'); }
    await markMissedVisits({ _id: id, facilityId: visit.facilityId }, new Date(), 1);
    if (visit.status === VS.SCHEDULED && visit.endsAt <= new Date()) visit = await VisitModel.findById(id).populate('assignedStaffId', 'displayName').exec() ?? visit;
    return visit;
  }
  static async amendVisit(visitId: unknown, body: unknown, actor: Actor, expectedRevision: unknown, idempotencyHeader: unknown) {
    // A legacy purpose can appear on an already-pending amendment, but is ignored;
    // a Visit no longer changes authorization by operation.
    requireRole(actor, [UserRole.CUSTOMER]); const input = plain(body, ['purpose', 'startsAt', 'endsAt', 'note'], 'Thông tin cập nhật');
    if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) fail(428, 'IF_MATCH_REQUIRED', 'Cần revision hiện tại trong If-Match.');
    const key = reqKey(idempotencyHeader);
    const id = asId(visitId, 'visitId');
    await markMissedVisits({ _id: id, customerId: actor._id }, new Date(), 1);
    const visit = await VisitModel.findOne({ _id: id, customerId: actor._id }).exec();
    if (!visit) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.');
    const requestHash = hash({ visitId: String(id), payload: input });
    const currentAudit = (visit.audit ?? []).find(entry => entry.action === 'VISIT_AMENDED' && entry.details?.idempotencyKey === key);
    if (currentAudit) {
      if (currentAudit.details?.requestHash !== requestHash) {
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với nội dung sửa lịch khác.');
      }
      return visit;
    }
    if (visit.status === VS.MISSED) fail(409, 'VISIT_MISSED', 'Lịch đã quá giờ mà chưa check-in nên không thể điều chỉnh. Hãy đặt lịch mới.');
    if (visit.status !== VS.SCHEDULED) fail(409, 'VISIT_NOT_AMENDABLE', 'Chỉ có thể sửa lịch chưa check-in.');
    if (visit.revision !== Number(expectedRevision)) fail(412, 'STALE_REVISION', 'Lịch đã thay đổi; tải lại trước khi sửa.');
    const window = windowInput({ startsAt: input.startsAt ?? visit.startsAt.toISOString(), endsAt: input.endsAt ?? visit.endsAt.toISOString() }, new Date());
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)) fail(400, 'INVALID_INPUT', 'Ghi chú tối đa 500 ký tự.');
    const date = new Date(window.startsAt.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    const dbSession = await mongoose.startSession(); let amended: any;
    try {
      await dbSession.withTransaction(async () => {
        // The Facility revision is the shared serialization fence used by Visit create and amend.
        const facility: any = await FacilityModel.findOneAndUpdate({ _id: visit.facilityId, status: FacilityStatus.ACTIVE,
          serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } },
        { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: dbSession }).select('managedVisitSchedule').exec();
        if (!facility) fail(409, 'FACILITY_UNAVAILABLE', 'Cơ sở Managed Inventory không khả dụng.');
        const latest: any = await VisitModel.findOne({ _id: id, customerId: actor._id }).session(dbSession).exec();
        if (!latest) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.');
        const replay = (latest.audit ?? []).find((entry: ManagedAccessAudit) => entry.action === 'VISIT_AMENDED' && entry.details?.idempotencyKey === key);
        if (replay) {
          if (replay.details?.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với nội dung sửa lịch khác.');
          amended = latest; return;
        }
        if (latest.status !== VS.SCHEDULED) fail(409, 'VISIT_NOT_AMENDABLE', 'Chỉ có thể sửa lịch chưa check-in.');
        if (latest.endsAt <= new Date()) fail(409, 'VISIT_MISSED', 'Lịch đã quá giờ mà chưa check-in nên không thể điều chỉnh. Hãy đặt lịch mới.');
        if (latest.revision !== Number(expectedRevision)) fail(412, 'STALE_REVISION', 'Lịch đã thay đổi; tải lại trước khi sửa.');
        const reservation: any = await ReservationModel.findOne({ _id: latest.reservationId, customerId: actor._id,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3,
          status: { $in: [ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE] },
          startDate: { $lte: window.startsAt }, endDate: { $gte: window.endsAt } }).session(dbSession).exec();
        if (!reservation || reservation.endDate <= new Date()) fail(409, 'RESERVATION_NOT_VISIT_READY', 'Visit phải nằm trong kỳ thuê hiện hành.');
        const availability = await availableVisitSlots(reservation, date, new Date(), dbSession, facility, latest._id);
        if (!availability.slots.some(slot => Date.parse(slot.startsAt) === window.startsAt.getTime() && Date.parse(slot.endsAt) === window.endsAt.getTime())) {
          fail(409, 'VISIT_SLOT_UNAVAILABLE', 'Khung giờ sửa lịch không còn khả dụng. Hãy tải lại danh sách khung giờ.');
        }
        await cellsCoveringWindow(reservation, window.startsAt, window.endsAt, dbSession);
        const now = new Date(), oldStaff = latest.assignedStaffId, scheduleChanged = latest.startsAt.getTime() !== window.startsAt.getTime() || latest.endsAt.getTime() !== window.endsAt.getTime();
        latest.startsAt = window.startsAt; latest.endsAt = window.endsAt;
        if (input.note !== undefined) latest.note = (input.note as string).trim();
        if (oldStaff && scheduleChanged) {
          latest.set('assignedStaffId', undefined);
          latest.assignmentHistory.push({ staffId: null as any, actorId: actor._id, at: now, reason: 'Customer amended visit time; escort re-assignment required' });
        }
        latest.revision += 1;
        latest.audit.push(audit('VISIT_AMENDED', actor, now, { idempotencyKey: key, requestHash,
          previousAssignmentCleared: !!oldStaff && scheduleChanged, scheduleChanged, eventRevision: latest.revision,
          startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() }));
        amended = await latest.save({ session: dbSession });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error: any) {
      if (error instanceof ManagedAccessError && error.code === 'VISIT_MISSED') await markMissedVisits({ _id: id, customerId: actor._id }, new Date(), 1);
      // Resolve an uncertain commit from the durable amendment audit before surfacing failure.
      const persisted = await VisitModel.findOne({ _id: id, customerId: actor._id }).exec().catch(() => null);
      const committed = (persisted?.audit ?? []).find((entry: ManagedAccessAudit) => entry.action === 'VISIT_AMENDED' && entry.details?.idempotencyKey === key);
      if (committed) {
        if (committed.details?.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với nội dung sửa lịch khác.');
        if (persisted) {
          if (committed.details?.scheduleChanged) await notifyVisitTransition(persisted, NotificationType.MANAGED_VISIT_RESCHEDULED,
            `VISIT:${persisted._id}:REV:${committed.details.eventRevision ?? persisted.revision}:RESCHEDULED`, 'Đã đổi');
          return persisted;
        }
      }
      if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) fail(503, 'VISIT_AMEND_OUTCOME_UNKNOWN', 'Chưa xác minh được kết quả sửa lịch. Hãy tải lại lịch trước khi thử lại cùng yêu cầu.');
      throw error;
    } finally { await dbSession.endSession(); }
    if (!amended) fail(503, 'VISIT_AMEND_OUTCOME_UNKNOWN', 'Chưa xác minh được kết quả sửa lịch. Hãy tải lại lịch trước khi thử lại cùng yêu cầu.');
    const amendment = [...(amended.audit ?? [])].reverse().find((entry: any) => entry.action === 'VISIT_AMENDED' && entry.details?.idempotencyKey === key);
    if (amendment?.details?.scheduleChanged) await notifyVisitTransition(amended, NotificationType.MANAGED_VISIT_RESCHEDULED,
      `VISIT:${amended._id}:REV:${amendment.details.eventRevision ?? amended.revision}:RESCHEDULED`, 'Đã đổi');
    return amended;
  }
  static async cancelVisit(visitId: unknown, actor: Actor, expectedRevision: unknown) {
    requireRole(actor, [UserRole.CUSTOMER]);
    if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) fail(428, 'IF_MATCH_REQUIRED', 'Cần revision hiện tại trong If-Match.');
    const id = asId(visitId, 'visitId'), now = new Date(), revision = Number(expectedRevision);
    await markMissedVisits({ _id: id, customerId: actor._id }, now, 1);
    const cancelled = await VisitModel.findOneAndUpdate({ _id: id, customerId: actor._id, status: VS.SCHEDULED, revision, endsAt: { $gt: new Date() } },
      { $set: { status: VS.CANCELLED }, $inc: { revision: 1 }, $push: { audit: audit('VISIT_CANCELLED', actor, now, { eventRevision: revision + 1 }) } },
      { returnDocument: 'after', runValidators: true }).exec();
    if (cancelled) {
      await notifyVisitTransition(cancelled, NotificationType.MANAGED_VISIT_CANCELLED,
        `VISIT:${cancelled._id}:REV:${cancelled.revision}:CANCELLED`, 'Đã hủy');
      return cancelled;
    }
    await markMissedVisits({ _id: id, customerId: actor._id }, new Date(), 1);
    const current = await VisitModel.findOne({ _id: id, customerId: actor._id }).select('status revision').lean().exec();
    if (!current) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.');
    if (current.status === VS.MISSED) fail(409, 'VISIT_MISSED', 'Lịch đã quá giờ và được ghi nhận là quá hạn; không thể hủy hoặc sửa.');
    if (current.status !== VS.SCHEDULED) fail(409, 'VISIT_NOT_CANCELLABLE', 'Lịch đã check-in hoặc kết thúc không thể hủy.');
    fail(412, 'STALE_REVISION', 'Lịch đã thay đổi; tải lại trước khi hủy.');
  }
  static async facilityVisits(actor: Actor, status?: string) {
    requireRole(actor, [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]); if (!actor.assignedFacilityId) fail(403, 'FACILITY_SCOPE_DENIED', 'Chưa được phân công Facility.');
    const filter: Record<string, unknown> = { facilityId: actor.assignedFacilityId };
    if (actor.role === UserRole.FACILITY_STAFF) filter.assignedStaffId = actor._id;
    await markMissedVisits(filter, new Date());
    if (status && Object.values(VS).includes(status as VS)) filter.status = status;
    return VisitModel.find(filter).sort({ startsAt: 1 }).populate('customerId', 'displayName email').populate('assignedStaffId', 'displayName').lean().exec();
  }
  static async facilityStaff(actor: Actor) {
    requireRole(actor, [UserRole.FACILITY_MANAGER]); if (!actor.assignedFacilityId) fail(403, 'FACILITY_SCOPE_DENIED', 'Chưa được phân công Facility.');
    return UserModel.find({ role: UserRole.FACILITY_STAFF, assignedFacilityId: actor.assignedFacilityId, isActive: true }).select('_id displayName email').sort({ displayName: 1 }).lean().exec();
  }
  static async reconcileMissedVisits(now = new Date(), limit = 500): Promise<number> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail(500, 'INVALID_RECONCILIATION_INPUT', 'Invalid missed visit reconciliation parameters.');
    return markMissedVisits({}, now, limit);
  }
  static async assignStaff(visitId: unknown, body: unknown, actor: Actor, expectedRevision: unknown) {
    requireRole(actor, [UserRole.FACILITY_MANAGER]); const input = plain(body, ['staffId', 'reason'], 'Phân công hộ tống');
    if (!Number.isSafeInteger(Number(expectedRevision))) fail(428, 'IF_MATCH_REQUIRED', 'Cần revision hiện tại trong If-Match.');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500) fail(400, 'INVALID_INPUT', 'Cần lý do phân công từ 3 đến 500 ký tự.');
    const visit = await VisitModel.findById(asId(visitId, 'visitId')).exec(); if (!visit) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.'); scope(actor, visit.facilityId);
    await markMissedVisits({ _id: visit._id }, new Date(), 1);
    if (visit.status === VS.SCHEDULED && visit.endsAt <= new Date()) fail(409, 'VISIT_MISSED', 'Lịch đã quá giờ mà chưa check-in nên không thể phân công hộ tống.');
    if (visit.status !== VS.SCHEDULED || visit.revision !== Number(expectedRevision)) fail(412, 'STALE_REVISION', 'Lịch không còn ở revision có thể phân công.');
    const staffId = asId(input.staffId, 'staffId'), now = new Date(), dbSession = await mongoose.startSession(); let assigned;
    try {
      await dbSession.withTransaction(async () => {
        // This per-Staff write fence makes concurrent assignment transactions serialize before checking time overlap.
        const staff = await UserModel.findOneAndUpdate({ _id: staffId, role: UserRole.FACILITY_STAFF, assignedFacilityId: visit.facilityId, isActive: true }, { $inc: { managedAccessScheduleRevision: 1 } }, { returnDocument: 'after', session: dbSession }).select('_id').exec();
        if (!staff) fail(403, 'STAFF_FACILITY_MISMATCH', 'Nhân viên không hoạt động hoặc thuộc Facility khác.');
        const conflict = await VisitModel.findOne({ _id: { $ne: visit._id }, assignedStaffId: staffId, facilityId: visit.facilityId, status: { $in: [VS.SCHEDULED, VS.CHECKED_IN] }, startsAt: { $lt: visit.endsAt }, endsAt: { $gt: visit.startsAt } }).select('_id').session(dbSession).lean().exec();
        if (conflict) fail(409, 'ASSIGNMENT_CONFLICT', 'Nhân viên đã có lịch trùng thời gian.');
        const entry = { staffId, actorId: actor._id, at: now, reason: (input.reason as string).trim() };
        assigned = await VisitModel.findOneAndUpdate({ _id: visit._id, facilityId: visit.facilityId, status: VS.SCHEDULED, revision: Number(expectedRevision) },
          { $set: { assignedStaffId: staffId }, $inc: { revision: 1 }, $push: { assignmentHistory: entry, audit: audit('STAFF_ASSIGNED', actor, now, { staffId: String(staffId), reason: entry.reason }) } }, { returnDocument: 'after', session: dbSession }).exec();
        if (!assigned) fail(412, 'STALE_REVISION', 'Lịch vừa thay đổi; tải lại trước khi phân công.');
      });
    } finally { await dbSession.endSession(); }
    return assigned;
  }
  static async reconcileExpiredSessions(now = new Date(), limit = 100): Promise<number> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail(500, 'INVALID_RECONCILIATION_INPUT', 'Invalid session reconciliation parameters.');
    let reconciled = 0, firstFailure: unknown, cursor: Types.ObjectId | undefined, scanned = 0;
    // Page by immutable _id so one repeatedly failing early record cannot starve later expirations.
    while (scanned < 5000) {
      const filter: Record<string, unknown> = { status: SS.ACTIVE, expiresAt: { $lte: now } };
      if (cursor) filter._id = { $gt: cursor };
      const expiredRows = await SessionModel.find(filter).sort({ _id: 1 }).limit(Math.min(limit, 5000 - scanned)).lean().exec();
      if (!expiredRows.length) break;
      cursor = expiredRows[expiredRows.length - 1]!._id as Types.ObjectId;
      scanned += expiredRows.length;
      for (const row of expiredRows) {
      const dbSession = await mongoose.startSession(); let changed = false;
      try {
        await dbSession.withTransaction(async () => {
          const ended = await SessionModel.findOneAndUpdate({ _id: row._id, status: SS.ACTIVE, expiresAt: { $lte: now } },
            { $set: { status: SS.EXPIRED, endedAt: row.expiresAt }, $inc: { revision: 1 },
              $push: { audit: systemAudit('SESSION_EXPIRED', row.expiresAt, { visitId: String(row.visitId), reconciliationAt: now.toISOString() }) } },
            { returnDocument: 'after', session: dbSession }).exec();
          if (!ended) return;
          const closed: any = await (VisitModel as any).findOneAndUpdate({ _id: ended.visitId, status: VS.CHECKED_IN },
            { $set: { status: VS.COMPLETED, checkedOutAt: ended.expiresAt }, $inc: { revision: 1 },
              $push: { audit: systemAudit('ACCESS_SESSION_EXPIRED', ended.expiresAt, { sessionId: String(ended._id) }) } },
            { returnDocument: 'after', session: dbSession }).exec();
          if (!closed) fail(409, 'EXPIRY_RECONCILIATION_CONFLICT', 'Expired Session Visit state is inconsistent; reconciliation was rolled back.');
          changed = true;
        });
        if (changed) reconciled += 1;
      } catch (error) {
        const errorCode = error instanceof ManagedAccessError ? error.code : 'RECONCILIATION_FAILED';
        console.error('Managed access expiry record reconciliation failed', { sessionId: String(row._id), errorCode });
        firstFailure ??= error;
      } finally { await dbSession.endSession(); }
      }
    }
    if (firstFailure) throw firstFailure;
    return reconciled;
  }
  static async checkIn(visitId: unknown, body: unknown, actor: Actor, keyInput: unknown) {
    requireRole(actor, [UserRole.FACILITY_STAFF]); const key = reqKey(keyInput), input = plain(body, ['identityVerified', 'customerPresent', 'safetyReviewed', 'safetyNotes'], 'Biên bản check-in');
    if (input.identityVerified !== true || input.customerPresent !== true || input.safetyReviewed !== true || typeof input.safetyNotes !== 'string' || input.safetyNotes.trim().length < 3 || input.safetyNotes.length > 1000) fail(400, 'ATTESTATION_REQUIRED', 'Staff phải xác nhận danh tính, hiện diện thực tế, an toàn và ghi chú kiểm tra.');
    const id = asId(visitId, 'visitId'), initialVisit = await VisitModel.findById(id).exec();
    if (!initialVisit) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch đến kho.'); scope(actor, initialVisit.facilityId);
    if (!initialVisit.assignedStaffId?.equals(actor._id)) fail(403, 'ASSIGNMENT_REQUIRED', 'Chỉ nhân viên hộ tống được phân công mới check-in.');
    if (initialVisit.status === VS.SCHEDULED && initialVisit.endsAt <= new Date()) {
      await markMissedVisits({ _id: id }, new Date(), 1);
      fail(409, 'VISIT_MISSED', 'Lịch đã quá giờ mà chưa check-in; không thể xác minh đến kho.');
    }
    const requestHash = hash({ identityVerified: input.identityVerified, customerPresent: input.customerPresent, safetyReviewed: input.safetyReviewed, safetyNotes: (input.safetyNotes as string).trim() });
    const dbSession = await mongoose.startSession(); let result: IManagedAccessSession | undefined; let replay = false;
    try {
      await dbSession.withTransaction(async () => {
        const now = new Date();
        const currentVisit: any = await (VisitModel as any).findOne({ _id: id, facilityId: actor.assignedFacilityId, assignedStaffId: actor._id }).session(dbSession).exec();
        if (!currentVisit) fail(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lịch được giao.');
        const previous = await SessionModel.findOne({ visitId: currentVisit._id, checkInIdempotencyKey: key }).session(dbSession).exec();
        if (previous) {
          const replayAt = new Date();
          if (!sessionIsCurrent({ status: previous.status, startedAt: previous.startedAt, expiresAt: previous.expiresAt, now: replayAt })) fail(409, 'CHECKIN_RESULT_NOT_ACTIVE', 'Yêu cầu đã được xử lý nhưng Session không còn hoạt động. Hãy tải lại trạng thái.');
          if (previous.checkInRequestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với biên bản check-in khác.');
          result = previous; replay = true; return;
        }
        if (currentVisit.status !== VS.SCHEDULED) fail(409, 'VISIT_NOT_CHECKIN_READY', 'Lịch không ở trạng thái chờ check-in.');
        if (now < currentVisit.startsAt || now >= currentVisit.endsAt) fail(409, 'OUTSIDE_VISIT_WINDOW', 'Check-in ngoài khung giờ đã đặt.');
        const reservationCandidate = await ReservationModel.findOne({ _id: currentVisit.reservationId, customerId: currentVisit.customerId, facilityId: currentVisit.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).session(dbSession).exec();
        if (!reservationCandidate) fail(409, 'RESERVATION_SCOPE_CHANGED', 'Reservation không còn khớp với lịch.');
        const fencedReservation = await ReservationModel.findOneAndUpdate({ _id: reservationCandidate._id, customerId: currentVisit.customerId, facilityId: currentVisit.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }, { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: dbSession }).exec();
        if (!fencedReservation) fail(409, 'RESERVATION_SCOPE_CHANGED', 'Reservation vừa thay đổi; tải lại trước khi check-in.');
        const reservation = await ReservationModel.findById(fencedReservation._id).session(dbSession).exec();
        const minimumScopeEnd = new Date(now.getTime() + SESSION_RESERVATION_MIN_REMAINING_MS);
        if (!reservation || reservation.status !== ReservationStatus.ACTIVE || reservation.startDate > now || reservation.endDate <= minimumScopeEnd || !reservation.handoverAt || !reservation.handoverByStaffId) fail(409, 'RENTAL_NOT_ACTIVE', 'Chỉ Reservation V3 đã bàn giao và còn hơn 7 ngày mới được đưa vào Access Session.');
        // Rebuild the final Session scope at check-in so any newly active rental
        // created after Visit booking is included if it meets the same-facility,
        // handover, and >7-day eligibility rules.
        let currentScopeQuery: any = ReservationModel.find({ customerId: currentVisit.customerId, facilityId: currentVisit.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
          startDate: { $lte: now }, endDate: { $gt: minimumScopeEnd } });
        currentScopeQuery = currentScopeQuery.sort({ startDate: 1, _id: 1 }).limit(101);
        const eligibleAtCheckIn: any[] = await currentScopeQuery.session(dbSession).lean().exec();
        if (eligibleAtCheckIn.length > 100) fail(409, 'RESERVATION_SCOPE_TOO_LARGE', 'Phạm vi có quá nhiều đơn thuê đang hoạt động để cấp Session an toàn.');
        const scopedReservationIds: Types.ObjectId[] = eligibleAtCheckIn.map((row: any) => new Types.ObjectId(String(row._id)));
        if (!scopedReservationIds.some(value => value.equals(reservation._id))) fail(409, 'INVALID_RESERVATION_SCOPE', 'Không còn Reservation đủ điều kiện để kích hoạt Session.');
        const additionalReservations: any[] = [];
        for (const scopedId of scopedReservationIds.filter(value => !value.equals(reservation._id)).sort((a, b) => a.toString().localeCompare(b.toString()))) {
          const target: any = await ReservationModel.findOneAndUpdate({ _id: scopedId, customerId: currentVisit.customerId, facilityId: currentVisit.facilityId,
            serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
            startDate: { $lte: now }, endDate: { $gt: minimumScopeEnd }, handoverAt: { $exists: true, $ne: null }, handoverByStaffId: { $exists: true, $ne: null },
            $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] }, { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: dbSession }).exec();
          if (!target) fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation đích không còn cùng Customer/Facility, hoạt động và đã bàn giao.');
          const targetContract: any = await ContractModel.findOne({ reservationId: target._id, customerId: currentVisit.customerId, status: ContractStatus.SIGNED }).session(dbSession).lean().exec();
          const targetVersion = targetContract?.contentVersions?.find((version: any) => version.version === targetContract.currentContentVersion);
          const targetHashValid = !!targetVersion && /^[a-f\d]{64}$/i.test(targetVersion.contentHash) && createHash('sha256').update(JSON.stringify(targetVersion.content)).digest('hex') === targetVersion.contentHash;
          if (!targetHashValid || !targetContract?.signedProofPublicId || !targetContract.verifiedAt ||
              !targetContract.signatures?.some((sig: any) => sig.version === targetVersion.version && sig.contentHash === targetVersion.contentHash && sig.signerRole === UserRole.CUSTOMER) ||
              !targetContract.signatures?.some((sig: any) => sig.version === targetVersion.version && sig.contentHash === targetVersion.contentHash && [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(sig.signerRole))) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Reservation đích cần hợp đồng đã ký và xác minh.');
          if (target.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || !target.fullPaymentId) fail(409, 'PAYMENT_NOT_VERIFIED', 'Reservation đích chưa đủ điều kiện thanh toán.');
          const targetPaymentFilter = { _id: target.fullPaymentId, reservationId: target._id, customerId: currentVisit.customerId, facilityId: currentVisit.facilityId,
            serviceType: FacilityServiceType.MANAGED_INVENTORY, purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
            providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED };
          const targetPayment = await PaymentModel.findOneAndUpdate(targetPaymentFilter, { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: dbSession }).select('_id').exec();
          if (!targetPayment) fail(409, 'PAYMENT_NOT_VERIFIED', 'Thanh toán Reservation đích chưa được xác minh.');
          await ContractModel.updateOne({ _id: targetContract._id, status: ContractStatus.SIGNED }, { $inc: { managedAccessRevision: 1 } }, { session: dbSession }).exec();
          additionalReservations.push(target);
        }
        const facilityFence = await FacilityModel.updateOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } },
          { $inc: { managedAccessRevision: 1 } }, { session: dbSession }).exec();
        if (facilityFence.matchedCount !== 1) fail(409, 'FACILITY_UNAVAILABLE', 'Cơ sở Managed Inventory không khả dụng.');
        const staffFence = await UserModel.findOneAndUpdate({ _id: actor._id, role: UserRole.FACILITY_STAFF, assignedFacilityId: reservation.facilityId, isActive: true },
          { $inc: { managedAccessScheduleRevision: 1 } }, { returnDocument: 'after', session: dbSession }).select('_id').exec();
        if (!staffFence) fail(403, 'ASSIGNMENT_REQUIRED', 'Nhân viên không còn được phân công hoặc đã bị vô hiệu hóa.');
        const requestedCells = [...new Set([...(reservation.allocatedCellIds ?? []), ...additionalReservations.flatMap(row => row.allocatedCellIds ?? [])].map(String))].map(value => new Types.ObjectId(value));
        if (!requestedCells.length) fail(409, 'ALLOCATION_INVALID', 'Reservation chưa có Cell được phân bổ.');
        if (requestedCells.length > 100) fail(409, 'RESERVATION_SCOPE_TOO_LARGE', 'Phạm vi có quá nhiều Cell để cấp Session an toàn. Hãy liên hệ Facility.');
        const allocationFence = await CellAllocationModel.updateMany({ reservationId: { $in: scopedReservationIds }, customerId: reservation.customerId, facilityId: reservation.facilityId,
          cellId: { $in: requestedCells }, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] },
          startDate: { $lte: currentVisit.startsAt }, endDate: { $gte: currentVisit.endsAt } },
          { $inc: { managedAccessRevision: 1 } }, { session: dbSession }).exec();
        if (allocationFence.matchedCount !== requestedCells.length) fail(409, 'ALLOCATION_INVALID', 'Cell allocation vừa thay đổi hoặc không bao phủ toàn bộ Visit.');
        await cellsCoveringWindow(reservation, currentVisit.startsAt, currentVisit.endsAt, dbSession);
        const additionalCells = await Promise.all(additionalReservations.map(row => cellsCoveringWindow(row, currentVisit.startsAt, currentVisit.endsAt, dbSession)));
        if (reservation.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || !reservation.fullPaymentId) fail(409, 'PAYMENT_NOT_VERIFIED', 'Không xác minh được thanh toán toàn phần cho Managed V3.');
        const paymentFilter = { _id: reservation.fullPaymentId, reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED };
        const payment = await PaymentModel.findOne(paymentFilter).select('_id').session(dbSession).lean().exec();
        if (payment) {
          const paymentFence = await PaymentModel.updateOne(paymentFilter, { $inc: { managedAccessRevision: 1 } }, { session: dbSession }).exec();
          if (paymentFence.matchedCount !== 1) fail(409, 'PAYMENT_NOT_VERIFIED', 'Trạng thái thanh toán vừa thay đổi; tải lại trước khi check-in.');
        }
        const contractFilter = { reservationId: reservation._id, customerId: reservation.customerId, status: ContractStatus.SIGNED };
        let contract = await ContractModel.findOne(contractFilter)
          .select('signedProofPublicId verifiedAt currentContentVersion contentVersions signatures').session(dbSession).lean().exec();
        if (contract) {
          const contractFence = await ContractModel.updateOne(contractFilter, { $inc: { managedAccessRevision: 1 } }, { session: dbSession }).exec();
          if (contractFence.matchedCount !== 1) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Hợp đồng vừa thay đổi; tải lại trước khi check-in.');
          contract = await ContractModel.findOne(contractFilter).select('signedProofPublicId verifiedAt currentContentVersion contentVersions signatures').session(dbSession).lean().exec();
        }
        const activeContract = contract?.contentVersions?.find(version => version.version === contract.currentContentVersion);
        const validHash = !!activeContract && /^[a-f\d]{64}$/i.test(activeContract.contentHash) && createHash('sha256').update(JSON.stringify(activeContract.content)).digest('hex') === activeContract.contentHash;
        const customerSigned = !!activeContract && contract?.signatures?.some(signature => signature.version === activeContract.version && signature.contentHash === activeContract.contentHash && signature.signerRole === UserRole.CUSTOMER);
        const facilitySigned = !!activeContract && contract?.signatures?.some(signature => signature.version === activeContract.version && signature.contentHash === activeContract.contentHash && [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(signature.signerRole as UserRole));
        if (!payment || !contract?.signedProofPublicId || !contract.verifiedAt || !validHash || !customerSigned || !facilitySigned) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Thiếu thanh toán đã xác minh hoặc hợp đồng V3 đã ký/xác minh đúng phiên bản.');
        const activationAt = new Date();
        if (currentVisit.status !== VS.SCHEDULED || activationAt < currentVisit.startsAt || activationAt >= currentVisit.endsAt) fail(409, 'OUTSIDE_VISIT_WINDOW', 'Visit đã thay đổi hoặc hết hạn trong lúc check-in.');
        const finalScopeEnd = new Date(activationAt.getTime() + SESSION_RESERVATION_MIN_REMAINING_MS);
        if (reservation.status !== ReservationStatus.ACTIVE || reservation.startDate > activationAt || reservation.endDate <= finalScopeEnd || additionalReservations.some(row => row.endDate <= finalScopeEnd)) fail(409, 'RENTAL_NOT_ACTIVE', 'Reservation trong phạm vi phải còn hoạt động và hơn 7 ngày thuê tại thời điểm kích hoạt Session.');
        const cells = [...new Set([...(await cellsCoveringWindow(reservation, currentVisit.startsAt, currentVisit.endsAt, dbSession)), ...additionalCells.flat()].map(String))].map(value => new Types.ObjectId(value));
        await reconcileExpiredReservationSessions(scopedReservationIds, activationAt, dbSession);
        const existing = await SessionModel.findOne(activeSessionScopeFilter(scopedReservationIds, activationAt)).session(dbSession).exec();
        if (existing) fail(409, 'ACTIVE_SESSION_EXISTS', 'Reservation đã có Access Session đang hoạt động.');
        const expiresAt = sessionExpiry(activationAt, [reservation.endDate, ...additionalReservations.map(row => row.endDate), currentVisit.endsAt]);
        if (expiresAt <= activationAt) fail(409, 'SESSION_WINDOW_EXPIRED', 'Thời hạn Rental hoặc Visit đã kết thúc; không thể cấp Session.');
        const presenceAttestation = { identityVerified: true, customerPresent: true, safetyReviewed: true, notes: (input.safetyNotes as string).trim(), actorId: actor._id, recordedAt: activationAt, method: 'MANUAL_STAFF_ATTESTATION' as const };
        currentVisit.status = VS.CHECKED_IN; currentVisit.scopedReservationIds = scopedReservationIds; currentVisit.checkedInAt = activationAt; currentVisit.checkedInByStaffId = actor._id; currentVisit.presenceAttestation = presenceAttestation; currentVisit.revision += 1;
        currentVisit.audit.push(audit('CUSTOMER_CHECKED_IN', actor, activationAt, { eventRevision: currentVisit.revision,
          presenceMethod: presenceAttestation.method, reservationId: String(reservation._id), scopedReservationIds: scopedReservationIds.map(String) })); await currentVisit.save({ session: dbSession });
        const [created] = await SessionModel.create([{ visitId: currentVisit._id, reservationId: reservation._id, scopedReservationIds, customerId: reservation.customerId, facilityId: reservation.facilityId, assignedStaffId: actor._id,
          allowedCellIds: cells, allowedPurposes: [ManagedAccessPurpose.INBOUND, ManagedAccessPurpose.OUTBOUND, ManagedAccessPurpose.RELOCATION], startedAt: activationAt, expiresAt, status: SS.ACTIVE, revision: 0, checkInIdempotencyKey: key, checkInRequestHash: requestHash,
          audit: [audit('SESSION_ACTIVATED', actor, activationAt, { expiresAt: expiresAt.toISOString(), durationMinutes: (expiresAt.getTime() - activationAt.getTime()) / 60_000,
            maxDurationMinutes: ACCESS_SESSION_MAX_DURATION_MINUTES })] }], { session: dbSession }); result = created;
      });
    } catch (error: any) { if (error?.code === 11000) fail(409, 'CONCURRENT_CHECKIN', 'Một check-in khác đã tạo Session; tải lại để xem trạng thái.'); throw error; }
    finally { await dbSession.endSession(); }
    if (!result) fail(500, 'SESSION_CREATION_FAILED', 'Không thể kích hoạt Access Session.');
    if (!replay) {
      const persistedVisit = await VisitModel.findById(id).exec();
      const checkinAudit = [...(persistedVisit?.audit ?? [])].reverse().find((entry: any) => entry.action === 'CUSTOMER_CHECKED_IN');
      await notifyVisitTransition(persistedVisit, NotificationType.MANAGED_VISIT_CHECKED_IN,
        `VISIT:${id}:REV:${checkinAudit?.details?.eventRevision ?? persistedVisit?.revision}:CHECKED_IN`, 'Đã check-in');
      await notifySessionTransition(result, NotificationType.MANAGED_ACCESS_SESSION_ISSUED,
        `SESSION:${result._id}:ISSUED`, 'Phiên truy cập đã được cấp');
    }
    return { visit: await VisitModel.findById(id).exec(), session: result, replay };
  }
  static async customerSessions(actor: Actor) { requireRole(actor, [UserRole.CUSTOMER]); const now = new Date(); return SessionModel.find({ customerId: actor._id, status: SS.ACTIVE }).sort({ startedAt: -1 }).lean().then(rows => rows.map(row => ({ ...row, status: new Date(row.expiresAt) <= now ? SS.EXPIRED : row.status }))); }
  static async sessionDetail(sessionId: unknown, actor: Actor) {
    const session = await SessionModel.findById(asId(sessionId, 'sessionId')).lean().exec(); if (!session) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy Access Session.');
    if (actor.role === UserRole.CUSTOMER && !new Types.ObjectId(session.customerId).equals(actor._id)) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy Access Session.');
    if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) { scope(actor, session.facilityId); if (actor.role === UserRole.FACILITY_STAFF && !new Types.ObjectId(session.assignedStaffId).equals(actor._id)) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy Access Session.'); }
    const status = session.status === SS.ACTIVE && new Date(session.expiresAt) <= new Date() ? SS.EXPIRED : session.status; return { ...session, status };
  }
  static async facilitySessions(actor: Actor) {
    requireRole(actor, [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]); if (!actor.assignedFacilityId) fail(403, 'FACILITY_SCOPE_DENIED', 'Chưa được phân công Facility.');
    const filter: Record<string, unknown> = { facilityId: actor.assignedFacilityId }; if (actor.role === UserRole.FACILITY_STAFF) filter.assignedStaffId = actor._id;
    const now = new Date(), rows = await SessionModel.find(filter).sort({ startedAt: -1 }).limit(200).lean().exec(); return rows.map(row => ({ ...row, status: row.status === SS.ACTIVE && new Date(row.expiresAt) <= now ? SS.EXPIRED : row.status }));
  }
  static async finishSession(sessionId: unknown, body: unknown, actor: Actor, expectedRevision: unknown, revoke: boolean) {
    requireRole(actor, revoke ? [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER] : [UserRole.FACILITY_STAFF]);
    const input = plain(body ?? {}, revoke ? ['reason'] : [], revoke ? 'Thu hồi an toàn' : 'Check-out');
    if (!Number.isSafeInteger(Number(expectedRevision))) fail(428, 'IF_MATCH_REQUIRED', 'Cần revision hiện tại trong If-Match.');
    if (revoke && (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500)) fail(400, 'INVALID_INPUT', 'Cần lý do thu hồi từ 3 đến 500 ký tự.');
    if (!actor.assignedFacilityId) fail(403, 'FACILITY_SCOPE_DENIED', 'Chưa được phân công Facility.');
    const now = new Date(), dbSession = await mongoose.startSession(); let result: any;
    try {
      await dbSession.withTransaction(async () => {
        const filter: Record<string, unknown> = { _id: asId(sessionId, 'sessionId'), facilityId: actor.assignedFacilityId, status: SS.ACTIVE, revision: Number(expectedRevision) };
        if (actor.role === UserRole.FACILITY_STAFF) filter.assignedStaffId = actor._id;
        const update: Record<string, unknown> = { $set: { status: revoke ? SS.REVOKED : SS.CHECKED_OUT, endedAt: now, ...(revoke ? { revokedAt: now, revokedBy: actor._id, revokeReason: (input.reason as string).trim() } : {}) }, $inc: { revision: 1 }, $push: { audit: audit(revoke ? 'SESSION_REVOKED' : 'SESSION_CHECKED_OUT', actor, now, revoke ? { reason: (input.reason as string).trim() } : undefined) } };
        const ended = await SessionModel.findOneAndUpdate(filter, update, { returnDocument: 'after', session: dbSession }).exec();
        if (!ended) fail(412, 'STALE_OR_INACTIVE_SESSION', 'Session đã hết hạn, kết thúc hoặc thay đổi; tải lại trước khi thao tác.');
        if (ended.expiresAt <= now && !revoke) { ended.status = SS.EXPIRED; ended.audit.push(audit('SESSION_EXPIRED_CHECKED_OUT', actor, now)); await ended.save({ session: dbSession }); }
        if (!revoke) {
          const visit = await VisitModel.findOneAndUpdate({ _id: ended.visitId, status: VS.CHECKED_IN }, { $set: { status: VS.COMPLETED, checkedOutAt: now }, $inc: { revision: 1 }, $push: { audit: audit('CUSTOMER_CHECKED_OUT', actor, now) } }, { returnDocument: 'after', session: dbSession }).exec();
          if (!visit) fail(409, 'VISIT_SESSION_STATE_CONFLICT', 'Trạng thái Visit không khớp Session; thao tác đã hủy.');
        } else {
          const closedVisit = await VisitModel.updateOne({ _id: ended.visitId, status: VS.CHECKED_IN }, { $set: { status: VS.COMPLETED, checkedOutAt: now }, $inc: { revision: 1 }, $push: { audit: audit('SESSION_REVOKED', actor, now, { reason: (input.reason as string).trim() }) } }, { session: dbSession }).exec();
          if (closedVisit.matchedCount !== 1) fail(409, 'VISIT_SESSION_STATE_CONFLICT', 'Trạng thái Visit không khớp Session; thao tác đã hủy.');
        }
        result = ended;
      });
    } finally { await dbSession.endSession(); }
    if (!result) fail(500, 'SESSION_END_FAILED', 'Không thể kết thúc Access Session.');
    if (revoke) await notifySessionTransition(result, NotificationType.MANAGED_ACCESS_SESSION_REVOKED,
      `SESSION:${result._id}:REV:${result.revision}:REVOKED`, 'Phiên truy cập đã bị thu hồi');
    else {
      const completed = await VisitModel.findById(result.visitId).exec();
      if (completed) await notifyVisitTransition(completed, NotificationType.MANAGED_VISIT_COMPLETED,
        `VISIT:${completed._id}:REV:${completed.revision}:COMPLETED`, 'Lượt đến kho đã hoàn tất');
    }
    return result;
  }
}

/** Transaction-safe revision fence for future D3/D4 writers. Caller must abort the transaction if this function throws. */
export async function assertManagedAccessSessionScope(input: { sessionId: string | Types.ObjectId; customerId: string | Types.ObjectId; reservationId: string | Types.ObjectId; reservationIds?: Array<string | Types.ObjectId>; facilityId: string | Types.ObjectId; purpose: ManagedAccessPurpose; cellIds: Array<string | Types.ObjectId>; expectedRevision: number; dbSession?: mongoose.ClientSession }): Promise<IManagedAccessSession> {
  if (!input.dbSession) fail(500, 'TRANSACTION_REQUIRED', 'Access Session guard phải chạy trong MongoDB transaction.');
  const now = new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      !Array.isArray(input.cellIds) || input.cellIds.length === 0 || input.cellIds.length > 100) fail(400, 'INVALID_ACCESS_SCOPE', 'Cần thời gian, revision và danh sách Cell hợp lệ.');
  const cellIds = input.cellIds.map(value => asId(typeof value === 'string' ? value : String(value), 'cellId'));
  const cellIdStrings = cellIds.map(String);
  const requestedReservationIds = [...new Set([String(input.reservationId), ...(input.reservationIds ?? []).map(String)])];
  if (requestedReservationIds.length > 20) fail(400, 'INVALID_ACCESS_SCOPE', 'Phạm vi Reservation vượt giới hạn an toàn.');
  if (new Set(cellIdStrings).size !== cellIdStrings.length) fail(400, 'INVALID_ACCESS_SCOPE', 'Danh sách Cell không được trùng lặp.');
  const record = await SessionModel.findOneAndUpdate({ _id: input.sessionId, customerId: input.customerId,
    $or: [{ reservationId: input.reservationId }, { scopedReservationIds: input.reservationId }],
    facilityId: input.facilityId, status: SS.ACTIVE, startedAt: { $lte: now }, expiresAt: { $gt: now }, revision: input.expectedRevision,
    allowedPurposes: input.purpose, allowedCellIds: { $all: cellIds } },
  { $inc: { revision: 1 }, $push: { audit: { action: 'SESSION_SCOPE_FENCED', actorId: new Types.ObjectId(String(input.customerId)), actorRole: UserRole.CUSTOMER, at: now,
    details: { purpose: input.purpose, cellIds: cellIdStrings, priorRevision: input.expectedRevision } } } },
  { returnDocument: 'after', session: input.dbSession }).exec();
  if (!record || !accessSessionCoversReservations({ reservationId: record.reservationId, scopedReservationIds: record.scopedReservationIds, requestedReservationIds })) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Access Session không bao phủ đầy đủ các Reservation của thao tác.');
  if (!record || !isAccessSessionAllowed({ status: record.status, startedAt: record.startedAt, expiresAt: record.expiresAt, revision: record.revision,
    customerId: String(record.customerId), reservationId: String(record.reservationId), facilityId: String(record.facilityId),
    allowedPurposes: record.allowedPurposes, allowedCellIds: record.allowedCellIds.map(String),
    expected: { now, revision: input.expectedRevision + 1, customerId: String(input.customerId), reservationId: String(record.reservationId), facilityId: String(input.facilityId), purpose: input.purpose, cellId: cellIdStrings[0]! } })) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Access Session không còn hiệu lực hoặc không khớp scope của thao tác.');
  const reservationFilter = { _id: input.reservationId, customerId: input.customerId, facilityId: input.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
    bookingFlowVersion: 3, status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now }, handoverAt: { $exists: true }, handoverByStaffId: { $exists: true } };
  const reservationFence = await (ReservationModel as any).findOneAndUpdate(reservationFilter, { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: input.dbSession }).exec();
  if (!reservationFence) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Rental không còn hoạt động hoặc đã thay đổi.');
  const reservation = await ReservationModel.findById(input.reservationId).session(input.dbSession).exec();
  if (!reservation || reservation.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || !reservation.fullPaymentId) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Reservation không còn đáp ứng điều kiện Managed V3.');
  const scopedReservations: any[] = [reservation];
  for (const reservationId of requestedReservationIds.filter(value => value !== String(input.reservationId)).sort()) {
    const filter = { _id: new Types.ObjectId(reservationId), customerId: input.customerId, facilityId: input.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
      bookingFlowVersion: 3, status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now }, handoverAt: { $exists: true }, handoverByStaffId: { $exists: true } };
    const target: any = await (ReservationModel as any).findOneAndUpdate(filter, { $inc: { managedAccessRevision: 1 } }, { returnDocument: 'after', session: input.dbSession }).exec();
    if (!target || target.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || !target.fullPaymentId) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Reservation đích không còn đủ điều kiện hoạt động.');
    const targetPaymentFilter = { _id: target.fullPaymentId, reservationId: target._id, customerId: input.customerId, facilityId: input.facilityId,
      serviceType: FacilityServiceType.MANAGED_INVENTORY, purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
      providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED };
    if (await PaymentModel.updateOne(targetPaymentFilter, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec().then((result: any) => result.matchedCount !== 1)) fail(409, 'PAYMENT_NOT_VERIFIED', 'Thanh toán Reservation đích không còn được xác minh.');
    const targetContractFilter = { reservationId: target._id, customerId: input.customerId, status: ContractStatus.SIGNED };
    const targetContract: any = await ContractModel.findOne(targetContractFilter).session(input.dbSession).lean().exec();
    const targetActive = targetContract?.contentVersions?.find((version: any) => version.version === targetContract.currentContentVersion);
    const targetContentValid = !!targetActive && /^[a-f\d]{64}$/i.test(targetActive.contentHash) && createHash('sha256').update(JSON.stringify(targetActive.content)).digest('hex') === targetActive.contentHash;
    if (!targetContentValid || !targetContract?.signedProofPublicId || !targetContract.verifiedAt ||
        !targetContract.signatures?.some((signature: any) => signature.version === targetActive.version && signature.contentHash === targetActive.contentHash && signature.signerRole === UserRole.CUSTOMER) ||
        !targetContract.signatures?.some((signature: any) => signature.version === targetActive.version && signature.contentHash === targetActive.contentHash && [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(signature.signerRole))) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Hợp đồng Reservation đích không còn hợp lệ.');
    const targetContractFence = await ContractModel.updateOne({ ...targetContractFilter, currentContentVersion: targetContract.currentContentVersion }, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec();
    if (targetContractFence.matchedCount !== 1) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Hợp đồng Reservation đích vừa thay đổi.');
    scopedReservations.push(target);
  }
  const visit = await VisitModel.findOne({ _id: record.visitId, customerId: input.customerId, facilityId: input.facilityId, status: VS.CHECKED_IN }).session(input.dbSession).lean().exec();
  // Visit authorizes presence and reservation scope. The Session's allowedPurposes
  // and this operation's purpose are checked independently above.
  if (!visit || !accessSessionCoversReservations({ reservationId: visit.reservationId, scopedReservationIds: visit.scopedReservationIds,
    requestedReservationIds: [...requestedReservationIds, String(record.reservationId)] })) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Visit không còn CHECKED_IN hoặc sai phạm vi Reservation.');
  const facilityFence = await FacilityModel.updateOne({ _id: input.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY,
    deletedAt: { $exists: false } }, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec();
  if (facilityFence.matchedCount !== 1) fail(409, 'FACILITY_UNAVAILABLE', 'Facility Managed Inventory không còn hoạt động.');
  const paymentFilter = { _id: reservation.fullPaymentId, reservationId: reservation._id, customerId: input.customerId, facilityId: input.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
    providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED };
  const paymentFence = await PaymentModel.updateOne(paymentFilter, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec();
  if (paymentFence.matchedCount !== 1) fail(409, 'PAYMENT_NOT_VERIFIED', 'Thanh toán không còn ở trạng thái đã xác minh.');
  const contractFilter = { reservationId: reservation._id, customerId: input.customerId, status: ContractStatus.SIGNED };
  const contractFence = await ContractModel.updateOne(contractFilter, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec();
  if (contractFence.matchedCount !== 1) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Hợp đồng không còn ở trạng thái đã ký.');
  const contract = await ContractModel.findOne(contractFilter).select('signedProofPublicId verifiedAt currentContentVersion contentVersions signatures').session(input.dbSession).lean().exec();
  const active = contract?.contentVersions?.find(version => version.version === contract.currentContentVersion);
  const contentValid = !!active && /^[a-f\d]{64}$/i.test(active.contentHash) && createHash('sha256').update(JSON.stringify(active.content)).digest('hex') === active.contentHash;
  if (!contract?.signedProofPublicId || !contract.verifiedAt || !contentValid || !contract.signatures?.some(signature => signature.version === active?.version && signature.contentHash === active?.contentHash && signature.signerRole === UserRole.CUSTOMER) ||
      !contract.signatures?.some(signature => signature.version === active?.version && signature.contentHash === active?.contentHash && [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(signature.signerRole as UserRole))) fail(409, 'HANDOVER_PREREQUISITES_MISSING', 'Phiên bản hợp đồng hiện hành chưa được ký và xác minh đầy đủ.');
  const allAllocated: Types.ObjectId[] = [];
  for (const scopedReservation of scopedReservations) {
    const allocated = scopedReservation.allocatedCellIds ?? [];
    const allocationFence = await CellAllocationModel.updateMany({ reservationId: scopedReservation._id, customerId: input.customerId, facilityId: input.facilityId, cellId: { $in: allocated },
      status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] }, startDate: { $lte: now }, endDate: { $gt: now } }, { $inc: { managedAccessRevision: 1 } }, { session: input.dbSession }).exec();
    if (!allocated.length || allocationFence.matchedCount !== allocated.length) fail(409, 'ALLOCATION_INVALID', 'Cell allocation vừa thay đổi hoặc không còn hợp lệ.');
    allAllocated.push(...allocated);
  }
  if (cellIdStrings.some(cell => !allAllocated.some(allocated => String(allocated) === cell))) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Cell không còn được phân bổ cho Reservation tương ứng.');
  const commitCheckAt = new Date();
  if (!sessionIsCurrent({ status: record.status, startedAt: record.startedAt, expiresAt: record.expiresAt, now: commitCheckAt }) ||
      reservation.startDate > commitCheckAt || reservation.endDate <= commitCheckAt) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Access Session hoặc Rental đã hết hạn trong lúc xác minh scope.');
  await activeCells(reservation, input.dbSession, commitCheckAt);
  return record;
}
