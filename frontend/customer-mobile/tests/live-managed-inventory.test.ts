import {AxiosError,type InternalAxiosRequestConfig} from 'axios';
import {apiClient,configureApiSession} from '../src/api/client';
import {managedInventory,type ManagedCell} from '../src/api/managedInventory';
import {mobileRepo} from '../src/api/mobileRepository';
import {warehouseRackLayout} from '../src/domain/warehouseRackLayout';
import {managedCellState} from '../src/domain/managedCellSelection';

const [facilityId,zoneId,rackId,cellId,other,owner,reservationId]='1234567'.split('').map(value=>value.repeat(24)) as [string,string,string,string,string,string,string];
const startDate='2099-01-31T00:00:00.000Z',endDate='2099-02-28T00:00:00.000Z';
const range={startDate,endDate};
const body={facilityId,startDate,term:{unit:'MONTH',value:1},allocatedCapacityM3:0.24,cellIds:[cellId]};
const cell:ManagedCell={_id:cellId,code:'R01-1',cellNumber:1,dimensions:{widthM:.6,depthM:.4,usableHeightM:1},maxVolumeM3:.24,
  maxWeightKg:100,usedWeightKg:0,usedVolumeM3:0,operationalStatus:'AVAILABLE',periodStatus:'AVAILABLE',displayStatus:'AVAILABLE',
  isBookable:true,physicalUsageKnown:true};
const rack={_id:rackId,zoneId,facilityId,rackCode:'R01',operationalStatus:'AVAILABLE'};
const quote={...body,endDate,bookingFlowVersion:2,availableCapacityM3:4,
  pricing:{ruleId:other,version:1,billingBasis:'PER_M3',ratePerM3:100000,currency:'VND',estimatedRent:24000},
  deposit:{policyId:other,version:1,calculation:'PERCENT_OF_RENT',percentage:10,amount:2400},taxAmount:0,
  paymentBreakdown:{totalDue:24000,depositCredit:2400,balanceDue:21600}};
const pagination={page:1,limit:20,total:1,totalPages:1};
const env=(data:unknown)=>({success:true,data});
const saved=apiClient.defaults.adapter;
function fixture(load:(request:InternalAxiosRequestConfig)=>unknown){
  const adapter=jest.fn(async (config:InternalAxiosRequestConfig)=>({config,data:load(config),status:200,statusText:'OK',headers:{}}));
  apiClient.defaults.adapter=adapter;
  return adapter;
}
function http(config:InternalAxiosRequestConfig,status:number){
  throw new AxiosError('Fixture HTTP','ERR_BAD_RESPONSE',config,undefined,{config,status,statusText:'Error',headers:{},data:{}});
}
beforeEach(()=>configureApiSession('managed-fixture'));
afterEach(()=>{configureApiSession();apiClient.defaults.adapter=saved;});

test('public MI discovery filters server-side and rejects a Self Storage facility in the response',async()=>{
  const row={_id:facilityId,name:'Kho thử',address:{city:'Hà Nội'},serviceTypes:['MANAGED_INVENTORY']};
  const mock=fixture(c=>{
    expect(c.headers.get('Authorization')).toBeUndefined();
    expect(c.params).toEqual({page:1,limit:20,serviceType:'MANAGED_INVENTORY',search:'Hà Nội'});
    return {...env([row]),pagination};
  });
  await expect(managedInventory.facilities(1,'Hà Nội')).resolves.toMatchObject({items:[{_id:facilityId}]});
  expect(mock.mock.calls[0]?.[0].url).toBe('/public/facilities');
  fixture(()=>({...env([{...row,serviceTypes:['SELF_STORAGE']}]),pagination}));
  await expect(managedInventory.facilities(1,'')).rejects.toThrow();
});

test('managed terms use effective PER_M3 rules and capacity requires the same date range',async()=>{
  fixture(c=>{
    expect(c.headers.get('Authorization')).toBe('Bearer managed-fixture');
    if(c.url==='/pricing-rules'){
      expect(c.params).toMatchObject({facilityId,serviceType:'MANAGED_INVENTORY',billingBasis:'PER_M3',isActive:true});
      const rule={facilityId,serviceType:'MANAGED_INVENTORY',billingBasis:'PER_M3',isActive:true,term:body.term,price:100000,currency:'VND',effectiveFrom:'2098-01-01T00:00:00Z'};
      return {...env([rule,{...rule,term:{unit:'DAY',value:3},effectiveTo:startDate}]),pagination:{...pagination,total:2,limit:100}};
    }
    expect(c.params).toEqual(range);
    return env({facilityId,interval:range,availableCapacityM3:0.5,sellableCapacityM3:4});
  });
  expect(await managedInventory.terms(facilityId,'2099-01-31')).toEqual([body.term]);
  await expect(managedInventory.capacity(facilityId,range)).resolves.toMatchObject({availableCapacityM3:.5});
  fixture(()=>env({facilityId,interval:{...range,endDate:'2099-03-01T00:00:00.000Z'},availableCapacityM3:4,sellableCapacityM3:4}));
  await expect(managedInventory.capacity(facilityId,range)).rejects.toThrow();
});

test('rack data must echo the range, facility, rack and zone; an empty topology stays empty',async()=>{
  fixture(c=>{
    expect(c.params).toEqual(c.url==='/warehouse-map'?{facilityId,...range}:range);
    if(c.url==='/warehouse-map')return env({facilityId,requestedInterval:range,zones:[]});
    return env({rack,requestedInterval:range,levels:[{levelNumber:1,cells:[cell]}]});
  });
  expect((await managedInventory.map(facilityId,range)).zones).toEqual([]);
  expect((await managedInventory.rack(facilityId,zoneId,rackId,range)).levels[0]?.cells[0]?.code).toBe(cell.code);
  await expect(managedInventory.rack(facilityId,other,rackId,range)).rejects.toThrow();
  fixture(()=>env({rack,levels:[]}));
  await expect(managedInventory.rack(facilityId,zoneId,rackId,range)).rejects.toThrow();
});

