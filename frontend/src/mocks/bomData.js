import {mockFacilities} from '@/mocks/facilities';
import {managerSeed,assignedFacility} from '@/mocks/managerData';
import {inventoryCategories} from '@/mocks/customerData';
export const bomToday=new Date().toLocaleDateString('en-CA');
export const bomServices=['SELF_STORAGE','MANAGED_INVENTORY'];
export const bomPolicyTypes=['Deposit','Cancellation','Refund','Overdue','Grace period','Access suspension','Forced termination'];
// Demo permissions only. Real BOM role/audit authorization contracts are unconfirmed.
export const bomDemoPermissions={manageBusiness:true,viewAudit:true};
const clone=x=>JSON.parse(JSON.stringify(x));
const facilities=mockFacilities.map((f,i)=>({...f,status:i===2?'INACTIVE':f.status}));
const rows={customers:[],units:[],rentals:[],payments:[],capacitySnapshots:[],alerts:[],contractSnapshots:[]};
for(const [index,f] of facilities.entries()){
 const prefix=index?'B'+(index+1)+'-':'';const id=x=>x?prefix+x:x;
 rows.customers.push(...clone(managerSeed.customers).map(x=>({...x,id:id(x.id),facilityId:f.id})));
 rows.units.push(...clone(managerSeed.units).map(x=>({...x,id:id(x.id),rentalId:id(x.rentalId),facilityId:f.id})));
 const rentals=clone(managerSeed.rentals).map(x=>({...x,id:id(x.id),customerId:id(x.customerId),unitId:id(x.unitId),facilityId:f.id,...(x.service==='MANAGED_INVENTORY'?{allocated_capacity_m3:[10,12,8][index],used_capacity_m3:[4,6,2][index],monthly:[2000000,2400000,1600000][index]}:{})}));rows.rentals.push(...rentals);
 rows.payments.push(...clone(managerSeed.payments).map(x=>({...x,id:id(x.id),customerId:id(x.customerId),rentalId:id(x.rentalId),facilityId:f.id})));
 rows.capacitySnapshots.push({id:'CAP-'+f.id,facilityId:f.id,operational_capacity_m3:managerSeed.shelves.filter(s=>s.status==='ACTIVE').reduce((sum,s)=>sum+s.max_volume_m3,0),asOf:bomToday});
 rows.alerts.push(...managerSeed.maintenance.filter(m=>m.status!=='RESOLVED').map(m=>({id:id(m.id),facilityId:f.id,service:m.resourceType==='Storage Unit'?'SELF_STORAGE':'MANAGED_INVENTORY',status:m.status,priority:m.priority,message:m.issue,date:bomToday})),...rentals.filter(r=>r.status==='OVERDUE').map(r=>({id:'ALERT-'+r.id,facilityId:f.id,service:r.service,status:'OVERDUE',priority:'HIGH',message:r.id+' checkout/payment review pending',date:r.end})));
 rows.contractSnapshots.push(...rentals.map(r=>({id:'SNAP-'+r.id,rentalId:r.id,facilityId:f.id,service:r.service,monthly:r.monthly,unitId:r.unitId||null,allocated_capacity_m3:r.allocated_capacity_m3||null,captured:r.start,description:'Read-only historical demo pricing snapshot'})));
}
const effective=bomToday;
export const bomSeed={facilities,...rows,
 facilityManagers:facilities.map((f,i)=>({id:'MGR-'+f.id,facilityId:f.id,name:i===0?assignedFacility.manager:'Not confirmed in demo source'})),
 facilityRules:facilities.map(f=>({id:'RULES-'+f.id,facilityId:f.id,description:'Demo: follow the site opening hours; reservations require an active facility. Existing rentals continue when a facility is deactivated.'})),
 pricing:[...['Small','Medium','Large'].map(size=>({id:'BPRICE-'+size.toUpperCase(),name:size+' private unit monthly price',facilityId:'ALL',service:'SELF_STORAGE',unitSize:size,billingMonths:1,rate:managerSeed.units.find(u=>u.size===size).price,effectiveFrom:effective,effectiveTo:'',status:'ACTIVE',revision:1,updatedAt:effective})),{id:'BPRICE-MANAGED',name:'Managed capacity monthly rate',facilityId:'ALL',service:'MANAGED_INVENTORY',unitSize:'',billingMonths:1,rate:200000,effectiveFrom:effective,effectiveTo:'',status:'ACTIVE',revision:1,updatedAt:effective}],
 policies:bomPolicyTypes.map((name,i)=>({id:'BPOL-'+(i+1),name,description:'Business policy · '+name,rule:name==='Deposit'?'Existing booking demo: deposit equals one undiscounted base month.':name==='Refund'?'Existing Manager demo: unused prepaid days / 30-day period, capped at original payment.':name==='Overdue'?'Existing Manager demo: daily charge equals monthly rental / 30 days.':name==='Access suspension'?'Existing Customer demo: overdue access may be suspended; exact eligibility is not defined.':'Not defined by the current source. Demo draft; backend/business approval required.',effectiveFrom:effective,status:['Deposit','Refund','Overdue'].includes(name)?'ACTIVE':'DRAFT',updatedAt:effective})),
 discounts:[{id:'BDISC-001',name:'Existing 3-month commitment illustration',type:'PROMOTIONAL',valueType:'PERCENTAGE',value:5,conditions:'Existing booking demo: three-month commitment. Future quotes only.',effectiveFrom:effective,effectiveTo:'',status:'ACTIVE',usage:null},{id:'BDISC-002',name:'Loyalty policy draft',type:'LOYALTY',valueType:'UNDEFINED',value:null,conditions:'Eligibility and value are not defined. Demo draft.',effectiveFrom:effective,effectiveTo:'',status:'DRAFT',usage:null},{id:'BDISC-003',name:'Approved fee-waiver policy draft',type:'FEE_WAIVER',valueType:'UNDEFINED',value:null,conditions:'Approval criteria and amount must be supplied by business owners.',effectiveFrom:effective,effectiveTo:'',status:'DRAFT',usage:null}],
 categories:inventoryCategories.map((name,i)=>({id:'BCAT-'+(i+1),name,description:'Category already offered by the Customer inventory demo.',allowedStatus:'ALLOWED',handlingNotes:'Demo draft: handling requirements must be confirmed by business owners.',restrictions:'Restrictions not defined by current source.',status:'DRAFT',updatedAt:effective})),
 audit:[{id:'BAUD-INITIAL',actor:'BOM demo seed',action:'DEMO_INITIALIZED',target:'Cross-facility fixture',scope:'ALL',timestamp:effective+'T08:00:00',summary:'Isolated business demo initialized. FAC003 is inactive to demonstrate status filtering.',before:null,after:null}]
};
