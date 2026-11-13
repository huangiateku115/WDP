import {useEffect,useRef,useState} from 'react';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {eligibleInboundCells,managedInboundPreview} from '../api/managedInboundPreview';
import {managedReservationReads} from '../api/managedReservationReads';
import type {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input} from './ui';
import {ResourceState,useResource} from './liveUI';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
export function ManagedInboundPreviewCard({item,r,owner}:{item:Item;r:ReservationDto;owner:string}){
  const [open,setOpen]=useState(false),[kind,setKind]=useState<'A1_PHYSICAL_UNIT'|'A2_BATCH'>('A2_BATCH');
  const [sessionId,setSession]=useState(''),[unitId,setUnit]=useState(''),[cellId,setCell]=useState('');
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [rotation,setRotation]=useState<0|90>(0);
  const [fields,setFields]=useState({serial:'',weight:String(item.unitWeightKg),width:String(item.unitDimensionsM.widthM),
    depth:String(item.unitDimensionsM.depthM),height:String(item.unitDimensionsM.heightM),x:'',y:''});
  const [proof,setProof]=useState<Awaited<ReturnType<typeof managedInboundPreview.preview>>>();
  const [error,setError]=useState(''),[pending,setPending]=useState(false);
  const lock=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scope=owner+':'+item._id;
  const units=useResource(open?scope:'',signal=>open?managedInboundPreview.units(item,r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const usable=sessions.data?.filter(session=>eligibleInboundCells(r,session).length>0)??[];
  const session=usable.find(row=>row._id===sessionId);
  const cells=session?eligibleInboundCells(r,session):[];
  const number=(value:string)=>value.trim()?Number(value.replace(',','.')):NaN;
  const dimensionsM={widthM:number(fields.width),depthM:number(fields.depth),heightM:number(fields.height)};
  const actualUnitWeightKg=number(fields.weight);
  const field=(key:keyof typeof fields,label:string,numeric=true)=><Input label={label} value={fields[key]} editable={!pending}
    keyboardType={numeric?'decimal-pad':'default'} onChangeText={value=>{setFields({...fields,[key]:value});setProof(undefined);}}/>;

  async function run(action:'prepare'|'preview'){
    if(lock.current||useLiveSession.getState().user?._id!==owner)return;
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

  return <Card>
    <Button label={open?'Ẩn kiểm tra nhập hàng':'Kiểm tra vị trí nhập hàng'} variant="outline" disabled={pending} onPress={()=>{setOpen(!open);setProof(undefined);}}/>
    {open&&<>
      <AppText>Chuẩn bị kiện và kiểm tra vị trí. Chỉ thao tác xác nhận nhập hàng mới thay đổi tồn kho.</AppText>
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
      <AppText>Xác nhận nhập hàng chưa mở trên Mobile.</AppText>
      {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    </>}
  </Card>;
}
