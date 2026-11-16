const {test}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
mongoose.set('bufferCommands',false);
const Category=require('../dist/models/inventory-items/managed-inventory-category.model').default;
const QuantityUnit=require('../dist/models/inventory-items/managed-inventory-quantity-unit.model').default;
const {ManagedInventoryCatalogService}=require('../dist/services/inventory-items/managed-inventory-catalog.service');
const creator=new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');

for(const [label,Model] of [['category',Category],['quantity unit',QuantityUnit]]){
 test(`${label} catalog requires stable unique code and system-managed audit fields`,async()=>{
  const row=new Model({code:'TEST',name:'Test',sortOrder:0,isActive:true,createdBy:creator,updatedBy:creator});
  await assert.doesNotReject(row.validate());
  assert.equal(Model.schema.indexes().some(([keys,options])=>keys.code===1&&options.unique===true),true);
  assert.equal(Model.schema.path('createdBy').options.immutable,true);
 });
}

test('Customer cannot manage global Category or Quantity Unit catalogs',async()=>{
 const actor={_id:creator,role:'CUSTOMER'};
 await assert.rejects(ManagedInventoryCatalogService.create('category',{code:'X',name:'X'},actor),error=>error.status===403&&error.code==='CATALOG_FORBIDDEN');
 await assert.rejects(ManagedInventoryCatalogService.update('quantityUnit','507f1f77bcf86cd799439061',{name:'X'},actor),error=>error.status===403&&error.code==='CATALOG_FORBIDDEN');
});

test('Admin and BOM can create catalog rows with normalized codes through the service contract',async()=>{
 const original=Category.create;
 Category.create=async fields=>({_id:new mongoose.Types.ObjectId(),...fields,createdAt:new Date(),updatedAt:new Date()});
 try{
  for(const role of ['ADMIN','BOM']){
   const result=await ManagedInventoryCatalogService.create('category',{code:'office-box',name:'Thùng hồ sơ'}, {_id:creator,role});
   assert.equal(result.code,'OFFICE-BOX');assert.equal(result.isActive,true);assert.equal(result.categoryId.toString?.()||String(result.categoryId),result.id.toString?.()||String(result.id));
  }
 }finally{Category.create=original;}
});

test('Catalog deactivation is a soft-delete update, not a document delete',async()=>{
 const original=Category.findOneAndUpdate;let observed;
 Category.findOneAndUpdate=(filter,update)=>({exec:async()=>{observed={filter,update};return {_id:creator,code:'KEEP',name:'Retained',isActive:false,deletedAt:update.$set.deletedAt,createdBy:creator,updatedBy:creator};}});
 try{
  const result=await ManagedInventoryCatalogService.remove('category',creator.toString(),{_id:creator,role:'ADMIN'});
  assert.equal(result.isActive,false);assert.equal(observed.filter._id.toString(),creator.toString());assert.equal(observed.update.$set.isActive,false);assert.ok(observed.update.$set.deletedAt instanceof Date);assert.equal(typeof Category.deleteOne,'function');
 }finally{Category.findOneAndUpdate=original;}
});
