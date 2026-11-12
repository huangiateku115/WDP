import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {facilityLabel} from '../src/lib/facilityLabels.js';
import {reviewError} from '../src/lib/facilityReview.js';

test('facility labels translate lifecycle codes without changing their stored values',()=>{
 const codes=['ACTIVE','DEPOSIT_PAID','CHECKIN_READY','SIGNED','PARTIALLY_FULFILLED','FACILITY_STAFF'];
 const original=[...codes];
 for(const code of codes)assert.notEqual(facilityLabel(code),code);
 assert.deepEqual(codes,original);
 assert.equal(facilityLabel('ACTIVE'),'Đang sử dụng');
 assert.equal(facilityLabel('BOX'),'Thùng');
 assert.equal(facilityLabel('CUSTOMER'),'Khách hàng');
});

test('facility labels preserve unknown business data and React values',()=>{
 const value={type:'span',props:{children:'Test'}};
 assert.equal(facilityLabel(value),value);
 assert.equal(facilityLabel('Khách thử nghiệm'),'Khách thử nghiệm');
 assert.equal(facilityLabel('A-01'),'A-01');
 assert.equal(facilityLabel(0),0);
});

test('Vietnamese errors remain visible with localized HTTP hints',()=>{
 assert.equal(reviewError(new Error('Không đủ điều kiện bàn giao')),'Không đủ điều kiện bàn giao');
 assert.match(reviewError({response:{status:403,data:{message:'Sai cơ sở'}}}),/không cho phép.*Sai cơ sở/);
 assert.match(reviewError({}),/Không thể hoàn tất yêu cầu/);
});

test('facility localization keeps select option values and Customer language opt-in separate',()=>{
 const ui=readFileSync(new URL('../src/components/manager/ManagerUI.jsx',import.meta.url),'utf8');
 assert.match(ui,/value=\{v\}/);
 assert.match(ui,/facilityLabel\(l\)/);
 const shared=readFileSync(new URL('../src/components/customer/inventory/ManagedContractReview.jsx',import.meta.url),'utf8');
 assert.match(shared,/facilityLanguage=false/);
 const lookup=readFileSync(new URL('../src/components/manager/ManagedContractLookup.jsx',import.meta.url),'utf8');
 assert.match(lookup,/<ManagedContractReview facilityLanguage/);
});

test('Staff and Manager layouts render Vietnamese navigation without missing helpers',async()=>{
 const {transformSync}=await import('esbuild');
 const {createRequire}=await import('node:module');
 const React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const require=createRequire(import.meta.url);
 for(const [layout,role] of [['StaffLayout','FACILITY_STAFF'],['ManagerLayout','FACILITY_MANAGER']]){
  const simple=tag=>props=>React.createElement(tag,null,props.children);
  const mocks={
   '@/lib/facilityLabels':{facilityLabel},
   '@/lib/facilityWorkspace':{facilityHome:role=>'/'+role+'/reservations',facilityPageVisible:()=>true},
   '@/components/common/RoleWorkspaceOutlet':{default:()=>React.createElement('div',null,'Nội dung')},
   '@/lib/demoScope':{isM4DemoMenu:()=>true,m4DemoHome:()=>'/staff/reservations'},
   'react-router-dom':{Link:simple('a'),NavLink:simple('a'),Outlet:simple('div')},
   'lucide-react':require('lucide-react'),
   '@/components/common/Brand':{default:()=>React.createElement('span',null,'VaultSpace')},
   '@/components/common/LogoutButton':{default:()=>React.createElement('button',null,'Đăng xuất')},
   '@/components/manager/ManagerUI':{Select:simple('select')},
   '@/lib/authSession':{useAuthSession:()=>({user:{role,displayName:'Đạt',assignedFacilityId:'a'.repeat(24)}})},
   '@/lib/staffDemoStore':{useStaffData:()=>({}),selectDemoOperator:()=>{},staffDemoEnabled:false,operator:()=>null},
   '@/lib/managerDemoStore':{managerDemoEnabled:false},
   '@/mocks/staffData':{staffFacility:{},staffOperators:[]},
   '@/mocks/managerData':{assignedFacility:{}},
  };
  const source=readFileSync(new URL(`../src/layouts/${layout}.jsx`,import.meta.url),'utf8');
  const code=transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name.endsWith('.css')?{}:name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  const html=renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html,/Đơn đặt thuê/);
  assert.match(html,/Bản đồ kho/);
  assert.match(html,role==='FACILITY_STAFF'?/Nhân viên cơ sở/:/Quản lý cơ sở/);
 }
});
