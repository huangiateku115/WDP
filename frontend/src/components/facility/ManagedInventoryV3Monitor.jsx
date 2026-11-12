import { useCallback, useEffect, useState } from 'react';
import { managedInventoryV3Api } from '@/api/managedInventoryV3Api';
import { managedAccessApi } from '@/api/managedAccessApi';
import { useAuthSession } from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import { accessRows } from '@/lib/managedAccessFacility';
import { managedOverview } from '@/lib/managedInventoryMonitor';
import { objectId } from '@/lib/facilityReview';
import { OpenLink } from '@/components/manager/ManagerUI';
import { facilityLabel } from '@/lib/facilityLabels';

export default function ManagedInventoryV3Monitor({ role }) {
  const {user,accessToken}=useAuthSession();
  return <MonitorContent key={`${role}:${user?.id}:${user?.assignedFacilityId}:${accessToken}`} role={role}/>;
}
function MonitorContent({role}) {
  const {user,accessToken}=useAuthSession(),permitted=!!accessToken&&user?.role===(role==='manager'?'FACILITY_MANAGER':'FACILITY_STAFF')&&objectId(user.assignedFacilityId);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const load=useCallback(async()=>{const [response,access]=await Promise.all([managedInventoryV3Api.facilityOverview(),managedAccessApi.facilitySessions()]);return {overview:managedOverview(response,user.assignedFacilityId),sessions:accessRows(access,'session',user)};},[user?.id,user?.assignedFacilityId,accessToken]);
  const resource=useFacilityResource(load,permitted),overview=resource.data?.overview,sessions=resource.data?.sessions||[],error=resource.error,loading=resource.loading,refresh=resource.reload;
  if(!permitted)return <p role="alert">Cần đúng vai trò và cơ sở được phân công để giám sát hàng hóa.</p>;
  const activeSessions = sessions.filter(session => session.status === 'ACTIVE' && Date.parse(session.expiresAt) > now && Date.parse(session.startedAt) <= now);
  const activeIds = new Set(activeSessions.map(session => String(session._id)));
  const rows = (overview?.rows || []).map(row => ({ ...row, recentMovements: role === 'staff'
    ? row.recentMovements.filter(movement => activeIds.has(String(movement.v3Effect?.accessSessionId))) : row.recentMovements }));
  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-emerald-800">Lưu trữ hàng hóa · {role === 'manager' ? 'Quản lý' : 'Nhân viên'}</p>
      <h1 className="mt-2 text-2xl font-bold">{role === 'manager' ? 'Giám sát tồn kho và dung lượng' : 'Hoạt động nhập hàng trong phiên truy cập'}</h1>
      <p className="mt-2 text-sm text-slate-600">{role === 'manager' ? 'Theo dõi tồn, phân bổ và kết quả đối soát; không sửa tồn tại đây. Số liệu dung lượng ô chưa được đối soát đầy đủ với toàn bộ lịch sử.' : 'Khách tự xác nhận nhập hàng. Nhân viên chỉ giám sát hoạt động đã ghi nhận trong phiên được giao, không có nút xác nhận thay khách.'}</p><div className="mt-3 flex flex-wrap gap-4"><OpenLink to={`/${role}/managed-access`}>Lịch đến kho và phiên truy cập</OpenLink><OpenLink to={`/${role}/managed`}>Hồ sơ hàng hóa</OpenLink></div></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error} <button onClick={refresh} className="ml-2 underline">Thử lại</button></p>}
    {!error&&<div className="grid gap-3 sm:grid-cols-3"><article className="rounded-xl border bg-white p-4"><b>Mặt hàng V3</b><p className="mt-1 text-2xl">{overview?.rows?.length ?? '—'}</p></article><article className="rounded-xl border bg-white p-4"><b>Phiên đang hoạt động</b><p className="mt-1 text-2xl">{overview?activeSessions.length:'—'}</p></article><article className="rounded-xl border bg-white p-4"><b>Trạng thái</b><p className="mt-1">{loading ? 'Đang tải…' : 'Chỉ đọc'}</p></article></div>}
    {loading&&<p role="status">Đang tải giám sát hàng hóa…</p>}{!error&&!rows.length&&!loading?<p className="rounded-xl border bg-white p-6 text-sm text-slate-600">Chưa có mặt hàng V3 trong cơ sở này.</p>:<div className="space-y-4">{rows.map(({item,projection,recentMovements,reconciliationStatus,capacityReconciliationStatus,capacityReconciliationReasons=[],capacityReconciliationRequiredEvidence=[],capacity=[]})=><article key={item._id} className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold">{item.name} · {item.itemCode}</h2><p className="text-xs text-slate-500">Đơn thuê {String(item.managedReservationId)}</p></div><span className={`rounded-full px-2 py-1 text-xs ${reconciliationStatus==='RECONCILED'?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}`}>{reconciliationStatus==='RECONCILED'?'Đã đối soát':reconciliationStatus==='UNKNOWN'?'Chưa đủ dữ liệu đối soát':'Cần đối soát'}</span></div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><p>Tồn: {reconciliationStatus==='RECONCILED'?(projection?.onHandQuantity ?? '—'):'—'} {item.quantityUnit}</p><p>Khối lượng: {reconciliationStatus==='RECONCILED'?(projection?.totalWeightKg ?? '—'):'—'} kg</p><p>Thể tích: {reconciliationStatus==='RECONCILED'?(projection?.totalVolumeM3 ?? '—'):'—'} m³</p><p>Phiên bản sổ biến động: {projection?.ledgerRevision ?? '—'}</p></div>
      {reconciliationStatus==='RECONCILED'&&projection?.byCell?.length>0&&<div className="mt-3 flex flex-wrap gap-2">{projection.byCell.map(cell=><span key={cell.cellId} className="rounded bg-slate-100 px-2 py-1 text-xs">Ô {String(cell.cellId)} · {cell.quantity} đơn vị + {cell.physicalUnitCount} vật thể · {cell.weightKg} kg / {cell.volumeM3} m³</span>)}</div>}
      {capacity.length>0&&<div className="mt-3 space-y-1"><h3 className="text-sm font-semibold">Dung lượng Ô được cấp</h3>{capacity.map(cell=><p key={cell._id} className="text-xs text-slate-600">Ô {String(cell._id)} · {facilityLabel(cell.operationalStatus)} · tải {cell.usedWeightKg}/{cell.maxWeightKg} kg · thể tích đang dùng {cell.usedVolumeM3} m³</p>)}</div>}
      {role==='manager'&&capacityReconciliationStatus==='UNKNOWN'&&<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><b>Đối soát dung lượng: chưa thể kết luận.</b><ul className="mt-1 list-disc pl-5">{capacityReconciliationReasons.map(reason=><li key={reason}>{reason==='CELL_COUNTERS_INCLUDE_LEGACY_AND_V3_WRITERS'?'Số liệu ô được dùng chung bởi luồng lịch sử và V3.':reason==='FACILITY_WIDE_LEDGER_BASELINE_NOT_REPLAYED'?'Chưa đối chiếu toàn bộ lịch sử cơ sở để xác định tải tổng hợp.':'Tồn tổng hợp chưa khớp sổ biến động gốc.'}</li>)}</ul><p className="mt-2">Cần: {'Đối chiếu sổ biến động toàn cơ sở, tải trọng ô/tầng kệ và dung lượng đã phân bổ.'}</p></div>}
      <h3 className="mt-4 text-sm font-semibold">Biến động gần đây {role==='staff'?'trong phiên đang hoạt động':''}</h3>{recentMovements.length===0?<p className="mt-1 text-xs text-slate-500">Không có biến động phù hợp để hiển thị.</p>:recentMovements.map(movement=><p key={movement._id} className="mt-1 break-all text-xs">{new Date(movement.performedAt).toLocaleString('vi-VN')} · {({ADD:'Nhập hàng',REMOVE:'Xuất hàng',MOVE:'Di chuyển'})[movement.v3Effect?.action]||movement.v3Effect?.action} · Khách {String(movement.performedBy).slice(-6)} · {movement.quantity} {movement.quantityUnit}</p>)}
      {role==='manager'&&reconciliationStatus==='RECONCILED'&&projection?.byBatch?.length>0&&<details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Chi tiết vị trí lô ({projection.byBatch.length})</summary>{projection.byBatch.map(line=><p key={`${line.batchId}-${line.cellId}`} className="mt-1 text-xs">Lô {line.batchId} · Ô {line.cellId} · {line.quantity} {line.quantityUnit}</p>)}</details>}
    </article>)}</div>}
    <p className="text-xs text-slate-500">Báo cáo trả tối đa 200 mặt hàng và 25 biến động gần nhất cho mỗi mặt hàng; không phải toàn bộ lịch sử.</p>
    <button type="button" disabled={loading} onClick={refresh} className="rounded-lg border px-4 py-2 text-sm font-semibold">Tải lại số liệu</button>
  </main>;
}
