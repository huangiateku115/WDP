import type {z} from 'zod';
import type {ReservationDto} from '../api/contracts/customer';
import type {contractDto,paymentDto} from '../api/contracts/documents';
import {refId} from '../api/contracts/core';
import {reviewDocument,contractText} from './contractReview';
import {applied} from './livePayment';

type Contract=z.infer<typeof contractDto>;
type Payment=z.infer<typeof paymentDto>;
type PaymentDecision='APPLIED'|'REVIEW'|'INELIGIBLE'|'READY'|'CREATE';
type Action={destination:'PAYMENT'|'CONTRACT';label:string;intent?:'SIGN'};
type StepState='COMPLETED'|'CURRENT'|'UPCOMING'|'BLOCKED'|'FAILED'|'SKIPPED';
type Mode='CUSTOMER_ACTION_REQUIRED'|'WAITING_FOR_SYSTEM'|'WAITING_FOR_STAFF'|'BLOCKED'|'COMPLETED';
export type ProgressStep={id:string;title:string;state:StepState;description:string};
export type ReservationProgress={summary:string;steps:ProgressStep[];next?:{mode:Mode;description:string;action?:Action}};
type Evidence={contract:Contract|null;payments:Payment[];decision:PaymentDecision};

const titles={booking:'Đặt kho',deposit:'Thanh toán tiền cọc',contract:'Ký hợp đồng',balance:'Thanh toán phần còn lại',handover:'Nhận kho'};
type StepId=keyof typeof titles;
const stepIds=Object.keys(titles) as StepId[];
const makeStep=(id:StepId,state:StepState,description:string):ProgressStep=>({id,title:titles[id],state,description});

function paymentState(rows:Payment[]){
  if(rows.some(p=>p.reconciliationRequired||p.status==='RECONCILIATION_REQUIRED'||p.applicationStatus==='MANUAL_REVIEW'||
    p.checkoutStatus==='UNKNOWN'||p.checkoutStatus==='RECONCILIATION_REQUIRED'))return 'REVIEW';
  if(rows.some(applied))return 'APPLIED';
  if(rows.some(p=>p.providerSettlementStatus==='VERIFIED'||p.status==='SUCCEEDED'||p.applicationStatus==='APPLIED'))return 'VERIFYING';
  if(rows.some(p=>p.status==='PENDING'))return rows.some(p=>p.status==='PENDING'&&p.checkoutStatus==='READY')?'READY':'PENDING';
  return rows.some(p=>p.status==='FAILED')?'FAILED':'NONE';
}

function balanceRequirement(r:ReservationDto,deposit:Payment|undefined){
  if(!deposit||typeof r.estimatedRent!=='number'||typeof r.depositAmount!=='number')return 'UNKNOWN';
  const tax=r.taxAmount??0,discount=r.discountAmount??0;
  if(typeof tax!=='number'||typeof discount!=='number')return 'UNKNOWN';
  const amounts=[r.estimatedRent,r.depositAmount,tax,discount];
  if(!amounts.every(n=>Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER))return 'UNKNOWN';
  const gross=r.estimatedRent+tax;
  const total=gross-discount;
  const rounded=(n:number)=>Math.floor(n+0.5);
  if(gross>Number.MAX_SAFE_INTEGER||total<r.depositAmount||rounded(r.depositAmount)!==deposit.amount)return 'UNKNOWN';
  return rounded(total)-deposit.amount>0?'REQUIRED':'ZERO';
}

function hasPaperProof(contract:Contract|null){
  return contract?.status==='SIGNED'&&typeof contract.signedProofUrl==='string'&&contract.signedProofUrl.trim()!==''&&
    typeof contract.signedProofPublicId==='string'&&contract.signedProofPublicId.trim()!==''&&
    typeof contract.verifiedAt==='string'&&Number.isFinite(Date.parse(contract.verifiedAt));
}

