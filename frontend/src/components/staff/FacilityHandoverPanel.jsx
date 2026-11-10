import {useCallback,useRef,useState} from 'react';
import api from '@/api/facilityHandoverApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Panel,Details,Status,Button,Field,Input,Message,Dialog,money} from '@/components/manager/ManagerUI';

export default function FacilityHandoverPanel({reservationId}) {
 const {user}=useAuthSession(),facilityId=user?.assignedFacilityId;
 const permitted=['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)&&objectId(facilityId)&&objectId(reservationId);
 const [file,setFile]=useState(null),[number,setNumber]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[action,setAction]=useState(null),[feedback,setFeedback]=useState({}),[printData,setPrintData]=useState(null),busy=useRef(false);
 const load=useCallback(async signal=>{
  const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
  if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error("Đây không phải đơn thuê kho riêng thuộc cơ sở của bạn.");
  const contract=apiRecord(await api.contract(reservationId,{signal}));
  if(!objectId(recordId(contract))||recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId))throw Error("Hợp đồng không khớp đơn thuê hoặc khách hàng.");
  return {reservation,contract};
 },[reservationId,facilityId]);
 const resource=useFacilityResource(load,permitted,{refreshOnFocus:false}),data=resource.data;
 const paperEligible=d=>['CONTRACTED','DEPOSIT_PAID'].includes(d.reservation.status)&&!d.contract.signedProofUrl;
 const handoverEligible=d=>d.reservation.status==='PAID'&&d.contract.status==='SIGNED'&&!!d.contract.signedProofUrl;
 async function run(event){event?.preventDefault();if(busy.current||!data)return;busy.current=true;setSaving(true);setFeedback({});try{
  const fresh=await load();
  if(action==='paper'){
   if(!paperEligible(fresh)||!confirmed)throw Error("Đơn chưa đủ điều kiện hoặc đã có bằng chứng ký. Vui lòng tải lại.");
   if(!file||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>10*1024*1024)throw Error("Chọn tệp JPEG, PNG, WEBP hoặc PDF tối đa 10 MB.");
   await api.confirmPaper(recordId(fresh.contract),file,number);
   const updated=await load();
   if(updated.contract.status!=='SIGNED'||!updated.contract.signedProofUrl||updated.reservation.status!=='CHECKIN_READY')throw Error("Chưa xác nhận hợp đồng đã ký và đơn sẵn sàng bước tiếp theo. Tải lại trước khi tiếp tục.");
   setFile(null);setConfirmed(false);setFeedback({success:"Đã lưu bằng chứng. Khách có thể thanh toán phần còn lại."});
  }else if(action==='handover'){
   if(!handoverEligible(fresh)||!confirmed)throw Error("Cần đơn đã thanh toán và bằng chứng hợp đồng giấy đã ký.");
   const unitId=recordId(fresh.reservation.storageUnitId),unit=apiRecord(await storageApi.unitDetail(unitId));
   if(recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error("Kho ngoài cơ sở của bạn hoặc chưa sẵn sàng bàn giao.");
   const response=apiRecord(await api.handover(reservationId));
   if(recordId(response.reservation)!==reservationId||response.reservation.status!=='ACTIVE')throw Error("Chưa xác nhận bàn giao cho đơn này.");
   const updated=await load(),updatedUnit=apiRecord(await storageApi.unitDetail(unitId));
   if(updated.reservation.status!=='ACTIVE'||recordId(updatedUnit)!==unitId||updatedUnit.status!=='OCCUPIED')throw Error("Trạng thái đơn và kho chưa khớp. Tải lại để kiểm tra trước khi thực hiện thao tác tiếp theo.");
   setConfirmed(false);setFeedback({success:"Đã xác nhận đơn đang sử dụng và kho đã được thuê."});
  }else{
   const printed=apiRecord(await api.print(recordId(fresh.contract)));
   if(recordId(printed)!==recordId(fresh.contract)||recordId(printed.reservationId)!==reservationId)throw Error("Dữ liệu in không khớp hợp đồng.");
   setPrintData(printed);setAction(null);return;
  }
  setAction(null);announceReviewChange();
 }catch(error){const message=reviewError(error);setFeedback({error:/cloud_name is disabled/i.test(message)?"Dịch vụ lưu hợp đồng Cloudinary đang bị vô hiệu hóa. Bằng chứng chưa được lưu. Liên hệ nhóm máy chủ để khôi phục dịch vụ.":message});resource.reload();}finally{busy.current=false;setSaving(false);}}
 if(!permitted)return <Panel title="Hợp đồng và bàn giao"><p>Cần tài khoản nhân viên hoặc quản lý đã được phân công cơ sở.</p></Panel>;
 return <Panel title="Hợp đồng giấy và bàn giao"><Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Đang tải hợp đồng của đơn…</p>}<Button variant="outline" disabled={saving} onClick={resource.reload}>Tải lại hợp đồng</Button>
 {data&&<div className="mt-4 space-y-4"><Details values={ [["Mã hợp đồng",recordId(data.contract)],["Hợp đồng",data.contract.contractCode],["Trạng thái hợp đồng",<Status value={data.contract.status}/>],["Trạng thái đơn thuê",<Status value={data.reservation.status}/>],["Bằng chứng",data.contract.signedProofUrl?'Saved':"Chưa có dữ liệu"]]}/>
 <Button variant="outline" disabled={saving} onClick={()=>setAction('print')}>Xem dữ liệu in hợp đồng</Button>
 {paperEligible(data)&&<><Field label="Ảnh hoặc PDF hợp đồng giấy đã ký"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={e=>setFile(e.target.files?.[0]||null)}/></Field><Field label="Số hợp đồng giấy (không bắt buộc)"><Input maxLength={100} value={number} disabled={saving} onChange={e=>setNumber(e.target.value)}/></Field></>}
 {(paperEligible(data)||handoverEligible(data))&&<label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra khách hàng, hợp đồng và điều kiện bàn giao.</label>}
 {paperEligible(data)&&<Button disabled={saving||!file||!confirmed} onClick={()=>setAction('paper')}>Xác nhận hợp đồng giấy</Button>}
 {handoverEligible(data)&&<Button disabled={saving||!confirmed} onClick={()=>setAction('handover')}>Hoàn tất bàn giao</Button>}
 {data.reservation.status==='CHECKIN_READY'&&<p>Chờ khách thanh toán phần còn lại. Tải lại sau khi thanh toán.</p>}
 {data.reservation.status==='ACTIVE'&&<p>Đã hoàn tất bàn giao.</p>}
 </div>}
 {action&&<Dialog title={action==='paper'?"Lưu bằng chứng hợp đồng đã ký":action==='handover'?"Xác nhận bàn giao":"Tải dữ liệu in"} onClose={()=>{if(!busy.current)setAction(null);}}><form onSubmit={run}><p className="mb-4">Kiểm tra và xác nhận thao tác với đơn hiện tại.</p><Message {...feedback}/><Button disabled={saving}>{saving?"Đang xử lý…":"Xác nhận"}</Button></form></Dialog>}
 {printData&&<Dialog title="Dữ liệu hợp đồng" onClose={()=>setPrintData(null)}><Details values={ [["Hợp đồng",printData.contractCode],["Khách hàng",printData.customerSnapshot?.fullName||printData.customerId?.email||'—'],["Đơn thuê",printData.reservationId?.reservationCode||reservationId],["Tiền thuê",money(printData.pricingSnapshot?.estimatedRent||0)],["Khoản trả trước",money(printData.pricingSnapshot?.depositAmount||0)],["Trạng thái",printData.status]]}/><p className="mt-4">Đây là dữ liệu hợp đồng từ máy chủ. Bản PDF pháp lý hoàn chỉnh chưa được cung cấp.</p><Button variant="outline" onClick={()=>window.print()}>In trang này</Button></Dialog>}
 </Panel>;
}
