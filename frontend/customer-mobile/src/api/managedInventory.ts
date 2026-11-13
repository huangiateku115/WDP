import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {instant,nonnegative,objectId,positive,readData,readPage,refId,whole} from './contracts/core';
import {day,managedBookingBody,mapManagedQuote,mapWarehouse,term,utc} from './contracts/booking';
import {mapFacilities,mapReservation} from './contracts/customer';
import {mobileRepo} from './mobileRepository';

export type ManagedRange={startDate:string;endDate:string};
const interval=z.object({startDate:utc,endDate:utc});
const dims=z.object({widthM:positive,depthM:positive,usableHeightM:positive.optional()});
const cellSchema=z.object({_id:objectId,code:z.string().min(1),cellNumber:whole.min(1).nullish().catch(undefined),dimensions:dims,
  operationalStatus:z.string().optional(),periodStatus:z.string().optional(),displayStatus:z.string().optional(),isBookable:z.boolean().optional(),
  physicalUsageKnown:z.boolean().optional(),isMine:z.boolean().optional(),hasMyInventory:z.boolean().optional(),
  maxWeightKg:nonnegative.optional(),maxVolumeM3:positive.nullish(),usedWeightKg:nonnegative.optional(),usedVolumeM3:nonnegative.optional()});
const rackSchema=z.object({rack:z.object({_id:objectId,zoneId:objectId,facilityId:objectId,rackCode:z.string().min(1),
  operationalStatus:z.string(),cellsPerLevel:whole.min(1).optional()}),requestedInterval:interval.optional(),
  levels:z.array(z.object({levelNumber:whole.min(1).nullish().catch(undefined),cells:z.array(cellSchema)}))});
const priceRule=z.object({facilityId:objectId,serviceType:z.literal('MANAGED_INVENTORY'),billingBasis:z.literal('PER_M3'),
  term,isActive:z.boolean(),effectiveFrom:instant,effectiveTo:instant.nullish(),price:positive,currency:z.string().regex(/^[A-Z]{3}$/)});
const capacitySchema=z.object({facilityId:objectId,interval,availableCapacityM3:nonnegative,sellableCapacityM3:nonnegative});

export type ManagedCell=z.infer<typeof cellSchema>;
export type ManagedRackLevel=z.infer<typeof rackSchema>['levels'][number];
export type ManagedTerm=z.infer<typeof term>;
export type ManagedQuote=ReturnType<typeof mapManagedQuote>;
const id=(value:string)=>objectId.parse(value);
const validateRange=(actual:ManagedRange|undefined,expected?:ManagedRange)=>{
  if(expected?(!actual||actual.startDate!==expected.startDate||actual.endDate!==expected.endDate):!!actual){
    throw new MobileInputError('Dữ liệu không khớp với kỳ thuê đang xem.');
  }
};

