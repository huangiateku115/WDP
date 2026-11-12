import { ACCESS_SESSION_MAX_DURATION_MINUTES, ManagedAccessPurpose, ManagedAccessSessionStatus } from '../../types/managed-access.type';

export function sessionExpiry(startedAt: Date, boundaries: Date[] = []): Date {
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) throw new Error('Invalid server start time');
  const maximum = startedAt.getTime() + ACCESS_SESSION_MAX_DURATION_MINUTES * 60_000;
  const validBoundaries = boundaries.map(value => value instanceof Date ? value.getTime() : Number.NaN);
  if (validBoundaries.some(value => !Number.isFinite(value) || value <= startedAt.getTime())) throw new Error('Invalid session expiry boundary');
  return new Date(Math.min(maximum, ...validBoundaries));
}

export function sessionIsCurrent(input: { status: ManagedAccessSessionStatus; startedAt: Date; expiresAt: Date; now: Date }): boolean {
  return input.status === ManagedAccessSessionStatus.ACTIVE && input.startedAt instanceof Date && input.expiresAt instanceof Date && input.now instanceof Date &&
    Number.isFinite(input.startedAt.getTime()) && Number.isFinite(input.expiresAt.getTime()) && Number.isFinite(input.now.getTime()) &&
    input.startedAt <= input.now && input.expiresAt > input.now;
}

export function isAccessSessionAllowed(input: {
  status: ManagedAccessSessionStatus; startedAt: Date; expiresAt: Date; revision: number;
  customerId: string; reservationId: string; facilityId: string; allowedPurposes: ManagedAccessPurpose[]; allowedCellIds: string[];
  expected: { now: Date; revision: number; customerId: string; reservationId: string; facilityId: string; purpose: ManagedAccessPurpose; cellId: string };
}): boolean {
  const { expected } = input;
  return sessionIsCurrent({ status: input.status, startedAt: input.startedAt, expiresAt: input.expiresAt, now: expected.now }) &&
    input.revision === expected.revision && input.customerId === expected.customerId && input.reservationId === expected.reservationId &&
    input.facilityId === expected.facilityId && input.allowedPurposes.includes(expected.purpose) && input.allowedCellIds.includes(expected.cellId);
}
