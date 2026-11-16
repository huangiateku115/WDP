import { createHash } from 'node:crypto';

export type RelocationLine = {
  lineId: string;
  itemSpecId: string;
  itemSpecRevision: number;
  sourceCellId?: string;
  destinationCellId?: string;
  sourceReservationId?: string;
  destinationReservationId?: string;
  quantity: number;
  itemInstanceId?: string;
  destinationAllocations?: Array<{ cellId: string; reservationId?: string; weightKg: number; volumeM3: number }>;
};
export type RelocationCandidate = {
  accessSessionId: string; sessionRevision: number; skuRevision: number; lines: RelocationLine[];
  reason?: string; notes?: string; customerAttestation?: string;
};
export class ManagedRelocationDomainError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new ManagedRelocationDomainError(status, code, message); };
const objectId = /^[a-f\d]{24}$/i;
const id = (value: any) => String(value?._id ?? value ?? '');
const same = (left: any, right: any) => id(left) === id(right);
const round = (value: number, places: 3 | 6) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const dimensionsValid = (value: any) => [value?.widthM, value?.depthM, value?.heightM].every((number: any) => typeof number === 'number' && Number.isFinite(number) && number > 0);

export function normalizeRelocation(input: unknown): RelocationCandidate {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, any> : null;
  const allowed = ['accessSessionId', 'sessionRevision', 'skuRevision', 'lines', 'reason', 'notes', 'customerAttestation'];
  if (!body || Object.keys(body).some(key => !allowed.includes(key)) || typeof body.accessSessionId !== 'string' || !objectId.test(body.accessSessionId) ||
      !Number.isSafeInteger(body.sessionRevision) || body.sessionRevision < 0 || !Number.isSafeInteger(body.skuRevision) || body.skuRevision < 0 ||
      !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50) fail(422, 'INVALID_RELOCATION_INPUT', 'Thông tin phiếu chuyển vị trí chưa hợp lệ.');
  const validBody = body as Record<string, any>;
  const lines: RelocationLine[] = validBody.lines.map((line: any, index: number) => {
    const keys = ['lineId', 'itemSpecId', 'itemSpecRevision', 'sourceCellId', 'destinationCellId', 'sourceReservationId', 'destinationReservationId', 'quantity', 'itemInstanceId', 'destinationAllocations'];
    if (!line || typeof line !== 'object' || Array.isArray(line) || Object.keys(line).some(key => !keys.includes(key)) ||
        typeof line.lineId !== 'string' || !/^[\w.-]{1,80}$/.test(line.lineId) || typeof line.itemSpecId !== 'string' || !objectId.test(line.itemSpecId) ||
        !Number.isSafeInteger(line.itemSpecRevision) || line.itemSpecRevision < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      fail(422, 'INVALID_RELOCATION_LINE', `Dòng ${index + 1} chưa hợp lệ.`);
    }
    for (const field of ['sourceReservationId', 'destinationReservationId']) if (line[field] !== undefined && (typeof line[field] !== 'string' || !objectId.test(line[field]))) fail(422, 'INVALID_RELOCATION_LINE', `Dòng ${index + 1}: ${field} không hợp lệ.`);
    if (line.itemInstanceId !== undefined) {
      if (typeof line.itemInstanceId !== 'string' || line.itemInstanceId.length < 1 || line.itemInstanceId.length > 160 || line.quantity !== 1 ||
          line.sourceCellId !== undefined || line.destinationCellId !== undefined || !Array.isArray(line.destinationAllocations) || !line.destinationAllocations.length || line.destinationAllocations.length > 100 ||
          line.destinationAllocations.some((target: any) => !target || typeof target.cellId !== 'string' || !objectId.test(target.cellId) || (target.reservationId !== undefined && (typeof target.reservationId !== 'string' || !objectId.test(target.reservationId))) ||
            ![target.weightKg, target.volumeM3].every((value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0)) ||
          new Set(line.destinationAllocations.map((target: any) => target.cellId)).size !== line.destinationAllocations.length) {
        fail(422, 'INVALID_ITEM_INSTANCE_ALLOCATION', `Dòng ${index + 1}: phải chuyển trọn món và khai báo tải dương cho từng Cell đích.`);
      }
      return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: line.itemSpecRevision, quantity: 1,
        itemInstanceId: line.itemInstanceId, ...(line.sourceReservationId ? { sourceReservationId: line.sourceReservationId } : {}),
        ...(line.destinationReservationId ? { destinationReservationId: line.destinationReservationId } : {}),
        destinationAllocations: line.destinationAllocations.map((target: any) => ({ ...target })) };
    }
    if (line.destinationAllocations !== undefined || typeof line.sourceCellId !== 'string' || !objectId.test(line.sourceCellId) ||
        typeof line.destinationCellId !== 'string' || !objectId.test(line.destinationCellId)) fail(422, 'INVALID_RELOCATION_LINE', `Dòng ${index + 1}: hãy chọn ô nguồn và ô đích hợp lệ.`);
    if (line.sourceCellId === line.destinationCellId) fail(422, 'SOURCE_DESTINATION_SAME', `Dòng ${index + 1}: ô nguồn và ô đích phải khác nhau.`);
    return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: line.itemSpecRevision,
      sourceCellId: line.sourceCellId, destinationCellId: line.destinationCellId,
      ...(line.sourceReservationId ? { sourceReservationId: line.sourceReservationId } : {}), ...(line.destinationReservationId ? { destinationReservationId: line.destinationReservationId } : {}), quantity: line.quantity };
  });
  if (new Set(lines.map(line => line.lineId)).size !== lines.length) fail(422, 'DUPLICATE_RELOCATION_LINE', 'Mã dòng trong phiếu không được trùng.');
  const selectedInstances = lines.filter(line => line.itemInstanceId).map(line => line.itemInstanceId);
  if (new Set(selectedInstances).size !== selectedInstances.length) fail(422, 'DUPLICATE_ITEM_INSTANCE', 'Một món nguyên vẹn chỉ được chuyển một lần trong cùng phiếu.');
  for (const field of ['reason', 'notes', 'customerAttestation'] as const) if (validBody[field] !== undefined &&
      (typeof validBody[field] !== 'string' || validBody[field].length > (field === 'reason' ? 240 : 1000))) fail(422, 'INVALID_RELOCATION_INPUT', `${field} không hợp lệ.`);
  return { accessSessionId: validBody.accessSessionId, sessionRevision: validBody.sessionRevision, skuRevision: validBody.skuRevision, lines,
    ...(validBody.reason ? { reason: validBody.reason.trim() } : {}), ...(validBody.notes ? { notes: validBody.notes.trim() } : {}),
    ...(validBody.customerAttestation ? { customerAttestation: validBody.customerAttestation.trim() } : {}) };
}

