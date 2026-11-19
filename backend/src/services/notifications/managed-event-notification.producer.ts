import ContractModel from '../../models/contracts/contract.model';
import FacilityModel from '../../models/facilities/facility.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { FacilityServiceType } from '../../types/facility.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { NotificationType } from '../../types/notification.type';
import { NotificationRecipientResolver } from './notification-recipient-resolver.service';
import { NotificationService } from './notification.service';

const activeContractSignaturesValid = (contract: any, version: number, contentHash: string) => {
  const matches = (contract?.signatures ?? []).filter((entry: any) => entry.version === version && entry.contentHash === contentHash);
  return matches.some((entry: any) => entry.signerRole === 'CUSTOMER') &&
    matches.some((entry: any) => entry.signerRole === 'FACILITY_STAFF' || entry.signerRole === 'FACILITY_MANAGER');
};

/** Uses only append-only ManagedReservationAudit and signed signature records. */
export async function notifyManagedContractAudit(audit: any): Promise<boolean> {
  if (!NotificationService.isManagedCustomerEventsEnabled() || !audit?._id || audit.action !== ManagedReservationAction.CONTRACT_SIGNED ||
      !audit.reservationId || !audit.facilityId || !audit.details?.contractId) return false;
  try {
    const reservation: any = await ReservationModel.findOne({ _id: audit.reservationId, facilityId: audit.facilityId,
      serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 })
      .select('_id customerId facilityId reservationCode serviceType bookingFlowVersion status statusHistory').lean().exec();
    if (!reservation) return false;
    const contract: any = await ContractModel.findOne({ _id: audit.details.contractId, reservationId: reservation._id,
      customerId: reservation.customerId }).select('_id contractCode contentVersions signatures').lean().exec();
    const version = Number(audit.details.version), contentHash = String(audit.details.contentHash ?? '');
    if (!contract?.contentVersions?.some((entry: any) => entry.version === version && entry.contentHash === contentHash) ||
        !activeContractSignaturesValid(contract, version, contentHash)) return false;
    if (audit.details?.paperEvidenceVerified !== true) {
      if (audit.details?.signerRole !== 'FACILITY_STAFF' && audit.details?.signerRole !== 'FACILITY_MANAGER') return false;
    }
    const userId = await NotificationRecipientResolver.resolveReservationCustomer(reservation);
    if (!userId) return false;
    const checkinReady = audit.details.paperEvidenceVerified === true &&
      (reservation.statusHistory ?? []).some((entry: any) => entry.status === 'CHECKIN_READY');
    const type = checkinReady ? NotificationType.MANAGED_CHECKIN_READY : NotificationType.MANAGED_CONTRACT_SIGNED;
    const facility: any = await FacilityModel.findById(reservation.facilityId).select('name').lean().exec();
    return NotificationService.notifyManagedCustomerEvent({ userId, type,
      title: checkinReady ? 'Hợp đồng đã xác minh, sẵn sàng nhận kho' : 'Hợp đồng Managed đã được ký',
      content: `${facility?.name || 'Cơ sở Managed Inventory'} · Đơn ${reservation.reservationCode || String(reservation._id)}.`,
      facilityId: String(reservation.facilityId), relatedEntityId: String(contract._id),
      eventIdentity: `MANAGED_AUDIT:${audit._id}:${checkinReady ? 'CHECKIN_READY' : 'CONTRACT_SIGNED'}` });
  } catch { return false; }
}

