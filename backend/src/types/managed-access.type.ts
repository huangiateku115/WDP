import { Document, Types } from 'mongoose';

export const ACCESS_SESSION_MAX_DURATION_MINUTES = 60;
export enum ManagedAccessPurpose { INBOUND = 'INBOUND', OUTBOUND = 'OUTBOUND', RELOCATION = 'RELOCATION', INSPECTION = 'INSPECTION' }
export enum ManagedAccessVisitStatus { SCHEDULED = 'SCHEDULED', CHECKED_IN = 'CHECKED_IN', COMPLETED = 'COMPLETED', CANCELLED = 'CANCELLED' }
export enum ManagedAccessSessionStatus { ACTIVE = 'ACTIVE', CHECKED_OUT = 'CHECKED_OUT', REVOKED = 'REVOKED', EXPIRED = 'EXPIRED' }
export type ManagedAccessAudit = { action: string; actorId?: Types.ObjectId; actorRole: string; at: Date; details?: Record<string, unknown> };
export interface IManagedAccessVisit extends Document {
  reservationId: Types.ObjectId; customerId: Types.ObjectId; facilityId: Types.ObjectId;
  purpose: ManagedAccessPurpose; startsAt: Date; endsAt: Date; note?: string;
  status: ManagedAccessVisitStatus; assignedStaffId?: Types.ObjectId;
  idempotencyKey: string; requestHash: string; revision: number;
  checkedInAt?: Date; checkedInByStaffId?: Types.ObjectId; checkedOutAt?: Date;
  presenceAttestation?: { identityVerified: boolean; customerPresent: boolean; safetyReviewed: boolean; notes: string; actorId: Types.ObjectId; recordedAt: Date; method: 'MANUAL_STAFF_ATTESTATION' };
  assignmentHistory: Array<{ staffId: Types.ObjectId | null; actorId: Types.ObjectId; at: Date; reason: string }>;
  audit: ManagedAccessAudit[];
  createdAt: Date; updatedAt: Date;
}
export interface IManagedAccessSession extends Document {
  visitId: Types.ObjectId; reservationId: Types.ObjectId; customerId: Types.ObjectId; facilityId: Types.ObjectId;
  assignedStaffId: Types.ObjectId; allowedCellIds: Types.ObjectId[]; allowedPurposes: ManagedAccessPurpose[];
  startedAt: Date; expiresAt: Date; endedAt?: Date; revokedAt?: Date; revokedBy?: Types.ObjectId; revokeReason?: string;
  status: ManagedAccessSessionStatus; revision: number; checkInIdempotencyKey: string; checkInRequestHash?: string;
  audit: ManagedAccessAudit[]; createdAt: Date; updatedAt: Date;
}
