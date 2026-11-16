const {test}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
mongoose.set('bufferCommands',false);
const InventoryItem=require('../dist/models/inventory-items/inventory-item.model').default;
const ItemSpecification=require('../dist/models/inventory-items/item-specification.model').default;
const skuId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439031');
const owner=new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');
const reservationId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
const facilityId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const categoryId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439051');
const quantityUnitId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439061');

test('SKU schema accepts identity and reservation without a stock quantity or physical measurements',async()=>{
 const sku=new InventoryItem({facilityId,customerId:owner,reservationId,managedReservationId:reservationId,itemCode:'SKU-001',name:'Archive cartons',categoryId,images:[],createdBy:owner,inventorySchemaVersion:3});
 await assert.doesNotReject(sku.validate());
 assert.notEqual(InventoryItem.schema.path('quantity').isRequired,true);
 assert.notEqual(InventoryItem.schema.path('unitWeightKg').isRequired,true);
 assert.notEqual(InventoryItem.schema.path('unitDimensionsM').isRequired,true);
 assert.equal(InventoryItem.schema.path('categoryId').options.ref,'ManagedInventoryCategory');
 assert.equal(InventoryItem.schema.path('category').options.required.call({inventorySchemaVersion:3}),false);
});

test('multiple Item Specifications under one SKU keep distinct measurements and canonical volumes',async()=>{
 const specs=[
  {code:'A',name:'Small',quantityUnitId,unitWeightKg:5,dimensionsM:{widthM:.4,depthM:.3,heightM:.3},unitVolumeM3:.036},
  {code:'B',name:'Medium',quantityUnitId,unitWeightKg:8,dimensionsM:{widthM:.6,depthM:.4,heightM:.3},unitVolumeM3:.072},
  {code:'C',name:'Large',quantityUnitId,unitWeightKg:15,dimensionsM:{widthM:.8,depthM:.5,heightM:.4},unitVolumeM3:.16},
 ];
 for(const spec of specs){const row=new ItemSpecification({...spec,skuId,customerId:owner,reservationId,facilityId,images:[],createdBy:owner});await assert.doesNotReject(row.validate());}
 assert.equal(new Set(specs.map(s=>s.unitWeightKg)).size,3);
 assert.equal(ItemSpecification.schema.indexes().some(([keys,opts])=>keys.skuId===1&&keys.code===1&&opts.unique),true);
});

test('Item Specification rejects non-positive dimensions, non-finite weight and mismatched volume',async()=>{
 const base={skuId,customerId:owner,reservationId,facilityId,code:'BAD',name:'Bad',quantityUnitId,unitWeightKg:1,dimensionsM:{widthM:.2,depthM:.2,heightM:.2},unitVolumeM3:.008,images:[],createdBy:owner};
 for(const changes of [{dimensionsM:{widthM:0,depthM:.2,heightM:.2}},{unitWeightKg:Infinity},{unitVolumeM3:.009}]){
  const row=new ItemSpecification({...base,...changes});await assert.rejects(row.validate());
 }
});

test('SKU schema still exposes legacy location only as optional compatibility data',()=>{
 assert.notEqual(InventoryItem.schema.path('currentCellId').isRequired,true);
 assert.equal(InventoryItem.schema.path('currentCellId').options.default,null);
});
