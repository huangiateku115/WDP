import {apiClient,configureApiSession} from '../src/api/client';
import {mobileRepo} from '../src/api/mobileRepository';

const [owner,facilityId,reservationId,otherReservationId,staffId,skuOne,skuTwo,otherSku]=
  ['1','2','3','4','5','6','7','8'].map(value=>value.repeat(24)) as [string,string,string,string,string,string,string,string];
const response=(data:unknown)=>({success:true,data});
const reservation={_id:reservationId,customerId:owner,facilityId,reservationCode:'MI-001',serviceType:'MANAGED_INVENTORY',
  bookingFlowVersion:3,status:'ACTIVE',rentalPaymentFlow:'FULL_UPFRONT_V1',startDate:'2026-01-01T00:00:00.000Z',
  endDate:'2027-01-01T00:00:00.000Z',allocatedCellIds:[],handoverAt:'2026-11-18T10:00:00.000Z',handoverByStaffId:staffId};
const sku=(id:string,managedReservationId:string,itemCode:string)=>({_id:id,customerId:owner,managedReservationId,
  facilityId,inventorySchemaVersion:3,itemCode,name:itemCode,status:'ACTIVE',revision:1,currentCellId:null});
const savedAdapter=apiClient.defaults.adapter;

beforeEach(()=>configureApiSession('phase4-fixture'));
afterEach(()=>{apiClient.defaults.adapter=savedAdapter;configureApiSession();});

test('reservation inventory loads every Backend page and excludes SKUs from another reservation',async()=>{
  const requestedPages:number[]=[];
  apiClient.defaults.adapter=async config=>{
    if(config.url==='/reservations/managed/'+reservationId)return {config,status:200,statusText:'OK',headers:{},data:response(reservation)};
    if(config.url==='/inventory-items/me'){
      const page=Number(config.params?.page);requestedPages.push(page);
      expect(config.params?.limit).toBe(100);
      return {config,status:200,statusText:'OK',headers:{},data:{success:true,
        data:page===1?[sku(skuOne,reservationId,'BOX-A'),sku(otherSku,otherReservationId,'BOX-X')]:[sku(skuTwo,reservationId,'BOX-B')],
        pagination:{page,limit:100,total:3,totalPages:2}}};
    }
    throw new Error(`Unexpected request ${config.url}`);
  };
  await expect(mobileRepo.inventoryForReservation(owner,reservationId)).resolves.toMatchObject({
    reservation:{_id:reservationId,customerId:owner},items:[{_id:skuOne},{_id:skuTwo}],pagination:{total:2,totalPages:1},
  });
  expect(requestedPages.sort()).toEqual([1,2]);
});

test('switching reservation filters the destination dataset and rejects another customer SKU',async()=>{
  const secondReservation={...reservation,_id:otherReservationId,reservationCode:'MI-002'};
  apiClient.defaults.adapter=async config=>{
    if(config.url==='/reservations/managed/'+reservationId)return {config,status:200,statusText:'OK',headers:{},data:response(reservation)};
    if(config.url==='/reservations/managed/'+otherReservationId)return {config,status:200,statusText:'OK',headers:{},data:response(secondReservation)};
    if(config.url==='/inventory-items/me')return {config,status:200,statusText:'OK',headers:{},data:{success:true,
      data:[sku(skuOne,reservationId,'BOX-A'),sku(skuTwo,otherReservationId,'BOX-B')],pagination:{page:1,limit:100,total:2,totalPages:1}}};
    throw new Error(`Unexpected request ${config.url}`);
  };
  const first=await mobileRepo.inventoryForReservation(owner,reservationId);
  const second=await mobileRepo.inventoryForReservation(owner,otherReservationId);
  expect(first.items.map(row=>row._id)).toEqual([skuOne]);
  expect(second.items.map(row=>row._id)).toEqual([skuTwo]);
  expect(first.reservation._id).toBe(reservationId);
  expect(second.reservation._id).toBe(otherReservationId);

  apiClient.defaults.adapter=async config=>{
    if(config.url==='/reservations/managed/'+reservationId)return {config,status:200,statusText:'OK',headers:{},data:response(reservation)};
    if(config.url==='/inventory-items/me')return {config,status:200,statusText:'OK',headers:{},data:{success:true,
      data:[{...sku(otherSku,reservationId,'FOREIGN'),customerId:staffId}],pagination:{page:1,limit:100,total:1,totalPages:1}}};
    throw new Error(`Unexpected request ${config.url}`);
  };
  await expect(mobileRepo.inventoryForReservation(owner,reservationId)).rejects.toThrow();
});

test('reservation inventory requires a verified Staff handover before loading SKUs',async()=>{
  let inventoryRequested=false;
  apiClient.defaults.adapter=async config=>{
    if(config.url==='/reservations/managed/'+reservationId)return {config,status:200,statusText:'OK',headers:{},data:response({...reservation,handoverAt:undefined,handoverByStaffId:undefined})};
    inventoryRequested=true;
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:[],pagination:{page:1,limit:100,total:0,totalPages:0}}};
  };
  await expect(mobileRepo.inventoryForReservation(owner,reservationId)).rejects.toThrow('đã được cơ sở bàn giao');
  expect(inventoryRequested).toBe(false);
});

test('reservation inventory rejects a SKU mapped to a different Facility',async()=>{
  apiClient.defaults.adapter=async config=>{
    if(config.url==='/reservations/managed/'+reservationId)return {config,status:200,statusText:'OK',headers:{},data:response(reservation)};
    if(config.url==='/inventory-items/me')return {config,status:200,statusText:'OK',headers:{},data:{success:true,
      data:[{...sku(skuOne,reservationId,'BOX-A'),facilityId:otherReservationId}],pagination:{page:1,limit:100,total:1,totalPages:1}}};
    throw new Error(`Unexpected request ${config.url}`);
  };
  await expect(mobileRepo.inventoryForReservation(owner,reservationId)).rejects.toThrow('Mặt hàng không thuộc cơ sở');
});
