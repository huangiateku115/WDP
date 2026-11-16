import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import InventoryItemModelRaw from '../../models/inventory-items/inventory-item.model';
import ItemMovementModelRaw from '../../models/inventory-items/item-movement.model';
import CellModelRaw from '../../models/warehouse-map/warehouse-cell.model';
import RackModelRaw from '../../models/warehouse-map/warehouse-rack.model';
import ManagedAccessSessionModelRaw from '../../models/access/managed-access-session.model';
import ManagedAccessVisitModelRaw from '../../models/access/managed-access-visit.model';
import ItemSpecificationModelRaw from '../../models/inventory-items/item-specification.model';
import ManagedCellStockModelRaw from '../../models/inventory-items/managed-cell-stock.model';
import ManagedItemInstanceModelRaw from '../../models/inventory-items/managed-item-instance.model';
import ContractModelRaw from '../../models/contracts/contract.model';
import { assertManagedAccessSessionScope, ManagedAccessError } from '../access/managed-access.service';
import { readManagedFacilityStockState } from './managed-unified-inbound.service';
import { FacilityServiceType } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ItemMovementType } from '../../types/item-movement.type';
import { UserRole } from '../../types/user.type';
import { ManagedAccessPurpose, ManagedAccessSessionStatus } from '../../types/managed-access.type';
import { ItemSpecificationStatus } from '../../types/item-specification.type';

const Item: any = InventoryItemModelRaw, Movement: any = ItemMovementModelRaw;
const Cell: any = CellModelRaw, Rack: any = RackModelRaw, AccessSession: any = ManagedAccessSessionModelRaw;
const Visit: any = ManagedAccessVisitModelRaw;
const ItemSpec: any = ItemSpecificationModelRaw, CellStock: any = ManagedCellStockModelRaw, ItemInstance: any = ManagedItemInstanceModelRaw, Contract: any = ContractModelRaw;
type Actor = { _id: Types.ObjectId; role: UserRole; assignedFacilityId?: Types.ObjectId | null };
export type Plain = Record<string, any>;
export class ManagedV3OutboundError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
function fail(status: number, code: string, message: string): never { throw new ManagedV3OutboundError(status, code, message); }
const same = (a: any, b: any) => String(a?._id ?? a) === String(b?._id ?? b);
const id = (value: any) => String(value?._id ?? value);
const stockLotKey = (line: any) => `${id(line.itemSpecId)}:${line.receiptId}:${id(line.cellId)}`;
function physicalTotals(unitWeightKg: number, unitVolumeM3: number, quantity: number) {
  const totalWeightKg = money(unitWeightKg * quantity, 3), totalVolumeM3 = money(unitVolumeM3 * quantity, 6);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || ![unitWeightKg, unitVolumeM3, totalWeightKg, totalVolumeM3].every(Number.isFinite)) fail(409, 'PHYSICAL_SNAPSHOT_INVALID', 'Số đo receipt không thể tính an toàn.');
  return { totalWeightKg, totalVolumeM3 };
}
const live = { deletedAt: { $exists: false } };
const oid = (value: unknown, name: string) => { if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'INVALID_INPUT', `${name} không hợp lệ.`); return new Types.ObjectId(value as string); };
const key = (value: unknown) => { if (typeof value !== 'string' || !/^[\w.:/-]{8,128}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ.'); return value; };
const version = (value: unknown) => { const match = typeof value === 'string' ? value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/) : null; const n = match ? Number(match[1]) : NaN; if (!Number.isSafeInteger(n)) fail(typeof value === 'undefined' ? 428 : 400, 'IF_MATCH_REQUIRED', 'Cần If-Match là revision hiện tại.'); return n; };
const canonical = (value: any): any => value?.toHexString ? value.toHexString() : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(k => !['_id', '__v', 'createdAt', 'updatedAt'].includes(k) && value[k] !== undefined).sort().map(k => [k, canonical(value[k])])) : value;
const stable = (value: any) => JSON.stringify(canonical(value));
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const errorLabel = (error: any, label: string) => !!error?.hasErrorLabel?.(label) || error?.errorLabels?.includes?.(label);
const money = (v: number, places: 3 | 6) => Math.round((v + Number.EPSILON) * 10 ** places) / 10 ** places;
const round = money;

export type DirectOutboundLine = { lineId: string; itemSpecId: string; itemSpecRevision: number; quantity: number;
  cellAllocations?: Array<{ cellId: string; quantity: number; receiptId?: string }>; itemInstanceIds?: string[] };
export type DirectOutboundCandidate = { accessSessionId: string; sessionRevision: number; skuRevision: number; lines: DirectOutboundLine[]; reason?: string; referenceCode?: string; notes?: string; physicalRemovalConfirmed?: boolean; customerAttestation?: string };

