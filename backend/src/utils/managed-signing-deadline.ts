/** Exclusive signing deadline: midnight Asia/Ho_Chi_Minh after the third local
 * calendar day starting on the immutable rental start date. */
export function managedSigningDeadline(startDate: Date): Date {
  if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime())) throw new TypeError('A valid rental start date is required');
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startDate);
  const parts = localDate.split('-').map(Number);
  const year = parts[0]!, month = parts[1]!, day = parts[2]!;
  return new Date(Date.UTC(year, month - 1, day + 4) - 7 * 60 * 60 * 1000);
}
