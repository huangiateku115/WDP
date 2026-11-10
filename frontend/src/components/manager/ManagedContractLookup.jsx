import {useState} from 'react';
import contractApi from '@/api/contractApi';
import {useAuthSession} from '@/lib/authSession';
import {inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {currentManagedContract} from '@/lib/managedIntake';
import {record,useBackend,LoadState} from '@/components/customer/RentalBackendUI';
import ManagedContractReview from '@/components/customer/inventory/ManagedContractReview';
import {Panel,Field,Input,Button} from './ManagerUI';
export async function facilityContract(id,user,config){
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||!validInventoryId(inventoryId(user.assignedFacilityId)))throw Error("Cần đại diện cơ sở được phân công.");
  const contract=record(await contractApi.detailReal(id,config));
  if(inventoryId(contract)!==id)throw Error("Máy chủ trả về hợp đồng khác.");
  return verifyFacilityContract(contract,user);
}
export async function facilityContractByReservation(reservationId,user,config){
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||!validInventoryId(inventoryId(user.assignedFacilityId)))throw Error("Cần đại diện cơ sở được phân công.");
  const contract=record(await contractApi.byReservationReal(reservationId,config));
  if(inventoryId(contract.reservationId)!==reservationId)throw Error("Hợp đồng không thuộc đơn thuê này.");
  return verifyFacilityContract(contract,user);
}
function verifyFacilityContract(contract,user){
  const p=currentManagedContract(contract);
  if(!['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)||inventoryId(user.assignedFacilityId)!==p.content.reservation.facilityId||contract.reservationId?.serviceType!=='MANAGED_INVENTORY'||inventoryId(contract.reservationId?.facilityId)!==p.content.reservation.facilityId)throw Error("Hợp đồng chưa được xác minh là hợp đồng tiếp nhận hàng hóa thuộc cơ sở của bạn.");
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
  return <Panel title="Mở hợp đồng hàng hóa phiên bản 2">{!autoReservation&&<form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();if(validInventoryId(value.trim()))setId(value.trim());}}><Field label="Mã hợp đồng trên máy chủ"><Input aria-label="Mã hợp đồng trên máy chủ" value={value} onChange={e=>setValue(e.target.value)}/></Field><Button type="submit" disabled={!validInventoryId(value.trim())}>Mở hợp đồng</Button></form>}<p className="mt-3 text-sm">{autoReservation?"Hợp đồng được tự động tải theo đơn thuê.":"Chỉ nhập mã hợp đồng khi chưa biết đơn thuê. Nếu đã chọn đơn, hợp đồng được tải tự động."} Mở trang này chỉ đọc dữ liệu hợp đồng.</p><LoadState resource={resource}/>{resource.data&&<ManagedContractReview facilityLanguage key={JSON.stringify(resource.data.contract)} contract={resource.data.contract} loadLatest={()=>id?facilityContract(id,user):facilityContractByReservation(autoReservation,user)} onRefresh={resource.retry}/>}</Panel>;
}
