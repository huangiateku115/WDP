import { isBookingDateAllowed, vietnamDateKey } from './booking-date';

export const managedVietnamDateKey = vietnamDateKey;

/** Managed V3 reservation dates use the shared Vietnam calendar-day booking policy. */
export function isManagedBookingDateAllowed(startDate: Date, now = new Date()): boolean {
  return isBookingDateAllowed(startDate, now);
}
