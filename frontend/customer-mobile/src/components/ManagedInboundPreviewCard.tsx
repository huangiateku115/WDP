import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {journal,newAttempt} from '../state/attemptJournal';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {eligibleInboundCells,buildUnifiedInboundRequest,managedInboundPreview} from '../api/managedInboundPreview';
import {managedReservationReads} from '../api/managedReservationReads';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input} from './ui';
import {ResourceState,useResource} from './liveUI';
import type {mobileRepo} from '../api/mobileRepository';

const sessionTime=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type InboundRequest=ReturnType<typeof buildUnifiedInboundRequest>;

export function ManagedInboundPreviewCard({item,r,owner,onCommitted,initialSessionId}:{item:Item;r:ReservationDto;owner:string;onCommitted:()=>void;initialSessionId?:string}){
  const [open,setOpen]=useState(!!initialSessionId),[sessionId,setSession]=useState(initialSessionId??''),[specId,setSpec]=useState('');
  const [counts,setCounts]=useState<Record<string,string>>({}),[proof,setProof]=useState<Awaited<ReturnType<typeof managedInboundPreview.preview>>>();
  const [error,setError]=useState(''),[pending,setPending]=useState(false),[committed,setCommitted]=useState('');
  const lock=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(initialSessionId){setSession(initialSessionId);setOpen(true);}},[initialSessionId]);
  const scope=owner+':'+item._id;
  const attemptResource=useResource(scope,()=>journal('managed-v3-inbound',owner,item._id).then(store=>store.read()));
  const context=useResource(open?scope:'',signal=>open?managedInboundPreview.context(item,r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const usable=sessions.data?.filter(session=>eligibleInboundCells(r,session).length>0&&(!initialSessionId||session._id===initialSessionId))??[];
  const session=usable.find(row=>row._id===sessionId),cells=session?eligibleInboundCells(r,session):[];
  const specifications=context.data?.specifications??[],spec=specifications.find(row=>row._id===specId);
  useEffect(()=>{if(!specId&&specifications[0])setSpec(specifications[0]._id);},[specId,specifications]);
  useEffect(()=>{if(session){setCounts(current=>Object.keys(current).length?current:Object.fromEntries(cells.map(cell=>[cell,''])));}},[sessionId,session?.revision]);
  const canUseRental=r.status==='ACTIVE'&&Date.parse(r.startDate)<=Date.now()&&Date.parse(r.endDate)>Date.now();
  const selectedAllocations=cells.filter(cell=>!!counts[cell]?.trim()).map(cell=>({cellId:cell,quantity:Number(counts[cell])}));
  const totalQuantity=selectedAllocations.reduce((sum,row)=>sum+row.quantity,0);
  const validCounts=selectedAllocations.length>0&&selectedAllocations.every(row=>Number.isSafeInteger(row.quantity)&&row.quantity>0);

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
        saved={...newAttempt(),inboundBody:proof.request};
        if(!await store.claim(saved)||!current())return;
        try{await managedInboundPreview.confirm(item,r,owner,proof.request,saved.key);}
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
        if(!retry||!saved.inboundBody||!current()||!axios.isAxiosError(cause)||cause.response?.status!==404||
          cause.response.data?.code!=='OPERATION_NOT_FOUND')throw cause;
        const stored=saved.inboundBody as Partial<InboundRequest>|undefined;
        let restored:InboundRequest;
        try{restored=buildUnifiedInboundRequest({accessSessionId:String(stored?.accessSessionId??''),sessionRevision:Number(stored?.sessionRevision),
          skuRevision:Number(stored?.skuRevision),lines:Array.isArray(stored?.lines)?stored.lines as InboundRequest['lines']:[]});}catch{throw cause;}
        const active=sessions.data?.find(row=>row._id===restored.accessSessionId),allowed=active?eligibleInboundCells(r,active):[];
        const cellIds=restored.lines.flatMap(line=>line.cellAllocations.map(row=>String(row.cellId)));
        if(!active||active.revision!==restored.sessionRevision||!cellIds.length||cellIds.some(cell=>!allowed.includes(cell)))throw cause;
        await managedInboundPreview.confirm(item,r,owner,restored,saved.key);
        if(!current())return;movement=await managedInboundPreview.operation(item,r,owner,saved.key);
      }
      if(!current())return;
      await store.clear();
      if(current()){setProof(undefined);setCommitted(movement.operationId);context.reload();onCommitted();}
    }catch(cause){if(current())setError(apiIssue(cause));}
    finally{lock.current=false;if(current()){setPending(false);attemptResource.reload();}}
  }

  async function preview(){
    if(pending||attemptResource.loading||attemptResource.error||attemptResource.data||!canUseRental||!session||!spec||!validCounts||!context.data)return;
    setPending(true);setError('');setProof(undefined);
    try{
      const request=buildUnifiedInboundRequest({accessSessionId:session._id,sessionRevision:session.revision,skuRevision:context.data.skuRevision,
        lines:[{lineId:'mobile-inbound-1',itemSpecId:spec._id,itemSpecRevision:spec.revision,quantity:totalQuantity,
          measurementMode:'SPECIFICATION',cellAllocations:selectedAllocations}]});
      const result=await managedInboundPreview.preview(item,r,owner,session,request);
      if(mounted.current&&useLiveSession.getState().user?._id===owner)setProof(result);
    }catch(cause){if(mounted.current&&useLiveSession.getState().user?._id===owner)setError(apiIssue(cause));}
    finally{if(mounted.current)setPending(false);}
  }

  return <Card>
    <Button label={open?'Ẩn kiểm tra nhập hàng':'Kiểm tra nhập kho'} variant="outline" disabled={pending} onPress={()=>{setOpen(!open);setProof(undefined);}}/>
    {open&&<>
      <AppText>Chọn Item Specification, phiên INBOUND và phân bổ số lượng vào các ô được cấp. Xem trước chỉ kiểm tra; xác nhận mới ghi tồn kho.</AppText>
      <AppText variant="caption">Kiện riêng A1 hiện chưa khả dụng: Backend chưa mở Physical Unit API (HTTP 410). Không có request A1 nào được gửi.</AppText>
      <ResourceState {...context}/><ResourceState {...sessions}/>
      {context.data&&specifications.length===0&&<AppText>SKU chưa có Item Specification hoạt động. Hãy tạo loại hàng trước khi nhập.</AppText>}
      {specifications.map(row=><Filter key={row._id} label={`${row.code} · ${row.name} · ${row.quantityUnit}`} selected={specId===row._id}
        onPress={()=>{if(!pending){setSpec(row._id);setProof(undefined);}}}/>)}
      {usable.map(row=><Filter key={row._id} label={'Phiên nhập hàng · hết hạn '+sessionTime.format(new Date(row.expiresAt))} selected={sessionId===row._id}
        onPress={()=>{if(!pending){setSession(row._id);setCounts({});setProof(undefined);}}}/>)}
      {sessions.data&&usable.length===0&&<AppText>Cần phiên INBOUND còn hiệu lực và bao phủ các ô được cấp.</AppText>}
      {session&&cells.map(cell=><Input key={cell} label={`Số lượng tại ô ${cell}`} value={counts[cell]??''} keyboardType="number-pad" editable={!pending}
        onChangeText={value=>{setCounts(current=>({...current,[cell]:value}));setProof(undefined);}}/>)}
      <Button label="Xem trước nhập kho" loading={pending} disabled={!canUseRental||!context.data||!spec||!session||!validCounts||attemptResource.loading||!!attemptResource.error||!!attemptResource.data} onPress={()=>void preview()}/>
      {proof&&<Card><AppText variant="card">Kết quả kiểm tra</AppText>{proof.proof.lines.map(line=><AppText key={line.lineId}>{line.itemName}: {line.quantity} {line.quantityUnit} · {line.totalWeightKg} kg · {line.totalVolumeM3} m³</AppText>)}<AppText>Tổng: {proof.proof.totalQuantity} đơn vị · {proof.proof.totalWeightKg} kg · {proof.proof.totalVolumeM3} m³</AppText>{proof.proof.lines.flatMap(line=>line.cellAllocations).map(row=><AppText key={row.cellId}>Ô {row.cellCode||row.cellId} · thêm {row.addedWeightKg} kg, {row.addedVolumeM3} m³</AppText>)}</Card>}
      <ResourceState {...attemptResource}/>
      {attemptResource.data&&<Button label="Đối soát lần nhập đang chờ" loading={pending} onPress={()=>void reconcile(true)}/>}
      {proof&&!attemptResource.data&&<Button label="Xác nhận nhập kho" loading={pending} disabled={attemptResource.loading||!!attemptResource.error||!session||proof.proof.previewRevision.sessionRevision!==session.revision} onPress={()=>void reconcile(false)}/>}
      {!!committed&&<AppText>Backend đã xác nhận phiếu nhập {committed}.</AppText>}
      {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    </>}
  </Card>;
}
