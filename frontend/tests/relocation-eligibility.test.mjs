import test from 'node:test';
import assert from 'node:assert/strict';
import {relocationCellReason} from '../src/lib/relocationEligibility.js';

const cell = {operationalStatus:'AVAILABLE',dimensions:{widthM:0.5,depthM:0.6,usableHeightM:0.4},maxWeightKg:125,usedWeightKg:0,usedVolumeM3:0};
const balance = {onHandQuantity:2,heldQuantity:0,actualTotalWeightKg:4,actualTotalVolumeM3:0.016,batches:[{quantity:2,actualUnitDimensionsM:{widthM:0.2,depthM:0.2,heightM:0.2}}]};

test('relocation picker rejects unknown usage, holds and insufficient capacity',()=>{
  assert.equal(relocationCellReason(cell,balance),'');
  assert.match(relocationCellReason({...cell,usedWeightKg:undefined},balance),/unknown/);
  assert.match(relocationCellReason(cell,{...balance,heldQuantity:1}),/holds/);
  assert.match(relocationCellReason({...cell,usedWeightKg:124},balance),/weight/);
  assert.match(relocationCellReason({...cell,usedVolumeM3:0.119},balance),/volume/);
});

test('relocation picker checks every remaining receipt batch including rotated units',()=>{
  const rotated = {...balance,batches:[{quantity:2,actualUnitDimensionsM:{widthM:0.55,depthM:0.45,heightM:0.2}}]};
  assert.equal(relocationCellReason(cell,rotated),'');
  assert.match(relocationCellReason(cell,{...balance,batches:[...balance.batches,{quantity:1,actualUnitDimensionsM:{widthM:0.7,depthM:0.2,heightM:0.2}}]}),/does not fit/);
  assert.match(relocationCellReason(cell,{...balance,batches:[]}),/unavailable/);
});
