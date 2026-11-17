import { Document, Model, PipelineStage, Types } from 'mongoose';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import MaintenanceTicketModel from '../../models/maintenance-tickets/maintenance-ticket.model';
import InspectionModel from '../../models/inspections/inspection.model';
import SupportRequestModel from '../../models/support-requests/support-request.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import { FacilityServiceType } from '../../types/facility.type';
import { MovementBatchAction } from '../../types/item-movement.type';
import { InspectionStatus, InspectionType } from '../../types/inspection.type';
import { MaintenanceStatus } from '../../types/maintenance-ticket.type';
import { PaymentApplicationStatus, PaymentPurpose, PaymentProvider, PaymentStatus } from '../../types/payment.type';
import { SupportStatus } from '../../types/support-request.type';
import { StatisticsQuery, StatisticsQueryError, STATISTICS_TIME_ZONE } from './statistics.validation';
import { StatisticsScope, StatisticsService, verifiedCapturePipeline } from './statistics.service';
import { StatisticsPhase2Service } from './statistics-phase2.service';

type Row = Record<string, any>;
const LIVE = { deletedAt: { $exists: false } };
const ACTIONS = Object.values(MovementBatchAction);

function runAggregate<T extends Document>(model: Model<T>, pipeline: PipelineStage[]): Promise<Row[]> {
  return model.aggregate<Row>(pipeline).option({ maxTimeMS: 15_000, allowDiskUse: true }).exec();
}
function n(row: Row | undefined, key: string): number { const value = row?.[key]; return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function id(value: unknown): string { return value == null ? '' : String(value); }
function round(value: number, digits = 2): number { const scale = 10 ** digits; return Math.round((value + Number.EPSILON) * scale) / scale; }
function pct(numerator: number, denominator: number): number | null { return denominator > 0 ? round(numerator / denominator * 100) : null; }
function scopeMatch(scope: StatisticsScope, field = 'facilityId'): Row { return scope.type === 'FACILITY' ? { [field]: scope.facilityId } : {}; }
function timeMeta(query: StatisticsQuery, scope: StatisticsScope, generatedAt: Date, timeBasis: Row, completeness: Row = {}, limitations: string[] = []) {
  return { facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() },
    timezone: STATISTICS_TIME_ZONE, fromDate: query.from.toISOString(), toDateExclusive: query.toExclusive.toISOString(),
    timeBasis, generatedAt: generatedAt.toISOString(), dataCompleteness: completeness, limitations };
}
export function resolvePaymentStatus(status: PaymentStatus | undefined): PaymentStatus | undefined {
  if (status === undefined) return undefined;
  if (!(Object.values(PaymentStatus) as string[]).includes(status)) throw new StatisticsQueryError(400, 'INVALID_PAYMENT_STATUS', 'paymentStatus is not supported');
  return status;
}
export function validateFinancialPaymentStatus(status: PaymentStatus | undefined): void {
  const resolved = resolvePaymentStatus(status);
  if (resolved !== undefined && resolved !== PaymentStatus.SUCCEEDED) throw new StatisticsQueryError(400, 'UNSUPPORTED_FINANCIAL_STATUS', 'Financial Analytics reports verified successful captures only; paymentStatus must be SUCCEEDED when specified');
}
export function buildPaymentIntentMatch(query: StatisticsQuery, scope: StatisticsScope): Row {
  const status = resolvePaymentStatus(query.paymentStatus);
  return { provider: PaymentProvider.PAYOS, currency: 'VND', createdAt: { $gte: query.from, $lt: query.toExclusive }, ...scopeMatch(scope),
    ...(query.serviceType ? { serviceType: query.serviceType } : {}), ...(status ? { status } : {}) };
}
function dateTrunc(field: string, granularity: 'day' | 'week' | 'month') {
  return { $dateTrunc: { date: field, unit: granularity, ...(granularity === 'week' ? { startOfWeek: 'monday' } : {}), timezone: STATISTICS_TIME_ZONE } };
}
function uniqueMap(input: unknown, as: string, expression: unknown): Row { return { $setUnion: [{ $map: { input, as, in: expression } }] }; }
function filterLines(input: string, as: string, cond: unknown): Row { return { $filter: { input, as, cond } }; }
function pageRows<T>(rows: T[], query: StatisticsQuery) {
  const start = (query.page - 1) * query.limit;
  return { items: rows.slice(start, start + query.limit), page: query.page, limit: query.limit, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) };
}
function effectLineValid(line: string): Row {
  const ref = (field: string) => `$$${line}.${field}`;
  const positiveNumber = (field: string) => ({ $and: [{ $isNumber: ref(field) }, { $gt: [ref(field), 0] }] });
  return { $and: [
    { $eq: [{ $type: ref('itemSpecId') }, 'objectId'] }, { $eq: [{ $type: ref('cellId') }, 'objectId'] },
    { $cond: [{ $eq: [{ $type: ref('receiptId') }, 'string'] }, { $gt: [{ $strLenCP: ref('receiptId') }, 0] }, false] },
    { $cond: [{ $isNumber: ref('quantity') }, { $and: [{ $eq: [ref('quantity'), { $trunc: ref('quantity') }] }, { $gt: [ref('quantity'), 0] }] }, false] },
    positiveNumber('allocatedWeightKg'), positiveNumber('allocatedVolumeM3'),
    { $or: [
      { $in: [{ $type: ref('itemInstanceId') }, ['missing', 'null']] },
      { $and: [ { $eq: [{ $type: ref('itemInstanceId') }, 'string'] }, { $cond: [{ $eq: [{ $type: ref('itemInstanceId') }, 'string'] }, { $gt: [{ $strLenCP: ref('itemInstanceId') }, 0] }, false] }, { $eq: [ref('quantity'), 1] } ] },
    ] },
  ] };
}
function lineReservationFilter(query: StatisticsQuery, line: string): Row {
  const conditions: Row[] = [];
  if (query.reservationId) conditions.push({ $eq: [{ $ifNull: [`$$${line}.reservationId`, '$managedReservationId'] }, query.reservationId] });
  return conditions.length ? { $and: conditions } : { $literal: true };
}
function lineSpecFilter(query: StatisticsQuery, line: string): Row {
  return query.itemSpecId ? { $eq: [`$$${line}.itemSpecId`, query.itemSpecId] } : { $literal: true };
}
function lineInstanceValid(line: string): Row {
  const type = { $type: `$$${line}.itemInstanceId` };
  return { $or: [
    { $in: [type, ['missing', 'null']] },
    { $and: [ { $eq: [type, 'string'] }, { $cond: [{ $eq: [type, 'string'] }, { $gt: [{ $strLenCP: `$$${line}.itemInstanceId` }, 0] }, false] }, { $eq: [`$$${line}.quantity`, 1] } ] },
  ] };
}

