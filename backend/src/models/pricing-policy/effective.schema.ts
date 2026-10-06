import { Schema } from 'mongoose';

export const effectiveFields = {
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date },
  isActive: { type: Boolean, required: true, default: true },
  version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
};