function physical(weight: number, volume: number, quantity: number) {
  const weightKg = round(weight * quantity, 3), volumeM3 = round(volume * quantity, 6);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || ![weight, volume, weightKg, volumeM3].every(Number.isFinite) || weightKg <= 0 || volumeM3 <= 0) fail(409, 'STOCK_MEASUREMENT_INVALID', 'Số đo tồn kho không thể tính an toàn.');
  return { weightKg, volumeM3 };
}
const lotKey = (line: any) => `${id(line.reservationId)}:${id(line.itemSpecId)}:${String(line.receiptId)}:${id(line.cellId)}`;
export type RelocationPlan = {
  source: any[]; destination: any[]; lines: any[]; quantity: number; totalWeightKg: number; totalVolumeM3: number;
  cellDeltas: Map<string, any>; sourceCellIds: string[]; destinationCellIds: string[];
};

/** Reservation usage follows placement ownership; an A1 footprint is counted once, not once per Cell. */
export function relocationReservationVolumeDeltas(source: any[], destination: any[], fallbackReservationId: unknown) {
  const deltas = new Map<string, number>();
  const add = (rows: any[], sign: number) => {
    const seenInstances = new Set<string>();
    for (const row of rows) {
      const reservationId = id(row.reservationId ?? fallbackReservationId);
      if (!reservationId) fail(503, 'INVALID_RESERVATION_SCOPE', 'Reservation sở hữu vị trí chưa xác định.');
      if (row.itemInstanceId && seenInstances.has(row.itemInstanceId)) continue;
      if (row.itemInstanceId) seenInstances.add(row.itemInstanceId);
      const volume = Number(row.itemInstanceId ? row.unitVolumeM3Snapshot : row.allocatedVolumeM3);
      if (!Number.isFinite(volume) || volume < 0) fail(503, 'STOCK_MEASUREMENT_INVALID', 'Không thể tính dung lượng Reservation an toàn.');
      deltas.set(reservationId, round((deltas.get(reservationId) ?? 0) + sign * volume, 6));
    }
  };
  add(source, -1); add(destination, 1);
  return deltas;
}

