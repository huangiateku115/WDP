import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as registration from '../src/lib/inventoryRegistration.js';
import {itemSpecificationPayload} from '../src/lib/itemSpecificationForm.js';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';

const id='507f1f77bcf86cd799439011';
test('SKU registration payload contains no stock quantity or physical measurements',()=>{
 const payload=registration.inventoryFormPayload({reservationId:id,itemCode:'sku-1',name:'Cartons',categoryId:id,description:'',images:''});
 assert.deepEqual(payload,{managedReservationId:id,itemCode:'SKU-1',name:'Cartons',categoryId:id,description:'',images:[]});
});
test('SKU payload rejects free-text Category and does not send client ownership or stock fields',()=>{
 assert.throws(()=>registration.inventoryFormPayload({reservationId:id,itemCode:'sku-1',name:'Cartons',category:'DOCUMENTS',description:'',images:''}),/danh mục/i);
 const payload=registration.inventoryFormPayload({reservationId:id,itemCode:'sku-1',name:'Cartons',categoryId:id,customerId:id,facilityId:id,quantity:7,unitWeightKg:4,preferredCellId:id,description:'',images:''});
 for(const field of ['reservationId','customerId','facilityId','quantity','unitWeightKg','preferredCellId'])assert.equal(Object.hasOwn(payload,field),false);
});
test('SKU update omits an unchanged legacy Category reference',()=>{
 const payload=registration.inventoryFormPayload({name:'Cartons',categoryId:id,originalCategoryId:id,description:'',images:''},true);
 assert.equal(Object.hasOwn(payload,'categoryId'),false);
});
test('SKU response adapter accepts identity DTO without currentCell or quantity',()=>{
 const row={_id:id,skuId:id,inventorySchemaVersion:3,facilityId:id,reservationId:id,categoryId:id,itemCode:'SKU-1',name:'Cartons',category:'Documents',images:[],status:'ACTIVE'};
 assert.equal(registration.inventoryRecord({data:{success:true,data:row}}),row);
});
test('Item Specification converts cm to meters and derives six-decimal cubic meters',()=>{
 const value=itemSpecificationPayload({code:'A',name:'Small',quantityUnitId:id,unitWeightKg:'5',widthCm:'40',depthCm:'30',heightCm:'30'});
 assert.deepEqual(value.dimensionsM,{widthM:.4,depthM:.3,heightM:.3});assert.equal(Math.round(value.dimensionsM.widthM*value.dimensionsM.depthM*value.dimensionsM.heightM*1_000_000)/1_000_000,.036);
});
test('Item Specification rejects invalid dimensions or mass',()=>{
 assert.throws(()=>itemSpecificationPayload({unitWeightKg:'NaN',widthCm:'40',depthCm:'30',heightCm:'30'}));
 assert.throws(()=>itemSpecificationPayload({unitWeightKg:'5',widthCm:'0',depthCm:'30',heightCm:'30'}));
});
test('Three Item Specifications keep independent measurements under the same SKU',()=>{
 const forms=[
  {code:'A',name:'Small',quantityUnitId:id,unitWeightKg:'5',widthCm:'40',depthCm:'30',heightCm:'30'},
  {code:'B',name:'Medium',quantityUnitId:id,unitWeightKg:'8',widthCm:'60',depthCm:'40',heightCm:'30'},
  {code:'C',name:'Large',quantityUnitId:'607f1f77bcf86cd799439011',unitWeightKg:'15',widthCm:'80',depthCm:'50',heightCm:'40'},
 ];
 const payloads=forms.map(itemSpecificationPayload);
 assert.deepEqual(payloads.map(row=>row.dimensionsM),[
  {widthM:.4,depthM:.3,heightM:.3},{widthM:.6,depthM:.4,heightM:.3},{widthM:.8,depthM:.5,heightM:.4},
 ]);
 assert.deepEqual(payloads.map(row=>row.unitWeightKg),[5,8,15]);
 assert.deepEqual(payloads.map(row=>row.code),['A','B','C']);
});
test('Customer SKU forms use Backend catalogs and do not expose free-text Category or Unit inputs',()=>{
 const api=readFileSync(new URL('../src/api/inventoryApi.js',import.meta.url),'utf8');
 const skuForm=readFileSync(new URL('../src/components/customer/inventory/InventoryItemForm.jsx',import.meta.url),'utf8');
 const specs=readFileSync(new URL('../src/components/customer/inventory/ItemSpecifications.jsx',import.meta.url),'utf8');
 assert.match(api,/managed-inventory-catalog\/categories\/active/);assert.match(api,/managed-inventory-catalog\/quantity-units\/active/);
 assert.match(skuForm,/select id="sku-category"/);assert.doesNotMatch(skuForm,/value=\{form\.category\}/);
 assert.match(specs,/quantityUnitId/);assert.match(specs,/Chưa có đơn vị tính/);
});
test('confirmed API allowlist contains only catalog and SKU specification methods and paths',()=>{
 for(const [method,url] of [['GET','/managed-inventory-catalog/categories/active'],['GET','/managed-inventory-catalog/quantity-units/active'],['GET','/managed-inventory-catalog/categories'],['POST','/managed-inventory-catalog/categories'],['PATCH',`/managed-inventory-catalog/quantity-units/${id}`],['DELETE',`/managed-inventory-catalog/categories/${id}`],['GET',`/inventory-items/${id}/specifications`],['POST',`/inventory-items/${id}/specifications`],['PATCH',`/inventory-items/${id}/specifications/${id}`],['DELETE',`/inventory-items/${id}/specifications/${id}`]])assert.doesNotThrow(()=>assertConfirmedRequest({method,url}));
 for(const [method,url] of [['POST',`/managed-inventory-catalog/categories/${id}`],['PUT',`/managed-inventory-catalog/categories/${id}`],['POST',`/inventory-items/${id}/specifications/${id}/delete`]])assert.throws(()=>assertConfirmedRequest({method,url}));
});
