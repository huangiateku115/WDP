import client from './axiosClient';
import {validInventoryId} from '@/lib/inventoryRegistration';
const id=value=>{if(!validInventoryId(value))throw Error('Invalid Managed intake ID.');return value;};
// BE-REF inventory-item/reservation/contract routes and supplied Managed V2 Postman.
export const managedIntakeApi={
  inventory:({facilityId,customerId,page=1,status},config={})=>client.get('/inventory-items',{...config,params:{facilityId:id(facilityId),...(customerId?{customerId:id(customerId)}:{}),page,limit:100,...(status?{status}:{})}}),
  receivingContext:(itemId,config={})=>client.get(`/inventory-items/${id(itemId)}/receiving-inspection/context`,config),
  uploadReceivingEvidence:(itemId,file,idempotencyKey,config={})=>{const body=new FormData();body.append('file',file);return client.post(`/inventory-items/${id(itemId)}/receiving-inspection/image-uploads`,body,{...config,headers:{...config.headers,'Content-Type':'multipart/form-data','Idempotency-Key':idempotencyKey}});},
  inspectItem:(itemId,body)=>client.post(`/inventory-items/${id(itemId)}/receiving-inspection`,body),
  receivingEvidence:(itemId,config={})=>client.get(`/inventory-items/${id(itemId)}/receiving-inspection/context`,config),
  createContract:reservationId=>client.post(`/reservations/managed/${id(reservationId)}/contract`,{}),
  signCustomer:contractId=>client.patch(`/contracts/${id(contractId)}/sign`,{}),
  signFacility:contractId=>client.patch(`/contracts/${id(contractId)}/sign/facility`,{}),
};
// Staff inspection mutation is intentionally not exposed: Staff reservation read is missing.
