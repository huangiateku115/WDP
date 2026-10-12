import {useParams} from 'react-router-dom';
import DigitalWarehouseDashboard from '@/components/customer/warehouse/DigitalWarehouseDashboard';
import {ArrowUp, ArrowLeft} from 'lucide-react';
import warehouseMapApi from '@/api/warehouseMapApi';
import facilityApi from '@/api/facilityApi';
import WarehouseBreadcrumbs from '@/components/customer/WarehouseBreadcrumbs';
import {Badge} from '@/components/ui/badge';
import {CustomerScreen,Card,CardContent,Button,Link,Details,LoadState,useBackend,record,validId} from '@/components/customer/RentalBackendUI';
import {validateWarehouseMap,validateRackDetail,warehouseAxis,weightText,measurementText} from '@/lib/warehouseMap';

const baseline = 'MI-01 structural map only. Weight usage is a technical baseline; actual inventory usage and physical occupancy are not tracked. Cells cannot be reserved here.';
function OperationalStatus({status}) {
  return <Badge variant={status==='AVAILABLE'?'green':'orange'} className={status==='BLOCKED'?'bg-red-50 text-red-800':!['AVAILABLE','MAINTENANCE'].includes(status)?'bg-slate-100 text-slate-700':''}>{status || 'Status not returned'}</Badge>;
}
function MapState({resource}) {
  return <LoadState resource={resource}/>;
}
function FacilityContext({facilityId,rackCode}) {
  const facility = useBackend(config => validId(facilityId) ? facilityApi.publicDetail(facilityId,config).then(record) : Promise.resolve(null), [facilityId], true);
  return <div className="min-w-0 text-sm"><WarehouseBreadcrumbs facilityId={facilityId} facilityName={facility.data?.name} rackCode={rackCode}/><p className="break-words font-semibold text-[#176B3A]">Facility: {facility.data?.name || facilityId}</p>{facility.loading && <p role="status">Loading facility context…</p>}{facility.error && <p className="mt-1 text-slate-500">Facility name unavailable. Map access is checked separately by the backend.</p>}</div>;
}
function BackLink({to,children}) {
  return <Button asChild variant="outline"><Link to={to}><ArrowLeft size={16}/>{children}</Link></Button>;
}
function ZoneMap({zone,facilityId}) {
  const racks = zone.aisles.flatMap(aisle => aisle.racks), x = warehouseAxis(racks.map(r=>r.mapX)), y = warehouseAxis(racks.map(r=>r.mapY));
  return <Card><CardContent className="min-w-0"><h2 className="break-words text-xl font-bold">{zone.code} {zone.name && `· ${zone.name}`}</h2>
    <div className="my-4 flex flex-wrap gap-3 text-sm">{zone.aisles.map(aisle => <h3 key={aisle.aisleCode} className="rounded-lg bg-[#EAF5EE] px-3 py-2 font-semibold text-[#176B3A]">Aisle {aisle.aisleCode} · {aisle.racks.length} racks</h3>)}</div>
    {!racks.length ? <p>No racks are available in this zone yet.</p> : <>
      <p className="mb-3 text-xs text-slate-500">X increases to the right; Y increases downward. Coordinates are grid positions, not meters. Rack symbols show orientation; labels stay upright.</p>
      {(x.condensed || y.condensed) && <p className="mb-3 text-xs text-orange-800">Large empty coordinate gaps are condensed. Each rack displays its exact X/Y coordinates.</p>}
      <div tabIndex={0} role="region" aria-label={`Warehouse grid ${zone.code}`} className="max-w-full overflow-auto rounded-xl border border-green-100 bg-[#F3F8F4] p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#176B3A]">
        <div className="grid w-max gap-3" style={{gridTemplateColumns:`repeat(${x.count}, 12rem)`,gridTemplateRows:`repeat(${y.count}, minmax(18rem, auto))`}}>
          {zone.aisles.map(aisle => <div key={aisle.aisleCode} className="contents" role="group" aria-label={`Aisle ${aisle.aisleCode}`}>
            {aisle.racks.map(rack => <Link key={rack._id} to={`/portal/warehouse-map/${facilityId}/racks/${rack._id}`} aria-label={`View rack ${rack.rackCode}, aisle ${aisle.aisleCode}`} data-rack-id={rack._id} className="flex min-h-52 w-48 flex-col gap-2 rounded-xl border border-green-200 bg-white p-4 text-sm shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F28C28]" style={{gridColumn:x.positions.get(rack.mapX),gridRow:y.positions.get(rack.mapY)}}>
              <span className="break-words font-bold text-[#176B3A]">{rack.rackCode}</span><span className="text-xs">Aisle {aisle.aisleCode}</span><OperationalStatus status={rack.operationalStatus}/>
              <span className="flex items-center gap-2 text-xs"><span className="inline-flex h-9 w-9 items-center justify-center" aria-hidden="true"><span className="flex h-8 w-5 items-center justify-center rounded border-2 border-[#176B3A] bg-green-50" style={{transform:`rotate(${rack.orientation}deg)`}}><ArrowUp size={14}/></span></span>{rack.orientation}° · X {rack.mapX}, Y {rack.mapY}</span>
              {Number.isInteger(rack.availableCellCount) && <span>{rack.availableCellCount} operationally available cells</span>}
              <span className="text-xs">Rated: {weightText(rack.utilization?.ratedCapacityKg)}</span><span className="text-xs">Allocatable: {weightText(rack.utilization?.allocatableCapacityKg)}</span>
              {rack.utilization?.status && <span className="text-xs text-slate-500">Utilization baseline: {rack.utilization.status}</span>}
            </Link>)}
          </div>)}
        </div>
      </div>
    </>}
  </CardContent></Card>;
}

