import {useCallback, useEffect, useState} from 'react';
import inventoryApi from '@/api/inventoryApi';
import {managedInventoryV3Api} from '@/api/managedInventoryV3Api';
import {managedAccessApi} from '@/api/managedAccessApi';
import useFacilityResource from '@/lib/useFacilityResource';
import {recordId} from '@/lib/facilityReview';
import {loadFacilityInventory, visibleInventoryMovements} from '@/lib/facilityInventoryDetail';
import {facilityLabel} from '@/lib/facilityLabels';
import {Panel, Details, Table, Button, Message, Status, OpenLink} from '@/components/manager/ManagerUI';

const at = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
export default function FacilityInventoryDetail({itemId, user, role}) {
  const [tab, setTab] = useState('stock'), [now, setNow] = useState(Date.now());
  const load = useCallback(signal => loadFacilityInventory({itemId, user, inventoryApi, v3Api: managedInventoryV3Api, accessApi: managedAccessApi, signal}), [itemId, user.id, user.role, user.assignedFacilityId]);
  const resource = useFacilityResource(load), data = resource.data;
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer);}, []);
  const stock = data?.stock, self = data?.source === 'self', verified = !self || stock?.reconciliationStatus === 'RECONCILED';
  const movements = data ? visibleInventoryMovements(data, user, now) : [];
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><OpenLink to={`/${role}/managed`}>Về danh sách hàng hóa</OpenLink><Button variant="outline" disabled={resource.loading} onClick={resource.reload}>Tải lại mặt hàng</Button></div>
    <Message error={resource.error}/>{resource.loading && <p role="status">Đang tải tồn và lịch sử mặt hàng…</p>}
    {data && <><Panel title={`${data.item.itemCode} · ${data.item.name}`} subtitle="Chỉ tra cứu. Số lượng đăng ký không phải số lượng tồn thực tế.">
      <Details values={[["Mã mặt hàng", recordId(data.item)], ["Trạng thái", <Status value={data.item.status}/>], ["Đơn thuê", recordId(data.item.managedReservationId)], ["Nguồn ghi nhận", self ? 'Khách tự quản hàng hóa' : 'Hồ sơ tiếp nhận theo lô'], ["Số lượng đăng ký", `${data.item.quantity ?? '—'} ${data.item.quantityUnit || ''}`], ["Khách hàng", data.item.customerId?.displayName || data.item.customerId?.email || recordId(data.item.customerId)]]}/>
      {role === 'manager' && <p className="mt-4"><OpenLink to={`/manager/reservations/${recordId(data.item.managedReservationId)}?service=managed`}>Đơn thuê và hợp đồng</OpenLink></p>}
    </Panel>
    <div className="flex flex-wrap gap-2" aria-label="Nội dung mặt hàng">{[['stock','Tồn và vị trí'],['batches','Lô và vật thể'],['history','Lịch sử biến động']].map(([key,label]) => <Button key={key} variant={tab === key ? 'default' : 'outline'} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</Button>)}</div>
    {!verified && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Tồn tự quản chưa được đối soát đầy đủ. Chưa hiển thị số lượng và vị trí như dữ liệu đã xác nhận. Có thể xem lịch sử đã ghi nhận và tải lại để kiểm tra.</p>}
    {tab === 'stock' && <Panel title="Tồn và vị trí hiện tại"><Details values={[["Tồn hiện tại", verified ? `${stock.onHandQuantity} ${data.item.quantityUnit}` : 'Chưa xác minh'], ["Đang giữ", verified ? stock.heldQuantity : 'Chưa xác minh'], ["Khả dụng", verified ? stock.onHandQuantity - stock.heldQuantity : 'Chưa xác minh'], ["Khối lượng thực tế (kg)", verified ? (self ? stock.totalWeightKg : stock.actualTotalWeightKg) ?? 'Chưa xác định' : 'Chưa xác minh'], ["Thể tích thực tế (m³)", verified ? (self ? stock.totalVolumeM3 : stock.actualTotalVolumeM3) ?? 'Chưa xác định' : 'Chưa xác minh'], ["Đối soát", self ? verified ? 'Đã đối soát' : 'Cần đối soát' : 'Theo bản tồn và lô từ hệ thống']]}/>
      {verified && (self ? <div className="mt-5"><Table label="Vị trí hàng" rows={stock.byCell.map(row => ({...row,id:recordId(row.cellId)}))} columns={[{key:'cellId',label:'Ô lưu trữ',render:r=>recordId(r.cellId)},{key:'quantity',label:'Số lượng theo lô'},{key:'physicalUnitCount',label:'Vật thể nguyên khối'},{key:'weightKg',label:'Khối lượng (kg)'},{key:'volumeM3',label:'Thể tích (m³)'}]} empty="Chưa có vị trí được ghi nhận trong nguồn tồn này."/></div> : <p className="mt-4 break-words">Ô hiện tại: {recordId(stock.currentCellId) || 'Chưa có vị trí'}</p>)}
      {self && <p className="mt-4 text-sm text-slate-500">Đối soát tồn mặt hàng không có nghĩa dung lượng toàn cơ sở đã được đối soát. Không cộng tồn này với nguồn tiếp nhận theo lô.</p>}
    </Panel>}
    {tab === 'batches' && <Panel title="Lô và vật thể đã ghi nhận">{verified ? <>
      <Table label="Lô hàng" rows={(self ? stock.byBatch : stock.batches).map((row,i)=>({...row,id:`${row.batchId}:${row.cellId || ''}:${i}`}))} columns={[{key:'batchId',label:'Mã lô'},{key:'cellId',label:'Ô lưu trữ',render:r=>recordId(r.cellId || stock.currentCellId)||'Chưa có vị trí'},{key:'quantity',label:'Số lượng'},{key:'heldQuantity',label:'Đang giữ'},{key:'quantityUnit',label:'Đơn vị',render:r=>r.quantityUnit || data.item.quantityUnit}]} empty="Chưa có lô hàng được ghi nhận."/>
      {self && <div className="mt-5"><Table label="Vật thể nguyên khối" rows={stock.byPhysicalUnit.map(row=>({...row,id:recordId(row.physicalUnitId)}))} columns={[{key:'physicalUnitId',label:'Mã vật thể',render:r=>recordId(r.physicalUnitId)},{key:'cellIds',label:'Các ô lưu trữ',render:r=>r.cellIds.map(recordId).join(', ')},{key:'weightKg',label:'Khối lượng (kg)'},{key:'volumeM3',label:'Thể tích (m³)'}]} empty="Chưa có vật thể nguyên khối được ghi nhận."/></div>}
    </> : <p>Chưa đủ dữ liệu đối soát để trình bày lô và vị trí đã xác nhận.</p>}</Panel>}
    {tab === 'history' && <Panel title="Lịch sử biến động"><p className="mb-4 text-sm text-slate-500">{self ? role === 'staff' ? 'Chỉ hiển thị biến động trong phiên còn hiệu lực được giao cho bạn. Không có kết quả không đồng nghĩa mặt hàng chưa từng có biến động.' : 'Tối đa 200 biến động gần nhất do API trả về, không phải toàn bộ lịch sử.' : 'Lịch sử của nguồn tiếp nhận theo lô; không ghép hoặc cộng với nguồn tự quản.'}</p>
      <Table label="Lịch sử mặt hàng" rows={movements.map(row=>({...row,id:recordId(row)}))} columns={[{key:'performedAt',label:'Thời điểm',render:r=>at(r.performedAt)},{key:'type',label:'Thao tác',render:r=>self ? ({ADD:'Nhập hàng',REMOVE:'Xuất hàng',MOVE:'Di chuyển'})[r.v3Effect.action] : facilityLabel(r.type)},{key:'quantity',label:'Số lượng'},{key:'quantityUnit',label:'Đơn vị'},{key:'performedBy',label:'Người thực hiện',render:r=>recordId(r.performedBy)||'Chưa có'}]} empty="Không có biến động phù hợp trong dữ liệu và phạm vi đang xem."/>
    </Panel>}
    </>}
  </>;
}