test('period precedence and verified bookability fail closed for unknown, occupied, held and maintenance cells',()=>{
  expect(managedCellState(cell,true,true).selectable).toBe(true);
  expect(managedCellState(cell,false,true).selectable).toBe(false);
  for(const delta of [{periodStatus:'RESERVED',isMine:true},{periodStatus:'OCCUPIED'},{operationalStatus:'MAINTENANCE'},
    {operationalStatus:'BLOCKED'},{periodStatus:undefined},{isBookable:undefined},{physicalUsageKnown:false},{usedVolumeM3:.02},{maxVolumeM3:null}]){
    expect(managedCellState({...cell,...delta},true,true).selectable).toBe(false);
  }
  expect(managedCellState(cell,true,false).selectable).toBe(false);
});

test('only the V2 quote is accepted; mismatched interval, insufficient capacity and V1 are rejected',async()=>{
  const adapter=fixture(c=>{
    expect(c.url).toBe('/reservations/managed/quote');
    expect(c.method).toBe('post');
    expect(JSON.parse(c.data)).toEqual(body);
    return env(quote);
  });
  await expect(managedInventory.quote(body,range)).resolves.toMatchObject({paymentBreakdown:{totalDue:24000}});
  expect(adapter).toHaveBeenCalledTimes(1);
  for(const changed of [{bookingFlowVersion:undefined},{endDate:'2099-03-01T00:00:00.000Z'},{availableCapacityM3:.1}]){
    fixture(()=>env({...quote,...changed}));
    await expect(managedInventory.quote(body,range)).rejects.toThrow();
  }
  expect(managedInventory).not.toHaveProperty('create');
});

test.each([401,403,404,409,422,502,503])('API HTTP %s is exposed without fixture or write fallback',async status=>{
  const adapter=fixture(c=>http(c,status));
  await expect(managedInventory.quote(body,range)).rejects.toMatchObject({response:{status}});
  expect(adapter).toHaveBeenCalledTimes(1);
});

test('inventory owner, empty page and stock source are preserved without inventing physical units or availability',async()=>{
  const item={_id:cellId,customerId:owner,managedReservationId:reservationId,facilityId,itemCode:'MI-01',name:'Hàng thử',
    category:'Thùng',quantity:2,quantityUnit:'kiện',unitWeightKg:1,unitDimensionsM:{widthM:.1,depthM:.1,heightM:.1},status:'IN_STORAGE'};
  fixture(c=>c.url==='/inventory-items/me'?{...env([item]),pagination}:env({itemId:cellId,customerId:owner,
    managedReservationId:reservationId,facilityId,currentCellId:null,schemaVersion:1,source:'LEGACY_RECONCILED',version:0,onHandQuantity:0,
    heldQuantity:0,actualTotalWeightKg:0,actualTotalVolumeM3:0,batches:[]}));
  const page=await mobileRepo.inventory(owner);
  expect(page.items[0]?.quantity).toBe(2);
  await expect(mobileRepo.stock(page.items[0]!,owner)).resolves.toMatchObject({source:'LEGACY_RECONCILED',onHandQuantity:0,heldQuantity:0,availableQuantity:undefined});
  await expect(mobileRepo.inventory(other)).rejects.toThrow();
  fixture(()=>({...env([]),pagination:{...pagination,total:0,totalPages:0}}));
  await expect(mobileRepo.inventory(owner)).resolves.toMatchObject({items:[]});
  fixture(c=>http(c,401));
  await expect(mobileRepo.inventory(owner)).rejects.toMatchObject({response:{status:401}});
});

test('2D rack aligns column positions across levels and leaves sparse gaps without creating cells',()=>{
  const top={...cell,_id:other,cellNumber:3};
  const result=warehouseRackLayout([{levelNumber:1,cells:[cell]},{levelNumber:3,cells:[top]}],4);
  expect(result?.columns).toBe(4);
  expect(result?.rows.map(row=>row.levelNumber)).toEqual([3,1]);
  expect(result?.rows[0]?.byPosition.get(3)).toBe(top);
  expect(result?.rows[0]?.byPosition.has(1)).toBe(false);
  expect(result?.rows[1]?.byPosition.get(1)).toBe(cell);
});

test('ambiguous or missing rack coordinates stay visible as a read-only fallback',async()=>{
  const noPosition={...cell,cellNumber:undefined};
  fixture(()=>env({rack,requestedInterval:range,levels:[{levelNumber:1,cells:[noPosition]}]}));
  const result=await managedInventory.rack(facilityId,zoneId,rackId,range);
  expect(result.levels[0]?.cells[0]?._id).toBe(cellId);
  expect(warehouseRackLayout(result.levels)).toBeNull();
  expect(warehouseRackLayout([{levelNumber:undefined,cells:[cell]}])).toBeNull();
  expect(warehouseRackLayout([{levelNumber:1,cells:[cell,{...cell,_id:other}]}])).toBeNull();
  expect(warehouseRackLayout([{levelNumber:1,cells:[{...cell,cellNumber:10000}]}])).toBeNull();
  expect(warehouseRackLayout([{levelNumber:1,cells:[{...cell,cellNumber:3}]}],2)).toBeNull();
  expect(warehouseRackLayout([])?.rows).toEqual([]);
});