export function normalizeDirectOutbound(input: unknown): DirectOutboundCandidate {
  const shape = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Plain : null;
  if (!shape || Object.keys(shape).some(key => !['accessSessionId','sessionRevision','skuRevision','lines','reason','referenceCode','notes','physicalRemovalConfirmed','customerAttestation'].includes(key)) ||
      typeof shape.accessSessionId !== 'string' || !/^[a-f\d]{24}$/i.test(shape.accessSessionId) ||
      !Number.isSafeInteger(shape.sessionRevision) || shape.sessionRevision < 0 || !Number.isSafeInteger(shape.skuRevision) || shape.skuRevision < 0 ||
      !Array.isArray(shape.lines) || shape.lines.length < 1 || shape.lines.length > 50) fail(422, 'INVALID_OUTBOUND_INPUT', 'Thông tin xuất kho không đúng định dạng.');
  const lines: DirectOutboundLine[] = shape.lines.map((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['lineId','itemSpecId','itemSpecRevision','quantity','cellAllocations','itemInstanceIds'].includes(key)) ||
        typeof raw.lineId !== 'string' || !/^[\w.-]{1,80}$/.test(raw.lineId) || typeof raw.itemSpecId !== 'string' || !/^[a-f\d]{24}$/i.test(raw.itemSpecId) ||
        !Number.isSafeInteger(raw.itemSpecRevision) || raw.itemSpecRevision < 0 || !Number.isSafeInteger(raw.quantity) || raw.quantity < 1) fail(422, 'INVALID_OUTBOUND_LINE', `Dòng ${index + 1} chưa hợp lệ.`);
    const instances = raw.itemInstanceIds;
    if (instances !== undefined && (!Array.isArray(instances) || instances.length < 1 || instances.length !== raw.quantity || instances.some((value: any) => typeof value !== 'string' || !value.trim() || value.length > 160) || new Set(instances).size !== instances.length || raw.cellAllocations !== undefined)) fail(422, 'INVALID_ITEM_INSTANCE_SELECTION', `Dòng ${index + 1}: hãy chọn đủ từng món nguyên vẹn hoặc dùng số lượng theo ô kệ.`);
    const cellAllocations = raw.cellAllocations;
    if (instances === undefined && cellAllocations !== undefined && (!Array.isArray(cellAllocations) || cellAllocations.length < 1 || cellAllocations.length > 100 ||
        cellAllocations.some((row: any) => !row || typeof row.cellId !== 'string' || !/^[a-f\d]{24}$/i.test(row.cellId) || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.receiptId !== undefined && (typeof row.receiptId !== 'string' || !row.receiptId.trim() || row.receiptId.length > 160)) ||
        new Set(cellAllocations.map((row: any) => row.cellId)).size !== cellAllocations.length || cellAllocations.reduce((sum: number, row: any) => sum + row.quantity, 0) !== raw.quantity)) fail(422, 'INVALID_CELL_ALLOCATION', `Dòng ${index + 1}: tổng số lượng theo ô kệ phải bằng số lượng xuất.`);
    return { lineId: raw.lineId, itemSpecId: raw.itemSpecId, itemSpecRevision: raw.itemSpecRevision, quantity: raw.quantity,
      ...(cellAllocations ? { cellAllocations } : {}), ...(instances ? { itemInstanceIds: instances } : {}) };
  });
  if (new Set(lines.map(line => line.itemSpecId)).size !== lines.length || new Set(lines.map(line => line.lineId)).size !== lines.length) fail(422, 'DUPLICATE_OUTBOUND_LINE', 'Mỗi loại hàng chỉ được xuất trên một dòng phiếu.');
  for (const field of ['reason','referenceCode','notes','customerAttestation'] as const) if (shape[field] !== undefined && (typeof shape[field] !== 'string' || shape[field].length > (field === 'notes' || field === 'customerAttestation' ? 1000 : 240))) fail(422, 'INVALID_OUTBOUND_INPUT', `${field} không hợp lệ.`);
  if (shape.physicalRemovalConfirmed !== undefined && typeof shape.physicalRemovalConfirmed !== 'boolean') fail(422, 'INVALID_OUTBOUND_INPUT', 'physicalRemovalConfirmed phải là boolean.');
  return { accessSessionId: shape.accessSessionId, sessionRevision: shape.sessionRevision, skuRevision: shape.skuRevision, lines,
    ...(shape.reason ? { reason: shape.reason.trim() } : {}), ...(shape.referenceCode ? { referenceCode: shape.referenceCode.trim() } : {}), ...(shape.notes ? { notes: shape.notes.trim() } : {}),
    ...(shape.physicalRemovalConfirmed !== undefined ? { physicalRemovalConfirmed: shape.physicalRemovalConfirmed } : {}),
    ...(shape.customerAttestation ? { customerAttestation: shape.customerAttestation.trim() } : {}) };
}

