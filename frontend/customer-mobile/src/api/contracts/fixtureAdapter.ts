import type {WireRequest} from './core';
import {assertOwner,createCustomerEpoch,objectId} from './core';
import {mapCurrentUser,mapFacility,mapFacilities,mapReservation,mapReservations} from './customer';

// Explicit dependency injection for contract tests only. No fetch/Axios/storage or production fallback.
export interface FixtureTransport {
  mode: 'FIXTURE_ONLY';
  request: (request: WireRequest, signal?: AbortSignal) => Promise<unknown>;
}
export function createFixtureReaders(transport:FixtureTransport,owner:string){
  if(transport.mode!=='FIXTURE_ONLY')throw Error('Only a fixture transport is permitted');objectId.parse(owner);
  const epoch=createCustomerEpoch();epoch.begin(owner);
  async function read<T>(path:string,map:(response:unknown)=>T):Promise<T>{const ticket=epoch.capture();if(ticket.customer!==owner)throw Error('Session expired or replaced; create a new scoped reader');try{const response=await transport.request({method:'GET',path});if(!epoch.accepts(ticket))throw Error('Session expired or replaced; discard stale data');return map(response);}catch(e){if((e as {response?:{status?:number}})?.response?.status===401&&epoch.accepts(ticket))epoch.expire();throw e;}}
  return {session:epoch,me:()=>read('/users/me',response=>{const user=mapCurrentUser(response);assertOwner({customerId:user._id},owner);return user;}),facilities:()=>read('/public/facilities',mapFacilities),
    facility:(id:string)=>read(`/public/facilities/${objectId.parse(id)}`,mapFacility),
    reservations:()=>read('/reservations/me',r=>mapReservations(r,owner)),
    reservation:(id:string,service:'SELF_STORAGE'|'MANAGED_INVENTORY')=>read(`/reservations/${service==='MANAGED_INVENTORY'?'managed/':''}${objectId.parse(id)}`,r=>{const value=mapReservation(r,owner);if(value._id!==id||value.serviceType!==service)throw Error('Reservation identity/service mismatch');return value;})};
}
