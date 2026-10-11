import { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { IReservation, ReservationStatus } from '../../types/reservation.type';

export class ManagedReservationGuardError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Read-only eligibility check. It never creates, updates, or reserves rental capacity. */
export async function requireActiveManagedInventoryReservation(
  reservationId: string | Types.ObjectId,
  customerId: string | Types.ObjectId,
  expectedFacilityId?: string | Types.ObjectId,
  session?: ClientSession,
): Promise<IReservation> {
  const reservationObjectId = typeof reservationId === 'string' ? new Types.ObjectId(reservationId) : reservationId;
  const customerObjectId = typeof customerId === 'string' ? new Types.ObjectId(customerId) : customerId;
  const filter = {
    _id: reservationObjectId,
    customerId: customerObjectId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY,
    status: ReservationStatus.ACTIVE,
  };
  let reservationQuery = ReservationModel.findOne(filter);
  if (session) reservationQuery = reservationQuery.session(session);
  const reservation = await reservationQuery.exec();
  if (!reservation) throw new ManagedReservationGuardError(404, 'Active Managed Inventory rental not found');
  if (expectedFacilityId && reservation.facilityId.toString() !== expectedFacilityId.toString().toLowerCase()) {
    throw new ManagedReservationGuardError(409, 'Managed Inventory rental Facility does not match the item');
  }
  // The Reservation schema stores allocatedCapacity as a number; per SRS this is m3.
  if (reservation.allocatedCapacity === undefined || !Number.isFinite(Number(reservation.allocatedCapacity)) || Number(reservation.allocatedCapacity) <= 0) {
    throw new ManagedReservationGuardError(409, 'Managed Inventory rental has no valid allocated capacity in m3');
  }
  let facilityQuery = FacilityModel.findOne({
    _id: reservation.facilityId,
    status: FacilityStatus.ACTIVE,
    serviceTypes: FacilityServiceType.MANAGED_INVENTORY,
    deletedAt: { $exists: false },
  });
  if (session) facilityQuery = facilityQuery.session(session);
  if (!await facilityQuery.exec()) throw new ManagedReservationGuardError(409, 'Managed Inventory Facility is not active');
  return reservation;
}
