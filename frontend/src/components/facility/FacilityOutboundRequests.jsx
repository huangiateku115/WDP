import {useCallback, useState} from 'react';
import {managedInventoryV3OutboundApi as api} from '@/api/managedInventoryV3OutboundApi';
import useFacilityResource from '@/lib/useFacilityResource';
import {outboundLabel, outboundPage, outboundDetail} from '@/lib/facilityOutbound';
import {OpenLink} from '@/components/manager/ManagerUI';

const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
const button = 'rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50';
export default function FacilityOutboundRequests({role, facilityId}) {
  const [filter,setFilter] = useState({state:'',page:1});
  const [requestId,setRequestId] = useState('');
  const load = useCallback(async () => outboundPage(await api.facilityRequests({page:filter.page,limit:20,...(filter.state?{state:filter.state}:{})}),facilityId,filter.page),[facilityId,filter]);
  const list = useFacilityResource(load);
  const loadDetail = useCallback(async () => outboundDetail(await api.facilityRequest(requestId),facilityId,requestId),[facilityId,requestId]);
  const detail = useFacilityResource(loadDetail,!!requestId);
  const changePage = page => {setRequestId('');setFilter(current=>({...current,page}));};
  return <section className="facility-outbound min-w-0 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 text-lg font-bold">Yêu cầu xuất hàng tự quản</h2><button type="button" className={button} disabled={list.loading} onClick={()=>{list.reload();if(requestId)detail.reload();}}>Tải lại yêu cầu xuất</button></div>
    <p className="mt-2 text-sm text-slate-600">{role==='staff'?'Chỉ hiển thị yêu cầu thuộc đơn thuê có lịch xuất hàng được phân công cho bạn.':'Giám sát yêu cầu xuất hàng trong cơ sở được phân công.'} Khách tự xác nhận xuất hàng; nhân viên và quản lý hỗ trợ, giám sát.</p>
    <div className="my-4 flex flex-wrap items-end gap-4"><label className="grid w-full min-w-0 flex-none gap-2 text-sm sm:w-auto sm:flex-1 sm:max-w-xs">Trạng thái yêu cầu<select className="rounded-lg border p-2" value={filter.state} onChange={event=>{setRequestId('');setFilter({state:event.target.value,page:1});}}><option value="">Tất cả trạng thái</option>{['PENDING','CONFIRMED','CANCELLED'].map(state=><option key={state} value={state}>{outboundLabel(state)}</option>)}</select></label><OpenLink to={`/${role}/managed-access`}>Mở lịch đến kho và phiên truy cập</OpenLink></div>
    {list.loading&&<p role="status">Đang tải yêu cầu xuất hàng…</p>}
    {list.error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">Không tải được yêu cầu xuất. {list.error}</p>}
    {!list.loading&&!list.error&&list.data&&<>
      {!list.data.rows.length?<p>Không có yêu cầu phù hợp trong phạm vi được phép.</p>:<div className="space-y-3">{list.data.rows.map(row=><article key={row.requestId} className="rounded-lg border p-3">
        <div className="flex flex-wrap justify-between gap-2"><b className="min-w-0 break-words [overflow-wrap:anywhere]">{row.sku?.name||row.sku?.itemCode||row.skuId} · {row.requestedQuantity} {row.quantityUnit}</b><span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs">{outboundLabel(row.state)}</span></div>
        <p className="mt-2 break-all text-sm">Mã yêu cầu: {row.requestId} · Ngày tạo: {date(row.createdAt)}</p><p className="break-all text-sm">Ô nguồn: {row.sourceCellIds.join(', ')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4"><button className={button} type="button" onClick={()=>{setRequestId(row.requestId);detail.reload();}}>Xem chi tiết và lịch sử</button><OpenLink to={`/${role}/managed?itemId=${row.skuId}`}>Xem tồn mặt hàng</OpenLink></div>
      </article>)}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} type="button" disabled={filter.page<=1} onClick={()=>changePage(filter.page-1)}>Trang trước</button><p>Trang {filter.page}/{Math.max(1,list.data.pagination.totalPages)} · {list.data.pagination.total} yêu cầu</p><button className={button} type="button" disabled={filter.page>=list.data.pagination.totalPages} onClick={()=>changePage(filter.page+1)}>Trang sau</button></div>
    </>}
    {requestId&&<div className="mt-5 rounded-lg border bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-3"><h3 className="break-all font-semibold">Chi tiết yêu cầu {requestId}</h3><button type="button" className={button} onClick={()=>setRequestId('')}>Đóng chi tiết</button></div>
      {detail.loading&&<p role="status">Đang tải chi tiết…</p>}{detail.error&&<p role="alert" className="mt-3 text-red-800">{detail.error} <button type="button" className="underline" onClick={detail.reload}>Thử lại chi tiết</button></p>}
      {!detail.loading&&!detail.error&&detail.data&&<OutboundDetails data={detail.data}/>}
    </div>}
  </section>;
}
function OutboundDetails({data}) {
  const stock = data.stock;
  const verified = ['onHandQuantity','heldQuantity','availableQuantity'].every(key=>Number.isSafeInteger(stock?.[key])&&stock[key]>=0) && stock.onHandQuantity-stock.heldQuantity===stock.availableQuantity;
  return <div className="mt-3 space-y-2 text-sm">
    <p>Khách hàng: {data.customer?.displayName||'Chưa có tên'} · {outboundLabel(data.request.state)}</p>
    <p className="break-all">Đơn thuê: {data.request.reservationId}</p><p>Số lượng yêu cầu: {data.request.requestedQuantity} {data.request.quantityUnit}</p>
    {verified?<p>Tồn hiện tại: {stock.onHandQuantity} · Đang giữ: {stock.heldQuantity} · Có thể xuất: {stock.availableQuantity}</p>:<p>Xem tồn đã đối soát tại chi tiết mặt hàng.</p>}
    <h4 className="pt-2 font-semibold">Lịch sử yêu cầu</h4>{!data.events.length?<p>Chưa có lịch sử.</p>:data.events.map(event=><p key={`${event.operation}:${event.resultingVersion}`}>{outboundLabel(event.operation)} · Phiên bản {event.resultingVersion} · {date(event.occurredAt)}</p>)}
    <h4 className="pt-2 font-semibold">Biến động xuất đã ghi nhận</h4>{!data.movements.length?<p>Chưa ghi nhận xuất hàng cho yêu cầu này.</p>:data.movements.map(movement=><p className="break-all" key={movement._id}>Mã biến động: {movement._id} · Số lượng: {movement.quantity} {movement.quantityUnit} · {date(movement.performedAt)}</p>)}
    <p className="pt-2 text-slate-600">Hoàn tất xuất hàng không đồng nghĩa trả không gian hay đóng hợp đồng.</p>
  </div>;
}
