export const MANAGED_VISIT_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;
export const MANAGED_VISIT_MAX_DAYS_AHEAD = 30;
const VN_OFFSET_MS = 7 * 60 * 60_000;

function vnDateKey(date: Date) { return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10); }
function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function managedVisitDateBounds(now: Date) {
  const minDate = vnDateKey(now);
  return { minDate, maxDate: addCalendarDays(minDate, MANAGED_VISIT_MAX_DAYS_AHEAD) };
}

export function isManagedVisitDateBookable(dateInput: unknown, now: Date) {
  const day = managedVisitDateRange(dateInput);
  if (!day) return false;
  const bounds = managedVisitDateBounds(now);
  return day.dateInput >= bounds.minDate && day.dateInput <= bounds.maxDate;
}

export interface ManagedVisitScheduleInput {
  timeZone: typeof MANAGED_VISIT_TIME_ZONE;
  slotDurationMinutes: number;
  weeklyHours: Array<{ weekday: number; opensAt: string; closesAt: string }>;
}

export function managedVisitDateRange(dateInput: unknown) {
  if (typeof dateInput !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const noonUtc = new Date(`${dateInput}T12:00:00.000Z`);
  if (!Number.isFinite(noonUtc.getTime()) || noonUtc.toISOString().slice(0, 10) !== dateInput) return null;
  const start = new Date(`${dateInput}T00:00:00+07:00`);
  return { dateInput, weekday: noonUtc.getUTCDay(), start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}
function minutes(value: string) { const hour = Number(value.slice(0, 2)), minute = Number(value.slice(3, 5)); return hour * 60 + minute; }

export function managedVisitSlots(input: {
  date: unknown;
  schedule: ManagedVisitScheduleInput;
  now: Date;
  reservationStartDate: Date;
  reservationEndDate: Date;
  staffCapacity: number;
  overlappingVisitCount: (startsAt: Date, endsAt: Date) => number;
}) {
  const day = managedVisitDateRange(input.date);
  if (!day) throw new Error('VISIT_DATE_INVALID');
  if (!isManagedVisitDateBookable(input.date, input.now)) throw new Error('VISIT_DATE_OUT_OF_RANGE');
  const duration = input.schedule?.slotDurationMinutes;
  if (input.schedule?.timeZone !== MANAGED_VISIT_TIME_ZONE || !Number.isSafeInteger(duration) || duration < 30 || duration > 480) throw new Error('VISIT_SCHEDULE_INVALID');
  const hours = input.schedule.weeklyHours.find(row => row.weekday === day.weekday);
  if (!hours) return [];
  const open = minutes(hours.opensAt), close = minutes(hours.closesAt), slots = [];
  for (let minute = open; minute + duration <= close; minute += duration) {
    const startsAt = new Date(day.start.getTime() + minute * 60_000);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (startsAt < input.now || startsAt < input.reservationStartDate || endsAt > input.reservationEndDate) continue;
    if (input.staffCapacity - input.overlappingVisitCount(startsAt, endsAt) < 1) continue;
    slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
  }
  return slots;
}
