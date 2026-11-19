import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';

const require=createRequire(import.meta.url),customer='a'.repeat(24),facility='b'.repeat(24),zone='c'.repeat(24),rack='d'.repeat(24),cell='e'.repeat(24);
let mapCalls=0,rackCalls=0;
const id=value=>typeof value==='object'?value?._id||value?.id:value;
const valid=value=>/^[a-f\d]{24}$/i.test(value||'');
const warehouseMapApi={
 getWarehouseMap:async()=>{mapCalls++;return {data:{facilityId:facility,zones:[{_id:zone,code:'Z-1',aisles:[{aisleCode:'A-1',racks:[{_id:rack,mapX:0,mapY:0,orientation:0,rackCode:'R-1'}]}]}]}};},
 getRackDetailMap:async()=>{rackCalls++;return {data:{rack:{_id:rack,facilityId:facility,rackCode:'R-1'},capacity:{},levels:[{levelNumber:1,cells:[{_id:cell,cellNumber:1,code:'L1-C1'}]}]}};},
};
const mocks={
 '@/api/reservationApi':{default:{}},
 '@/api/warehouseMapApi':{default:warehouseMapApi},
 '@/lib/inventoryRegistration':{inventoryId:id,validInventoryId:valid},
 '@/lib/warehouseMap':{validateWarehouseMap:value=>value,validateRackDetail:value=>value},
 '../RentalBackendUI':{record:value=>value?.data??value},
 './customerInventoryPolicy':{inventoryLifecycleContext:()=>({})},
};
const source=readFileSync(new URL('../src/components/customer/inventory/managedInventoryContext.js',import.meta.url),'utf8');
const code=transformSync(source,{loader:'js',format:'cjs'}).code,module={exports:{}};
new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);

test('Customer and facility scoped Cell resolution deduplicates concurrent and repeated reads',async()=>{
 const {inventoryCellLocationDetails}=module.exports,rental={facilityId:facility};
 const [first,second]=await Promise.all([
  inventoryCellLocationDetails(customer,rental,[cell],{}),
  inventoryCellLocationDetails(customer,rental,[cell],{}),
 ]);
 assert.deepEqual(first[cell],{zoneCode:'Z-1',aisleCode:'A-1',rackCode:'R-1',levelNumber:1,cellNumber:1,cellCode:'L1-C1'});
 assert.deepEqual(second,first);
 assert.equal(mapCalls,1);
 assert.equal(rackCalls,1);
 await inventoryCellLocationDetails(customer,rental,[cell],{});
 assert.equal(mapCalls,1);
 assert.equal(rackCalls,1);
 await inventoryCellLocationDetails('f'.repeat(24),rental,[cell],{});
 assert.equal(mapCalls,2,'another Customer has a separate metadata cache');
});