function assertCurrentSignedContract(contract: any) {
  const active = contract?.contentVersions?.find((version: any) => version.version === contract.currentContentVersion);
  const signatures = (contract?.signatures ?? []).filter((signature: any) => signature.version === contract.currentContentVersion && signature.contentHash === active?.contentHash);
  return contract?.status === 'SIGNED' && !!active && signatures.some((signature: any) => signature.signerRole === UserRole.CUSTOMER) &&
    signatures.some((signature: any) => [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(signature.signerRole));
}

function directScope(sku: any, reservation: any, actor: Actor) {
  const now = new Date();
  if (actor.role !== UserRole.CUSTOMER || !same(sku.customerId, actor._id)) fail(404, 'SKU_NOT_FOUND', 'Không tìm thấy mặt hàng.');
  if (sku.inventorySchemaVersion !== 3 || sku.skuStatus !== 'ACTIVE' || !same(sku.facilityId, reservation.facilityId) ||
      !same(sku.reservationId ?? sku.managedReservationId, reservation._id)) fail(409, 'OUTBOUND_SCOPE_INVALID', 'SKU không thuộc Reservation đang chọn.');
  if (reservation.serviceType !== FacilityServiceType.MANAGED_INVENTORY || reservation.bookingFlowVersion !== 3 || reservation.status !== ReservationStatus.ACTIVE ||
      reservation.customerId.toString() !== actor._id.toString() || reservation.startDate > now || reservation.endDate <= now || !reservation.handoverAt || !reservation.handoverByStaffId ||
      reservation.activeClosureRequestId) fail(409, 'RENTAL_NOT_ACTIVE', 'Reservation phải đang hoạt động, trong hạn và đã hoàn tất bàn giao.');
}

export function buildDirectOutboundPlan(input: { sku: Plain; reservation: Plain; candidate: DirectOutboundCandidate; state: Plain; specifications: Plain[]; now?: Date }) {
  const { sku, reservation, candidate, state, specifications } = input, now = input.now ?? new Date();
  if (Number(sku.managedV3Revision ?? 0) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'SKU đã thay đổi; hãy tải lại trước khi xem trước.');
  const specMap = new Map(specifications.map(spec => [String(spec._id), spec]));
  const lots = (state.replay.lots as Plain[]).filter(row => same(row.skuId, sku._id) && same(row.reservationId, reservation._id));
  const instances = (state.replay.instances as Plain[]).filter(row => same(row.skuId, sku._id) && same(row.reservationId, reservation._id) && row.status === 'PLACED');
  const movements = (state.movements as Plain[]).filter(row => same(row.itemId, sku._id)).sort((a,b) => new Date(a.performedAt).getTime()-new Date(b.performedAt).getTime() || id(a._id).localeCompare(id(b._id)));
  const receiptOrder = new Map<string, { at: number; movementId: string }>();
  for (const movement of movements) if (movement.stockEffect?.action === 'ADD') for (const line of movement.stockEffect.destination ?? []) {
    if (!receiptOrder.has(line.receiptId)) receiptOrder.set(line.receiptId, { at: new Date(movement.performedAt).getTime(), movementId: id(movement._id) });
  }
  const allocatedCellIds = new Set((reservation.allocatedCellIds ?? []).map(id));
  const effectLines: Plain[] = [], cellRelease = new Map<string, { weightKg: number; volumeM3: number }>(), specTotals: Plain[] = [];
  const addCell = (cellId: string, weightKg: number, volumeM3: number) => { const current=cellRelease.get(cellId)??{weightKg:0,volumeM3:0}; current.weightKg=money(current.weightKg+weightKg,3); current.volumeM3=money(current.volumeM3+volumeM3,6); cellRelease.set(cellId,current); };
  let quantity = 0, totalWeightKg = 0, totalVolumeM3 = 0;
  for (const line of candidate.lines) {
    const spec = specMap.get(line.itemSpecId);
    if (!spec || !same(spec.skuId,sku._id) || !same(spec.customerId,sku.customerId) || !same(spec.reservationId,reservation._id) || spec.status !== ItemSpecificationStatus.ACTIVE || spec.revision !== line.itemSpecRevision) fail(409, 'ITEM_SPECIFICATION_STALE', `Loại hàng tại dòng ${line.lineId} không còn hợp lệ; hãy tải lại.`);
    const specLots = lots.filter(row=>same(row.itemSpecId,spec._id));
    const specInstances = instances.filter(row=>same(row.itemSpecId,spec._id));
    if (specLots.length && specInstances.length) fail(409, 'MIXED_STOCK_KIND_UNSUPPORTED', `Hàng ${spec.name} đang có dạng lô và món nguyên khối cùng lúc; cần đối soát trước khi xuất.`);
    const beforeQuantity = specLots.reduce((sum,row)=>sum+row.quantityOnHand,0)+specInstances.length;
    const availableQuantity = specLots.reduce((sum,row)=>sum+row.quantityAvailable,0)+specInstances.length;
    let lineQuantity = 0, lineWeightKg = 0, lineVolumeM3 = 0;
    if (line.itemInstanceIds) {
      for (const instanceId of line.itemInstanceIds) {
        const instance = instances.find(row=>row.itemInstanceId===instanceId && same(row.itemSpecId,spec._id));
        if (!instance || instance.status !== 'PLACED' || instance.quantity !== 1 || !Array.isArray(instance.allocations) || !instance.allocations.length) fail(409, 'ITEM_INSTANCE_NOT_AVAILABLE', 'Một món nguyên vẹn không còn trong kho hoặc đã được xuất.');
        for (const allocation of [...instance.allocations].sort((a,b)=>id(a.cellId).localeCompare(id(b.cellId)))) {
          const cellId=id(allocation.cellId); if (!allocatedCellIds.has(cellId)) fail(409,'CELL_NOT_ALLOCATED','Món hàng nằm ngoài ô kệ được cấp cho Reservation.');
          const effect = { lineId: line.lineId, itemSpecId: spec._id, receiptId: instance.sourceReceiptId, itemInstanceId: instance.itemInstanceId, cellId: allocation.cellId,
            quantity: 1, quantityUnitSnapshot: spec.quantityUnitName ?? spec.quantityUnitId?.name ?? 'đơn vị', unitWeightKgSnapshot: instance.unitWeightKgSnapshot,
            unitVolumeM3Snapshot: instance.unitVolumeM3Snapshot, unitDimensionsSnapshot: instance.unitDimensionsSnapshot, allocatedWeightKg: allocation.weightKg,
            allocatedVolumeM3: allocation.volumeM3, quantityBefore: 1, quantityAfter: 0 };
          effectLines.push(effect); addCell(cellId,allocation.weightKg,allocation.volumeM3); lineWeightKg=money(lineWeightKg+allocation.weightKg,3); lineVolumeM3=money(lineVolumeM3+allocation.volumeM3,6);
        }
      }
      lineQuantity = line.itemInstanceIds.length;
    } else {
      if (availableQuantity < line.quantity) fail(409, 'OUTBOUND_QUANTITY_UNAVAILABLE', `Không đủ số lượng khả dụng cho ${spec.name}.`);
      const allocations = line.cellAllocations ?? [{ cellId: '', quantity: line.quantity }];
      let needed = line.quantity;
      const remainingByLot = new Map(specLots.map(lot => [stockLotKey(lot), lot.quantityAvailable]));
      const fifo = [...specLots].sort((a,b)=>{
        const ao=receiptOrder.get(a.receiptId)??{at:Number.MAX_SAFE_INTEGER,movementId:''},bo=receiptOrder.get(b.receiptId)??{at:Number.MAX_SAFE_INTEGER,movementId:''};
        return ao.at-bo.at||ao.movementId.localeCompare(bo.movementId)||a.receiptId.localeCompare(b.receiptId)||id(a.cellId).localeCompare(id(b.cellId));
      });
      for (const allocation of allocations) {
        if (allocation.cellId && !allocatedCellIds.has(allocation.cellId)) fail(409,'CELL_NOT_ALLOCATED','Có ô kệ nguồn nằm ngoài Reservation.');
        let cellNeeded=allocation.quantity;
        const candidates=fifo.filter(row=>(!allocation.cellId||id(row.cellId)===allocation.cellId)&&(!allocation.receiptId||row.receiptId===allocation.receiptId));
        for (const lot of candidates) {
          if (!cellNeeded) break;
          const lotKey=stockLotKey(lot), remaining=remainingByLot.get(lotKey)??0;
          const take=Math.min(cellNeeded,remaining); if (take<1) continue;
          const amounts=physicalTotals(lot.unitWeightKgSnapshot,lot.unitVolumeM3Snapshot,take), cellId=id(lot.cellId);
          effectLines.push({ lineId:line.lineId,itemSpecId:spec._id,receiptId:lot.receiptId,cellId:lot.cellId,quantity:take,quantityUnitSnapshot:lot.quantityUnitSnapshot??'đơn vị',
            unitWeightKgSnapshot:lot.unitWeightKgSnapshot,unitVolumeM3Snapshot:lot.unitVolumeM3Snapshot,unitDimensionsSnapshot:lot.unitDimensionsSnapshot,
            allocatedWeightKg:amounts.totalWeightKg,allocatedVolumeM3:amounts.totalVolumeM3,quantityBefore:lot.quantityOnHand,quantityAfter:lot.quantityOnHand-take });
          addCell(cellId,amounts.totalWeightKg,amounts.totalVolumeM3); lineWeightKg=money(lineWeightKg+amounts.totalWeightKg,3); lineVolumeM3=money(lineVolumeM3+amounts.totalVolumeM3,6);
          cellNeeded-=take; needed-=take; remainingByLot.set(lotKey, remaining-take);
        }
        if (cellNeeded) fail(409,'OUTBOUND_QUANTITY_UNAVAILABLE',`Không đủ số lượng khả dụng tại ô kệ đã chọn cho ${spec.name}.`);
      }
      if (needed) fail(409,'OUTBOUND_QUANTITY_UNAVAILABLE',`Không đủ số lượng khả dụng cho ${spec.name}.`);
      lineQuantity=line.quantity;
    }
    specTotals.push({ itemSpecId: spec._id, code: spec.code, name: spec.name, quantityBefore: beforeQuantity, availableBefore: availableQuantity,
      quantityOut: lineQuantity, quantityAfter: beforeQuantity-lineQuantity, weightRemovedKg: lineWeightKg, volumeRemovedM3: lineVolumeM3 });
    quantity+=lineQuantity; totalWeightKg=money(totalWeightKg+lineWeightKg,3); totalVolumeM3=money(totalVolumeM3+lineVolumeM3,6);
  }
  if (!quantity || !Number.isSafeInteger(quantity) || !Number.isFinite(totalWeightKg) || !Number.isFinite(totalVolumeM3)) fail(422,'INVALID_OUTBOUND_TOTALS','Không thể tính an toàn tổng phiếu xuất.');
  const cells = new Map((state.cells as Plain[]).map(cell=>[id(cell._id),cell]));
  const capacity = [...cellRelease.entries()].map(([cellId,release])=>{
    const cell:any=cells.get(cellId); if(!cell)fail(503,'CELL_CAPACITY_UNKNOWN','Không xác minh được ô kệ nguồn.');
    const afterWeight=money(Number(cell.usedWeightKg)-release.weightKg,3),afterVolume=money(Number(cell.usedVolumeM3)-release.volumeM3,6);
    if(!Number.isFinite(afterWeight)||!Number.isFinite(afterVolume)||afterWeight < -0.001||afterVolume < -0.000001)fail(503,'CELL_COUNTER_RECONCILIATION_UNKNOWN',`Counter của ô ${cell.code} không thể giảm an toàn.`);
    return {cellId,cellCode:cell.code,usedWeightBeforeKg:cell.usedWeightKg,usedWeightAfterKg:Math.max(0,afterWeight),usedVolumeBeforeM3:cell.usedVolumeM3,usedVolumeAfterM3:Math.max(0,afterVolume)};
  });
  return { effectLines, quantity, totalWeightKg, totalVolumeM3, cellRelease, capacity, specTotals, sourceCellIds:[...cellRelease.keys()].sort() };
}

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000 });
    return result;
  } finally { await session.endSession(); }
}

