import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const facilityId='507f1f77bcf86cd799439011';
const unitId='507f1f77bcf86cd799439012';
const facility={_id:facilityId,name:'Cơ sở thử nghiệm',status:'ACTIVE',serviceTypes:['SELF_STORAGE'],address:{line1:'12 Đường Thử',district:'Quận 1',city:'TP. Hồ Chí Minh'}};
let unit={_id:unitId,facilityId,unitCode:'A-01',size:'SMALL',volumeM3:3,status:'AVAILABLE'};
const response=data=>({data:{success:true,data}});
const textOf=value=>Array.isArray(value)?value.map(textOf).join(''):typeof value==='string'?value:value?.props?textOf(value.props.children):'';

function setup(initialFacility='',unitStatus='AVAILABLE'){
 unit={...unit,status:unitStatus};
 const source=readFileSync(new URL('../src/components/customer/RentalBookingIntegration.jsx',import.meta.url),'utf8');
 const code=transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
 const state=[];let cursor=0,draft=initialFacility?{facility,unit:null}:{};let destination=null;const calls=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value}]},useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i]}};
 const useBackend=(loader,deps=[],publicRead=false)=>{
  if(deps.length===0)return{data:[facility],error:'',loading:false,retry(){}};
  if(deps.length===1)return{data:deps[0]===facilityId?facility:null,error:'',loading:false,retry(){}};
  return{data:deps[0]===facilityId?{units:[unit],pagination:{totalPages:1}}:null,error:'',loading:false,retry(){}};
 };
 const mocks={
  react:hooks,
  'react-router-dom':{Navigate:()=>null,useNavigate:()=>path=>{destination=path},useSearchParams:()=>[new URLSearchParams()]},
  '@/lib/authSession':{getAccessToken:()=> 'test-token'},
  '@/api/facilityApi':{default:{}},
  '@/api/storageApi':{default:{unitDetail:async id=>{calls.push(id);return response(unit)}}},
  '@/api/customerRentalApi':{pricingApi:{}},
  '@/contexts/ReservationContext':{useReservation:()=>({rentalDraft:draft,updateRentalDraft:patch=>{draft={...draft,...patch}}})},
  '@/components/common/Steps':{default:()=>null},
  './PublicFacilityCatalog':{PublicFacilityBrowser:()=>null},
  './RentalPeriodIntegration':{default:()=>null},
  './SelfStorageReservationReview':{default:()=>null},
  './RentalBackendUI':{
   BackendScreen:({children,...props})=>React.createElement('main',props,children),
   Card:({children,...props})=>React.createElement('section',props,children),
   CardContent:({children,...props})=>React.createElement('div',props,children),
   Button:({children,asChild,...props})=>React.createElement('button',props,children),
   Message:({error})=>error?React.createElement('p',{role:'alert'},error):null,
   Link:({children,to,...props})=>React.createElement('a',{...props,href:to},children),
   useBackend,LoadState:()=>null,rows:r=>r.data.data,record:r=>r.data.data,
   recordId:r=>typeof r==='string'?r:r?._id||r?.id,
   validId:v=>typeof v==='string'&&/^[a-f\d]{24}$/i.test(v),
   addressText:value=>value?Object.values(value).join(', '):undefined,
   rentalError:e=>e.message,
  },
 };
 const mod={exports:{}};
 new Function('require','module','exports',code)((name)=>name in mocks?{__esModule:true,...mocks[name]}:require(name),mod,mod.exports);
 function render(){cursor=0;const selection=mod.exports.StorageSelection();return selection.type(selection.props)}
 function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;if(typeof node.type==='function')return find(node.type(node.props),predicate);for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found}return null}
 return{render,find,get draft(){return draft},get destination(){return destination},calls};
}

test('Step 1 prompts facility selection without rendering fabricated units',()=>{
 const h=setup();const tree=h.render();
 assert.match(textOf(tree),/Bắt đầu bằng cách chọn cơ sở/);
 assert.match(textOf(tree),/Danh sách kho sẽ xuất hiện/);
 assert.equal(h.find(tree,node=>node.type==='button'&&textOf(node.props.children).includes('Chọn kho này')),null);
});

test('Step 1 selection is explicit, preserves the verified unit and continues through the existing route',async()=>{
 const h=setup();let tree=h.render();
 const facilitySelect=h.find(tree,node=>node.type==='select');assert(facilitySelect);
 facilitySelect.props.onChange({target:{value:facilityId}});tree=h.render();
 assert.match(textOf(tree),/Cơ sở thử nghiệm/);assert.match(textOf(tree),/12 Đường Thử/);assert.match(textOf(tree),/Kho A-01/);
 const choose=h.find(tree,node=>node.type==='button'&&textOf(node.props.children).includes('Chọn kho này'));assert(choose);await choose.props.onClick();
 tree=h.render();assert.equal(h.draft.unit._id,unitId);assert.equal(h.destination,null);assert.match(textOf(tree),/Đã chọn/);
 const next=h.find(tree,node=>node.type==='button'&&textOf(node.props.children).includes('Tiếp tục chọn thời gian thuê'));assert(next&&!next.props.disabled);await next.props.onClick();
 assert.equal(h.destination,'/portal/rent/period');assert.deepEqual(h.calls,[unitId]);
});

 test('Unavailable units stay disabled and do not become selected',()=>{
 const h=setup(facilityId,'MAINTENANCE');const tree=h.render();
 const choose=h.find(tree,node=>node.type==='button'&&textOf(node.props.children).includes('Chọn kho này'));
 assert.equal(choose,null);
});
