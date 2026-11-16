const test = require('node:test');
const assert = require('node:assert/strict');

test('cell usage is shown as current kg over maximum kg', async () => {
  const { cellTilePresentation } = await import('../src/lib/managedBookingDisplay.js');
  const tile = cellTilePresentation({ usedWeightKg: 40, maxWeightKg: 100, maxVolumeM3: 0.12, displayStatus: 'OCCUPIED', periodStatus: 'RESERVED' });
  assert.equal(tile.weightUsage, '40/100 kg');
  assert.equal(tile.status, 'OCCUPIED');
  assert.equal(tile.requestedPeriodStatus, 'RESERVED');
  assert.equal(tile.volume, '0.120 m³');
  assert.equal(cellTilePresentation({ usedWeightKg: 0, maxWeightKg: 100, physicalUsageKnown: false }).weightUsage, 'Usage unknown');
});

test('availability statistics distinguish requested periods from current availability', async () => {
  const { availableCellCount } = await import('../src/lib/managedBookingDisplay.js');
  const racks = [{ availableCellCount: 5, availableForPeriodCellCount: 2 }];
  assert.equal(availableCellCount(racks, false), 5);
  assert.equal(availableCellCount(racks, true), 2);
});

test('allocation conflict recovery refreshes, invalidates stale quote, and never retries automatically', async () => {
  const { managedBookingRecovery } = await import('../src/lib/managedBookingDisplay.js');
  assert.deepEqual(managedBookingRecovery(409), {
    refreshAvailability: true,
    invalidateQuote: true,
    clearSelection: true,
    retryAutomatically: false,
    message: 'Availability changed before booking. The quote was cleared and your Cells were deselected. Review the refreshed map, select Cells again, and request a new quote.',
  });
  assert.equal(managedBookingRecovery(400), null);
});

test('booking eligibility comes from the Backend booking decision, not an inventory reconciliation flag', async () => {
  const { cellPeriodStatus } = await import('../src/lib/warehouseMap.js');
  const { cellBookingReason } = await import('../src/lib/managedCellBooking.js');
  const range={startDate:'2026-11-20T00:00:00.000Z',endDate:'2026-12-20T00:00:00.000Z'},
    rack={_id:'a'.repeat(24),facilityId:'b'.repeat(24),operationalStatus:'AVAILABLE'},
    cell={_id:'c'.repeat(24),facilityId:rack.facilityId,operationalStatus:'AVAILABLE',bookingStatus:'AVAILABLE',periodStatus:'AVAILABLE',displayStatus:'AVAILABLE',isBookable:true,dimensions:{widthM:1,depthM:1,usableHeightM:1},physicalUsageKnown:false};
  assert.equal(cellPeriodStatus(cell),'AVAILABLE');
  assert.equal(cellBookingReason(cell,rack,range),'');
  assert.equal(cellPeriodStatus({...cell,isBookable:false}),'UNAVAILABLE');
  assert.notEqual(cellBookingReason({...cell,isBookable:false},rack,range),'');
});
