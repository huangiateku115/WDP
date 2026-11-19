import {useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import axios from 'axios';
import {apiIssue} from '../api/client';
import {managedStockOperations} from '../api/managedStockOperations';
import {managedInboundPreview} from '../api/managedInboundPreview';
import {managedInventory} from '../api/managedInventory';
import {managedReservationReads} from '../api/managedReservationReads';
import {mobileRepo} from '../api/mobileRepository';
import {refId} from '../api/contracts/core';
import {buildManagedOutboundLine,managedOutboundPreviewSourceCells} from '../domain/managedV3Outbound';
import {managedSessionAvailabilityMessage} from '../domain/managedInventoryNavigation';
import {managedSessionEligibility} from '../domain/managedAccessSessionEligibility';
import {managedSessionDiagnostic,sessionFetchDiagnostic} from '../domain/managedSessionDiagnostics';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource,useScreenActive} from '../components/liveUI';
import ManagedRelocationFlow from './ManagedRelocationFlow';
import {ManagedCellLocationCard} from '../components/ManagedCellLocationCard';

const number=(s:string)=>Number(s);
function capacityMessage(value:unknown,index:number){
  if(!value||typeof value!=='object'||Array.isArray(value))return `Sức chứa ô ${index+1} đã được kiểm tra.`;
  const row=value as Record<string,unknown>;
  const code=typeof row.cellCode==='string'?row.cellCode:`${index+1}`;
  const weight=typeof row.usedWeightAfterKg==='number'?`${row.usedWeightAfterKg.toLocaleString('vi-VN')} kg`:undefined;
  const volume=typeof row.usedVolumeAfterM3==='number'?`${row.usedVolumeAfterM3.toLocaleString('vi-VN')} m³`:undefined;
  const values=[weight,volume].filter((part):part is string=>!!part).join(' · ');
  return values?`Ô ${code} · đang sử dụng sau thao tác ${values}`:`Sức chứa ô ${code} đã được kiểm tra.`;
}
function outboundErrorMessage(error:unknown,requestSent:boolean){
  const code=axios.isAxiosError(error)?error.response?.data?.code:undefined;
  const messages:Record<string,string>={
    OUTBOUND_QUANTITY_UNAVAILABLE:'Số lượng khả dụng không đủ. Hãy tải lại tồn kho và xem trước lần nữa.',
    INVALID_OUTBOUND_INPUT:'Thông tin phiếu xuất chưa hợp lệ. Hãy kiểm tra lại mặt hàng và số lượng.',
    INVALID_OUTBOUND_LINE:'Dòng hàng chưa hợp lệ. Hãy tải lại tồn kho và xem trước phiếu mới.',
    INVALID_CELL_ALLOCATION:'Phân bổ vị trí chưa hợp lệ. Hãy xem trước phiếu mới để hệ thống chọn nguồn.',
    ACCESS_SESSION_SCOPE_INVALID:'Phiên đến kho đã hết hạn hoặc không bao gồm các ô nguồn. Hãy tạo phiên phù hợp.',
    RENTAL_NOT_ACTIVE:'Đơn thuê không còn hoạt động hoặc chưa đủ điều kiện xuất hàng.',
    STALE_SKU_REVISION:'Tồn kho vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
    ITEM_SPECIFICATION_STALE:'Loại hàng vừa thay đổi. Hãy tải lại tồn kho và xem trước phiếu mới.',
    SOURCE_STOCK_CHANGED:'Tồn kho nguồn vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
    CELL_COUNTER_RECONCILIATION_UNKNOWN:'Sức chứa ô lưu trữ chưa thể đối chiếu an toàn. Chưa thể xác nhận xuất hàng.',
    LEDGER_REPLAY_UNKNOWN:'Sổ tồn chưa thể đối soát an toàn. Vui lòng thử kiểm tra lại sau.',
    TRANSACTIONS_UNAVAILABLE:'Chưa thể bắt đầu giao dịch xuất hàng an toàn; phiếu chưa được ghi nhận.',
    OUTCOME_UNKNOWN:'Chưa xác định kết quả. Phiếu được giữ để đối soát bằng cùng mã thao tác.',
    IDEMPOTENCY_CONFLICT:'Mã thao tác đang có xung đột. Giữ phiếu hiện tại và liên hệ hỗ trợ để đối soát.',
    MIXED_STOCK_KIND_UNSUPPORTED:'Loại hàng đang có dạng tồn chưa thể xử lý an toàn. Cần kho đối soát trước.',
  };
  if(typeof code==='string'&&messages[code])return messages[code]!;
  if(requestSent&&(!axios.isAxiosError(error)||!error.response||error.response.status>=500))return 'Chưa xác định kết quả xuất hàng. Vui lòng kiểm tra giao dịch hiện tại trước khi thao tác tiếp.';
  return apiIssue(error);
}
function StockOperationBase({mode}:{mode:'OUTBOUND'|'RELOCATION'}){
  const {id,sessionId:requestedSessionId}=useLocalSearchParams<{id:string;sessionId?:string|string[]}>();const owner=useLiveSession(s=>s.user?._id??'');const router=useRouter();
  const screenActive=useScreenActive();
  const requestedSession=Array.isArray(requestedSessionId)?requestedSessionId[0]:requestedSessionId;
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const rental=useResource(owner+':'+id+':rental',signal=>item.data?managedInventory.rental(refId(item.data.managedReservationId),owner,refId(item.data.facilityId),signal):Promise.resolve(null));
  const context=useResource<unknown>(owner+':'+id+':context:'+mode,()=>item.data?(mode==='OUTBOUND'?managedStockOperations.outboundContext(item.data,owner):managedStockOperations.relocationContext(item.data,owner)):Promise.resolve(null));
  const sessions=useResource(owner+':'+id+':sessions:'+mode,signal=>rental.data?managedReservationReads.sessions(rental.data,owner,signal):Promise.resolve(null));
  const requestedSessionDetail=useResource(owner+':'+id+':session-detail:'+requestedSession+':'+(rental.data?._id??''),signal=>
    requestedSession&&rental.data?managedReservationReads.session(rental.data,owner,requestedSession,signal):Promise.resolve(null));
  const [specId,setSpecId]=useState(''),[receiptId,setReceiptId]=useState(''),[cellId,setCellId]=useState(''),[destinationId,setDestinationId]=useState(''),[instanceIds,setInstanceIds]=useState<string[]>([]);
  const [sessionId,setSessionId]=useState(requestedSession??''),[quantity,setQuantity]=useState('1'),[physical,setPhysical]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const [proof,setProof]=useState<any>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[done,setDone]=useState(false);const lock=useRef(false);
  const [outboundAttempt,setOutboundAttempt]=useState<any>(null),[outboundJournalReady,setOutboundJournalReady]=useState(false),[outboundResult,setOutboundResult]=useState<any>(null),[outboundReadback,setOutboundReadback]=useState<any>(null);
  type UiInstance={itemInstanceId:string;reservationId?:string;quantity:number;weightKg:number;volumeM3:number;allocations?:{cellId:string;cellCode?:string|null}[]};
  type UiSpec={itemSpecId:string;code:string;name:string;revision:number;quantityAvailable:number;quantityUnit?:string;stockKind?:string;receipts:{receiptId:string;cellId:string;cellCode:string|null;quantityAvailable:number;reservationId?:string}[];instances?:UiInstance[]};
  const outboundContext=mode==='OUTBOUND'?context.data as Awaited<ReturnType<typeof managedStockOperations.outboundContext>>|null: null;
  const relocationContext=mode==='RELOCATION'?context.data as Awaited<ReturnType<typeof managedStockOperations.relocationContext>>|null: null;
  const specs=(mode==='OUTBOUND'?outboundContext?.stock.itemSpecifications??[]:relocationContext?.itemSpecifications??[]) as UiSpec[];
  const selectedSpec=specs.find(row=>row.itemSpecId===specId);
  const receipts=selectedSpec?.receipts??[];
  const instances=(selectedSpec?.instances??[]) as UiInstance[];
  const selectedReceipt=receipts.find(row=>row.receiptId===receiptId&&(!('reservationId' in row)||row.reservationId===rental.data?._id));
  const sourceCell=mode==='OUTBOUND'?selectedReceipt&&'cellId' in selectedReceipt?selectedReceipt.cellId:'' : cellId;
  const instanceSourceCells=new Set(instances.filter(row=>instanceIds.includes(row.itemInstanceId)).flatMap(row=>row.allocations?.map(allocation=>allocation.cellId)??[]));
  const relocationTargets=relocationContext?.cells.filter(cell=>cell.operationalStatus==='AVAILABLE'&&cell.id!==sourceCell&&!instanceSourceCells.has(cell.id))??[];
  const sessionRows=[...(sessions.data??[]),...(requestedSessionDetail.data?[requestedSessionDetail.data]:[])];
  const uniqueSessionRows=Array.from(new Map(sessionRows.map(session=>[session._id,session])).values());
  const activeSessions=uniqueSessionRows.filter(session=>managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data?.facilityId??''),
    reservationId:rental.data?._id??'',purpose:mode,primaryReservationOnly:mode==='RELOCATION',now}).eligible);
  const sessionMessage=managedSessionAvailabilityMessage(uniqueSessionRows,rental.data?._id??'',refId(rental.data?.facilityId??''),mode,now);
  const sessionReadFailed=!!sessions.error||!!requestedSessionDetail.error;
  const sessionDiagnostics=[
    ...uniqueSessionRows.flatMap(row=>{const eligibility=managedSessionEligibility(row,{customerId:owner,facilityId:refId(rental.data?.facilityId??''),
      reservationId:rental.data?._id??'',purpose:mode,primaryReservationOnly:mode==='RELOCATION',now});return eligibility.eligible?[]:[{code:managedSessionDiagnostic(eligibility.reason!,{
        status:row.status,primaryOnly:mode==='RELOCATION',primaryReservationId:refId(row.reservationId),reservationId:rental.data?._id??'',
        scopedReservationIds:(row.scopedReservationIds??[]).map(refId),
      })}];}),
    ...(sessions.error?[sessionFetchDiagnostic('list',sessions.httpStatus,sessions.errorCode)]:[]),
    ...(requestedSessionDetail.error?[sessionFetchDiagnostic('detail',requestedSessionDetail.httpStatus,requestedSessionDetail.errorCode)]:[]),
    ...(requestedSession&&!requestedSessionDetail.loading&&!requestedSessionDetail.error&&!requestedSessionDetail.data?[{code:managedSessionDiagnostic('MISSING')}]:[]),
  ];
  const sessionDiagnosticKey=JSON.stringify(sessionDiagnostics),loggedSessionDiagnostics=useRef('');
  useEffect(()=>{if(__DEV__&&sessionDiagnostics.length&&loggedSessionDiagnostics.current!==sessionDiagnosticKey){
    loggedSessionDiagnostics.current=sessionDiagnosticKey;console.debug('[managed-session-diagnostic]',sessionDiagnostics);
  }},[sessionDiagnosticKey]);
  useEffect(()=>{if(requestedSession)setSessionId(requestedSession);},[requestedSession]);
  useEffect(()=>{
    if(!screenActive||!activeSessions.length)return;
    const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);
  },[screenActive,activeSessions.length]);
  useEffect(()=>{
    if(!screenActive||rental.data?.status!=='ACTIVE')return;
    const timer=setInterval(()=>sessions.reload(),60000);return()=>clearInterval(timer);
  },[screenActive,rental.data?.status,sessions.reload]);
  useEffect(()=>{if(mode!=='OUTBOUND'||!rental.data||!owner)return;let live=true;void journal('managed-v3-outbound',owner,`${id}:${rental.data._id}`).then(store=>store.read()).then(saved=>{if(live)setOutboundAttempt(saved);}).catch(()=>{if(live)setError('Không thể đọc phiếu xuất đang chờ đối soát. Hãy thử mở lại màn hình.');}).finally(()=>{if(live)setOutboundJournalReady(true);});return()=>{live=false;};},[mode,owner,id,rental.data?._id]);
  function candidate(){
    const skuRevision=mode==='OUTBOUND'?outboundContext!.stock.skuRevision:relocationContext!.sku.revision;
    const reservationIsActive=rental.data?.status==='ACTIVE'&&Date.parse(rental.data.startDate)<=Date.now()&&Date.parse(rental.data.endDate)>Date.now();
    const session=activeSessions.find(s=>s._id===sessionId);if(!session||!selectedSpec||(!selectedReceipt&&!instanceIds.length&&mode!=='OUTBOUND')||!rental.data||!reservationIsActive)throw Error('Đơn thuê phải đang hoạt động. Chọn mặt hàng và phiên đến kho còn hiệu lực.');
    if(mode==='OUTBOUND'){
      if(selectedSpec.stockKind==='MIXED_UNSUPPORTED')throw Error('Tồn kho có hai hình thức chưa thể xử lý cùng lúc. Vui lòng liên hệ hỗ trợ trước khi xuất.');
      if(selectedSpec.stockKind==='ITEM_INSTANCE'){
        if(!instanceIds.length||instanceIds.some(value=>!instances.some(row=>row.itemInstanceId===value)))throw Error('Chọn nguyên món cần xuất.');
        const cells=Array.from(new Set(instances.filter(row=>instanceIds.includes(row.itemInstanceId)).flatMap(row=>row.allocations?.map(allocation=>allocation.cellId)??[])));
        if(cells.some(value=>!session.allowedCellIds.some(allowed=>refId(allowed)===value)))throw Error('Phiên hiện tại không bao gồm tất cả các ô nguồn.');
        return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,reservationId:rental.data._id,
          lines:[{lineId:'line-1',itemSpecId:selectedSpec.itemSpecId,itemSpecRevision:selectedSpec.revision,quantity:instanceIds.length,itemInstanceIds:instanceIds}],
          physicalRemovalConfirmed:true,customerAttestation:'Khách hàng xác nhận đã thực tế lấy đúng hàng khỏi các ô nguồn trong phiên OUTBOUND có nhân viên giám sát.'};
      }
      return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,reservationId:rental.data._id,
        lines:[buildManagedOutboundLine(selectedSpec,quantity)],
        physicalRemovalConfirmed:true,customerAttestation:'Khách hàng xác nhận đã thực tế lấy đúng hàng khỏi các ô nguồn trong phiên OUTBOUND có nhân viên giám sát.'};
    }
    const requestedCells=[...(instanceIds.length?Array.from(instanceSourceCells):[selectedReceipt!.cellId]),destinationId];
    if(requestedCells.some(value=>!session.allowedCellIds.some(allowed=>refId(allowed)===value)))throw Error('Phiên hiện tại không bao gồm tất cả các ô của thao tác này.');
    const qty=number(quantity);if(!Number.isSafeInteger(qty)||qty<1)throw Error('Số lượng phải là số nguyên dương.');
    const target=relocationTargets.find(c=>c.id===destinationId);if(!target)throw Error('Chọn ô đích khả dụng khác ô nguồn.');
    if(instanceIds.length){if(instanceIds.length!==1||selectedReceipt)throw Error('Chỉ chuyển một kiện nguyên khối mỗi lần và không trộn với receipt.');
      const instance=instances.find(row=>row.itemInstanceId===instanceIds[0]);if(!instance)throw Error('Kiện nguyên khối không còn trong dữ liệu.');
      return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,lines:[{lineId:'line-1',itemSpecId:selectedSpec.itemSpecId,
        itemSpecRevision:selectedSpec.revision,itemInstanceId:instance.itemInstanceId,quantity:1,sourceReservationId:instance.reservationId??rental.data._id,
        destinationReservationId:target.reservationId,destinationAllocations:[{cellId:target.id,reservationId:target.reservationId,weightKg:instance.weightKg,volumeM3:instance.volumeM3}]}],
        reason:'Customer chuyển vị trí',customerAttestation:'CONFIRMED'};}
    if(!selectedReceipt||qty>selectedReceipt.quantityAvailable)throw Error('Số lượng vượt tồn khả dụng của receipt đã chọn.');
    return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,lines:[{lineId:'line-1',itemSpecId:selectedSpec.itemSpecId,
      itemSpecRevision:selectedSpec.revision,sourceCellId:selectedReceipt.cellId,destinationCellId:target.id,
        sourceReservationId:('reservationId' in selectedReceipt?selectedReceipt.reservationId:rental.data._id),destinationReservationId:target.reservationId,quantity:qty}],reason:'Customer chuyển vị trí',customerAttestation:'CONFIRMED'};
  }
  async function preview(){if(lock.current)return;lock.current=true;setPending(true);setError('');setProof(undefined);
    try{const body=candidate(),session=await managedReservationReads.session(rental.data!,owner,body.accessSessionId);
      if(!session)throw Error('Không tìm thấy phiên đã chọn. Tải lại danh sách phiên trước khi xem trước.');
      if(!managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data!.facilityId),reservationId:rental.data!._id,purpose:mode,
        primaryReservationOnly:mode==='RELOCATION',now:Date.now()}).eligible)throw Error('Phiên đã thay đổi hoặc không có đủ phạm vi cho thao tác này. Tải lại phiên trước khi xem trước.');
      const latestBody={...body,accessSessionId:session._id,sessionRevision:session.revision};
      const result=mode==='OUTBOUND'
      ?await managedStockOperations.outboundPreview(item.data!,rental.data!,owner,session,latestBody)
      :await managedStockOperations.relocationPreview(item.data!,rental.data!,owner,session,latestBody);
      if(mode==='OUTBOUND'){
        if(!rental.data)throw Error('Chưa tải được đơn thuê.');
        if(!outboundJournalReady)throw Error('Đang kiểm tra phiếu xuất trước đó. Hãy đợi rồi thử lại.');
        if(rental.data.status!=='ACTIVE'||Date.parse(rental.data.startDate)>Date.now()||Date.parse(rental.data.endDate)<=Date.now())throw Error('Đơn thuê không còn ở trạng thái hoạt động.');
        if(result.skuId!==item.data!._id||result.reservationId!==rental.data!._id||result.accessSession.sessionId!==session._id||result.accessSession.revision!==session.revision)
          throw Error('Bản xem trước không khớp mặt hàng, đơn thuê hoặc phiên đang chọn.');
        managedOutboundPreviewSourceCells(result.lines.map((line:any)=>({sources:Array.isArray(line.sources)?line.sources.map((source:any)=>({cellId:refId(source.cellId)})):[]})),session.allowedCellIds.map(refId));
      }
      setProof({result,body:latestBody});
    }catch(cause){setError(cause instanceof Error&&!axios.isAxiosError(cause)?cause.message:apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  async function completeOutbound(operation:any,store:any,attempt:any){
    if(!item.data||!rental.data)throw Error('Không thể đối chiếu mặt hàng và đơn thuê hiện tại.');
    sessions.reload();requestedSessionDetail.reload();
    const savedBody=attempt.inboundBody?.body as {lines?:{itemSpecId:string}[]}|undefined;
    const specIds=Array.from(new Set((savedBody?.lines??[]).map(line=>line.itemSpecId)));
    setOutboundResult({...operation,preview:attempt.inboundBody?.preview});setDone(true);setError('');setOutboundReadback(null);
    try{
      const [stock,cellStock,specifications,movements]=await Promise.all([
        managedInboundPreview.stockReadback(item.data,rental.data,owner),
        managedInboundPreview.cellStockReadback(item.data,rental.data,owner),
        Promise.all(specIds.map(specId=>managedInboundPreview.specificationStockReadback(item.data!,rental.data!,owner,specId))),
        managedInboundPreview.movementsReadback(item.data,rental.data,owner),
      ]);
      const movement=operation.movement;
      const movementId=refId(movement?._id);
      const movementInHistory=movements.some((row:any)=>row._id===movementId&&row.type==='OUTBOUND'&&row.stockEffect?.action==='REMOVE');
      let cellLocations:Awaited<ReturnType<typeof managedInventory.cellLocations>>={};
      try{
        const cellIds=[...new Set<string>([
          ...cellStock.byCell.map((row:any)=>row.cellId),
          ...(operation.movement?.stockEffect?.source??[]).map((row:any)=>refId(row.cellId)),
        ])];
        cellLocations=await managedInventory.cellLocations(refId(rental.data.facilityId),cellIds);
      }catch{/* Stock verification remains valid if facility labels are temporarily unavailable. */}
      setOutboundReadback({stock,cellStock,specifications,movementInHistory,cellLocations});
      rental.reload();context.reload();
      await store.clear();setOutboundAttempt(null);
    }catch{
      setOutboundReadback({pending:true});
      setError('Đã ghi nhận xuất hàng. Đang cập nhật thông tin tồn kho.');
      await store.write({...attempt,inboundCommitted:true});setOutboundAttempt({...attempt,inboundCommitted:true});
    }
  }
  async function confirm(){if(lock.current||!proof||!rental.data||(mode==='OUTBOUND'&&!physical))return;let outboundConfirmSent=false;lock.current=true;setPending(true);setError('');
    try{const body=proof.body as {accessSessionId:string;sessionRevision:number};
      const session=await managedReservationReads.session(rental.data,owner,body.accessSessionId);
      const requiredCells=mode==='OUTBOUND'?managedOutboundPreviewSourceCells((proof.result.lines??[]).map((line:any)=>({sources:Array.isArray(line.sources)?line.sources.map((source:any)=>({cellId:refId(source.cellId)})):[]})),session?.allowedCellIds.map(refId)??[]):
        [...(instanceIds.length?Array.from(instanceSourceCells):selectedReceipt?[selectedReceipt.cellId]:[]),destinationId];
      if(!managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data.facilityId),reservationId:rental.data._id,purpose:mode,
        primaryReservationOnly:mode==='RELOCATION',revision:body.sessionRevision,cellIds:requiredCells,now:Date.now()}).eligible)
        throw Error('Phiên đã hết hiệu lực hoặc thay đổi. Tải lại phiên và tạo bản xem trước mới.');
      if(mode==='OUTBOUND'){
        if(!item.data||outboundContext?.stock.skuRevision!==proof.body.skuRevision)throw Error('Tồn kho đã thay đổi sau khi xem trước. Tải lại và xem trước phiếu mới.');
        const store=await journal('managed-v3-outbound',owner,`${id}:${rental.data._id}`),existing=await store.read();
        if(existing)throw Error('Phiếu xuất trước đang cần đối soát. Hãy kiểm tra trạng thái trước khi tạo thao tác mới.');
        const attempt={...newAttempt(),resourceId:id,inboundBody:{mode,body:proof.body,preview:proof.result},inboundCommitted:false};
        if(!await store.claim(attempt))throw Error('Một yêu cầu đang được xử lý.');
        setOutboundAttempt(attempt);
        outboundConfirmSent=true;
        const result=await managedStockOperations.outboundConfirm(item.data,rental.data,owner,proof.body,attempt.key);
        const committedAttempt={...attempt,inboundCommitted:true};await store.write(committedAttempt);setOutboundAttempt(committedAttempt);setProof(undefined);
        await completeOutbound(result,store,committedAttempt);
      }else{
        const store=await journal('managed-v3-inbound',owner,`${mode}:${id}:${rental.data._id}`);let attempt=await store.read();
        if(!attempt){attempt={...newAttempt(),resourceId:id,inboundBody:{mode,body:proof.body}};if(!await store.claim(attempt))throw Error('Một yêu cầu đang được xử lý.');}
        if(attempt.resourceId!==id||attempt.inboundBody?.mode!==mode)throw Error('Yêu cầu đã lưu không khớp SKU/thao tác.');
        await managedStockOperations.relocationConfirm(item.data!,rental.data!,owner,attempt.inboundBody.body,attempt.key);
        await store.clear();setDone(true);setProof(undefined);context.reload();
      }
    }catch(cause){if(mode==='RELOCATION'&&axios.isAxiosError(cause)&&[400,403,404,409,412,422].includes(cause.response?.status??0))await journal('managed-v3-inbound',owner,`${mode}:${id}:${rental.data?._id}`).then(store=>store.clear());
      setError(mode==='OUTBOUND'?outboundErrorMessage(cause,outboundConfirmSent):apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  async function recover(){if(lock.current)return;lock.current=true;setPending(true);setError('');try{
    const store=await journal(mode==='OUTBOUND'?'managed-v3-outbound':'managed-v3-inbound',owner,mode==='OUTBOUND'?`${id}:${rental.data?._id}`:`${mode}:${id}:${rental.data?._id}`),saved=await store.read();
    if(!saved||saved.resourceId!==id||saved.inboundBody?.mode!==mode)throw Error('Không tìm thấy yêu cầu phù hợp để kiểm tra trạng thái.');
    const result=mode==='OUTBOUND'?await managedStockOperations.outboundOperation(item.data!,rental.data!,owner,saved.key):await managedStockOperations.relocationOperation(item.data!,rental.data!,owner,saved.key,saved.inboundBody?.body);
    if(result.status!=='COMMITTED')throw Error('Chưa xác nhận được thao tác. Hãy tải lại và kiểm tra trạng thái.');
    if(mode==='OUTBOUND'){const committedAttempt={...saved,inboundCommitted:true};await store.write(committedAttempt);setOutboundAttempt(committedAttempt);await completeOutbound(result,store,committedAttempt);}
    else{await store.clear();setDone(true);context.reload();}
  }catch(cause){setError(mode==='OUTBOUND'?'Chưa xác định kết quả xuất hàng. Phiếu đang được giữ để tiếp tục đối soát; không tạo phiếu mới.':apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  const title=mode==='OUTBOUND'?'Xuất hàng khỏi kho':'Chuyển vị trí hàng';
  return <LiveScreen title={title} eyebrow="KHO KÝ GỬI" subtitle="Kiểm tra thông tin và xác nhận thao tác trước khi thực hiện."
    backButton={{disabled:!id,onPress:()=>router.replace({pathname:'/inventory/[id]',params:{id,...(requestedSession?{accessSessionId:requestedSession}:{}),operation:mode}} as unknown as Href)}}
    onRefresh={()=>{item.reload();rental.reload();context.reload();sessions.reload();}} refreshing={item.loading||context.loading}>
    <ResourceState {...item}/><ResourceState {...rental}/><ResourceState {...context}/><ResourceState {...sessions}/>
    {!!requestedSession&&<ResourceState {...requestedSessionDetail} resource="phiên truy cập"/>}
    {context.error&&<StateCard kind="error" title="Thao tác chưa khả dụng" description={apiIssue(context.error)}/>}
    {done&&mode==='OUTBOUND'&&outboundResult&&<Card><AppText variant="medium">Xuất hàng thành công</AppText>
      <AppText>{item.data?.itemCode} · {item.data?.name}</AppText>
      <AppText>{String(outboundResult.movement?.quantity??outboundAttempt?.inboundBody?.body?.lines?.[0]?.quantity??'—')} {String(outboundResult.movement?.quantityUnit??'đơn vị')}</AppText>
      <AppText>Mã phiếu: {String(outboundResult.movement?.movementCode??outboundResult.movement?._id??'Đã ghi nhận')}</AppText>
      <AppText>Thời gian: {outboundResult.movement?.performedAt?new Date(outboundResult.movement.performedAt).toLocaleString('vi-VN'): 'Đã hoàn tất'}</AppText>
      {(outboundResult.movement?.stockEffect?.source??[]).map((source:any,index:number)=><ManagedCellLocationCard key={`${source.cellId}-${index}`} cellId={refId(source.cellId)} location={outboundReadback?.cellLocations?.[refId(source.cellId)]} title="Vị trí lấy hàng" detail={`${source.quantity} ${String(outboundResult.movement?.quantityUnit??'đơn vị')}`}/>)}
      {outboundReadback?.pending?<AppText>Đã ghi nhận xuất hàng. Đang cập nhật thông tin tồn kho.</AppText>:outboundReadback&&<>
        <AppText>Số lượng còn lại theo loại hàng: {outboundReadback.specifications[0]?.quantityAvailable??'Chưa xác minh được'} {String(outboundReadback.specifications[0]?.quantityUnit??'đơn vị')}</AppText>
        {outboundReadback.cellStock.byCell.map((cell:any,index:number)=><ManagedCellLocationCard key={`${cell.cellId}-${index}`} cellId={cell.cellId} location={outboundReadback.cellLocations[cell.cellId]} title="Tồn theo vị trí" detail={`Còn ${cell.quantityAvailable} · ${cell.weightKg} kg · ${cell.volumeM3} m³`}/>)}
        {(outboundResult.preview?.capacity??[]).map((cell:any,index:number)=><AppText key={`capacity-${cell.cellId}-${index}`}>Dung tích sau xuất · {cell.cellCode??`Ô ${String(cell.cellId).slice(-6)}`} · {cell.usedWeightAfterKg} kg · {cell.usedVolumeAfterM3} m³</AppText>)}
        <AppText>{outboundReadback.movementInHistory?'Hoạt động đã có trong lịch sử hàng hóa.':'Hoạt động đã hoàn tất và đang được cập nhật trong lịch sử.'}</AppText>
      </>}
      <Button label="Xem lịch sử biến động" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id}} as unknown as Href)}/>
    </Card>}
    {done&&mode==='RELOCATION'&&<StateCard title="Đã ghi nhận thao tác" description="Tải lại để xem số lượng tồn và lịch sử mới nhất."/>}
    <Card><AppText variant="medium">Chọn hàng và phiên</AppText>
      {activeSessions.length===0&&!sessions.loading&&!requestedSessionDetail.loading&&<><StateCard kind={sessionReadFailed?'error':'empty'} title={sessionReadFailed?'Chưa thể tải thông tin phiên':'Chưa có phiên thao tác hợp lệ'} description={sessionReadFailed?'Không thể xác minh phiên từ hệ thống. Hãy tải lại trước khi bắt đầu thao tác.':sessionMessage}/>{!sessionReadFailed&&sessionMessage.startsWith('Chưa có phiên')&&<Button label="Mở lịch đến kho" variant="outline" onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits',params:{reservationId:rental.data?._id??''}})}/>}</>}
      {specs.map(row=><Filter key={row.itemSpecId} label={`${row.code} · ${row.name} · còn ${row.quantityAvailable}`} selected={specId===row.itemSpecId} onPress={()=>{setSpecId(row.itemSpecId);setReceiptId('');setInstanceIds([]);setProof(undefined);}}/>)}
      {mode==='RELOCATION'&&receipts.map(row=><Filter key={row.receiptId+':'+row.cellId} label={`Ô ${row.cellCode??row.cellId.slice(-6)} · ${row.quantityAvailable} khả dụng · phiếu ${row.receiptId.slice(-8)}`} selected={receiptId===row.receiptId} onPress={()=>{setReceiptId(row.receiptId);setCellId(row.cellId);setProof(undefined);}}/>)}
      {instances.map(row=><Filter key={row.itemInstanceId} label={`Kiện nguyên khối ${row.itemInstanceId.slice(-10)} · ${row.weightKg} kg · ${row.volumeM3} m³`}
        selected={instanceIds.includes(row.itemInstanceId)} onPress={()=>{setReceiptId('');setInstanceIds(mode==='OUTBOUND'?instanceIds.includes(row.itemInstanceId)?instanceIds.filter(value=>value!==row.itemInstanceId):[...instanceIds,row.itemInstanceId]:[row.itemInstanceId]);setProof(undefined);}}/>)}
      {activeSessions.map(session=><Filter key={session._id} label={`Phiên ${mode==='OUTBOUND'?'xuất':'chuyển'} · đến ${new Date(session.expiresAt).toLocaleTimeString('vi-VN')}`} selected={sessionId===session._id} onPress={()=>{setSessionId(session._id);setProof(undefined);}}/>)}
      {(mode==='OUTBOUND'&&selectedSpec?.stockKind!=='ITEM_INSTANCE'&&!!selectedSpec||mode==='RELOCATION'&&!!selectedReceipt)&&<Input label={`Số lượng xuất (${selectedSpec?.quantityUnit??'đơn vị'})`} value={quantity} onChangeText={v=>{setQuantity(v);setProof(undefined);}} keyboardType="number-pad"/>}
      {mode==='OUTBOUND'&&selectedSpec?.stockKind!=='ITEM_INSTANCE'&&<AppText variant="caption">Vị trí và lượng hàng xuất sẽ được xác định trong bước xem trước. Có thể xuất: {selectedSpec?.quantityAvailable} {String((selectedSpec as any)?.quantityUnit??'đơn vị')}.</AppText>}
      {mode==='RELOCATION'&&<>{relocationTargets.map(cell=><Filter key={cell.id} label={`${cell.code} · ${cell.reservationCode} · còn ${(cell.maxWeightKg-cell.usedWeightKg).toFixed(1)} kg`} selected={destinationId===cell.id} onPress={()=>{setDestinationId(cell.id);setProof(undefined);}}/>)}</>}
      {mode==='OUTBOUND'&&<Button label={physical?'Đã xác nhận sẽ lấy hàng thực tế':'Xác nhận lấy hàng thực tế'} variant={physical?'primary':'outline'} onPress={()=>{setPhysical(value=>!value);setProof(undefined);}}/>}
      <Button label="Xem trước" loading={pending} disabled={!item.data||!rental.data||!context.data||!selectedSpec||(mode==='RELOCATION'&&!selectedReceipt)||(mode==='OUTBOUND'&&selectedSpec.stockKind==='ITEM_INSTANCE'&&!instanceIds.length)||!sessionId||!activeSessions.some(session=>session._id===sessionId)||(mode==='OUTBOUND'&&(!physical||!outboundJournalReady||!!outboundAttempt))||(mode==='RELOCATION'&&!destinationId)} onPress={()=>void preview()}/>
    </Card>
    {!!error&&<StateCard kind="error" title="Không thể hoàn tất" description={error}/>}
    {proof&&<Card><AppText variant="medium">Kiểm tra trước khi xác nhận</AppText><AppText>{proof.result.totalQuantity} đơn vị · {proof.result.totalWeightKg} kg · {proof.result.totalVolumeM3} m³</AppText>
      {mode==='OUTBOUND'&&proof.result.lines?.map((line:any,index:number)=><Card key={`${line.itemSpecId}-${index}`} style={{padding:12}}><AppText>{line.code} · {line.name}</AppText><AppText>Tồn {line.quantityBefore} · xuất {line.quantityOut} · còn {line.quantityAfter} {line.quantityUnit}</AppText>{line.sources?.map((source:any,sourceIndex:number)=><AppText key={`${source.cellId}-${source.receiptId}-${sourceIndex}`}>Nguồn FIFO · Ô {source.cellCode??String(source.cellId).slice(-6)} · {source.quantity} {line.quantityUnit}</AppText>)}</Card>)}
      {proof.result.capacity?.map((row:unknown,index:number)=><AppText key={index}>{capacityMessage(row,index)}</AppText>)}
      <AppText variant="caption">Chỉ xác nhận sau khi bạn đã thực hiện thao tác ngoài kho theo hướng dẫn.</AppText>
      <Button label={mode==='OUTBOUND'?'Xác nhận đã xuất hàng':'Xác nhận đã chuyển hàng'} loading={pending} disabled={!proof.result.status||proof.result.status!=='READY'} onPress={()=>void confirm()}/>
    </Card>}
    {mode==='OUTBOUND'&&outboundAttempt&&<Card><AppText variant="medium">Phiếu xuất đang cần đối soát</AppText><AppText>Kết quả chưa được xác minh đầy đủ. Phiếu được giữ nguyên; không bắt đầu phiếu mới.</AppText><Button label="Kiểm tra trạng thái phiếu" variant="outline" loading={pending} disabled={!item.data||!rental.data} onPress={()=>void recover()}/></Card>}
    {mode==='RELOCATION'&&<Button label="Kiểm tra trạng thái thao tác" variant="outline" disabled={pending||!item.data||!rental.data} onPress={()=>void recover()}/>}
  </LiveScreen>;
}
export function ManagedOutboundScreen(){return <StockOperationBase mode="OUTBOUND"/>;}
export function ManagedRelocationScreen(){return <ManagedRelocationFlow/>;}
