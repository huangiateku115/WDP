import {canonicalFacilityStock,movementEffect} from './canonicalFacilityStock.js';
import {apiRecord,objectId,recordId} from './facilityReview.js';
export function managedOverview(response,facilityId){
  const overview=apiRecord(response);
  if(overview.readOnly!==true||overview.facilityId!==facilityId||!Array.isArray(overview.rows))throw Error('Chưa xác minh được báo cáo hàng hóa của cơ sở.');
  const seen=new Set();
  for(const row of overview.rows){
    const item=row.item;
    if(!objectId(recordId(item))||recordId(item.facilityId)!==facilityId||!objectId(recordId(item.managedReservationId))||seen.has(recordId(item))||!Array.isArray(row.recentMovements)||!['RECONCILED','UNKNOWN','RECONCILIATION_REQUIRED'].includes(row.reconciliationStatus))throw Error('Dữ liệu giám sát hàng hóa không hợp lệ hoặc ngoài cơ sở.');
    seen.add(recordId(item));
    if(row.canonicalStock){
      row.canonicalStock=canonicalFacilityStock(row.canonicalStock,item,facilityId);
      for(const movement of row.recentMovements)if(![3,4].includes(movement.schemaVersion)||recordId(movement.itemId)!==recordId(item)||recordId(movement.facilityId)!==facilityId||!['ADD','REMOVE','MOVE'].includes(movementEffect(movement)?.action))throw Error('Lịch sử không khớp mặt hàng hoặc cơ sở.');
      continue;
    }
    for(const movement of row.recentMovements)if(![3,4].includes(movement.schemaVersion)||recordId(movement.itemId)!==recordId(item)||recordId(movement.facilityId)!==facilityId||movement.schemaVersion===4&&!['ADD','REMOVE','MOVE'].includes(movementEffect(movement)?.action))throw Error('Lịch sử nhập hàng không khớp mặt hàng hoặc cơ sở.');
    if(row.reconciliationStatus==='RECONCILED'&&!row.recentMovements.some(movement=>movement.schemaVersion===4)){
      const projection=row.projection;
      if(!projection||recordId(projection.skuId)!==recordId(item)||recordId(projection.facilityId)!==facilityId||!Number.isSafeInteger(projection.onHandQuantity)||projection.onHandQuantity<0||!['totalWeightKg','totalVolumeM3'].every(key=>Number.isFinite(projection[key])&&projection[key]>=0))throw Error('Chưa xác minh được tồn đã đối soát.');
    }
    // The overview still uses the old projection. Read current Cell Stock from item detail.
    row.projection=null;row.reconciliationStatus='UNKNOWN';
  }
  return overview;
}
