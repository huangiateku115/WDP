const {test}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const Upload=require('../dist/models/inventory-items/receiving-inspection-upload.model').default;
const Evidence=require('../dist/models/inventory-items/receiving-inspection-evidence.model').default;
const Item=require('../dist/models/inventory-items/inventory-item.model').default;
const Reservation=require('../dist/models/reservations/reservation.model').default;
const {ManagedReceivingEvidenceService:service}=require('../dist/services/upload/managed-receiving-evidence.service');
const {CloudinaryService}=require('../dist/services/upload/cloudinary.service');
const sharp=require('sharp');
const itemId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439015');
const facilityId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const staffId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
const snapshotId=new mongoose.Types.ObjectId('507f1f77bcf86cd799439019');
const session={};
class Query{constructor(value){this.value=value;}session(value){assert.equal(value,session);return this;}select(){return this;}sort(){return this;}exec(){return Promise.resolve(this.value);}}

test('evidence snapshots have per-item immutable attempt and idempotency indexes',()=>{
 const indexes=Evidence.schema.indexes();
 assert.ok(indexes.some(([keys,options])=>keys.itemId===1&&keys.attempt===1&&options.unique));
 assert.ok(indexes.some(([keys,options])=>keys.itemId===1&&keys.idempotencyKey===1&&options.unique));
});

test('evidence attachment is conditional on same Staff, Facility, Item and transaction session',async t=>{
 const uploadId=new mongoose.Types.ObjectId(),upload={_id:uploadId,secureUrl:'https://res.cloudinary.com/demo/evidence.jpg',publicId:'wdp/managed-receiving/test',sha256:'hash',width:32,height:24,format:'jpg'};
 let readFilter,writeFilter,update,options;
 t.mock.method(Upload,'findOne',filter=>{readFilter=filter;return new Query(upload);});
 t.mock.method(Upload,'updateOne',(...args)=>{[writeFilter,update,options]=args;return new Query({modifiedCount:1});});
 const images=await service.attach([uploadId],itemId,facilityId,staffId,snapshotId,session);
 assert.equal(readFilter.itemId,itemId);assert.equal(readFilter.facilityId,facilityId);assert.equal(readFilter.staffId,staffId);assert.equal(readFilter.status,'UNATTACHED');
 assert.equal(writeFilter.status,'UNATTACHED');assert.equal(update.$set.status,'ATTACHED');assert.equal(update.$set.snapshotId,snapshotId);assert.equal(options.session,session);
 assert.equal(images[0].secureUrl,upload.secureUrl);
});

test('another Facility Staff member cannot claim an upload belonging to a different Item or Facility',async t=>{
 t.mock.method(Upload,'findOne',()=>new Query(null));
 await assert.rejects(service.attach([new mongoose.Types.ObjectId()],itemId,facilityId,staffId,snapshotId,session),error=>error.status===409);
});

test('Staff upload is blocked outside development/test before any Cloudinary call',async t=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 t.mock.method(CloudinaryService,'uploadInventoryImage',async()=>{throw Error('must not call Cloudinary');});
 await assert.rejects(service.upload(itemId.toString(),undefined,'evidence-key-01',{_id:staffId,role:'FACILITY_STAFF',assignedFacilityId:facilityId}),error=>error.status===503);
 process.env.NODE_ENV=previous;
});

test('Staff uploads require Facility Staff role',async()=>{
 await assert.rejects(service.upload(itemId.toString(),undefined,'evidence-key-02',{_id:staffId,role:'CUSTOMER',assignedFacilityId:facilityId}),error=>error.status===403);
});

test('Staff upload lookup is scoped to the actor Facility before contacting Cloudinary',async t=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
 const bytes=await sharp({create:{width:3,height:2,channels:3,background:'#123456'}}).png().toBuffer();
 let filter;
 t.mock.method(Item,'findOne',query=>{filter=query;return new Query(null);});
 t.mock.method(CloudinaryService,'uploadInventoryImage',async()=>{throw Error('must not call Cloudinary');});
 await assert.rejects(service.upload(itemId.toString(),{buffer:bytes,size:bytes.length,mimetype:'image/png'},'evidence-key-03',{_id:staffId,role:'FACILITY_STAFF',assignedFacilityId:facilityId}),error=>error.status===404);
 assert.equal(filter.facilityId,facilityId);
 process.env.NODE_ENV=previous;
});

test('successful upload persists a server-scoped UNATTACHED record and same-key replay reuses it',async t=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='development';t.after(()=>{process.env.NODE_ENV=previous;});
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#654321'}}).png().toBuffer();
 const item={_id:itemId,status:'PENDING_INBOUND',managedReservationId:new mongoose.Types.ObjectId()};
 const reservation={_id:item.managedReservationId};let record=null,createCount=0,cloudinaryCount=0;
 t.mock.method(Item,'findOne',filter=>{assert.equal(filter.facilityId,facilityId);return new Query(item);});
 t.mock.method(Reservation,'findOne',filter=>{assert.equal(filter.facilityId,facilityId);assert.equal(filter.serviceType,'MANAGED_INVENTORY');return new Query(reservation);});
 t.mock.method(Upload,'findOne',()=>new Query(record));
 t.mock.method(Upload,'create',async docs=>{createCount++;record={...docs[0],_id:new mongoose.Types.ObjectId()};return [record];});
 t.mock.method(Upload,'findOneAndUpdate',(filter,update)=>{record={...record,...update.$set};return new Query(record);});
 t.mock.method(Upload,'updateOne',()=>new Query({modifiedCount:1}));
 t.mock.method(CloudinaryService,'uploadInventoryImage',async(_bytes,folder,publicId)=>{cloudinaryCount++;assert.match(folder,new RegExp(`^wdp/managed-receiving/${facilityId}/${itemId}$`));return {secureUrl:'https://res.cloudinary.com/demo/receiving.png',publicId:`${folder}/${publicId}`,width:4,height:3,format:'png'};});
 const file={buffer:bytes,size:bytes.length,mimetype:'image/png'},actor={_id:staffId,role:'FACILITY_STAFF',assignedFacilityId:facilityId};
 const first=await service.upload(itemId.toString(),file,'evidence-key-success',actor);
 const replay=await service.upload(itemId.toString(),file,'evidence-key-success',actor);
 assert.equal(first.uploadId.toString(),replay.uploadId.toString());assert.equal(record.status,'UNATTACHED');assert.equal(createCount,1);assert.equal(cloudinaryCount,1);
});

test('cleanup selects only expired unattached uploads and never schedules ATTACHED snapshots',async t=>{
 const filters=[];
 t.mock.method(Upload,'findOneAndUpdate',filter=>{filters.push(filter);return new Query(null);});
 const result=await service.cleanupExpired(2);
 assert.deepEqual(result,{deleted:0});
 assert.deepEqual(filters[0].status.$in,['UPLOADING','UNATTACHED']);
 assert.equal(filters.some(filter=>filter.status==='ATTACHED'),false);
});
