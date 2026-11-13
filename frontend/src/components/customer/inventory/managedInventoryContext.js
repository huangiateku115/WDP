import reservationApi from '@/api/reservationApi';
import warehouseMapApi from '@/api/warehouseMapApi';
import {inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {validateWarehouseMap,validateRackDetail} from '@/lib/warehouseMap';
import {record} from '../RentalBackendUI';
export {inventoryLifecycleContext} from './customerInventoryPolicy';

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
export async function inventoryCellLabels(rental,extraIds=[],config){
  const ids=[...new Set([...(rental?.allocatedCellIds||[]).map(inventoryId),...extraIds.map(inventoryId)].filter(validInventoryId))];
  if(!ids.length||!validInventoryId(inventoryId(rental?.facilityId)))return {};
  const facilityId=inventoryId(rental.facilityId),map=validateWarehouseMap(record(await warehouseMapApi.getWarehouseMap(facilityId,config)),facilityId),labels={};
  for(const zone of map.zones)for(const aisle of zone.aisles)for(const rack of aisle.racks){
    const detail=validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rack._id,config)),facilityId,rack._id);
    for(const level of detail.levels)for(const cell of level.cells)if(ids.includes(inventoryId(cell)))labels[inventoryId(cell)]=`${zone.code} · ${rack.rackCode} · ${cell.code||`Ô ${cell.cellNumber}`} · Tầng ${level.levelNumber}`;
    if(ids.every(id=>labels[id]))return labels;
  }
  return labels;
}