/** remainingQuantity is reconstructed from the canonical movement prefix at this movement's ledger revision. */
export async function notifyManagedOutboundMovement(movement: any, remainingQuantity: number): Promise<boolean> {
  if (!NotificationService.isManagedCustomerEventsEnabled() || !movement?._id || movement.schemaVersion !== 4 ||
      movement.type !== 'OUTBOUND' || movement.stockEffect?.action !== 'REMOVE' || !movement.managedReservationId ||
      !movement.itemId || !movement.customerId || !movement.facilityId || !Number.isSafeInteger(remainingQuantity) || remainingQuantity < 0) return false;
  try {
    const reservation: any = await ReservationModel.findOne({ _id: movement.managedReservationId, customerId: movement.customerId,
      facilityId: movement.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 })
      .select('_id customerId facilityId reservationCode serviceType bookingFlowVersion').lean().exec();
    const sku: any = await InventoryItemModel.findOne({ _id: movement.itemId, customerId: movement.customerId,
      facilityId: movement.facilityId, inventorySchemaVersion: 3 })
      .select('_id customerId facilityId').lean().exec();
    if (!reservation || !sku) return false;
    const userId = await NotificationRecipientResolver.resolveReservationCustomer(reservation);
    if (!userId) return false;
    const full = remainingQuantity === 0;
    const type = full ? NotificationType.MANAGED_OUTBOUND_FULL_CONFIRMED : NotificationType.MANAGED_OUTBOUND_PARTIAL_CONFIRMED;
    const facility: any = await FacilityModel.findById(movement.facilityId).select('name').lean().exec();
    return NotificationService.notifyManagedCustomerEvent({ userId, type,
      title: full ? 'Đã xác nhận xuất hết hàng' : 'Đã xác nhận xuất một phần hàng',
      content: `${facility?.name || 'Cơ sở Managed Inventory'} · Đơn ${reservation.reservationCode || String(reservation._id)} · ${movement.quantity} ${movement.quantityUnit || 'đơn vị'} · Phiếu ${String(movement._id)}.`,
      facilityId: String(movement.facilityId), relatedEntityId: String(movement._id), eventIdentity: `MOVEMENT:${movement._id}:OUTBOUND` });
  } catch { return false; }
}

async function notifyManagedMovement(movement: any, input: { type: NotificationType; operation: string; title: string; action: string }) {
  if (!NotificationService.isManagedCustomerEventsEnabled() || !movement?._id || movement.schemaVersion !== 4 ||
      movement.type !== input.operation || movement.stockEffect?.action !== input.action || !movement.managedReservationId ||
      !movement.itemId || !movement.customerId || !movement.facilityId) return false;
  try {
    const reservation: any = await ReservationModel.findOne({ _id: movement.managedReservationId, customerId: movement.customerId,
      facilityId: movement.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 })
      .select('_id customerId facilityId reservationCode').lean().exec();
    const sku: any = await InventoryItemModel.findOne({ _id: movement.itemId, customerId: movement.customerId,
      facilityId: movement.facilityId, inventorySchemaVersion: 3 }).select('_id').lean().exec();
    if (!reservation || !sku) return false;
    const userId = await NotificationRecipientResolver.resolveReservationCustomer(reservation);
    if (!userId) return false;
    const facility: any = await FacilityModel.findById(movement.facilityId).select('name').lean().exec();
    return NotificationService.notifyManagedCustomerEvent({ userId, type: input.type,
      title: input.title,
      content: `${facility?.name || 'Cơ sở Managed Inventory'} · Đơn ${reservation.reservationCode || String(reservation._id)} · ${movement.quantity} ${movement.quantityUnit || 'đơn vị'} · Phiếu ${String(movement._id)}.`,
      facilityId: String(movement.facilityId), relatedEntityId: String(movement._id),
      eventIdentity: `MOVEMENT:${movement._id}:${input.operation}` });
  } catch { return false; }
}

export function notifyManagedInboundMovement(movement: any): Promise<boolean> {
  return notifyManagedMovement(movement, { type: NotificationType.MANAGED_INBOUND_CONFIRMED,
    operation: 'INBOUND', action: 'ADD', title: 'Đã xác nhận nhập kho' });
}

export function notifyManagedRelocationMovement(movement: any): Promise<boolean> {
  return notifyManagedMovement(movement, { type: NotificationType.MANAGED_RELOCATION_CONFIRMED,
    operation: 'RELOCATION', action: 'MOVE', title: 'Đã xác nhận chuyển vị trí hàng hóa' });
}
