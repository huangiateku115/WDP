import { relocationCellReason } from './relocationEligibility.js';

export function receivingCellReason(cell, receipt, { requireEmpty = false, currentCellId } = {}) {
  if (currentCellId && String(cell._id) !== String(currentCellId)) return 'Additional receipts must use the current Cell';
  if (requireEmpty && (cell.usedWeightKg > 0 || cell.usedVolumeM3 > 0)) return 'First inbound requires an empty Cell';
  const quantity = Number(receipt.quantity);
  const unitWeight = Number(receipt.unitWeightKg);
  const dimensions = receipt.unitDimensionsM;
  return relocationCellReason({ ...cell, isCurrent: false }, {
    onHandQuantity: quantity,
    heldQuantity: 0,
    actualTotalWeightKg: quantity * unitWeight,
    actualTotalVolumeM3: quantity * dimensions?.widthM * dimensions?.depthM * dimensions?.heightM,
    batches: [{ quantity, actualUnitDimensionsM: dimensions }],
  });
}
