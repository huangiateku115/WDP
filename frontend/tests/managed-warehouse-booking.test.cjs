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
