import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalFacilityStock,movementEffect} from '../src/lib/canonicalFacilityStock.js';
import {loadFacilityInventory,visibleInventoryMovements} from '../src/lib/facilityInventoryDetail.js';
import {managedOverview} from '../src/lib/managedInventoryMonitor.js';
const id=n=>String(n).padStart(24,'0'),item={_id:id(1),facilityId:id(2),managedReservationId:id(3),customerId:id(4),inventorySchemaVersion:3};
const stock={skuId:id(1),facilityId:id(2),reservationId:id(3),ledgerStatus:'REPLAYED',totalQuantity:3,totalWeightKg:6,totalVolumeM3:1,byCell:[{cellId:id(5),quantityOnHand:3,quantityHeld:1,quantityAvailable:2,weightKg:6,volumeM3:1}],itemSpecifications:[],byReservation:[]};
test('canonical stock preserves verified totals and rejects foreign or impossible cell quantities',()=>{
 assert.equal(canonicalFacilityStock(stock,item,id(2)).totalQuantity,3);
 assert.throws(()=>canonicalFacilityStock({...stock,facilityId:id(9)},item,id(2)));
 assert.throws(()=>canonicalFacilityStock({...stock,byCell:[{...stock.byCell[0],quantityAvailable:3}]},item,id(2)));
 const unknown=canonicalFacilityStock({...stock,ledgerStatus:'UNKNOWN',totalQuantity:null,totalWeightKg:null,totalVolumeM3:null,byCell:[]},item,id(2));
 assert.equal(unknown.stockVerified,false);assert.equal(unknown.totalQuantity,null);
});
test('facility detail reads canonical stock and V4 history without legacy fallback',async()=>{
 const movement={_id:id(6),itemId:id(1),facilityId:id(2),managedReservationId:id(3),schemaVersion:4,quantity:1,performedAt:new Date().toISOString(),stockEffect:{action:'REMOVE',accessSessionId:id(7)}};
 const response=data=>({data:{success:true,data}});
 const data=await loadFacilityInventory({itemId:id(1),user:{role:'FACILITY_MANAGER',assignedFacilityId:id(2)},inventoryApi:{get:async()=>response(item)},v3Api:{stock:async()=>response(stock),movements:async()=>response([movement])},accessApi:{}});
 assert.equal(data.canonical,true);assert.equal(movementEffect(data.movements[0]).action,'REMOVE');
 assert.deepEqual(visibleInventoryMovements({...data,sessions:[]},{role:'FACILITY_STAFF'}),[]);
});
test('current overview is not treated as reconciled Cell Stock; V4 scope is checked',()=>{
 const movement={_id:id(6),itemId:id(1),facilityId:id(2),schemaVersion:4,stockEffect:{action:'REMOVE'}};
 const response=data=>({data:{success:true,data}});
 const overview={facilityId:id(2),readOnly:true,rows:[{item,projection:{onHandQuantity:999},reconciliationStatus:'RECONCILED',recentMovements:[movement]}]};
 const result=managedOverview(response(overview),id(2));
 assert.equal(result.rows[0].projection,null);assert.equal(result.rows[0].reconciliationStatus,'UNKNOWN');
 assert.throws(()=>managedOverview(response({...overview,rows:[{...overview.rows[0],recentMovements:[{...movement,facilityId:id(9)}]}]}),id(2)));
});
test('canonical detail merges recent V4 history from existing overview without duplicate movements',async()=>{
 const movement={_id:id(6),itemId:id(1),facilityId:id(2),managedReservationId:id(3),schemaVersion:4,quantity:1,performedAt:new Date().toISOString(),stockEffect:{action:'REMOVE',accessSessionId:id(7)}};
 const response=data=>({data:{success:true,data}});
 const data=await loadFacilityInventory({itemId:id(1),user:{role:'FACILITY_MANAGER',assignedFacilityId:id(2)},inventoryApi:{get:async()=>response(item)},v3Api:{stock:async()=>response(stock),movements:async()=>response([movement]),facilityOverview:async()=>response({facilityId:id(2),readOnly:true,rows:[{item,reconciliationStatus:'UNKNOWN',recentMovements:[movement]}]})},accessApi:{}});
 assert.equal(data.movements.length,1);assert.equal(data.movements[0].schemaVersion,4);
});
