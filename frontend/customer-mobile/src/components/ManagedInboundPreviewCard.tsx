import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'expo-router';
import {View} from 'react-native';
import axios from 'axios';
import {journal,newAttempt} from '../state/attemptJournal';
import {apiIssueWithStatus} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';
import {eligibleInboundCells,buildUnifiedInboundRequest,managedInboundPreview} from '../api/managedInboundPreview';
import {managedReservationReads} from '../api/managedReservationReads';
import {managedInventory} from '../api/managedInventory';
import {movementActionLabel,movementIdentifier} from '../domain/managedV3Movements';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Chip,Filter,Input,SectionTitle,ui} from './ui';
import {ManagedCellLocationCard} from './ManagedCellLocationCard';
import {managedSessionEligibility} from '../domain/managedAccessSessionEligibility';
import {inboundReadbackDiagnostic} from '../domain/managedInboundReadbackDiagnostics';
import {ResourceState,useResource} from './liveUI';
import type {mobileRepo} from '../api/mobileRepository';

const sessionTime=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type InboundRequest=ReturnType<typeof buildUnifiedInboundRequest>;
type DraftAllocation={cellId:string;quantity:string};
type DraftLine={lineId:string;specId:string;quantity:string;allocations:DraftAllocation[]};
const lineId=()=>`mobile-${Date.now()}-${Math.random().toString(16).slice(2,10)}`;
const makeLine=(specId:string,cellId:string):DraftLine=>({lineId:lineId(),specId,quantity:'1',allocations:[{cellId,quantity:'1'}]});
const inboundErrorMessages:Record<string,string>={
  INBOUND_CONFIRM_ENVIRONMENT_BLOCKED:'Xác nhận nhập kho đang bị khóa trong môi trường hiện tại. Phiếu chưa được ghi nhận.',
  LEDGER_REPLAY_UNKNOWN:'Chưa thể xác minh kết quả lần nhập. Tra cứu lại bằng khóa của yêu cầu đang chờ.',
  STOCK_WORKFLOW_NOT_AVAILABLE:'Quy trình nhập hàng này hiện chưa khả dụng. Vui lòng thử lại sau.',
  TRANSACTIONS_UNAVAILABLE:'Chưa thể bắt đầu giao dịch nhập hàng. Hãy kiểm tra trạng thái trước khi tiếp tục.',
  OUTCOME_UNKNOWN:'Chưa xác định được kết quả ghi sổ. Tra cứu lại yêu cầu đang chờ, không tạo phiếu mới.',
  CAPACITY_RECONCILIATION_UNKNOWN:'Chưa thể xác minh sức chứa của ô lưu trữ. Hãy làm mới dữ liệu kho.',
  CELL_STOCK_RECONCILIATION_UNKNOWN:'Chưa thể đối chiếu số lượng theo ô lưu trữ. Hãy làm mới dữ liệu kho.',
  CELL_COUNTER_RECONCILIATION_UNKNOWN:'Số lượng tại ô lưu trữ chưa được xác minh. Hãy làm mới dữ liệu kho.',
  RESERVATION_COUNTER_RECONCILIATION_UNKNOWN:'Bộ đếm Reservation chưa được xác minh. Hãy làm mới dữ liệu kho.',
  STALE_SKU_REVISION:'Thông tin hàng hóa đã thay đổi. Hãy tải lại và xem trước lại.',
  ITEM_SPECIFICATION_STALE:'Thông tin loại hàng đã thay đổi. Hãy tải lại và xem trước lại.',
  STALE_ITEM_SPECIFICATION:'Thông tin loại hàng đã thay đổi. Hãy tải lại và xem trước lại.',
  ACCESS_SESSION_SCOPE_INVALID:'Phiên truy cập không còn đúng phạm vi. Hãy chọn phiên còn hiệu lực.',
  CELL_NOT_ALLOCATED:'Cell đã chọn không nằm trong phạm vi được cấp cho Reservation hoặc phiên truy cập.',
  CAPACITY_EXCEEDED:'Sức chứa Cell không đủ cho số lượng đã chọn.',
  RESERVATION_CAPACITY_EXCEEDED:'Sức chứa Reservation không đủ cho số lượng đã chọn.',
};
function inboundIssue(error:unknown){
  const code=axios.isAxiosError(error)&&typeof error.response?.data?.code==='string'?error.response.data.code:undefined;
  return code&&inboundErrorMessages[code]?inboundErrorMessages[code]:apiIssueWithStatus(error);
}

