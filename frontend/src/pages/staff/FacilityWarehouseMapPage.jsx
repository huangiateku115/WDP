import {facilityLabel} from '@/lib/facilityLabels';
import { useState } from 'react';
import warehouseMapApi from '@/api/warehouseMapApi';
import { useAuthSession } from '@/lib/authSession';
import { inventoryId, validInventoryId } from '@/lib/inventoryRegistration';
import { validateWarehouseMap, validateRackDetail, warehouseAxis, weightText } from '@/lib/warehouseMap';
import { useBackend, record, LoadState } from '@/components/customer/RentalBackendUI';
import { Screen, Panel, Select, Button, Details, OpenLink } from '@/components/manager/ManagerUI';

const volume = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value} m³` : "Chưa xác định";

export default function FacilityWarehouseMapPage() {
  const { user } = useAuthSession();
  const facilityId = inventoryId(user?.assignedFacilityId);
  const [zoneId, setZoneId] = useState('');
  const [rackId, setRackId] = useState('');
  const map = useBackend(async config => {
    if (!['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(user?.role) || !validInventoryId(facilityId)) {
      throw Error("Cần tài khoản nhân viên hoặc quản lý đã được phân công cơ sở.");
    }
    return validateWarehouseMap(record(await warehouseMapApi.getWarehouseMap(facilityId, config)), facilityId);
  }, [facilityId, user?.role]);
  const zones = map.data?.zones || [];
  const allowedRack = zones.some(zone => (!zoneId || zone._id === zoneId) &&
    zone.aisles.some(aisle => aisle.racks.some(rack => rack._id === rackId)));
  const detail = useBackend(async config => {
    if (!allowedRack) return null;
    return validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rackId, config)), facilityId, rackId);
  }, [facilityId, rackId, allowedRack]);
  const rack = allowedRack && !map.loading && !map.error ? detail.data : null;

  return <Screen title="Bản đồ kho" notice="Trạng thái vận hành, quyền phân bổ và mức sử dụng thực tế được hiển thị riêng." action={
    <Button variant="outline" onClick={() => { map.retry(); detail.retry(); }}>Tải lại bản đồ kho</Button>
  }>
    {user?.role === 'FACILITY_MANAGER' && <OpenLink to="/manager/warehouse-settings">Cấu hình khu vực, kệ và ô lưu trữ</OpenLink>}
    <LoadState resource={map} />
    {map.data && <>
      <Panel title="Sơ đồ cơ sở được phân công">
        <Select label="Khu vực kho" value={zoneId} onChange={value => { setZoneId(value); setRackId(''); }} options={[
          ['', "Tất cả khu vực"], ...zones.map(zone => [zone._id, `${zone.code} · ${zone.name}`]),
        ]} />
        {!zones.length && <p className="mt-4">Cơ sở chưa có khu vực kho đang hoạt động.</p>}
        {zones.filter(zone => !zoneId || zone._id === zoneId).map(zone => <section key={zone._id} className="mt-5 space-y-3">
          <h3 className="font-semibold">{zone.code} · {zone.name}</h3>
          {!zone.aisles.length && <p>Khu vực này chưa có kệ.</p>}
          {zone.aisles.map(aisle => {
            const x = warehouseAxis(aisle.racks.map(row => row.mapX));
            const y = warehouseAxis(aisle.racks.map(row => row.mapY));
            return <div key={aisle.aisleCode}>
              <p className="mb-2 text-sm">Dãy {aisle.aisleCode}</p>
              <div className="overflow-x-auto"><div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${x.count}, minmax(150px, 1fr))` }}>
                {aisle.racks.map(row => <button key={row._id} aria-pressed={rackId === row._id}
                  className={`rounded-xl border p-4 text-left ${rackId === row._id ? 'border-emerald-700 bg-emerald-50' : 'bg-white'}`}
                  style={{ gridColumn: x.positions.get(row.mapX), gridRow: y.positions.get(row.mapY) }} onClick={() => setRackId(row._id)}>
                  <b>{row.rackCode}</b>
                  <p className="mt-2 text-xs">Vận hành {facilityLabel(row.operationalStatus)}</p>
                  <p className="text-xs">{row.cellCount} Ô lưu trữ · {row.occupiedCellCount} đã sử dụng · {row.reservedCellCount} đã giữ chỗ</p>
                  <p className="text-xs">Khối lượng thực tế {row.utilization?.physicalUsageKnown === true ? weightText(row.utilization.usedWeightKg) : "Chưa xác định"}</p>
                </button>)}
              </div></div>
              {(x.condensed || y.condensed) && <p className="text-xs">Các khoảng trống tọa độ lớn được thu gọn khi hiển thị.</p>}
            </div>;
          })}
        </section>)}
      </Panel>
      {allowedRack && <LoadState resource={detail} />}
      {rack && <Panel title={`${rack.rack.zoneCode} → ${rack.rack.rackCode}`}>
        <Details values={[
          ["Trạng thái vận hành", rack.rack.operationalStatus],
          ["Khối lượng thực tế", rack.capacity.physicalUsageKnown === true ? weightText(rack.capacity.usedWeightKg) : "Chưa xác định"],
          ["Thể tích thực tế", rack.capacity.physicalUsageKnown === true ? volume(rack.capacity.usedVolumeM3) : "Chưa xác định"],
          ["Tải trọng thiết kế", weightText(rack.capacity.ratedCapacityKg)],
        ]} />
        <div className="mt-5 space-y-4">{rack.levels.map(level => <section key={level.levelNumber}>
          <h3 className="mb-2 font-semibold">Tầng {level.levelNumber}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{level.cells.map(cell => <article key={cell._id} className="rounded-xl border p-3">
            <h4 className="font-semibold">{cell.code}</h4>
            <p className="break-all text-xs">{cell._id}</p>
            <p className="mt-2 text-sm">Vận hành {facilityLabel(cell.operationalStatus)}</p>
            <p className="text-sm">Phân bổ / sử dụng {cell.bookingStatus || 'Unknown'}</p>
            <p className="text-sm">Khối lượng thực tế {cell.physicalUsageKnown === true ? weightText(cell.usedWeightKg) : "Chưa xác định"}</p>
            <p className="text-sm">Thể tích thực tế {cell.physicalUsageKnown === true ? volume(cell.usedVolumeM3) : "Chưa xác định"}</p>
            <p className="text-sm">Còn lại {cell.physicalUsageKnown === true ? weightText(cell.remainingWeightKg) : "Chưa xác định"} / {cell.physicalUsageKnown === true ? volume(cell.remainingVolumeM3) : "Chưa xác định"}</p>
            <p className="text-xs">Khả dụng {cell.dimensions?.widthM ?? '—'} × {cell.dimensions?.depthM ?? '—'} × {cell.dimensions?.usableHeightM ?? '—'} m</p>
          </article>)}</div>
        </section>)}</div>
      </Panel>}
    </>}
  </Screen>;
}
