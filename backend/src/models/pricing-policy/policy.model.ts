import { model, Schema } from 'mongoose';
import { Policy, PolicyType } from '../../types/pricing-policy.type';
import { FacilityServiceType } from '../../types/facility.type';
import { effectiveFields } from './effective.schema';

const schema = new Schema<Policy>({
  ...effectiveFields,
  serviceType: { type: String, enum: Object.values(FacilityServiceType), immutable: true },
  type: { type: String, required: true, enum: Object.values(PolicyType), immutable: true },
  config: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, optimisticConcurrency: true, minimize: false });
schema.index({ facilityId: 1, type: 1, serviceType: 1, isActive: 1, effectiveFrom: 1, effectiveTo: 1 });
export default model<Policy>('Policy', schema);