export function ManagedInboundPreviewCard({item,r,owner,onCommitted,initialSessionId,screenMode=false,refreshRevision=0}:{item:Item;r:ReservationDto;owner:string;onCommitted:()=>void;initialSessionId?:string;screenMode?:boolean;refreshRevision?:number}){
  const router=useRouter();
  const [open,setOpen]=useState(screenMode||!!initialSessionId),[sessionId,setSession]=useState(initialSessionId??'');
  const [lines,setLines]=useState<DraftLine[]>([]),[proof,setProof]=useState<Awaited<ReturnType<typeof managedInboundPreview.preview>>>();
  const [error,setError]=useState(''),[pending,setPending]=useState(false),[committed,setCommitted]=useState('');
  const [resultState,setResultState]=useState<{status:'COMMITTED_AND_READBACK_VERIFIED'|'COMMITTED_READBACK_PENDING';movement?:any;stock?:any;cellStock?:any;movements?:any[]}>();
  const [retryAllowed,setRetryAllowed]=useState(false);
  const lock=useRef(false),mounted=useRef(false),autoRecoveryAttempt=useRef('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(initialSessionId){setSession(initialSessionId);setOpen(true);}},[initialSessionId]);
  const scope=owner+':'+item._id;
  const attemptResource=useResource(scope,()=>journal('managed-v3-inbound',owner,item._id).then(store=>store.read()));
  const context=useResource(open?scope:'',signal=>open?managedInboundPreview.context(item,r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const stockReadback=useResource(open?scope+':inbound-stock':'',signal=>open?managedInboundPreview.stockReadback(item,r,owner,signal):Promise.resolve(null));
  const cellStockReadback=useResource(open?scope+':inbound-cell-stock':'',signal=>open?managedInboundPreview.cellStockReadback(item,r,owner,signal):Promise.resolve(null));
  const movementReadback=useResource(open?scope+':inbound-movements':'',signal=>open?managedInboundPreview.movementsReadback(item,r,owner,signal):Promise.resolve(null));
  const usable=sessions.data?.filter(session=>eligibleInboundCells(r,session).length>0&&(!initialSessionId||session._id===initialSessionId))??[];
  const session=usable.find(row=>row._id===sessionId),cells=session?eligibleInboundCells(r,session):[];
  const cellLabels=useResource(open&&cells.length?owner+':inbound-cell-labels:'+refId(r.facilityId)+':'+cells.join(','):'',signal=>
    open&&cells.length?managedInventory.cellLocations(refId(r.facilityId),cells,signal):Promise.resolve({} as Awaited<ReturnType<typeof managedInventory.cellLocations>>));
  const specifications=context.data?.specifications??[];
  useEffect(()=>{const firstSpec=specifications[0],firstCell=cells[0];if(firstSpec&&firstCell&&!lines.length)setLines([makeLine(firstSpec._id,firstCell)]);},[specifications,cells,lines.length]);
  useEffect(()=>{if(refreshRevision){context.reload();sessions.reload();stockReadback.reload();cellStockReadback.reload();movementReadback.reload();}},[refreshRevision]);
  const canUseRental=r.status==='ACTIVE'&&Date.parse(r.startDate)<=Date.now()&&Date.parse(r.endDate)>Date.now();
  const specsById=new Map(specifications.map(row=>[row._id,row]));
  const validLines=lines.length>0&&lines.every(line=>{
    const qty=Number(line.quantity),allocations=line.allocations.map(row=>({cellId:row.cellId,quantity:Number(row.quantity)}));
    return !!specsById.get(line.specId)&&Number.isSafeInteger(qty)&&qty>0&&qty<=100000&&allocations.length>0&&
      allocations.every(row=>cells.includes(row.cellId)&&Number.isSafeInteger(row.quantity)&&row.quantity>0)&&
      new Set(allocations.map(row=>row.cellId)).size===allocations.length&&allocations.reduce((sum,row)=>sum+row.quantity,0)===qty;
  });
  function updateLine(targetId:string,update:Partial<DraftLine>){setProof(undefined);setLines(current=>current.map(row=>row.lineId===targetId?{...row,...update}:row));}
  function updateAllocation(targetId:string,index:number,update:Partial<DraftAllocation>){setProof(undefined);setLines(current=>current.map(row=>row.lineId===targetId?{...row,allocations:row.allocations.map((allocation,i)=>i===index?{...allocation,...update}:allocation)}:row));}
  const request=()=>buildUnifiedInboundRequest({accessSessionId:session?._id??'',sessionRevision:session?.revision??-1,skuRevision:context.data?.skuRevision??-1,
    lines:lines.map(line=>({lineId:line.lineId,itemSpecId:line.specId,itemSpecRevision:specsById.get(line.specId)?.revision??-1,quantity:Number(line.quantity),measurementMode:'SPECIFICATION',
      cellAllocations:line.allocations.map(row=>({cellId:row.cellId,quantity:Number(row.quantity)}))}))});

  async function currentInboundSession(sessionId:string,revision:number,body?:InboundRequest){
    const latest=await managedReservationReads.session(r,owner,sessionId);
    const allowed=latest?eligibleInboundCells(r,latest):[];
    const requested=body?.lines.flatMap(line=>line.cellAllocations.map(row=>row.cellId))??[];
    if(!latest||!managedSessionEligibility(latest,{customerId:owner,facilityId:refId(r.facilityId),reservationId:r._id,purpose:'INBOUND',primaryReservationOnly:true,
      revision,cellIds:requested}).eligible||allowed.length===0||requested.some(cell=>!allowed.includes(cell)))
      throw new Error('Phiên nhập đã hết hạn, bị thu hồi hoặc thay đổi. Tải lại phiên trước khi tiếp tục.');
    return latest;
  }
  function movementMatches(movement:any,body:InboundRequest){
    const expected=body.lines.flatMap(line=>line.cellAllocations.map(allocation=>`${line.itemSpecId}|${allocation.cellId}|${allocation.quantity}`)).sort();
    const destination=Array.isArray(movement?.stockEffect?.destination)?movement.stockEffect.destination:[];
    const actual=destination.map((line:any)=>`${String(line.itemSpecId?._id??line.itemSpecId)}|${String(line.cellId?._id??line.cellId)}|${line.quantity}`).sort();
    return movement?.stockEffect?.action==='ADD'&&movement.quantity===body.lines.reduce((sum,line)=>sum+line.quantity,0)&&
      expected.length===actual.length&&expected.every((value,index)=>value===actual[index]);
  }
  async function verifyReadback(movement:any,body:InboundRequest,store:Awaited<ReturnType<typeof journal>>){
    const specIds=[...new Set(body.lines.map(line=>line.itemSpecId))];
    const [stockResult,cellResult,movementResult,...specResults]=await Promise.allSettled([
      managedInboundPreview.stockReadback(item,r,owner),managedInboundPreview.cellStockReadback(item,r,owner),
      managedInboundPreview.movementsReadback(item,r,owner),...specIds.map(specId=>managedInboundPreview.specificationStockReadback(item,r,owner,specId)),
    ]);
    const stock=stockResult.status==='fulfilled'?stockResult.value:undefined,cellStock=cellResult.status==='fulfilled'?cellResult.value:undefined;
    const movements=movementResult.status==='fulfilled'?movementResult.value:undefined;
    const specs=specResults.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
    const diagnostics=[
      inboundReadbackDiagnostic('stock','/v3/stock',stockResult),
      inboundReadbackDiagnostic('cell-stock','/v3/cell-stock',cellResult),
      inboundReadbackDiagnostic('movement-history','/v3/movements',movementResult),
      ...specResults.map(result=>inboundReadbackDiagnostic('specification-cell-stock','/v3/specifications/:id/cell-stock',result)),
    ].filter(row=>row.outcome!=='READ');
    if(diagnostics.length&&__DEV__)console.warn('[managed-inbound-readback]',diagnostics);
    const reasons:string[]=[];
    if(stockResult.status==='rejected'||stock?.reconciliationStatus!=='VERIFIED')reasons.push('Tồn kho chưa được xác minh.');
    if(cellResult.status==='rejected'||cellStock?.reconciliationStatus!=='VERIFIED')reasons.push('Số lượng phân bổ theo ô lưu trữ chưa được xác minh.');
    if(movementResult.status==='rejected'||!movements?.some(row=>row._id===movement._id))reasons.push('Phiếu nhập chưa xuất hiện trong lịch sử hàng hóa.');
    if(specResults.some(result=>result.status==='rejected')||specs.length!==specIds.length||specs.some(row=>row.reconciliationStatus!=='VERIFIED'))reasons.push('Tồn kho theo quy cách hàng hóa chưa được xác minh.');
    if(!movementMatches(movement,body))reasons.push('Phiếu nhập đã ghi nhận không khớp với các dòng hàng và ô lưu trữ trong yêu cầu.');
    for(const line of body.lines){
      const spec=stock?.itemSpecifications.find(row=>row.itemSpecId===line.itemSpecId);
      const specReadback=specs.find(row=>row.itemSpecId===line.itemSpecId);
      if(!spec||!specReadback||line.cellAllocations.some(allocation=>(spec.byCell.find(row=>row.cellId===allocation.cellId)?.quantityOnHand??0)<allocation.quantity||
        (specReadback.byCell.find(row=>row.cellId===allocation.cellId)?.quantityOnHand??0)<allocation.quantity))reasons.push('Số lượng cập nhật chưa khớp với quy cách hàng hóa và ô lưu trữ đã nhập.');
    }
    const quantityByCell=new Map<string,number>();
    for(const line of body.lines)for(const allocation of line.cellAllocations)quantityByCell.set(allocation.cellId,(quantityByCell.get(allocation.cellId)??0)+allocation.quantity);
    if([...quantityByCell].some(([cellId,quantity])=>(cellStock?.byCell.find(row=>row.cellId===cellId)?.quantityOnHand??0)<quantity))
      reasons.push('Tổng tồn đọc lại theo Cell chưa khớp với phiếu nhập vừa ghi nhận.');
    const verified=reasons.length===0;
    setResultState({status:verified?'COMMITTED_AND_READBACK_VERIFIED':'COMMITTED_READBACK_PENDING',movement,stock,cellStock,movements});
    if(!verified){setError(reasons.join(' '));return false;}
    await store.clear();
    if(mounted.current&&useLiveSession.getState().user?._id===owner){
      setCommitted(movement.operationId);setProof(undefined);setRetryAllowed(false);setError('');
      stockReadback.reload();cellStockReadback.reload();movementReadback.reload();context.reload();onCommitted();attemptResource.reload();
    }
    return true;
  }
  async function reconcile(retry:boolean){
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(lock.current||!current())return;
    lock.current=true;setPending(true);setError('');
    try{
      const store=await journal('managed-v3-inbound',owner,item._id);let saved=await store.read();
      if(!current())return;
      if(!retry){
        if(saved||!proof||!session||proof.proof.previewRevision.sessionRevision!==session.revision||
          proof.proof.previewRevision.skuRevision!==context.data?.skuRevision||!canUseRental)return;
        await currentInboundSession(proof.request.accessSessionId,proof.request.sessionRevision,proof.request);
        const latestContext=await managedInboundPreview.context(item,r,owner);
        if(latestContext.skuRevision!==proof.request.skuRevision||proof.request.lines.some(line=>latestContext.specifications.find(spec=>spec._id===line.itemSpecId)?.revision!==line.itemSpecRevision))
          throw new Error('Thông tin hàng hóa hoặc quy cách vừa thay đổi. Hãy tải lại dữ liệu và xem trước lại.');
        saved={...newAttempt(),inboundBody:proof.request};
        if(!await store.claim(saved)||!current())return;
        try{const response=await managedInboundPreview.confirm(item,r,owner,proof.request,saved.key);if(response.status!=='COMMITTED')throw new Error('Phiếu nhập chưa được xác nhận. Hãy kiểm tra trạng thái trước khi tiếp tục.');
          saved={...saved,inboundCommitted:true};await store.write(saved);}
        catch(cause){
          if(axios.isAxiosError(cause)&&[400,401,403,404,409,412,422].includes(cause.response?.status??0)){
            await store.clear();if(current())setProof(undefined);
          }
          throw cause;
        }
      }
      if(!saved||!current())return;
      let movement;
      try{movement=await managedInboundPreview.operation(item,r,owner,saved.key);}
      catch(cause){
        if(axios.isAxiosError(cause)&&cause.response?.status===404&&cause.response.data?.code==='OPERATION_NOT_FOUND'){
          if(!saved.inboundCommitted)setRetryAllowed(true);
          if(saved.inboundCommitted)setResultState({status:'COMMITTED_READBACK_PENDING'});
          setError(saved.inboundCommitted?'Phiếu nhập đã được ghi nhận và đang cập nhật thông tin. Không gửi lại phiếu.':'Chưa tìm thấy kết quả của phiếu nhập. Yêu cầu cũ vẫn được giữ nguyên; hãy kiểm tra lại trước khi gửi lại.');
          return;
        }
        throw cause;
      }
      if(!current())return;
      const stored=saved.inboundBody as Partial<InboundRequest>|undefined;
      const requestBody=buildUnifiedInboundRequest({accessSessionId:String(stored?.accessSessionId??''),sessionRevision:Number(stored?.sessionRevision),
        skuRevision:Number(stored?.skuRevision),lines:Array.isArray(stored?.lines)?stored.lines as InboundRequest['lines']:[]});
      await verifyReadback(movement,requestBody,store);
    }catch(cause){if(current())setError(inboundIssue(cause));}
    finally{lock.current=false;if(current()){setPending(false);attemptResource.reload();}}
  }

  async function retryPending(){
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(lock.current||!current())return;
    lock.current=true;setPending(true);setError('');setRetryAllowed(false);
    try{
      const store=await journal('managed-v3-inbound',owner,item._id),saved=await store.read();
      if(!saved?.inboundBody)throw new Error('Không tìm thấy yêu cầu nhập đã lưu.');
      const stored=saved.inboundBody as Partial<InboundRequest>;
      const body=buildUnifiedInboundRequest({accessSessionId:String(stored.accessSessionId??''),sessionRevision:Number(stored.sessionRevision),
        skuRevision:Number(stored.skuRevision),lines:Array.isArray(stored.lines)?stored.lines as InboundRequest['lines']:[]});
      try{
        const movement=await managedInboundPreview.operation(item,r,owner,saved.key);
        await verifyReadback(movement,body,store);return;
      }catch(cause){
        if(!axios.isAxiosError(cause)||cause.response?.status!==404||cause.response.data?.code!=='OPERATION_NOT_FOUND')throw cause;
      }
      if(saved.inboundCommitted)throw new Error('Phiếu nhập đã được ghi nhận; hãy tiếp tục kiểm tra kết quả và không gửi lại.');
      await currentInboundSession(body.accessSessionId,body.sessionRevision,body);
      const liveContext=await managedInboundPreview.context(item,r,owner);
      if(liveContext.skuRevision!==body.skuRevision||body.lines.some(line=>liveContext.specifications.find(spec=>spec._id===line.itemSpecId)?.revision!==line.itemSpecRevision))
        throw new Error('Thông tin hàng hóa hoặc quy cách đã thay đổi. Không thể gửi lại phiếu đang chờ.');
      const response=await managedInboundPreview.confirm(item,r,owner,body,saved.key);
      if(response.status!=='COMMITTED')throw new Error('Phiếu nhập chưa được xác nhận. Hãy kiểm tra trạng thái trước khi tiếp tục.');
      await store.write({...saved,inboundCommitted:true});
      let movement;
      try{movement=await managedInboundPreview.operation(item,r,owner,saved.key);}
      catch(cause){if(axios.isAxiosError(cause)&&cause.response?.status===404&&cause.response.data?.code==='OPERATION_NOT_FOUND'){
        setResultState({status:'COMMITTED_READBACK_PENDING'});setError('Phiếu nhập đã được ghi nhận và đang cập nhật thông tin. Không gửi lại phiếu.');return;
      }throw cause;}
      await verifyReadback(movement,body,store);
    }catch(cause){if(current())setError(inboundIssue(cause));}
    finally{lock.current=false;if(current()){setPending(false);attemptResource.reload();}}
  }

  useEffect(()=>{
    const saved=attemptResource.data;
    if(!open||attemptResource.loading||attemptResource.error||!saved||autoRecoveryAttempt.current===saved.key)return;
    autoRecoveryAttempt.current=saved.key;
    if(saved.inboundCommitted)setResultState({status:'COMMITTED_READBACK_PENDING'});
    void reconcile(true);
  },[open,attemptResource.data?.key,attemptResource.data?.inboundCommitted,attemptResource.loading,attemptResource.error]);

  async function preview(){
    if(pending||attemptResource.loading||attemptResource.error||attemptResource.data||!canUseRental||!session||!validLines||!context.data)return;
    setPending(true);setError('');setProof(undefined);
    try{
      const latestSession=await managedReservationReads.session(r,owner,session._id);
      if(!latestSession||!managedSessionEligibility(latestSession,{customerId:owner,facilityId:refId(r.facilityId),reservationId:r._id,purpose:'INBOUND',primaryReservationOnly:true,revision:session.revision})
        .eligible||lines.some(line=>line.allocations.some(row=>!eligibleInboundCells(r,latestSession!).includes(row.cellId))))throw new Error('Phiên nhập đã hết hạn hoặc thay đổi. Tải lại danh sách phiên.');
      const latestContext=await managedInboundPreview.context(item,r,owner);
      if(latestContext.skuRevision!==context.data.skuRevision||lines.some(line=>latestContext.specifications.find(spec=>spec._id===line.specId)?.revision!==specsById.get(line.specId)?.revision))
        throw new Error('Thông tin hàng hóa hoặc quy cách đã thay đổi. Tải lại trước khi xem trước.');
      const payload=buildUnifiedInboundRequest({accessSessionId:latestSession._id,sessionRevision:latestSession.revision,skuRevision:latestContext.skuRevision,
        lines:lines.map(line=>({lineId:line.lineId,itemSpecId:line.specId,itemSpecRevision:latestContext.specifications.find(spec=>spec._id===line.specId)!.revision,
          quantity:Number(line.quantity),measurementMode:'SPECIFICATION',cellAllocations:line.allocations.map(row=>({cellId:row.cellId,quantity:Number(row.quantity)}))}))});
      const result=await managedInboundPreview.preview(item,r,owner,latestSession,payload);
      if(mounted.current&&useLiveSession.getState().user?._id===owner)setProof(result);
    }catch(cause){if(mounted.current&&useLiveSession.getState().user?._id===owner)setError(inboundIssue(cause));}
    finally{if(mounted.current)setPending(false);}
  }

  const mutateLine=(id:string,update:Partial<DraftLine>)=>{setProof(undefined);setResultState(undefined);updateLine(id,update);};
  const stockStatus=(value:string)=>value==='VERIFIED'?'Đã xác minh':value==='CHECKING'?'Đang đối soát':'Chưa phát sinh';
  const savedAttempt=attemptResource.data;
  return <Card>
    {!screenMode&&<Button label={open?'Ẩn kiểm tra nhập hàng':'Kiểm tra nhập kho'} variant="outline" disabled={pending} onPress={()=>{setOpen(!open);setProof(undefined);}}/>}
    {open&&<>
      <AppText>Chọn một hoặc nhiều loại hàng, phiên nhập còn hiệu lực và phân bổ đủ số lượng vào các ô được cấp. Xem trước không thay đổi tồn kho.</AppText>
      <ResourceState {...context} resource="thông tin nhập kho"/><ResourceState {...sessions} resource="phiên nhập kho"/>
      {context.data&&specifications.length===0&&<Card><AppText>Hàng hóa chưa có quy cách đang hoạt động.</AppText><Button label="Mở thông tin hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]',params:{id:item._id}})}/></Card>}
      {specifications.length>0&&<>
        <SectionTitle title="Phiên nhập kho"/>
        <View style={ui.wrap}>{usable.map(row=><Filter key={row._id} label={'Đến '+sessionTime.format(new Date(row.expiresAt))+' · '+row.allowedCellIds.length+' ô'} selected={sessionId===row._id}
          onPress={()=>{if(!pending){setSession(row._id);setLines([]);setProof(undefined);}}}/>)}</View>
        {sessions.data&&usable.length===0&&<Card><AppText>Không có phiên nhập kho còn hiệu lực cho các ô của đơn thuê.</AppText><Button label="Xem lịch đến kho" variant="outline" onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits',params:{reservationId:r._id}})}/></Card>}
      </>}
      {session&&<><ResourceState {...cellLabels} resource="tên vị trí"/>
        <SectionTitle title="Các dòng hàng" action={lines.length<50&&specifications.some(spec=>!lines.some(line=>line.specId===spec._id))?'Thêm dòng':undefined} onPress={()=>{const spec=specifications.find(row=>!lines.some(line=>line.specId===row._id)),cell=cells[0];if(!pending&&spec&&cell){const row=makeLine(spec._id,cell);setLines(old=>[...old,row]);setProof(undefined);setResultState(undefined);}}}/>
        {lines.map((line,index)=>{const spec=specsById.get(line.specId);const otherSpecIds=new Set(lines.filter(row=>row.lineId!==line.lineId).map(row=>row.specId));return <Card key={line.lineId}>
          <SectionTitle title={`Dòng ${index+1}`} action={lines.length>1?'Xóa dòng':undefined} onPress={()=>{setLines(rows=>rows.filter(row=>row.lineId!==line.lineId));setProof(undefined);setResultState(undefined);}}/>
          <View style={ui.wrap}>{specifications.map(row=><Filter key={row._id} label={`${row.code} · ${row.name}`} selected={line.specId===row._id} onPress={()=>{if(!pending&&!otherSpecIds.has(row._id))mutateLine(line.lineId,{specId:row._id});}}/>)}</View>
          {spec&&<AppText variant="caption">ĐVT {spec.quantityUnit} · {spec.unitWeightKg} kg/đơn vị · {spec.dimensionsM.widthM} × {spec.dimensionsM.depthM} × {spec.dimensionsM.heightM} m · phiên bản {spec.revision}</AppText>}
          <Input label="Số lượng dòng hàng" value={line.quantity} keyboardType="number-pad" editable={!pending} onChangeText={value=>mutateLine(line.lineId,{quantity:value})}/>
          <SectionTitle title="Phân bổ theo ô lưu trữ" action={line.allocations.length<cells.length?'Thêm ô':undefined} onPress={()=>{const selected=new Set(line.allocations.map(row=>row.cellId));const next=cells.find(cell=>!selected.has(cell));if(next&&!pending){updateLine(line.lineId,{allocations:[...line.allocations,{cellId:next,quantity:'1'}]});}}}/>
          {line.allocations.map((allocation,allocationIndex)=>{const selected=new Set(line.allocations.filter((_,i)=>i!==allocationIndex).map(row=>row.cellId));return <Card key={allocationIndex} style={{padding:12}}>
            <ManagedCellLocationCard cellId={allocation.cellId} location={cellLabels.data?.[allocation.cellId]} title={`Vị trí phân bổ ${allocationIndex+1}`}/>
            {cells.map(cell=><Filter key={cell} label={cellLabels.data?.[cell]?.cellNumber!=null?`Ô L${cellLabels.data[cell]!.levelNumber??'—'}-C${cellLabels.data[cell]!.cellNumber}`:'Chọn ô lưu trữ'} selected={allocation.cellId===cell} onPress={()=>{if(!pending&&!selected.has(cell))updateAllocation(line.lineId,allocationIndex,{cellId:cell});}}/>)}
            <Input label={`Số lượng tại ô ${allocationIndex+1} (${spec?.quantityUnit??'đơn vị'})`} value={allocation.quantity} keyboardType="number-pad" editable={!pending} onChangeText={value=>updateAllocation(line.lineId,allocationIndex,{quantity:value})}/>
            {line.allocations.length>1&&<Button label="Bỏ phân bổ ô này" variant="quiet" onPress={()=>updateLine(line.lineId,{allocations:line.allocations.filter((_,i)=>i!==allocationIndex)})}/>}
          </Card>;})}
          {!validLines&&<AppText variant="caption">Tổng phân bổ phải bằng số lượng dòng; mỗi Cell chỉ xuất hiện một lần.</AppText>}
        </Card>;})}
        <Button label="Xem trước nhập kho" loading={pending} disabled={!canUseRental||!context.data||!session||!validLines||lines.length>50||attemptResource.loading||!!attemptResource.error||!!attemptResource.data} onPress={()=>void preview()}/>
      </>}
      {proof&&<Card><Chip label="Đã kiểm tra · chưa ghi tồn kho"/><AppText variant="card">Kết quả xem trước</AppText>{proof.proof.lines.map(line=><AppText key={line.lineId}>{line.itemName} ({line.itemCode}): {line.quantity} {line.quantityUnit} · {line.totalWeightKg} kg · {line.totalVolumeM3} m³</AppText>)}<AppText>Tổng: {proof.proof.totalQuantity} đơn vị · {proof.proof.totalWeightKg} kg · {proof.proof.totalVolumeM3} m³</AppText>{proof.proof.lines.flatMap(line=>line.cellAllocations).map((row,index)=><ManagedCellLocationCard key={`${row.cellId}-${index}`} cellId={row.cellId} location={cellLabels.data?.[row.cellId]} title="Vị trí phân bổ" detail={`Còn tải trọng ${row.remainingWeightAfterKg??'—'} kg · thể tích ${row.remainingVolumeAfterM3??'—'} m³`}/>)}{proof.proof.warnings.map((warning,index)=><AppText key={index}>{warning}</AppText>)}</Card>}
      {savedAttempt&&<><ResourceState {...attemptResource}/><AppText variant="caption">Phiếu nhập đang được kiểm tra. Vui lòng không gửi lại để tránh trùng hàng.</AppText><Button label="Tra cứu và đối soát lại" variant="outline" loading={pending} onPress={()=>void reconcile(true)}/>{retryAllowed&&!savedAttempt.inboundCommitted&&<Button label="Gửi lại cùng yêu cầu và khóa" variant="outline" loading={pending} onPress={()=>void retryPending()}/>}</>}
      {proof&&!savedAttempt&&<Button label="Xác nhận nhập kho" loading={pending} disabled={attemptResource.loading||!!attemptResource.error||!session||proof.proof.previewRevision.sessionRevision!==session.revision} onPress={()=>void reconcile(false)}/>}
      {resultState&&<Card><Chip label={resultState.status==='COMMITTED_AND_READBACK_VERIFIED'?'Đã ghi nhận và xác minh':'Đã ghi nhận · đang cập nhật thông tin'} tone={resultState.status==='COMMITTED_AND_READBACK_VERIFIED'?'green':'orange'}/>
        <AppText>{resultState.status==='COMMITTED_AND_READBACK_VERIFIED'?'Phiếu nhập đã được ghi nhận; tồn kho, số lượng tại ô và lịch sử hàng hóa đã được xác minh.':'Phiếu nhập đã được ghi nhận. Tồn kho hoặc lịch sử hàng hóa đang được cập nhật; không gửi lại phiếu.'}</AppText>
        {resultState.movement&&<AppText>Mã phiếu {resultState.movement.operationId} · {resultState.movement.quantity} {resultState.movement.quantityUnit} · {sessionTime.format(new Date(resultState.movement.performedAt))}</AppText>}
        <Button label="Đối soát lại dữ liệu" variant="outline" loading={pending} onPress={()=>void reconcile(true)}/>
      </Card>}
      {!!committed&&<AppText>Đã ghi nhận phiếu nhập {committed}.</AppText>}
      {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
      <SectionTitle title="Tồn kho hiện tại"/><ResourceState {...stockReadback} resource="Tồn kho"/>
      {stockReadback.data&&<Card><Chip label={stockStatus(stockReadback.data.reconciliationStatus)}/>
        {stockReadback.data.reconciliationStatus==='CHECKING'?<AppText>{stockReadback.data.verificationMessage??'Số liệu tồn kho chưa được xác minh; chưa hiển thị số lượng.'}</AppText>:<>
          <AppText>Tổng: {stockReadback.data.totalQuantity??'—'} đơn vị · {stockReadback.data.totalWeightKg??'—'} kg · {stockReadback.data.totalVolumeM3??'—'} m³</AppText>
          {stockReadback.data.itemSpecifications.map(spec=><AppText key={spec.itemSpecId}>{spec.code} · {spec.name}: {spec.quantityOnHand??'—'} {spec.quantityUnit??'đơn vị'}</AppText>)}
        </>}</Card>}
      <SectionTitle title="Tồn theo vị trí"/><ResourceState {...cellStockReadback} resource="tồn theo vị trí"/>
      {cellStockReadback.data&&<Card><Chip label={stockStatus(cellStockReadback.data.reconciliationStatus)}/>
        {cellStockReadback.data.reconciliationStatus==='CHECKING'?<AppText>{cellStockReadback.data.verificationMessage??'Số lượng theo ô chưa được xác minh.'}</AppText>:
          cellStockReadback.data.byCell.map(cell=><ManagedCellLocationCard key={cell.cellId} cellId={cell.cellId} location={cellLabels.data?.[cell.cellId]} detail={`${cell.quantityOnHand} đơn vị · ${cell.weightKg} kg · ${cell.volumeM3} m³`}/>)}
        {cellStockReadback.data.reconciliationStatus==='NO_ACTIVITY'&&<AppText>Chưa phát sinh tồn theo vị trí.</AppText>}
      </Card>}
      <SectionTitle title="Lịch sử nhập xuất"/><ResourceState {...movementReadback} resource="lịch sử hàng hóa"/>
      {movementReadback.data&&movementReadback.data.slice(0,20).map(row=><Card key={row._id}><AppText variant="label">{movementActionLabel(row)} · {movementIdentifier(row)}</AppText><AppText>{row.quantity} {row.quantityUnit} · {sessionTime.format(new Date(row.performedAt))}</AppText></Card>)}
      {movementReadback.data?.length===0&&<AppText variant="caption">Chưa có phiếu trong lịch sử hàng hóa.</AppText>}
      <AppText variant="caption">Hiển thị tối đa 200 lần cập nhật hàng hóa gần nhất.</AppText>
    </>}
  </Card>;
}
