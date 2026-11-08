import test from 'node:test';
import assert from 'node:assert/strict';
import { receivingCellReason } from '../src/lib/receivingCellEligibility.js';

const cell = { _id: 'a', operationalStatus: 'AVAILABLE', dimensions: { widthM: 0.5, depthM: 0.6, usableHeightM: 0.4 }, maxWeightKg: 20, usedWeightKg: 4, usedVolumeM3: 0.016 };
const receipt = { quantity: 2, unitWeightKg: 2, unitDimensionsM: { widthM: 0.2, depthM: 0.2, heightM: 0.2 } };
test('additional receipt fits remaining capacity while first inbound requires empty placement', () => {
  assert.equal(receivingCellReason(cell, receipt, { currentCellId: 'a' }), '');
  assert.match(receivingCellReason(cell, receipt, { requireEmpty: true }), /empty/);
  assert.match(receivingCellReason(cell, receipt, { currentCellId: 'b' }), /current Cell/);
});
test('receiving picker rejects unknown usage, oversized goods, insufficient capacity and unavailable Cells', () => {
  assert.match(receivingCellReason({ ...cell, usedWeightKg: undefined }, receipt), /unknown/);
  assert.match(receivingCellReason(cell, { ...receipt, quantity: 10 }), /weight/);
  assert.match(receivingCellReason(cell, { ...receipt, unitDimensionsM: { widthM: 0.7, depthM: 0.2, heightM: 0.2 } }), /fit/);
  assert.match(receivingCellReason({ ...cell, operationalStatus: 'MAINTENANCE' }, receipt), /unavailable/);
  assert.equal(receivingCellReason(cell, { ...receipt, unitDimensionsM: { widthM: 0.55, depthM: 0.3, heightM: 0.2 } }), '');
});
