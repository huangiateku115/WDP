const validDate = (value: unknown): value is Date | string => value instanceof Date ? Number.isFinite(value.getTime()) : typeof value === 'string' && Number.isFinite(new Date(value).getTime());

/** Adds verified rental interval data to a newly created Self Storage pricing snapshot only. */
export function withSelfStorageRentalInterval(reservation: any, pricingSnapshot: Record<string, any>) {
  if (reservation?.serviceType !== 'SELF_STORAGE') return pricingSnapshot;
  const startDate = validDate(reservation.startDate) ? new Date(reservation.startDate) : undefined;
  const endDate = validDate(reservation.endDate) ? new Date(reservation.endDate) : undefined;
  const storedTerm = reservation.rentalPricingSnapshot?.term;
  const storedDays = Number(reservation.rentalPricingSnapshot?.durationDays);
  const derivedDays = startDate && endDate && endDate > startDate ? Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000)) : undefined;
  const durationDays = Number.isSafeInteger(storedDays) && storedDays > 0 ? storedDays : derivedDays;
  return { ...pricingSnapshot, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}),
    ...(storedTerm && Number.isSafeInteger(storedTerm.value) && storedTerm.value > 0 && ['DAY', 'MONTH', 'YEAR'].includes(storedTerm.unit)
      ? { term: { value: storedTerm.value, unit: storedTerm.unit } }
      : durationDays ? { term: { value: durationDays, unit: 'DAY' } } : {}) };
}
