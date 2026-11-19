import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {inventoryMovements,movementBatchLines} from '../src/lib/inventoryMovementHistory.js';
import * as registration from '../src/lib/inventoryRegistration.js';
const require=createRequire(import.meta.url),iid='a'.repeat(24),rid='b'.repeat(24),fid='c'.repeat(24),cell='d'.repeat(24),dest='e'.repeat(24);
const item={_id:iid,facilityId:fid,managedReservationId:rid,itemCode:'BATCH-TEST',name:'Fixture Item'};
const legacy={_id:'1'.repeat(24),itemId:iid,facilityId:fid,managedReservationId:rid,type:'INBOUND',sourceCellId:null,destinationCellId:cell,quantity:1,quantityUnit:'box',actualUnitWeightKg:2,actualTotalWeightKg:2,actualUnitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},actualTotalVolumeM3:.008,performedAt:'2026-10-20T01:00:00Z',inspectionNote:'Legacy inspection'};
const batch=(changes={})=>({batchId:'receipt-A',action:'REMOVE',quantity:1,quantityUnit:'box',actualUnitWeightKg:2,actualUnitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},actualTotalWeightKg:2,actualTotalVolumeM3:.008,...changes});
const canonical={...legacy,type:'OUTBOUND',schemaVersion:2,arithmeticPolicy:'CANONICAL_V1',sourceCellId:cell,destinationCellId:null,quantity:3,actualTotalWeightKg:8,actualTotalVolumeM3:.032,batchLines:[batch({receiptMovementId:'2'.repeat(24)}),batch({batchId:'receipt-B',quantity:2,actualUnitWeightKg:3,actualUnitDimensionsM:{widthM:.3,depthM:.2,heightM:.2},actualTotalWeightKg:6,actualTotalVolumeM3:.024,receiptRequestId:'3'.repeat(24),receivingInspectionEvidenceId:'4'.repeat(24)})]};
const parse=m=>inventoryMovements({data:{success:true,data:[m]}},item)[0];
const pass=({children})=>React.createElement('div',null,children);
let resource;
const mocks={
 'react-router-dom':{Link:({children,to})=>React.createElement('a',{href:to},children),useParams:()=>({id:iid})},
 '@/lib/inventoryRegistration':registration,'@/lib/inventoryMovementHistory':{inventoryMovements,movementBatchLines},
 '@/lib/customerReservationDisplay':{reservationVietnamTime:String},'@/lib/warehouseMap':{weightText:n=>`${n} kg`},'@/lib/managedCellBooking':{volumeText:n=>`${n} m3`},
 '@/components/customer/inventory/InventoryBackendUI':{inventoryApi:new Proxy({},{get(){throw Error('Unexpected API access during fixture render');}}),useInventoryBackend:()=>resource},
 '@/components/customer/inventory/managedInventoryContext':{inventoryCellLocationDetails:async()=>({})},
 '@/lib/authSession':{useAuthSession:()=>({user:{_id:'f'.repeat(24)}})},
 '@/components/customer/RentalBackendUI':{LoadState:({resource:r})=>React.createElement('p',null,r.loading?'Loading movements':r.error||'')},
 '@/components/common/CustomerScreen':{CustomerScreen:pass,EmptyState:({title})=>React.createElement('h2',null,title)},
 '@/components/ui/card':{Card:pass,CardContent:pass},'@/components/ui/button':{Button:({children})=>React.createElement('button',null,children)},'@/components/ui/badge':{Badge:pass},
};
const code=transformSync(readFileSync(new URL('../src/pages/customer/InventoryHistoryPage.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,module={exports:{}};
new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
const {default:Page,MovementMeasurements}=module.exports;
const render=m=>renderToStaticMarkup(React.createElement(MovementMeasurements,{movement:parse(m)}));
test('legacy movement remains readable without fabricated batch section',()=>{assert.deepEqual(movementBatchLines(legacy),[]);const html=render(legacy);assert.match(html,/Total weight: 2 kg/);assert.match(html,/Unit weight: 2 kg/);assert.doesNotMatch(html,/Batch details|Parent total/);});
test('canonical single batch renders its own physical values and optional references',()=>{const m={...canonical,quantity:1,actualTotalWeightKg:2,actualTotalVolumeM3:.008,batchLines:[batch({receiptMovementId:'2'.repeat(24)})]};const html=render(m);assert.match(html,/Batch details \(1\)/);assert.match(html,/Batch quantity: 1 box/);assert.match(html,/Receipt movement/);});
test('multiple batches preserve parent totals and never label first batch units as all movement units',()=>{const before=JSON.stringify(canonical),html=render(canonical);assert.match(html,/Parent total weight: 8 kg/);assert.match(html,/Parent total volume: 0.032 m3/);assert.match(html,/Batch unit weight: 2 kg/);assert.match(html,/Batch unit weight: 3 kg/);assert.match(html,/0.3 × 0.2 × 0.2 m/);assert.match(html,/first batch only/);assert.equal(JSON.stringify(canonical),before);});
test('missing optional batch refs are omitted without inventing receipts or evidence',()=>{const html=render({...canonical,quantity:1,batchLines:[batch()],actualTotalWeightKg:2,actualTotalVolumeM3:.008});assert.doesNotMatch(html,/Receipt movement:|Receipt request:|Receiving inspection evidence:/);assert.match(html,/receipt-A/);});
test('batch validation rejects wrong units/actions, quantities, measurements and reference IDs',()=>{for(const b of [batch({quantityUnit:'kg'}),batch({action:'ADD'}),batch({quantity:0}),batch({actualUnitWeightKg:NaN}),batch({receiptMovementId:'invalid'})])assert.throws(()=>parse({...canonical,quantity:1,batchLines:[b]}));assert.throws(()=>parse({...canonical,quantity:99}));assert.throws(()=>parse({...canonical,batchLines:null}));});
test('Customer history localizes operation, hides internal identifiers/schema and resolves cell locations',()=>{const m=parse({...legacy,schemaVersion:3});resource={data:{item,movements:[m],locations:{[cell]:{rackCode:'MI-DEMO-R01',levelNumber:1,cellCode:'L1-C1'}},specifications:{}},loading:false,retry:()=>{}};const html=renderToStaticMarkup(React.createElement(Page));assert.match(html,/Nhập hàng/);assert.match(html,/Fixture Item/);assert.match(html,/1 box/);assert.match(html,/Ngoài kho/);assert.match(html,/Kệ MI-DEMO-R01 · Tầng 1 · Ô L1-C1/);assert.match(html,/Thao tác/);assert.doesNotMatch(html,/Schema v3|INBOUND|Outside|Source Cell|Destination Cell|a{24}|b{24}|c{24}|d{24}|f{24}/);});
test('RELOCATION uses Vietnamese name and only named source and destination locations',()=>{const m={...canonical,type:'RELOCATION',destinationCellId:dest,relocationNote:'Moved by Staff',batchLines:canonical.batchLines.map(b=>({...b,action:'MOVE'}))};resource={data:{item,movements:[parse(m)],locations:{[cell]:{rackCode:'R-01',levelNumber:1,cellCode:'L1-C1'},[dest]:{rackCode:'R-02',levelNumber:2,cellCode:'L2-C3'}}},loading:false,retry:()=>{}};const html=renderToStaticMarkup(React.createElement(Page));assert.match(html,/Chuyển vị trí/);assert.match(html,/Kệ R-01/);assert.match(html,/Kệ R-02/);assert.match(html,/Moved by Staff/);assert.doesNotMatch(html,/Schema v|RELOCATION|a{24}|b{24}|c{24}|d{24}|e{24}/);});
test('missing Cell metadata shows a safe message instead of an identifier',()=>{resource={data:{item,movements:[parse(legacy)],locations:{},specifications:{}},loading:false,retry:()=>{}};const html=renderToStaticMarkup(React.createElement(Page));assert.match(html,/Chưa có thông tin vị trí/);assert.doesNotMatch(html,new RegExp(cell));});
for(const [name,r,expected] of [['loading',{loading:true},'Loading movements'],['error',{loading:false,error:'Fixture history unavailable'},'Fixture history unavailable'],['empty',{loading:false,data:{item,movements:[]}},'Chưa có lịch sử hàng hóa']])test('history '+name+' state',()=>{resource={...r,retry:()=>{}};assert.match(renderToStaticMarkup(React.createElement(Page)),new RegExp(expected));});
