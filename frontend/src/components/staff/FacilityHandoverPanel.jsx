import {useCallback,useRef,useState} from 'react';
import api from '@/api/facilityHandoverApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Panel,Details,Status,Button,Field,Input,Textarea,Message,Dialog,money} from '@/components/manager/ManagerUI';

export default function FacilityHandoverPanel({reservationId}) {
 const {user}=useAuthSession(),facilityId=user?.assignedFacilityId;
 const permitted=['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)&&objectId(facilityId)&&objectId(reservationId);
 const [file,setFile]=useState(null),[number,setNumber]=useState(''),[rejectReason,setRejectReason]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[action,setAction]=useState(null),[feedback,setFeedback]=useState({}),[printData,setPrintData]=useState(null),[condition,setCondition]=useState('GOOD'),[checkoutNote,setCheckoutNote]=useState(''),busy=useRef(false);
 const load=useCallback(async signal=>{
  const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
  if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error("Đây không phải đơn thuê kho riêng thuộc cơ sở của bạn.");
  const contract=apiRecord(await api.contract(reservationId,{signal}));
  if(!objectId(recordId(contract))||recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId))throw Error("Hợp đồng không khớp đơn thuê hoặc khách hàng.");
  return {reservation,contract};
 },[reservationId,facilityId]);
 const resource=useFacilityResource(load,permitted,{refreshOnFocus:false}),data=resource.data;
 const paperEligible=d=>['CONTRACTED','DEPOSIT_PAID','PAID'].includes(d.reservation.status)&&!d.contract.signedProofUrl;
 const handoverEligible=d=>d.reservation.status==='PAID'&&d.contract.status==='SIGNED'&&(!!d.contract.signedProofUrl||!!d.reservation.paperContractProofUrl);
 const rejectEligible=d=>['PAID','CONTRACTED','DEPOSIT_PAID'].includes(d.reservation.status)&&!d.contract.signedProofUrl&&!d.reservation.paperContractProofUrl&&d.reservation.status!=='ACTIVE'&&d.reservation.status!=='CANCELLED';
 const checkoutEligible=d=>['ACTIVE','OVERDUE'].includes(d.reservation.status)&&d?.reservation?.checkoutRequest?.status==='PENDING';
 const checkoutPending=d=>['ACTIVE','OVERDUE'].includes(d?.reservation?.status)&&d?.reservation?.checkoutRequest?.status==='PENDING';
 async function run(event){event?.preventDefault();if(busy.current||!data)return;busy.current=true;setSaving(true);setFeedback({});try{
  const fresh=await load();
  if(action==='paper'){
   if(!paperEligible(fresh)||!confirmed)throw Error("Đơn chưa đủ điều kiện hoặc đã có bằng chứng ký. Vui lòng tải lại.");
   if(!file||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>10*1024*1024)throw Error("Chọn tệp JPEG, PNG, WEBP hoặc PDF tối đa 10 MB.");
   await api.confirmPaper(recordId(fresh.contract),file,number);
   const updated=await load();
   if(updated.contract.status!=='SIGNED'||!updated.contract.signedProofUrl||!['CHECKIN_READY','PAID'].includes(updated.reservation.status))throw Error("Chưa xác nhận hợp đồng đã ký và đơn sẵn sàng bước tiếp theo. Tải lại trước khi tiếp tục.");
   setFile(null);setConfirmed(false);setFeedback({success:updated.reservation.status==='PAID'?"Đã lưu bằng chứng hợp đồng giấy. Sẵn sàng bàn giao kho.":"Đã lưu bằng chứng. Khách có thể thanh toán phần còn lại."});
  }else if(action==='handover'){
   if(!handoverEligible(fresh)||!confirmed)throw Error("Cần đơn đã thanh toán và bằng chứng hợp đồng giấy đã ký.");
   const unitId=recordId(fresh.reservation.storageUnitId),unit=apiRecord(await storageApi.unitDetail(unitId));
   if(recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error("Kho ngoài cơ sở của bạn hoặc chưa sẵn sàng bàn giao.");
   const response=apiRecord(await api.handover(reservationId));
   if(recordId(response.reservation)!==reservationId||response.reservation.status!=='ACTIVE')throw Error("Chưa xác nhận bàn giao cho đơn này.");
   const updated=await load(),updatedUnit=apiRecord(await storageApi.unitDetail(unitId));
   if(updated.reservation.status!=='ACTIVE'||recordId(updatedUnit)!==unitId||updatedUnit.status!=='OCCUPIED')throw Error("Trạng thái đơn và kho chưa khớp. Tải lại để kiểm tra trước khi thực hiện thao tác tiếp theo.");
   setConfirmed(false);const pin=response?.pinCode||updated?.reservation?.accessPinCode;setFeedback({success:"Bàn giao thành công! Đơn chuyển sang ACTIVE. Mã PIN cấp cho khách: "+(pin||"—")});
  }else if(action==='reject'){
   if(!rejectEligible(fresh))throw Error("Đơn không ở trạng thái hợp lệ để từ chối nhận kho.");
   if(!rejectReason.trim())throw Error("Vui lòng nhập lý do từ chối nhận kho.");
   await api.reject(reservationId,rejectReason.trim());
   const updated=await load();
   if(updated.reservation.status!=='CANCELLED')throw Error("Chưa ghi nhận trạng thái hủy đơn. Tải lại trang để kiểm tra.");
   setRejectReason('');
   setFeedback({success:"Đã từ chối nhận kho và hủy đơn thành công. Ô kho đã được giải phóng về trạng thái Còn trống (AVAILABLE)."});
  }else if(action==='checkout'){
   if(!checkoutEligible(fresh))throw Error("Đơn chưa có yêu cầu trả kho từ khách hoặc không ở trạng thái hợp lệ để nghiệm thu trả kho.");
   const result = await api.completeCheckout(reservationId, condition, checkoutNote.trim());
   await load();
   setFeedback({success:result?.data?.data?.isEarly?"Nghiệm thu trả kho sớm thành công! Hợp đồng chấm dứt trước hạn (TERMINATED, không hoàn tiền). Kho đã giải phóng.":"Nghiệm thu trả kho đúng hạn thành công! Hợp đồng hết hạn (EXPIRED), kho đã được giải phóng (AVAILABLE)."});
  }else if(action==='rejectCheckout'){
   if(!rejectReason.trim())throw Error("Vui lòng nhập lý do từ chối yêu cầu trả kho.");
   await api.rejectCheckout(reservationId, rejectReason.trim());
   await load();
   setRejectReason('');
   setFeedback({success:"Đã từ chối yêu cầu trả kho. Khách hàng cần xử lý trước khi gửi lại yêu cầu."});
  }else{
   const printed=apiRecord(await api.print(recordId(fresh.contract)));
   if(recordId(printed)!==recordId(fresh.contract)||recordId(printed.reservationId)!==reservationId)throw Error("Dữ liệu in không khớp hợp đồng.");
   setPrintData(printed);setAction(null);return;
  }
  setAction(null);announceReviewChange();
 }catch(error){const message=reviewError(error);setFeedback({error:/cloud_name is disabled/i.test(message)?"Dịch vụ lưu hợp đồng Cloudinary đang bị vô hiệu hóa. Bằng chứng chưa được lưu. Liên hệ nhóm máy chủ để khôi phục dịch vụ.":message});resource.reload();}finally{busy.current=false;setSaving(false);}}
 if(!permitted)return <Panel title="Hợp đồng và bàn giao"><p>Cần tài khoản nhân viên hoặc quản lý đã được phân công cơ sở.</p></Panel>;
 return <Panel title="Hợp đồng giấy và bàn giao"><Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Đang tải hợp đồng của đơn…</p>}<Button variant="outline" disabled={saving} onClick={resource.reload}>Tải lại hợp đồng</Button>
 {data&&<div className="mt-4 space-y-4"><Details values={ [["Mã hợp đồng",recordId(data.contract)],["Hợp đồng",data.contract.contractCode],["Trạng thái hợp đồng",<Status value={data.contract.status}/>],["Trạng thái đơn thuê",<Status value={data.reservation.status}/>],["Bằng chứng",data.contract.signedProofUrl?'Saved':"Chưa có dữ liệu"], ...(data.reservation.status==='ACTIVE'?[["Mã PIN truy cập",data.reservation.accessPinCode||'—']]:[]), ...(data.reservation.actualCheckoutDate||data.reservation.status==='CHECKED_OUT'?[["Ngày trả kho",data.reservation.actualCheckoutDate?new Date(data.reservation.actualCheckoutDate).toLocaleString('vi-VN'):'—']]:[]), ...(data.reservation.status==='CANCELLED'?[["Lý do từ chối/hủy",data.reservation.cancellationReason||'—']]:[])]}/>
 <Button variant="outline" disabled={saving} onClick={()=>setAction('print')}>Xem dữ liệu in hợp đồng</Button>
 {paperEligible(data)&&<><Field label="Ảnh hoặc PDF hợp đồng giấy đã ký"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={e=>setFile(e.target.files?.[0]||null)}/></Field><Field label="Số hợp đồng giấy (không bắt buộc)"><Input maxLength={100} value={number} disabled={saving} onChange={e=>setNumber(e.target.value)}/></Field></>}
 {(paperEligible(data)||handoverEligible(data))&&<label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra khách hàng, hợp đồng và điều kiện bàn giao.</label>}
 <div className="flex flex-wrap gap-3">
   {paperEligible(data)&&<Button disabled={saving||!file||!confirmed} onClick={()=>setAction('paper')}>Xác nhận hợp đồng giấy</Button>}
   {handoverEligible(data)&&<Button disabled={saving||!confirmed} onClick={()=>setAction('handover')}>Hoàn tất bàn giao</Button>}
   {rejectEligible(data)&&<Button variant="destructive" disabled={saving} onClick={()=>{setFeedback({});setAction('reject');}}>Từ chối nhận kho (Khách không ưng)</Button>}
   {checkoutEligible(data)&&<Button disabled={saving} onClick={()=>{setFeedback({});setAction('checkout');}}>Nghiệm thu trả kho (Checkout)</Button>}
   {checkoutPending(data)&&<Button variant="destructive" disabled={saving} onClick={()=>{setFeedback({});setAction('rejectCheckout');}}>Từ chối yêu cầu trả kho</Button>}
 </div>
 {checkoutPending(data)&&<div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">🔔 <strong>Khách yêu cầu trả kho:</strong> {data.reservation.checkoutRequest?.note||"Khách đã dọn sạch đồ, nhờ kiểm tra."}</div>}
 {data.reservation.status==='CHECKIN_READY'&&<p>Chờ khách thanh toán phần còn lại. Tải lại sau khi thanh toán.</p>}
 {data.reservation.status==='ACTIVE'&&<p className="text-emerald-700 font-medium">Đã hoàn tất bàn giao kho. Mã PIN truy cập: <span className="font-mono font-bold tracking-widest">{data.reservation.accessPinCode||'—'}</span></p>}
 {data.reservation.status==='CHECKED_OUT'&&<p className="text-emerald-700 font-medium">✅ Đơn thuê đã được nghiệm thu trả kho hoàn tất (CHECKED_OUT). Ô kho đã được giải phóng.</p>}
 {data.reservation.status==='CANCELLED'&&<p className="text-rose-700 font-medium">Đơn thuê đã bị từ chối / hủy. Ô kho đã được giải phóng.</p>}
 </div>}
 {action&&<Dialog title={action==='paper'?"Lưu bằng chứng hợp đồng đã ký":action==='handover'?"Xác nhận bàn giao":action==='reject'?"Từ chối nhận kho (Khách không ưng kho)":action==='checkout'?"Nghiệm thu trả kho (Checkout)":action==='rejectCheckout'?"Từ chối yêu cầu trả kho":"Tải dữ liệu in"} onClose={()=>{if(!busy.current)setAction(null);}}>
  <form onSubmit={run} className="space-y-4">
    {action==='reject'?(
      <>
        <p className="text-sm text-slate-600">Khách hàng kiểm tra thực tế và không đồng ý nhận kho. Thao tác này sẽ hủy đơn thuê, chấm dứt hợp đồng và giải phóng ô kho về trạng thái Còn trống (AVAILABLE).</p>
        <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded border border-amber-200">Không yêu cầu cung cấp hình ảnh hợp đồng, nhưng <strong>bắt buộc nhập lý do từ chối</strong> để phục vụ thủ tục hoàn tiền ngoài hệ thống.</p>
        <Field label="Lý do từ chối nhận kho (bắt buộc)">
          <Textarea rows={3} placeholder="Ví dụ: Khách hàng kiểm tra thấy diện tích kho không phù hợp nhu cầu thực tế..." value={rejectReason} disabled={saving} required onChange={e=>setRejectReason(e.target.value)}/>
        </Field>
      </>
    ):action==='checkout'?(
      <>
        <p className="text-sm text-slate-600">Kiểm tra thực tế ô kho. Đảm bảo khách đã dọn sạch toàn bộ tài sản. Nếu kho sạch sẽ, ô kho sẽ được giải phóng ngay sang <strong>AVAILABLE</strong> cho khách mới.</p>
        <Field label="Tình trạng kho">
          <select className="w-full border rounded p-2 text-sm" value={condition} disabled={saving} onChange={e=>setCondition(e.target.value)}>
            <option value="GOOD">Sạch sẽ, nguyên vẹn (GOOD) → Giải phóng AVAILABLE</option>
            <option value="EXCELLENT">Hoàn hảo (EXCELLENT) → Giải phóng AVAILABLE</option>
            <option value="NEEDS_CLEANING">Cần dọn vệ sinh (NEEDS_CLEANING) → Chuyển sang MAINTENANCE</option>
            <option value="DAMAGED">Hư hại kết cấu (DAMAGED) → Chuyển sang MAINTENANCE</option>
          </select>
        </Field>
        <Field label="Ghi chú nghiệm thu (không bắt buộc)">
          <Textarea rows={2} placeholder="Ghi chú thêm về hiện trạng..." value={checkoutNote} disabled={saving} onChange={e=>setCheckoutNote(e.target.value)}/>
        </Field>
      </>
    ):action==='rejectCheckout'?(
      <>
        <p className="text-sm text-slate-600">Từ chối yêu cầu trả kho khi khách chưa dọn hết đồ hoặc vi phạm quy định cơ sở. Đơn vẫn giữ nguyên trạng thái ACTIVE.</p>
        <Field label="Lý do từ chối (bắt buộc)">
          <Textarea rows={3} placeholder="Ví dụ: Kho còn nhiều vật dụng cá nhân chưa được dọn sạch..." value={rejectReason} disabled={saving} required onChange={e=>setRejectReason(e.target.value)}/>
        </Field>
      </>
    ):(
      <p className="mb-4">Kiểm tra và xác nhận thao tác với đơn hiện tại.</p>
    )}
    <Message {...feedback}/>
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" disabled={saving} onClick={()=>setAction(null)}>Hủy bỏ</Button>
      <Button type="submit" variant={action==='reject'||action==='rejectCheckout'?'destructive':'default'} disabled={saving||((action==='reject'||action==='rejectCheckout')&&!rejectReason.trim())}>
        {saving?"Đang xử lý…":action==='reject'?"Xác nhận từ chối":action==='rejectCheckout'?"Từ chối yêu cầu":action==='checkout'?"Xác nhận trả kho":"Xác nhận"}
      </Button>
    </div>
  </form>
 </Dialog>}
 {printData&&<Dialog title="Dữ liệu hợp đồng" onClose={()=>setPrintData(null)}><Details values={ [["Hợp đồng",printData.contractCode],["Khách hàng",printData.customerSnapshot?.fullName||printData.customerId?.email||'—'],["Đơn thuê",printData.reservationId?.reservationCode||reservationId],["Tổng tiền thanh toán",money(printData.pricingSnapshot?.estimatedRent||0)],["Trạng thái",printData.status]]}/><p className="mt-4">Đây là dữ liệu hợp đồng từ máy chủ. Bản PDF pháp lý hoàn chỉnh chưa được cung cấp.</p><Button variant="outline" onClick={()=>window.print()}>In trang này</Button></Dialog>}
 </Panel>;
}
