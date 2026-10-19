import {useState} from 'react';
import contractApi from '@/api/contractApi';
import {useAuthSession} from '@/lib/authSession';
import {inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {currentManagedContract} from '@/lib/managedIntake';
import {record,useBackend,LoadState} from '@/components/customer/RentalBackendUI';
import ManagedContractReview from '@/components/customer/inventory/ManagedContractReview';
import {Panel,Field,Input,Button} from './ManagerUI';
export async function facilityContract(id,user,config){
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||!validInventoryId(inventoryId(user.assignedFacilityId)))throw Error('Assigned Facility representative required.');
  const contract=record(await contractApi.detailReal(id,config));
  if(inventoryId(contract)!==id)throw Error('Backend returned a different contract.');
  return verifyFacilityContract(contract,user);
}
export async function facilityContractByReservation(reservationId,user,config){
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||!validInventoryId(inventoryId(user.assignedFacilityId)))throw Error('Assigned Facility representative required.');
  const contract=record(await contractApi.byReservationReal(reservationId,config));
  if(inventoryId(contract.reservationId)!==reservationId)throw Error('Contract does not belong to this reservation.');
  return verifyFacilityContract(contract,user);
}
function verifyFacilityContract(contract,user){
  const p=currentManagedContract(contract);
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||inventoryId(user.assignedFacilityId)!==p.content.reservation.facilityId||contract.reservationId?.serviceType!=='MANAGED_INVENTORY'||inventoryId(contract.reservationId?.facilityId)!==p.content.reservation.facilityId)throw Error('Contract is not a verified Managed intake contract in your assigned Facility.');
  return {contract};
}
export default function ManagedContractLookup({initialId='',reservationId=''}){
  const session=useAuthSession();return <Lookup key={`${session.accessToken}:${initialId}:${reservationId}`} initialId={initialId} reservationId={reservationId} user={session.user}/>;
}
function Lookup({initialId,reservationId,user}){
  const [value,setValue]=useState(initialId),[id,setId]=useState(initialId),autoReservation=reservationId||'';
  const resource=useBackend(
    config=>id?facilityContract(id,user,config):autoReservation?facilityContractByReservation(autoReservation,user,config):Promise.resolve(null),
    [id,autoReservation,user?.assignedFacilityId,user?.role],
  );
  return <Panel title="Open Managed V2 contract">{!autoReservation&&<form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();if(validInventoryId(value.trim()))setId(value.trim());}}><Field label="Backend Contract ID"><Input aria-label="Backend Contract ID" value={value} onChange={e=>setValue(e.target.value)}/></Field><Button type="submit" disabled={!validInventoryId(value.trim())}>Open contract</Button></form>}<p className="mt-3 text-sm">{autoReservation?'Contract is loaded from the reservation via GET /contracts/reservation/:reservationId. No id entry is needed.':'Enter a Contract ID only when the reservation is unknown; the reservation lookup has no id to type.'} Opening this page never creates a contract.</p><LoadState resource={resource}/>{resource.data&&<ManagedContractReview key={JSON.stringify(resource.data.contract)} contract={resource.data.contract} loadLatest={()=>id?facilityContract(id,user):facilityContractByReservation(autoReservation,user)} onRefresh={resource.retry}/>}</Panel>;
}
