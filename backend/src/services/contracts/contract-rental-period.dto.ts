const dateValue = (value: unknown) => value instanceof Date || typeof value === 'string' ? value : null;

/** Adds read-only current-period and verified extension history without rewriting the signed snapshot. */
export function contractRentalPeriodDto(contract: any) {
  const row = contract && typeof contract.toObject === 'function' ? contract.toObject() : { ...contract };
  const reservation = row.reservationId && typeof row.reservationId === 'object' ? row.reservationId : null;
  const original = row.pricingSnapshot ?? {};
  const activeExtensions = Array.isArray(reservation?.extendContract)
    ? reservation.extendContract.filter((extension: any) => extension.status === 'ACTIVE' && extension.paymentId && extension.verifiedAt)
      .map((extension: any) => ({
        extensionId: extension._id,
        extensionCode: extension.extensionCode,
        startDate: dateValue(extension.oldEndDate),
        endDate: dateValue(extension.newEndDate),
        durationMonths: extension.durationMonths,
        amount: extension.amount,
        paymentId: extension.paymentId,
        effectiveAt: dateValue(extension.verifiedAt),
      }))
    : [];
  const renewalHistory = activeExtensions
    .sort((a: any, b: any) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());

  return {
    ...row,
    originalContractPeriod: {
      startDate: dateValue(original.startDate),
      endDate: dateValue(original.endDate),
      ...(original.term ? { term: original.term } : {}),
    },
    currentRentalPeriod: reservation ? {
      startDate: dateValue(reservation.startDate),
      endDate: dateValue(reservation.endDate),
    } : null,
    renewalHistory,
  };
}
