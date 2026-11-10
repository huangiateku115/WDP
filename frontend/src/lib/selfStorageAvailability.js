export function monthKey(date) {
  const value = date instanceof Date ? date : new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) return '';
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month, offset) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isSafeInteger(offset)) return '';
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return monthKey(date);
}

export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function buildAvailabilityDays(month, intervals = [], today = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const todayKey = today instanceof Date ? utcToday(today) : String(today);
  const days = Array.from({ length: leading + count }, (_, index) => {
    if (index < leading) return null;
    const date = new Date(Date.UTC(year, monthNumber - 1, index - leading + 1));
    const key = date.toISOString().slice(0, 10);
    const next = new Date(date.getTime() + 86_400_000);
    const booked = intervals.some((interval) => {
      const start = Date.parse(interval?.startDate || '');
      const end = Date.parse(interval?.endDate || '');
      return Number.isFinite(start) && Number.isFinite(end) && start < next.getTime() && end > date.getTime();
    });
    return { date: key, day: date.getUTCDate(), past: key < todayKey, booked };
  });
  while (days.length % 7) days.push(null);
  return days;
}

export function rangeContainsDay(startDate, endDate, day) {
  if (!startDate || !endDate || !day) return false;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const date = Date.parse(`${day}T00:00:00.000Z`);
  return [start, end, date].every(Number.isFinite) && start < date + 86_400_000 && end > date;
}

export function availabilityMatches(response, { unitId, month, startDate, endDate }) {
  if (!response || String(response.storageUnitId?._id || response.storageUnitId) !== unitId || response.month !== month || !['VERIFIED', 'UNKNOWN', 'UNIT_UNAVAILABLE'].includes(response.availabilityState) || !Array.isArray(response.intervals)) return false;
  if (response.intervals.some(interval => {
    const start = Date.parse(interval?.startDate || ''), end = Date.parse(interval?.endDate || '');
    return !Number.isFinite(start) || !Number.isFinite(end) || start >= end;
  })) return false;
  if (!startDate && !endDate) return true;
  if (!['AVAILABLE', 'CONFLICT', 'UNIT_UNAVAILABLE', 'UNKNOWN'].includes(response.rangeAvailability)) return false;
  return response.requestedRange?.startDate === `${startDate}T00:00:00.000Z` &&
    response.requestedRange?.endDate === `${endDate}T00:00:00.000Z`;
}
