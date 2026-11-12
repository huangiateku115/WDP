import { createHash, randomUUID } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import InventoryItemModelRaw from '../../models/inventory-items/inventory-item.model';
import ItemMovementModelRaw from '../../models/inventory-items/item-movement.model';
import ProjectionModelRaw from '../../models/inventory-items/managed-v3-stock-projection.model';
import PhysicalUnitModelRaw from '../../models/inventory-items/managed-v3-physical-unit.model';
import FootprintModelRaw from '../../models/inventory-items/managed-v3-footprint.model';
import BatchPlacementModelRaw from '../../models/inventory-items/managed-v3-batch-placement.model';
import TopologyModelRaw from '../../models/warehouse-map/managed-v3-topology-certification.model';
import CellModelRaw from '../../models/warehouse-map/warehouse-cell.model';
import RackModelRaw from '../../models/warehouse-map/warehouse-rack.model';
import AllocationModelRaw from '../../models/warehouse-map/cell-allocation.model';
import ReservationModelRaw from '../../models/reservations/reservation.model';
import SessionModelRaw from '../../models/access/managed-access-session.model';
import { assertManagedAccessSessionScope, ManagedAccessError } from '../access/managed-access.service';
import { replayManagedInventoryV3, v3RequestHash } from './managed-inventory-v3-ledger.service';
import { validateA1Footprint } from './managed-inventory-v3-domain.service';
import { ItemMovementType } from '../../types/item-movement.type';
import { FacilityServiceType } from '../../types/facility.type';
import { InventoryItemStatus } from '../../types/inventory-item.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ManagedAccessSessionStatus, ManagedAccessPurpose } from '../../types/managed-access.type';
import { UserRole } from '../../types/user.type';

// These persistence adapters intentionally use narrowly scoped dynamic projections; document DTOs are validated below.
const InventoryItemModel: any = InventoryItemModelRaw, ItemMovementModel: any = ItemMovementModelRaw, ProjectionModel: any = ProjectionModelRaw;
const PhysicalUnitModel: any = PhysicalUnitModelRaw, FootprintModel: any = FootprintModelRaw, BatchPlacementModel: any = BatchPlacementModelRaw;
const TopologyModel: any = TopologyModelRaw, CellModel: any = CellModelRaw, RackModel: any = RackModelRaw;
const AllocationModel: any = AllocationModelRaw, ReservationModel: any = ReservationModelRaw, SessionModel: any = SessionModelRaw;

