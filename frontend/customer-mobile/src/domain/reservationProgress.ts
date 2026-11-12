import type {z} from 'zod';
import type {ReservationDto} from '../api/contracts/customer';
import type {contractDto,paymentDto} from '../api/contracts/documents';
import {refId} from '../api/contracts/core';
import {reviewDocument,contractText} from './contractReview';
import {applied,balanceDecision,hasPaperProof} from './livePayment';

type Contract=z.infer<typeof contractDto>;
type Payment=z.infer<typeof paymentDto>;
type PaymentDecision='APPLIED'|'REVIEW'|'INELIGIBLE'|'READY'|'CREATE';
type Action={destination:'PAYMENT'|'CONTRACT';label:string;intent?:'SIGN';purpose?:'BALANCE'|'FULL_RENT'};
type StepState='COMPLETED'|'CURRENT'|'UPCOMING'|'BLOCKED'|'FAILED'|'SKIPPED';
type Mode='CUSTOMER_ACTION_REQUIRED'|'WAITING_FOR_SYSTEM'|'WAITING_FOR_STAFF'|'BLOCKED'|'COMPLETED';
export type ProgressStep={id:string;title:string;state:StepState;description:string};
export type ReservationProgress={summary:string;steps:ProgressStep[];next?:{mode:Mode;description:string;action?:Action}};
type Evidence={contract:Contract|null;payments:Payment[];decision:PaymentDecision;balanceAttemptExists?:boolean};

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