export const managedInventory={
  async facilities(page:number,search:string,signal?:AbortSignal){
    const result=mapFacilities(await wire('GET','/public/facilities',{anonymous:true,params:{
      page,limit:20,serviceType:'MANAGED_INVENTORY',...(search?{search}:{}),
    },signal}));
    if(result.pagination.page!==page||result.items.some(row=>!row.serviceTypes.includes('MANAGED_INVENTORY'))){
      throw new MobileInputError('Danh sách cơ sở không khớp với dịch vụ kho ký gửi.');
    }
    return result;
  },
  async facility(facilityId:string,signal?:AbortSignal){
    const result=await mobileRepo.facility(facilityId,signal);
    if(!result.serviceTypes.includes('MANAGED_INVENTORY'))throw new MobileInputError('Cơ sở không hỗ trợ kho ký gửi.');
    return result;
  },
  async rental(reservationId:string,owner:string,facilityId:string,signal?:AbortSignal){
    const r=mapReservation(await wire('GET','/reservations/managed/'+id(reservationId),{signal}),owner);
    if(r._id!==reservationId||refId(r.facilityId)!==facilityId||r.serviceType!=='MANAGED_INVENTORY')throw new MobileInputError('Đơn thuê không khớp.');
    return r;
  },
  async terms(facilityId:string,start:string,signal?:AbortSignal){
    const at=Date.parse(day.parse(start)+'T00:00:00Z');
    const options=new Map<string,ManagedTerm>();
    for(let page=1;page<=100;page++){
      const result=readPage(priceRule,await wire('GET','/pricing-rules',{params:{facilityId:id(facilityId),
        serviceType:'MANAGED_INVENTORY',billingBasis:'PER_M3',isActive:true,page,limit:100},signal}));
      if(result.pagination.page!==page)throw new MobileInputError('Trang bảng giá không khớp.');
      for(const rule of result.items){
        if(rule.facilityId!==facilityId)throw new MobileInputError('Bảng giá không thuộc cơ sở này.');
        if(rule.isActive&&Date.parse(rule.effectiveFrom)<=at&&(!rule.effectiveTo||at<Date.parse(rule.effectiveTo))){
          options.set(rule.term.unit+':'+rule.term.value,rule.term);
        }
      }
      if(page>=result.pagination.totalPages)return [...options.values()].sort((a,b)=>a.value-b.value);
    }
    throw new MobileInputError('Chưa tải được toàn bộ kỳ hạn.');
  },
  async map(facilityId:string,range?:ManagedRange,signal?:AbortSignal){
    const map=mapWarehouse(await wire('GET','/warehouse-map',{params:{facilityId:id(facilityId),...range},signal}),facilityId);
    validateRange(map.requestedInterval,range);
    return map;
  },
  async rack(facilityId:string,zoneId:string,rackId:string,range?:ManagedRange,signal?:AbortSignal){
    const detail=readData(rackSchema,await wire('GET','/racks/'+id(rackId)+'/detail-map',{params:range,signal}));
    if(detail.rack._id!==rackId||detail.rack.facilityId!==facilityId||detail.rack.zoneId!==zoneId)throw new MobileInputError('Sơ đồ kệ không khớp với cơ sở và khu vực.');
    validateRange(detail.requestedInterval,range);
    const cells=detail.levels.flatMap(level=>level.cells);
    if(new Set(cells.map(cell=>cell._id)).size!==cells.length){
      throw new MobileInputError('Không thể xác minh định danh các ô trong sơ đồ.');
    }
    return detail;
  },
  async capacity(facilityId:string,range:ManagedRange,signal?:AbortSignal){
    const result=readData(capacitySchema,await wire('GET','/reservations/managed/capacity/'+id(facilityId),{params:range,signal}));
    if(result.facilityId!==facilityId)throw new MobileInputError('Sức chứa không thuộc cơ sở này.');
    validateRange(result.interval,range);
    return result;
  },
  async quote(input:unknown,range:ManagedRange,signal?:AbortSignal){
    const body=managedBookingBody(input);
    if(body.startDate!==range.startDate)throw new MobileInputError('Kỳ thuê không khớp với yêu cầu báo giá.');
    const response=await wire('POST','/reservations/managed/quote',{body,signal});
    const quote=mapManagedQuote(response);
    validateRange(quote,range);
    if(quote.bookingFlowVersion===3 &&
      (new Set(quote.cellIds).size!==body.cellIds.length || quote.cellIds.length!==body.cellIds.length ||
        quote.cellIds.some(cellId=>!body.cellIds.includes(cellId)))) {
      throw new MobileInputError('Báo giá không khớp danh sách ô đã chọn.');
    }
    if(quote.facilityId!==body.facilityId||quote.allocatedCapacityM3!==body.allocatedCapacityM3||
      quote.term.unit!==body.term.unit||quote.term.value!==body.term.value||quote.availableCapacityM3<body.allocatedCapacityM3){
      throw new MobileInputError('Báo giá không khớp với kỳ thuê hoặc các ô đã chọn.');
    }
    return quote;
  },
};
