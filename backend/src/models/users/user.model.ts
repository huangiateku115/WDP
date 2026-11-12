import mongoose, { Schema } from 'mongoose';
import { IUser, UserRole } from '../../types/user.type';

const userSchema = new Schema<IUser>(
  {
    keycloakSub: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
    },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true,
      index: true 
    },
    displayName: { 
      type: String, 
      required: true, 
      trim: true 
    },
    phone: { 
      type: String, 
      trim: true 
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.CUSTOMER
    },
    assignedFacilityId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Facility',
      default: null
    },
    managedAccessScheduleRevision: { type: Number, min: 0, default: 0, select: false },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    lastLoginAt: { 
      type: Date 
    }
  },
  {
    timestamps: true // Tự động tạo createdAt và updatedAt
  }
);

const UserModel = mongoose.model<IUser>('User', userSchema);

export default UserModel;
