// Customer presentation only. Server owns the lifecycle fence; no client CAS header is invented.
export function inventoryLifecycleContext(reservation) {
  const version = reservation?.inventoryVersion ?? 0;
  const known = reservation?.serviceType === 'MANAGED_INVENTORY' && Number.isSafeInteger(version) && version >= 0;
  const closurePending = reservation?.activeClosureRequestId != null;
  return { known, status: reservation?.status, inventoryVersion: known ? version : null,
    activeClosureRequestId: reservation?.activeClosureRequestId ?? null, closurePending,
    mayAddOrEdit: known && !closurePending,
    reason: !known ? 'Reservation eligibility is unknown. Refresh before submitting.' : closurePending
      ? 'Reservation closure is pending. Registration, metadata changes and additional receipts are unavailable. Reads and eligible cancellation remain available.' : '' };
}
