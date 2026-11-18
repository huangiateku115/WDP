import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as statistics from '../src/lib/managerStatistics.js';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';
import {facilityPageVisible} from '../src/lib/facilityWorkspace.js';
const facility='a'.repeat(24),other='b'.repeat(24),filters={fromDate:'2026-11-01',toDate:'2026-11-17',serviceType:'MANAGED_INVENTORY',granularity:'week',status:'OPEN',page:99};
const response=data=>({data:{success:true,data,meta:{facilityScope:{type:'FACILITY',facilityId:facility},timezone:'Asia/Ho_Chi_Minh'}}});
test('report queries are scoped and send only supported filters; snapshot exports exclude dates',()=>{
 assert.deepEqual(statistics.statisticsQuery('managed-capacity',filters,facility,{exporting:true}),{facilityId:facility});
 assert.deepEqual(statistics.statisticsQuery('incidents',filters,facility),{facilityId:facility,fromDate:filters.fromDate,toDate:filters.toDate,granularity:'week',status:'OPEN'});
 const paged=statistics.statisticsQuery('managed-operations',filters,facility,{page:2});assert.equal(paged.page,2);assert.equal(paged.limit,20);assert.equal(paged.status,undefined);
 const exported=statistics.statisticsQuery('managed-operations',filters,facility,{page:2,exporting:true});assert.equal(exported.page,undefined);assert.equal(exported.limit,undefined);
 assert.throws(()=>statistics.statisticsQuery('overview',filters,''));
});
test('date validation rejects impossible, reversed and oversized periods',()=>{
 for(const pair of [['2026-02-30','2026-03-01'],['2026-11-17','2026-11-01'],['2025-01-01','2026-11-17'],['','2026-11-17']])assert.throws(()=>statistics.validateStatisticsDates(...pair));
 assert.doesNotThrow(()=>statistics.validateStatisticsDates('2026-01-01','2026-12-31'));
});
test('scope validation rejects global and nested foreign data without converting null to zero',()=>{
 assert.equal(statistics.scopedStatistics(response({amount:null}),facility).data.amount,null);
 assert.throws(()=>statistics.scopedStatistics({data:{...response({}).data,meta:{facilityScope:{type:'ALL'}}}},facility));
 assert.throws(()=>statistics.scopedStatistics(response({items:[{facilityId:other}]}),facility));
 assert.equal(statistics.statisticValue(null),'Chưa có dữ liệu');assert.equal(statistics.statisticValue(0),'0');
});
test('all documented statistics reads and exports are allowlisted without permitting mutation',()=>{
 for(const [report]of statistics.statisticsReports)assert.doesNotThrow(()=>assertConfirmedRequest({method:'get',url:`/statistics/${report}`}));
 for(const format of ['csv','xlsx','pdf'])assert.doesNotThrow(()=>assertConfirmedRequest({method:'get',url:`/statistics/export/${format}`}));
 for(const method of ['post','patch','delete'])assert.throws(()=>assertConfirmedRequest({method,url:'/statistics/overview'}));
 assert.equal(facilityPageVisible('manager','reports'),true);assert.equal(facilityPageVisible('staff','reports'),false);
});
function render(role='FACILITY_MANAGER',failure=''){
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const requestKey=JSON.stringify(statistics.statisticsQuery('overview',{fromDate:day.slice(0,7)+'-01',toDate:day,serviceType:'',granularity:'day',unitSize:'',status:'',paymentStatus:'',action:'',expiringWithinDays:'7',comparePrevious:false},facility));
 let reads=0;
 const container=props=>React.createElement('section',null,props.title,props.description,props.action,props.children);
 const ui={Screen:container,Panel:container,Field:props=>React.createElement('label',null,props.label,props.children),Input:props=>React.createElement('input',props),Select:props=>React.createElement('select',{'aria-label':props.label,value:props.value,onChange:()=>{}},props.options.map(([value,label])=>React.createElement('option',{key:value,value},label))),Button:props=>React.createElement('button',{disabled:props.disabled,type:props.type},props.children),Message:props=>props.error?React.createElement('p',{role:'alert'},props.error):null,Details:props=>React.createElement('div',null,props.values.map(([label,value])=>React.createElement('p',{key:label},label,':',value))),Table:()=>React.createElement('table')};
 const mocks={react:React,'react-router-dom':{useSearchParams:()=>[new URLSearchParams(),()=>{}]},'@/api/managerStatisticsApi':{managerStatisticsApi:{}},'@/lib/authSession':{useAuthSession:()=>({user:{id:'manager',role,assignedFacilityId:facility},accessToken:'test'})},'@/lib/useFacilityResource':{default:()=>++reads===1?{data:{facilities:[{id:facility,name:'Cơ sở test',code:'HCM'}]},reload(){}}:{data:failure?null:{requestKey,body:response({reservationCount:6,collectedAmount:0,refundedAmount:null}).data},error:failure,loading:false,reload(){}}},'@/lib/facilityReview':{objectId:value=>/^[a-f\d]{24}$/i.test(value),reviewError:error=>error.message},'@/lib/managerStatistics':statistics,'@/components/manager/ManagerUI':ui,'@/components/bom/BomUI':{Kpis:props=>React.createElement('div',null,props.items.map(([label,value])=>React.createElement('p',{key:label},label,':',value)))},'@/lib/facilityLabels':{facilityLabel:value=>value}};
 const code=transformSync(readFileSync(new URL('../src/pages/manager/StatisticsPage.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,module={exports:{}};
 new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
 return renderToStaticMarkup(React.createElement(module.exports.default));
}
test('manager page renders real report values, scoped facility and unavailable metrics',()=>{
 const html=render();assert.match(html,/Đơn đặt thuê.*6/);assert.match(html,/Tiền đã thu.*0/);assert.match(html,/Tiền hoàn.*Chưa có dữ liệu/);assert.match(html,/Cơ sở test/);
 const forbidden=render('FACILITY_STAFF');assert.match(forbidden,/Chưa có quyền truy cập/);assert.doesNotMatch(forbidden,/Áp dụng bộ lọc/);
 const error=render('FACILITY_MANAGER','Không có quyền');assert.match(error,/Không có quyền/);assert.doesNotMatch(error,/Đơn đặt thuê:6/);
});