export default function WarehouseMapPage() {
  const {facilityId} = useParams();
  const map = useBackend(config => validId(facilityId) ? warehouseMapApi.getWarehouseMap(facilityId,config).then(response=>validateWarehouseMap(record(response),facilityId)) : Promise.reject(Error('Invalid facility ID.')), [facilityId]);
  const rackCount = map.data?.zones.reduce((sum,zone)=>sum+zone.aisles.reduce((n,aisle)=>n+aisle.racks.length,0),0);
  return <DigitalWarehouseDashboard facilityId={facilityId} map={map}/>;
}

export function WarehouseRackDetailPage() {
  const {facilityId,rackId} = useParams();
  const detail = useBackend(config => validId(facilityId) && validId(rackId) ? warehouseMapApi.getRackDetailMap(rackId,config).then(response=>validateRackDetail(record(response),facilityId,rackId)) : Promise.reject(Error('Invalid facility or rack ID.')), [facilityId,rackId]);
  const data = detail.data, rack = data?.rack, capacity = data?.capacity;
  return <CustomerScreen title={rack?.rackCode || 'Rack Detail'} description="Levels, cells and structural weight limits." notice={baseline} action={<BackLink to={validId(facilityId)?`/portal/warehouse-map/${facilityId}`:'/portal/warehouse-map'}>Back to Warehouse Map</BackLink>}>
    {validId(facilityId) && <FacilityContext facilityId={facilityId} rackCode={rack?.rackCode||'Rack Detail'}/>}<MapState resource={detail}/>
    {data && <><Card><CardContent><h2 className="mb-4 text-xl font-bold">Rack information</h2><OperationalStatus status={rack.operationalStatus}/><div className="mt-5"><Details values={[
      ['Rack code',rack.rackCode],['Zone code',rack.zoneCode],['Aisle code',rack.aisleCode],['Width',measurementText(rack.dimensions?.widthM)],['Depth',measurementText(rack.dimensions?.depthM)],['Nominal rack height',measurementText(rack.dimensions?.heightM)],['Orientation',rack.orientation==null?'Not returned':`${rack.orientation}°`],['Rated capacity',weightText(capacity.ratedCapacityKg)],['Allocatable capacity',weightText(capacity.allocatableCapacityKg)],['Used weight (MI-01 baseline)',weightText(capacity.usedWeightKg)],['Remaining weight (baseline)',weightText(capacity.remainingWeightKg)],['Utilization baseline',capacity.utilizationStatus],['Usage source',capacity.source],
    ]}/></div><p className="mt-4 text-xs text-slate-500">Nominal rack height does not establish measured usable cell clearance.</p></CardContent></Card>
    <h2 className="text-xl font-bold">Levels and Cells</h2>{!data.levels.length && <p>No level or cell layout is available for this rack yet.</p>}
    {[...data.levels].sort((a,b)=>b.levelNumber-a.levelNumber).map(level=><Card key={level.levelNumber}><CardContent><h3 className="text-lg font-bold">Level {level.levelNumber}</h3><p className="mt-2 text-sm">Rated: {weightText(level.ratedCapacityKg)} · Allocatable: {weightText(level.allocatableCapacityKg)}</p>
      {!level.cells.length ? <p className="mt-4 text-sm">No cells returned for this level.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[...level.cells].sort((a,b)=>a.cellNumber-b.cellNumber).map(cell=><div key={cell._id} data-cell-number={cell.cellNumber} className={`min-w-0 rounded-xl border p-4 ${cell.operationalStatus==='BLOCKED'?'border-red-200 bg-red-50':cell.operationalStatus==='MAINTENANCE'?'border-orange-200 bg-orange-50':'border-green-200 bg-[#F3F8F4]'}`}>
        <h4 className="break-words font-bold">{cell.code || `Cell C${cell.cellNumber}`}</h4><p className="my-2 text-sm">Maximum weight: {weightText(cell.maxWeightKg)}</p><OperationalStatus status={cell.operationalStatus}/>
        {cell.dimensions && <p className="mt-3 text-xs">Width: {measurementText(cell.dimensions.widthM)} · Depth: {measurementText(cell.dimensions.depthM)}{cell.dimensions.usableHeightM!=null && ` · Usable clearance: ${measurementText(cell.dimensions.usableHeightM)}`}</p>}
        {cell.utilizationStatus && <p className="mt-3 text-xs">Utilization baseline: {cell.utilizationStatus}</p>}{cell.usedWeightKg!=null && <p className="mt-1 text-xs">Used weight (MI-01 baseline): {weightText(cell.usedWeightKg)}</p>}
      </div>)}</div>}
    </CardContent></Card>)}
    </>}
  </CustomerScreen>;
}

// Direct Rack URLs retain their path and open the same interactive map context.
export function InteractiveWarehouseRackDetailPage(){
 const {facilityId,rackId}=useParams();
 const map=useBackend(config=>validId(facilityId)&&validId(rackId)?warehouseMapApi.getWarehouseMap(facilityId,config).then(response=>validateWarehouseMap(record(response),facilityId)):Promise.reject(Error('Invalid facility or rack ID.')),[facilityId,rackId]);
 return <DigitalWarehouseDashboard facilityId={facilityId} initialRackId={rackId} map={map}/>;
}
