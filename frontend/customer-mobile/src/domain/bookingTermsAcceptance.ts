export function selfBookingTermsAcceptanceKey(versionId:string|undefined,context:{facilityId:string;unitId:string;start:string;termKey:string;quote?:{body:unknown;estimate:unknown}|null}){
  if(!versionId||!context.start||!context.termKey||!context.quote)return '';
  return JSON.stringify([versionId,context.facilityId,context.unitId,context.start,context.termKey,context.quote.body,context.quote.estimate]);
}
