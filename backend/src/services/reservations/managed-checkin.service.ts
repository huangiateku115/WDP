import crypto from 'crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import FacilityModel from '../../models/facilities/facility.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ReceivingInspectionEvidenceModel from '../../models/inventory-items/receiving-inspection-evidence.model';
import { ManagedReceivingEvidenceService } from '../upload/managed-receiving-evidence.service';
import ContractModel from '../../models/contracts/contract.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import UserModel from '../../models/users/user.model';
import ManagedFacilityCapacityModel from '../../models/reservations/managed-facility-capacity.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { UserRole, IUser } from '../../types/user.type';
import { InventoryItemStatus, ReceivingCustodyStatus, ReceivingInspectionDecision } from '../../types/inventory-item.type';
import { ContractStatus, IContract } from '../../types/contract.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { PaymentProvider, PaymentPurpose, PaymentStatus, PaymentApplicationStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { assertIdempotentPaymentMatch, calculateRentalPaymentBreakdown, PaymentAccountingError, transitionPaymentStatus } from '../payments/payment-accounting';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
export class ManagedCheckinError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new ManagedCheckinError(status, message); }
const live = { deletedAt: { $exists: false } };
const enabled = () => process.env.NODE_ENV === 'development' && process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true';
const id = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, `Invalid ${label}`);
  return new Types.ObjectId(value);
};
const record = (value: unknown, allowed: string[], label: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key) || key.startsWith('$'))) fail(400, `Invalid ${label}`);
  return value as Record<string, any>;
};
async function tx<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try { let result!: T; await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); return result; }
  catch (error) { if (error instanceof ManagedCheckinError) throw error; const e = error as any; if (e?.code === 11000 || e?.code === 112 || e?.codeName === 'WriteConflict' || e?.name === 'VersionError' || e?.hasErrorLabel?.('TransientTransactionError')) fail(409, 'Managed check-in changed concurrently; reload and retry'); throw error; }
  finally { await session.endSession(); }
}
async function lockFacility(facilityId: Types.ObjectId, session: ClientSession) {
  const lock = await ManagedFacilityCapacityModel.findOneAndUpdate({ facilityId }, { $inc: { bookingVersion: 1 } }, { new: true, session }).exec();
  if (!lock) fail(409, 'Managed capacity configuration is missing');
}
function assertFacilityRepresentative(actor: Actor, facilityId: Types.ObjectId) {
  if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Assigned Facility representative required');
  if (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(facilityId)) fail(403, 'Facility is outside assigned scope');
}
async function loadV2Reservation(reservationId: Types.ObjectId, session: ClientSession, ownerId?: Types.ObjectId) {
  const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2, ...(ownerId ? { customerId: ownerId } : {}) }).session(session).exec();
  if (!reservation) fail(404, 'Version 2 Managed reservation not found');
  return reservation;
}
async function currentContent(reservation: any, session: ClientSession) {
  const items = await InventoryItemModel.find({ managedReservationId: reservation._id, ...live })
    .sort({ itemCode: 1 }).session(session).lean().exec();
  const facility = await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
    serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).lean().exec();
  if (!facility) fail(409, 'Active Managed Facility required for contract');
  const expectedCellIds = (reservation.allocatedCellIds ?? []).map((cell: Types.ObjectId) => String(cell)).sort();
  const accepted = items.filter((item: any) => item.receivingInspection?.decision === ReceivingInspectionDecision.ACCEPTED);
  const unresolved = items.some((item: any) => item.status === InventoryItemStatus.PENDING_INBOUND && !item.receivingInspection?.decision);
  const hasDiscrepancies = items.some((item: any) => item.receivingInspection?.decision === ReceivingInspectionDecision.DISCREPANCY);
  const hasRejectedGoods = items.some((item: any) => item.receivingInspection?.decision === ReceivingInspectionDecision.REJECTED);
  const depositPaid = await ReservationPaymentModel.findOne({ reservationId: reservation._id, purpose: PaymentPurpose.DEPOSIT, status: PaymentStatus.SUCCEEDED }).session(session).lean().exec();
  if (!depositPaid) fail(409, 'Successful deposit ledger entry required');
  if (depositPaid.serviceType !== FacilityServiceType.MANAGED_INVENTORY || String(depositPaid.customerId) !== String(reservation.customerId) || depositPaid.currency !== 'VND' || depositPaid.amount !== reservation.depositAmount) fail(409, 'Successful deposit does not match this Managed reservation');
  const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent, depositAmount: depositPaid.amount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
  const content = {
    reservation: { id: String(reservation._id), code: reservation.reservationCode, facilityId: String(reservation.facilityId), cellIds: expectedCellIds, startDate: reservation.startDate, endDate: reservation.endDate, term: (reservation.managedPricingSnapshot as any)?.term },
    facility: { name: facility.name, code: facility.code },
    pricing: { ...(reservation.managedPricingSnapshot as any), totalDue: breakdown.totalDue, depositCredit: breakdown.depositCredit, balanceDue: breakdown.balanceDue },
    handover: items.filter((item: any) => item.receivingInspection).map((item: any) => ({ itemId: String(item._id), itemCode: item.itemCode, name: item.name, category: item.category, decision: item.receivingInspection.decision, quantity: item.receivingInspection.observedQuantity, quantityUnit: item.quantityUnit, weightKg: item.receivingInspection.observedUnitWeightKg, dimensionsM: item.receivingInspection.observedUnitDimensionsM, compatibleCellIds: (item.receivingInspection.compatibleWithCellIds ?? []).map(String).sort(), packingLayoutVerified: item.receivingInspection.packingLayoutVerified, custodyStatus: item.receivingCustodyStatus ?? ReceivingCustodyStatus.NONE, note: item.receivingInspection.note, inspectedAt: item.receivingInspection.inspectedAt })),
  };
  return { content, ready: accepted.length > 0 && !unresolved && !hasDiscrepancies && !hasRejectedGoods };
}
function hashContent(content: unknown) { return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex'); }
function v3SnapshotMatchesReservation(content: any, reservation: any) {
  const cells = (reservation.allocatedCellIds ?? []).map(String).sort();
  const snapshot = content?.reservation;
  return content?.schemaVersion === 3 && snapshot?.id === String(reservation._id) && snapshot?.facilityId === String(reservation.facilityId) &&
    JSON.stringify(snapshot?.cellIds) === JSON.stringify(cells) && snapshot?.allocatedCapacityM3 === reservation.allocatedCapacity &&
    new Date(snapshot?.startDate).getTime() === new Date(reservation.startDate).getTime() &&
    new Date(snapshot?.endDate).getTime() === new Date(reservation.endDate).getTime() &&
    JSON.stringify(content?.pricing?.snapshot) === JSON.stringify(reservation.managedPricingSnapshot) &&
    content?.pricing?.estimatedRent === reservation.estimatedRent && content?.pricing?.depositAmount === reservation.depositAmount &&
    content?.pricing?.taxAmount === reservation.taxAmount && content?.pricing?.discountAmount === reservation.discountAmount &&
    content?.facility?.id === String(reservation.facilityId);
}
async function ensureVersion(contract: IContract, reservation: any, actorId: Types.ObjectId, session: ClientSession) {
  const { content } = await currentContent(reservation, session);
  const contentHash = hashContent(content);
  const active = contract.contentVersions?.find(version => version.version === contract.currentContentVersion);
  if (!active || active.contentHash !== contentHash) {
    const version = (contract.currentContentVersion ?? 0) + 1;
    contract.contentVersions = [...(contract.contentVersions ?? []), { version, contentHash, content, createdBy: actorId, createdAt: new Date() }] as any;
    contract.currentContentVersion = version;
    contract.status = ContractStatus.DRAFT;
    contract.set('signedByCustomerAt', undefined);
    contract.set('signedByFMAt', undefined);
    contract.set('fmId', undefined);
  }
  return { version: contract.currentContentVersion!, contentHash };
}
async function audit(reservation: any, actor: Actor, action: ManagedReservationAction, details: Record<string, unknown>, session: ClientSession) {
  await new ManagedReservationAuditModel({ facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id, action, details }).save({ session });
}

export class ManagedCheckinService {
  static async inspectItem(itemIdInput: unknown, body: unknown, actor: Actor) {
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    const itemId = id(itemIdInput, 'itemId');
    const input = record(body, ['decision', 'observedQuantity', 'observedUnitWeightKg', 'observedUnitDimensionsM', 'compatibleCellIds', 'packingLayoutVerified', 'note', 'custodyTaken', 'evidenceUploadIds', 'idempotencyKey'], 'inspection');
    if (!Object.values(ReceivingInspectionDecision).includes(input.decision)) fail(400, 'Invalid inspection decision');
    if (!Number.isSafeInteger(input.observedQuantity) || input.observedQuantity < 1 || typeof input.observedUnitWeightKg !== 'number' || !Number.isFinite(input.observedUnitWeightKg) || input.observedUnitWeightKg <= 0) fail(400, 'Observed quantity and weight must be positive');
    const dimensions = input.observedUnitDimensionsM;
    if (!dimensions || ['widthM', 'depthM', 'heightM'].some(key => typeof dimensions[key] !== 'number' || !Number.isFinite(dimensions[key]) || dimensions[key] <= 0)) fail(400, 'Observed dimensions must be positive');
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1000 || typeof input.custodyTaken !== 'boolean' || typeof input.packingLayoutVerified !== 'boolean' || !Array.isArray(input.compatibleCellIds)) fail(400, 'Inspection note, custodyTaken, packingLayoutVerified and compatibleCellIds are required');
    const compatibleCellIds = input.compatibleCellIds.map((value: unknown) => id(value, 'compatibleCellId'));
    if (input.evidenceUploadIds !== undefined && (!Array.isArray(input.evidenceUploadIds) || input.evidenceUploadIds.length > 10)) fail(400, 'evidenceUploadIds must contain at most 10 images');
    const evidenceUploadIds = (input.evidenceUploadIds ?? []).map((value: unknown) => id(value, 'evidenceUploadId'));
    const idempotencyKey = input.idempotencyKey;
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(idempotencyKey))) fail(400, 'Invalid inspection idempotencyKey');
    const payloadHash = hashContent({ decision: input.decision, observedQuantity: input.observedQuantity, observedUnitWeightKg: input.observedUnitWeightKg,
      observedUnitDimensionsM: dimensions, compatibleCellIds: compatibleCellIds.map(String), packingLayoutVerified: input.packingLayoutVerified,
      note: input.note.trim(), custodyTaken: input.custodyTaken, evidenceUploadIds: evidenceUploadIds.map(String) });
    return tx(async session => {
      const current = await InventoryItemModel.findOne({ _id: itemId, ...live }).session(session).exec();
      if (!current) fail(404, 'Inventory item not found');
      if (actor.role !== UserRole.FACILITY_STAFF) fail(403, 'Facility Staff role required for physical inspection');
      assertFacilityRepresentative(actor, current.facilityId);
      const reservation = await loadV2Reservation(current.managedReservationId, session);
      if (!reservation.facilityId.equals(current.facilityId) || !reservation.customerId.equals(current.customerId)) fail(409, 'Item ownership and Facility must match its Managed reservation');
      // Replays are resolved before temporary upload-state checks; the committed snapshot already owns those uploads.
      if (idempotencyKey !== undefined) {
        const replay = await ReceivingInspectionEvidenceModel.findOne({ itemId: current._id, idempotencyKey }).session(session).exec();
        if (replay) {
          if (replay.payloadHash !== payloadHash || String(replay.facilityId) !== String(current.facilityId) || !replay.inspectedBy.equals(actor._id)) fail(409, 'Inspection idempotencyKey was already used with a different payload or Staff member');
          return current;
        }
      }
      if (reservation.status !== ReservationStatus.DEPOSIT_PAID) fail(409, 'Inspection requires a DEPOSIT_PAID v2 Managed reservation');
      if (reservation.balanceSettledAt) fail(409, 'Receiving inspection is locked after contract and balance completion');
      await lockFacility(reservation.facilityId, session);
      if (![InventoryItemStatus.PENDING_INBOUND, InventoryItemStatus.RECEIVED_PENDING_ACCEPTANCE].includes(current.status)) fail(409, 'Only a requested inbound item may be inspected');
      const previousInspection = current.receivingInspection as any;
      const sameCompatibleCells = JSON.stringify((previousInspection?.compatibleWithCellIds ?? []).map(String).sort()) === JSON.stringify(compatibleCellIds.map(String).sort());
      const completingAcceptedCustody = previousInspection?.decision === ReceivingInspectionDecision.ACCEPTED &&
        current.status === InventoryItemStatus.PENDING_INBOUND && current.receivingCustodyStatus === ReceivingCustodyStatus.NONE &&
        input.decision === ReceivingInspectionDecision.ACCEPTED && input.custodyTaken && sameCompatibleCells &&
        previousInspection.observedQuantity === input.observedQuantity && round(previousInspection.observedUnitWeightKg, 3) === round(input.observedUnitWeightKg, 3) &&
        ['widthM', 'depthM', 'heightM'].every(key => round(previousInspection.observedUnitDimensionsM?.[key], 6) === round(dimensions[key], 6)) &&
        Boolean(previousInspection.packingLayoutVerified) === input.packingLayoutVerified && previousInspection.note === input.note.trim();
      if (previousInspection?.decision === ReceivingInspectionDecision.ACCEPTED && !completingAcceptedCustody) fail(409, 'An accepted receiving inspection cannot be overwritten; only its unchanged inspection may complete custody');
      const allowedCells = (reservation.allocatedCellIds ?? []).map(String);
      if (compatibleCellIds.some((cellId: Types.ObjectId) => !allowedCells.includes(String(cellId)))) fail(409, 'Compatible Cells must be allocated to this reservation');
      const allocationCount = await CellAllocationModel.countDocuments({ reservationId: reservation._id, customerId: reservation.customerId,
        cellId: { $in: compatibleCellIds }, status: CellAllocationStatus.RESERVED }).session(session).exec();
      if (allocationCount !== compatibleCellIds.length) fail(409, 'Every inspected Cell must remain RESERVED for this rental');
      const cells = await WarehouseCellModel.find({ _id: { $in: compatibleCellIds }, facilityId: reservation.facilityId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }).session(session).exec();
      if (cells.length !== compatibleCellIds.length) fail(409, 'Every compatible Cell must be active in the reservation Facility');
      const zoneIds = [...new Set(cells.map(cell => String(cell.zoneId)))].sort();
      for (const zoneId of zoneIds) {
        const zone = await WarehouseZoneModel.findOneAndUpdate({ _id: zoneId, facilityId: reservation.facilityId, isActive: true, ...live },
          { $inc: { structureVersion: 1 } }, { new: true, session }).exec();
        if (!zone) fail(409, 'Inspected Cell Zone must remain active');
      }
      const rackIds = [...new Set(cells.map(cell => String(cell.rackId)))].sort();
      for (const rackId of rackIds) {
        const source = cells.find(cell => String(cell.rackId) === rackId)!;
        const rack = await WarehouseRackModel.findOneAndUpdate({ _id: rackId, facilityId: reservation.facilityId, zoneId: source.zoneId,
          operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }, { $inc: { layoutVersion: 1 } }, { new: true, session }).exec();
        if (!rack) fail(409, 'Inspected Cell Rack must remain available');
      }
      for (const cell of cells) {
        const locked = await WarehouseCellModel.findOneAndUpdate({ _id: cell._id, facilityId: reservation.facilityId,
          operationalStatus: WarehouseOperationalStatus.AVAILABLE, usedWeightKg: { $eq: 0, $exists: true }, usedVolumeM3: { $eq: 0, $exists: true }, ...live },
        { $inc: { allocationVersion: 1 } }, { new: true, session }).exec();
        if (!locked) fail(409, 'Inspected Cell physical usage must be known and empty');
      }
      if (input.decision === ReceivingInspectionDecision.ACCEPTED &&
        (input.observedQuantity !== current.quantity || round(input.observedUnitWeightKg, 3) !== round(current.unitWeightKg, 3) ||
          ['widthM', 'depthM', 'heightM'].some(key => round(dimensions[key], 6) !== round((current.unitDimensionsM as any)[key], 6)))) {
        fail(409, 'Observed goods differ from the registered item; record DISCREPANCY or have the owner correct the registration');
      }
      if (input.decision === ReceivingInspectionDecision.ACCEPTED && input.observedQuantity > 1 && !input.packingLayoutVerified) fail(409, 'Staff must physically verify the multi-unit packing layout before acceptance');
      const compatibleCells = cells.filter(cell => {
        const widthFits = (dimensions.widthM <= cell.dimensions.widthM && dimensions.depthM <= cell.dimensions.depthM) ||
          (dimensions.depthM <= cell.dimensions.widthM && dimensions.widthM <= cell.dimensions.depthM);
        const volume = dimensions.widthM * dimensions.depthM * dimensions.heightM * input.observedQuantity;
        const volumeLimit = cell.dimensions.widthM * cell.dimensions.depthM * Number(cell.dimensions.usableHeightM);
        const countersKnown = Number.isFinite(cell.usedWeightKg) && Number.isFinite(cell.usedVolumeM3);
        const physicallyAvailable = cell.usedWeightKg === 0 && cell.usedVolumeM3 === 0;
        return widthFits && Number.isFinite(cell.dimensions.usableHeightM) && dimensions.heightM <= Number(cell.dimensions.usableHeightM) &&
          input.observedUnitWeightKg * input.observedQuantity <= cell.maxWeightKg && volume <= volumeLimit && countersKnown && physicallyAvailable;
      });
      const acceptedIds = new Set(compatibleCells.map(cell => String(cell._id)));
      if (input.decision === ReceivingInspectionDecision.ACCEPTED && (!compatibleCellIds.length || compatibleCells.length !== compatibleCellIds.length || compatibleCellIds.some((cellId: Types.ObjectId) => !acceptedIds.has(String(cellId))))) fail(409, 'Accepted goods must fit every selected allocated Cell and its verified empty physical capacity');
      const inspectedAt = new Date();
      const previousAttempts = await ReceivingInspectionEvidenceModel.countDocuments({ itemId: current._id }).session(session).exec();
      const evidenceSnapshot = new ReceivingInspectionEvidenceModel({
        itemId: current._id, reservationId: reservation._id, facilityId: reservation.facilityId, attempt: previousAttempts + 1,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}), payloadHash, decision: input.decision,
        observedQuantity: input.observedQuantity, observedUnitWeightKg: input.observedUnitWeightKg,
        observedUnitDimensionsM: dimensions, compatibleCellIds, packingLayoutVerified: input.packingLayoutVerified,
        note: input.note.trim(), custodyTaken: input.custodyTaken, inspectedBy: actor._id, inspectedAt, images: [],
      });
      evidenceSnapshot.images = await ManagedReceivingEvidenceService.attach(evidenceUploadIds, current._id, reservation.facilityId, actor._id, evidenceSnapshot._id, session) as any;
      await evidenceSnapshot.save({ session });
      current.receivingInspection = { decision: input.decision, observedQuantity: input.observedQuantity, observedUnitWeightKg: input.observedUnitWeightKg, observedUnitDimensionsM: dimensions, compatibleWithCellIds: compatibleCellIds, packingLayoutVerified: input.packingLayoutVerified, note: input.note.trim(), inspectedBy: actor._id, inspectedAt } as any;
      current.receivingCustodyStatus = input.custodyTaken ? ReceivingCustodyStatus.IN_CUSTODY : ReceivingCustodyStatus.NONE;
      if (input.decision === ReceivingInspectionDecision.REJECTED) {
        if (input.custodyTaken) fail(400, 'Rejected goods cannot remain in Facility custody; return them before recording rejection');
        current.receivingCustodyStatus = ReceivingCustodyStatus.RETURNED;
        current.status = InventoryItemStatus.REGISTERED;
        current.inboundRejection = { reason: input.note.trim(), rejectedAt: inspectedAt, rejectedBy: actor._id } as any;
        current.set('inboundRequestedAt', undefined); current.set('inboundRequestedBy', undefined);
      } else if (input.custodyTaken) current.status = InventoryItemStatus.RECEIVED_PENDING_ACCEPTANCE;
      else current.status = InventoryItemStatus.PENDING_INBOUND;
      await current.save({ session });
      const existingContract = await ContractModel.findOne({ reservationId: reservation._id }).session(session).exec();
      if (existingContract) {
        const version = await ensureVersion(existingContract, reservation, actor._id, session);
        await existingContract.save({ session });
        await audit(reservation, actor, ManagedReservationAction.CONTRACT_VERSION_CREATED, { contractId: existingContract._id, version: version.version, reason: 'Inspected handover content changed' }, session);
      }
      await audit(reservation, actor, ManagedReservationAction.ITEM_INSPECTED, { itemId: current._id, evidenceSnapshotId: evidenceSnapshot._id,
        evidenceAttempt: evidenceSnapshot.attempt, imageCount: evidenceSnapshot.images.length, decision: input.decision,
        observedQuantity: input.observedQuantity, observedUnitWeightKg: input.observedUnitWeightKg, observedUnitDimensionsM: dimensions,
        custodyTaken: input.custodyTaken, compatibleCellIds, packingLayoutVerified: input.packingLayoutVerified, note: input.note.trim() }, session);
      return current;
    });
  }

  static async receivingContext(itemIdInput: unknown, actor: Actor) {
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    const itemId = id(itemIdInput, 'itemId');
    if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId) fail(403, 'Assigned Facility Staff required');
    const item = await InventoryItemModel.findOne({ _id: itemId, facilityId: actor.assignedFacilityId, ...live }).lean().exec();
    if (!item) fail(404, 'Managed Inventory Item not found in assigned Facility');
    const reservation = await ReservationModel.findOne({ _id: item.managedReservationId, facilityId: actor.assignedFacilityId,
      serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2 }).select('_id reservationCode facilityId status balanceSettledAt allocatedCellIds').lean().exec();
    if (!reservation) fail(404, 'Managed reservation not found in assigned Facility');
    const evidence = await ReceivingInspectionEvidenceModel.find({ itemId, facilityId: actor.assignedFacilityId }).sort({ attempt: 1 }).lean().exec();
    const cells = await WarehouseCellModel.find({ _id: { $in: reservation.allocatedCellIds ?? [] }, facilityId: actor.assignedFacilityId, ...live })
      .select('_id cellCode label dimensions maxWeightKg operationalStatus usedWeightKg usedVolumeM3').lean().exec();
    return { item, reservation, cells, evidence };
  }

  static async createOrRefreshContract(reservationIdInput: unknown, actor: Actor) {
    const candidateId = id(reservationIdInput, 'reservationId');
    const candidate = await ReservationModel.findOne({ _id: candidateId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).select('_id bookingFlowVersion').lean().exec();
    if (candidate?.bookingFlowVersion === 3) return this.createV3Contract(candidateId, actor);
    fail(404, 'Only Managed Inventory V3 reservations can enter the current contract workflow');
  }

  private static async createV3Contract(reservationId: Types.ObjectId, actor: Actor) {
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Assigned Facility representative required');
    return tx(async session => {
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).session(session).exec();
      if (!reservation) fail(404, 'Managed V3 reservation not found');
      assertFacilityRepresentative(actor, reservation.facilityId);
      if (reservation.status === ReservationStatus.PAID && reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1') {
        const payment = reservation.fullPaymentId ? await ReservationPaymentModel.findOne({ _id: reservation.fullPaymentId,
          reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, purpose: PaymentPurpose.FULL_RENT,
          provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec() : null;
        if (!payment) fail(409, 'Managed V3 full-rent payment must be verified and applied before contract creation');
      } else if (reservation.status !== ReservationStatus.DEPOSIT_PAID) fail(409, 'Managed V3 contract requires verified payment');
      await lockFacility(reservation.facilityId, session);
      const facility = await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
        serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).lean().exec();
      if (!facility) fail(409, 'Active Managed Facility required for contract');
      const profile = await CustomerProfileModel.findOne({ userId: reservation.customerId }).session(session).exec();
      const customer = await UserModel.findById(reservation.customerId).session(session).exec();
      if (!profile || !customer) fail(409, 'Customer profile is unavailable for contract snapshot');
      const pricing = reservation.managedPricingSnapshot as any;
      if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' &&
          (!reservation.termsAcceptance || reservation.termsAcceptance.serviceType !== FacilityServiceType.MANAGED_INVENTORY ||
           !reservation.fullPaymentId || !reservation.allocatedCellIds?.length)) fail(409, 'Managed V3 terms, payment and Cell allocation snapshots are required');
      const fullPayment = reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && reservation.fullPaymentId
        ? await ReservationPaymentModel.findOne({ _id: reservation.fullPaymentId, reservationId: reservation._id,
          customerId: reservation.customerId, facilityId: reservation.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
          purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec()
        : null;
      if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && !fullPayment) fail(409, 'Managed V3 full-rent payment must be verified and applied before contract creation');
      const content = { schemaVersion: 3,
        reservation: { id: String(reservation._id), code: reservation.reservationCode, serviceType: reservation.serviceType,
          facilityId: String(reservation.facilityId), cellIds: (reservation.allocatedCellIds ?? []).map(String).sort(),
          allocatedCapacityM3: reservation.allocatedCapacity, startDate: reservation.startDate, endDate: reservation.endDate,
          term: pricing?.term ?? pricing?.pricingRule?.term, signingDeadline: reservation.signingDeadline },
        facility: { id: String(facility._id), name: facility.name, code: facility.code, address: facility.address },
        pricing: { snapshot: pricing, estimatedRent: reservation.estimatedRent, depositAmount: reservation.depositAmount,
          taxAmount: reservation.taxAmount, discountAmount: reservation.discountAmount,
          ...(fullPayment ? { totalPaid: fullPayment.amount, currency: fullPayment.currency, paymentId: String(fullPayment._id), paymentStatus: fullPayment.applicationStatus } : {}) },
        ...(reservation.termsAcceptance ? { termsAcceptance: { documentCode: reservation.termsAcceptance.documentCode,
          version: reservation.termsAcceptance.version, versionId: reservation.termsAcceptance.versionId,
          serviceType: reservation.termsAcceptance.serviceType, contentHash: reservation.termsAcceptance.contentHash,
          acceptedAt: reservation.termsAcceptance.acceptedAt } } : {}) };
      const contentHash = hashContent(content);
      let contract = await ContractModel.findOne({ reservationId }).session(session).exec();
      if (contract) {
        const current = contract.contentVersions?.find(version => version.version === contract!.currentContentVersion);
        if (!current || current.contentHash !== contentHash) fail(409, 'Managed V3 contract snapshot changed; a new signed contract version requires support review');
        return contract;
      }
      contract = new ContractModel({ contractCode: `CTR-${reservation.reservationCode}`, reservationId, customerId: reservation.customerId,
        status: ContractStatus.DRAFT, customerSnapshot: { fullName: customer.displayName, email: customer.email, phone: customer.phone, address: profile.address },
        pricingSnapshot: content.pricing, currentContentVersion: 1,
        contentVersions: [{ version: 1, contentHash, content, createdBy: actor._id, createdAt: new Date() }], signatures: [],
        termsVersion: reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' ? reservation.termsAcceptance!.version : 'MI-V3-1' });
      await contract.save({ session });
      await audit(reservation, actor, ManagedReservationAction.CONTRACT_VERSION_CREATED, { contractId: contract._id, version: 1, contentHash }, session);
      return contract;
    });
  }

  static async signV3Contract(contractIdInput: unknown, actor: Actor, signer: 'CUSTOMER' | 'FACILITY') {
    const contractId = id(contractIdInput, 'contractId');
    return tx(async session => {
      const contract = await ContractModel.findById(contractId).session(session).exec();
      if (!contract) fail(404, 'Managed contract not found');
      const reservation = await ReservationModel.findOne({ _id: contract.reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3,
        ...(signer === 'CUSTOMER' ? { customerId: actor._id } : {}) }).session(session).exec();
      if (!reservation) fail(404, 'Managed V3 reservation not found');
      if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1') fail(409, 'Full-rent Managed V3 contracts require verified signed-document evidence; digital signature confirmation is unavailable');
      if (signer === 'CUSTOMER') {
        if (actor.role !== UserRole.CUSTOMER) fail(403, 'Reservation owner must sign as Customer');
      } else {
        assertFacilityRepresentative(actor, reservation.facilityId);
        if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Assigned Facility representative required');
      }
      if (![ReservationStatus.DEPOSIT_PAID, ReservationStatus.PAID].includes(reservation.status)) fail(409, 'Managed V3 contract signing requires deposit settlement');
      await lockFacility(reservation.facilityId, session);
      const active = contract.contentVersions?.find(version => version.version === contract.currentContentVersion);
      if (!active || !/^[a-f\d]{64}$/i.test(active.contentHash) || hashContent(active.content) !== active.contentHash ||
          contract.termsVersion !== 'MI-V3-1' || !v3SnapshotMatchesReservation(active.content, reservation)) fail(409, 'Current Managed V3 contract snapshot no longer matches the reserved Cells, dates, capacity or pricing');
      const role = signer === 'CUSTOMER' ? UserRole.CUSTOMER : actor.role;
      if (signer === 'FACILITY' && !contract.signatures?.some(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole === UserRole.CUSTOMER)) fail(409, 'Customer must sign the current Managed V3 contract version first');
      const existing = contract.signatures?.find(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole === role);
      if (!existing) contract.signatures = [...(contract.signatures ?? []), { version: active.version, contentHash: active.contentHash, signerId: actor._id, signerRole: role, signedAt: new Date() }] as any;
      await updateSignedState(contract, active.version, active.contentHash);
      syncLegacySignatureFields(contract, active.version, active.contentHash);
      await contract.save({ session });
      await audit(reservation, actor, ManagedReservationAction.CONTRACT_SIGNED, { contractId, version: active.version, contentHash: active.contentHash, signerRole: role }, session);
      return contract;
    });
  }

  static async signContract(contractIdInput: unknown, actor: Actor) {
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Reservation owner must sign as Customer');
    const contractId = id(contractIdInput, 'contractId');
    return tx(async session => {
      const contract = await ContractModel.findOne({ _id: contractId, customerId: actor._id }).session(session).exec();
      if (!contract) fail(404, 'Managed contract not found');
      const reservation = await loadV2Reservation(contract.reservationId, session, actor._id);
      if (![ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY].includes(reservation.status)) fail(409, 'Contract signing requires a v2 reservation after deposit');
      await lockFacility(reservation.facilityId, session);
      if (!(await currentContent(reservation, session)).ready) fail(409, 'Resolve all receiving discrepancies or rejected inspections and inspect at least one requested item before signing');
      const active = await ensureVersion(contract, reservation, actor._id, session);
      if (contract.signatures?.some(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole === UserRole.CUSTOMER)) return contract;
      contract.signatures = [...(contract.signatures ?? []), { version: active.version, contentHash: active.contentHash, signerId: actor._id, signerRole: UserRole.CUSTOMER, signedAt: new Date() }] as any;
      await updateSignedState(contract, active.version, active.contentHash);
      syncLegacySignatureFields(contract, active.version, active.contentHash);
      await contract.save({ session });
      await audit(reservation, actor, ManagedReservationAction.CONTRACT_SIGNED, { contractId, version: active.version, contentHash: active.contentHash, signerRole: UserRole.CUSTOMER }, session);
      return contract;
    });
  }

  static async signFacilityContract(contractIdInput: unknown, actor: Actor) {
    const candidateId = id(contractIdInput, 'contractId');
    const candidateContract = await ContractModel.findById(candidateId).select('reservationId').lean().exec();
    if (candidateContract) {
      const candidateReservation = await ReservationModel.findOne({ _id: candidateContract.reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).select('_id bookingFlowVersion').lean().exec();
      if (candidateReservation?.bookingFlowVersion === 3) return this.signV3Contract(candidateId, actor, 'FACILITY');
    }
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Assigned Facility representative required');
    const contractId = candidateId;
    return tx(async session => {
      const contract = await ContractModel.findById(contractId).session(session).exec();
      if (!contract) fail(404, 'Managed contract not found');
      const reservation = await loadV2Reservation(contract.reservationId, session);
      assertFacilityRepresentative(actor, reservation.facilityId);
      if (![ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY].includes(reservation.status)) fail(409, 'Contract signing requires a v2 reservation after deposit');
      await lockFacility(reservation.facilityId, session);
      if (!(await currentContent(reservation, session)).ready) fail(409, 'Resolve all receiving discrepancies or rejected inspections and inspect at least one requested item before signing');
      const active = await ensureVersion(contract, reservation, actor._id, session);
      if (!contract.signatures?.some(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole === UserRole.CUSTOMER)) fail(409, 'Customer must sign the current contract version first');
      if (contract.signatures?.some(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole !== UserRole.CUSTOMER)) return contract;
      contract.signatures = [...(contract.signatures ?? []), { version: active.version, contentHash: active.contentHash, signerId: actor._id, signerRole: actor.role, signedAt: new Date() }] as any;
      await updateSignedState(contract, active.version, active.contentHash);
      syncLegacySignatureFields(contract, active.version, active.contentHash);
      await contract.save({ session });
      await audit(reservation, actor, ManagedReservationAction.CONTRACT_SIGNED, { contractId, version: active.version, contentHash: active.contentHash, signerRole: actor.role }, session);
      return contract;
    });
  }

  static async initiateBalance(reservationIdInput: unknown, body: unknown, actor: Actor) {
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const reservationId = id(reservationIdInput, 'reservationId');
    const input = record(body, ['idempotencyKey'], 'balance request');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.trim().length > 160) fail(400, 'Valid idempotencyKey required');
    return tx(async session => {
      const reservation = await loadV2Reservation(reservationId, session, actor._id);
      await lockFacility(reservation.facilityId, session);
      if (![ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY].includes(reservation.status)) fail(409, 'Balance payment requires a deposit-paid v2 reservation');
      const contract = await ContractModel.findOne({ reservationId }).session(session).exec();
      if (!contract || contract.status !== ContractStatus.SIGNED || !signedByBothCurrentVersion(contract)) fail(409, 'Both parties must sign the current contract version before balance payment');
      const breakdown = await balance(reservation, session);
      if (breakdown.balanceDue === 0) {
        if (reservation.status === ReservationStatus.CHECKIN_READY && reservation.balanceSettledAt) return { reservation, payment: null, amount: 0, currency: 'VND', zeroBalance: true, idempotent: true };
        if (reservation.status !== ReservationStatus.DEPOSIT_PAID) fail(409, 'Zero balance is already settled');
        reservation.status = ReservationStatus.CHECKIN_READY; reservation.balanceSettledAt = new Date(); reservation.balanceSettledBy = actor._id;
        reservation.statusHistory.push({ status: ReservationStatus.CHECKIN_READY, actorId: actor._id, reason: 'Contract signed; zero balance settled', createdAt: new Date() } as any);
        await reservation.save({ session });
        await audit(reservation, actor, ManagedReservationAction.BALANCE_SETTLED, { amount: 0, currency: 'VND', zeroBalance: true }, session);
        return { reservation, payment: null, amount: 0, currency: 'VND', zeroBalance: true };
      }
      const identity = { reservationId: String(reservation._id), purpose: PaymentPurpose.BALANCE, amount: breakdown.balanceDue, currency: 'VND', idempotencyKey: input.idempotencyKey.trim() };
      const existing = await ReservationPaymentModel.findOne({ idempotencyKey: identity.idempotencyKey }).session(session).exec();
      if (existing) {
        try { assertIdempotentPaymentMatch({ reservationId: String(existing.reservationId), purpose: existing.purpose, amount: existing.amount, currency: existing.currency, idempotencyKey: existing.idempotencyKey }, identity); } catch (error) { if (error instanceof PaymentAccountingError) fail(error.status, error.message); throw error; }
        if (!existing.customerId.equals(actor._id) || existing.provider !== PaymentProvider.MOCK || existing.serviceType !== FacilityServiceType.MANAGED_INVENTORY) fail(409, 'Idempotency key belongs to a different payment');
        return { payment: existing, reservation, amount: identity.amount, currency: identity.currency, idempotent: true };
      }
      if (reservation.status === ReservationStatus.CHECKIN_READY) {
        const settled = await ReservationPaymentModel.findOne({ reservationId, purpose: PaymentPurpose.BALANCE, status: PaymentStatus.SUCCEEDED }).session(session).exec();
        if (settled) fail(409, 'Managed balance is already settled with a different idempotency key');
        fail(409, 'Managed reservation is already check-in ready');
      }
      const payment = new ReservationPaymentModel({ ...identity, customerId: actor._id, facilityId: reservation.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        provider: PaymentProvider.MOCK, providerReference: `MOCK-BALANCE-${new Types.ObjectId()}`, status: PaymentStatus.PENDING });
      await payment.save({ session });
      await audit(reservation, actor, ManagedReservationAction.BALANCE_INITIATED, { paymentId: payment._id, amount: payment.amount, purpose: PaymentPurpose.BALANCE }, session);
      return { payment, reservation, amount: payment.amount, currency: payment.currency, idempotent: false };
    });
  }

  static async confirmMockBalance(reservationIdInput: unknown, body: unknown, actor: Actor) {
    if (!enabled()) fail(404, 'Managed check-in flow is disabled');
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const reservationId = id(reservationIdInput, 'reservationId');
    const input = record(body, ['idempotencyKey'], 'balance confirmation');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) fail(400, 'Valid idempotencyKey required');
    return tx(async session => {
      const reservation = await loadV2Reservation(reservationId, session, actor._id);
      await lockFacility(reservation.facilityId, session);
      const payment = await ReservationPaymentModel.findOne({ idempotencyKey: input.idempotencyKey.trim(), reservationId, customerId: actor._id }).session(session).exec();
      if (!payment || payment.purpose !== PaymentPurpose.BALANCE || payment.provider !== PaymentProvider.MOCK || payment.serviceType !== FacilityServiceType.MANAGED_INVENTORY) fail(404, 'Managed balance payment not found');
      if (payment.status === PaymentStatus.SUCCEEDED && reservation.status === ReservationStatus.CHECKIN_READY) return { reservation, payment, idempotent: true };
      if (payment.status !== PaymentStatus.PENDING || reservation.status !== ReservationStatus.DEPOSIT_PAID) fail(409, 'Balance payment is not pending for this reservation');
      const contract = await ContractModel.findOne({ reservationId }).session(session).exec();
      if (!contract || contract.status !== ContractStatus.SIGNED || !signedByBothCurrentVersion(contract)) fail(409, 'Both parties must sign the current contract version before balance settlement');
      const breakdown = await balance(reservation, session);
      if (payment.amount !== breakdown.balanceDue || payment.currency !== 'VND' || payment.amount <= 0) fail(409, 'Balance payment amount or currency does not match reservation');
      payment.status = transitionPaymentStatus(payment.status, PaymentStatus.SUCCEEDED).status; payment.succeededAt = new Date(); await payment.save({ session });
      reservation.status = ReservationStatus.CHECKIN_READY; reservation.balanceSettledAt = payment.succeededAt; reservation.balanceSettledBy = actor._id;
      reservation.statusHistory.push({ status: ReservationStatus.CHECKIN_READY, actorId: actor._id, reason: 'Contract signatures and Managed advance-rent balance settled; physical inbound remains pending', createdAt: payment.succeededAt } as any);
      await reservation.save({ session });
      await audit(reservation, actor, ManagedReservationAction.BALANCE_SETTLED, { paymentId: payment._id, amount: payment.amount, currency: payment.currency }, session);
      return { reservation, payment, idempotent: false };
    });
  }
}

async function balance(reservation: any, session: ClientSession) {
  const deposit = await ReservationPaymentModel.findOne({ reservationId: reservation._id, purpose: PaymentPurpose.DEPOSIT, status: PaymentStatus.SUCCEEDED }).session(session).exec();
  if (!deposit) fail(409, 'Successful deposit is required');
  if (deposit.serviceType !== FacilityServiceType.MANAGED_INVENTORY || !deposit.customerId.equals(reservation.customerId) || deposit.currency !== 'VND' || deposit.amount !== reservation.depositAmount) fail(409, 'Successful deposit does not match this Managed reservation');
  return calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent, depositAmount: deposit.amount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
}
function round(value: number, decimals: number) { const factor = 10 ** decimals; return Math.round((value + Number.EPSILON) * factor) / factor; }
function signedByBothCurrentVersion(contract: IContract) {
  const version = contract.currentContentVersion;
  const active = contract.contentVersions?.find(entry => entry.version === version);
  if (!version || !active) return false;
  const current = contract.signatures?.filter(signature => signature.version === version && signature.contentHash === active.contentHash) ?? [];
  return current.some(signature => signature.signerRole === UserRole.CUSTOMER) && current.some(signature => signature.signerRole !== UserRole.CUSTOMER);
}
async function updateSignedState(contract: IContract, version: number, contentHash: string) {
  const current = contract.signatures?.filter(signature => signature.version === version && signature.contentHash === contentHash) ?? [];
  const customer = current.find(signature => signature.signerRole === UserRole.CUSTOMER);
  const facility = current.find(signature => signature.signerRole !== UserRole.CUSTOMER);
  contract.status = customer && facility ? ContractStatus.SIGNED : ContractStatus.DRAFT;
}
function syncLegacySignatureFields(contract: IContract, version: number, contentHash: string) {
  const current = contract.signatures?.filter(signature => signature.version === version && signature.contentHash === contentHash) ?? [];
  const customer = current.find(signature => signature.signerRole === UserRole.CUSTOMER);
  const facility = current.find(signature => signature.signerRole !== UserRole.CUSTOMER);
  contract.set('signedByCustomerAt', customer?.signedAt);
  contract.set('signedByFMAt', facility?.signedAt);
  contract.set('fmId', facility?.signerId);
}
