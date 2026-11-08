// Isolated render/handler fixtures. No Website transport or DOM is started.
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
const babel=require('@babel/core');
const web=path.resolve(__dirname,'../../src');
function compile(file:string,mocks:Record<string,unknown>){
  const code=babel.transformSync(fs.readFileSync(path.join(web,file),'utf8'),{babelrc:false,configFile:false,
    plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
  const module={exports:{} as any};
  new Function('require','module','exports',code)((name:string)=>name in mocks?{__esModule:true,...mocks[name] as object}:name==='react/jsx-runtime'?require('react/jsx-runtime'):require(name),module,module.exports);
  return module.exports;
}
const pass=({children}:any)=>children;
const UI=Object.fromEntries(['Button','Card','CardContent','Details','Message','BackendScreen','LoadState','Link','Steps','Checkbox'].map(x=>[x,pass]));
function all(tree:any,predicate:(node:any)=>boolean):any[]{if(!tree||typeof tree!=='object')return [];const own=predicate(tree)?[tree]:[];return own.concat([tree.props?.children].flat(Infinity).flatMap(x=>all(x,predicate)));}
function hooks(){const values:any[]=[],refs:any[]=[];let cursor=0;return {values,render<T>(run:()=>T){cursor=0;return run();},api:{useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],(v:any)=>values[i]=typeof v==='function'?v(values[i]):v];},useRef:(initial:any)=>{const i=cursor++;return refs[i]??={current:initial};},useEffect:()=>{}}};}
const uid='a'.repeat(24),rid='b'.repeat(24),iid='c'.repeat(24),fid='d'.repeat(24);
const policy=compile('components/customer/inventory/customerInventoryPolicy.js',{});
const registration=compile('lib/inventoryRegistration.js',{});

test.each(['CUSTOMER','FACILITY_STAFF','FACILITY_MANAGER'])('Managed contract signing containment is Customer-specific (%s)',async role=>{
  const h=hooks(),api={signCustomer:jest.fn(),signFacility:jest.fn()},refresh=jest.fn();
  const Component=compile('components/customer/inventory/ManagedContractReview.jsx',{
    react:h.api,'@/lib/authSession':{useAuthSession:()=>({user:{_id:uid,role}}),getAccessToken:()=> 'fixture'},
    '@/lib/inventoryRegistration':{inventoryId:(v:any)=>typeof v==='string'?v:v?._id,inventoryError:String},
    '@/lib/managedIntake':{currentManagedContract:()=>({version:1,hash:'hash',status:'DRAFT',content:{}}),maySignManaged:()=>true,contractFingerprint:()=> 'same'},
    '@/api/managedIntakeApi':{managedIntakeApi:api},'../RentalBackendUI':UI,'@/components/ui/checkbox':UI,
    '@/lib/customerManagedContractState':{customerManagedContractState:()=>({kind:'DRAFT',canSign:true,progress:{version:1,hash:'hash',status:'DRAFT'}})},
    './CustomerContractSnapshot':{default:pass},'@/lib/customerReservationDisplay':{reservationVietnamTime:String},
  }).default;
  const props={contract:{_id:iid},reservation:{_id:rid},loadLatest:jest.fn(),onRefresh:refresh,customerView:role==='CUSTOMER'};
  h.render(()=>Component(props));h.values[1]=true;
  let tree=h.render(()=>Component(props));if(role==='CUSTOMER')tree=tree.type(tree.props);
  const sign=all(tree,n=>n.props?.onClick&&String(n.props?.children).includes('Managed contract'))[0];
  if(role==='CUSTOMER'){
    expect(sign.props.disabled).toBe(true);await sign.props.onClick();expect(api.signCustomer).not.toHaveBeenCalled();expect(props.loadLatest).not.toHaveBeenCalled();
    const reload=all(tree,n=>n.props?.children==='Refresh contract (GET)')[0];reload.props.onClick();expect(refresh).toHaveBeenCalledTimes(1);
  }else expect(sign.props.disabled).toBe(false);
});

test('Inventory409 refreshes both contexts without resetting the Customer form or retrying create',async()=>{
 const h=hooks(),retry=jest.fn(),contextRetry=jest.fn();let reads=0;
 const rental={_id:rid,facilityId:fid,serviceType:'MANAGED_INVENTORY',status:'ACTIVE',allocatedCapacity:1,_facility:{name:'Facility'}};
 const payload={managedReservationId:rid,itemCode:'TEST',name:'Customer input',category:'box',quantity:1,quantityUnit:'box',unitWeightKg:1,widthM:1,depthM:1,heightM:1,description:'keep me',images:'',preferredCellId:''};
 const create=jest.fn(async()=>{throw {response:{status:409,data:{message:'Closure pending'}}};});
 const Component=compile('components/customer/inventory/InventoryItemForm.jsx',{
   react:h.api,'react-router-dom':{useNavigate:()=>jest.fn(),useSearchParams:()=>[new URLSearchParams()]},
   '../warehouse/ManagedCellSummary':{default:pass},'./InventoryImagePicker':{default:pass},
   './managedInventoryContext':{...policy,managedInventoryReservation:async()=>rental,verifiedPreferredCells:async()=>[]},
   '@/lib/authSession':{getAccessToken:()=> 'fixture'},'@/lib/inventoryRegistration':registration,
   './InventoryBackendUI':{inventoryApi:{create},inventoryRentals:async()=>[rental],inventoryRegistrationRentals:async()=>[rental],
     useInventoryBackend:()=>{const i=reads++%3;return i===0?{data:[rental],retry}:i===1?{data:rental,loading:false,retry:contextRetry}:{data:[],retry:jest.fn()};}},
   '@/components/common/CustomerScreen':{Field:pass},'@/components/ui/card':UI,'@/components/ui/button':UI,'../InventoryFormUI':UI,
 }).default;
 const render=()=>h.render(()=>{reads=0;return Component({});});render();
 // Form state is the final useState before resource hooks (four booleans plus error then form).
 const index=h.values.findIndex(v=>v&&typeof v==='object'&&Object.hasOwn(v,'managedReservationId'));expect(index).toBeGreaterThan(-1);h.values[index]=payload;
 const form=all(render(),n=>n.type==='form')[0];await form.props.onSubmit({preventDefault(){}});
 expect(create).toHaveBeenCalledTimes(1);expect(retry).toHaveBeenCalled();expect(contextRetry).toHaveBeenCalled();expect(h.values[index]).toEqual(payload);
});
