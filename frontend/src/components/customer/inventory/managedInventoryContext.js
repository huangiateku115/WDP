import reservationApi from '@/api/reservationApi';
import warehouseMapApi from '@/api/warehouseMapApi';
import {inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {validateWarehouseMap,validateRackDetail} from '@/lib/warehouseMap';
import {record} from '../RentalBackendUI';
export {inventoryLifecycleContext} from './customerInventoryPolicy';

const cellLocationCache=new Map();
const cellLocationInFlight=new Map();
const CELL_LOCATION_CACHE_TTL=60_000;

export async function managedInventoryReservation(id,config){
  const rental=record(await reservationApi.detailForCustomer(id,config));
  if(inventoryId(rental)!==id||rental.serviceType!=='MANAGED_INVENTORY')throw Error('Managed Reservation could not be verified.');
  return rental;
}

// Read the existing Customer map APIs. A reservation is not evidence of current Cell availability.
export async function verifiedPreferredCells(rental,config){
  if(rental?.bookingFlowVersion!==3||rental?.serviceType!=='MANAGED_INVENTORY')throw Error('Cell preference requires a verified Managed V3 reservation.');
  const ids=rental.allocatedCellIds?.map(inventoryId);
  if(!Array.isArray(ids)||!ids.length||!ids.every(validInventoryId)||new Set(ids).size!==ids.length)throw Error('Allocated Cell data is unavailable. Refresh the reservation before choosing a preference.');
  const facilityId=inventoryId(rental.facilityId);
  const map=validateWarehouseMap(record(await warehouseMapApi.getWarehouseMap(facilityId,config)),facilityId);
  const found=[];
  // Sequential reads avoid flooding the API for larger facilities; abort propagates normally.
  for(const zone of map.zones)for(const aisle of zone.aisles)for(const rack of aisle.racks){
    if(rack.operationalStatus!=='AVAILABLE')continue;
    const detail=validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rack._id,config)),facilityId,rack._id);
    if(detail.rack.operationalStatus!=='AVAILABLE'||inventoryId(detail.rack.zoneId)!==inventoryId(zone))continue;
    for(const level of detail.levels)for(const cell of level.cells){
      if(ids.includes(inventoryId(cell))&&cell.operationalStatus==='AVAILABLE')found.push({id:inventoryId(cell),label:`${zone.code} / ${rack.rackCode} / ${cell.code||cell._id}`});
    }
  }
  if(new Set(found.map(c=>c.id)).size!==found.length)throw Error('Ambiguous allocated Cell response.');
  return found;
}

// Resolve backend Cell identifiers to their customer-facing topology labels for display only.
export async function inventoryCellLocationDetails(customerId,rental,cellIds=[],config){
  const facilityId=inventoryId(rental?.facilityId),ids=[...new Set(cellIds.map(inventoryId).filter(validInventoryId))].sort();
  if(!validInventoryId(customerId)||!validInventoryId(facilityId)||!ids.length)return {};
  const key=`${customerId}:${facilityId}`,cached=cellLocationCache.get(key),fresh=cached&&Date.now()-cached.at<CELL_LOCATION_CACHE_TTL?cached.value:{};
  if(ids.every(id=>fresh[id]))return Object.fromEntries(ids.map(id=>[id,fresh[id]]));
  const pending=cellLocationInFlight.get(key);
  if(pending){await pending;const after=cellLocationCache.get(key)?.value||{};if(ids.every(id=>after[id]))return Object.fromEntries(ids.map(id=>[id,after[id]]));}
  const request=(async()=>{
    const map=validateWarehouseMap(record(await warehouseMapApi.getWarehouseMap(facilityId,config)),facilityId),locations={...fresh};
    search: for(const zone of map.zones)for(const aisle of zone.aisles)for(const rack of aisle.racks){
      const detail=validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rack._id,config)),facilityId,rack._id);
      for(const level of detail.levels)for(const cell of level.cells)if(ids.includes(inventoryId(cell))&&!locations[inventoryId(cell)])locations[inventoryId(cell)]={zoneCode:zone.code,aisleCode:rack.aisleCode||aisle.aisleCode,rackCode:rack.rackCode,levelNumber:level.levelNumber,cellNumber:cell.cellNumber,cellCode:cell.code};
      if(ids.every(id=>locations[id]))break search;
    }
    cellLocationCache.set(key,{at:Date.now(),value:locations});
    if(cellLocationCache.size>100)cellLocationCache.delete(cellLocationCache.keys().next().value);
    return locations;
  })();
  cellLocationInFlight.set(key,request);
  try{const locations=await request;return Object.fromEntries(ids.filter(id=>locations[id]).map(id=>[id,locations[id]]));}
  finally{if(cellLocationInFlight.get(key)===request)cellLocationInFlight.delete(key);}
}

export async function inventoryCellLabels(rental,extraIds=[],config,customerId){
  const ids=[...new Set([...(rental?.allocatedCellIds||[]).map(inventoryId),...extraIds.map(inventoryId)].filter(validInventoryId))];
  const locations=await inventoryCellLocationDetails(customerId,rental,ids,config),labels={};
  for(const id of ids){const location=locations[id];if(location)labels[id]=`${location.zoneCode} · ${location.rackCode} · ${location.cellCode||`Ô ${location.cellNumber}`} · Tầng ${location.levelNumber}`;}
  return labels;
}