export function reservationProgress(r:ReservationDto,evidence?:Evidence,now=Date.now()):ReservationProgress|null{
  if(r.serviceType!=='SELF_STORAGE')return null;
  const expired=(r.status==='RESERVED'||r.status==='CONTRACTED')&&!!r.expiresAt&&Date.parse(r.expiresAt)<=now;
  const summary=expired?'Đã hết hạn giữ kho':r.status==='CANCELLED'&&r.rejectReason?'Đơn thuê đã bị từ chối':({
    RESERVED:'Đang chờ duyệt đặt kho',CONTRACTED:'Đang ở bước đặt cọc',DEPOSIT_PAID:'Đang ở bước hợp đồng giấy',
    CHECKIN_READY:'Đang ở bước xác minh số dư',PAID:'Đang chờ bàn giao kho',ACTIVE:'Kho đang hoạt động',
    OVERDUE:'Đơn thuê đã quá hạn',CHECKED_OUT:'Đã trả kho',CLOSED:'Đơn thuê đã đóng',CANCELLED:'Đơn thuê đã hủy',
  })[r.status];
  if(!evidence)return {summary,steps:[]};
  const steps=stepIds.map(id=>id==='booking'?makeStep(id,'COMPLETED','Máy chủ đã xác nhận đơn thuê.'):
    makeStep(id,'UPCOMING',id==='balance'?'Chỉ áp dụng khi có số dư đã xác minh.':'Chưa đến bước này.'));
  const set=(id:StepId,state:StepState,description:string)=>{steps[stepIds.indexOf(id)]=makeStep(id,state,description);};
  const finish=(id:StepId,state:StepState,mode:Mode,description:string,action?:Action):ReservationProgress=>{
    set(id,state,description);
    return {summary,steps,next:{mode,description,action}};
  };

  const {contract,payments,decision}=evidence;
  if(payments.some(p=>p.reservationId!==r._id)||contract&&
    (refId(contract.reservationId)!==r._id||refId(contract.customerId)!==refId(r.customerId))){
    return {summary,steps:[],next:{mode:'BLOCKED',description:'Chưa thể xác minh tiến độ của đơn thuê này.'}};
  }
  const deposits=payments.filter(p=>p.purpose==='DEPOSIT');
  const balances=payments.filter(p=>p.purpose==='BALANCE');
  const deposit=paymentState(deposits),balance=paymentState(balances);
  if(r.status==='CANCELLED'||expired||r.status==='CLOSED'||r.status==='CHECKED_OUT'){
    const terminalSteps=steps.map(s=>s.id==='booking'?s:{...s,state:'SKIPPED' as const,description:'Quy trình nhận kho đã kết thúc.'});
    const terminalPayments=([['deposit',deposit],['balance',balance]] as const);
    for(const [id,state] of terminalPayments){
      if(state==='APPLIED')terminalSteps[stepIds.indexOf(id)]=makeStep(id,'COMPLETED','Đã xác minh và ghi nhận khoản thanh toán.');
      if(state==='REVIEW'||state==='VERIFYING'||state==='PENDING'||state==='READY'){
        terminalSteps[stepIds.indexOf(id)]=makeStep(id,'BLOCKED','Giao dịch còn chờ xác minh hoặc đối soát.');
      }
      if(state==='FAILED')terminalSteps[stepIds.indexOf(id)]=makeStep(id,'FAILED','Giao dịch thất bại.');
    }
    if(hasPaperProof(contract))terminalSteps[stepIds.indexOf('contract')]=makeStep('contract','COMPLETED','Nhân viên đã xác minh bằng chứng hợp đồng giấy.');
    return {summary,steps:terminalSteps,next:{mode:'BLOCKED',description:summary}};
  }
  if(r.status==='RESERVED')return finish('deposit','BLOCKED','WAITING_FOR_STAFF','Đơn đang chờ cơ sở duyệt trước khi có thể đặt cọc.');

  const handedOver=r.status==='ACTIVE'||r.status==='OVERDUE';
  if(handedOver)set('handover','COMPLETED','Máy chủ đã xác nhận bàn giao kho.');
  if(hasPaperProof(contract))set('contract','COMPLETED','Nhân viên đã xác minh bằng chứng hợp đồng giấy.');
  if(balance==='APPLIED')set('balance','COMPLETED','Số dư đã được xác minh và ghi nhận.');
  if(deposit!=='APPLIED'){
    const action:Action={destination:'PAYMENT',label:'Xem trạng thái thanh toán'};
    if(deposit==='REVIEW'||decision==='REVIEW'&&deposit==='NONE'){
      return finish('deposit','BLOCKED','BLOCKED','Tiền cọc cần đối soát. Hãy kiểm tra giao dịch hiện có.',action);
    }
    if(deposit==='VERIFYING'||deposit==='PENDING'){
      return finish('deposit','CURRENT','WAITING_FOR_SYSTEM','Đang chờ máy chủ xác minh và ghi nhận tiền cọc.',action);
    }
    if(deposit==='FAILED')return finish('deposit','FAILED','BLOCKED','Giao dịch đặt cọc thất bại. Hãy kiểm tra trạng thái.',action);
    if(r.status==='CONTRACTED'&&(decision==='READY'||decision==='CREATE')){
      return finish('deposit','CURRENT','CUSTOMER_ACTION_REQUIRED',deposit==='READY'?'Liên kết đã sẵn sàng, đang chờ bạn thanh toán.':'Bạn cần thanh toán tiền cọc.',
        {destination:'PAYMENT',label:deposit==='READY'?'Xem liên kết thanh toán':'Thanh toán tiền cọc'});
    }
    return finish('deposit','BLOCKED','BLOCKED',!contract&&r.status==='CONTRACTED'?'Chưa có hợp đồng nháp để mở thanh toán.':'Chưa có đủ bằng chứng xác minh tiền cọc.',action);
  }
  set('deposit','COMPLETED','Tiền cọc đã được xác minh và ghi nhận.');
  if(r.status==='CONTRACTED')return finish('contract','BLOCKED','WAITING_FOR_SYSTEM','Đang chờ máy chủ đồng bộ trạng thái đơn sau khi ghi nhận tiền cọc.');
  const viewContract:Action|undefined=contract?{destination:'CONTRACT',label:'Xem hợp đồng'}:undefined;
  if(!contract)return finish('contract','BLOCKED','BLOCKED','Chưa tìm thấy hợp đồng cho đơn thuê.');
  if(contract.status==='EXPIRED'||contract.status==='TERMINATED'){
    return finish('contract','BLOCKED','BLOCKED',contract.status==='EXPIRED'?'Hợp đồng đã hết hạn.':'Hợp đồng đã chấm dứt.',viewContract);
  }
  if(!hasPaperProof(contract)){
    if(contract.status==='SIGNED'){
      const message=contractText(contract.signedByCustomerAt)&&Number.isFinite(Date.parse(String(contract.signedByCustomerAt)))
        ?'Hợp đồng đã được ký. Đang chờ nhân viên xác minh.'
        :'Hợp đồng ở trạng thái đã ký. Đang chờ nhân viên xác minh bằng chứng.';
      return finish('contract','CURRENT','WAITING_FOR_STAFF',message,viewContract);
    }
    if(r.status!=='DEPOSIT_PAID'||contract.signedByCustomerAt){
      return finish('contract','BLOCKED','BLOCKED','Trạng thái đơn thuê hoặc chữ ký chưa đủ điều kiện để ký.',viewContract);
    }
    if(!reviewDocument(contract).available){
      return finish('contract','BLOCKED','BLOCKED','Backend chưa cung cấp nội dung hợp đồng để bạn đọc trước khi ký.',viewContract);
    }
    return finish('contract','CURRENT','CUSTOMER_ACTION_REQUIRED','Xem và ký hợp đồng thuê kho để tiếp tục.',
      {destination:'CONTRACT',label:'Ký hợp đồng',intent:'SIGN'});
  }
  if(balance==='REVIEW')return finish('balance','BLOCKED','BLOCKED','Thanh toán số dư cần đối soát.');
  else if(balance==='FAILED')return finish('balance','FAILED','BLOCKED','Giao dịch thanh toán số dư thất bại. Hãy liên hệ cơ sở.');
  else if(balance==='VERIFYING'||balance==='PENDING'){
    return finish('balance','CURRENT','WAITING_FOR_SYSTEM','Đang chờ máy chủ xác minh và ghi nhận số dư.');
  }else if(balance!=='APPLIED'){
    const requirement=balanceRequirement(r,deposits.find(p=>applied(p)&&p.id===r.depositPaymentId));
    if(balance==='NONE'&&requirement==='ZERO'){
      set('balance','SKIPPED','Không có số dư dương để tạo checkout. Liên hệ cơ sở để xác nhận bước tiếp theo.');
    }else if(r.status==='CHECKIN_READY'&&(requirement==='REQUIRED'||balance==='READY')){
      return finish('balance','CURRENT','CUSTOMER_ACTION_REQUIRED','Cần thanh toán số dư. Vui lòng dùng Customer Web hoặc liên hệ cơ sở để được hướng dẫn.');
    }else {
      return finish('balance','BLOCKED','BLOCKED','Chưa đủ dữ liệu xác minh số dư hoặc điều kiện thanh toán.');
    }
  }

  if(handedOver){
    return {summary,steps,next:{mode:'COMPLETED',description:r.status==='ACTIVE'
      ?'Đơn thuê đã hoàn tất. Kho của bạn đã sẵn sàng sử dụng.':'Kho đã được bàn giao. Đơn thuê hiện đã quá hạn.'}};
  }
  if(r.status==='PAID'){
    return finish('handover','CURRENT','WAITING_FOR_STAFF','Đã ghi nhận các khoản thanh toán. Liên hệ cơ sở để xác nhận lịch bàn giao.');
  }
  if(balance==='APPLIED'){
    return finish('handover','BLOCKED','WAITING_FOR_SYSTEM','Đang chờ máy chủ cập nhật điều kiện bàn giao kho.');
  }
  return finish('handover','BLOCKED','BLOCKED','Cơ sở cần xác nhận điều kiện bàn giao trước khi bạn nhận kho.');
}