type Actor = { _id: Types.ObjectId; role: UserRole; assignedFacilityId?: Types.ObjectId | null };
export class ManagedInventoryV3Error extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new ManagedInventoryV3Error(status, code, message); };
const oid = (value: unknown, field: string) => {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(422, 'INVALID_INPUT', `${field} không hợp lệ.`);
  return new Types.ObjectId(value as string);
};
const plain = (value: any, fields: string[], label: string) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail(422, 'INVALID_INPUT', `${label} không hợp lệ.`); return value; };
const finitePositive = (n: any) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = (n: number, places: number) => Math.round((n + Number.EPSILON) * 10 ** places) / 10 ** places;
function canonicalA2PlacementTotals(placements: any[], quantity: number, unitWeightKg: number, unitVolumeM3: number) {
  if (!Array.isArray(placements) || !Number.isSafeInteger(quantity) || quantity < 1 || !finitePositive(unitWeightKg) || !finitePositive(unitVolumeM3)) {
    fail(422, 'INVALID_PLACEMENT_TOTALS', 'Số lượng và số liệu placement không hợp lệ.');
  }
  const lines = [...placements].sort((a, b) => String(a.cellId).localeCompare(String(b.cellId)));
  if (!lines.length || lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1) ||
      new Set(lines.map(line => String(line.cellId))).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== quantity) {
    fail(422, 'INVALID_PLACEMENT_TOTALS', 'Tổng số lượng placement phải khớp chính xác số lượng nhập và mỗi Cell chỉ được khai báo một lần.');
  }
  const totalWeightKg = round(unitWeightKg * quantity, 3), totalVolumeM3 = round(unitVolumeM3 * quantity, 6);
  let weightUsed = 0, volumeUsed = 0;
  const amounts = new Map<string, { weightKg: number; volumeM3: number }>();
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    const weightKg = last ? round(totalWeightKg - weightUsed, 3) : round(unitWeightKg * line.quantity, 3);
    const volumeM3 = last ? round(totalVolumeM3 - volumeUsed, 6) : round(unitVolumeM3 * line.quantity, 6);
    if (!finitePositive(weightKg) || !finitePositive(volumeM3)) fail(422, 'INVALID_PLACEMENT_TOTALS', 'Không thể phân bổ chính xác số liệu vật lý đã làm tròn.');
    amounts.set(String(line.cellId), { weightKg, volumeM3 }); weightUsed += weightKg; volumeUsed += volumeM3;
  });
  if (weightUsed !== totalWeightKg || volumeUsed !== totalVolumeM3) fail(422, 'INVALID_PLACEMENT_TOTALS', 'Tổng số liệu placement không bảo toàn tổng vật lý sau làm tròn.');
  return { amounts, totalWeightKg, totalVolumeM3 };
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Types.ObjectId)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const scopedV3Reservation = async (item: any, actor: Actor, session?: mongoose.ClientSession) => {
  const reservation = await ReservationModel.findOne({ _id: item.managedReservationId, customerId: actor._id, facilityId: item.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }).session(session ?? null).exec();
  if (!reservation) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
  if (![ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE].includes(reservation.status)) fail(409, 'RESERVATION_NOT_READY', 'Reservation chưa sẵn sàng cho thao tác Managed V3.');
  return reservation;
};
const findCustomerSku = async (itemId: unknown, actor: Actor, session?: mongoose.ClientSession) => {
  const item = await InventoryItemModel.findOne({ _id: oid(itemId, 'skuId'), customerId: actor._id, inventorySchemaVersion: 3, deletedAt: { $exists: false } }).session(session ?? null).exec();
  if (!item) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
  return item;
};
function key(value: unknown) { if (typeof value !== 'string' || !/^[\w.:/-]{8,128}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ.'); return value; }

async function readCertifiedCells(facilityId: Types.ObjectId, cellIds: Types.ObjectId[], now: Date, dbSession?: mongoose.ClientSession) {
  const cells = await CellModel.find({ _id: { $in: cellIds }, facilityId, deletedAt: { $exists: false }, operationalStatus: 'AVAILABLE' }).session(dbSession ?? null).lean().exec();
  if (cells.length !== cellIds.length) fail(409, 'CELL_UNAVAILABLE', 'Một hoặc nhiều Cell không khả dụng.');
  const rackIds = [...new Set<string>((cells as any[]).map((row: any) => String(row.rackId)))].map((value: string) => new Types.ObjectId(value));
  const racks = await RackModel.find({ _id: { $in: rackIds }, facilityId, deletedAt: { $exists: false }, operationalStatus: 'AVAILABLE' }).session(dbSession ?? null).lean().exec();
  const certifications = await TopologyModel.find({ facilityId, rackId: { $in: rackIds }, certificationState: 'CERTIFIED', certifiedAt: { $lte: now }, expiresAt: { $gt: now } }).sort({ revision: -1 }).session(dbSession ?? null).lean().exec();
  const byCell = new Map<string, { certification: any; geometry: any }>();
  for (const cell of cells) {
    const rack: any = (racks as any[]).find((row: any) => String(row._id) === String(cell.rackId));
    const cert = (certifications as any[]).find((row: any) => String(row.rackId) === String(cell.rackId) && row.levelNumber === cell.levelNumber &&
      row.provenance === 'FACILITY_SURVEY' && row.cells.some((entry: any) => String(entry.cellId) === String(cell._id)));
    const geometry = cert?.cells.find((entry: any) => String(entry.cellId) === String(cell._id));
    const axes = cert?.worldTransform?.axes;
    const validTransform = Array.isArray(axes) && axes.length === 3 && axes.every((axis: any) => Array.isArray(axis) && axis.length === 3 && axis.every(Number.isFinite) && Math.abs(Math.hypot(...axis) - 1) <= 0.000001) &&
      axes.every((axis: number[], index: number) => axes.slice(index + 1).every((other: number[]) => Math.abs(axis[0]! * other[0]! + axis[1]! * other[1]! + axis[2]! * other[2]!) <= 0.000001));
    const validGeometry = !!geometry && [geometry.xStartM, geometry.xEndM, geometry.yStartM, geometry.yEndM, geometry.usableHeightM, geometry.maxWeightKg, geometry.maxVolumeM3].every(Number.isFinite) &&
      geometry.xEndM > geometry.xStartM && geometry.yEndM > geometry.yStartM && Math.abs((geometry.xEndM - geometry.xStartM) - cell.dimensions.widthM) <= 0.000001 &&
      Math.abs((geometry.yEndM - geometry.yStartM) - cell.dimensions.depthM) <= 0.000001 && geometry.usableHeightM <= cell.dimensions.heightM && geometry.maxWeightKg <= cell.maxWeightKg &&
      Array.isArray(geometry.obstacles) && geometry.obstacles.every((obstacle: any) => [obstacle.xStartM, obstacle.xEndM, obstacle.yStartM, obstacle.yEndM].every(Number.isFinite) &&
        obstacle.xStartM >= geometry.xStartM && obstacle.xEndM <= geometry.xEndM && obstacle.yStartM >= geometry.yStartM && obstacle.yEndM <= geometry.yEndM &&
        obstacle.xEndM > obstacle.xStartM && obstacle.yEndM > obstacle.yStartM);
    const validCellCapacity = [cell.maxWeightKg, cell.usedWeightKg, cell.usedVolumeM3, cell.dimensions?.widthM, cell.dimensions?.depthM, cell.dimensions?.heightM].every(Number.isFinite) &&
      cell.maxWeightKg > 0 && cell.usedWeightKg >= 0 && cell.usedVolumeM3 >= 0 && cell.dimensions.widthM > 0 && cell.dimensions.depthM > 0 && cell.dimensions.heightM > 0;
    if (!rack || !cert || !geometry || !cert.certifiedBy || !cert.provenance || !cert.supportSurfaceId || cert.rackLayoutVersion !== rack.layoutVersion ||
      !Number.isSafeInteger(cert.revision) || cert.revision < 1 || !Number.isSafeInteger(cert.rackLayoutVersion) ||
      !Array.isArray(cert.worldTransform?.origin) || cert.worldTransform.origin.length !== 3 || !cert.worldTransform.origin.every(Number.isFinite) ||
      !validTransform || !validGeometry || !validCellCapacity ||
      !finitePositive(cert.levelMaxWeightKg) || !finitePositive(geometry.maxWeightKg) || !finitePositive(geometry.maxVolumeM3) || !finitePositive(geometry.usableHeightM) || !Array.isArray(geometry.obstacles)) {
      fail(503, 'CERTIFIED_TOPOLOGY_UNAVAILABLE', 'Thiếu topology/capacity được chứng nhận cho một hoặc nhiều Cell.');
    }
    byCell.set(String(cell._id), { certification: cert, geometry });
  }
  return { cells, byCell };
}
async function validateA1Pose({ item, reservation, actor, unit, certified, cellIds, pose, now, dbSession }: any): Promise<any> {
  if (!pose || typeof pose !== 'object' || Array.isArray(pose) || Object.keys(pose).some((field: string) => !['xStartM', 'yStartM', 'rotationDeg'].includes(field)) ||
      !Number.isFinite(pose.xStartM) || !Number.isFinite(pose.yStartM) || ![0, 90].includes(pose.rotationDeg)) {
    fail(422, 'A1_POSE_REQUIRED', 'Cần vị trí X/Y và góc xoay 0° hoặc 90° của PhysicalUnit.');
  }
  if (cellIds.length !== 1) fail(503, 'A1_LOAD_SHARING_UNCERTIFIED', 'A1 trải nhiều Cell đang bị khóa vì Facility chưa có chứng nhận load-sharing đáng tin cậy.');
  const cell: any = certified.cells[0], certifiedCell = certified.byCell.get(String(cell._id));
  if (!cell || !certifiedCell) fail(503, 'CERTIFIED_TOPOLOGY_UNAVAILABLE', 'Không có geometry được chứng nhận cho Cell.');
  const geometry: any = certifiedCell.geometry, certificate = certifiedCell.certification;
  const levelCells: any[] = await CellModel.find({ rackId: cell.rackId, levelNumber: cell.levelNumber, deletedAt: { $exists: false } })
    .session(dbSession ?? null).select('usedWeightKg').lean().exec();
  const levelUsed = levelCells.reduce((sum, row) => sum + Number(row.usedWeightKg), 0);
  const rack: any = await RackModel.findOne({ _id: cell.rackId, facilityId: item.facilityId, deletedAt: { $exists: false }, operationalStatus: 'AVAILABLE' })
    .session(dbSession ?? null).lean().exec();
  if (!rack) fail(409, 'RACK_UNAVAILABLE', 'Rack không khả dụng.');
  try {
    const verified = validateA1Footprint({
      scope: { skuId: String(item._id), reservationId: String(reservation._id), customerId: String(actor._id), facilityId: String(item.facilityId) },
      physicalUnit: { skuId: String(unit.skuId), reservationId: String(unit.reservationId), customerId: String(unit.customerId), facilityId: String(unit.facilityId),
        weightKg: unit.weightKg, dimensionsM: unit.dimensionsM, volumeM3: unit.volumeM3, pose },
      cells: [{ cellId: String(cell._id), facilityId: String(item.facilityId), rackId: String(cell.rackId), levelNumber: cell.levelNumber, supportSurfaceId: certificate.supportSurfaceId,
        xStartM: geometry.xStartM, xEndM: geometry.xEndM, yStartM: geometry.yStartM, yEndM: geometry.yEndM, usableHeightM: geometry.usableHeightM,
        certified: true, certificationState: certificate.certificationState, certificationRevision: certificate.revision, certifiedAt: certificate.certifiedAt, expiresAt: certificate.expiresAt,
        certifiedBy: String(certificate.certifiedBy), provenance: certificate.provenance, transformRevision: certificate.revision, worldTransform: certificate.worldTransform,
        obstacles: geometry.obstacles, maxWeightKg: Math.min(cell.maxWeightKg, geometry.maxWeightKg), usedWeightKg: cell.usedWeightKg,
        maxVolumeM3: geometry.maxVolumeM3, usedVolumeM3: cell.usedVolumeM3 }],
      supports: [{ cellId: String(cell._id), reactionKg: unit.weightKg, occupiedVolumeM3: unit.volumeM3 }],
      level: { facilityId: String(item.facilityId), rackId: String(cell.rackId), levelNumber: cell.levelNumber,
        maxWeightKg: Math.min(Number(rack.maxWeightKgPerLevel), Number(certificate.levelMaxWeightKg)), usedWeightKg: levelUsed, certificationRevision: certificate.revision },
      allocatedCellIds: cellIds.map(String), now,
    });
    return { verified, cell, geometry, certificate, pose: { xStartM: pose.xStartM, yStartM: pose.yStartM, rotationDeg: pose.rotationDeg } };
  } catch (error: any) { fail(409, 'A1_GEOMETRY_INVALID', error?.message || 'A1 geometry/capacity validation failed.'); }
}
function assertActualMeasurements(body: any) {
  const dims = body.dimensionsM;
  if (!finitePositive(body.actualUnitWeightKg) || !dims || !finitePositive(dims.widthM) || !finitePositive(dims.depthM) || !finitePositive(dims.heightM) ||
    !Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 100000 || typeof body.quantityUnit !== 'string' || !body.quantityUnit.trim() || body.quantityUnit.length > 32) {
    fail(422, 'INVALID_MEASUREMENTS', 'Số lượng, đơn vị, khối lượng và kích thước thực tế không hợp lệ.');
  }
  const unitVolume = round(dims.widthM * dims.depthM * dims.heightM, 6), totalWeight = round(body.actualUnitWeightKg * body.quantity, 3), totalVolume = round(unitVolume * body.quantity, 6);
  if (![unitVolume, totalWeight, totalVolume].every(Number.isFinite) || unitVolume <= 0 || totalWeight <= 0 || totalVolume <= 0) fail(422, 'INVALID_MEASUREMENTS', 'Số liệu vượt giới hạn tính toán an toàn.');
  return { unitVolume, totalWeight, totalVolume, dimensionsM: dims };
}

export class ManagedInventoryV3Service {
  static async preparePhysicalUnit(itemId: unknown, body: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được chuẩn bị PhysicalUnit.');
    const input = plain(body, ['serial', 'actualUnitWeightKg', 'dimensionsM'], 'PhysicalUnit');
    const item = await findCustomerSku(itemId, actor); const reservation = await scopedV3Reservation(item, actor);
    const measurements = assertActualMeasurements({ ...input, quantity: 1, quantityUnit: item.quantityUnit });
    if (typeof input.serial !== 'string' || input.serial.trim().length < 1 || input.serial.trim().length > 120) fail(422, 'INVALID_INPUT', 'Mã PhysicalUnit tối đa 120 ký tự.');
    const created = await PhysicalUnitModel.create({ skuId: item._id, reservationId: reservation._id, customerId: actor._id, facilityId: item.facilityId,
      serial: input.serial.trim(), weightKg: input.actualUnitWeightKg, dimensionsM: measurements.dimensionsM, volumeM3: measurements.unitVolume, state: 'PREPARED', revision: 0 });
    return created;
  }

  static async listPhysicalUnits(itemId: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được xem SKU của mình.');
    const item = await findCustomerSku(itemId, actor); await scopedV3Reservation(item, actor);
    return PhysicalUnitModel.find({ skuId: item._id, customerId: actor._id, reservationId: item.managedReservationId }).sort({ createdAt: -1 }).lean().exec();
  }

  static async previewInbound(itemId: unknown, body: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được xem placement preview.');
    const input = plain(body, ['accessSessionId', 'cellIds', 'itemKind', 'physicalUnitId', 'quantity', 'quantityUnit', 'actualUnitWeightKg', 'dimensionsM', 'pose', 'placements'], 'Preview nhập hàng');
    if (!Array.isArray(input.cellIds) || input.cellIds.length < 1 || input.cellIds.length > 100) fail(422, 'INVALID_INPUT', 'Cần từ 1 đến 100 Cell.');
    const cellIds = input.cellIds.map((value: unknown) => oid(value, 'cellId'));
    if (new Set(cellIds.map(String)).size !== cellIds.length) fail(422, 'INVALID_INPUT', 'Cell không được lặp.');
    const item = await findCustomerSku(itemId, actor); const reservation = await scopedV3Reservation(item, actor); const now = new Date();
    const session = await SessionModel.findOne({ _id: oid(input.accessSessionId, 'accessSessionId'), reservationId: reservation._id, customerId: actor._id,
      facilityId: item.facilityId, status: ManagedAccessSessionStatus.ACTIVE, allowedPurposes: ManagedAccessPurpose.INBOUND, expiresAt: { $gt: now }, startedAt: { $lte: now },
      allowedCellIds: { $all: cellIds } }).lean().exec();
    if (!session) fail(409, 'ACCESS_SESSION_INVALID', 'Cần Access Session INBOUND còn hiệu lực và đúng phạm vi.');
    const allocation = await AllocationModel.find({ reservationId: reservation._id, customerId: actor._id, facilityId: item.facilityId, cellId: { $in: cellIds },
      status: { $in: ['RESERVED', 'OCCUPIED'] }, startDate: { $lte: now }, endDate: { $gt: now } }).lean().exec();
    if (allocation.length !== cellIds.length) fail(409, 'CELL_NOT_ALLOCATED', 'Một hoặc nhiều Cell không thuộc allocation đang hiệu lực.');
    const certified = await readCertifiedCells(item.facilityId, cellIds, now);
    if (input.itemKind === 'A1_PHYSICAL_UNIT') {
      if (cellIds.length !== 1) fail(503, 'A1_LOAD_SHARING_UNCERTIFIED', 'Multi-Cell A1 placement cần chứng nhận load-sharing vật lý cho Facility; chưa có dữ liệu này.');
      const unit = await PhysicalUnitModel.findOne({ _id: oid(input.physicalUnitId, 'physicalUnitId'), skuId: item._id, reservationId: reservation._id, customerId: actor._id,
        facilityId: item.facilityId, state: 'PREPARED' }).lean().exec();
      if (!unit) fail(404, 'PHYSICAL_UNIT_NOT_FOUND', 'Không tìm thấy PhysicalUnit đã chuẩn bị.');
      const placement = await validateA1Pose({ item, reservation, actor, unit, certified, cellIds, pose: input.pose, now });
      const { cell, geometry, certificate } = placement;
      return { status: 'READY', itemKind: input.itemKind, skuId: String(item._id), physicalUnitId: String(unit._id), reservationId: String(reservation._id), accessSessionId: String(session._id),
        sessionRevision: session.revision, cellIds: cellIds.map(String), topologyCertificationId: String(certified.byCell.get(String(cell._id))!.certification._id),
        topologyRevision: certificate.revision, pose: placement.pose, quantity: 1, weightKg: unit.weightKg, volumeM3: unit.volumeM3,
        poseBounds: { xStartM: geometry.xStartM, xEndM: geometry.xEndM, yStartM: geometry.yStartM, yEndM: geometry.yEndM, usableHeightM: geometry.usableHeightM, rotationDeg: [0, 90] },
        previewRevision: item.managedV3Revision ?? 0, remainingWeightKg: Math.max(0, Math.min(cell.maxWeightKg, geometry.maxWeightKg) - cell.usedWeightKg), remainingVolumeM3: Math.max(0, geometry.maxVolumeM3 - cell.usedVolumeM3), expiresAt: session.expiresAt };
    }
    if (input.itemKind !== 'A2_BATCH') fail(422, 'INVALID_INPUT', 'Loại placement không hợp lệ.');
    const measurements = assertActualMeasurements(input);
    if (!Array.isArray(input.placements) || input.placements.length < 1 || input.placements.length > 100) fail(422, 'INVALID_INPUT', 'Cần từ 1 đến 100 dòng phân bổ.');
    const placementTotals = canonicalA2PlacementTotals(input.placements, input.quantity, input.actualUnitWeightKg, measurements.unitVolume);
    const seen = new Set<string>(); let totalQuantity = 0, totalWeightKg = 0, totalVolumeM3 = 0;
    const byCell = new Map<string, any>();
    for (const line of input.placements) {
      plain(line, ['cellId', 'quantity'], 'Dòng phân bổ');
      if (!line || !cellIds.some((cellId: Types.ObjectId) => String(cellId) === String(line.cellId)) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || seen.has(String(line.cellId))) fail(422, 'INVALID_INPUT', 'Dòng phân bổ Cell không hợp lệ hoặc bị trùng.');
      seen.add(String(line.cellId)); const cell: any = (certified.cells as any[]).find((row: any) => String(row._id) === String(line.cellId)), geometry: any = certified.byCell.get(String(cell._id))!.geometry;
      if (measurements.dimensionsM.widthM > cell.dimensions.widthM || measurements.dimensionsM.depthM > cell.dimensions.depthM || measurements.dimensionsM.heightM > geometry.usableHeightM) fail(409, 'ITEM_DOES_NOT_FIT', 'Kích thước SKU không vừa Cell.');
      if (geometry.obstacles.length) fail(503, 'CELL_GEOMETRY_UNSUPPORTED', 'Cell có vật cản; chưa thể xác nhận vị trí đặt an toàn nếu chưa khai báo tọa độ thực tế.');
      const { weightKg, volumeM3 } = placementTotals.amounts.get(String(line.cellId))!;
      if (cell.usedWeightKg + weightKg > Math.min(cell.maxWeightKg, geometry.maxWeightKg) || cell.usedVolumeM3 + volumeM3 > geometry.maxVolumeM3) fail(409, 'CAPACITY_EXCEEDED', 'Cell không đủ dung lượng cho số lượng nhập.');
      totalQuantity += line.quantity; totalWeightKg += weightKg; totalVolumeM3 += volumeM3; byCell.set(String(line.cellId), { cell, geometry, weightKg, volumeM3 });
    }
    if (!Number.isSafeInteger(totalQuantity) || totalQuantity !== input.quantity || totalWeightKg !== placementTotals.totalWeightKg || totalVolumeM3 !== placementTotals.totalVolumeM3) fail(422, 'INVALID_PLACEMENT_TOTALS', 'Tổng số lượng phân bổ phải khớp tổng nhập.');
    for (const [cellId, value] of byCell) {
      const rack: any = await RackModel.findOne({ _id: value.cell.rackId, facilityId: item.facilityId, deletedAt: { $exists: false }, operationalStatus: 'AVAILABLE' }).lean().exec();
      if (!rack) fail(409, 'RACK_UNAVAILABLE', 'Rack không khả dụng.');
      const levelCells: any[] = await CellModel.find({ rackId: value.cell.rackId, levelNumber: value.cell.levelNumber, deletedAt: { $exists: false } }).select('usedWeightKg').lean().exec();
      const used = levelCells.reduce((sum, row) => sum + row.usedWeightKg, 0);
      const levelAdded = [...byCell.values()].filter(v => String(v.cell.rackId) === String(value.cell.rackId) && v.cell.levelNumber === value.cell.levelNumber).reduce((sum, v) => sum + v.weightKg, 0);
      const levelLimit = Math.min(Number(rack.maxWeightKgPerLevel), Number(certified.byCell.get(String(value.cell._id))!.certification.levelMaxWeightKg));
      if (!Number.isFinite(used) || !Number.isFinite(levelLimit) || used + levelAdded > levelLimit) fail(409, 'LEVEL_CAPACITY_EXCEEDED', 'Level không đủ tải trọng được chứng nhận.');
    }
    return { status: 'READY', itemKind: input.itemKind, skuId: String(item._id), reservationId: String(reservation._id), accessSessionId: String(session._id), sessionRevision: session.revision,
      cellIds: cellIds.map(String), topologyCertificationIds: [...new Set([...byCell.values()].map(v => String(certified.byCell.get(String(v.cell._id))!.certification._id)))],
      topologyRevisions: [...new Set([...byCell.values()].map(v => certified.byCell.get(String(v.cell._id))!.certification.revision))], quantity: totalQuantity, weightKg: totalWeightKg, volumeM3: totalVolumeM3,
      previewRevision: item.managedV3Revision ?? 0,
      placements: [...byCell.entries()].map(([cellId, value]) => ({ cellId, weightKg: value.weightKg, volumeM3: value.volumeM3, remainingWeightKg: Math.max(0, Math.min(value.cell.maxWeightKg, value.geometry.maxWeightKg) - value.cell.usedWeightKg), remainingVolumeM3: Math.max(0, value.geometry.maxVolumeM3 - value.cell.usedVolumeM3) })),
      expiresAt: session.expiresAt };
  }

  static async confirmInbound(itemId: unknown, body: unknown, actor: Actor, idempotencyHeader: unknown) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được xác nhận Self-Inbound.');
    const input = plain(body, ['itemKind', 'accessSessionId', 'sessionRevision', 'physicalUnitId', 'quantity', 'quantityUnit', 'actualUnitWeightKg', 'dimensionsM', 'pose', 'cellIds', 'placements', 'topologyCertificationId', 'topologyRevision', 'topologyCertificationIds', 'topologyRevisions', 'previewRevision'], 'Xác nhận nhập hàng');
    if (input.itemKind === 'A1_PHYSICAL_UNIT' && (!input.pose || typeof input.pose !== 'object' || Array.isArray(input.pose) ||
        Object.keys(input.pose).some((field: string) => !['xStartM', 'yStartM', 'rotationDeg'].includes(field)))) {
      fail(422, 'A1_POSE_REQUIRED', 'Cần vị trí X/Y và góc xoay 0° hoặc 90° của PhysicalUnit.');
    }
    const requestKey = key(idempotencyHeader), itemObjectId = oid(itemId, 'skuId'), requestHash = hash(input);
    const ownedItem = await findCustomerSku(itemObjectId, actor); await scopedV3Reservation(ownedItem, actor);
    const existing = await ItemMovementModel.findOne({ itemId: itemObjectId, idempotencyKey: requestKey }).lean().exec();
    if (existing) {
      if (existing.schemaVersion !== 3 || existing.v3Effect?.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với payload khác.');
      return { movement: existing, projection: await ProjectionModel.findOne({ skuId: itemObjectId }).lean().exec(), replayed: true };
    }
    if (!Array.isArray(input.placements) || input.placements.length < 1 || input.placements.length > 100 || !Array.isArray(input.cellIds) || input.cellIds.length !== input.placements.length) fail(422, 'INVALID_INPUT', 'Cần danh sách Cell khớp chính xác với các dòng placement.');
    const lineIds = input.placements.map((line: any) => {
      plain(line, input.itemKind === 'A1_PHYSICAL_UNIT' ? ['cellId'] : ['cellId', 'quantity'], 'Dòng placement');
      return oid(line.cellId, 'cellId');
    });
    const requestedCellIds = input.cellIds.map((value: unknown) => oid(value, 'cellId'));
    const cellIds = input.itemKind === 'A1_PHYSICAL_UNIT' ? [lineIds[0]] : lineIds;
    const canonicalIds = (values: Types.ObjectId[]) => values.map(String).sort();
    if (new Set(cellIds.map(String)).size !== cellIds.length || JSON.stringify(canonicalIds(requestedCellIds)) !== JSON.stringify(canonicalIds(lineIds))) fail(422, 'INVALID_INPUT', 'Cell placement bị trùng hoặc không khớp danh sách được xác nhận.');
    const dbSession = await mongoose.startSession(); let result: any;
    try {
      await dbSession.withTransaction(async () => {
        const item = await findCustomerSku(itemObjectId, actor, dbSession), reservation = await scopedV3Reservation(item, actor, dbSession);
        const now = new Date(); if (reservation.status !== ReservationStatus.ACTIVE || reservation.startDate > now || reservation.endDate <= now || !reservation.handoverAt) fail(409, 'RENTAL_NOT_ACTIVE', 'Inbound chỉ khả dụng sau Handover khi Rental ACTIVE.');
        const allocations = await AllocationModel.find({ reservationId: reservation._id, customerId: actor._id, facilityId: item.facilityId, cellId: { $in: cellIds }, status: { $in: ['RESERVED', 'OCCUPIED'] }, startDate: { $lte: now }, endDate: { $gt: now } }).session(dbSession).lean().exec();
        if (allocations.length !== cellIds.length) fail(409, 'CELL_NOT_ALLOCATED', 'Một hoặc nhiều Cell không được cấp cho Reservation.');
        const certified = await readCertifiedCells(item.facilityId, cellIds, now, dbSession);
        const sessionId = oid(input.accessSessionId, 'accessSessionId');
        await assertManagedAccessSessionScope({ sessionId, customerId: actor._id, reservationId: reservation._id, facilityId: item.facilityId,
          purpose: ManagedAccessPurpose.INBOUND, cellIds, expectedRevision: input.sessionRevision, dbSession });
        const currentItem = await InventoryItemModel.findOneAndUpdate({ _id: item._id, customerId: actor._id, managedReservationId: reservation._id,
          inventorySchemaVersion: 3, managedV3Revision: item.managedV3Revision ?? 0 }, { $inc: { managedV3Revision: 1 } }, { new: true, session: dbSession }).exec();
        if (!currentItem) fail(412, 'STALE_INVENTORY_REVISION', 'SKU đã thay đổi; tải lại trước khi xác nhận.');
        const movementId = new Types.ObjectId(), operationId = `MI-V3:${String(item._id)}:${requestKey}`;
        let kind: 'A1_PHYSICAL_UNIT' | 'A2_BATCH' = 'A2_BATCH', effectLines: any[] = [], physicalUnit: any = null, batchId: string | undefined;
        const measurements = input.itemKind === 'A1_PHYSICAL_UNIT' ? null : assertActualMeasurements(input);
        if (input.itemKind === 'A1_PHYSICAL_UNIT') {
          kind = 'A1_PHYSICAL_UNIT';
          if (cellIds.length !== 1 || input.placements.length !== 1) fail(503, 'A1_LOAD_SHARING_UNCERTIFIED', 'Multi-Cell A1 requires certified load-sharing geometry not currently present in facility topology.');
          physicalUnit = await PhysicalUnitModel.findOne({ _id: oid(input.physicalUnitId, 'physicalUnitId'), skuId: item._id, reservationId: reservation._id,
            customerId: actor._id, facilityId: item.facilityId, state: 'PREPARED' }).session(dbSession).exec();
          if (!physicalUnit) fail(404, 'PHYSICAL_UNIT_NOT_FOUND', 'Không tìm thấy PhysicalUnit chưa được đặt.');
          const placement = await validateA1Pose({ item, reservation, actor, unit: physicalUnit, certified, cellIds, pose: input.pose, now, dbSession });
          const { cell, certificate, pose } = placement;
          const supportReactionKg = physicalUnit.weightKg, occupiedVolumeM3 = physicalUnit.volumeM3;
          effectLines = [{ cellId: cell._id, topologyCertificationId: certificate._id, topologyRevision: certificate.revision,
            physicalUnitId: physicalUnit._id, quantity: 1, quantityUnit: item.quantityUnit, weightKg: supportReactionKg, volumeM3: occupiedVolumeM3, supportReactionKg, occupiedVolumeM3, pose }];
        } else if (input.itemKind === 'A2_BATCH') {
          kind = 'A2_BATCH'; const calculated = assertActualMeasurements(input); batchId = String(movementId);
          if (input.quantityUnit !== item.quantityUnit) fail(422, 'QUANTITY_UNIT_MISMATCH', 'Đơn vị nhập phải khớp đơn vị SKU.');
          const placementTotals = canonicalA2PlacementTotals(input.placements, input.quantity, input.actualUnitWeightKg, calculated.unitVolume);
          effectLines = input.placements.map((line: any) => {
            if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) fail(422, 'INVALID_QUANTITY', 'Số lượng theo Cell phải là số nguyên dương.');
            const cell: any = (certified.cells as any[]).find((row: any) => String(row._id) === String(line.cellId)), geometry: any = certified.byCell.get(String(cell?._id))?.geometry;
            if (!cell || !geometry) fail(409, 'CERTIFIED_TOPOLOGY_UNAVAILABLE', 'Không tìm thấy topology được chứng nhận cho Cell.');
            if (calculated.dimensionsM.widthM > cell.dimensions.widthM || calculated.dimensionsM.depthM > cell.dimensions.depthM || calculated.dimensionsM.heightM > geometry.usableHeightM) fail(409, 'ITEM_DOES_NOT_FIT', 'Hàng hóa không vừa Cell đã chọn.');
            if (geometry.obstacles.length) fail(503, 'CELL_GEOMETRY_UNSUPPORTED', 'Cell có vật cản; chưa thể xác nhận vị trí đặt an toàn nếu chưa khai báo tọa độ thực tế.');
            const certificate = certified.byCell.get(String(cell._id))!.certification;
            const physical = placementTotals.amounts.get(String(line.cellId))!;
            return { cellId: cell._id, topologyCertificationId: certificate._id, topologyRevision: certificate.revision,
              batchId, quantity: line.quantity, quantityUnit: input.quantityUnit, weightKg: physical.weightKg, volumeM3: physical.volumeM3 };
          });
          const totalQty = effectLines.reduce((n: number, line: any) => n + line.quantity, 0), totalWeight = effectLines.reduce((n: number, line: any) => n + line.weightKg, 0), totalVolume = effectLines.reduce((n: number, line: any) => n + line.volumeM3, 0);
          if (!Number.isSafeInteger(input.quantity) || input.quantity !== totalQty || totalWeight !== placementTotals.totalWeightKg || totalVolume !== placementTotals.totalVolumeM3) fail(422, 'INVALID_PLACEMENT_TOTALS', 'Số lượng phân bổ phải khớp chính xác tổng nhập.');
        } else fail(422, 'INVALID_ITEM_KIND', 'Loại hàng nhập không hợp lệ.');
        const expectedRevisions = [...new Set([...certified.byCell.values()].map((value: any) => String(value.certification._id)))].sort();
        const expectedTopologyRevisions = [...new Set([...certified.byCell.values()].map((value: any) => Number(value.certification.revision)))].sort((a, b) => a - b);
        if (Number(input.previewRevision) !== Number(item.managedV3Revision ?? 0)) fail(412, 'STALE_INVENTORY_REVISION', 'SKU đã thay đổi sau preview; tải lại.');
        if (input.itemKind === 'A1_PHYSICAL_UNIT' && (String(input.topologyCertificationId) !== expectedRevisions[0] || input.topologyRevision !== certified.byCell.get(String(cellIds[0]))!.certification.revision)) fail(412, 'STALE_TOPOLOGY', 'Topology preview đã cũ; tải lại.');
        if (input.itemKind === 'A2_BATCH' && (!Array.isArray(input.topologyCertificationIds) || JSON.stringify([...input.topologyCertificationIds].map(String).sort()) !== JSON.stringify(expectedRevisions) ||
          !Array.isArray(input.topologyRevisions) || JSON.stringify([...input.topologyRevisions].map(Number).sort((a: number, b: number) => a - b)) !== JSON.stringify(expectedTopologyRevisions))) fail(412, 'STALE_TOPOLOGY', 'Topology preview đã cũ; tải lại.');
        const cellDocs: any[] = certified.cells;
        const grouped = new Map<string, { rackId: Types.ObjectId; levelNumber: number; weight: number; volume: number }>();
        for (const line of effectLines) { const cell = cellDocs.find(row => String(row._id) === String(line.cellId))!; const k = `${cell.rackId}:${cell.levelNumber}`; const group = grouped.get(k) ?? { rackId: cell.rackId, levelNumber: cell.levelNumber, weight: 0, volume: 0 }; group.weight += line.weightKg; group.volume += line.volumeM3; grouped.set(k, group); }
        for (const group of grouped.values()) {
          const rack: any = await RackModel.findOne({ _id: group.rackId, facilityId: item.facilityId, deletedAt: { $exists: false }, operationalStatus: 'AVAILABLE' }).session(dbSession).exec();
          if (!rack) fail(409, 'RACK_UNAVAILABLE', 'Rack không khả dụng.');
          const levelCells: any[] = await CellModel.find({ rackId: group.rackId, levelNumber: group.levelNumber, deletedAt: { $exists: false } }).session(dbSession).lean().exec();
          const levelUsage = levelCells.reduce((sum, row) => sum + Number(row.usedWeightKg), 0);
          const levelCert = [...certified.byCell.values()].map((value: any) => value.certification).find((cert: any) => String(cert.rackId) === String(group.rackId) && cert.levelNumber === group.levelNumber);
          const levelLimit = Math.min(Number(rack.maxWeightKgPerLevel), Number(levelCert?.levelMaxWeightKg));
          if (!Number.isFinite(levelUsage) || !Number.isFinite(levelLimit) || levelUsage + group.weight > levelLimit) fail(409, 'LEVEL_CAPACITY_EXCEEDED', 'Level không đủ tải trọng được chứng nhận.');
          const fencedRack = await RackModel.updateOne({ _id: rack._id, managedInventoryRevision: rack.managedInventoryRevision ?? 0, operationalStatus: 'AVAILABLE' }, { $inc: { managedInventoryRevision: 1 } }, { session: dbSession }).exec();
          if (fencedRack.matchedCount !== 1) fail(412, 'STALE_CAPACITY', 'Rack capacity vừa thay đổi.');
        }
        const linesByCell = new Map<string, { weight: number; volume: number }>();
        for (const line of effectLines) { const k = String(line.cellId), add = linesByCell.get(k) ?? { weight: 0, volume: 0 }; add.weight += line.weightKg; add.volume += line.volumeM3; linesByCell.set(k, add); }
        for (const [cellId, add] of linesByCell) {
          const cell: any = cellDocs.find(row => String(row._id) === cellId), geometry: any = certified.byCell.get(cellId)!.geometry;
          if (cell.usedWeightKg + add.weight > Math.min(cell.maxWeightKg, geometry.maxWeightKg) || cell.usedVolumeM3 + add.volume > geometry.maxVolumeM3) fail(409, 'CAPACITY_EXCEEDED', 'Cell không đủ dung lượng.');
          const update = await CellModel.updateOne({ _id: cell._id, managedInventoryRevision: cell.managedInventoryRevision ?? 0, allocationVersion: cell.allocationVersion },
            { $inc: { usedWeightKg: add.weight, usedVolumeM3: add.volume, managedInventoryRevision: 1 } }, { session: dbSession }).exec();
          if (update.matchedCount !== 1) fail(412, 'STALE_CAPACITY', 'Cell capacity vừa thay đổi.');
        }
        for (const certId of expectedRevisions) {
          const cert = [...certified.byCell.values()].map((value: any) => value.certification).find((value: any) => String(value._id) === certId)!;
          const update = await TopologyModel.updateOne({ _id: cert._id, certificationState: 'CERTIFIED', revision: cert.revision, expiresAt: { $gt: now }, certifiedAt: { $lte: now },
            managedInventoryRevision: cert.managedInventoryRevision ?? 0 }, { $inc: { managedInventoryRevision: 1 } }, { session: dbSession }).exec();
          if (update.matchedCount !== 1) fail(412, 'STALE_TOPOLOGY', 'Chứng nhận topology đã thay đổi hoặc hết hạn.');
        }
        const calculated = input.itemKind === 'A1_PHYSICAL_UNIT' ? { totalQuantity: 1, totalWeight: physicalUnit.weightKg, totalVolume: physicalUnit.volumeM3,
          unitWeight: physicalUnit.weightKg, dimensions: physicalUnit.dimensionsM, quantityUnit: item.quantityUnit } : (() => { const m = assertActualMeasurements(input); return { totalQuantity: input.quantity, totalWeight: m.totalWeight, totalVolume: m.totalVolume, unitWeight: input.actualUnitWeightKg, dimensions: m.dimensionsM, quantityUnit: input.quantityUnit }; })();
        const usedVolume = Number(reservation.usedCapacityM3 ?? 0), quota = Number(reservation.allocatedCapacity ?? 0);
        if (!Number.isFinite(usedVolume) || usedVolume < 0 || !Number.isFinite(quota) || quota <= 0 || usedVolume + calculated.totalVolume > quota + 0.000001) fail(409, 'RESERVATION_CAPACITY_EXCEEDED', 'Hàng nhập vượt dung lượng đã thuê.');
        const reservationFence = await ReservationModel.findOneAndUpdate({ _id: reservation._id, inventoryVersion: reservation.inventoryVersion ?? 0,
          usedCapacityM3: reservation.usedCapacityM3 ?? 0, allocatedCapacity: { $gte: usedVolume + calculated.totalVolume } },
          { $inc: { inventoryVersion: 1, usedCapacityM3: calculated.totalVolume } }, { new: true, session: dbSession }).exec();
        if (!reservationFence) fail(412, 'STALE_RESERVATION_REVISION', 'Reservation dung lượng vừa thay đổi; tải lại trước khi xác nhận.');
        const certIds = expectedRevisions.map(value => new Types.ObjectId(value));
        const certificate = [...certified.byCell.values()].map((value: any) => value.certification).find((value: any) => String(value._id) === expectedRevisions[0])!;
        const movementType = ItemMovementType.INBOUND;
        const movement = await ItemMovementModel.create([{
          _id: movementId, itemId: item._id, managedReservationId: reservation._id, facilityId: item.facilityId, customerId: actor._id,
          type: movementType, sourceCellId: null, destinationCellId: null, quantity: calculated.totalQuantity, quantityUnit: calculated.quantityUnit,
          actualUnitWeightKg: calculated.unitWeight, actualTotalWeightKg: calculated.totalWeight, actualUnitDimensionsM: calculated.dimensions,
          actualTotalVolumeM3: calculated.totalVolume, performedBy: actor._id, performedAt: now, idempotencyKey: requestKey,
          schemaVersion: 3, operationId, v3Effect: { action: 'ADD', itemKind: kind, operationId, requestHash, accessSessionId: sessionId,
            inventoryRevision: currentItem.managedV3Revision, ledgerRevision: ((await ProjectionModel.findOne({ skuId: item._id }).session(dbSession).lean().exec())?.ledgerRevision ?? 0) + 1,
            topologyCertificationId: certificate._id, topologyRevision: certificate.revision, correlationId: randomUUID(), destination: effectLines }
        }], { session: dbSession });
        const movementDoc: any = movement[0];
        if (kind === 'A1_PHYSICAL_UNIT') {
          const unitUpdate = await PhysicalUnitModel.updateOne({ _id: physicalUnit._id, state: 'PREPARED', revision: physicalUnit.revision, currentPose: null },
            { $set: { state: 'PLACED', sourceMovementId: movementDoc._id, currentPose: effectLines[0].pose }, $inc: { revision: 1 } }, { session: dbSession }).exec();
          if (unitUpdate.matchedCount !== 1) fail(412, 'STALE_PHYSICAL_UNIT', 'PhysicalUnit vừa thay đổi.');
          const cell = effectLines[0];
          await FootprintModel.create([{ physicalUnitId: physicalUnit._id, reservationId: reservation._id, customerId: actor._id, facilityId: item.facilityId, pose: effectLines[0].pose,
            cells: [{ cellId: cell.cellId, supportReactionKg: cell.supportReactionKg, occupiedVolumeM3: cell.occupiedVolumeM3,
              topologyCertificationId: cell.topologyCertificationId, topologyRevision: cell.topologyRevision }],
            topologyCertificationId: certificate._id, topologyRevision: certificate.revision, sourceMovementId: movementDoc._id, verifiedAt: now, state: 'ACTIVE', revision: 0 }], { session: dbSession });
        } else {
          await BatchPlacementModel.create(effectLines.map((line: any) => ({ skuId: item._id, reservationId: reservation._id, customerId: actor._id, facilityId: item.facilityId,
            batchId, cellId: line.cellId, quantity: line.quantity, quantityUnit: line.quantityUnit, weightKg: line.weightKg, volumeM3: line.volumeM3,
            topologyCertificationId: line.topologyCertificationId, topologyRevision: line.topologyRevision,
            sourceMovementId: movementDoc._id, receiptMovementId: movementDoc._id, state: 'ACTIVE', revision: 0 })), { session: dbSession });
        }
        const history = await ItemMovementModel.find({ itemId: item._id, schemaVersion: 3 }).sort({ performedAt: 1, _id: 1 }).session(dbSession).lean().exec();
        const projection = replayManagedInventoryV3(item.toObject(), history as any[]);
        const oldProjection: any = await ProjectionModel.findOne({ skuId: item._id }).session(dbSession).lean().exec();
        if (oldProjection) {
          const replaced = await ProjectionModel.updateOne({ _id: oldProjection._id, projectionRevision: oldProjection.projectionRevision }, { $set: projection }, { session: dbSession }).exec();
          if (replaced.matchedCount !== 1) fail(412, 'STALE_PROJECTION', 'Stock projection vừa thay đổi.');
        } else await ProjectionModel.create([{ ...projection, projectionRevision: projection.ledgerRevision }], { session: dbSession });
        result = { movement: movementDoc, projection, replayed: false };
      });
      return result;
    } catch (error: any) {
      if (error?.code === 11000) {
        const replay = await ItemMovementModel.findOne({ itemId: itemObjectId, idempotencyKey: requestKey }).lean().exec();
        if (replay?.schemaVersion === 3 && replay.v3Effect?.requestHash === requestHash) return { movement: replay, projection: await ProjectionModel.findOne({ skuId: itemObjectId }).lean().exec(), replayed: true };
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được sử dụng.');
      }
      if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message);
      throw error;
    } finally { await dbSession.endSession(); }
  }

  static async stock(itemId: unknown, actor: Actor) {
    const item = actor.role === UserRole.CUSTOMER ? await findCustomerSku(itemId, actor) : await InventoryItemModel.findById(oid(itemId, 'skuId')).exec();
    if (!item) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
    if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) {
      if (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(item.facilityId)) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
    } else if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Vai trò không được phép xem tồn kho.');
    const [projection, movements] = await Promise.all([ProjectionModel.findOne({ skuId: item._id, reservationId: item.managedReservationId, customerId: item.customerId, facilityId: item.facilityId }).lean().exec(), ItemMovementModel.find({ itemId: item._id, schemaVersion: 3 }).sort({ performedAt: 1, _id: 1 }).lean().exec()]);
    const replay = replayManagedInventoryV3(item.toObject(), movements as any[]);
    const projectionShape = (value: any) => JSON.stringify(canonical({ skuId: String(value?.skuId), reservationId: String(value?.reservationId), customerId: String(value?.customerId), facilityId: String(value?.facilityId),
      onHandQuantity: value?.onHandQuantity, heldQuantity: value?.heldQuantity, availableQuantity: value?.availableQuantity,
      totalWeightKg: value?.totalWeightKg, totalVolumeM3: value?.totalVolumeM3, byBatch: value?.byBatch, byPhysicalUnit: value?.byPhysicalUnit,
      byCell: value?.byCell, lastMovementId: value?.lastMovementId, ledgerRevision: value?.ledgerRevision, projectionRevision: value?.projectionRevision }));
    const reconciled = !!projection && projectionShape(projection) === projectionShape(replay);
    return { ...replay, reconciliationStatus: reconciled ? 'RECONCILED' : 'RECONCILIATION_REQUIRED', projectionRevision: projection?.projectionRevision ?? null };
  }

  static async movements(itemId: unknown, actor: Actor) {
    const item = actor.role === UserRole.CUSTOMER ? await findCustomerSku(itemId, actor) : await InventoryItemModel.findById(oid(itemId, 'skuId')).exec();
    if (!item) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
    if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) { if (!actor.assignedFacilityId?.equals(item.facilityId)) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.'); }
    else if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Vai trò không được phép xem lịch sử.');
    return ItemMovementModel.find({ itemId: item._id, schemaVersion: 3 }).sort({ performedAt: -1 }).limit(200).lean().exec();
  }

  static async operation(itemId: unknown, rawKey: unknown, actor: Actor) {
    const item = actor.role === UserRole.CUSTOMER ? await findCustomerSku(itemId, actor) : await InventoryItemModel.findById(oid(itemId, 'skuId')).exec();
    if (!item) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.');
    if (actor.role === UserRole.CUSTOMER) await scopedV3Reservation(item, actor);
    else if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) { if (!actor.assignedFacilityId?.equals(item.facilityId)) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.'); }
    else fail(403, 'ROLE_DENIED', 'Vai trò không được phép xem thao tác.');
    if (typeof rawKey !== 'string' || rawKey.length < 8 || rawKey.length > 128) fail(422, 'INVALID_INPUT', 'Idempotency-Key không hợp lệ.');
    const movement = await ItemMovementModel.findOne({ itemId: item._id, idempotencyKey: rawKey, schemaVersion: 3 }).lean().exec();
    if (!movement) fail(404, 'OPERATION_NOT_FOUND', 'Chưa tìm thấy thao tác đã ghi nhận.');
    return { movement, projection: await ProjectionModel.findOne({ skuId: item._id }).lean().exec(), status: 'COMMITTED' };
  }

  static async facilityOverview(actor: Actor) {
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role) || !actor.assignedFacilityId) fail(403, 'FACILITY_SCOPE_DENIED', 'Cần Staff hoặc Manager được phân công Facility.');
    const items = await InventoryItemModel.find({ facilityId: actor.assignedFacilityId, inventorySchemaVersion: 3, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).limit(200).lean().exec();
    const cellCapacity: any[] = await CellModel.find({ facilityId: actor.assignedFacilityId, deletedAt: { $exists: false } }).select('_id rackId levelNumber maxWeightKg usedWeightKg usedVolumeM3 dimensions operationalStatus').lean().exec();
    const rows = [];
    for (const item of items) {
      const [projection, movementCount, reservation] = await Promise.all([ProjectionModel.findOne({ skuId: item._id, facilityId: actor.assignedFacilityId }).lean().exec(),
        ItemMovementModel.countDocuments({ itemId: item._id, facilityId: actor.assignedFacilityId, schemaVersion: 3 }).exec(),
        ReservationModel.findOne({ _id: item.managedReservationId, facilityId: actor.assignedFacilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY }).select('allocatedCellIds allocatedCapacity usedCapacityM3 inventoryVersion').lean().exec()]);
      const recentMovements = await ItemMovementModel.find({ itemId: item._id, facilityId: actor.assignedFacilityId, schemaVersion: 3 }).sort({ performedAt: -1 }).limit(25).lean().exec();
      let status = 'UNKNOWN', replaySnapshot: any = null;
      if (movementCount <= 5000) {
        const movements = await ItemMovementModel.find({ itemId: item._id, facilityId: actor.assignedFacilityId, schemaVersion: 3 }).sort({ performedAt: 1, _id: 1 }).lean().exec();
        status = 'RECONCILED';
      try {
        const replay = replayManagedInventoryV3(item, movements as any[]); replaySnapshot = replay;
        const comparable = (value: any) => JSON.stringify(canonical({ skuId: String(value?.skuId), reservationId: String(value?.reservationId), customerId: String(value?.customerId), facilityId: String(value?.facilityId),
          onHandQuantity: value?.onHandQuantity, heldQuantity: value?.heldQuantity,
          availableQuantity: value?.availableQuantity, totalWeightKg: value?.totalWeightKg, totalVolumeM3: value?.totalVolumeM3,
          byBatch: value?.byBatch, byPhysicalUnit: value?.byPhysicalUnit, byCell: value?.byCell, lastMovementId: value?.lastMovementId,
          ledgerRevision: value?.ledgerRevision, projectionRevision: value?.projectionRevision }));
        if (!projection || projection.heldQuantity !== 0 || comparable(projection) !== comparable(replay)) status = 'RECONCILIATION_REQUIRED';
      } catch { status = 'RECONCILIATION_REQUIRED'; }
      }
      const allocatedCellIds = (reservation?.allocatedCellIds || []).map(String);
      const capacityReconciliationReasons = ['CELL_COUNTERS_INCLUDE_LEGACY_AND_V3_WRITERS', 'FACILITY_WIDE_LEDGER_BASELINE_NOT_REPLAYED'];
      if (!projection) capacityReconciliationReasons.push('V3_STOCK_PROJECTION_MISSING');
      else if (status !== 'RECONCILED') capacityReconciliationReasons.push('V3_LEDGER_AND_PROJECTION_MISMATCH');
      const allocatedCells: any[] = cellCapacity.filter((cell: any) => allocatedCellIds.includes(String(cell._id)));
      const levelGroups = new Map<string, any>();
      for (const cell of allocatedCells) {
        const key = `${cell.rackId}:${cell.levelNumber}`, group = levelGroups.get(key) ?? { rackId: String(cell.rackId), levelNumber: cell.levelNumber,
          allocatedCellsSharedUsedWeightKg: 0, allocatedCellsV3LedgerWeightKg: 0, cells: [] };
        group.allocatedCellsSharedUsedWeightKg += Number(cell.usedWeightKg);
        const v3Cell = replaySnapshot?.byCell?.find((row: any) => String(row.cellId) === String(cell._id));
        group.allocatedCellsV3LedgerWeightKg += Number(v3Cell?.weightKg ?? 0);
        group.cells.push(String(cell._id)); levelGroups.set(key, group);
      }
      const capacityReconciliationEvidence = {
        v3Ledger: { status: replaySnapshot ? 'REPLAYED_FOR_THIS_SKU' : 'UNKNOWN', ledgerRevision: replaySnapshot?.ledgerRevision ?? null,
          byCell: (replaySnapshot?.byCell ?? []).filter((row: any) => allocatedCellIds.includes(String(row.cellId))) },
        cells: allocatedCells.map((cell: any) => ({ cellId: String(cell._id), rackId: String(cell.rackId), levelNumber: cell.levelNumber,
          sharedCounters: { usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 },
          v3Ledger: replaySnapshot?.byCell?.find((row: any) => String(row.cellId) === String(cell._id)) ?? null,
          status: 'UNKNOWN', missingEvidence: ['Legacy/non-V3 movement replay for this Cell.', 'Writer provenance or a reconciled legacy counter baseline.'] })),
        rackLevels: [...levelGroups.values()].map((group: any) => ({ ...group, status: 'UNKNOWN', missingEvidence: ['Rack/level certified limit and full cross-SKU Cell usage.', 'Legacy and V3 movements for every Cell on this level.'] })),
        reservation: { reservationId: String(reservation?._id ?? item.managedReservationId), usedCapacityM3: reservation?.usedCapacityM3 ?? null,
          allocatedCapacityM3: reservation?.allocatedCapacity ?? null, thisSkuV3LedgerVolumeM3: replaySnapshot?.totalVolumeM3 ?? null,
          inventoryVersion: reservation?.inventoryVersion ?? null, status: 'UNKNOWN',
          missingEvidence: ['All SKU and legacy inventory volumes within the Reservation.', 'Proof that Reservation capacity is not duplicated across item projections.'] },
      };
      rows.push({ item, projection, recentMovements, reconciliationStatus: status,
        capacityReconciliationStatus: 'UNKNOWN', capacityReconciliationReasons,
        capacityReconciliationRequiredEvidence: ['Replay every active legacy and V3 movement once at Facility scope.',
          'Reconcile each Cell counter and Rack/Level load against the combined replay.',
          'Reconcile Reservation used capacity against its non-duplicated stock volume and allocation scope.'],
        capacityReconciliationEvidence, capacity: allocatedCells });
    }
    return { facilityId: String(actor.assignedFacilityId), rows, readOnly: true };
  }
}
