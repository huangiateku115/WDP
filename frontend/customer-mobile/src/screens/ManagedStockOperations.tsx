import {useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import axios from 'axios';
import {apiIssue} from '../api/client';
import {managedStockOperations} from '../api/managedStockOperations';
import {managedInventory} from '../api/managedInventory';
import {managedReservationReads} from '../api/managedReservationReads';
import {mobileRepo} from '../api/mobileRepository';
import {refId} from '../api/contracts/core';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';

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
function StockOperationBase({mode}:{mode:'OUTBOUND'|'RELOCATION'}){
  const {id}=useLocalSearchParams<{id:string}>();const owner=useLiveSession(s=>s.user?._id??'');const router=useRouter();
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const rental=useResource(owner+':'+id+':rental',signal=>item.data?managedInventory.rental(refId(item.data.managedReservationId),owner,refId(item.data.facilityId),signal):Promise.resolve(null));
  const context=useResource<unknown>(owner+':'+id+':context:'+mode,()=>item.data?(mode==='OUTBOUND'?managedStockOperations.outboundContext(item.data,owner):managedStockOperations.relocationContext(item.data,owner)):Promise.resolve(null));
  const sessions=useResource(owner+':'+id+':sessions:'+mode,signal=>rental.data?managedReservationReads.sessions(rental.data,owner,signal):Promise.resolve(null));
  const [specId,setSpecId]=useState(''),[receiptId,setReceiptId]=useState(''),[cellId,setCellId]=useState(''),[destinationId,setDestinationId]=useState(''),[instanceIds,setInstanceIds]=useState<string[]>([]);
  const [sessionId,setSessionId]=useState(''),[quantity,setQuantity]=useState('1'),[physical,setPhysical]=useState(false);
  const [proof,setProof]=useState<any>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[done,setDone]=useState(false);const lock=useRef(false);
  type UiInstance={itemInstanceId:string;reservationId?:string;quantity:number;weightKg:number;volumeM3:number;allocations?:{cellId:string;cellCode?:string|null}[]};
  type UiSpec={itemSpecId:string;code:string;name:string;revision:number;quantityAvailable:number;stockKind?:string;receipts:{receiptId:string;cellId:string;cellCode:string|null;quantityAvailable:number;reservationId?:string}[];instances?:UiInstance[]};
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
  const activeSessions=(sessions.data??[]).filter(s=>s.status==='ACTIVE'&&Date.parse(s.expiresAt)>Date.now()&&s.allowedPurposes.includes(mode));
  function candidate(){
    const skuRevision=mode==='OUTBOUND'?outboundContext!.stock.skuRevision:relocationContext!.sku.revision;
    const session=activeSessions.find(s=>s._id===sessionId);if(!session||!selectedSpec||!selectedReceipt||!rental.data)throw Error('Chọn loại hàng, phiếu nhập và phiên truy cập còn hiệu lực.');
    const qty=number(quantity);if(!Number.isSafeInteger(qty)||qty<1)throw Error('Số lượng phải là số nguyên dương.');
    if(mode==='OUTBOUND'){
      if(selectedSpec.stockKind==='MIXED_UNSUPPORTED')throw Error('Tồn kho có hai hình thức chưa thể xử lý cùng lúc. Vui lòng liên hệ hỗ trợ trước khi xuất.');
      if(instanceIds.length){if(selectedReceipt||instanceIds.some(value=>!instances.some(row=>row.itemInstanceId===value)))throw Error('Không thể trộn lựa chọn receipt và kiện nguyên khối.');
        return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,reservationId:rental.data._id,
          lines:[{lineId:'line-1',itemSpecId:selectedSpec.itemSpecId,itemSpecRevision:selectedSpec.revision,quantity:instanceIds.length,itemInstanceIds:instanceIds}],
          physicalRemovalConfirmed:true,customerAttestation:'CUSTOMER_CONFIRMED_PHYSICAL_REMOVAL'};}
      if(!selectedReceipt||qty>selectedReceipt.quantityAvailable)throw Error('Số lượng vượt tồn khả dụng của receipt đã chọn.');
      return {accessSessionId:session._id,sessionRevision:session.revision,skuRevision,reservationId:rental.data._id,
        lines:[{lineId:'line-1',itemSpecId:selectedSpec.itemSpecId,itemSpecRevision:selectedSpec.revision,quantity:qty,
          cellAllocations:[{cellId:selectedReceipt.cellId,quantity:qty,receiptId:selectedReceipt.receiptId}]}],
        physicalRemovalConfirmed:true,customerAttestation:'CUSTOMER_CONFIRMED_PHYSICAL_REMOVAL'};
    }
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
    try{const body=candidate(),session=activeSessions.find(s=>s._id===sessionId)!;const result=mode==='OUTBOUND'
      ?await managedStockOperations.outboundPreview(item.data!,rental.data!,owner,session,body)
      :await managedStockOperations.relocationPreview(item.data!,rental.data!,owner,session,body);
      setProof({result,body});
    }catch(cause){setError(cause instanceof Error&&!axios.isAxiosError(cause)?cause.message:apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  async function confirm(){if(lock.current||!proof)return;lock.current=true;setPending(true);setError('');
    try{const store=await journal('managed-v3-inbound',owner,`${mode}:${id}:${rental.data?._id}`);let attempt=await store.read();
      if(!attempt){attempt={...newAttempt(),resourceId:id,inboundBody:{mode,body:proof.body}};if(!await store.claim(attempt))throw Error('Một yêu cầu đang được xử lý.');}
      if(attempt.resourceId!==id||attempt.inboundBody?.mode!==mode)throw Error('Yêu cầu đã lưu không khớp SKU/thao tác.');
      const saved=attempt.inboundBody.body;
      if(mode==='OUTBOUND')await managedStockOperations.outboundConfirm(item.data!,rental.data!,owner,saved,attempt.key);
      else await managedStockOperations.relocationConfirm(item.data!,owner,saved,attempt.key);
      await store.clear();setDone(true);setProof(undefined);context.reload();
    }catch(cause){if(axios.isAxiosError(cause)&&[400,403,404,409,412,422].includes(cause.response?.status??0))await journal('managed-v3-inbound',owner,`${mode}:${id}:${rental.data?._id}`).then(store=>store.clear());setError(apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  async function recover(){if(lock.current)return;lock.current=true;setPending(true);setError('');try{
    const store=await journal('managed-v3-inbound',owner,`${mode}:${id}:${rental.data?._id}`),saved=await store.read();
    if(!saved||saved.resourceId!==id||saved.inboundBody?.mode!==mode)throw Error('Không tìm thấy yêu cầu phù hợp để kiểm tra trạng thái.');
    const result=mode==='OUTBOUND'?await managedStockOperations.outboundOperation(item.data!,owner,saved.key):await managedStockOperations.relocationOperation(item.data!,owner,saved.key);
    if(result.status!=='COMMITTED')throw Error('Chưa xác nhận được thao tác. Hãy tải lại và kiểm tra trạng thái.');await store.clear();setDone(true);context.reload();
  }catch(cause){setError(apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  const title=mode==='OUTBOUND'?'Xuất hàng khỏi kho':'Chuyển vị trí hàng';
  return <LiveScreen title={title} eyebrow="KHO KÝ GỬI" subtitle="Kiểm tra thông tin và xác nhận thao tác trước khi thực hiện." onRefresh={()=>{item.reload();rental.reload();context.reload();sessions.reload();}} refreshing={item.loading||context.loading}>
    <ResourceState {...item}/><ResourceState {...rental}/><ResourceState {...context}/><ResourceState {...sessions}/>
    {context.error&&<StateCard kind="error" title="Thao tác chưa khả dụng" description={apiIssue(context.error)}/>}
    {done&&<StateCard title="Đã ghi nhận thao tác" description="Tải lại để xem số lượng tồn và lịch sử mới nhất."/>}
    <Card><AppText variant="medium">Chọn hàng và phiên</AppText>
      {specs.map(row=><Filter key={row.itemSpecId} label={`${row.code} · ${row.name} · còn ${row.quantityAvailable}`} selected={specId===row.itemSpecId} onPress={()=>{setSpecId(row.itemSpecId);setReceiptId('');setInstanceIds([]);setProof(undefined);}}/>)}
      {receipts.map(row=><Filter key={row.receiptId+':'+row.cellId} label={`Ô ${row.cellCode??row.cellId.slice(-6)} · ${row.quantityAvailable} khả dụng · phiếu ${row.receiptId.slice(-8)}`} selected={receiptId===row.receiptId} onPress={()=>{setReceiptId(row.receiptId);setCellId(row.cellId);setProof(undefined);}}/>)}
      {instances.map(row=><Filter key={row.itemInstanceId} label={`Kiện nguyên khối ${row.itemInstanceId.slice(-10)} · ${row.weightKg} kg · ${row.volumeM3} m³`}
        selected={instanceIds.includes(row.itemInstanceId)} onPress={()=>{setReceiptId('');setInstanceIds(mode==='OUTBOUND'?instanceIds.includes(row.itemInstanceId)?instanceIds.filter(value=>value!==row.itemInstanceId):[...instanceIds,row.itemInstanceId]:[row.itemInstanceId]);setProof(undefined);}}/>)}
      {activeSessions.map(session=><Filter key={session._id} label={`Phiên ${mode==='OUTBOUND'?'xuất':'chuyển'} · đến ${new Date(session.expiresAt).toLocaleTimeString('vi-VN')}`} selected={sessionId===session._id} onPress={()=>{setSessionId(session._id);setProof(undefined);}}/>)}
      {selectedReceipt&&<Input label="Số lượng" value={quantity} onChangeText={v=>{setQuantity(v);setProof(undefined);}} keyboardType="number-pad"/>}
      {mode==='RELOCATION'&&<>{relocationTargets.map(cell=><Filter key={cell.id} label={`${cell.code} · ${cell.reservationCode} · còn ${(cell.maxWeightKg-cell.usedWeightKg).toFixed(1)} kg`} selected={destinationId===cell.id} onPress={()=>{setDestinationId(cell.id);setProof(undefined);}}/>)}</>}
      {mode==='OUTBOUND'&&<Button label={physical?'Đã xác nhận sẽ lấy hàng thực tế':'Xác nhận lấy hàng thực tế'} variant={physical?'primary':'outline'} onPress={()=>setPhysical(!physical)}/>}
      <Button label="Xem trước" loading={pending} disabled={!item.data||!rental.data||!context.data||!selectedSpec||(!selectedReceipt&&!instanceIds.length)||!sessionId||(mode==='OUTBOUND'&&!physical)||(mode==='RELOCATION'&&!destinationId)} onPress={()=>void preview()}/>
    </Card>
    {!!error&&<StateCard kind="error" title="Không thể hoàn tất" description={error}/>}
    {proof&&<Card><AppText variant="medium">Kiểm tra trước khi xác nhận</AppText><AppText>{proof.result.totalQuantity} đơn vị · {proof.result.totalWeightKg} kg · {proof.result.totalVolumeM3} m³</AppText>
      {proof.result.capacity?.map((row:unknown,index:number)=><AppText key={index}>{capacityMessage(row,index)}</AppText>)}
      <AppText variant="caption">Chỉ xác nhận sau khi bạn đã thực hiện thao tác ngoài kho theo hướng dẫn.</AppText>
      <Button label={mode==='OUTBOUND'?'Xác nhận đã xuất hàng':'Xác nhận đã chuyển hàng'} loading={pending} disabled={!proof.result.status||proof.result.status!=='READY'} onPress={()=>void confirm()}/>
    </Card>}
    <Button label="Kiểm tra trạng thái thao tác" variant="outline" disabled={pending||!item.data||!rental.data} onPress={()=>void recover()}/>
    <Button label="Xem chi tiết SKU" variant="quiet" onPress={()=>router.replace({pathname:'/inventory/[id]',params:{id}} as unknown as Href)}/>
  </LiveScreen>;
}
export function ManagedOutboundScreen(){return <StockOperationBase mode="OUTBOUND"/>;}
export function ManagedRelocationScreen(){return <StockOperationBase mode="RELOCATION"/>;}
