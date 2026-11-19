import {useParams,useSearchParams} from 'react-router-dom';
import {readBookingPeriod} from '@/lib/managedCellBooking';
import DigitalWarehouseDashboard from '@/components/customer/warehouse/DigitalWarehouseDashboard';
import {ArrowUp, ArrowLeft} from 'lucide-react';
import warehouseMapApi from '@/api/warehouseMapApi';
import facilityApi from '@/api/facilityApi';
import WarehouseBreadcrumbs from '@/components/customer/WarehouseBreadcrumbs';
import {Badge} from '@/components/ui/badge';
import {CustomerScreen,Card,CardContent,Button,Link,Details,LoadState,useBackend,record,validId} from '@/components/customer/RentalBackendUI';
import {validateWarehouseMap,validateRackDetail,warehouseAxis,weightText,measurementText} from '@/lib/warehouseMap';

const baseline = 'Sơ đồ MI-01 chỉ thể hiện cấu trúc kho. Số liệu tải trọng là thông tin nền kỹ thuật; chưa phản ánh tồn kho và tình trạng chiếm chỗ thực tế. Không thể đặt thuê ô tại trang này.';
const operationalLabels = { AVAILABLE: 'Đang khả dụng', RESERVED: 'Đã được đặt', OCCUPIED: 'Đang sử dụng', BLOCKED: 'Đang khóa', MAINTENANCE: 'Đang bảo trì', UNAVAILABLE: 'Chưa khả dụng', UNKNOWN: 'Chưa xác minh' };
const utilizationLabels = { EMPTY: 'Chưa sử dụng', PARTIAL: 'Đang sử dụng', NEAR_FULL: 'Gần đầy', FULL: 'Đã đầy', UNKNOWN: 'Chưa xác minh' };
const capacitySourceLabels = { WAREHOUSE_CELL_COUNTERS: 'Bộ đếm dung lượng của các ô' };
function OperationalStatus({status}) {
  return <Badge variant={status==='AVAILABLE'?'green':'orange'} className={status==='BLOCKED'?'bg-red-50 text-red-800':!['AVAILABLE','MAINTENANCE'].includes(status)?'bg-slate-100 text-slate-700':''}>{operationalLabels[status] || 'Chưa có trạng thái'}</Badge>;
}
function MapState({resource}) {
  return <LoadState resource={resource}/>;
}
function FacilityContext({facilityId,rackCode}) {
  const facility = useBackend(config => validId(facilityId) ? facilityApi.publicDetail(facilityId,config).then(record) : Promise.resolve(null), [facilityId], true);
  return <div className="min-w-0 text-sm"><WarehouseBreadcrumbs facilityId={facilityId} facilityName={facility.data?.name} rackCode={rackCode}/><p className="break-words font-semibold text-[#176B3A]">Cơ sở: {facility.data?.name || facilityId}</p>{facility.loading && <p role="status">Đang tải thông tin cơ sở…</p>}{facility.error && <p className="mt-1 text-slate-500">Chưa tải được tên cơ sở. Quyền xem bản đồ vẫn do hệ thống xác minh.</p>}</div>;
}
function BackLink({to,children}) {
  return <Button asChild variant="outline"><Link to={to}><ArrowLeft size={16}/>{children}</Link></Button>;
}
function ZoneMap({zone,facilityId}) {
  const racks = zone.aisles.flatMap(aisle => aisle.racks), x = warehouseAxis(racks.map(r=>r.mapX)), y = warehouseAxis(racks.map(r=>r.mapY));
  return <Card><CardContent className="min-w-0"><h2 className="break-words text-xl font-bold">{zone.code} {zone.name && `· ${zone.name}`}</h2>
    <div className="my-4 flex flex-wrap gap-3 text-sm">{zone.aisles.map(aisle => <h3 key={aisle.aisleCode} className="rounded-lg bg-[#EAF5EE] px-3 py-2 font-semibold text-[#176B3A]">Lối đi {aisle.aisleCode} · {aisle.racks.length} kệ</h3>)}</div>
    {!racks.length ? <p>Khu vực này chưa có kệ.</p> : <>
      <p className="mb-3 text-xs text-slate-500">Tọa độ X tăng từ trái sang phải, Y tăng từ trên xuống dưới. Đây là vị trí trên lưới, không phải đơn vị mét. Biểu tượng thể hiện hướng đặt kệ; tên kệ luôn giữ chiều ngang.</p>
      {(x.condensed || y.condensed) && <p className="mb-3 text-xs text-orange-800">Các khoảng trống tọa độ lớn đã được thu gọn. Mỗi kệ vẫn hiển thị đúng tọa độ X/Y.</p>}
      <div tabIndex={0} role="region" aria-label={`Lưới kệ thuộc khu vực ${zone.code}`} className="max-w-full overflow-auto rounded-xl border border-green-100 bg-[#F3F8F4] p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#176B3A]">
        <div className="grid w-max gap-3" style={{gridTemplateColumns:`repeat(${x.count}, 12rem)`,gridTemplateRows:`repeat(${y.count}, minmax(18rem, auto))`}}>
          {zone.aisles.map(aisle => <div key={aisle.aisleCode} className="contents" role="group" aria-label={`Lối đi ${aisle.aisleCode}`}>
            {aisle.racks.map(rack => <Link key={rack._id} to={`/portal/warehouse-map/${facilityId}/racks/${rack._id}`} aria-label={`Xem kệ ${rack.rackCode}, lối đi ${aisle.aisleCode}`} data-rack-id={rack._id} className="flex min-h-52 w-48 flex-col gap-2 rounded-xl border border-green-200 bg-white p-4 text-sm shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F28C28]" style={{gridColumn:x.positions.get(rack.mapX),gridRow:y.positions.get(rack.mapY)}}>
              <span className="break-words font-bold text-[#176B3A]">{rack.rackCode}</span><span className="text-xs">Lối đi {aisle.aisleCode}</span><OperationalStatus status={rack.operationalStatus}/>
              <span className="flex items-center gap-2 text-xs"><span className="inline-flex h-9 w-9 items-center justify-center" aria-hidden="true"><span className="flex h-8 w-5 items-center justify-center rounded border-2 border-[#176B3A] bg-green-50" style={{transform:`rotate(${rack.orientation}deg)`}}><ArrowUp size={14}/></span></span>{rack.orientation}° · X {rack.mapX}, Y {rack.mapY}</span>
              {Number.isInteger(rack.availableCellCount) && <span>{rack.availableCellCount} ô đang khả dụng</span>}
              <span className="text-xs">Tải trọng thiết kế: {weightText(rack.utilization?.ratedCapacityKg)}</span><span className="text-xs">Tải trọng có thể phân bổ: {weightText(rack.utilization?.allocatableCapacityKg)}</span>
              {rack.utilization?.status && <span className="text-xs text-slate-500">Mức sử dụng tải trọng: {utilizationLabels[rack.utilization.status] || 'Chưa xác minh'}</span>}
            </Link>)}
          </div>)}
        </div>
      </div>
    </>}
  </CardContent></Card>;
}

