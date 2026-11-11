import { model, Schema } from 'mongoose';
import { PricingRule, PricingBasis, TermUnit } from '../../types/pricing-policy.type';
import { FacilityServiceType } from '../../types/facility.type';
import { StorageUnitSize } from '../../types/storage-unit.type';
import { effectiveFields } from './effective.schema';

const schema = new Schema<PricingRule>({
  ...effectiveFields,
  serviceType: { type: String, required: true, enum: Object.values(FacilityServiceType), immutable: true },
  billingBasis: { type: String, enum: Object.values(PricingBasis), immutable: true },
  unitSize: { type: String, enum: Object.values(StorageUnitSize), immutable: true },
  term: { type: new Schema({
    value: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    unit: { type: String, required: true, enum: Object.values(TermUnit) },
  }, { _id: false }), required: true, immutable: true },
  price: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
  currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  priceRevisions: { type: [new Schema({
    version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    price: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
  }, { _id: false })], default: undefined },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ facilityId: 1, serviceType: 1, billingBasis: 1, unitSize: 1, 'term.value': 1, 'term.unit': 1, isActive: 1, effectiveFrom: 1, effectiveTo: 1 });
export default model<PricingRule>('PricingRule', schema);