async function directOwnedSku(input: unknown, actor: Actor, session?: ClientSession) {
  if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được xác nhận xuất kho.');
  const filter = { _id: oid(input, 'skuId'), customerId: actor._id, inventorySchemaVersion: 3, skuStatus: 'ACTIVE', deletedAt: { $exists: false } };
  let query = Item.findOne(filter); if (session) query = query.session(session);
  const sku: any = await query.lean().exec();
  if (!sku) fail(404, 'SKU_NOT_FOUND', 'Không tìm thấy mặt hàng.');
  return sku;
}

async function directReservation(sku: Plain, actor: Actor, session?: ClientSession) {
  const reservationId = sku.reservationId ?? sku.managedReservationId;
  let query = ReservationModel.findOne({ _id: reservationId, customerId: actor._id, facilityId: sku.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
    startDate: { $lte: new Date() }, endDate: { $gt: new Date() }, handoverAt: { $exists: true, $ne: null },
    handoverByStaffId: { $exists: true, $ne: null }, $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] });
  if (session) query = query.session(session);
  const reservation: any = await query.lean().exec();
  if (!reservation) fail(409, 'RENTAL_NOT_ACTIVE', 'Đơn thuê phải đang hoạt động, đã bàn giao và còn trong kỳ thuê.');
  const contractQuery = Contract.findOne({ reservationId: reservation._id, customerId: actor._id, status: 'SIGNED' });
  if (session) contractQuery.session(session);
  const contract: any = await contractQuery.lean().exec();
  if (!assertCurrentSignedContract(contract)) fail(409, 'CONTRACT_NOT_SIGNED', 'Hợp đồng hiện hành chưa được Customer và đại diện cơ sở ký đầy đủ.');
  return reservation;
}

async function directFacilityState(sku: Plain, reservation: Plain, session?: ClientSession) {
  const cellIds = (reservation.allocatedCellIds ?? []).map((value: any) => new Types.ObjectId(id(value)));
  try { return await readManagedFacilityStockState(sku.facilityId, session, { reservationId: reservation._id, cellIds, skuId: sku._id }); }
  catch (error: any) {
    const code = error?.code || 'STOCK_RECONCILIATION_UNKNOWN';
    fail(error?.status || 503, code, error?.message || 'Tồn kho chưa thể đối soát an toàn.');
  }
}