export default function WarehouseMapPage() {
  const {facilityId} = useParams();
  const [bookingParams]=useSearchParams(),range=readBookingPeriod(bookingParams).range;
  const map = useBackend(config => validId(facilityId) ? warehouseMapApi.getWarehouseMap(facilityId,config,range).then(response=>validateWarehouseMap(record(response),facilityId)) : Promise.reject(Error('Mã cơ sở không hợp lệ.')), [facilityId,JSON.stringify(range)]);
  const rackCount = map.data?.zones.reduce((sum,zone)=>sum+zone.aisles.reduce((n,aisle)=>n+aisle.racks.length,0),0);
  return <DigitalWarehouseDashboard facilityId={facilityId} map={map}/>;
}

export function WarehouseRackDetailPage() {
  const {facilityId,rackId} = useParams();
  const detail = useBackend(config => validId(facilityId) && validId(rackId) ? warehouseMapApi.getRackDetailMap(rackId,config).then(response=>validateRackDetail(record(response),facilityId,rackId)) : Promise.reject(Error('Mã cơ sở hoặc mã kệ không hợp lệ.')), [facilityId,rackId]);
  const data = detail.data, rack = data?.rack, capacity = data?.capacity;
  return <CustomerScreen title={rack?.rackCode || 'Chi tiết kệ'} description="Thông tin tầng, ô lưu trữ và giới hạn tải trọng theo thiết kế." notice={baseline} action={<BackLink to={validId(facilityId)?`/portal/warehouse-map/${facilityId}`:'/portal/warehouse-map'}>Quay lại sơ đồ kho</BackLink>}>
    {validId(facilityId) && <FacilityContext facilityId={facilityId} rackCode={rack?.rackCode||'Chi tiết kệ'}/>}<MapState resource={detail}/>
    {data && <><Card><CardContent><h2 className="mb-4 text-xl font-bold">Thông tin kệ</h2><OperationalStatus status={rack.operationalStatus}/><div className="mt-5"><Details values={[
      ['Mã kệ',rack.rackCode],['Mã khu vực',rack.zoneCode],['Mã lối đi',rack.aisleCode],['Chiều rộng',measurementText(rack.dimensions?.widthM)],['Chiều sâu',measurementText(rack.dimensions?.depthM)],['Chiều cao danh nghĩa',measurementText(rack.dimensions?.heightM)],['Hướng đặt kệ',rack.orientation==null?'Chưa có dữ liệu':`${rack.orientation}°`],['Tải trọng thiết kế',weightText(capacity.ratedCapacityKg)],['Tải trọng có thể phân bổ',weightText(capacity.allocatableCapacityKg)],['Khối lượng đang sử dụng (số liệu MI-01)',weightText(capacity.usedWeightKg)],['Khối lượng còn lại (số liệu nền)',weightText(capacity.remainingWeightKg)],['Mức sử dụng tải trọng',utilizationLabels[capacity.utilizationStatus]||'Chưa xác minh'],['Nguồn số liệu',capacitySourceLabels[capacity.source]||'Chưa xác định'],
    ]}/></div><p className="mt-4 text-xs text-slate-500">Chiều cao danh nghĩa của kệ không thay thế số đo chiều cao sử dụng thực tế của từng ô.</p></CardContent></Card>
    <h2 className="text-xl font-bold">Các tầng và ô lưu trữ</h2>{!data.levels.length && <p>Chưa có sơ đồ tầng hoặc ô cho kệ này.</p>}
    {[...data.levels].sort((a,b)=>b.levelNumber-a.levelNumber).map(level=><Card key={level.levelNumber}><CardContent><h3 className="text-lg font-bold">Tầng {level.levelNumber}</h3><p className="mt-2 text-sm">Tải trọng thiết kế: {weightText(level.ratedCapacityKg)} · Có thể phân bổ: {weightText(level.allocatableCapacityKg)}</p>
      {!level.cells.length ? <p className="mt-4 text-sm">Tầng này chưa có ô lưu trữ.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[...level.cells].sort((a,b)=>a.cellNumber-b.cellNumber).map(cell=><div key={cell._id} data-cell-number={cell.cellNumber} className={`min-w-0 rounded-xl border p-4 ${cell.operationalStatus==='BLOCKED'?'border-red-200 bg-red-50':cell.operationalStatus==='MAINTENANCE'?'border-orange-200 bg-orange-50':'border-green-200 bg-[#F3F8F4]'}`}>
        <h4 className="break-words font-bold">{cell.code || `Ô ${cell.cellNumber}`}</h4><p className="my-2 text-sm">Tải trọng tối đa: {weightText(cell.maxWeightKg)}</p><OperationalStatus status={cell.operationalStatus}/>
        {(cell.isMine === true || cell.hasMyInventory === true) && ['LEDGER_MATCHED', 'PROJECTION_MISMATCH'].includes(cell.myStock?.status) && <p className="mt-2 text-xs text-slate-600">Hàng của bạn: {cell.myStock.quantity} món · {weightText(cell.myStock.weightKg)} theo sổ tồn</p>}
        {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === 'PROJECTION_MISMATCH' && <p className="mt-1 text-xs text-amber-700">Sổ tồn đã đọc; cơ sở cần kiểm tra bảng tổng hợp.</p>}
        {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === 'UNKNOWN' && <p className="mt-2 text-xs text-amber-700">Tồn kho của bạn đang cần cơ sở đối soát.</p>}
        {cell.dimensions && <p className="mt-3 text-xs">Chiều rộng: {measurementText(cell.dimensions.widthM)} · Chiều sâu: {measurementText(cell.dimensions.depthM)}{cell.dimensions.usableHeightM!=null && ` · Chiều cao sử dụng: ${measurementText(cell.dimensions.usableHeightM)}`}</p>}
        {cell.utilizationStatus && <p className="mt-3 text-xs">Mức sử dụng tải trọng: {utilizationLabels[cell.utilizationStatus]||'Chưa xác minh'}</p>}{cell.usedWeightKg!=null && <p className="mt-1 text-xs">Khối lượng đang sử dụng (số liệu MI-01): {weightText(cell.usedWeightKg)}</p>}
      </div>)}</div>}
    </CardContent></Card>)}
    </>}
  </CustomerScreen>;
}

// Direct Rack URLs retain their path and open the same interactive map context.
export function InteractiveWarehouseRackDetailPage(){
 const {facilityId,rackId}=useParams();
 const [bookingParams]=useSearchParams(),range=readBookingPeriod(bookingParams).range;
 const map=useBackend(config=>validId(facilityId)&&validId(rackId)?warehouseMapApi.getWarehouseMap(facilityId,config,range).then(response=>validateWarehouseMap(record(response),facilityId)):Promise.reject(Error('Mã cơ sở hoặc mã kệ không hợp lệ.')),[facilityId,rackId,JSON.stringify(range)]);
 return <DigitalWarehouseDashboard facilityId={facilityId} initialRackId={rackId} map={map}/>;
}
