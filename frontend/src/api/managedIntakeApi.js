import client from './axiosClient';
import {validInventoryId} from '@/lib/inventoryRegistration';
const id=value=>{if(!validInventoryId(value))throw Error('Invalid Managed intake ID.');return value;};
// BE-REF inventory-item/reservation/contract routes and supplied Managed V2 Postman.
export const managedIntakeApi={
  inventory:({facilityId,customerId,page=1,status},config={})=>client.get('/inventory-items',{...config,params:{facilityId:id(facilityId),...(customerId?{customerId:id(customerId)}:{}),page,limit:100,...(status?{status}:{})}}),
  createContract:reservationId=>client.post(`/reservations/managed/${id(reservationId)}/contract`,{}),
  signCustomer:contractId=>client.patch(`/contracts/${id(contractId)}/sign`,{}),
  signFacility:contractId=>client.patch(`/contracts/${id(contractId)}/sign/facility`,{}),
};
// Staff inspection mutation is intentionally not exposed: Staff reservation read is missing.
