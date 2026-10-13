import inventoryApi from '@/api/inventoryApi';
import reservationApi from '@/api/reservationApi';
import facilityApi from '@/api/facilityApi';
import {useBackend,rows,record} from '../RentalBackendUI';
import {eligibleInventoryRental,inventoryId,inventoryError} from '@/lib/inventoryRegistration';
export {inventoryApi};
export const inventoryRead=async run=>{try{return await run();}catch(e){throw Error(inventoryError(e));}};
export const useInventoryBackend=(loader,deps=[])=>useBackend(config=>inventoryRead(()=>loader(config)),deps);
export async function inventoryRentals(config){
  const owned=await reservationApi.mineReal(config).then(rows),active=owned.filter(eligibleInventoryRental),facilities=new Map();
  await Promise.all([...new Set(active.map(r=>inventoryId(r.facilityId)))].map(async id=>{try{const facility=record(await facilityApi.publicDetail(id,config));if(inventoryId(facility)===id&&facility.serviceTypes?.includes('MANAGED_INVENTORY')&&(facility.status==null||facility.status==='ACTIVE'))facilities.set(id,facility);}catch(e){if(![404,409].includes(e.response?.status))throw e;}}));
  return active.filter(r=>facilities.has(inventoryId(r.facilityId))).map(r=>({...r,_facility:facilities.get(inventoryId(r.facilityId))}));
}
