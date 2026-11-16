import mongoose, { Schema } from 'mongoose';
import { IItemMovement, ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { exactUnitsEqual, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';

const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const near = (left: number, right: number, tolerance: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

const batchLineSchema = new Schema({
  batchId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128, immutable: true },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
  receiptRequestId: { type: Schema.Types.ObjectId, immutable: true },
  receivingInspectionEvidenceId: { type: Schema.Types.ObjectId, ref: 'ReceivingInspectionEvidence', immutable: true },
  action: { type: String, enum: Object.values(MovementBatchAction), required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32, immutable: true },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualUnitDimensionsM: { type: new Schema({
    widthM: { type: Number, required: true, min: Number.MIN_VALUE },
    depthM: { type: Number, required: true, min: Number.MIN_VALUE },
    heightM: { type: Number, required: true, min: Number.MIN_VALUE },
  }, { _id: false, immutable: true }), required: true, immutable: true },
  actualTotalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualTotalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
}, { _id: false, strict: 'throw' });

const v3EffectLineSchema = new Schema({
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true }, topologyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  batchId: { type: String, trim: true, maxlength: 128 },
  physicalUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedV3PhysicalUnit' },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32 },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  volumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  supportReactionKg: { type: Number, min: 0 }, occupiedVolumeM3: { type: Number, min: 0 },
  pose: { type: new Schema({ xStartM: { type: Number, required: true }, yStartM: { type: Number, required: true }, rotationDeg: { type: Number, required: true, enum: [0, 90] } }, { _id: false, strict: 'throw', immutable: true }) },
}, { _id: false, strict: 'throw', immutable: true });
const v3EffectSchema = new Schema({
  action: { type: String, enum: ['ADD', 'REMOVE', 'MOVE'], required: true },
  itemKind: { type: String, enum: ['A1_PHYSICAL_UNIT', 'A2_BATCH'], required: true },
  operationId: { type: String, required: true, trim: true, maxlength: 160 },
  requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
  accessSessionId: { type: Schema.Types.ObjectId, ref: 'ManagedAccessSession', required: true },
  inventoryRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  ledgerRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true },
  topologyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  correlationId: { type: String, required: true, trim: true, maxlength: 160 },
  source: { type: [v3EffectLineSchema] }, destination: { type: [v3EffectLineSchema] },
  evidenceIds: [{ type: Schema.Types.ObjectId }],
  customerAttestation: { customerId: { type: Schema.Types.ObjectId, ref: 'User' }, attestedAt: Date, statement: { type: String, trim: true, maxlength: 500 } },
}, { _id: false, strict: 'throw', immutable: true });

const stockEffectLineSchema = new Schema({
  lineId: { type: String, trim: true, maxlength: 80, immutable: true },
  itemSpecId: { type: Schema.Types.ObjectId, ref: 'ItemSpecification', required: true, immutable: true },
  receiptId: { type: String, required: true, trim: true, minlength: 1, maxlength: 160, immutable: true },
  itemInstanceId: { type: String, trim: true, minlength: 1, maxlength: 160, immutable: true },
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  quantityUnitSnapshot: { type: String, trim: true, maxlength: 32, immutable: true },
  unitWeightKgSnapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitVolumeM3Snapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitDimensionsSnapshot: { type: new Schema({ widthM: { type: Number, required: true, min: Number.MIN_VALUE }, depthM: { type: Number, required: true, min: Number.MIN_VALUE }, heightM: { type: Number, required: true, min: Number.MIN_VALUE } }, { _id: false, strict: 'throw', immutable: true }), required: true, immutable: true },
  allocatedWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  allocatedVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  quantityBefore: { type: Number, min: 0, validate: Number.isSafeInteger, immutable: true },
  quantityAfter: { type: Number, min: 0, validate: Number.isSafeInteger, immutable: true },
}, { _id: false, strict: 'throw', immutable: true });
const stockEffectSchema = new Schema({
  action: { type: String, enum: Object.values(MovementBatchAction), required: true },
  operationId: { type: String, required: true, trim: true, maxlength: 160 },
  requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
  ledgerRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  contractVersion: { type: Number, enum: [2] },
  accessSessionId: { type: Schema.Types.ObjectId, ref: 'ManagedAccessSession' },
  source: { type: [stockEffectLineSchema] }, destination: { type: [stockEffectLineSchema] },
}, { _id: false, strict: 'throw', immutable: true });