/**
 * A historical V3 request could hold stock outside the canonical Cell Stock projection.
 * The request writer/model is retired; retain only this read-only fail-closed check until
 * legacy development requests have been reconciled. No request or hold is created here.
 */
async function rejectUnresolvedLegacyV3Request(skuId: Types.ObjectId, session?: ClientSession) {
  const db = mongoose.connection.db;
  if (!db) fail(503, 'DATABASE_UNAVAILABLE', 'Không thể đối soát các yêu cầu xuất kho lịch sử.');
  const pending = await db.collection('managedv3outboundrequests').findOne({ skuId, state: 'PENDING' }, session ? { session } : {});
  if (pending) fail(409, 'LEGACY_OUTBOUND_REQUEST_PENDING', 'SKU còn yêu cầu xuất theo quy trình cũ cần được đối soát trước khi tiếp tục.');
}

async function loadDirectCandidateState(skuId: unknown, body: unknown, actor: Actor, session?: ClientSession) {
  const candidate = normalizeDirectOutbound(body);
  const sku = await directOwnedSku(skuId, actor, session);
  const reservation = await directReservation(sku, actor, session);
  if (Number(sku.managedV3Revision ?? 0) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'SKU đã thay đổi; hãy tải lại tồn kho.');
  await rejectUnresolvedLegacyV3Request(sku._id, session);
  const state = await directFacilityState(sku, reservation, session);
  const specIds = candidate.lines.map(line => new Types.ObjectId(line.itemSpecId));
  let specQuery = ItemSpec.find({ _id: { $in: specIds }, skuId: sku._id, customerId: actor._id, reservationId: reservation._id, facilityId: sku.facilityId,
    status: 'ACTIVE', deletedAt: { $exists: false } }).populate('quantityUnitId', 'name code');
  if (session) specQuery = specQuery.session(session);
  const specifications: Plain[] = await specQuery.lean().exec();
  if (specifications.length !== specIds.length) fail(404, 'ITEM_SPECIFICATION_NOT_FOUND', 'Một hoặc nhiều loại hàng không thuộc SKU hoặc Reservation này.');
  const plan = buildDirectOutboundPlan({ sku, reservation, candidate, state, specifications });
  return { candidate, sku, reservation, state, specifications, plan };
}

async function readOnlySessionScope(candidate: DirectOutboundCandidate, reservation: Plain, actor: Actor, cellIds: string[]) {
  const currentSession: any = await AccessSession.findOne({ _id: candidate.accessSessionId, customerId: actor._id, reservationId: reservation._id,
    facilityId: reservation.facilityId, status: ManagedAccessSessionStatus.ACTIVE, allowedPurposes: ManagedAccessPurpose.OUTBOUND,
    revision: candidate.sessionRevision, startedAt: { $lte: new Date() }, expiresAt: { $gt: new Date() } }).lean().exec();
  if (!currentSession) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Cần Access Session OUTBOUND đang hoạt động và còn hạn.');
  const allowed = new Set((currentSession.allowedCellIds ?? []).map(id));
  if (!cellIds.length || cellIds.some(cellId => !allowed.has(cellId))) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Session không bao phủ toàn bộ Cell nguồn.');
  const visit: any = await Visit.findOne({ _id: currentSession.visitId, reservationId: reservation._id, customerId: actor._id, facilityId: reservation.facilityId,
    purpose: ManagedAccessPurpose.OUTBOUND, status: 'CHECKED_IN' }).select('_id status purpose').lean().exec();
  if (!visit) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Customer cần có Visit OUTBOUND đã CHECK_IN.');
  return currentSession;
}

function directStockResponse(sku: Plain, reservation: Plain, state: Plain, specifications: Plain[]) {
  const cells = new Map((state.cells as Plain[]).map(cell => [id(cell._id), cell]));
  const lots = (state.replay.lots as Plain[]).filter(row => same(row.skuId, sku._id) && same(row.reservationId, reservation._id));
  const instances = (state.replay.instances as Plain[]).filter(row => same(row.skuId, sku._id) && same(row.reservationId, reservation._id) && row.status === 'PLACED');
  const itemSpecifications = specifications.map(spec => {
    const specLots = lots.filter(row => same(row.itemSpecId, spec._id));
    const specInstances = instances.filter(row => same(row.itemSpecId, spec._id));
    const onHand = specLots.reduce((sum, row) => sum + row.quantityOnHand, 0) + specInstances.length;
    const held = specLots.reduce((sum, row) => sum + row.quantityHeld, 0);
    return { itemSpecId: spec._id, code: spec.code, name: spec.name, revision: spec.revision, quantityUnit: spec.quantityUnitId?.name ?? spec.quantityUnitId?.code ?? 'đơn vị',
      quantityOnHand: onHand, quantityHeld: held, quantityAvailable: onHand - held,
      stockKind: specInstances.length && specLots.length ? 'MIXED_UNSUPPORTED' : specInstances.length ? 'ITEM_INSTANCE' : 'RECEIPT_LOT',
      receipts: specLots.map(row => ({ receiptId: row.receiptId, cellId: row.cellId, cellCode: cells.get(id(row.cellId))?.code ?? null,
        quantityOnHand: row.quantityOnHand, quantityHeld: row.quantityHeld, quantityAvailable: row.quantityAvailable,
        receivedAt: row.receivedAt ?? null, unitWeightKg: row.unitWeightKgSnapshot, unitVolumeM3: row.unitVolumeM3Snapshot,
        unitDimensionsM: row.unitDimensionsM ?? row.unitDimensionsSnapshot })),
      instances: specInstances.map(row => ({ itemInstanceId: row.itemInstanceId, receiptId: row.sourceReceiptId, weightKg: row.unitWeightKgSnapshot,
        volumeM3: row.unitVolumeM3Snapshot, dimensionsM: row.unitDimensionsM ?? row.unitDimensionsSnapshot,
        allocations: (row.allocations ?? []).map((allocation: Plain) => ({ cellId: allocation.cellId, cellCode: cells.get(id(allocation.cellId))?.code ?? null,
          weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 })) })) };
  });
  return { skuId: sku._id, reservationId: reservation._id, facilityId: sku.facilityId, skuRevision: sku.managedV3Revision ?? 0,
    ledgerRevision: Math.max(0, ...state.movements.filter((movement: Plain) => same(movement.itemId, sku._id)).map((movement: Plain) => Number(movement.stockEffect?.ledgerRevision ?? 0))),
    reconciliationStatus: 'RECONCILED', itemSpecifications };
}

