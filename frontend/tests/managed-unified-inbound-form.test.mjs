import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnifiedInboundPayload, createUnifiedInboundLine, refreshUnifiedInboundLines } from '../src/components/customer/inventory/managedUnifiedInboundForm.js';
import { managedUnifiedInboundErrorMessage } from '../src/components/customer/inventory/managedUnifiedInboundErrors.js';

const ids = { session: '111111111111111111111111', sku: '222222222222222222222222', spec: '333333333333333333333333', cell: '444444444444444444444444' };

test('auto-selected, added and refreshed inbound lines carry the current Item Specification revision', () => {
  const specification = { _id: ids.spec, revision: 7, status: 'ACTIVE' };
  const autoSelected = createUnifiedInboundLine(specification, ids.cell, 'auto-line');
  const addedLine = createUnifiedInboundLine(specification, ids.cell, 'added-line');
  assert.equal(autoSelected.itemSpecRevision, 7);
  assert.equal(addedLine.itemSpecRevision, 7);
  const refreshed = refreshUnifiedInboundLines([{ ...autoSelected, quantity: 4, notes: 'keep form' }], [{ ...specification, revision: 8 }], ids.cell);
  assert.equal(refreshed[0].itemSpecRevision, 8);
  assert.equal(refreshed[0].quantity, 4);
  assert.equal(refreshed[0].notes, 'keep form');
});

test('unified inbound form normalizes numeric input and builds the multi-line API contract', () => {
  const result = buildUnifiedInboundPayload({ accessSessionId: ids.session, sessionRevision: 1, skuRevision: 3, lines: [
    { lineId: 'line-a', itemSpecId: ids.spec, itemSpecRevision: 2, quantity: '3', measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: ids.cell, quantity: '3' }] },
    { lineId: 'line-b', itemSpecId: ids.spec, itemSpecRevision: 2, quantity: 1, measurementMode: 'MEASURED', actualUnitWeightKg: '5.5', dimensionsM: { widthM: '0.4', depthM: '0.3', heightM: '0.3' }, cellAllocations: [{ cellId: ids.cell, quantity: 1 }] },
  ] });
  assert.deepEqual(result.errors, {});
  assert.equal(result.payload.lines[0].quantity, 3);
  assert.equal(typeof result.payload.lines[0].cellAllocations[0].quantity, 'number');
  assert.equal(result.payload.lines[1].actualUnitWeightKg, 5.5);
  assert.equal(result.payload.lines[1].dimensionsM.widthM, .4);
});

test('unified inbound form blocks invalid allocation totals, missing Session and non-finite measures', () => {
  const result = buildUnifiedInboundPayload({ accessSessionId: '', sessionRevision: 1, skuRevision: 1, lines: [
    { lineId: 'bad', itemSpecId: ids.spec, itemSpecRevision: 0, quantity: 2, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: ids.cell, quantity: 1 }] },
  ] });
  assert.ok(result.errors.accessSessionId);
  assert.ok(result.errors['lines.0.cellAllocations']);
});

test('legacy reconciliation conflicts are shown separately from unknown scope and Cell configuration errors', () => {
  const errorFor = code => ({ response: { data: { code, message: 'Backend diagnostic' } } });
  assert.match(managedUnifiedInboundErrorMessage(errorFor('LEGACY_STOCK_UNRECONCILED')), /tồn kho cũ chưa được đối soát/);
  assert.match(managedUnifiedInboundErrorMessage(errorFor('LEGACY_STOCK_SCOPE_UNKNOWN')), /phạm vi tồn kho cũ/);
  assert.match(managedUnifiedInboundErrorMessage(errorFor('CELL_CAPACITY_UNKNOWN')), /Sức chứa của ô kệ chưa được xác minh/);
});
