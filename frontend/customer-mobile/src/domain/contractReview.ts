import type {z} from 'zod';
import type {contractDto} from '../api/contracts/documents';
import type {ReservationDto} from '../api/contracts/customer';

export type ReviewContract=z.infer<typeof contractDto>;
export const contractText=(value:unknown)=>typeof value==='string'&&value.trim()?value:undefined;

export function reviewDocument(contract:ReviewContract){
  const content=contractText(contract.content);
  const terms=Array.isArray(contract.terms)?contract.terms.filter((value):value is string=>!!contractText(value)):[];
  let pdf:string|undefined;
  if(typeof contract.pdfUrl==='string'){
    try{
      const url=new URL(contract.pdfUrl);
      if(url.protocol==='https:'&&!url.username&&!url.password)pdf=url.href;
    }catch{/* Unusable document URL. */}
  }
  return {content,terms,pdf,available:!!content||terms.length>0||!!pdf};
}

export function reviewFingerprint(contract:ReviewContract,rental:ReservationDto){
  const {content,terms,pdf}=reviewDocument(contract);
  return JSON.stringify([contract._id,contract.contractCode,contract.termsVersion,contract.updatedAt,
    content,terms,pdf,contract.customerSnapshot,contract.pricingSnapshot,rental._id,rental.startDate,rental.endDate,
    rental.facilityId,rental.storageUnitId]);
}
