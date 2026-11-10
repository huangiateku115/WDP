import {useState,useRef} from 'react';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {inventoryId,inventoryCollection,inventoryError} from '@/lib/inventoryRegistration';
import {contractReady,currentManagedContract,isV2Rental} from '@/lib/managedIntake';
import {managedIntakeApi} from '@/api/managedIntakeApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import {record,useBackend,LoadState} from '@/components/customer/RentalBackendUI';
import ManagedCellSummary from '@/components/customer/warehouse/ManagedCellSummary';
import ManagedContractLookup from './ManagedContractLookup';
import {Panel,Details,Table,Button,Message} from './ManagerUI';
import {Checkbox} from '@/components/ui/checkbox';
async function creationContext(id,user,config){
  if(user?.role!=='FACILITY_MANAGER')throw Error('Manager reservation-read permission is required for this workflow.');
  const reservation=record(await facilityReservationApi.detail(id,true,config));
  if(inventoryId(reservation)!==id||!isV2Rental(reservation)||inventoryId(reservation.facilityId)!==inventoryId(user.assignedFacilityId))throw Error('V2 reservation is outside the assigned Facility.');
  const items=[];let page=1,totalPages=1;
  do{
    const result=inventoryCollection(await managedIntakeApi.inventory({facilityId:inventoryId(reservation.facilityId),customerId:inventoryId(reservation.customerId),page},config));
    if(result.pagination.page!==page||result.pagination.totalPages>1000)throw Error('Inventory pagination is inconsistent or too large to verify.');
    if(result.items.some(i=>inventoryId(i.facilityId)!==inventoryId(reservation.facilityId)))throw Error('Inventory Facility scope could not be verified.');
    items.push(...result.items.filter(i=>inventoryId(i.managedReservationId)===id));totalPages=result.pagination.totalPages;page++;
  }while(page<=totalPages);
  if(new Set(items.map(inventoryId)).size!==items.length)throw Error('Inventory pagination returned duplicate items.');
  return {reservation,items};
}
export default function ManagedContractCreation({reservation}){
  const session=useAuthSession();return <Creation key={`${session.accessToken}:${inventoryId(reservation)}`} id={inventoryId(reservation)} user={session.user}/>;
}
function Creation({id,user}){
  const resource=useBackend(config=>creationContext(id,user,config),[id,user?.assignedFacilityId]),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(''),busy=useRef(false),ready=resource.data&&contractReady(resource.data.reservation,resource.data.items);
  async function create(){
    if(busy.current||!ready||!confirmed||locked)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();let sent=false;
    try{
      const fresh=await creationContext(id,user);if(getAccessToken()!==token)return;
      if(!contractReady(fresh.reservation,fresh.items)||JSON.stringify(fresh)!==JSON.stringify(resource.data))throw Error('Reservation or receiving inspections changed. Refresh and review before creating the contract.');
      sent=true;const contract=record(await managedIntakeApi.createContract(id));if(getAccessToken()!==token)return;
      currentManagedContract(contract,fresh.reservation);setCreated(inventoryId(contract));setLocked(true);setConfirmed(false);
    }catch(e){if(getAccessToken()!==token)return;if(sent&&(!e.response?.status||e.response.status>=500)){setLocked(true);setError('Contract result is unknown. Do not repeat POST. The contract is loaded from this reservation via GET /contracts/reservation/:reservationId to reconcile; no manual id is required.');}else{setConfirmed(false);setError(inventoryError(e));}}
    finally{busy.current=false;setPending(false);}
  }
  return <><Panel title="Tạo hợp đồng hàng hóa phiên bản 2"><LoadState resource={resource}/><Message error={error}/>{resource.data&&<><Details values={[["Đơn thuê",id],["Facility",inventoryId(resource.data.reservation.facilityId)],["Khách hàng",inventoryId(resource.data.reservation.customerId)],["Trạng thái",resource.data.reservation.status]]}/><ManagedCellSummary reservation={resource.data.reservation}/><Table label="Kết quả kiểm tra tiếp nhận" rows={resource.data.items.map(i=>({...i,id:inventoryId(i)}))} columns={[{key:'itemCode',label:"Mặt hàng"},{key:'name',label:"Tên"},{key:'status',label:'State'},{key:'inspection',label:"Kiểm tra kho",render:i=>i.receivingInspection?.decision||"Chưa kiểm tra"},{key:'note',label:"Ghi chú kiểm tra",render:i=>i.receivingInspection?.note||"Máy chủ chưa trả dữ liệu"}]}/>{!ready&&<p role="status" className="mt-3 text-orange-700">Cần khoản trả trước đã xác nhận, ít nhất một biên bản chấp nhận và không còn yêu cầu, chênh lệch hay biên bản từ chối chưa xử lý. Máy chủ kiểm tra thêm lịch sử thanh toán và hồ sơ khách.</p>}{ready&&!locked&&<label className="mt-4 flex items-start gap-3 text-sm"><Checkbox checked={confirmed} disabled={pending} onCheckedChange={v=>setConfirmed(v===true)}/>Tôi xác nhận tạo hoặc cập nhật hợp đồng từ dữ liệu tiếp nhận đã kiểm tra. Nội dung thay đổi làm chữ ký trước đó mất hiệu lực.</label>}<div className="mt-4 flex flex-wrap gap-3"><Button variant="orange" disabled={!ready||!confirmed||pending||locked} onClick={create}>{pending?"Đang tạo…":"Tạo / cập nhật hợp đồng hàng hóa"}</Button><Button variant="outline" disabled={pending} onClick={()=>{setConfirmed(false);resource.retry();}}>Tải lại dữ liệu tiếp nhận</Button></div><p className="mt-3 text-sm">Máy chủ dùng lại hợp đồng của đơn thuê. Giao diện hiển thị điều khoản và số tiền từ máy chủ. Tạo hợp đồng chưa hoàn tất ký, thanh toán hoặc kích hoạt.</p></>}{created&&<p role="status" className="mt-3 break-all text-brand">Hợp đồng được máy chủ xác nhận: {created}</p>}</Panel><ManagedContractLookup initialId={created} reservationId={id}/></>;
}
