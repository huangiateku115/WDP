import {useBackend,record,validId} from '@/components/customer/RentalBackendUI';
import warehouseMapApi from '@/api/warehouseMapApi';
import {validateWarehouseMap} from '@/lib/warehouseMap';
import DigitalWarehouseDashboard from '@/components/customer/warehouse/DigitalWarehouseDashboard';
import reservationApi from '@/api/reservationApi';

const rows=response=>Array.isArray(response?.data?.data)?response.data.data:Array.isArray(response?.data)?response.data:[];
const idOf=value=>typeof value==='string'?value:value?._id||value?.id||'';

export default function ManagedWarehouseMap({facilityId,startDate,endDate,selectedCells,onToggleCell,refreshKey=0}) {
  const mine=useBackend(config=>facilityId?Promise.resolve([]):reservationApi.getMine(config).then(rows).then(items=>items.filter(item=>item.serviceType==='MANAGED_INVENTORY'&&!['CANCELLED','REJECTED'].includes(item.status))),[facilityId],true);
  const effectiveFacilityId=facilityId||idOf(mine.data?.[0]?.facilityId);
  const map=useBackend(async config=>{
    if(!validId(effectiveFacilityId))return null;
    const params=startDate&&endDate?{startDate,endDate}:{};
    return validateWarehouseMap(record(await warehouseMapApi.getWarehouseMap(effectiveFacilityId,{...config,params})),effectiveFacilityId);
  },[effectiveFacilityId,startDate,endDate,refreshKey]);
  const booking=startDate&&endDate?{
    startDate,endDate,refreshKey,
    selectedCellIds:Object.keys(selectedCells||{}),
    allocatedCapacityM3:Object.values(selectedCells||{}).reduce((sum,cell)=>sum+cell.volumeM3,0),
    onToggleCell,
  }:undefined;
  if(!effectiveFacilityId)return <p className="text-sm text-slate-500">Choose a Managed Facility to browse available warehouse cells, or create a Managed reservation to see its facility map here.</p>;
  if(!map.data&&!map.loading&&!map.error)return <p className="text-sm text-slate-500">Loading warehouse availability…</p>;
  return <DigitalWarehouseDashboard facilityId={effectiveFacilityId} map={map} booking={booking}/>;
}
