export const MANAGED_VISIT_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;

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
