import {apiClient,configureApiSession} from '../src/api/client';
import {managedInventory} from '../src/api/managedInventory';
import {managedCellState} from '../src/domain/managedCellSelection';

const [facilityId,zoneId,rackId,cellId,otherCellId,ruleId]=['1','2','3','4','5','6'].map(value=>value.repeat(24)) as [string,string,string,string,string,string];
const range={startDate:'2099-01-01T00:00:00.000Z',endDate:'2099-02-01T00:00:00.000Z'};
const facility={_id:facilityId,name:'Kho Hà Nội',serviceTypes:['MANAGED_INVENTORY'],address:{line1:'Phố Mẫu',district:'Ba Đình',city:'Hà Nội'},images:[],description:'Kho ký gửi'};
const quote={facilityId,cellIds:[cellId],allocatedCapacityM3:1,startDate:range.startDate,endDate:range.endDate,
  term:{unit:'MONTH',value:1},availableCapacityM3:2,bookingFlowVersion:3,taxAmount:0,
  pricing:{ruleId,version:2,billingBasis:'PER_M3',ratePerM3:50000,currency:'VND',estimatedRent:50000},
  payment:{purpose:'FULL_RENT',amount:50000,currency:'VND'}};
const originalAdapter=apiClient.defaults.adapter;
const ok=(data:unknown)=>({success:true,data});
function reply(handler:(url:string,params:unknown)=>unknown){
  apiClient.defaults.adapter=async config=>({config,status:200,statusText:'OK',headers:{},data:handler(config.url??'',config.params)});
}
beforeEach(()=>configureApiSession('fixture-token'));
afterEach(()=>{apiClient.defaults.adapter=originalAdapter;configureApiSession();});

test('facility discovery asks the public Backend catalog to filter Managed Inventory',async()=>{
  reply((url,params)=>{
    if(url==='/public/facilities'){
      expect(params).toEqual({page:1,limit:20,serviceType:'MANAGED_INVENTORY',search:'Hà Nội'});
      return {...ok([facility]),pagination:{page:1,limit:20,total:1,totalPages:1}};
    }
    return ok({...facility,serviceTypes:['SELF_STORAGE']});
  });
  await expect(managedInventory.facilities(1,'Hà Nội')).resolves.toMatchObject({items:[facility],pagination:{total:1}});
  await expect(managedInventory.facility(facilityId)).rejects.toThrow('Cơ sở không hỗ trợ kho ký gửi');
});

test('Facility Detail, Warehouse Map and Rack Detail remain scoped to the selected Facility',async()=>{
  let call=0;
  reply(url=>{
    call++;
    if(url==='/public/facilities/'+facilityId)return ok(facility);
    if(url==='/warehouse-map')return ok({facilityId,requestedInterval:range,zones:[{_id:zoneId,code:'Z1',name:'Khu A',aisles:[{aisleCode:'A',racks:[{
      _id:rackId,rackCode:'R1',mapX:0,mapY:0,orientation:0,dimensions:{widthM:2,depthM:1,heightM:2},
    }]}]}]});
    if(url==='/racks/'+rackId+'/detail-map')return ok({rack:{_id:rackId,zoneId,facilityId,rackCode:'R1',operationalStatus:'AVAILABLE'},requestedInterval:range,levels:[{
      levelNumber:1,cells:[{_id:cellId,code:'C1',cellNumber:1,dimensions:{widthM:1,depthM:1,usableHeightM:1},
        operationalStatus:'AVAILABLE',periodStatus:'AVAILABLE',displayStatus:'AVAILABLE',isBookable:true,physicalUsageKnown:true,
        usedWeightKg:0,usedVolumeM3:0,maxWeightKg:100,maxVolumeM3:1}],
    }]});
    throw Error('Unexpected API request '+url);
  });
  await expect(managedInventory.facility(facilityId)).resolves.toMatchObject({serviceTypes:['MANAGED_INVENTORY']});
  await expect(managedInventory.map(facilityId,range)).resolves.toMatchObject({facilityId,zones:[{_id:zoneId}]});
  const detail=await managedInventory.rack(facilityId,zoneId,rackId,range);
  expect(detail.levels[0]?.cells[0]?._id).toBe(cellId);
  expect(managedCellState(detail.levels[0]!.cells[0]!,true,true).selectable).toBe(true);
  expect(call).toBe(3);
});

test('quote response must match Facility, Cells, period and configured capacity',async()=>{
  reply((url,params)=>{
    expect(url).toBe('/reservations/managed/quote');
    expect(params).toBeUndefined();
    return ok(quote);
  });
  const request={facilityId,startDate:range.startDate,term:{unit:'MONTH' as const,value:1},allocatedCapacityM3:1,cellIds:[cellId]};
  await expect(managedInventory.quote(request,range)).resolves.toMatchObject({bookingFlowVersion:3,payment:{purpose:'FULL_RENT',amount:50000}});
  reply(()=>ok({...quote,cellIds:[otherCellId]}));
  await expect(managedInventory.quote(request,range)).rejects.toThrow();
  reply(()=>ok({...quote,allocatedCapacityM3:2}));
  await expect(managedInventory.quote(request,range)).rejects.toThrow();
});
