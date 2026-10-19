import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInventoryImageFile,validateInventoryImageDimensions,uploadedInventoryImage,inventoryImagesReady} from '../src/lib/inventoryImages.js';
test('IMAGE-01 enforces exact type, byte and dimension boundaries',()=>{
  for(const type of ['image/jpeg','image/png','image/webp'])validateInventoryImageFile({type,size:8388608});
  for(const file of [{type:'image/gif',size:1},{type:'image/png',size:0},{type:'image/png',size:8388609}])assert.throws(()=>validateInventoryImageFile(file));
  validateInventoryImageDimensions(6000,4000);
  for(const dims of [[6001,1],[6000,4001],[0,100],[1.5,1]])assert.throws(()=>validateInventoryImageDimensions(...dims));
});
test('upload response requires usable metadata and expiry, never attachment',()=>{
  const image={uploadId:'a'.repeat(24),publicId:'fixture/image',secureUrl:'https://images.example.test/one.png',width:1,height:1,format:'png',expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(uploadedInventoryImage({data:{success:true,data:image}}),image);
  for(const changed of [{uploadId:''},{secureUrl:'blob:abc'},{expiresAt:'2000-01-01'},{width:7000},{format:'gif'}])assert.throws(()=>uploadedInventoryImage({data:{success:true,data:{...image,...changed}}}));
  assert(inventoryImagesReady([{status:'attached'},{...image,status:'uploaded'}]));
  for(const state of ['queued','uploading','failed','cancelled','removing'])assert(!inventoryImagesReady([{status:state}]));
  assert(!inventoryImagesReady([{status:'uploaded',expiresAt:'2000-01-01'}]));
});