export function reservationProgress(r:ReservationDto,evidence?:Evidence,now=Date.now()):ReservationProgress|null{
  if(r.serviceType!=='SELF_STORAGE')return null;
  if (r.rentalPaymentFlow === 'FULL_UPFRONT_V1') return upfrontProgress(r, evidence, now);
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
  if(balance==='APPLIED'&&r.status!=='CHECKIN_READY')set('balance','COMPLETED','Số dư đã được xác minh và ghi nhận.');
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
  const balanceAction:Action={destination:'PAYMENT',purpose:'BALANCE',label:'Xem trạng thái thanh toán'};
  const nextBalance=balanceDecision(r,contract,payments,evidence.balanceAttemptExists).kind;
  if(balance==='REVIEW'||nextBalance==='REVIEW'&&balance!=='FAILED'){
    return finish('balance','BLOCKED','BLOCKED','Giao dịch cần được kiểm tra. Vui lòng không thanh toán lại.',balanceAction);
  }
  if(balance==='FAILED')return finish('balance','FAILED','BLOCKED','Giao dịch thanh toán số dư thất bại. Hãy liên hệ cơ sở.',balanceAction);
  if(balance==='VERIFYING'||balance==='APPLIED'&&r.status==='CHECKIN_READY'){
    return finish('balance','CURRENT','WAITING_FOR_SYSTEM','Đã nhận thông tin thanh toán, đang chờ hệ thống ghi nhận.',balanceAction);
  }
  if(nextBalance==='CREATE'||nextBalance==='READY'){
    return finish('balance','CURRENT','CUSTOMER_ACTION_REQUIRED',nextBalance==='READY'?'Liên kết đã sẵn sàng. Đang chờ xác nhận thanh toán.':
      'Hợp đồng của bạn đã được xác minh. Vui lòng thanh toán số tiền còn lại để tiếp tục nhận kho.',
      {...balanceAction,label:'Thanh toán qua PayOS'});
  }
  if(balance==='PENDING'||balance==='READY')return finish('balance','CURRENT','WAITING_FOR_SYSTEM','Đang chờ xác nhận thanh toán.',balanceAction);
  if(nextBalance==='ZERO'){
    set('balance','SKIPPED','Không có số dư dương để tạo checkout. Liên hệ cơ sở để xác nhận bước tiếp theo.');
  }else if(balance!=='APPLIED'){
    return finish('balance','BLOCKED','BLOCKED','Chưa đủ dữ liệu xác minh số dư hoặc điều kiện thanh toán.');
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

function upfrontProgress(r: ReservationDto, evidence: Evidence | undefined, now: number): ReservationProgress {
  const summary = ({
    RESERVED: 'Đã giữ kho', CONTRACTED: 'Chờ thanh toán 100% tiền thuê', PAID: 'Đã thanh toán — Chờ ký hợp đồng giấy',
    CHECKIN_READY: 'Hợp đồng đã xác minh — Chờ bàn giao', ACTIVE: 'Đã bàn giao — Đang thuê',
    CANCELLED: 'Đơn thuê đã hủy', CHECKED_OUT: 'Đã trả kho', CLOSED: 'Đơn thuê đã đóng', OVERDUE: 'Đơn thuê đã quá hạn',
    DEPOSIT_PAID: 'Trạng thái cần xác minh'
  })[r.status];
  if (!evidence) return {summary, steps: []};
  const {contract, payments} = evidence;
  if (payments.some(p => p.reservationId !== r._id) || (contract &&
      (refId(contract.reservationId) !== r._id || refId(contract.customerId) !== refId(r.customerId)))) {
    return {summary, steps: [], next: {mode:'BLOCKED', description:'Chưa thể xác minh tiến độ của đơn thuê này.'}};
  }
  const settled = payments.some(p => p.purpose === 'FULL_RENT' && applied(p));
  const verified = hasPaperProof(contract);
  const handedOver = ['ACTIVE','OVERDUE','CHECKED_OUT','CLOSED'].includes(r.status);
  const ended = ['CANCELLED','CHECKED_OUT','CLOSED'].includes(r.status);
  const payable = r.status === 'CONTRACTED' && !!r.expiresAt && Date.parse(r.expiresAt) > now;
  const steps: ProgressStep[] = [
    {id:'payment', title:'Thanh toán 100% tiền thuê', state:settled?'COMPLETED':ended?'SKIPPED':payable?'CURRENT':'BLOCKED',
      description:settled?'Máy chủ đã xác minh và ghi nhận thanh toán.':'Trạng thái thanh toán do máy chủ xác nhận.'},
    {id:'contract', title:'Ký và xác minh hợp đồng giấy', state:verified?'COMPLETED':ended?'SKIPPED':r.status==='PAID'?'CURRENT':'UPCOMING',
      description:verified?'Nhân viên đã xác minh hợp đồng.':'Ký hợp đồng giấy tại cơ sở.'},
    {id:'handover', title:'Bàn giao kho', state:handedOver?'COMPLETED':ended?'SKIPPED':r.status==='CHECKIN_READY'&&verified?'CURRENT':'UPCOMING',
      description:handedOver?'Máy chủ đã ghi nhận bàn giao.':'Nhân viên tại cơ sở thực hiện bàn giao.'},
  ];
  const contractAction: Action | undefined = contract ? {destination:'CONTRACT',label:'Xem hợp đồng'} : undefined;
  const next: ReservationProgress['next'] = ended ? {mode:'COMPLETED',description:summary}
    : handedOver ? {mode:'COMPLETED',description:summary,action:contractAction}
    : payable && !settled ? {mode:'CUSTOMER_ACTION_REQUIRED',description:summary,
      action:{destination:'PAYMENT',label:'Thanh toán và kiểm tra PayOS',purpose:'FULL_RENT'}}
    : r.status==='PAID' && contract?.status==='DRAFT' ? {mode:'WAITING_FOR_STAFF',description:'Vui lòng đến cơ sở ký hợp đồng giấy trước hạn ký.',action:contractAction}
    : r.status==='CHECKIN_READY' && verified ? {mode:'WAITING_FOR_STAFF',description:'Đang chờ nhân viên bàn giao kho.',action:contractAction}
    : {mode:'WAITING_FOR_SYSTEM',description:'Hãy làm mới trạng thái đơn thuê và hợp đồng.',action:contractAction};
  return {summary,steps,next};
}