function checkTransactionUnavailable(error: any): boolean {
  return error?.code === 20 || error?.codeName === 'IllegalOperation' || /transactions? (?:are|is) not supported|transaction numbers are only allowed/i.test(String(error?.message ?? ''));
}

async function findDirectReplay(skuId: Types.ObjectId, actor: Actor, requestKey: string, payloadHash?: string) {
  const movement: any = await Movement.findOne({ itemId: skuId, customerId: actor._id, idempotencyKey: requestKey, schemaVersion: 4, 'stockEffect.action': 'REMOVE' }).lean().exec();
  if (!movement) return null;
  if (payloadHash && movement.stockEffect?.requestHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được sử dụng với nội dung khác.');
  return { status: 'COMMITTED', replayed: true, movement };
}

async function applyDirectStockEffects(plan: Plain, scope: Plain, actor: Actor, session: ClientSession, movement: any) {
  const lotEffects = (plan.effectLines as Plain[]).filter(line => !line.itemInstanceId);
  const instanceEffects = (plan.effectLines as Plain[]).filter(line => line.itemInstanceId);
  const byLot = new Map<string, Plain[]>();
  for (const line of lotEffects) {
    const lotKey = stockLotKey(line), list = byLot.get(lotKey) ?? [];
    list.push(line); byLot.set(lotKey, list);
  }
  for (const lines of byLot.values()) {
    const line = lines[0]!;
    if (lines.length !== 1) fail(409, 'DUPLICATE_SOURCE_ALLOCATION', 'Receipt/Cell nguồn bị lặp trong cùng một phiếu.');
    const current: any = await CellStock.findOne({ skuId: scope.sku._id, itemSpecId: line.itemSpecId, reservationId: scope.reservation._id,
      facilityId: scope.sku.facilityId, customerId: actor._id, cellId: line.cellId, receiptId: line.receiptId }).session(session).lean().exec();
    if (!current || current.quantityOnHand !== line.quantityBefore || line.quantity > current.quantityAvailable) fail(409, 'SOURCE_STOCK_CHANGED', 'Tồn receipt nguồn đã thay đổi; hãy tải lại và xem trước lần nữa.');
    const after = current.quantityOnHand - line.quantity;
    if (after === 0) {
      const deleted = await CellStock.deleteOne({ _id: current._id, revision: current.revision, quantityOnHand: current.quantityOnHand, quantityHeld: 0 }).session(session).exec();
      if (deleted.deletedCount !== 1) fail(412, 'STALE_CELL_STOCK', 'Projection Cell Stock vừa thay đổi.');
    } else {
      const totals = physicalTotals(current.unitWeightKgSnapshot, current.unitVolumeM3Snapshot, after);
      const updated = await CellStock.updateOne({ _id: current._id, revision: current.revision, quantityOnHand: current.quantityOnHand,
        quantityHeld: current.quantityHeld, quantityAvailable: current.quantityAvailable }, { $set: { quantityOnHand: after, quantityAvailable: after - current.quantityHeld,
          totalWeightKg: totals.totalWeightKg, totalVolumeM3: totals.totalVolumeM3, ledgerRevision: movement.stockEffect.ledgerRevision }, $inc: { revision: 1 } }, { session, runValidators: true }).exec();
      if (updated.matchedCount !== 1) fail(412, 'STALE_CELL_STOCK', 'Projection Cell Stock vừa thay đổi.');
    }
  }
  const instanceIds = [...new Set(instanceEffects.map(line => line.itemInstanceId))];
  for (const instanceId of instanceIds) {
    const instance: any = (scope.state.replay.instances as Plain[]).find(row => row.itemInstanceId === instanceId && row.status === 'PLACED');
    if (!instance) fail(409, 'ITEM_INSTANCE_NOT_AVAILABLE', 'Món nguyên khối không còn trong kho.');
    const selected = instanceEffects.filter(line => line.itemInstanceId === instanceId);
    const expectedCells = instance.allocations.map((allocation: Plain) => id(allocation.cellId)).sort();
    const selectedCells = selected.map(line => id(line.cellId)).sort();
    if (stable(expectedCells) !== stable(selectedCells)) fail(409, 'ITEM_INSTANCE_FOOTPRINT_MISMATCH', 'Phải xuất toàn bộ các ô của món nguyên khối.');
    const updated = await ItemInstance.updateOne({ itemInstanceId: instanceId, skuId: scope.sku._id, itemSpecId: instance.itemSpecId,
      reservationId: scope.reservation._id, customerId: actor._id, facilityId: scope.sku.facilityId, status: 'PLACED', revision: instance.revision },
    { $set: { status: 'REMOVED', allocations: [] }, $inc: { revision: 1 } }, { session, runValidators: true }).exec();
    if (updated.matchedCount !== 1) fail(412, 'STALE_ITEM_INSTANCE', 'Món nguyên khối vừa thay đổi.');
  }
}

export class ManagedInventoryV3OutboundService {
  static async context(skuId: unknown, actor: Actor) {
    const sku = await directOwnedSku(skuId, actor);
    const reservation = await directReservation(sku, actor);
    await rejectUnresolvedLegacyV3Request(sku._id);
    const state = await directFacilityState(sku, reservation);
    const specQuery = ItemSpec.find({ skuId: sku._id, customerId: actor._id, reservationId: reservation._id, facilityId: sku.facilityId,
      status: 'ACTIVE', deletedAt: { $exists: false } }).populate('quantityUnitId', 'name code').sort({ createdAt: 1, _id: 1 });
    const specifications: Plain[] = await specQuery.lean().exec();
    return { sku: { id: sku._id, itemCode: sku.itemCode, name: sku.name, categoryId: sku.categoryId, images: sku.images ?? [] },
      reservation: { id: reservation._id, reservationCode: reservation.reservationCode, facilityId: reservation.facilityId, status: reservation.status },
      stock: directStockResponse(sku, reservation, state, specifications) };
  }

  static async preview(skuId: unknown, body: unknown, actor: Actor) {
    const scope = await loadDirectCandidateState(skuId, body, actor);
    const currentSession = await readOnlySessionScope(scope.candidate, scope.reservation, actor, scope.plan.sourceCellIds);
    const cells = new Map((scope.state.cells as Plain[]).map((cell: Plain) => [id(cell._id), cell]));
    return { status: 'READY', skuId: scope.sku._id, reservationId: scope.reservation._id, facilityId: scope.sku.facilityId,
      accessSession: { sessionId: currentSession._id, purpose: ManagedAccessPurpose.OUTBOUND, expiresAt: currentSession.expiresAt, revision: currentSession.revision },
      lines: scope.plan.specTotals.map((line: Plain) => ({ ...line, sources: scope.plan.effectLines.filter((source: Plain) => source.lineId === scope.candidate.lines.find(candidate => same(candidate.itemSpecId, line.itemSpecId))?.lineId)
        .map((source: Plain) => ({ itemSpecId: source.itemSpecId, receiptId: source.receiptId, itemInstanceId: source.itemInstanceId, cellId: source.cellId,
          cellCode: cells.get(id(source.cellId))?.code ?? null, quantity: source.quantity, quantityBefore: source.quantityBefore, quantityAfter: source.quantityAfter,
          weightRemovedKg: source.allocatedWeightKg, volumeRemovedM3: source.allocatedVolumeM3, unitWeightKgSnapshot: source.unitWeightKgSnapshot,
          unitVolumeM3Snapshot: source.unitVolumeM3Snapshot, unitDimensionsSnapshot: source.unitDimensionsSnapshot })) })),
      capacity: scope.plan.capacity, totalQuantity: scope.plan.quantity, totalWeightKg: scope.plan.totalWeightKg, totalVolumeM3: scope.plan.totalVolumeM3,
      ledgerRevision: Math.max(0, ...scope.state.movements.filter((movement: Plain) => same(movement.itemId, scope.sku._id)).map((movement: Plain) => Number(movement.stockEffect?.ledgerRevision ?? 0))),
      skuRevision: scope.sku.managedV3Revision ?? 0,
      warnings: ['Preview không ghi tồn kho. Customer sẽ ghi nhận đã thực hiện xuất hàng trong phiên OUTBOUND có Staff giám sát.'] };
  }

  static async confirm(skuId: unknown, body: unknown, idempotencyInput: unknown, ifMatchInput: unknown, actor: Actor) {
    const skuIdObject = oid(skuId, 'skuId'), requestKey = key(idempotencyInput), candidate = normalizeDirectOutbound(body), requestHash = hash(candidate);
    if (candidate.physicalRemovalConfirmed !== true || !candidate.customerAttestation?.trim()) fail(422, 'CUSTOMER_ATTESTATION_REQUIRED', 'Customer cần xác nhận đã thực tế lấy hàng khỏi Cell trước khi hoàn tất.');
    await directOwnedSku(skuIdObject, actor);
    const replay = await findDirectReplay(skuIdObject, actor, requestKey, requestHash);
    if (replay) return replay;
    if (version(ifMatchInput) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'If-Match và revision trong payload không khớp.');
    try {
      return await withTransaction(async session => {
        const scope = await loadDirectCandidateState(skuIdObject, candidate, actor, session);
        const sourceCellIds = scope.plan.sourceCellIds.map(value => new Types.ObjectId(value));
        try { await assertManagedAccessSessionScope({ sessionId: candidate.accessSessionId, customerId: actor._id, reservationId: scope.reservation._id,
          facilityId: scope.reservation.facilityId, purpose: ManagedAccessPurpose.OUTBOUND, cellIds: sourceCellIds,
          expectedRevision: candidate.sessionRevision, dbSession: session }); }
        catch (error: any) { if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message); throw error; }
        const nextSku = await Item.updateOne({ _id: scope.sku._id, customerId: actor._id, facilityId: scope.sku.facilityId, inventorySchemaVersion: 3,
          managedV3Revision: candidate.skuRevision, skuStatus: 'ACTIVE', deletedAt: { $exists: false } }, { $inc: { managedV3Revision: 1 } }, { session }).exec();
        if (nextSku.matchedCount !== 1) fail(412, 'STALE_SKU_REVISION', 'SKU vừa thay đổi.');
        for (const spec of [...scope.specifications].sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
          const expectedRevision = candidate.lines.find(line => same(line.itemSpecId, spec._id))!.itemSpecRevision;
          const fenced = await ItemSpec.updateOne({ _id: spec._id, skuId: scope.sku._id, customerId: actor._id, revision: expectedRevision, status: 'ACTIVE' },
            { $inc: { inboundRevision: 1 } }, { session }).exec();
          if (fenced.matchedCount !== 1) fail(412, 'ITEM_SPECIFICATION_STALE', 'Item Specification vừa thay đổi.');
        }
        const cellsById = new Map((scope.state.cells as Plain[]).map((cell: Plain) => [id(cell._id), cell]));
        const byCell = new Map<string, Plain>();
        for (const [cellId, release] of scope.plan.cellRelease.entries()) byCell.set(cellId, { ...release, cell: cellsById.get(cellId) });
        for (const [cellId, release] of [...byCell.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const current: any = release.cell;
          if (!current || release.weightKg > current.usedWeightKg + 0.001 || release.volumeM3 > current.usedVolumeM3 + 0.000001) fail(503, 'CELL_COUNTER_RECONCILIATION_UNKNOWN', 'Counter Cell không đủ để giải phóng tồn theo receipt.');
          const changed = await Cell.updateOne({ _id: current._id, facilityId: scope.sku.facilityId, managedInventoryRevision: current.managedInventoryRevision,
            usedWeightKg: current.usedWeightKg, usedVolumeM3: current.usedVolumeM3 },
          { $inc: { usedWeightKg: -round(release.weightKg, 3), usedVolumeM3: -round(release.volumeM3, 6), managedInventoryRevision: 1 } }, { session }).exec();
          if (changed.matchedCount !== 1) fail(412, 'STALE_CELL_CAPACITY', 'Capacity của Cell ' + current.code + ' vừa thay đổi.');
        }
        const rackIds = [...new Set([...byCell.values()].map((row: Plain) => String(row.cell?.rackId)).filter(Boolean))].sort();
        for (const rackId of rackIds) {
          const changed = await Rack.updateOne({ _id: rackId, facilityId: scope.sku.facilityId, deletedAt: { $exists: false } }, { $inc: { managedInventoryRevision: 1 } }, { session }).exec();
          if (changed.matchedCount !== 1) fail(503, 'RACK_CAPACITY_RECONCILIATION_UNKNOWN', 'Không thể khóa revision Rack/Level.');
        }
        const nextUsed = round(Number(scope.reservation.usedCapacityM3) - scope.plan.totalVolumeM3, 6);
        if (!Number.isFinite(nextUsed) || nextUsed < -0.000001) fail(503, 'RESERVATION_COUNTER_RECONCILIATION_UNKNOWN', 'Reservation capacity không thể giảm an toàn.');
        const reservationUpdated = await ReservationModel.updateOne({ _id: scope.reservation._id, customerId: actor._id, facilityId: scope.sku.facilityId,
          status: ReservationStatus.ACTIVE, inventoryVersion: scope.reservation.inventoryVersion ?? 0, usedCapacityM3: scope.reservation.usedCapacityM3 },
        { $set: { usedCapacityM3: Math.max(0, nextUsed) }, $inc: { inventoryVersion: 1 } }, { session }).exec();
        if (reservationUpdated.matchedCount !== 1) fail(412, 'STALE_RESERVATION_CAPACITY', 'Reservation capacity vừa thay đổi.');
        const movements = (scope.state.movements as Plain[]).filter((movement: Plain) => same(movement.itemId, scope.sku._id));
        const ledgerRevision = Math.max(0, ...movements.map((movement: Plain) => Number(movement.stockEffect?.ledgerRevision ?? 0))) + 1;
        const movementId = new Types.ObjectId(), operationId = 'MI-OUT:' + String(scope.sku._id) + ':' + createHash('sha256').update(requestKey).digest('hex');
        const quantityUnit = new Set(scope.plan.effectLines.map((line: Plain) => line.quantityUnitSnapshot)).size === 1
          ? scope.plan.effectLines[0]!.quantityUnitSnapshot : 'MIXED';
        const first = scope.plan.effectLines[0]!, now = new Date();
        const movement: any = new Movement({ _id: movementId, movementCode: 'MI-' + movementId.toString(), referenceCode: scope.candidate.referenceCode || operationId,
          operationId, itemId: scope.sku._id, managedReservationId: scope.reservation._id, facilityId: scope.sku.facilityId, customerId: actor._id,
          type: ItemMovementType.OUTBOUND, quantity: scope.plan.quantity, quantityUnit, actualUnitWeightKg: round(scope.plan.totalWeightKg / scope.plan.quantity, 3),
          actualTotalWeightKg: scope.plan.totalWeightKg, actualUnitDimensionsM: first.unitDimensionsSnapshot, actualTotalVolumeM3: scope.plan.totalVolumeM3,
          performedBy: actor._id, performedAt: now, inspectionNote: candidate.customerAttestation,
          handoverNote: scope.candidate.notes, idempotencyKey: requestKey, schemaVersion: 4, itemSpecId: first.itemSpecId,
          stockEffect: { action: 'REMOVE', operationId, requestHash, ledgerRevision, contractVersion: 2, accessSessionId: new Types.ObjectId(scope.candidate.accessSessionId),
            source: scope.plan.effectLines, destination: [] } });
        await movement.save({ session });
        await applyDirectStockEffects(scope.plan, scope, actor, session, movement);
        const committedState = await directFacilityState(scope.sku, scope.reservation, session);
        const stock = directStockResponse(scope.sku, scope.reservation, committedState, scope.specifications);
        return { status: 'COMMITTED', replayed: false, movement, stock, quantity: scope.plan.quantity,
          totalWeightKg: scope.plan.totalWeightKg, totalVolumeM3: scope.plan.totalVolumeM3, lineCount: scope.plan.specTotals.length };
      });
    } catch (error: any) {
      if (error instanceof ManagedV3OutboundError || error instanceof ManagedAccessError) throw error;
      if (error?.code === 11000) {
        const recovered = await findDirectReplay(skuIdObject, actor, requestKey, requestHash).catch(() => null);
        if (recovered) return recovered;
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã bị xung đột; hãy đối soát trước khi gửi lại.');
      }
      if (errorLabel(error, 'UnknownTransactionCommitResult')) {
        const recovered = await findDirectReplay(skuIdObject, actor, requestKey, requestHash).catch(() => null);
        if (recovered) return recovered;
        fail(503, 'OUTCOME_UNKNOWN', 'Kết quả commit chưa xác định. Hãy đối soát bằng cùng Idempotency-Key; không tạo key mới.');
      }
      if (checkTransactionUnavailable(error)) fail(503, 'TRANSACTIONS_UNAVAILABLE', 'MongoDB hiện tại không hỗ trợ transaction; xuất kho chưa được ghi.');
      throw error;
    }
  }

  static async operation(skuId: unknown, rawKey: unknown, actor: Actor) {
    const sku = await directOwnedSku(skuId, actor), requestKey = key(rawKey);
    const movement: any = await Movement.findOne({ itemId: sku._id, customerId: actor._id, idempotencyKey: requestKey, schemaVersion: 4,
      'stockEffect.action': 'REMOVE' }).lean().exec();
    if (!movement) fail(404, 'OUTBOUND_OPERATION_NOT_FOUND', 'Chưa tìm thấy phiếu xuất đã xác nhận.');
    return { status: 'COMMITTED', movement };
  }
}
