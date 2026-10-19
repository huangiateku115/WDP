export function cellWeightUsageText(usedWeightKg, maxWeightKg, physicalUsageKnown = true) {
  if (!physicalUsageKnown) return 'Usage unknown';
  if (![usedWeightKg, maxWeightKg].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return 'Not returned';
  return `${usedWeightKg.toLocaleString()}/${maxWeightKg.toLocaleString()} kg`;
}

export function cellTilePresentation(cell) {
  return {
    status: cell?.displayStatus || cell?.operationalStatus || 'unknown',
    weightUsage: cell?.maxWeightKg == null ? '' : cellWeightUsageText(cell.usedWeightKg, cell.maxWeightKg, cell.physicalUsageKnown !== false),
    volume: cell?.maxVolumeM3 == null ? '' : `${Number(cell.maxVolumeM3).toFixed(3)} m³`,
    requestedPeriodStatus: cell?.periodStatus || 'availability not checked',
  };
}

export function availableCellCount(racks, requestedPeriod) {
  const field = requestedPeriod ? 'availableForPeriodCellCount' : 'availableCellCount';
  if (!Array.isArray(racks) || racks.some(rack => !Number.isSafeInteger(rack?.[field]) || rack[field] < 0)) return null;
  return racks.reduce((sum, rack) => sum + rack[field], 0);
}

export function managedBookingRecovery(status) {
  if (status !== 409) return null;
  return {
    refreshAvailability: true,
    invalidateQuote: true,
    clearSelection: true,
    retryAutomatically: false,
    message: 'Availability changed before booking. The quote was cleared and your Cells were deselected. Review the refreshed map, select Cells again, and request a new quote.',
  };
}
