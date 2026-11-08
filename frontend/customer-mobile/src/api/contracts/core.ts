import {z} from 'zod';

// Backend wire data is deliberately separate from demo domain models and fixtures.
export const objectId=z.string().regex(/^[a-f\d]{24}$/i);
export const idRef=z.union([objectId,z.object({_id:objectId}).passthrough()]);
export const refId=(value:z.infer<typeof idRef>)=>typeof value==='string'?value:value._id;
export const instant=z.string().refine(v=>/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v)),'Invalid timestamp');
export const finite=z.number().finite();
export const nonnegative=finite.min(0);
export const positive=finite.positive();
export const whole=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const service=z.enum(['SELF_STORAGE','MANAGED_INVENTORY']);
export const httpUrl=z.string().max(2048).url().refine(v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}});
export const reservationStatus=z.enum(['RESERVED','CONTRACTED','DEPOSIT_PAID','CHECKIN_READY','PAID','ACTIVE','OVERDUE','CHECKED_OUT','CLOSED','CANCELLED']);
export const envelope=z.object({success:z.literal(true),data:z.unknown()}).passthrough();
export function readData<T>(schema:z.ZodType<T>,response:unknown):T {
  const body=envelope.parse(response);
  if(!Object.hasOwn(body,'data'))throw Error('Missing Backend data');
  return schema.parse(body.data);
}
export const pageSchema=z.object({page:whole.min(1),limit:whole.min(1).max(100),total:whole,totalPages:whole});
export function readPage<T>(schema:z.ZodType<T>,response:unknown){
  const body=envelope.extend({pagination:pageSchema}).parse(response);
  const items=z.array(schema).parse(body.data);
  if(items.length>body.pagination.limit)throw Error('Invalid page length');
  return {items,pagination:body.pagination};
}
export function assertOwner(resource:{customerId:z.infer<typeof idRef>},customerId:string){
  objectId.parse(customerId);
  if(refId(resource.customerId).toLowerCase()!==customerId.toLowerCase())throw Error('Resource is outside the current Customer scope');
}
export const capabilities=Object.freeze({liveTransport:false,booking:false,managedV2Production:false,mi06Production:false,
  signing:false,paymentInitiation:false,nativePaymentReturn:false,closureCompletion:false,refund:false,refreshToken:false});
export function normalizeApiFailure(error:unknown){
  const e=error as {response?:{status?:number;data?:{code?:string;message?:string}}};
  const status=e?.response?.status??null,code=e?.response?.data?.code??null;
  return {status,code,kind:status===401?'SESSION_EXPIRED':status===409||status===428?'CONFLICT':status===404?'UNAVAILABLE':status===503||status===null?'UNCERTAIN':'REJECTED',
    automaticMutationRetry:false as const,retainIntent:status===503||status===null,refreshAuthoritativeState:status===409||status===428};
}
export interface WireRequest {method:'GET'|'POST'|'PUT'|'PATCH';path:string;body?:unknown;headers?:Record<string,string>}

// Memory-only acceptance epoch. It stores no password, access token or refresh token.
export function createCustomerEpoch(){
  let epoch=0,customer:string|null=null;
  return {begin(id:string){customer=objectId.parse(id);return ++epoch;},expire(){customer=null;++epoch;},logout(){customer=null;++epoch;},
    capture(){return {epoch,customer};},accepts(ticket:{epoch:number;customer:string|null}){return customer!==null&&ticket.epoch===epoch&&ticket.customer===customer;}};
}
