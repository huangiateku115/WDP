import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {journal,newAttempt} from '../state/attemptJournal';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {eligibleInboundCells,managedInboundPreview} from '../api/managedInboundPreview';
import {managedReservationReads} from '../api/managedReservationReads';
import type {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input} from './ui';
import {ResourceState,useResource} from './liveUI';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
export function ManagedInboundPreviewCard({item,r,owner,onCommitted,initialSessionId}:{item:Item;r:ReservationDto;owner:string;onCommitted:()=>void;initialSessionId?:string}){
  const [open,setOpen]=useState(!!initialSessionId),[kind,setKind]=useState<'A1_PHYSICAL_UNIT'|'A2_BATCH'>('A2_BATCH');
  const [sessionId,setSession]=useState(initialSessionId??''),[unitId,setUnit]=useState(''),[cellId,setCell]=useState('');
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [rotation,setRotation]=useState<0|90>(0);
  const [fields,setFields]=useState({serial:'',weight:String(item.unitWeightKg),width:String(item.unitDimensionsM.widthM),
    depth:String(item.unitDimensionsM.depthM),height:String(item.unitDimensionsM.heightM),x:'',y:''});
  const [proof,setProof]=useState<Awaited<ReturnType<typeof managedInboundPreview.preview>>>();
  const [error,setError]=useState(''),[pending,setPending]=useState(false);
  const lock=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(initialSessionId){setSession(initialSessionId);setOpen(true);}},[initialSessionId]);
  const scope=owner+':'+item._id;
  const [committed,setCommitted]=useState('');
  const attempts=useResource(scope,()=>journal('managed-v3-inbound',owner,item._id).then(store=>store.read()));
  const units=useResource(open?scope:'',signal=>open?managedInboundPreview.units(item,r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const usable=sessions.data?.filter(session=>eligibleInboundCells(r,session).length>0&&(!initialSessionId||session._id===initialSessionId))??[];
  const session=usable.find(row=>row._id===sessionId);
  const cells=session?eligibleInboundCells(r,session):[];
  const number=(value:string)=>value.trim()?Number(value.replace(',','.')):NaN;
  const dimensionsM={widthM:number(fields.width),depthM:number(fields.depth),heightM:number(fields.height)};
  const actualUnitWeightKg=number(fields.weight);
  const field=(key:keyof typeof fields,label:string,numeric=true)=><Input label={label} value={fields[key]} editable={!pending}
    keyboardType={numeric?'decimal-pad':'default'} onChangeText={value=>{setFields({...fields,[key]:value});setProof(undefined);}}/>;

  async function run(action:'prepare'|'preview'){
    if(lock.current||attempts.loading||attempts.error||attempts.data||useLiveSession.getState().user?._id!==owner)return;
    lock.current=true;setPending(true);setError('');setProof(undefined);
    try{
      if(action==='prepare'){
        await managedInboundPreview.prepare(item,r,owner,{serial:fields.serial,actualUnitWeightKg,dimensionsM});
        units.reload();
      }else if(session){
        const placements=cells.filter(id=>!!counts[id]?.trim()).map(id=>({cellId:id,quantity:number(counts[id]!)}));
        const payload=kind==='A1_PHYSICAL_UNIT'
          ? {itemKind:kind,accessSessionId:session._id,physicalUnitId:unitId,cellIds:[cellId],
            pose:{xStartM:number(fields.x),yStartM:number(fields.y),rotationDeg:rotation}}
          : {itemKind:kind,accessSessionId:session._id,cellIds:placements.map(row=>row.cellId),placements,
            quantity:placements.reduce((n,row)=>n+row.quantity,0),quantityUnit:item.quantityUnit,actualUnitWeightKg,dimensionsM};
        const result=await managedInboundPreview.preview(item,r,owner,session,payload);
        if(mounted.current&&useLiveSession.getState().user?._id===owner)setProof(result);
      }
    }catch(cause){if(mounted.current&&useLiveSession.getState().user?._id===owner)setError(apiIssue(cause));}
    finally{lock.current=false;if(mounted.current)setPending(false);}
  }

  async function confirm(recover:boolean){
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(lock.current||!current())return;
    lock.current=true;setPending(true);setError('');
    try{
      const store=await journal('managed-v3-inbound',owner,item._id);
      let saved=await store.read();
      if(!current())return;
      if(!recover){
        if(saved||!proof||!session||proof.sessionRevision!==session.revision||Date.parse(proof.expiresAt)<=Date.now())return;
        if(proof.cellIds.some(id=>!eligibleInboundCells(r,session).includes(id)))return;
        const topology=proof.itemKind==='A1_PHYSICAL_UNIT'
          ? {topologyCertificationId:proof.topologyCertificationId,topologyRevision:proof.topologyRevision}
          : {topologyCertificationIds:proof.topologyCertificationIds,topologyRevisions:proof.topologyRevisions};
        const inboundBody={...proof.request,...topology,sessionRevision:proof.sessionRevision,previewRevision:proof.previewRevision};
        saved={...newAttempt(),inboundBody};
        if(!await store.claim(saved)||!current())return;
        try{await managedInboundPreview.confirm(item,r,owner,inboundBody,saved.key);}
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
        if(!recover||!saved.inboundBody||!current()||!axios.isAxiosError(cause)||
          cause.response?.status!==404||cause.response.data?.code!=='OPERATION_NOT_FOUND')throw cause;
        const active=sessions.data?.find(row=>row._id===saved?.inboundBody?.accessSessionId);
        const cells=saved.inboundBody.cellIds;
        if(!active||active.revision!==saved.inboundBody.sessionRevision||!Array.isArray(cells)||
          !cells.length||cells.some(id=>!eligibleInboundCells(r,active).includes(id)))throw cause;
        await managedInboundPreview.confirm(item,r,owner,saved.inboundBody,saved.key);
        if(!current())return;
        movement=await managedInboundPreview.operation(item,r,owner,saved.key);
      }
      if(!current())return;
      await store.clear();
      if(current()){setProof(undefined);setCommitted(movement.operationId);units.reload();onCommitted();}
    }catch(cause){if(current())setError(apiIssue(cause));}
    finally{lock.current=false;if(current()){setPending(false);attempts.reload();}}
  }

  return <Card>
    <Button label={open?'Ẩn kiểm tra nhập hàng':'Kiểm tra vị trí nhập hàng'} variant="outline" disabled={pending} onPress={()=>{setOpen(!open);setProof(undefined);}}/>
    {open&&<>
      <AppText>Chuẩn bị kiện và kiểm tra vị trí. Chỉ thao tác xác nhận nhập hàng mới thay đổi tồn kho.</AppText>
      {!attempts.data&&!attempts.loading&&!attempts.error&&<>
      <Button label={kind==='A2_BATCH'?'Chuyển sang kiện riêng A1':'Chuyển sang lô A2'} variant="quiet" disabled={pending}
        onPress={()=>{setKind(kind==='A2_BATCH'?'A1_PHYSICAL_UNIT':'A2_BATCH');setProof(undefined);}}/>
      {kind==='A1_PHYSICAL_UNIT'&&<>
        <ResourceState {...units}/>
        {field('serial','Mã kiện',false)}
      </>}
      {field('weight','Khối lượng một đơn vị (kg)')}{field('width','Rộng (m)')}{field('depth','Sâu (m)')}{field('height','Cao (m)')}
      {kind==='A1_PHYSICAL_UNIT'&&<>
        <Button label="Chuẩn bị kiện" variant="outline" disabled={!fields.serial.trim()} loading={pending} onPress={()=>void run('prepare')}/>
        {units.data?.filter(unit=>unit.state==='PREPARED').map(unit=><Filter key={unit._id} label={unit.serial} selected={unitId===unit._id}
          onPress={()=>{if(!pending){setUnit(unit._id);setProof(undefined);}}}/>)}
      </>}
      <ResourceState {...sessions}/>
      {sessions.data&&usable.length===0&&<AppText>Cần phiên INBOUND đang hoạt động với ô thuộc đơn thuê.</AppText>}
      {usable.map(row=><Filter key={row._id} label={'Phiên '+row._id.slice(-6)} selected={sessionId===row._id}
        onPress={()=>{if(!pending){setSession(row._id);setCell('');setCounts({});setProof(undefined);}}}/>)}
      {kind==='A1_PHYSICAL_UNIT'?<>
        {cells.map(id=><Filter key={id} label={'Ô '+id} selected={cellId===id} onPress={()=>{if(!pending){setCell(id);setProof(undefined);}}}/>)}
        {field('x','Tọa độ X (m)')}{field('y','Tọa độ Y (m)')}
        <Button label={'Góc xoay '+rotation+'°'} variant="quiet" disabled={pending} onPress={()=>{setRotation(rotation===0?90:0);setProof(undefined);}}/>
      </>:cells.map(id=><Input key={id} label={'Số lượng cho ô '+id} value={counts[id]??''} keyboardType="number-pad" editable={!pending}
        onChangeText={value=>{setCounts({...counts,[id]:value});setProof(undefined);}}/>)}
      <Button label="Kiểm tra vị trí trên máy chủ" loading={pending} disabled={!session||!cells.length||
        (kind==='A1_PHYSICAL_UNIT'?(!unitId||!cellId||!fields.x.trim()||!fields.y.trim()):!cells.some(id=>!!counts[id]?.trim()))}
        onPress={()=>void run('preview')}/>
      {proof&&session&&proof.sessionRevision===session.revision&&Date.parse(proof.expiresAt)>Date.now()&&<><AppText>Kết quả kiểm tra: {proof.quantity} · {proof.weightKg} kg · {proof.volumeM3} m³.</AppText><AppText>Phiên bản kiểm tra SKU: {proof.previewRevision}</AppText></>}
      </>}
      <ResourceState {...attempts}/>
      {attempts.data?<Button label="Kiểm tra thao tác nhập đã gửi" loading={pending} onPress={()=>void confirm(true)}/>:null}
      {proof&&!attempts.data?<Button label="Xác nhận nhập hàng" loading={pending} disabled={attempts.loading||!!attempts.error}
        onPress={()=>void confirm(false)}/>:null}
      {!!committed&&<AppText>Máy chủ đã ghi nhận: {committed}</AppText>}
      {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    </>}
  </Card>;
}
