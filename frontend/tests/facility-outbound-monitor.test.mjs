import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {managedOverview} from '../src/lib/managedInventoryMonitor.js';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
const id=n=>String(n).padStart(24,'0');
function fixture(){
 const item={_id:id(1),facilityId:id(2),managedReservationId:id(3),name:'Hàng kiểm thử'};
 const movement={_id:id(4),itemId:id(1),facilityId:id(2),managedReservationId:id(3),type:'OUTBOUND',schemaVersion:4,performedAt:new Date().toISOString(),quantity:2,quantityUnit:'thùng',stockEffect:{action:'REMOVE',accessSessionId:id(5),source:[]}};
 return {data:{success:true,data:{facilityId:id(2),readOnly:true,rows:[{item,reconciliationStatus:'UNKNOWN',recentMovements:[movement,{...movement,_id:id(6),stockEffect:{...movement.stockEffect,accessSessionId:id(7)}}]}]}}};
}
function harness(response,props,state={}){
 let load;
 const mocks={react:{...React,useCallback:fn=>fn},'@/api/managedInventoryV3Api':{managedInventoryV3Api:{facilityOverview:async()=>response}},'@/lib/managedInventoryMonitor':{managedOverview},'@/lib/useFacilityResource':{default:fn=>{load=fn;return {loading:false,error:'',data:[],reload(){},...state}}}};
 const code=transformSync(readFileSync(new URL('../src/components/facility/FacilityOutboundRequests.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
 const html=renderToStaticMarkup(React.createElement(module.exports.default,{facilityId:id(2),...props}));
 return {html,load};
}
test('Manager sees confirmed removals; Staff history stays within assigned active sessions',async()=>{
 assert.equal((await harness(fixture(),{role:'manager'}).load()).length,2);
 assert.deepEqual((await harness(fixture(),{role:'staff',sessionIds:[id(5)]}).load()).map(row=>row.movement._id),[id(4)]);
 assert.equal((await harness(fixture(),{role:'staff',sessionIds:[]}).load()).length,0);
});
test('foreign facility responses fail rather than appearing as empty stock history',async()=>{
 const bad=fixture();bad.data.data.rows[0].recentMovements[0].facilityId=id(9);
 await assert.rejects(()=>harness(bad,{role:'manager'}).load());
});
test('history API error is visible and not presented as a successful empty result',()=>{
 const {html}=harness(fixture(),{role:'manager'},{error:'Không có quyền',data:null});
 assert.match(html,/Không tải được lịch sử xuất kho/);assert.doesNotMatch(html,/Chưa có lần xuất hàng phù hợp/);
 assert.doesNotMatch(html,/Xác nhận xuất hàng|Giảm tồn/);
});