/** Valid schema-v4 ledger movements only. Lines on a MOVE contribute once from source. */
export function buildManagedMovementPipeline(query: StatisticsQuery, scope: StatisticsScope): PipelineStage[] {
  const match: Row = { schemaVersion: 4, 'stockEffect.action': { $in: ACTIONS }, performedAt: { $gte: query.from, $lt: query.toExclusive },
    ...scopeMatch(scope), ...(query.action ? { 'stockEffect.action': query.action } : {}), ...(query.skuId ? { itemId: query.skuId } : {}),
    ...(query.serviceType === FacilityServiceType.SELF_STORAGE ? { _id: null } : {}) };
  const sumField = (input: string, field: string): Row => ({ $sum: { $map: { input, as: 'line', in: `$$line.${field}` } } });
  const batchQuantity = (input: string): Row => ({ $sum: { $map: { input: filterLines(input, 'line', { $in: [{ $type: '$$line.itemInstanceId' }, ['missing', 'null']] }), as: 'line', in: '$$line.quantity' } } });
  const instanceCount = (input: string): Row => ({ $size: uniqueMap(filterLines(input, 'line', { $not: [{ $in: [{ $type: '$$line.itemInstanceId' }, ['missing', 'null']] }] }), 'line', '$$line.itemInstanceId') });
  return [
    { $match: match },
    { $set: { _source: { $ifNull: ['$stockEffect.source', []] }, _destination: { $ifNull: ['$stockEffect.destination', []] } } },
    { $set: {
      _validSource: { $filter: { input: '$_source', as: 'line', cond: { $and: [effectLineValid('line'), lineInstanceValid('line')] } } },
      _validDestination: { $filter: { input: '$_destination', as: 'line', cond: { $and: [effectLineValid('line'), lineInstanceValid('line')] } } },
    } },
    { $match: { $expr: { $and: [
      { $eq: ['$operationId', '$stockEffect.operationId'] }, { $eq: [{ $type: '$stockEffect.operationId' }, 'string'] },
      { $cond: [{ $eq: [{ $type: '$stockEffect.operationId' }, 'string'] }, { $gt: [{ $strLenCP: '$stockEffect.operationId' }, 0] }, false] },
      { $eq: [{ $size: '$_source' }, { $size: '$_validSource' }] }, { $eq: [{ $size: '$_destination' }, { $size: '$_validDestination' }] },
      { $or: [
        { $and: [{ $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, { $eq: [{ $size: '$_source' }, 0] }, { $gt: [{ $size: '$_destination' }, 0] }] },
        { $and: [{ $eq: ['$stockEffect.action', MovementBatchAction.REMOVE] }, { $gt: [{ $size: '$_source' }, 0] }, { $eq: [{ $size: '$_destination' }, 0] }] },
        { $and: [{ $eq: ['$stockEffect.action', MovementBatchAction.MOVE] }, { $gt: [{ $size: '$_source' }, 0] }, { $gt: [{ $size: '$_destination' }, 0] }] },
      ] },
    ] } } },
    { $set: {
      _sourceFiltered: { $filter: { input: '$_validSource', as: 'line', cond: lineReservationFilter(query, 'line') } },
      _destinationFiltered: { $filter: { input: '$_validDestination', as: 'line', cond: lineReservationFilter(query, 'line') } },
    } },
    { $set: {
      _sourceSpecFiltered: { $filter: { input: '$_sourceFiltered', as: 'line', cond: lineSpecFilter(query, 'line') } },
      _destinationSpecFiltered: { $filter: { input: '$_destinationFiltered', as: 'line', cond: lineSpecFilter(query, 'line') } },
    } },
    { $set: { _eventLines: { $switch: { branches: [
      { case: { $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, then: '$_destinationSpecFiltered' },
      { case: { $eq: ['$stockEffect.action', MovementBatchAction.REMOVE] }, then: '$_sourceSpecFiltered' },
      { case: { $and: [ { $eq: ['$stockEffect.action', MovementBatchAction.MOVE] }, { $gt: [{ $size: '$_sourceSpecFiltered' }, 0] } ] }, then: '$_sourceSpecFiltered' },
    ], default: '$_destinationSpecFiltered' } } } },
    { $match: { $expr: { $gt: [{ $size: '$_eventLines' }, 0] } } },
    { $set: { _sourceQuantity: { $add: [batchQuantity("$_validSource"), instanceCount("$_validSource")] },
      _destinationQuantity: { $add: [batchQuantity("$_validDestination"), instanceCount("$_validDestination")] },
      _sourceWeight: sumField("$_validSource", "allocatedWeightKg"), _destinationWeight: sumField("$_validDestination", "allocatedWeightKg"),
      _sourceVolume: sumField("$_validSource", "allocatedVolumeM3"), _destinationVolume: sumField("$_validDestination", "allocatedVolumeM3") } },
    { $set: { _ledgerQuantity: { $cond: [{ $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, '$_destinationQuantity', '$_sourceQuantity'] } } },
    { $match: { $expr: { $and: [
      { $eq: ['$quantity', '$_ledgerQuantity'] },
      { $lte: [{ $abs: { $subtract: ['$actualTotalWeightKg', { $cond: [{ $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, '$_destinationWeight', '$_sourceWeight'] }] } }, 0.001] },
      { $lte: [{ $abs: { $subtract: ['$actualTotalVolumeM3', { $cond: [{ $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, '$_destinationVolume', '$_sourceVolume'] }] } }, 0.000001] },
      { $or: [ { $ne: ['$stockEffect.action', MovementBatchAction.MOVE] }, { $and: [
        { $eq: ['$_sourceQuantity', '$_destinationQuantity'] }, { $lte: [{ $abs: { $subtract: ['$_sourceWeight', '$_destinationWeight'] } }, 0.001] },
        { $lte: [{ $abs: { $subtract: ['$_sourceVolume', '$_destinationVolume'] } }, 0.000001] },
      ] } ] },
    ] } } },
    { $set: { _instanceIds: uniqueMap(filterLines('$_eventLines', 'line', { $not: [{ $in: [{ $type: '$$line.itemInstanceId' }, ['missing', 'null']] }] }), 'line', '$$line.itemInstanceId'),
      _batchQuantity: { $sum: { $map: { input: '$_eventLines', as: 'line', in: { $cond: [{ $in: [{ $type: '$$line.itemInstanceId' }, ['missing', 'null']] }, '$$line.quantity', 0] } } } },
      _weight: { $sum: { $map: { input: '$_eventLines', as: 'line', in: '$$line.allocatedWeightKg' } } },
      _volume: { $sum: { $map: { input: '$_eventLines', as: 'line', in: '$$line.allocatedVolumeM3' } } },
      _units: uniqueMap('$_eventLines', 'line', { $ifNull: ['$$line.quantityUnitSnapshot', 'UNKNOWN'] }),
    } },
    { $set: { _quantity: { $add: ['$_batchQuantity', { $size: '$_instanceIds' }] }, _receiptIds: uniqueMap('$_eventLines', 'line', '$$line.receiptId'),
      _relocationScope: { $cond: [{ $ne: ['$stockEffect.action', MovementBatchAction.MOVE] }, null, { $let: {
        vars: { src: uniqueMap('$_validSource', 'line', { $toString: { $ifNull: ['$$line.reservationId', '$managedReservationId'] } }),
          dst: uniqueMap('$_validDestination', 'line', { $toString: { $ifNull: ['$$line.reservationId', '$managedReservationId'] } }),
          srcCells: uniqueMap('$_validSource', 'line', { $toString: '$$line.cellId' }),
          dstCells: uniqueMap('$_validDestination', 'line', { $toString: '$$line.cellId' }),
        }, in: { $switch: { branches: [
          { case: { $ne: [{ $first: '$$src' }, { $first: '$$dst' }] }, then: 'CROSS_RESERVATION' },
          { case: { $not: [{ $setEquals: ['$$srcCells', '$$dstCells'] }] }, then: 'WITHIN_RESERVATION' },
        ], default: 'UNKNOWN' } } } }] },
    } },
    { $sort: { performedAt: 1, _id: 1 } },
    // An idempotent replay returns the committed movement; operationId is the count identity.
    { $group: { _id: { facilityId: '$facilityId', action: '$stockEffect.action', operationId: '$stockEffect.operationId' }, movement: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$movement' } },
  ];
}

function jsLineValid(line: Row): boolean {
  return !!line && line.itemSpecId != null && line.cellId != null && typeof line.receiptId === 'string' && !!line.receiptId &&
    Number.isSafeInteger(line.quantity) && line.quantity > 0 && Number.isFinite(line.allocatedWeightKg) && line.allocatedWeightKg > 0 &&
    Number.isFinite(line.allocatedVolumeM3) && line.allocatedVolumeM3 > 0 &&
    (line.itemInstanceId == null || (typeof line.itemInstanceId === 'string' && line.itemInstanceId.length > 0 && line.quantity === 1));
}
function sideQuantity(lines: Row[], reservationId?: string, rootReservationId?: string): number {
  const selected = lines.filter(line => !reservationId || id(line.reservationId ?? rootReservationId) === reservationId);
  return selected.reduce((sum, line) => sum + (line.itemInstanceId ? 0 : line.quantity), 0) + new Set(selected.filter(line => line.itemInstanceId).map(line => line.itemInstanceId)).size;
}

/** Pure fixture reducer mirrors the V4 counting contract for offline regression tests. */
export function summarizeManagedMovementFixtures(rows: Row[], query: Partial<StatisticsQuery> = {}) {
  const start = query.from?.getTime() ?? -Infinity, end = query.toExclusive?.getTime() ?? Infinity;
  const scopeId = query.facilityId?.toString();
  const grouped = new Map<string, Row>();
  for (const movement of rows) {
    const effect = movement.stockEffect;
    if (movement.schemaVersion !== 4 || !effect || !ACTIONS.includes(effect.action) || !effect.operationId || movement.operationId !== effect.operationId ||
      !(movement.performedAt instanceof Date) || movement.performedAt.getTime() < start || movement.performedAt.getTime() >= end ||
      scopeId && id(movement.facilityId) !== scopeId || query.action && effect.action !== query.action || query.skuId && id(movement.itemId) !== query.skuId.toString()) continue;
    const source = effect.source ?? [], destination = effect.destination ?? [];
    if (!source.every(jsLineValid) || !destination.every(jsLineValid) ||
      effect.action === 'ADD' && (source.length || !destination.length) || effect.action === 'REMOVE' && (!source.length || destination.length) ||
      effect.action === 'MOVE' && (!source.length || !destination.length)) continue;
    const ledgerLines: Row[] = effect.action === 'ADD' ? destination : source;
    const sourceWeight = source.reduce((sum: number, line: Row) => sum + line.allocatedWeightKg, 0);
    const destinationWeight = destination.reduce((sum: number, line: Row) => sum + line.allocatedWeightKg, 0);
    const sourceVolume = source.reduce((sum: number, line: Row) => sum + line.allocatedVolumeM3, 0);
    const destinationVolume = destination.reduce((sum: number, line: Row) => sum + line.allocatedVolumeM3, 0);
    if (movement.quantity !== sideQuantity(ledgerLines) || !Number.isFinite(movement.actualTotalWeightKg) || !Number.isFinite(movement.actualTotalVolumeM3) ||
      Math.abs(movement.actualTotalWeightKg - (effect.action === 'ADD' ? destinationWeight : sourceWeight)) > 0.001 ||
      Math.abs(movement.actualTotalVolumeM3 - (effect.action === 'ADD' ? destinationVolume : sourceVolume)) > 0.000001 ||
      effect.action === 'MOVE' && (sideQuantity(source) !== sideQuantity(destination) || Math.abs(sourceWeight - destinationWeight) > 0.001 || Math.abs(sourceVolume - destinationVolume) > 0.000001)) continue;
    const filteredSource = source.filter((line: Row) => (!query.itemSpecId || id(line.itemSpecId) === query.itemSpecId.toString()) && (!query.reservationId || id(line.reservationId ?? movement.managedReservationId) === query.reservationId.toString()));
    const filteredDestination = destination.filter((line: Row) => (!query.itemSpecId || id(line.itemSpecId) === query.itemSpecId.toString()) && (!query.reservationId || id(line.reservationId ?? movement.managedReservationId) === query.reservationId.toString()));
    const lines: Row[] = effect.action === 'ADD' ? filteredDestination : effect.action === 'REMOVE' ? filteredSource : filteredSource.length ? filteredSource : filteredDestination;
    if (!lines.length) continue;
    const key = `${id(movement.facilityId)}|${effect.action}|${effect.operationId}`;
    if (grouped.has(key)) continue;
    const instanceIds = new Set(lines.filter(line => line.itemInstanceId).map(line => line.itemInstanceId));
    const batchQuantity = lines.filter((line: Row) => !line.itemInstanceId).reduce((sum: number, line: Row) => sum + line.quantity, 0);
    const scopeReservations = (side: Row[]) => [...new Set(side.map((line: Row) => id(line.reservationId ?? movement.managedReservationId)).filter(Boolean))];
    const sourceReservations = scopeReservations(source), destinationReservations = scopeReservations(destination);
    const scope = effect.action !== 'MOVE' ? null : sourceReservations[0] !== destinationReservations[0] ? 'CROSS_RESERVATION' :
      new Set(source.map((line: Row) => id(line.cellId))).size && JSON.stringify([...new Set(source.map((line: Row) => id(line.cellId)))].sort()) !== JSON.stringify([...new Set(destination.map((line: Row) => id(line.cellId)))].sort()) ? 'WITHIN_RESERVATION' : 'UNKNOWN';
    grouped.set(key, { facilityId: id(movement.facilityId), action: effect.action, operationId: effect.operationId, lines, source, destination,
      quantity: batchQuantity + instanceIds.size, weightKg: lines.reduce((sum: number, line: Row) => sum + line.allocatedWeightKg, 0),
      volumeM3: lines.reduce((sum: number, line: Row) => sum + line.allocatedVolumeM3, 0), quantityUnits: [...new Set(lines.map((line: Row) => line.quantityUnitSnapshot ?? 'UNKNOWN'))],
      receiptCount: new Set(lines.map((line: Row) => line.receiptId)).size, instanceCount: instanceIds.size, relocationScope: scope,
      sourceReservations, destinationReservations });
  }
  const operations = [...grouped.values()];
  const result: Row = { inboundOperations: 0, outboundOperations: 0, relocationOperations: 0, totalCommittedOperations: operations.length,
    inboundWeightKg: 0, outboundWeightKg: 0, movedWeightKg: 0, inboundVolumeM3: 0, outboundVolumeM3: 0, movedVolumeM3: 0,
    inboundReceiptCount: 0, inboundItemInstanceCount: 0, outboundItemInstanceCount: 0, relocationByScope: { WITHIN_RESERVATION: 0, CROSS_RESERVATION: 0, UNKNOWN: 0 }, quantityByActionAndUnit: {}, operationsByAction: {} };
  const unitQuantities = new Map<string, number>();
  const bySpec = new Map<string, Row>();
  const byReservation = new Map<string, Set<string>>();
  for (const op of operations) {
    const action = op.action as MovementBatchAction;
    const name = action === 'ADD' ? 'inbound' : action === 'REMOVE' ? 'outbound' : 'relocation';
    result[`${name}Operations`] += 1;
    result.operationsByAction[action] = (result.operationsByAction[action] ?? 0) + 1;
    if (action === 'ADD') { result.inboundWeightKg += op.weightKg; result.inboundVolumeM3 += op.volumeM3; result.inboundReceiptCount += op.receiptCount; result.inboundItemInstanceCount += op.instanceCount; }
    if (action === 'REMOVE') { result.outboundWeightKg += op.weightKg; result.outboundVolumeM3 += op.volumeM3; result.outboundItemInstanceCount += op.instanceCount; }
    if (action === 'MOVE') { result.movedWeightKg += op.weightKg; result.movedVolumeM3 += op.volumeM3; result.relocationByScope[op.relocationScope] += 1; }
    const units = new Set(op.lines.map((line: Row) => line.quantityUnitSnapshot ?? 'UNKNOWN'));
    for (const unit of units) {
      const batchQuantity = op.lines.filter((line: Row) => (line.quantityUnitSnapshot ?? 'UNKNOWN') === unit && !line.itemInstanceId).reduce((sum: number, line: Row) => sum + line.quantity, 0);
      const instances = new Set(op.lines.filter((line: Row) => (line.quantityUnitSnapshot ?? 'UNKNOWN') === unit && line.itemInstanceId).map((line: Row) => line.itemInstanceId));
      const unitKey = `${action}|${unit}`;
      unitQuantities.set(unitKey, (unitQuantities.get(unitKey) ?? 0) + batchQuantity + instances.size);
      result.quantityByActionAndUnit[unitKey] = unitQuantities.get(unitKey);
    }
    for (const line of op.lines) {
      const specId = id(line.itemSpecId), key = `${action}|${specId}`;
      const spec = bySpec.get(key) ?? { action, itemSpecId: specId, operationIds: new Set<string>(), quantityUnits: new Map<string, number>(), weightKg: 0, volumeM3: 0 };
      spec.operationIds.add(op.operationId); spec.weightKg += line.allocatedWeightKg; spec.volumeM3 += line.allocatedVolumeM3;
      const unit = line.quantityUnitSnapshot ?? 'UNKNOWN';
      if (!line.itemInstanceId) spec.quantityUnits.set(unit, (spec.quantityUnits.get(unit) ?? 0) + line.quantity);
      else spec.instances ??= new Map<string, Set<string>>();
      if (line.itemInstanceId) { const set = spec.instances.get(unit) ?? new Set<string>(); set.add(`${op.operationId}|${line.itemInstanceId}`); spec.instances.set(unit, set); }
      bySpec.set(key, spec);
    }
    for (const [role, reservationIds] of [['SOURCE', op.sourceReservations], ['DESTINATION', op.destinationReservations]] as const) {
      for (const reservationId of reservationIds) { const key = `${op.operationId}|${reservationId}|${role}`; const set = byReservation.get(`${reservationId}|${role}`) ?? new Set<string>(); set.add(key); byReservation.set(`${reservationId}|${role}`, set); }
    }
  }
  for (const action of ['ADD', 'REMOVE', 'MOVE']) {
    const keys = [...unitQuantities.keys()].filter(key => key.startsWith(`${action}|`));
    const values = keys.map(key => unitQuantities.get(key) ?? 0);
    const field = action === 'ADD' ? 'inboundQuantity' : action === 'REMOVE' ? 'outboundQuantity' : 'movedQuantity';
    result[field] = keys.length <= 1 ? (values[0] ?? 0) : null;
  }
  result.operationsByItemSpecification = [...bySpec.values()].map(spec => {
    const quantityUnits: Row = {};
    for (const [unit, quantity] of spec.quantityUnits) quantityUnits[unit] = quantity;
    for (const [unit, instances] of spec.instances ?? []) quantityUnits[unit] = (quantityUnits[unit] ?? 0) + instances.size;
    const units = Object.keys(quantityUnits);
    return { action: spec.action, itemSpecId: spec.itemSpecId, operationCount: spec.operationIds.size, quantity: units.length === 1 ? quantityUnits[units[0]!] : null,
      quantityByUnit: quantityUnits, weightKg: round(spec.weightKg, 3), volumeM3: round(spec.volumeM3, 6) };
  });
  result.operationsByReservation = [...byReservation.entries()].map(([key, opIds]) => { const [reservationId, role] = key.split('|'); return { reservationId, role, operationCount: opIds.size }; });
  for (const key of ['inboundWeightKg', 'outboundWeightKg', 'movedWeightKg']) result[key] = round(result[key], 3);
  for (const key of ['inboundVolumeM3', 'outboundVolumeM3', 'movedVolumeM3']) result[key] = round(result[key], 6);
  return { ...result, operations };
}

function movementPipeline(query: StatisticsQuery, scope: StatisticsScope): PipelineStage[] { return buildManagedMovementPipeline(query, scope); }

export class StatisticsPhase3Service {
  static async managedOperations(query: StatisticsQuery, scope: StatisticsScope) {
    const generatedAt = new Date();
    const base = movementPipeline(query, scope);
    const byAction = await runAggregate(ItemMovementModel, [...base, { $group: { _id: '$stockEffect.action', operationIds: { $addToSet: '$stockEffect.operationId' }, weightKg: { $sum: '$_weight' }, volumeM3: { $sum: '$_volume' } } }, { $project: { action: '$_id', operationCount: { $size: '$operationIds' }, weightKg: 1, volumeM3: 1 } }, { $sort: { action: 1 } }]);
    const totals = await runAggregate(ItemMovementModel, [...base, { $group: { _id: '$stockEffect.action', operationCount: { $sum: 1 }, quantity: { $sum: '$_quantity' }, weightKg: { $sum: '$_weight' }, volumeM3: { $sum: '$_volume' }, receiptCount: { $sum: { $cond: [{ $eq: ['$stockEffect.action', MovementBatchAction.ADD] }, { $size: '$_receiptIds' }, 0] } }, instanceCount: { $sum: { $size: '$_instanceIds' } } } }]);
    const bySpec = await runAggregate(ItemMovementModel, [...base, { $unwind: '$_eventLines' }, { $group: { _id: { action: '$stockEffect.action', operationId: '$stockEffect.operationId', itemSpecId: '$_eventLines.itemSpecId', unit: { $ifNull: ['$_eventLines.quantityUnitSnapshot', 'UNKNOWN'] } }, batchQuantity: { $sum: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, '$_eventLines.quantity', 0] } }, instanceIds: { $addToSet: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, null, '$_eventLines.itemInstanceId'] } }, weightKg: { $sum: '$_eventLines.allocatedWeightKg' }, volumeM3: { $sum: '$_eventLines.allocatedVolumeM3' } } }, { $set: { instanceIds: { $filter: { input: '$instanceIds', as: 'id', cond: { $ne: ['$$id', null] } } } } }, { $group: { _id: { action: '$_id.action', itemSpecId: '$_id.itemSpecId', unit: '$_id.unit' }, quantity: { $sum: { $add: ['$batchQuantity', { $size: '$instanceIds' }] } }, operations: { $addToSet: '$_id.operationId' }, weightKg: { $sum: '$weightKg' }, volumeM3: { $sum: '$volumeM3' } } }, { $sort: { '_id.action': 1, '_id.itemSpecId': 1, '_id.unit': 1 } }]);
    const byTime = await runAggregate(ItemMovementModel, [...base, { $unwind: '$_eventLines' }, { $group: { _id: { bucket: dateTrunc('$performedAt', query.granularity ?? 'day'), action: '$stockEffect.action', operationId: '$stockEffect.operationId', unit: { $ifNull: ['$_eventLines.quantityUnitSnapshot', 'UNKNOWN'] } }, batchQuantity: { $sum: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, '$_eventLines.quantity', 0] } }, instanceIds: { $addToSet: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, null, '$_eventLines.itemInstanceId'] } }, weightKg: { $sum: '$_eventLines.allocatedWeightKg' }, volumeM3: { $sum: '$_eventLines.allocatedVolumeM3' } } }, { $set: { instanceIds: { $filter: { input: '$instanceIds', as: 'id', cond: { $ne: ['$$id', null] } } } } }, { $group: { _id: { bucket: '$_id.bucket', action: '$_id.action', unit: '$_id.unit' }, operationIds: { $addToSet: '$_id.operationId' }, quantity: { $sum: { $add: ['$batchQuantity', { $size: '$instanceIds' }] } }, weightKg: { $sum: '$weightKg' }, volumeM3: { $sum: '$volumeM3' } } }, { $sort: { '_id.bucket': 1, '_id.action': 1, '_id.unit': 1 } }]);
    const byFacility = await runAggregate(ItemMovementModel, [...base, { $group: { _id: { facilityId: '$facilityId', action: '$stockEffect.action' }, operationCount: { $sum: 1 }, weightKg: { $sum: '$_weight' }, volumeM3: { $sum: '$_volume' } } }, { $sort: { '_id.facilityId': 1, '_id.action': 1 } }]);
    const relocationByScope = await runAggregate(ItemMovementModel, [...base, { $match: { 'stockEffect.action': MovementBatchAction.MOVE } }, { $unwind: '$_eventLines' }, { $group: { _id: { scope: '$_relocationScope', operationId: '$stockEffect.operationId', unit: { $ifNull: ['$_eventLines.quantityUnitSnapshot', 'UNKNOWN'] } }, batchQuantity: { $sum: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, '$_eventLines.quantity', 0] } }, instanceIds: { $addToSet: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, null, '$_eventLines.itemInstanceId'] } }, weightKg: { $sum: '$_eventLines.allocatedWeightKg' }, volumeM3: { $sum: '$_eventLines.allocatedVolumeM3' } } }, { $set: { instanceIds: { $filter: { input: '$instanceIds', as: 'id', cond: { $ne: ['$$id', null] } } } } }, { $group: { _id: { scope: '$_id.scope', unit: '$_id.unit' }, operationIds: { $addToSet: '$_id.operationId' }, quantity: { $sum: { $add: ['$batchQuantity', { $size: '$instanceIds' }] } }, weightKg: { $sum: '$weightKg' }, volumeM3: { $sum: '$volumeM3' } } }, { $sort: { '_id.scope': 1, '_id.unit': 1 } }]);
    const byReservation = await runAggregate(ItemMovementModel, [...base, { $set: { _reservationRoles: { $concatArrays: [
      { $map: { input: '$_sourceFiltered', as: 'line', in: { reservationId: { $toString: { $ifNull: ['$$line.reservationId', '$managedReservationId'] } }, role: 'SOURCE' } } },
      { $map: { input: '$_destinationFiltered', as: 'line', in: { reservationId: { $toString: { $ifNull: ['$$line.reservationId', '$managedReservationId'] } }, role: 'DESTINATION' } } },
    ] } } }, { $unwind: '$_reservationRoles' }, { $group: { _id: { operationId: '$stockEffect.operationId', reservationId: '$_reservationRoles.reservationId', role: '$_reservationRoles.role' } } }, { $group: { _id: { reservationId: '$_id.reservationId', role: '$_id.role' }, operationCount: { $sum: 1 } } }, { $sort: { '_id.reservationId': 1, '_id.role': 1 } }]);
    const get = (action: MovementBatchAction, key: string) => n(totals.find(row => row._id === action), key);
    const actionRows = byAction.map(row => ({ action: row.action, operationCount: n(row, 'operationCount'), weightKg: round(n(row, 'weightKg'), 3), volumeM3: round(n(row, 'volumeM3'), 6) }));
    const specGrouped = new Map<string, Row>();
    for (const row of bySpec) {
      const key = `${row._id.action}|${id(row._id.itemSpecId)}`;
      const entry = specGrouped.get(key) ?? { action: row._id.action, itemSpecId: id(row._id.itemSpecId), operationIds: new Set<string>(), quantityByUnit: {}, weightKg: 0, volumeM3: 0 };
      entry.operationIds = new Set([...entry.operationIds, ...row.operations.map(String)]);
      entry.quantityByUnit[row._id.unit] = (entry.quantityByUnit[row._id.unit] ?? 0) + n(row, 'quantity');
      entry.weightKg += n(row, 'weightKg'); entry.volumeM3 += n(row, 'volumeM3'); specGrouped.set(key, entry);
    }
    const pagedSpecs = pageRows([...specGrouped.values()].map(row => ({ action: row.action, itemSpecId: row.itemSpecId, operationCount: row.operationIds.size,
      quantity: Object.keys(row.quantityByUnit).length === 1 ? Object.values(row.quantityByUnit)[0] : null, quantityByUnit: row.quantityByUnit, weightKg: round(row.weightKg, 3), volumeM3: round(row.volumeM3, 6) })), query);
    const quantityRows = await runAggregate(ItemMovementModel, [...base, { $unwind: '$_eventLines' }, { $group: { _id: { action: '$stockEffect.action', unit: { $ifNull: ['$_eventLines.quantityUnitSnapshot', 'UNKNOWN'] }, operationId: '$stockEffect.operationId' }, batchQuantity: { $sum: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, '$_eventLines.quantity', 0] } }, instanceIds: { $addToSet: { $cond: [{ $in: [{ $type: '$_eventLines.itemInstanceId' }, ['missing', 'null']] }, null, '$_eventLines.itemInstanceId'] } } } }, { $set: { instanceIds: { $filter: { input: '$instanceIds', as: 'id', cond: { $ne: ['$$id', null] } } } } }, { $group: { _id: { action: '$_id.action', unit: '$_id.unit' }, quantity: { $sum: { $add: ['$batchQuantity', { $size: '$instanceIds' }] } } } }]);
    return {
      success: true,
      data: {
        inboundOperations: get(MovementBatchAction.ADD, 'operationCount'), outboundOperations: get(MovementBatchAction.REMOVE, 'operationCount'),
        relocationOperations: get(MovementBatchAction.MOVE, 'operationCount'), totalCommittedOperations: totals.reduce((sum, row) => sum + n(row, 'operationCount'), 0),
        inboundQuantity: quantityRows.filter(row => row._id.action === 'ADD').length <= 1 ? n(quantityRows.find(row => row._id.action === 'ADD'), 'quantity') : null,
        outboundQuantity: quantityRows.filter(row => row._id.action === 'REMOVE').length <= 1 ? n(quantityRows.find(row => row._id.action === 'REMOVE'), 'quantity') : null,
        movedQuantity: quantityRows.filter(row => row._id.action === 'MOVE').length <= 1 ? n(quantityRows.find(row => row._id.action === 'MOVE'), 'quantity') : null,
        quantityByActionAndUnit: quantityRows.map(row => ({ action: row._id.action, quantityUnit: row._id.unit, quantity: n(row, 'quantity') })),
        inboundWeightKg: round(get(MovementBatchAction.ADD, 'weightKg'), 3), outboundWeightKg: round(get(MovementBatchAction.REMOVE, 'weightKg'), 3), movedWeightKg: round(get(MovementBatchAction.MOVE, 'weightKg'), 3),
        inboundVolumeM3: round(get(MovementBatchAction.ADD, 'volumeM3'), 6), outboundVolumeM3: round(get(MovementBatchAction.REMOVE, 'volumeM3'), 6), movedVolumeM3: round(get(MovementBatchAction.MOVE, 'volumeM3'), 6),
        inboundReceiptCount: get(MovementBatchAction.ADD, 'receiptCount'), inboundItemInstanceCount: get(MovementBatchAction.ADD, 'instanceCount'), outboundItemInstanceCount: get(MovementBatchAction.REMOVE, 'instanceCount'),
        operationsByAction: actionRows, operationsByFacility: byFacility.map(row => ({ facilityId: id(row._id.facilityId), action: row._id.action, operationCount: n(row, 'operationCount'), weightKg: round(n(row, 'weightKg'), 3), volumeM3: round(n(row, 'volumeM3'), 6) })),
        operationsByItemSpecification: pagedSpecs.items, operationsByItemSpecificationPagination: { page: pagedSpecs.page, limit: pagedSpecs.limit, total: pagedSpecs.total, totalPages: pagedSpecs.totalPages },
        operationsByTime: byTime.map(row => ({ bucketStart: row._id.bucket, action: row._id.action, quantityUnit: row._id.unit, operationCount: row.operationIds.length, quantity: n(row, 'quantity'), weightKg: round(n(row, 'weightKg'), 3), volumeM3: round(n(row, 'volumeM3'), 6) })),
        relocationByScope: relocationByScope.map(row => ({ scope: row._id.scope, quantityUnit: row._id.unit, operationCount: row.operationIds.length, quantity: n(row, 'quantity'), weightKg: round(n(row, 'weightKg'), 3), volumeM3: round(n(row, 'volumeM3'), 6) })),
        operationsByReservation: byReservation.map(row => ({ reservationId: id(row._id.reservationId), role: row._id.role, operationCount: n(row, 'operationCount') })),
        partialOutbound: null, fullOutbound: null,
        outboundClassificationUnavailableReason: 'The ledger does not retain a proven pre-operation receipt balance for all legacy v4 effects; REMOVE is not assumed to be a full outbound.',
      },
      meta: timeMeta(query, scope, generatedAt, { ledgerSchemaVersion: 4, usageSource: 'ItemMovement.stockEffect', timeBasis: 'performedAt', legacyExcluded: true,
        quantityUnitPolicy: 'Cross-unit quantities are null in scalar fields and are returned by quantityByActionAndUnit.',
        crossReservationMove: 'source/destination reservationId with managedReservationId fallback; MOVE physical totals use source only.',
        replayPolicy: 'schema-v4 events deduplicated by facility/action/stockEffect.operationId; idempotent replay does not increase operation count.' }, {}, [
        'Only valid committed schema-v4 movement effects are counted; requests without a committed ledger event and failed/pending operations are unavailable.',
        'Partial/full outbound classification is unavailable; REMOVE is not interpreted as full outbound.',
        'Schema-v1/v2/v3 movement effects are excluded.',
      ]),
    };
  }

  static async incidents(query: StatisticsQuery, scope: StatisticsScope) {
    const generatedAt = new Date();
    const status = query.status;
    if (status !== undefined && !(Object.values(MaintenanceStatus) as string[]).includes(status)) throw new StatisticsQueryError(400, 'INVALID_STATUS', 'status is not supported for incident analytics');
    const period: Row = { ...LIVE, ...scopeMatch(scope), createdAt: { $gte: query.from, $lt: query.toExclusive }, ...(status ? { status } : {}) };
    const current: Row = { ...LIVE, ...scopeMatch(scope), ...(status ? { status } : {}) };
    const [created, open, resolved, byFacility, byCategory, byPriority, byTime, checkoutFindings, supportContext] = await Promise.all([
      runAggregate(MaintenanceTicketModel, [{ $match: period }, { $group: { _id: null, count: { $sum: 1 }, resolvedDurations: { $push: { $cond: [{ $and: [{ $eq: [{ $type: '$resolvedAt' }, 'date'] }, { $gte: ['$resolvedAt', '$createdAt'] }] }, { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3_600_000] }, null] } } } }, { $project: { count: 1, durations: { $filter: { input: '$resolvedDurations', as: 'value', cond: { $ne: ['$$value', null] } } } } }]),
      MaintenanceTicketModel.countDocuments({ ...current, status: { $in: [MaintenanceStatus.OPEN, MaintenanceStatus.ASSIGNED, MaintenanceStatus.IN_PROGRESS] } }),
      MaintenanceTicketModel.countDocuments({ ...current, status: { $in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.CLOSED] } }),
      runAggregate(MaintenanceTicketModel, [{ $match: period }, { $group: { _id: '$facilityId', incidentCount: { $sum: 1 }, openCount: { $sum: { $cond: [{ $in: ['$status', [MaintenanceStatus.OPEN, MaintenanceStatus.ASSIGNED, MaintenanceStatus.IN_PROGRESS]] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
      runAggregate(MaintenanceTicketModel, [{ $match: period }, { $group: { _id: '$category', incidentCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(MaintenanceTicketModel, [{ $match: period }, { $group: { _id: '$priority', incidentCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(MaintenanceTicketModel, [{ $match: period }, { $group: { _id: dateTrunc('$createdAt', query.granularity ?? 'day'), incidentCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(InspectionModel, [{ $match: { ...scopeMatch(scope), createdAt: { $gte: query.from, $lt: query.toExclusive }, type: InspectionType.CHECK_OUT, status: InspectionStatus.COMPLETED } }, { $group: { _id: '$condition', inspectionCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(SupportRequestModel, [{ $match: { ...scopeMatch(scope), deletedAt: { $exists: false }, createdAt: { $gte: query.from, $lt: query.toExclusive } } }, { $group: { _id: '$category', requestCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ]);
    const createdRow = created[0];
    const durations: number[] = Array.isArray(createdRow?.durations) ? createdRow.durations.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)) : [];
    const units = await runAggregate(MaintenanceTicketModel, [{ $match: period }, { $match: { storageUnitId: { $type: 'objectId' } } }, { $group: { _id: '$storageUnitId' } }, { $count: 'count' }]);
    return { success: true, data: {
      newIncidents: n(createdRow, 'count'), openIncidents: open, resolvedIncidents: resolved,
      averageResolutionHours: durations.length ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      resolutionDurationSampleCount: durations.length, distinctStorageUnitsWithMaintenance: n(units[0], 'count'),
      incidentsByFacility: byFacility.map(row => ({ facilityId: id(row._id), incidentCount: n(row, 'incidentCount'), openCount: n(row, 'openCount') })),
      incidentsByCategory: Object.fromEntries(byCategory.map(row => [id(row._id), n(row, 'incidentCount')])),
      incidentsByPriority: Object.fromEntries(byPriority.map(row => [id(row._id), n(row, 'incidentCount')])),
      incidentTrend: byTime.map(row => ({ bucketStart: row._id, incidentCount: n(row, 'incidentCount') })),
      checkoutInspectionFindings: Object.fromEntries(checkoutFindings.map(row => [id(row._id), n(row, 'inspectionCount')])),
      supportRequestsByCategoryNotCountedAsIncidents: Object.fromEntries(supportContext.map(row => [id(row._id), n(row, 'requestCount')])),
      averageIncidentSlaHours: null, incidentSlaBreachRate: null,
    }, meta: timeMeta(query, scope, generatedAt, { incidentCount: 'distinct MaintenanceTicket documents; SupportRequest and Inspection records are shown separately to avoid double-counting as incidents', resolutionDuration: 'resolvedAt minus createdAt for this period cohort only', sla: 'unavailable; no consistent incident SLA lifecycle source' }, {}, [
      'Only MaintenanceTicket is counted as an incident. Checkout inspection findings and generic support requests are separate context and are not added to incident totals.',
      'No Cell-specific maintenance incident source exists on MaintenanceTicket.',
      'SLA metrics are unavailable.',
    ]) };
  }

  static async paymentsAnalysis(query: StatisticsQuery, scope: StatisticsScope) {
    const generatedAt = new Date();
    const match = buildPaymentIntentMatch(query, scope);
    const intentPipeline: PipelineStage[] = [{ $match: match }, { $facet: {
      totals: [{ $group: { _id: null, paymentIntents: { $sum: 1 }, successfulPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.SUCCEEDED] }, 1, 0] } }, failedPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.FAILED] }, 1, 0] } }, cancelledPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.CANCELLED] }, 1, 0] } }, pendingPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.PENDING] }, 1, 0] } }, reconciliationRequiredPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.RECONCILIATION_REQUIRED] }, 1, 0] } }, manualReviewPayments: { $sum: { $cond: [{ $eq: ['$applicationStatus', PaymentApplicationStatus.MANUAL_REVIEW] }, 1, 0] } } } }],
      byFacility: [{ $group: { _id: '$facilityId', paymentIntents: { $sum: 1 }, successfulPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.SUCCEEDED] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
      byService: [{ $group: { _id: '$serviceType', paymentIntents: { $sum: 1 }, successfulPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.SUCCEEDED] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
      byPurpose: [{ $group: { _id: '$purpose', paymentIntents: { $sum: 1 }, successfulPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.SUCCEEDED] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
      trend: [{ $group: { _id: dateTrunc('$createdAt', query.granularity ?? 'day'), paymentIntents: { $sum: 1 }, successfulPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.SUCCEEDED] }, 1, 0] } }, failedPayments: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.FAILED] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
    } }];
    const [intentResult, captureTotals] = await Promise.all([
      runAggregate(ReservationPaymentModel, intentPipeline),
      runAggregate(ReservationPaymentModel, [...verifiedCapturePipeline(query, scope), { $group: { _id: null, verifiedCaptureCount: { $sum: 1 }, collectedAmount: { $sum: '$captureAmount' } } }]),
    ]);
    const facet = intentResult[0] ?? {};
    const total = (facet.totals ?? [])[0] ?? {};
    const successDenominator = n(total, 'successfulPayments') + n(total, 'failedPayments');
    return { success: true, data: {
      paymentIntents: n(total, 'paymentIntents'), successfulPayments: n(total, 'successfulPayments'), failedPayments: n(total, 'failedPayments'), cancelledPayments: n(total, 'cancelledPayments'),
      pendingPayments: n(total, 'pendingPayments'), reconciliationRequiredPayments: n(total, 'reconciliationRequiredPayments'), manualReviewPayments: n(total, 'manualReviewPayments'),
      verifiedCaptureCount: n(captureTotals[0], 'verifiedCaptureCount'), collectedAmount: round(n(captureTotals[0], 'collectedAmount')),
      successRate: pct(n(total, 'successfulPayments'), successDenominator), successRateDenominator: successDenominator,
      paymentsByFacility: (facet.byFacility ?? []).map((row: Row) => ({ facilityId: id(row._id), paymentIntents: n(row, 'paymentIntents'), successfulPayments: n(row, 'successfulPayments') })),
      paymentsByService: (facet.byService ?? []).map((row: Row) => ({ serviceType: row._id, paymentIntents: n(row, 'paymentIntents'), successfulPayments: n(row, 'successfulPayments') })),
      paymentsByPurpose: (facet.byPurpose ?? []).map((row: Row) => ({ purpose: row._id, paymentIntents: n(row, 'paymentIntents'), successfulPayments: n(row, 'successfulPayments') })),
      paymentTrend: (facet.trend ?? []).map((row: Row) => ({ bucketStart: row._id, paymentIntents: n(row, 'paymentIntents'), successfulPayments: n(row, 'successfulPayments'), failedPayments: n(row, 'failedPayments') })),
    }, meta: timeMeta(query, scope, generatedAt, { intentSource: 'PayOS ReservationPayment documents grouped once by _id using createdAt', intentProvider: 'PAYOS only; MOCK excluded', captureSource: 'Phase 1 verifiedCapturePipeline; provider-verified captures deduplicated by eventHash', successRate: 'successful / (successful + failed); cancelled, pending and reconciliation-required excluded from denominator', intentTimeBasis: 'ReservationPayment.createdAt', captureTimeBasis: 'providerCaptures.transactionDateTime' }) };
  }

  static async financialAnalytics(query: StatisticsQuery, scope: StatisticsScope) {
    const generatedAt = new Date();
    validateFinancialPaymentStatus(query.paymentStatus);
    const collect = (from: Date, to: Date): PipelineStage[] => verifiedCapturePipeline(query, scope, from, to);
    const duration = query.toExclusive.getTime() - query.from.getTime();
    const previousFrom = new Date(query.from.getTime() - duration), previousTo = query.from;
    const pipeline = collect(query.from, query.toExclusive);
    const previousPipeline = collect(previousFrom, previousTo);
    const [totalRows, averageRows, facility, service, purpose, trend, previousRows] = await Promise.all([
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: null, grossCollectedAmount: { $sum: '$captureAmount' }, verifiedCaptureCount: { $sum: 1 } } }]),
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: '$paymentId', paymentAmount: { $sum: '$captureAmount' } } }, { $group: { _id: null, averageVerifiedPayment: { $avg: '$paymentAmount' }, verifiedPaymentCount: { $sum: 1 } } }]),
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: '$facilityId', amount: { $sum: '$captureAmount' }, captureCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: '$serviceType', amount: { $sum: '$captureAmount' }, captureCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: '$purpose', amount: { $sum: '$captureAmount' }, captureCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationPaymentModel, [...pipeline, { $group: { _id: { bucket: dateTrunc('$_captureDate', query.granularity ?? 'day'), serviceType: '$serviceType' }, amount: { $sum: '$captureAmount' }, captureCount: { $sum: 1 } } }, { $sort: { '_id.bucket': 1, '_id.serviceType': 1 } }]),
      query.comparePrevious ? runAggregate(ReservationPaymentModel, [...previousPipeline, { $group: { _id: null, amount: { $sum: '$captureAmount' } } }]) : Promise.resolve([] as Row[]),
    ]);
    const total = totalRows[0] ?? {};
    const gross = round(n(total, 'grossCollectedAmount'));
    const previousCollected = query.comparePrevious ? round(n(previousRows[0], 'amount')) : null;
    const growth = previousCollected === null ? null : previousCollected === 0 ? gross === 0 ? 0 : null : round((gross - previousCollected) / previousCollected * 100);
    const purposeRows = new Map(purpose.map(row => [id(row._id), row]));
    return { success: true, data: {
      grossCollectedAmount: gross, collectedByFacility: facility.map(row => ({ facilityId: id(row._id), amount: round(n(row, 'amount')), captureCount: n(row, 'captureCount') })),
      collectedByService: service.map(row => ({ serviceType: row._id, amount: round(n(row, 'amount')), captureCount: n(row, 'captureCount') })),
      collectedByPurpose: purpose.map(row => ({ purpose: row._id, amount: round(n(row, 'amount')), captureCount: n(row, 'captureCount') })),
      collectedTrend: trend.map(row => ({ bucketStart: row._id.bucket, serviceType: row._id.serviceType, amount: round(n(row, 'amount')), captureCount: n(row, 'captureCount') })),
      previousPeriodCollectedAmount: previousCollected, growthPercent: growth, growthStatus: query.comparePrevious ? growth === null ? 'UNAVAILABLE' : 'AVAILABLE' : 'NOT_REQUESTED',
      averageVerifiedPayment: averageRows[0] ? round(n(averageRows[0], 'averageVerifiedPayment')) : null,
      newRentalCollectedAmount: round(['FULL_RENT', 'BALANCE', 'DEPOSIT'].reduce((sum, purpose) => sum + n(purposeRows.get(purpose), 'amount'), 0)),
      renewalCollectedAmount: round(n(purposeRows.get(PaymentPurpose.RENEWAL), 'amount')),
      refundedAmount: null, netCashFlow: null, recognizedRevenue: null,
    }, meta: timeMeta(query, scope, generatedAt, { grossCollectedAmount: 'verified PayOS captures only; eventHash deduplication shared with Phase 1', refunds: 'UNAVAILABLE', netCashFlow: 'UNAVAILABLE', revenueRecognition: 'UNAVAILABLE', growth: 'same-duration immediately preceding period', averageVerifiedPayment: 'arithmetic mean of distinct verified capture events', rentalPurposeMapping: 'FULL_RENT, BALANCE and DEPOSIT are non-renewal rental collections; RENEWAL is reported separately' }, {}, [
      'Refund ledger is unavailable; refundedAmount and netCashFlow are null.',
      'Recognized revenue is unavailable; recognizedRevenue is null.',
      ...(query.comparePrevious && previousCollected === 0 && gross > 0 ? ['Growth percentage is unavailable because the previous period collected amount is zero.'] : []),
    ]) };
  }

  static async productAndOperations(query: StatisticsQuery, scope: StatisticsScope) {
    const generatedAt = new Date();
    const [overview, serviceMix, unitDemand, customers, managed, facilityRanking, capacity] = await Promise.all([
      StatisticsService.overview(query, scope), StatisticsService.serviceMix(query, scope), StatisticsService.unitDemand(query, scope),
      StatisticsService.customers(query, scope), this.managedOperations(query, scope),
      StatisticsService.facilitiesRanking({ ...query, sortBy: 'reservationCount', sortOrder: -1 }, scope),
      StatisticsPhase2Service.managedCapacity(query, scope),
    ]);
    return { success: true, data: {
      serviceMix: serviceMix.data, paidBookingCount: overview.data.paidReservationCount, paidBookingsByService: overview.data.paidReservationByService,
      uniqueCustomers: customers.data.uniqueCustomers, unitDemand: unitDemand.data,
      facilityDemand: facilityRanking.data.items,
      managedOperationsV4: managed.data,
      managedCapacityV4: capacity.data,
      rentalDuration: null,
      rentalDurationUnavailableReason: 'Reservation scheduled start/end dates do not establish actual checkout duration across all historical flows.',
    }, meta: timeMeta(query, scope, generatedAt, { managedOperations: 'canonical schema-v4 ItemMovement.stockEffect', managedCapacityV4: capacity.meta.dataCompleteness }, {}, [
      'Unique customers are computed once for the selected system/facility scope and are not summed from Facility subtotals.',
      ...(Array.isArray(capacity.meta.limitations) ? capacity.meta.limitations as string[] : []),
    ]) };
  }
}
