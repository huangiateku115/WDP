const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Returns a calendar date key in the Customer-facing Vietnam timezone. */
export function vietnamDateKey(value: Date | number = new Date()) {
  const parts = vietnamDateFormatter.formatToParts(value instanceof Date ? value : new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(row => row.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Booking date fields use a date-only UTC key; eligibility is based on the VN calendar day. */
export function isTodayOrFutureVietnamDate(date: string, now: Date | number = Date.now()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= vietnamDateKey(now);
}
