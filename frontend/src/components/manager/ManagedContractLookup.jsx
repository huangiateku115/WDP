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
  const contract=record(await contractApi.detailReal(id,config)),p=currentManagedContract(contract);
  if(inventoryId(contract)!==id||!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||inventoryId(user.assignedFacilityId)!==p.content.reservation.facilityId||contract.reservationId?.serviceType!=='MANAGED_INVENTORY'||inventoryId(contract.reservationId?.facilityId)!==p.content.reservation.facilityId)throw Error('Contract is not a verified Managed intake contract in your assigned Facility.');
  return {contract};
}
export default function ManagedContractLookup({initialId=''}){
  const session=useAuthSession();return <Lookup key={`${session.accessToken}:${initialId}`} initialId={initialId} user={session.user}/>;
}
function Lookup({initialId,user}){
  const [value,setValue]=useState(initialId),[id,setId]=useState(initialId),resource=useBackend(config=>id?facilityContract(id,user,config):Promise.resolve(null),[id,user?.assignedFacilityId,user?.role]);
  return <Panel title="Open Managed V2 contract"><form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();if(validInventoryId(value.trim()))setId(value.trim());}}><Field label="Backend Contract ID"><Input aria-label="Backend Contract ID" value={value} onChange={e=>setValue(e.target.value)}/></Field><Button type="submit" disabled={!validInventoryId(value.trim())}>Open contract</Button></form><p className="mt-3 text-sm">Use the real Contract ID returned by contract creation. No Facility contract-list or reservation-to-contract read API is available; opening this page never creates a contract.</p><LoadState resource={resource}/>{resource.data&&<ManagedContractReview key={JSON.stringify(resource.data.contract)} contract={resource.data.contract} loadLatest={()=>facilityContract(id,user)} onRefresh={resource.retry}/>}</Panel>;
}
