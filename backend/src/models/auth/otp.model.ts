import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpDocument extends Document {
  email: string;
  otp: string;
  createdAt: Date;
}

const otpSchema = new Schema(
  {
    email: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 30000 }, // TTL index: auto delete after 300 seconds (5 mins)
  }
);

export const OtpModel = mongoose.model<IOtpDocument>('Otp', otpSchema);