const schema = new Schema<IItemMovement>({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  managedReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  type: { type: String, enum: Object.values(ItemMovementType), required: true, immutable: true },
  sourceCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', immutable: true, default: null },
  destinationCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', immutable: true, default: null },
  previousPlacementMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
  quantity: { type: Number, required: true, min: 1, immutable: true },
  quantityUnit: { type: String, required: true, immutable: true },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualTotalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualUnitDimensionsM: {
    widthM: { type: Number, required: true, min: Number.MIN_VALUE },
    depthM: { type: Number, required: true, min: Number.MIN_VALUE },
    heightM: { type: Number, required: true, min: Number.MIN_VALUE },
  },
  actualTotalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  movementCode: { type: String, trim: true, maxlength: 64, immutable: true },
  referenceCode: { type: String, trim: true, maxlength: 128, immutable: true },
  performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  performedAt: { type: Date, required: true, immutable: true },
  inspectionNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  handoverNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  relocationNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  physicalPackingConfirmed: { type: Boolean, immutable: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
  // Missing version is intentionally treated as v1 for existing records.
  schemaVersion: { type: Number, enum: [1, 2, 3, 4], default: 1, immutable: true },
  arithmeticPolicy: { type: String, enum: ['CANONICAL_V1'], immutable: true },
  batchLines: { type: [batchLineSchema], default: undefined, immutable: true },
  operationId: { type: String, trim: true, maxlength: 160, immutable: true },
  v3Effect: { type: v3EffectSchema, immutable: true },
  itemSpecId: { type: Schema.Types.ObjectId, ref: 'ItemSpecification', immutable: true },
  stockEffect: { type: stockEffectSchema, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false });

schema.pre('validate', function () {
  if (this.arithmeticPolicy != null && (this.arithmeticPolicy !== 'CANONICAL_V1' || this.schemaVersion !== 2)) {
    this.invalidate('arithmeticPolicy', 'Arithmetic policy is supported only for schema v2 movements');
  }
  if (this.isNew && this.schemaVersion === 2 && this.arithmeticPolicy == null) {
    this.invalidate('arithmeticPolicy', 'New schema v2 movements require CANONICAL_V1 arithmetic');
  }
  if (this.schemaVersion === 3) {
    const effect = this.v3Effect;
    const expectedType = effect?.action === 'ADD' ? ItemMovementType.INBOUND : effect?.action === 'REMOVE' ? ItemMovementType.OUTBOUND : ItemMovementType.RELOCATION;
    const source = effect?.source ?? [], destination = effect?.destination ?? [];
    const lines = effect?.action === 'ADD' ? destination : effect?.action === 'REMOVE' ? source : [...source, ...destination];
    const sum = (rows: typeof lines, key: 'quantity' | 'weightKg' | 'volumeM3') => rows.reduce((total, row) => total + Number(row[key]), 0);
    const uniquePlacementKeys = (rows: typeof lines) => rows.map(row => `${row.batchId ?? row.physicalUnitId}:${row.cellId}`);
    const validLine = (row: typeof lines[number]) => Number.isSafeInteger(row.quantity) && row.quantity > 0 && !!row.quantityUnit?.trim() &&
      [row.weightKg, row.volumeM3].every(value => Number.isFinite(value) && value > 0) &&
      (effect?.itemKind === 'A1_PHYSICAL_UNIT' ? !!row.physicalUnitId && row.quantity === 1 && Number.isFinite(row.supportReactionKg) &&
        Number.isFinite(row.occupiedVolumeM3) && row.supportReactionKg! >= 0 && row.occupiedVolumeM3! >= 0 && (row.pose == null || (Number.isFinite(row.pose.xStartM) &&
        Number.isFinite(row.pose.yStartM) && [0, 90].includes(row.pose.rotationDeg))) : !!row.batchId && row.pose == null &&
        row.supportReactionKg == null && row.occupiedVolumeM3 == null);
    const newA1HasPose = !this.isNew || effect?.itemKind !== 'A1_PHYSICAL_UNIT' || lines.every(row => !!row.pose);
    const validShape = !!effect && !!this.operationId && this.operationId === effect.operationId && this.idempotencyKey &&
      effect.requestHash && effect.accessSessionId && effect.topologyCertificationId &&
      (!this.batchLines || this.batchLines.length === 0) && this.arithmeticPolicy == null &&
      (effect.action === 'ADD' ? source.length === 0 && destination.length > 0 : effect.action === 'REMOVE' ? source.length > 0 && destination.length === 0 : source.length > 0 && destination.length > 0) &&
      [source, destination].every(rows => new Set(uniquePlacementKeys(rows)).size === rows.length && rows.every(validLine)) &&
      (effect.itemKind !== 'A1_PHYSICAL_UNIT' || (effect.action === 'MOVE'
        ? new Set(source.map(row => String(row.physicalUnitId))).size === new Set(destination.map(row => String(row.physicalUnitId))).size
        : new Set(lines.map(row => String(row.physicalUnitId))).size === 1));
    const eventRows = effect?.action === 'MOVE' ? source : lines;
    const eventQuantity = effect?.itemKind === 'A1_PHYSICAL_UNIT' ? new Set(eventRows.map(row => String(row.physicalUnitId))).size : sum(eventRows, 'quantity');
    const totalsMatch = effect && Number.isSafeInteger(this.quantity) && this.quantity === eventQuantity &&
      near(this.actualTotalWeightKg, sum(eventRows, 'weightKg'), 0.001) && near(this.actualTotalVolumeM3, sum(eventRows, 'volumeM3'), 0.000001);
    if (this.type !== expectedType || !validShape || !totalsMatch || !newA1HasPose) this.invalidate('v3Effect', 'Schema v3 movement effect, placement lines, quantities and physical totals are invalid');
    if (this.sourceCellId != null || this.destinationCellId != null || this.batchLines != null) this.invalidate('v3Effect', 'Schema v3 cannot use legacy single-Cell or batchLines placement fields');
  } else if (this.schemaVersion !== 4 && (this.v3Effect != null || this.operationId != null)) {
    this.invalidate('v3Effect', 'V3 effect fields require schema version 3');
  }
  if (this.schemaVersion === 4) {
    const effect = this.stockEffect, source: any[] = effect?.source ?? [], destination: any[] = effect?.destination ?? [], action = effect?.action;
    const expectedType = action === 'ADD' ? ItemMovementType.INBOUND : action === 'REMOVE' ? ItemMovementType.OUTBOUND : ItemMovementType.RELOCATION;
    const eventRows: any[] = action === 'ADD' ? destination : action === 'REMOVE' ? source : source;
    const uniqueKey = (line: any) => `${line.itemInstanceId ? `I:${line.itemInstanceId}` : `R:${line.receiptId}`}:${line.cellId}`;
    const multiLineContract = effect?.contractVersion === 2;
    const validLine = (line: any) => !!this.itemSpecId && (multiLineContract || !!line.itemSpecId?.equals?.(this.itemSpecId)) &&
      (!multiLineContract || typeof line.lineId === 'string' && !!line.lineId.trim() && typeof line.quantityUnitSnapshot === 'string' && !!line.quantityUnitSnapshot.trim()) && !!line.receiptId?.trim() && !!line.cellId &&
      Number.isSafeInteger(line.quantity) && line.quantity > 0 && (!line.itemInstanceId || line.quantity === 1) &&
      (line.quantityBefore == null && line.quantityAfter == null || Number.isSafeInteger(line.quantityBefore) && Number.isSafeInteger(line.quantityAfter) && line.quantityBefore >= line.quantity && line.quantityAfter === line.quantityBefore - line.quantity) &&
      [line.unitWeightKgSnapshot, line.unitVolumeM3Snapshot, line.allocatedWeightKg, line.allocatedVolumeM3, line.unitDimensionsSnapshot?.widthM, line.unitDimensionsSnapshot?.depthM, line.unitDimensionsSnapshot?.heightM].every((value: number) => Number.isFinite(value) && value > 0) &&
      near(line.unitVolumeM3Snapshot, round(line.unitDimensionsSnapshot.widthM * line.unitDimensionsSnapshot.depthM * line.unitDimensionsSnapshot.heightM, 6), 0.000001) &&
      (line.itemInstanceId ? line.allocatedWeightKg <= line.unitWeightKgSnapshot + 0.001 && line.allocatedVolumeM3 <= line.unitVolumeM3Snapshot + 0.000001 :
        near(line.allocatedWeightKg, round(line.unitWeightKgSnapshot * line.quantity, 3), 0.001) && near(line.allocatedVolumeM3, round(line.unitVolumeM3Snapshot * line.quantity, 6), 0.000001));
    const validInstances = (lines: any[]) => {
      const groups = new Map<string, any[]>(); for (const line of lines) if (line.itemInstanceId) groups.set(line.itemInstanceId, [...(groups.get(line.itemInstanceId) ?? []), line]);
      return [...groups.values()].every(group => new Set(group.map(line => String(line.cellId))).size === group.length &&
        near(group.reduce((sum, line) => sum + line.allocatedWeightKg, 0), group[0].unitWeightKgSnapshot, 0.001) &&
        near(group.reduce((sum, line) => sum + line.allocatedVolumeM3, 0), group[0].unitVolumeM3Snapshot, 0.000001) &&
        group.every(line => line.receiptId === group[0].receiptId && line.unitWeightKgSnapshot === group[0].unitWeightKgSnapshot && line.unitVolumeM3Snapshot === group[0].unitVolumeM3Snapshot));
    };
    const shape = effect && this.itemSpecId && this.operationId === effect.operationId && !!effect.requestHash && !!this.idempotencyKey &&
      (!multiLineContract || !!effect.accessSessionId && !!this.movementCode && !!this.referenceCode) && !this.v3Effect && !this.batchLines && this.arithmeticPolicy == null &&
      (action === 'ADD' ? !source.length && destination.length > 0 : action === 'REMOVE' ? source.length > 0 && !destination.length : action === 'MOVE' && source.length > 0 && destination.length > 0) &&
      [source, destination].every(lines => new Set(lines.map(uniqueKey)).size === lines.length && lines.every(validLine) && validInstances(lines));
    const uniqueInstances = new Set(eventRows.filter(line => line.itemInstanceId).map(line => line.itemInstanceId)).size;
    const quantity = eventRows.filter(line => !line.itemInstanceId).reduce((sum, line) => sum + line.quantity, 0) + uniqueInstances;
    const weight = eventRows.reduce((sum, line) => sum + line.allocatedWeightKg, 0), volume = eventRows.reduce((sum, line) => sum + line.allocatedVolumeM3, 0);
    const moveConserves = action !== 'MOVE' || near(source.reduce((sum, line) => sum + line.allocatedWeightKg, 0), destination.reduce((sum, line) => sum + line.allocatedWeightKg, 0), 0.001) && near(source.reduce((sum, line) => sum + line.allocatedVolumeM3, 0), destination.reduce((sum, line) => sum + line.allocatedVolumeM3, 0), 0.000001);
    const refs = (rows: any[]) => { const totals = new Map<string, number>(); for (const row of rows) if (!row.itemInstanceId) { const key = `${row.itemSpecId}|${row.receiptId}`; totals.set(key, (totals.get(key) ?? 0) + row.quantity); } return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, qty]) => `${key}:${qty}`).join('|'); };
    const moveIdentityMatches = action !== 'MOVE' || source.filter(line => line.itemInstanceId).map(line => line.itemInstanceId).sort().join('|') === destination.filter(line => line.itemInstanceId).map(line => line.itemInstanceId).sort().join('|') && refs(source) === refs(destination);
    if (this.type !== expectedType || !shape || !Number.isSafeInteger(this.quantity) || this.quantity !== quantity || !near(this.actualTotalWeightKg, weight, 0.001) || !near(this.actualTotalVolumeM3, volume, 0.000001) || !moveConserves || !moveIdentityMatches) this.invalidate('stockEffect', 'Schema v4 Item Specification stock effects, quantities and physical totals are invalid');
    if (this.sourceCellId != null || this.destinationCellId != null || this.v3Effect != null) this.invalidate('stockEffect', 'Schema v4 cannot use legacy single-Cell or A1/A2 placement fields');
  } else if (this.stockEffect != null || this.itemSpecId != null) {
    this.invalidate('stockEffect', 'V4 stock effect fields require schema version 4');
  }
  if (this.schemaVersion !== 3 && this.schemaVersion !== 4 && this.type === ItemMovementType.INBOUND) {
    if (!this.destinationCellId || this.sourceCellId != null || !this.inspectionNote) {
      this.invalidate('destinationCellId', 'INBOUND must move from outside to a destination Cell');
    }
  } else if (this.schemaVersion !== 3 && this.schemaVersion !== 4 && this.type === ItemMovementType.OUTBOUND) {
    if (!this.sourceCellId || this.destinationCellId != null || !this.handoverNote) {
      this.invalidate('sourceCellId', 'OUTBOUND must move from a source Cell to outside');
    }
  } else if (this.schemaVersion !== 3 && this.schemaVersion !== 4 && this.type === ItemMovementType.RELOCATION) {
    if (!this.sourceCellId || !this.destinationCellId || this.sourceCellId.equals(this.destinationCellId) ||
        !this.previousPlacementMovementId || !this.relocationNote ||
        (this.quantity > 1 && this.physicalPackingConfirmed !== true)) {
      this.invalidate('destinationCellId', 'RELOCATION must move a whole lot between distinct Cells with placement lineage and a note');
    }
  }
  if (this.schemaVersion === 2) {
    const lines = this.batchLines ?? [];
    if (this.isNew && this.type === ItemMovementType.OUTBOUND && lines.some(line => !line.receiptMovementId)) {
      this.invalidate('batchLines', 'New canonical OUTBOUND movements must retain each source receipt movement reference');
    }
    const expectedAction = this.type === ItemMovementType.INBOUND ? MovementBatchAction.ADD
      : this.type === ItemMovementType.OUTBOUND ? MovementBatchAction.REMOVE : MovementBatchAction.MOVE;
    const linesWeight = lines.reduce((sum, line) => sum + Number(line.actualTotalWeightKg), 0);
    const linesVolume = lines.reduce((sum, line) => sum + Number(line.actualTotalVolumeM3), 0);
    const canonical = this.arithmeticPolicy === 'CANONICAL_V1';
    const invalidLine = lines.some(line => {
      const dimensions = line.actualUnitDimensionsM;
      const validDimensions = dimensions && [dimensions.widthM, dimensions.depthM, dimensions.heightM]
        .every(value => Number.isFinite(value) && value > 0);
      const unitVolume = validDimensions ? dimensions.widthM * dimensions.depthM * dimensions.heightM : NaN;
      const canonicalWeight = roundedProductUnits([line.actualUnitWeightKg], line.quantity, 3);
      const canonicalVolume = roundedProductUnits([dimensions?.widthM, dimensions?.depthM, dimensions?.heightM].map(Number), line.quantity, 6);
      return line.action !== expectedAction || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        typeof line.quantityUnit !== 'string' || !line.quantityUnit.trim() || line.quantityUnit !== this.quantityUnit ||
        !Number.isFinite(line.actualUnitWeightKg) || line.actualUnitWeightKg <= 0 ||
        !Number.isFinite(line.actualTotalWeightKg) || line.actualTotalWeightKg <= 0 ||
        !Number.isFinite(line.actualTotalVolumeM3) || line.actualTotalVolumeM3 <= 0 || !validDimensions ||
        (canonical
          ? canonicalWeight === null || canonicalVolume === null ||
            !exactUnitsEqual(line.actualTotalWeightKg, canonicalWeight, 3) ||
            !exactUnitsEqual(line.actualTotalVolumeM3, canonicalVolume, 6)
          : !near(round(line.actualUnitWeightKg * line.quantity, 3), round(line.actualTotalWeightKg, 3), 0.001) ||
            !near(round(unitVolume * line.quantity, 6), round(line.actualTotalVolumeM3, 6), 0.000001));
    });
    const firstLine = lines[0];
    const firstDimensions = firstLine?.actualUnitDimensionsM;
    const parentMatchesFirstLine = firstLine && firstDimensions &&
      near(this.actualUnitWeightKg, firstLine.actualUnitWeightKg, 0.001) &&
      near(this.actualUnitDimensionsM?.widthM, firstDimensions.widthM, 0.000001) &&
      near(this.actualUnitDimensionsM?.depthM, firstDimensions.depthM, 0.000001) &&
      near(this.actualUnitDimensionsM?.heightM, firstDimensions.heightM, 0.000001);
    const canonicalWeightTotal = canonical ? sumExactPrecisionUnits(lines.map(line => line.actualTotalWeightKg), 3) : null;
    const canonicalVolumeTotal = canonical ? sumExactPrecisionUnits(lines.map(line => line.actualTotalVolumeM3), 6) : null;
    const parentTotalsInvalid = canonical
      ? canonicalWeightTotal === null || canonicalVolumeTotal === null ||
        !exactUnitsEqual(this.actualTotalWeightKg, canonicalWeightTotal, 3) ||
        !exactUnitsEqual(this.actualTotalVolumeM3, canonicalVolumeTotal, 6)
      : Math.abs(linesWeight - this.actualTotalWeightKg) > 0.001 || Math.abs(linesVolume - this.actualTotalVolumeM3) > 0.000001;
    if (!lines.length || invalidLine || !parentMatchesFirstLine ||
        lines.reduce((sum, line) => sum + line.quantity, 0) !== this.quantity || parentTotalsInvalid) {
      this.invalidate('batchLines', 'Schema v2 batch lines must match movement quantity, units, physical arithmetic, and parent totals');
    }
  } else if (this.batchLines !== undefined && this.batchLines !== null) {
    this.invalidate('batchLines', 'Batch lines require movement schema version 2');
  }
});

schema.index({ itemId: 1, performedAt: -1, _id: -1 });
schema.index({ facilityId: 1, performedAt: -1 });
schema.index({ managedReservationId: 1, performedAt: -1 });
schema.index({ itemId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ operationId: 1 }, { unique: true, partialFilterExpression: { operationId: { $type: 'string' } } });
schema.index({ movementCode: 1 }, { unique: true, partialFilterExpression: { movementCode: { $type: 'string' } } });

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function () {
  throw new Error('ItemMovement records are append-only');
});
schema.pre('save', function () {
  if (!this.isNew) throw new Error('ItemMovement records are append-only');
});
schema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('ItemMovement records are append-only');
});

export default mongoose.model<IItemMovement>('ItemMovement', schema);
