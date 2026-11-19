import { Types } from 'mongoose';
import UserModel from '../../models/users/user.model';
import { UserRole } from '../../types/user.type';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export class NotificationRecipientResolver {
  /** Customer identity is taken from the backend-owned business entity, then checked against an active Customer account. */
  static async resolveReservationCustomer(reservation: any): Promise<string | null> {
    const rawId = reservation?.customerId?._id ?? reservation?.customerId;
    const userId = rawId instanceof Types.ObjectId ? rawId.toString() : String(rawId ?? '');
    if (!validId(userId)) return null;
    const user = await UserModel.findOne({ _id: userId, role: UserRole.CUSTOMER, isActive: true }).select('_id').lean().exec();
    return user?._id ? String(user._id) : null;
  }

  /** Only an explicitly assigned Staff/Manager recipient is eligible; this never broadcasts to a whole Facility. */
  static async resolveAssignedFacilityRecipient(userIdInput: unknown, facilityIdInput: unknown,
    role: typeof UserRole.FACILITY_STAFF | typeof UserRole.FACILITY_MANAGER): Promise<string | null> {
    const userId = userIdInput instanceof Types.ObjectId ? userIdInput.toString() : String(userIdInput ?? '');
    const facilityId = facilityIdInput instanceof Types.ObjectId ? facilityIdInput.toString() : String(facilityIdInput ?? '');
    if (!validId(userId) || !validId(facilityId) || ![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(role)) return null;
    const user = await UserModel.findOne({ _id: userId, assignedFacilityId: facilityId, role, isActive: true }).select('_id').lean().exec();
    return user?._id ? String(user._id) : null;
  }
}
