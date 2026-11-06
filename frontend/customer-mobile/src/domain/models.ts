export type Service='SELF_STORAGE'|'MANAGED_INVENTORY';
export type RentalStatus='ACTIVE'|'RESERVED'|'CLOSED';
export interface Customer {id:string;name:string;email:string;phone:string;initials:string;}
export interface Facility {id:string;name:string;district:string;address:string;services:Service[];priceFrom:number;illustration:'south'|'east'|'airport';description:string;}
export interface Rental {id:string;code:string;facilityId:string;service:Service;unit:string;status:RentalStatus;start:string;end:string;monthlyPrice:number;capacityLabel:string;note:string;}
export interface Stock {onHand:number;held:number;available:number;}
export interface InventoryItem {id:string;code:string;name:string;category:string;unit:string;registeredQuantity:number;status:'IN_STORAGE'|'REGISTERED';cell:string|null;stock:Stock|null;}
export interface Fixtures {customer:Customer|null;facilities:Facility[];rentals:Rental[];items:InventoryItem[];}
export const serviceLabel=(service:Service)=>service==='SELF_STORAGE'?'Kho tự quản':'Kho ký gửi';
export const money=(amount:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(amount);
export const shortDate=(iso:string)=>new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(iso));
export function verifiedFixtureStock(stock:Stock|null):Stock|null {
  return stock&&[stock.onHand,stock.held,stock.available].every(n=>Number.isSafeInteger(n)&&n>=0)&&stock.held<=stock.onHand&&stock.available===stock.onHand-stock.held?stock:null;
}