/** Builds deterministic receipt-FIFO MOVE effects; it never writes stock or capacity. */
export function buildRelocationPlan(input: { candidate: RelocationCandidate; sku: any; reservation: any; state: any; specifications: any[]; now?: Date }): RelocationPlan {
  const { candidate, sku, reservation, state, specifications } = input;
  if (Number(sku.managedV3Revision ?? 0) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'Tồn kho vừa thay đổi; hãy tải lại trước khi tiếp tục.');
  const specById = new Map(specifications.map(spec => [id(spec._id), spec]));
  const cells = new Map((state.cells ?? []).map((cell: any) => [id(cell._id), cell]));
  const reservations = new Map((state.reservations ?? [reservation]).map((row: any) => [id(row._id), row]));
  const reservationIdFor = (value: string | undefined) => value ?? id(reservation._id);
  const allocations = new Map<string, Set<string>>((state.reservations ?? [reservation]).map((row: any) => [id(row._id), new Set((row.allocatedCellIds ?? []).map(id))]));
  const lots = (state.replay?.lots ?? []).filter((lot: any) => same(lot.skuId, sku._id));
  const instances = (state.replay?.instances ?? []).filter((instance: any) => same(instance.skuId, sku._id) && instance.status === 'PLACED');
  const movements = [...(state.movements ?? [])].filter((movement: any) => same(movement.itemId, sku._id)).sort((a: any, b: any) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime() || id(a._id).localeCompare(id(b._id)));
  const receiptOrder = new Map<string, { at: number; movementId: string }>();
  for (const movement of movements) if (movement.stockEffect?.action === 'ADD') for (const line of movement.stockEffect.destination ?? []) {
    if (!receiptOrder.has(line.receiptId)) receiptOrder.set(line.receiptId, { at: new Date(movement.performedAt).getTime(), movementId: id(movement._id) });
  }
  const source: any[] = [], destination: any[] = [], logicalLines: any[] = [];
  const cellDeltas = new Map<string, any>();
  const delta = (cellId: any, weightKg: number, volumeM3: number) => {
    const key = id(cellId), current = cellDeltas.get(key) ?? { weightKg: 0, volumeM3: 0 };
    current.weightKg = round(current.weightKg + weightKg, 3); current.volumeM3 = round(current.volumeM3 + volumeM3, 6); cellDeltas.set(key, current);
  };
  const remaining = new Map(lots.map((lot: any) => [lotKey(lot), lot.quantityOnHand]));
  const sourceQuantityByLot = new Map<string, number>();
  let quantity = 0, totalWeightKg = 0, totalVolumeM3 = 0;
  for (const line of candidate.lines) {
    const spec = specById.get(line.itemSpecId);
    if (!spec || !same(spec.skuId, sku._id) || !same(spec.customerId, sku.customerId) ||
        !same(spec.facilityId, sku.facilityId) || spec.status !== 'ACTIVE' || spec.revision !== line.itemSpecRevision) fail(409, 'ITEM_SPECIFICATION_STALE', 'Một loại hàng đã thay đổi hoặc không còn hoạt động. Hãy tải lại.');
    let lineWeight = 0, lineVolume = 0;
    if (line.itemInstanceId) {
      const instance = instances.find((row: any) => row.itemInstanceId === line.itemInstanceId && same(row.itemSpecId, spec._id));
      if (!instance || instance.quantity !== 1 || !Array.isArray(instance.allocations) || !instance.allocations.length) fail(409, 'ITEM_INSTANCE_NOT_AVAILABLE', 'Món nguyên vẹn không còn trong kho.');
      if (line.sourceReservationId && !same(instance.reservationId, line.sourceReservationId)) fail(409, 'ITEM_INSTANCE_SOURCE_MISMATCH', 'Món nguyên vẹn không thuộc Reservation nguồn đã chọn.');
      const oldAllocations = [...instance.allocations].sort((a: any, b: any) => id(a.cellId).localeCompare(id(b.cellId)));
      const newAllocations = [...(line.destinationAllocations ?? [])].sort((a, b) => a.cellId.localeCompare(b.cellId));
      const destinationReservationIds = new Set(newAllocations.map(row => id(row.reservationId ?? line.destinationReservationId ?? reservation._id)));
      if (destinationReservationIds.size !== 1 || !reservations.has([...destinationReservationIds][0]!)) fail(409, 'INVALID_RESERVATION_SCOPE', 'Một món nguyên vẹn phải chuyển vào đúng một Reservation hợp lệ.');
      if (!dimensionsValid(instance.unitDimensionsSnapshot) || !Number.isFinite(instance.unitWeightKgSnapshot) || !Number.isFinite(instance.unitVolumeM3Snapshot) ||
          oldAllocations.some((row: any) => !allocations.get(id(instance.reservationId))?.has(id(row.cellId)) || !Number.isFinite(row.weightKg) || row.weightKg <= 0 || !Number.isFinite(row.volumeM3) || row.volumeM3 <= 0)) fail(503, 'ITEM_INSTANCE_RECONCILIATION_UNKNOWN', 'Không thể xác minh toàn bộ vị trí và tải của món nguyên vẹn.');
      if (round(oldAllocations.reduce((sum: number, row: any) => sum + row.weightKg, 0), 3) !== round(instance.unitWeightKgSnapshot, 3) ||
          round(oldAllocations.reduce((sum: number, row: any) => sum + row.volumeM3, 0), 6) !== round(instance.unitVolumeM3Snapshot, 6) ||
          round(newAllocations.reduce((sum, row) => sum + row.weightKg, 0), 3) !== round(instance.unitWeightKgSnapshot, 3) ||
          round(newAllocations.reduce((sum, row) => sum + row.volumeM3, 0), 6) !== round(instance.unitVolumeM3Snapshot, 6)) fail(422, 'ITEM_INSTANCE_LOAD_NOT_CONSERVED', 'Phân bổ mới phải giữ nguyên chính xác toàn bộ khối lượng và thể tích của món.');
      if (newAllocations.some(row => !cells.has(row.cellId) || !allocations.get(id(row.reservationId ?? line.destinationReservationId ?? reservation._id))?.has(row.cellId))) fail(409, 'CELL_NOT_ALLOCATED', 'Ô đích của món nguyên vẹn không thuộc đơn thuê đích.');
      const unchanged = oldAllocations.length === newAllocations.length && oldAllocations.every((old: any, index: number) => id(old.cellId) === newAllocations[index]?.cellId && old.weightKg === newAllocations[index]?.weightKg && old.volumeM3 === newAllocations[index]?.volumeM3);
      if (unchanged) fail(422, 'RELOCATION_HAS_NO_EFFECT', 'Vị trí phân bổ của món này chưa thay đổi.');
      for (const allocation of oldAllocations) {
        source.push({ lineId: line.lineId, reservationId: instance.reservationId, itemSpecId: spec._id, receiptId: instance.sourceReceiptId, itemInstanceId: instance.itemInstanceId,
          cellId: allocation.cellId, quantity: 1, quantityUnitSnapshot: spec.quantityUnitName ?? 'đơn vị', unitWeightKgSnapshot: instance.unitWeightKgSnapshot,
          unitVolumeM3Snapshot: instance.unitVolumeM3Snapshot, unitDimensionsSnapshot: instance.unitDimensionsSnapshot,
          allocatedWeightKg: allocation.weightKg, allocatedVolumeM3: allocation.volumeM3 });
        delta(allocation.cellId, -allocation.weightKg, -allocation.volumeM3); lineWeight += allocation.weightKg; lineVolume += allocation.volumeM3;
      }
      for (const allocation of newAllocations) {
        destination.push({ lineId: line.lineId, reservationId: allocation.reservationId ?? line.destinationReservationId ?? reservation._id, itemSpecId: spec._id, receiptId: instance.sourceReceiptId, itemInstanceId: instance.itemInstanceId,
          cellId: allocation.cellId, quantity: 1, quantityUnitSnapshot: spec.quantityUnitName ?? 'đơn vị', unitWeightKgSnapshot: instance.unitWeightKgSnapshot,
          unitVolumeM3Snapshot: instance.unitVolumeM3Snapshot, unitDimensionsSnapshot: instance.unitDimensionsSnapshot,
          allocatedWeightKg: allocation.weightKg, allocatedVolumeM3: allocation.volumeM3 });
        delta(allocation.cellId, allocation.weightKg, allocation.volumeM3);
      }
      lineWeight = instance.unitWeightKgSnapshot; lineVolume = instance.unitVolumeM3Snapshot;
    } else {
      const sourceCell = cells.get(line.sourceCellId!); const destinationCell = cells.get(line.destinationCellId!);
      const sourceReservationId = reservationIdFor(line.sourceReservationId), destinationReservationId = reservationIdFor(line.destinationReservationId);
      if (!reservations.has(sourceReservationId) || !reservations.has(destinationReservationId) || !allocations.get(sourceReservationId)?.has(line.sourceCellId!) || !allocations.get(destinationReservationId)?.has(line.destinationCellId!) || !sourceCell || !destinationCell) fail(409, 'CELL_NOT_ALLOCATED', 'Ô nguồn và ô đích phải thuộc các Reservation hợp lệ.');
      const candidates = lots.filter((lot: any) => same(lot.itemSpecId, spec._id) && id(lot.reservationId) === sourceReservationId && id(lot.cellId) === line.sourceCellId)
        .sort((a: any, b: any) => { const ao = receiptOrder.get(a.receiptId) ?? { at: Number.MAX_SAFE_INTEGER, movementId: '' }, bo = receiptOrder.get(b.receiptId) ?? { at: Number.MAX_SAFE_INTEGER, movementId: '' }; return ao.at - bo.at || ao.movementId.localeCompare(bo.movementId) || String(a.receiptId).localeCompare(String(b.receiptId)); });
      let needed = line.quantity;
      for (const lot of candidates) {
        const lotId = lotKey(lot), current = Number(remaining.get(lotId) ?? 0);
        if (current < 1) continue;
        if (!Number.isSafeInteger(lot.quantityHeld) || lot.quantityHeld !== 0) fail(409, 'STOCK_HELD', 'Không thể chuyển loại hàng đang có số lượng được giữ cho thao tác khác.');
        const take = Math.min(needed, current); if (take < 1) continue;
        const amounts = physical(Number(lot.unitWeightKgSnapshot), Number(lot.unitVolumeM3Snapshot), take);
        const before = current;
        source.push({ lineId: line.lineId, reservationId: sourceReservationId, itemSpecId: lot.itemSpecId, receiptId: lot.receiptId, cellId: lot.cellId, quantity: take,
          quantityUnitSnapshot: lot.quantityUnitSnapshot ?? spec.quantityUnitName ?? 'đơn vị', unitWeightKgSnapshot: lot.unitWeightKgSnapshot,
          unitVolumeM3Snapshot: lot.unitVolumeM3Snapshot, unitDimensionsSnapshot: lot.unitDimensionsSnapshot,
          allocatedWeightKg: amounts.weightKg, allocatedVolumeM3: amounts.volumeM3, quantityBefore: before, quantityAfter: before - take });
        destination.push({ lineId: line.lineId, reservationId: destinationReservationId, itemSpecId: lot.itemSpecId, receiptId: lot.receiptId, cellId: line.destinationCellId,
          quantity: take, quantityUnitSnapshot: lot.quantityUnitSnapshot ?? spec.quantityUnitName ?? 'đơn vị', unitWeightKgSnapshot: lot.unitWeightKgSnapshot,
          unitVolumeM3Snapshot: lot.unitVolumeM3Snapshot, unitDimensionsSnapshot: lot.unitDimensionsSnapshot,
          allocatedWeightKg: amounts.weightKg, allocatedVolumeM3: amounts.volumeM3 });
        delta(line.sourceCellId, -amounts.weightKg, -amounts.volumeM3); delta(line.destinationCellId, amounts.weightKg, amounts.volumeM3);
        needed -= take; remaining.set(lotId, before - take); lineWeight = round(lineWeight + amounts.weightKg, 3); lineVolume = round(lineVolume + amounts.volumeM3, 6);
        sourceQuantityByLot.set(lotId, (sourceQuantityByLot.get(lotId) ?? 0) + take);
        if (!needed) break;
      }
      if (needed) fail(409, 'SOURCE_QUANTITY_UNAVAILABLE', 'Tồn khả dụng tại ô nguồn không đủ số lượng yêu cầu.');
    }
    quantity += line.quantity; totalWeightKg = round(totalWeightKg + lineWeight, 3); totalVolumeM3 = round(totalVolumeM3 + lineVolume, 6);
    logicalLines.push({ lineId: line.lineId, itemSpecId: spec._id, itemSpecCode: spec.code, itemSpecName: spec.name, quantity: line.quantity,
      sourceCellIds: line.itemInstanceId ? [...new Set(source.filter(row => row.lineId === line.lineId).map(row => id(row.cellId)))].sort() : [line.sourceCellId],
      destinationCellIds: line.itemInstanceId ? line.destinationAllocations!.map(row => row.cellId) : [line.destinationCellId], weightKg: lineWeight, volumeM3: lineVolume, itemInstanceId: line.itemInstanceId });
  }
  const quantityOnHandByLot = new Map<string, number>(lots.map((lot: any) => [lotKey(lot), Number(lot.quantityOnHand)]));
  const destinationQuantityByLot = new Map<string, number>();
  for (const line of destination.filter((row: any) => !row.itemInstanceId)) {
    const key = lotKey(line), sourceRemoved = sourceQuantityByLot.get(key) ?? 0;
    const before = destinationQuantityByLot.has(key) ? destinationQuantityByLot.get(key)! : (quantityOnHandByLot.get(key) ?? 0) - sourceRemoved;
    if (!Number.isSafeInteger(before) || before < 0) fail(503, 'STOCK_RECONCILIATION_UNKNOWN', 'Không thể xác minh tồn tại ô đích trước khi chuyển.');
    line.quantityBefore = before; line.quantityAfter = before + line.quantity;
    if (!Number.isSafeInteger(line.quantityAfter)) fail(422, 'RELOCATION_TOTAL_INVALID', 'Số lượng tại ô đích vượt giới hạn an toàn.');
    destinationQuantityByLot.set(key, line.quantityAfter);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || ![totalWeightKg, totalVolumeM3].every(Number.isFinite)) fail(422, 'RELOCATION_TOTAL_INVALID', 'Không thể tính an toàn tổng phiếu chuyển.');
  const sourceReservationIds = new Set(source.map((row: any) => id(row.reservationId ?? reservation._id)));
  const destinationReservationIds = new Set(destination.map((row: any) => id(row.reservationId ?? reservation._id)));
  if (sourceReservationIds.size !== 1 || destinationReservationIds.size !== 1) fail(422, 'INVALID_RESERVATION_SCOPE', 'Mỗi phiếu chuyển chỉ được chuyển giữa một Reservation nguồn và một Reservation đích.');
  const sourceCellIds = [...new Set(source.map(row => id(row.cellId)))].sort(), destinationCellIds = [...new Set(destination.map(row => id(row.cellId)))].sort();
  // A multi-line MOVE can have zero net weight/volume delta per Cell while still
  // changing receipt or Item Specification placement. Each line is already
  // required to move to a different Cell (or change an Item Instance footprint),
  // so capacity deltas must not be used to decide whether the stock operation is a no-op.
  for (const cellId of new Set([...sourceCellIds, ...destinationCellIds])) {
    const cell: any = cells.get(cellId), effect = cellDeltas.get(cellId)!;
    if (!cell || cell.operationalStatus !== 'AVAILABLE' || ![cell.maxWeightKg, cell.usedWeightKg, cell.usedVolumeM3, cell.dimensions?.widthM, cell.dimensions?.depthM, cell.dimensions?.usableHeightM].every((value: any) => typeof value === 'number' && Number.isFinite(value)) ||
        cell.maxWeightKg <= 0 || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0 || cell.dimensions.widthM <= 0 || cell.dimensions.depthM <= 0 || cell.dimensions.usableHeightM <= 0) fail(503, 'CELL_CAPACITY_UNKNOWN', `Chưa thể xác minh sức chứa Cell ${cell?.code ?? cellId}.`);
    const afterWeight = round(cell.usedWeightKg + effect.weightKg, 3), afterVolume = round(cell.usedVolumeM3 + effect.volumeM3, 6);
    const maxVolume = round(cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM, 6);
    if (!Number.isFinite(afterWeight) || !Number.isFinite(afterVolume) || afterWeight < -0.001 || afterVolume < -0.000001) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Counter Cell ${cell.code} không khớp với số tồn.`);
    if (afterWeight > cell.maxWeightKg + 0.001) fail(409, 'CELL_WEIGHT_CAPACITY_EXCEEDED', `Ô đích ${cell.code} không đủ tải trọng.`);
    if (afterVolume > maxVolume + 0.000001) fail(409, 'CELL_VOLUME_CAPACITY_EXCEEDED', `Ô đích ${cell.code} không đủ thể tích.`);
    effect.weightAfterKg = Math.max(0, afterWeight); effect.volumeAfterM3 = Math.max(0, afterVolume); effect.maxVolumeM3 = maxVolume;
  }
  return { source, destination, lines: logicalLines, quantity, totalWeightKg, totalVolumeM3, cellDeltas,
    sourceCellIds, destinationCellIds };
}

export function validateRelocationLevels(plan: RelocationPlan, cells: any[], racks: any[]) {
  const cellById = new Map(cells.map(cell => [id(cell._id), cell])), rackById = new Map(racks.map(rack => [id(rack._id), rack]));
  const affected = new Map<string, { rackId: string; levelNumber: number; weightDelta: number; volumeDelta: number; weightBefore: number; volumeBefore: number; maxVolume: number }>();
  for (const cell of cells) {
    const rackId = id(cell.rackId), levelNumber = Number(cell.levelNumber), rack = rackById.get(rackId);
    if (!rack || rack.operationalStatus !== 'AVAILABLE' || !Number.isSafeInteger(levelNumber) || levelNumber < 1) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Không thể xác minh Rack/Level khả dụng của Cell.');
    const key = `${rackId}:${levelNumber}`, current = affected.get(key) ?? { rackId, levelNumber, weightDelta: 0, volumeDelta: 0, weightBefore: 0, volumeBefore: 0, maxVolume: 0 };
    current.weightBefore = round(current.weightBefore + Number(cell.usedWeightKg), 3); current.volumeBefore = round(current.volumeBefore + Number(cell.usedVolumeM3), 6);
    const cellVolume = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
    if (!Number.isFinite(cellVolume) || cellVolume <= 0) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Thiếu kích thước sử dụng để xác minh sức chứa Level.');
    current.maxVolume = round(current.maxVolume + cellVolume, 6);
    const delta = plan.cellDeltas.get(id(cell._id)); if (delta) { current.weightDelta = round(current.weightDelta + delta.weightKg, 3); current.volumeDelta = round(current.volumeDelta + delta.volumeM3, 6); }
    affected.set(key, current);
  }
  const result: any[] = [];
  for (const row of affected.values()) {
    const rack: any = rackById.get(row.rackId), afterWeight = round(row.weightBefore + row.weightDelta, 3), afterVolume = round(row.volumeBefore + row.volumeDelta, 6);
    if (!Number.isFinite(Number(rack.maxWeightKgPerLevel)) || Number(rack.maxWeightKgPerLevel) <= 0 || !Number.isFinite(afterWeight) || !Number.isFinite(afterVolume)) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Thiếu giới hạn tải trọng Rack/Level.');
    if (afterWeight > Number(rack.maxWeightKgPerLevel) + 0.001) fail(409, 'LEVEL_WEIGHT_CAPACITY_EXCEEDED', `Level ${row.levelNumber} không đủ tải trọng.`);
    if (afterVolume > row.maxVolume + 0.000001) fail(409, 'LEVEL_VOLUME_CAPACITY_EXCEEDED', `Level ${row.levelNumber} không đủ thể tích khả dụng.`);
    result.push({ rackId: row.rackId, levelNumber: row.levelNumber, usedWeightBeforeKg: row.weightBefore, usedWeightAfterKg: afterWeight,
      usedVolumeBeforeM3: row.volumeBefore, usedVolumeAfterM3: afterVolume, maxWeightKg: rack.maxWeightKgPerLevel, maxVolumeM3: row.maxVolume });
  }
  return result;
}

export function relocationRequestHash(candidate: RelocationCandidate) { return createHash('sha256').update(JSON.stringify(candidate)).digest('hex'); }
