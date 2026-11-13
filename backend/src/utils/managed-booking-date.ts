const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function managedVietnamDateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('A valid date is required');
  const parts = VIETNAM_DATE_FORMATTER.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(row => row.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Reservation date inputs retain the existing UTC ISO representation; calendar eligibility is evaluated in Vietnam time. */
export function isManagedBookingDateAllowed(startDate: Date, now = new Date()): boolean {
  if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime()) || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  return startDate.toISOString().slice(0, 10) >= managedVietnamDateKey(now);
}
