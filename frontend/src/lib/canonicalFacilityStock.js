import {objectId,recordId} from './facilityReview.js';
const number=value=>Number.isFinite(value)&&value>=0;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const quantities=row=>['quantityOnHand','quantityHeld','quantityAvailable'].every(key=>count(row[key]))&&row.quantityHeld<=row.quantityOnHand&&row.quantityAvailable===row.quantityOnHand-row.quantityHeld;
export function canonicalFacilityStock(stock,item,facilityId){
 if(recordId(stock?.skuId)!==recordId(item)||recordId(stock?.facilityId)!==facilityId||!['NOT_REQUIRED','REPLAYED','UNKNOWN','MISMATCH'].includes(stock.ledgerStatus)||!Array.isArray(stock.byCell)||!Array.isArray(stock.itemSpecifications)||!Array.isArray(stock.byReservation))throw Error('Tồn hàng không khớp mặt hàng hoặc cơ sở.');
 const verified=['NOT_REQUIRED','REPLAYED'].includes(stock.ledgerStatus);
 if(verified&&(!count(stock.totalQuantity)||!['totalWeightKg','totalVolumeM3'].every(key=>number(stock[key]))))throw Error('Số liệu tồn đã xác minh không hợp lệ.');
 for(const row of stock.byCell)if(!objectId(recordId(row.cellId))||!quantities(row)||!['weightKg','volumeM3'].every(key=>number(row[key])))throw Error('Số liệu ô lưu trữ không hợp lệ.');
 for(const row of stock.itemSpecifications)if(!objectId(recordId(row.itemSpecId))||verified&&!quantities(row))throw Error('Số liệu quy cách hàng hóa không hợp lệ.');
 for(const row of stock.byReservation)if(!objectId(recordId(row.reservationId))||verified&&!count(row.quantityOnHand))throw Error('Số liệu theo đơn thuê không hợp lệ.');
 return {...stock,stockVerified:verified};
}
export function movementEffect(row){return row.schemaVersion===4?row.stockEffect:row.v3Effect;}
