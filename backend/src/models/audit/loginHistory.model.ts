import mongoose, { Schema, Document } from 'mongoose';
import { LoginEventType, LoginStatus, LoginFailureReason, ILoginHistory } from '../../types/audit.type';

export interface ILoginHistoryDocument extends ILoginHistory, Document {
  createdAt: Date;
  updatedAt: Date;
}

const loginHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    attemptedEmail: { type: String, default: null },
    eventType: { type: String, enum: Object.values(LoginEventType), required: true },
    status: { type: String, enum: Object.values(LoginStatus), required: true },
    failureReason: { type: String, enum: Object.values(LoginFailureReason), default: null },
    ip: { type: String, default: null },
    device: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

export const LoginHistoryModel = mongoose.model<ILoginHistoryDocument>('LoginHistory', loginHistorySchema);
