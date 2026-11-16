import {useCallback,useRef,useState} from 'react';
import api from '@/api/facilityHandoverApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {getAccessToken,useAuthSession} from '@/lib/authSession';
import {handoverAccessMessage} from '@/lib/facilityAccess';
import {fullUpfront,currentDocument,paperEvidence,canHandover,checkoutMessage} from '@/lib/facilityPaperContract';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Panel,Details,Status,Button,Field,Input,Textarea,Message,Dialog,money} from '@/components/manager/ManagerUI';

export default function FacilityHandoverPanel({reservationId}) {
 const session=useAuthSession();
 return <HandoverContent key={`${reservationId}:${session.user?.assignedFacilityId}:${session.accessToken}`} reservationId={reservationId}/>;
}
function HandoverContent({reservationId}) {
 const {user}=useAuthSession(),facilityId=user?.assignedFacilityId;
 const permitted=['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)&&objectId(facilityId)&&objectId(reservationId);
 const [file,setFile]=useState(null),[number,setNumber]=useState(''),[rejectReason,setRejectReason]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[action,setAction]=useState(null),[feedback,setFeedback]=useState({}),[printData,setPrintData]=useState(null),[condition,setCondition]=useState('GOOD'),[checkoutNote,setCheckoutNote]=useState(''),busy=useRef(false);
 const [customerSignedAt,setCustomerSignedAt]=useState(''),[facilitySignedAt,setFacilitySignedAt]=useState(''),[identityVerified,setIdentityVerified]=useState(false),[handoverCondition,setHandoverCondition]=useState('GOOD');
 const [extFile,setExtFile]=useState(null),[extRejectReason,setExtRejectReason]=useState(''),[selectedExt,setSelectedExt]=useState(null),[extConfirmed,setExtConfirmed]=useState(false);
 const load=useCallback(async signal=>{
  const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
  if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error("Đây không phải đơn thuê kho riêng thuộc cơ sở của bạn.");
  const contract=apiRecord(await api.contract(reservationId,{signal}));
  if(!objectId(recordId(contract))||recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId))throw Error("Hợp đồng không khớp đơn thuê hoặc khách hàng.");
  return {reservation,contract};
 },[reservationId,facilityId]);
 const resource=useFacilityResource(load,permitted,{refreshOnFocus:false}),data=resource.data;
 const paperEligible=d=>(fullUpfront(d)?d.reservation.status==='PAID'&&d.contract.status==='DRAFT':['CONTRACTED','DEPOSIT_PAID','PAID'].includes(d.reservation.status))&&!d.contract.signedProofUrl;
 const handoverEligible=canHandover;
 const rejectEligible=d=>!fullUpfront(d)&&['PAID','CONTRACTED','DEPOSIT_PAID'].includes(d.reservation.status)&&!d.contract.signedProofUrl&&!d.reservation.paperContractProofUrl&&d.reservation.status!=='ACTIVE'&&d.reservation.status!=='CANCELLED';
 const checkoutEligible=d=>['ACTIVE','OVERDUE'].includes(d.reservation.status)&&d?.reservation?.checkoutRequest?.status==='PENDING';
 const checkoutPending=d=>['ACTIVE','OVERDUE'].includes(d?.reservation?.status)&&d?.reservation?.checkoutRequest?.status==='PENDING';
 async function run(event){event?.preventDefault();if(busy.current||!data)return;busy.current=true;setSaving(true);setFeedback({});const token=getAccessToken();const ensureSession=()=>{if(!token||token!==getAccessToken())throw Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.');};try{ensureSession();
  const fresh=await load();ensureSession();
  if(action==='paper'){
   if(!paperEligible(fresh)||!confirmed)throw Error("Đơn chưa đủ điều kiện hoặc đã có bằng chứng ký. Vui lòng tải lại.");
   if(!file||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>10*1024*1024)throw Error("Chọn tệp JPEG, PNG, WEBP hoặc PDF tối đa 10 MB.");
   const evidence=paperEvidence(data,{customerSignedAt,facilitySignedAt,customerIdentityVerified:identityVerified});
   if(evidence){const latest=currentDocument(fresh.contract);if(!latest||latest.version!==evidence.documentVersion||latest.contentHash!==evidence.documentHash)throw Error('Phiên bản hợp đồng đã thay đổi. Tải lại và đối chiếu trước khi xác nhận.');paperEvidence(fresh,{customerSignedAt,facilitySignedAt,customerIdentityVerified:identityVerified});}
   await api.confirmPaper(recordId(fresh.contract),file,number,evidence);
   const updated=await load();
   if(updated.contract.status!=='SIGNED'||!updated.contract.signedProofUrl||!['CHECKIN_READY','PAID'].includes(updated.reservation.status))throw Error("Chưa xác nhận hợp đồng đã ký và đơn sẵn sàng bước tiếp theo. Tải lại trước khi tiếp tục.");
   ensureSession();if(fullUpfront(updated)&&(!updated.contract.verifiedAt||updated.reservation.status!=='CHECKIN_READY'))throw Error('Chưa xác minh được hợp đồng giấy. Vui lòng tải lại.');
   setFile(null);setConfirmed(false);setIdentityVerified(false);setCustomerSignedAt('');setFacilitySignedAt('');setFeedback({success:fullUpfront(updated)?'Đã xác minh hợp đồng giấy. Đơn sẵn sàng bàn giao khi đến thời gian thuê.':updated.reservation.status==='PAID'?"Đã lưu bằng chứng hợp đồng giấy. Sẵn sàng bàn giao kho.":"Đã lưu bằng chứng. Khách có thể thanh toán phần còn lại."});
  }else if(action==='handover'){
   if(!handoverEligible(fresh)||!confirmed)throw Error("Cần đơn đã thanh toán và bằng chứng hợp đồng giấy đã ký.");
   const unitId=recordId(fresh.reservation.storageUnitId),unit=apiRecord(await storageApi.unitDetail(unitId));
   if(recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error("Kho ngoài cơ sở của bạn hoặc chưa sẵn sàng bàn giao.");
   ensureSession();if(fullUpfront(fresh)&&(!identityVerified||handoverCondition==='UNSAFE'))throw Error('Cần xác minh danh tính và điều kiện kho an toàn trước khi bàn giao.');
   const response=apiRecord(await api.handover(reservationId,fullUpfront(fresh)?{customerIdentityVerified:true,storageCondition:handoverCondition}:{}));
   if(recordId(response.reservation)!==reservationId||response.reservation.status!=='ACTIVE')throw Error("Chưa xác nhận bàn giao cho đơn này.");
   const updated=await load(),updatedUnit=apiRecord(await storageApi.unitDetail(unitId));
   if(updated.reservation.status!=='ACTIVE'||recordId(updatedUnit)!==unitId||updatedUnit.status!=='OCCUPIED')throw Error("Trạng thái đơn và kho chưa khớp. Tải lại để kiểm tra trước khi thực hiện thao tác tiếp theo.");
   ensureSession();setConfirmed(false);setIdentityVerified(false);setFeedback({success:handoverAccessMessage(updated.reservation)});
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
   const result=apiRecord(await api.completeCheckout(reservationId,condition,checkoutNote.trim()));
   if(recordId(result.reservation)!==reservationId)throw Error('Kết quả trả kho không khớp đơn.');
   const updated=await load(),unit=apiRecord(await storageApi.unitDetail(recordId(fresh.reservation.storageUnitId)));
   ensureSession();if(recordId(unit)!==recordId(fresh.reservation.storageUnitId)||recordId(unit.facilityId)!==facilityId)throw Error('Kho đọc lại không khớp cơ sở.');
   setFeedback({success:checkoutMessage(result,updated.reservation,updated.contract,unit)});
  }else if(action==='rejectCheckout'){
   if(!checkoutPending(fresh))throw Error('Yêu cầu trả kho đã thay đổi. Vui lòng tải lại.');
   if(!rejectReason.trim())throw Error("Vui lòng nhập lý do từ chối yêu cầu trả kho.");
   await api.rejectCheckout(reservationId, rejectReason.trim());
   const updated=await load();ensureSession();if(updated.reservation.checkoutRequest?.status!=='CANCELLED')throw Error('Chưa xác minh được kết quả từ chối yêu cầu trả kho.');
   setRejectReason('');
   setFeedback({success:"Đã từ chối yêu cầu trả kho. Khách hàng cần xử lý trước khi gửi lại yêu cầu."});
  }else if(action==='confirmExtension'){
   if(!selectedExt||!extFile)throw Error("Vui lòng chọn tệp ảnh phụ lục hợp đồng giấy đã ký.");
   if(!extConfirmed)throw Error("Vui lòng xác nhận đã kiểm tra phụ lục hợp đồng giấy.");
   await api.confirmExtensionPaper(reservationId, selectedExt._id, extFile);
   setExtFile(null);setSelectedExt(null);setExtConfirmed(false);
   setFeedback({success:"Xác nhận phụ lục hợp đồng gia hạn thành công! Hạn hợp đồng đã được cập nhật mốc mới."});
   await resource.reload();
  }else if(action==='rejectExtension'){
   if(!selectedExt||!extRejectReason.trim())throw Error("Vui lòng nhập lý do từ chối gia hạn.");
   await api.rejectExtension(reservationId, selectedExt._id, extRejectReason.trim());
   setExtRejectReason('');setSelectedExt(null);
   setFeedback({success:"Đã từ chối gia hạn hợp đồng. Hạn thuê của kho vẫn giữ nguyên mốc cũ."});
   await resource.reload();
  }else{
   const printed=apiRecord(await api.print(recordId(fresh.contract)));
   if(recordId(printed)!==recordId(fresh.contract)||recordId(printed.reservationId)!==reservationId)throw Error("Dữ liệu in không khớp hợp đồng.");
   setPrintData(printed);setAction(null);return;
  }
  setAction(null);announceReviewChange();
 }catch(error){const message=reviewError(error);setFeedback({error:/cloud_name is disabled/i.test(message)?"Dịch vụ lưu hợp đồng Cloudinary đang bị vô hiệu hóa. Bằng chứng chưa được lưu. Liên hệ nhóm máy chủ để khôi phục dịch vụ.":message});resource.reload();}finally{busy.current=false;setSaving(false);}}
 if(!permitted)return <Panel title="Hợp đồng và bàn giao"><p>Cần tài khoản nhân viên hoặc quản lý đã được phân công cơ sở.</p></Panel>;
 return <Panel title="Hợp đồng giấy và bàn giao"><Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Đang tải hợp đồng của đơn…</p>}<Button variant="outline" disabled={saving} onClick={resource.reload}>Tải lại hợp đồng</Button>
 {data&&<div className="mt-4 space-y-4"><Details values={ [["Mã hợp đồng",recordId(data.contract)],["Hợp đồng",data.contract.contractCode],["Trạng thái hợp đồng",<Status value={data.contract.status}/>],["Trạng thái đơn thuê",<Status value={data.reservation.status}/>],["Bằng chứng",data.contract.signedProofUrl?'Đã lưu':"Chưa có dữ liệu"], ...(data.reservation.status==='ACTIVE'?[["PIN mô phỏng",data.reservation.accessPinCode?"Đã cấp mã":"Chưa được cấp"]]:[]), ...(data.reservation.actualCheckoutDate||data.reservation.status==='CHECKED_OUT'?[["Ngày trả kho",data.reservation.actualCheckoutDate?new Date(data.reservation.actualCheckoutDate).toLocaleString('vi-VN'):'—']]:[]), ...(data.reservation.status==='CANCELLED'?[["Lý do từ chối/hủy",data.reservation.cancellationReason||'—']]:[])]}/>
 <Button variant="outline" disabled={saving} onClick={()=>setAction('print')}>Xem dữ liệu in hợp đồng</Button>
 {paperEligible(data)&&<><Field label="Ảnh hoặc PDF hợp đồng giấy đã ký"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={e=>setFile(e.target.files?.[0]||null)}/></Field><Field label="Số hợp đồng giấy (không bắt buộc)"><Input maxLength={100} value={number} disabled={saving} onChange={e=>setNumber(e.target.value)}/></Field></>}
 {fullUpfront(data)&&paperEligible(data)&&<div className="space-y-3"><p>Phiên bản hợp đồng: {currentDocument(data.contract)?.version||'Chưa có dữ liệu'}. Nhập thời điểm ký thực tế theo giờ trên máy; không tự tạo chữ ký.</p><Field label="Thời điểm khách hàng ký"><Input aria-label="Thời điểm khách hàng ký" type="datetime-local" step="1" disabled={saving} value={customerSignedAt} onChange={e=>setCustomerSignedAt(e.target.value)}/></Field><Field label="Thời điểm đại diện cơ sở ký"><Input aria-label="Thời điểm đại diện cơ sở ký" type="datetime-local" step="1" disabled={saving} value={facilitySignedAt} onChange={e=>setFacilitySignedAt(e.target.value)}/></Field></div>}
 {fullUpfront(data)&&(paperEligible(data)||handoverEligible(data))&&<label className="flex gap-2"><input type="checkbox" disabled={saving} checked={identityVerified} onChange={e=>setIdentityVerified(e.target.checked)}/>Tôi đã đối chiếu danh tính khách hàng trực tiếp tại cơ sở.</label>}
 {fullUpfront(data)&&handoverEligible(data)&&<Field label="Điều kiện kho khi bàn giao"><select aria-label="Điều kiện kho khi bàn giao" disabled={saving} value={handoverCondition} onChange={e=>setHandoverCondition(e.target.value)}><option value="GOOD">Tốt</option><option value="MINOR_DAMAGE">Có hư hỏng nhẹ đã ghi nhận</option><option value="UNSAFE">Không an toàn — không bàn giao</option></select></Field>}
 {(paperEligible(data)||handoverEligible(data))&&<label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra khách hàng, hợp đồng và điều kiện bàn giao.</label>}
 <div className="flex flex-wrap gap-3">
   {paperEligible(data)&&<Button disabled={saving||!file||!confirmed||(fullUpfront(data)&&(!identityVerified||!customerSignedAt||!facilitySignedAt||!currentDocument(data.contract)))} onClick={()=>setAction('paper')}>Xác nhận hợp đồng giấy</Button>}
   {handoverEligible(data)&&<Button disabled={saving||!confirmed||(fullUpfront(data)&&(!identityVerified||handoverCondition==='UNSAFE'))} onClick={()=>setAction('handover')}>Hoàn tất bàn giao</Button>}
   {rejectEligible(data)&&<Button variant="destructive" disabled={saving} onClick={()=>{setFeedback({});setAction('reject');}}>Từ chối nhận kho (Khách không ưng)</Button>}
   {checkoutEligible(data)&&<Button disabled={saving} onClick={()=>{setFeedback({});setAction('checkout');}}>Nghiệm thu trả kho (Checkout)</Button>}
   {checkoutPending(data)&&<Button variant="destructive" disabled={saving} onClick={()=>{setFeedback({});setAction('rejectCheckout');}}>Từ chối yêu cầu trả kho</Button>}
 </div>
 {checkoutPending(data)&&<div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">🔔 <strong>Khách yêu cầu trả kho:</strong> {data.reservation.checkoutRequest?.note||"Khách đã dọn sạch đồ, nhờ kiểm tra."}</div>}
 {data.reservation.status==='CHECKIN_READY'&&<p>{fullUpfront(data)?'Đã thanh toán đủ và xác minh hợp đồng. Có thể bàn giao khi thời gian thuê đã bắt đầu và kho sẵn sàng.':'Chờ khách thanh toán phần còn lại. Tải lại sau khi thanh toán.'}</p>}
 {fullUpfront(data)&&data.reservation.signingDeadline&&<p>Hạn ký hợp đồng: {new Date(data.reservation.signingDeadline).toLocaleString('vi-VN')}. {Date.parse(data.reservation.signingDeadline)<=Date.now()&&data.contract.status!=='SIGNED'?'Đã quá hạn ký. Cần quản lý xem xét; chưa có chức năng xác nhận hoàn tiền tại đây.':''}</p>}
 {fullUpfront(data)&&paperEligible(data)&&<p>Để hủy hoặc hoàn tiền đơn đã thanh toán đầy đủ, vui lòng liên hệ quản lý cơ sở.</p>}
 {data.reservation.status==='ACTIVE'&&<p className="text-emerald-700 font-medium">{handoverAccessMessage(data.reservation)}</p>}
 {data.reservation.status==='CHECKED_OUT'&&<p className="text-emerald-700 font-medium">✅ Đơn thuê đã được nghiệm thu trả kho hoàn tất (CHECKED_OUT). Tình trạng cho thuê tiếp phụ thuộc kết quả kiểm tra và bảo trì.</p>}
 {data.reservation.status==='CANCELLED'&&<p className="text-rose-700 font-medium">Đơn thuê đã bị từ chối / hủy. Ô kho đã được giải phóng.</p>}
  {data.reservation.extendContract?.filter(e => e.status === 'PAID').map(ext => (
    <div key={ext._id} className="rounded-xl border border-sky-300 bg-sky-50 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sky-950">📑 Khách yêu cầu ký phụ lục gia hạn (Mã: {ext.extensionCode})</h4>
        <span className="rounded bg-sky-200 px-2 py-0.5 text-xs font-bold text-sky-800">Chờ ký giấy</span>
      </div>
      <p className="text-sm text-sky-900">
        Khách đã thanh toán <strong>{money(ext.amount)}</strong> để gia hạn thêm <strong>+{ext.durationMonths} tháng</strong>.
        Hạn hợp đồng mới sau khi xác nhận: <strong>{new Date(ext.newEndDate).toLocaleDateString('vi-VN')}</strong>.
      </p>
      <p className="text-xs text-sky-700">
        Hạn chót ký phụ lục (SLA 3 ngày): <strong>{ext.signingDeadline ? new Date(ext.signingDeadline).toLocaleString('vi-VN') : '—'}</strong>.
      </p>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { setSelectedExt(ext); setAction('confirmExtension'); }}>
          📄 Tải ảnh & Xác nhận gia hạn
        </Button>
        <Button size="sm" variant="destructive" onClick={() => { setSelectedExt(ext); setAction('rejectExtension'); }}>
          ❌ Từ chối gia hạn
        </Button>
      </div>
    </div>
  ))}
  {data.reservation.extendContract?.length > 0 && (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
      <h4 className="font-semibold text-slate-800 text-sm">Lịch sử các lần gia hạn hợp đồng</h4>
      <div className="space-y-2">
        {data.reservation.extendContract.map((ext, idx) => (
          <div key={ext._id || idx} className="flex flex-wrap items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
            <div>
              <span className="font-semibold text-slate-900">{ext.extensionCode}</span>: +{ext.durationMonths} tháng ({money(ext.amount)})
              <div className="text-slate-500">
                Hạn mới: {new Date(ext.newEndDate).toLocaleDateString('vi-VN')} | Trạng thái: <span className="font-medium text-slate-700">{ext.status}</span>
                {ext.rejectionReason && <span className="text-rose-600 block">Lý do từ chối: {ext.rejectionReason}</span>}
              </div>
            </div>
            {ext.paperProofUrl && (
              <a href={ext.paperProofUrl} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline font-medium">
                Xem phụ lục đã ký ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )}
 </div>}
 {action&&<Dialog title={action==='paper'?"Lưu bằng chứng hợp đồng đã ký":action==='handover'?"Xác nhận bàn giao":action==='reject'?"Từ chối nhận kho (Khách không ưng kho)":action==='checkout'?"Nghiệm thu trả kho (Checkout)":action==='rejectCheckout'?"Từ chối yêu cầu trả kho":action==='confirmExtension'?"Xác nhận phụ lục hợp đồng gia hạn giấy":action==='rejectExtension'?"Từ chối phụ lục hợp đồng gia hạn":"Tải dữ liệu in"} onClose={()=>{if(!busy.current)setAction(null);}}>
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
    ):action==='confirmExtension'?(
      <>
        <p className="text-sm text-slate-600">
          Khách hàng đến cơ sở ký phụ lục hợp đồng gia hạn giấy cho đơn thuê kho.
          Nhân viên kiểm tra và tải ảnh chụp phụ lục đã ký lên hệ thống để chính thức gia hạn hợp đồng.
        </p>
        <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900 space-y-1">
          <p>Mã phụ lục: <strong>{selectedExt?.extensionCode}</strong></p>
          <p>Gia hạn thêm: <strong>+{selectedExt?.durationMonths} tháng</strong></p>
          <p>Hạn hợp đồng mới: <strong>{selectedExt?.newEndDate ? new Date(selectedExt.newEndDate).toLocaleDateString('vi-VN') : '—'}</strong></p>
        </div>
        <Field label="Ảnh chụp phụ lục hợp đồng giấy đã ký">
          <Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={e=>setExtFile(e.target.files?.[0]||null)}/>
        </Field>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={extConfirmed} disabled={saving} onChange={e=>setExtConfirmed(e.target.checked)}/>
          Tôi đã kiểm tra tính chính xác của bản phụ lục và chữ ký của khách hàng.
        </label>
      </>
    ):action==='rejectExtension'?(
      <>
        <p className="text-sm text-slate-600">
          Từ chối phụ lục hợp đồng gia hạn khi thông tin giấy tờ không hợp lệ hoặc khách hàng đổi ý không muốn gia hạn tiếp.
        </p>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          ⚠️ Hạn kết thúc của hợp đồng chính vẫn giữ nguyên mốc cũ. Khách hàng sẽ được hướng dẫn thủ tục hoàn 100% số tiền gia hạn đã nộp ngoài hệ thống.
        </div>
        <Field label="Lý do từ chối gia hạn (bắt buộc)">
          <Textarea rows={3} placeholder="Ví dụ: Khách hàng không đồng ý với điều khoản phụ lục mới..." value={extRejectReason} disabled={saving} required onChange={e=>setExtRejectReason(e.target.value)}/>
        </Field>
      </>
    ):(
      <p className="mb-4">Kiểm tra và xác nhận thao tác với đơn hiện tại.</p>
    )}
    <Message {...feedback}/>
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" disabled={saving} onClick={()=>setAction(null)}>Hủy bỏ</Button>
      <Button type="submit" variant={action==='reject'||action==='rejectCheckout'?'destructive':'default'} disabled={saving||((action==='reject'||action==='rejectCheckout')&&!rejectReason.trim())||(action==='rejectExtension'&&!extRejectReason.trim())||(action==='confirmExtension'&&(!extFile||!extConfirmed))}>
        {saving?"Đang xử lý…":action==='reject'?"Xác nhận từ chối":action==='rejectCheckout'?"Từ chối yêu cầu":action==='checkout'?"Xác nhận trả kho":action==='confirmExtension'?"Tải lên & Xác nhận gia hạn":action==='rejectExtension'?"Xác nhận từ chối":"Xác nhận"}
      </Button>
    </div>
  </form>
 </Dialog>}
 {printData&&<Dialog title="Dữ liệu hợp đồng" onClose={()=>setPrintData(null)}><Details values={ [["Hợp đồng",printData.contractCode],["Khách hàng",printData.customerSnapshot?.fullName||printData.customerId?.email||'—'],["Đơn thuê",printData.reservationId?.reservationCode||reservationId],["Tổng tiền thanh toán",money(printData.pricingSnapshot?.estimatedRent||0)],["Trạng thái",printData.status]]}/><p className="mt-4">Đây là dữ liệu hợp đồng từ máy chủ. Bản PDF pháp lý hoàn chỉnh chưa được cung cấp.</p><Button variant="outline" onClick={()=>window.print()}>In trang này</Button></Dialog>}
 </Panel>;
}
