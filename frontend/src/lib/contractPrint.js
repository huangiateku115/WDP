import {reservationVietnamTime} from './customerReservationDisplay.js';

const id=value=>typeof value==='string'?value:value?._id||value?.id;
const validId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export const printText=value=>typeof value==='string'&&value.trim()?value:typeof value==='number'&&Number.isFinite(value)?String(value):'Chưa được cung cấp';
export const printDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?reservationVietnamTime(value):'Chưa được cung cấp';
const firstNumber=(...values)=>values.find(v=>typeof v==='number'&&Number.isFinite(v));
const firstText=(...values)=>values.find(v=>typeof v==='string'&&v.trim());
function address(value){if(typeof value==='string')return value;const v=object(value);return ['line1','ward','district','city','country'].map(k=>v[k]).filter(x=>typeof x==='string'&&x.trim()).join(', ');}

// Presentation only. Do not calculate prices, regenerate hashes, or mutate a snapshot.
export function contractPrintModel(contract,{contractId,reservationId,customerId,v2=false}){
  if(!contract||!validId(contractId)||id(contract)!==contractId||!validId(customerId)||id(contract.customerId)!==customerId||!validId(reservationId)||id(contract.reservationId)!==reservationId)throw Error('Không thể xác minh hợp đồng thuộc tài khoản và đặt chỗ hiện tại.');
  const live=object(contract.reservationId),versioned=v2||contract.currentContentVersion!=null||contract.termsVersion==='MI-V2-1';
  let active=null;
  if(versioned){
    const matches=Array.isArray(contract.contentVersions)?contract.contentVersions.filter(v=>v?.version===contract.currentContentVersion):[];
    if(!Number.isSafeInteger(contract.currentContentVersion)||contract.currentContentVersion<1||matches.length!==1||!/^[a-f\d]{64}$/i.test(matches[0].contentHash)||!matches[0].content||typeof matches[0].content!=='object'||Array.isArray(matches[0].content))throw Error('Không xác minh được phiên bản nội dung hiện tại. Vui lòng tải lại hợp đồng.');
    active=matches[0];
    if(active.content.reservation?.id!==reservationId)throw Error('Snapshot không khớp với đặt chỗ của hợp đồng.');
  }
  const content=object(active?.content),r=active?object(content.reservation):live,p=active?object(content.pricing):object(contract.pricingSnapshot),breakdown=object(p.amountBreakdown),customer=object(contract.customerSnapshot),facility=active?object(content.facility):object(live.facilityId),facilityId=id(r.facilityId)||id(live.facilityId);
  const currency=firstText(object(p.pricingRule).currency,p.currency);
  const money=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:21}).format(value)+(currency?' '+currency:' (chưa có đơn vị tiền tệ)'):'Chưa được cung cấp';
  const validSignature=s=>s&&s.version===active?.version&&s.contentHash===active?.contentHash&&validId(id(s.signerId))&&typeof s.signedAt==='string'&&Number.isFinite(Date.parse(s.signedAt));
  const signatures=Array.isArray(contract.signatures)?contract.signatures:[],current=active?signatures.filter(validSignature):[];
  const customerSignature=current.find(s=>s.signerRole==='CUSTOMER'&&id(s.signerId)===customerId),facilitySignature=current.find(s=>['FACILITY_STAFF','FACILITY_MANAGER'].includes(s.signerRole));
  const signInfo=(signature,legacyDate)=>active?signature?{label:'Có bản ghi ký khớp phiên bản và hash hiện tại',date:signature.signedAt,id:id(signature.signerId),role:signature.signerRole}:{label:'Chưa có bản ghi ký hợp lệ cho phiên bản hiện tại'}:typeof legacyDate==='string'&&Number.isFinite(Date.parse(legacyDate))?{label:'Có dấu thời gian ký được Backend ghi nhận',date:legacyDate}:{label:'Chưa có thông tin ký được cung cấp'};
  const rawTerms=active?content.terms:contract.terms;
  const terms=Array.isArray(rawTerms)?rawTerms.filter(t=>typeof t==='string'&&t.trim()):[];
  const textContent=!active&&typeof contract.content==='string'&&contract.content.trim()?contract.content:null;
  const noTerms=!terms.length&&!textContent;
  const warnings=[];
  if(noTerms)warnings.push('Đây là bản tóm tắt dữ liệu hợp đồng, không phải toàn bộ hợp đồng pháp lý. Backend chưa cung cấp nội dung điều khoản để in.');
  if(active&&signatures.some(s=>!validSignature(s)))warnings.push('Có bản ghi chữ ký không khớp phiên bản/hash hiện tại hoặc không đủ dữ liệu. Các bản ghi đó không được trình bày là chữ ký hợp lệ.');
  if(active&&contract.status==='SIGNED'&&(!customerSignature||!facilitySignature))warnings.push('Backend ghi trạng thái SIGNED nhưng chưa có đủ hai bản ghi ký khớp phiên bản hiện tại. Không thể xác nhận đã ký số đầy đủ từ dữ liệu này.');
  const cells=Array.isArray(r.cellIds)?r.cellIds:[];
  return {
    title:noTerms?'BẢN TÓM TẮT HỢP ĐỒNG THUÊ LƯU TRỮ':'HỢP ĐỒNG THUÊ LƯU TRỮ',warnings,
    code:contract.contractCode,createdAt:contract.createdAt,status:contract.status,version:active?.version,hash:active?.contentHash,termsVersion:contract.termsVersion,
    customer:{name:customer.fullName,email:customer.email,phone:customer.phone,address:address(customer.address),identityCard:customer.identityCard,taxCode:customer.taxCode},
    facility:{name:facility.name,code:facility.code,id:facilityId,address:address(facility.address),legalName:facility.legalName},
    rental:{code:r.code||r.reservationCode||live.reservationCode||reservationId,serviceType:live.serviceType||(versioned?'MANAGED_INVENTORY':undefined),startDate:r.startDate,endDate:r.endDate,unit:id(live.storageUnitId),capacity:firstNumber(p.quotaM3),cells:cells.map(c=>({id:id(c),volume:Array.isArray(p.selectedCells)?p.selectedCells.find(s=>id(s?.cellId)===id(c))?.volumeM3:undefined}))},
    amounts: (live.serviceType === 'SELF_STORAGE' || (!versioned && !p.quotaM3))
      ? [['Tổng tiền thanh toán theo snapshot', money(firstNumber(p.estimatedRent, breakdown.estimatedRent))]]
      : [['Tiền thuê theo snapshot',money(firstNumber(p.estimatedRent,breakdown.estimatedRent))],['Khoản cọc / trả trước theo snapshot',money(firstNumber(p.depositAmount,breakdown.depositAmount))],['Khoản trả trước được khấu trừ',money(firstNumber(p.depositCredit,breakdown.depositCredit))],['Số dư theo snapshot',money(firstNumber(p.balanceDue,breakdown.balanceDue))],['Thuế theo snapshot',money(firstNumber(p.taxAmount,breakdown.taxAmount))],['Giảm trừ theo snapshot',money(firstNumber(p.discountAmount,breakdown.discountAmount))],['Tổng phải trả theo snapshot',money(firstNumber(p.totalDue,breakdown.totalDue))]],
    terms,textContent,handover:Array.isArray(content.handover)?content.handover.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[],
    customerSignature:signInfo(customerSignature,contract.signedByCustomerAt),facilitySignature:signInfo(facilitySignature,contract.signedByFMAt),
    paper:contract.signedProofUrl?{number:contract.paperContractNumber,verifiedAt:contract.verifiedAt,verifiedBy:id(contract.verifiedByStaff)}:null,
  };
}
