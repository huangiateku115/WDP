import {bomSeed} from '@/mocks/bomData';
export const adminDemoEnabled=import.meta.env.VITE_USE_MOCK!=='false';
const day=new Date().toLocaleDateString('en-CA');
// Static independent oversight snapshot, never the mutable BOM store or real Users collection.
export const adminFacilityData=adminDemoEnabled?JSON.parse(JSON.stringify(bomSeed)):Object.fromEntries(Object.keys(bomSeed).map(k=>[k,[]]));
export const adminLoginExamples=adminDemoEnabled?[
 {id:'DEMO-LOGIN-001',user:'Example facility operator',role:'FACILITY_STAFF',event:'SIGN_IN',timestamp:day+'T09:00:00+07:00',device:'Example browser',ip:'192.0.2.10',result:'SUCCESS'},
 {id:'DEMO-LOGIN-002',user:'Example facility manager',role:'FACILITY_MANAGER',event:'SIGN_IN',timestamp:day+'T09:15:00+07:00',device:'Example mobile browser',ip:'198.51.100.20',result:'FAILED'},
 {id:'DEMO-LOGIN-003',user:'Example customer',role:'Customer (demo label)',event:'SIGN_IN',timestamp:day+'T09:30:00+07:00',device:'Example browser',ip:'203.0.113.30',result:'SUCCESS'}]:[];
export const adminAuditExamples=adminDemoEnabled?[
 {id:'DEMO-AUDIT-001',actor:'Example administrator',role:'Administrator (demo label)',action:'USER_CREATED',target:'Example account',targetType:'User',timestamp:day+'T08:30:00+07:00',scope:'System',before:null,after:{displayName:'Example account',role:'FACILITY_STAFF'},summary:'Illustrative account creation; not an event from the real Users API.'},
 {id:'DEMO-AUDIT-002',actor:'Example administrator',role:'Administrator (demo label)',action:'ROLE_CHANGED',target:'Example account',targetType:'User',timestamp:day+'T08:45:00+07:00',scope:'System',before:{role:'FACILITY_STAFF'},after:{role:'FACILITY_MANAGER'},summary:'Illustrative role change only.'},
 {id:'DEMO-AUDIT-003',actor:'Example business operator',role:'Business Operations (demo label)',action:'PRICING_REVISED',target:'Example future pricing',targetType:'Pricing rule',timestamp:day+'T09:00:00+07:00',scope:'All facilities',before:{status:'DRAFT'},after:{status:'ACTIVE'},summary:'Illustrative business activity; no pricing or payment mutation.'}
]:[];
