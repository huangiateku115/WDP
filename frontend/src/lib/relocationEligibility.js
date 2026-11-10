const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function relocationCellReason(cell, balance) {
  if (cell.isCurrent) return 'Current placement';
  if (cell.operationalStatus !== 'AVAILABLE') return 'Cell is unavailable';
  if (!balance || !Number.isSafeInteger(balance.onHandQuantity) || balance.onHandQuantity <= 0) return 'Stock is not verified';
  if (balance.heldQuantity !== 0) return 'Resolve quantity holds before moving';
  const dimensions = cell.dimensions;
  if (!dimensions || ![dimensions.widthM, dimensions.depthM, dimensions.usableHeightM, cell.maxWeightKg].every(positive) ||
      ![cell.usedWeightKg, cell.usedVolumeM3].every(nonnegative)) return 'Cell measurements or usage are unknown';
  if (![balance.actualTotalWeightKg, balance.actualTotalVolumeM3].every(positive)) return 'Stock measurements are unknown';
  if (cell.usedWeightKg + balance.actualTotalWeightKg > cell.maxWeightKg) return 'Insufficient remaining weight capacity';
  const cellVolume = dimensions.widthM * dimensions.depthM * dimensions.usableHeightM;
  if (cell.usedVolumeM3 + balance.actualTotalVolumeM3 > cellVolume + 1e-9) return 'Insufficient remaining volume';
  const batches = balance.batches?.filter(batch => batch.quantity > 0);
  if (!batches?.length) return 'Receipt batch measurements are unavailable';
  for (const batch of batches) {
    const unit = batch.actualUnitDimensionsM;
    if (!unit || ![unit.widthM, unit.depthM, unit.heightM].every(positive)) return 'Receipt batch measurements are unavailable';
    const fits = (unit.widthM <= dimensions.widthM && unit.depthM <= dimensions.depthM) ||
      (unit.depthM <= dimensions.widthM && unit.widthM <= dimensions.depthM);
    if (!fits || unit.heightM > dimensions.usableHeightM) return 'A handling unit does not fit this Cell';
  }
  return '';
}
