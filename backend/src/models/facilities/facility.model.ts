import mongoose, { Schema } from 'mongoose';
import { FacilityAddress, FacilityContact, FacilityServiceType, FacilityStatus, IFacility } from '../../types/facility.type';

const addressSchema = new Schema<FacilityAddress>({
  line1: { type: String, required: true, trim: true },
  ward: { type: String, trim: true },
  district: { type: String, trim: true },
  city: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true },
}, { _id: false });
const contactSchema = new Schema<FacilityContact>({
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
}, { _id: false });
const facilitySchema = new Schema<IFacility>({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  name: { type: String, required: true, trim: true },
  address: { type: addressSchema, required: true },
  contact: { type: contactSchema },
  serviceTypes: {
    type: [{ type: String, enum: Object.values(FacilityServiceType) }],
    required: true,
    validate: {
      validator: (values: string[]) => Array.isArray(values) && values.length > 0 &&
        values.length <= 2 && new Set(values).size === values.length,
      message: 'serviceTypes must contain one or two distinct supported service types',
    },
  },
  status: { type: String, enum: Object.values(FacilityStatus), default: FacilityStatus.ACTIVE, index: true },
  description: { type: String, trim: true },
  operatingHours: { type: String, trim: true },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
facilitySchema.index({ serviceTypes: 1 });
facilitySchema.index({ deletedAt: 1 });

export default mongoose.model<IFacility>('Facility', facilitySchema);
