import {useEffect,useMemo,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import axios from 'axios';
import {apiIssue} from '../api/client';
import {managedStockOperations} from '../api/managedStockOperations';
import {managedInboundPreview} from '../api/managedInboundPreview';
import {managedInventory} from '../api/managedInventory';
import {managedReservationReads} from '../api/managedReservationReads';
import {mobileRepo} from '../api/mobileRepository';
import {refId} from '../api/contracts/core';
import {buildManagedRelocationRequest,managedRelocationCells,type ManagedRelocationDraft} from '../domain/managedV3Relocation';
import {managedSessionAvailabilityMessage} from '../domain/managedInventoryNavigation';
import {managedSessionEligibility} from '../domain/managedAccessSessionEligibility';
import {managedSessionDiagnostic,sessionFetchDiagnostic} from '../domain/managedSessionDiagnostics';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource,useScreenActive} from '../components/liveUI';
import {ManagedCellLocationCard} from '../components/ManagedCellLocationCard';

type UiSpec={itemSpecId:string;code:string;name:string;revision:number;quantityUnit:string;availableQuantity:number;
  receipts:Array<{receiptId:string;reservationId:string;reservationCode:string|null;cellId:string;cellCode:string|null;quantityOnHand:number;quantityHeld:number;quantityAvailable:number;unitWeightKg:number;unitVolumeM3:number}>;
  instances:Array<{itemInstanceId:string;reservationId:string;reservationCode:string|null;receiptId:string;quantity:1;weightKg:number;volumeM3:number;allocations:Array<{cellId:string;cellCode:string|null;weightKg:number;volumeM3:number}>}>};
type UiCell={id:string;code:string;reservationId:string;reservationCode:string;canReceiveRelocation:boolean;operationalStatus:string;maxWeightKg:number;usedWeightKg:number;maxVolumeM3:number;usedVolumeM3:number;levelNumber:number;managedInventoryRevision:number};
type Draft=ManagedRelocationDraft & {sourceOption:string;instanceSourceCellIds:string[]};
const makeLineId=()=>`move-${Date.now()}-${Math.random().toString(16).slice(2,10)}`;
const newLine=():Draft=>({lineId:makeLineId(),itemSpecId:'',itemSpecRevision:0,kind:'LOT',sourceReservationId:'',destinationReservationId:'',quantity:1,availableQuantity:0,sourceOption:'',instanceSourceCellIds:[]});
const stateLabel=(state:string)=>state==='COMMITTED_AND_READBACK_VERIFIED'?'Đã chuyển hàng và xác minh tồn kho':state==='COMMITTED_READBACK_PENDING'?'Đã ghi nhận chuyển hàng · đang cập nhật tồn kho':state==='FAILED_WITH_BACKEND_EVIDENCE'?'Không thể hoàn tất việc chuyển hàng':'Chưa xác định kết quả chuyển hàng';
const codeMessage:Record<string,string>={
  SOURCE_QUANTITY_UNAVAILABLE:'Tồn khả dụng tại ô nguồn không đủ. Hãy tải lại tồn kho và xem trước phiếu mới.',
  CELL_WEIGHT_CAPACITY_EXCEEDED:'Ô đích không đủ tải trọng cho lượng hàng này.',CELL_VOLUME_CAPACITY_EXCEEDED:'Ô đích không đủ thể tích cho lượng hàng này.',
  LEVEL_WEIGHT_CAPACITY_EXCEEDED:'Tầng kệ đích không đủ tải trọng.',LEVEL_VOLUME_CAPACITY_EXCEEDED:'Tầng kệ đích không đủ dung tích.',
  ACCESS_SESSION_SCOPE_INVALID:'Phiên chuyển hàng không còn hiệu lực hoặc chưa bao gồm các ô đã chọn.',
  DESTINATION_RESERVATION_EXPIRING:'Đơn thuê đích phải còn ít nhất 7 ngày tại thời điểm chuyển.',
  STALE_SKU_REVISION:'Tồn kho vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',ITEM_SPECIFICATION_STALE:'Quy cách hàng hóa vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
  STOCK_HELD:'Lô hàng đang được giữ cho thao tác khác.',CELL_NOT_ALLOCATED:'Ô nguồn hoặc ô đích không còn được cấp cho đơn thuê tương ứng.',
  IDEMPOTENCY_CONFLICT:'Mã thao tác đang có xung đột. Giữ phiếu hiện tại để đối soát.',OUTCOME_UNKNOWN:'Chưa xác định kết quả. Giữ nguyên phiếu và kiểm tra bằng cùng mã đối soát.',
  TRANSACTIONS_UNAVAILABLE:'Chưa thể bắt đầu giao dịch chuyển hàng an toàn; phiếu chưa được ghi nhận.',LEDGER_REPLAY_UNKNOWN:'Sổ tồn chưa thể đối chiếu an toàn.',
  MOVE_RECONCILIATION_UNKNOWN:'Chưa thể xác minh tồn kho sau khi ghi phiếu. Hãy kiểm tra trạng thái thao tác.',
  CAPACITY_RECONCILIATION_UNKNOWN:'Sức chứa ô chưa thể đối chiếu an toàn.',CELL_CAPACITY_UNKNOWN:'Chưa thể xác minh sức chứa ô nguồn/đích.',LEVEL_CAPACITY_UNKNOWN:'Chưa thể xác minh sức chứa kệ hoặc tầng.',
  ITEM_INSTANCE_LOAD_NOT_CONSERVED:'Phân bổ tải mới phải giữ nguyên khối lượng và thể tích của nguyên món.',
};
function relocationIssue(error:unknown){
  const code=axios.isAxiosError(error)?error.response?.data?.code:undefined;
  return typeof code==='string'&&codeMessage[code]?codeMessage[code]!:apiIssue(error);
}
function deterministicNoCommit(error:unknown){
  if(!axios.isAxiosError(error)||!error.response)return false;
  const code=error.response.data?.code;
  return error.response.status<500&&code!=='IDEMPOTENCY_CONFLICT'&&code!=='OUTCOME_UNKNOWN'||code==='TRANSACTIONS_UNAVAILABLE';
}
function cellValue(value:number,places=3){return Number.isFinite(value)?value.toLocaleString('vi-VN',{maximumFractionDigits:places}):'—';}

export default function ManagedRelocationFlow(){
  const {id,sessionId:requestedSessionId}=useLocalSearchParams<{id:string;sessionId?:string|string[]}>();
  const owner=useLiveSession(state=>state.user?._id??''),router=useRouter();
  const screenActive=useScreenActive();
  const requestedSession=Array.isArray(requestedSessionId)?requestedSessionId[0]:requestedSessionId;
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const rental=useResource(owner+':'+id+':relocation-reservation',signal=>item.data?managedInventory.rental(refId(item.data.managedReservationId),owner,refId(item.data.facilityId),signal):Promise.resolve(null));
  const context=useResource(owner+':'+id+':relocation-context',signal=>item.data?managedStockOperations.relocationContext(item.data,owner,signal):Promise.resolve(null));
  const sessions=useResource(owner+':'+id+':relocation-sessions',signal=>rental.data?managedReservationReads.sessions(rental.data,owner,signal):Promise.resolve(null));
  const requestedSessionDetail=useResource(owner+':'+id+':relocation-session-detail:'+requestedSession+':'+(rental.data?._id??''),signal=>
    requestedSession&&rental.data?managedReservationReads.session(rental.data,owner,requestedSession,signal):Promise.resolve(null));
  const [drafts,setDrafts]=useState<Draft[]>([newLine()]),[sessionId,setSessionId]=useState(requestedSession??''),[now,setNow]=useState(()=>Date.now());
  const [preview,setPreview]=useState<any>(null),[attested,setAttested]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [attempt,setAttempt]=useState<any>(null),[journalReady,setJournalReady]=useState(false),[result,setResult]=useState<any>(null),lock=useRef(false);
  useEffect(()=>{if(!rental.data||!owner)return;let mounted=true;void journal('managed-v3-relocation',owner,`${id}:${rental.data._id}`).then(store=>store.read()).then(saved=>{if(mounted)setAttempt(saved);})
    .catch(()=>{if(mounted)setError('Không thể đọc phiếu chuyển đang chờ. Hãy mở lại màn hình để tiếp tục đối soát.');})
    .finally(()=>{if(mounted)setJournalReady(true);});return()=>{mounted=false;};},[owner,id,rental.data?._id]);
  const relocationContext=context.data as any;
  const specs=(relocationContext?.itemSpecifications??[]) as UiSpec[],cells=(relocationContext?.cells??[]) as UiCell[];
  const sessionRows=Array.from(new Map([...(sessions.data??[]),...(requestedSessionDetail.data?[requestedSessionDetail.data]:[])]
    .map(session=>[session._id,session])).values());
  const activeSessions=sessionRows.filter(session=>managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data?.facilityId??''),
    reservationId:rental.data?._id??'',purpose:'RELOCATION',now}).eligible);
  const sessionMessage=managedSessionAvailabilityMessage(sessionRows,rental.data?._id??'',refId(rental.data?.facilityId??''),'RELOCATION',now);
  const sessionReadFailed=!!sessions.error||!!requestedSessionDetail.error;
  const sessionDiagnostics=[
    ...sessionRows.flatMap(session=>{const eligibility=managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data?.facilityId??''),
      reservationId:rental.data?._id??'',purpose:'RELOCATION',now});return eligibility.eligible?[]:[{code:managedSessionDiagnostic(eligibility.reason!,{
        status:session.status,primaryOnly:true,primaryReservationId:refId(session.reservationId),reservationId:rental.data?._id??'',
        scopedReservationIds:(session.scopedReservationIds??[]).map(refId),
      })}];}),
    ...(sessions.error?[sessionFetchDiagnostic('list',sessions.httpStatus,sessions.errorCode)]:[]),
    ...(requestedSessionDetail.error?[sessionFetchDiagnostic('detail',requestedSessionDetail.httpStatus,requestedSessionDetail.errorCode)]:[]),
    ...(requestedSession&&!requestedSessionDetail.loading&&!requestedSessionDetail.error&&!requestedSessionDetail.data?[{code:managedSessionDiagnostic('MISSING')}]:[]),
  ];
  const sessionDiagnosticKey=JSON.stringify(sessionDiagnostics);
  const loggedSessionDiagnostics=useRef('');
  useEffect(()=>{if(__DEV__&&sessionDiagnostics.length&&loggedSessionDiagnostics.current!==sessionDiagnosticKey){
    loggedSessionDiagnostics.current=sessionDiagnosticKey;console.debug('[managed-session-diagnostic]',sessionDiagnostics);
  }},[sessionDiagnosticKey]);
  useEffect(()=>{
    if(!screenActive||!activeSessions.length)return;
    const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);
  },[screenActive,activeSessions.length]);
  useEffect(()=>{
    if(!screenActive||rental.data?.status!=='ACTIVE')return;
    const timer=setInterval(()=>sessions.reload(),60000);return()=>clearInterval(timer);
  },[screenActive,rental.data?.status,sessions.reload]);
  useEffect(()=>{if(requestedSession)setSessionId(requestedSession);},[requestedSession]);
  const selectedSession=activeSessions.find(row=>row._id===sessionId);
  const cellIds=useMemo(()=>cells.map(cell=>cell.id).sort().join(','),[cells]);
  const labels=useResource(owner+':relocation-cell-labels:'+id+':'+cellIds,signal=>relocationContext&&item.data&&cellIds
    ?managedInventory.cellLocations(refId(item.data.facilityId),cellIds.split(','),signal):Promise.resolve({} as Awaited<ReturnType<typeof managedInventory.cellLocations>>));
  const label=(cellId:string)=>{const location=labels.data?.[cellId];return location?.cellNumber!=null?`Ô L${location.levelNumber??'—'}-C${location.cellNumber}`:location?.cellCode??`Ô ${cellId.slice(-6)}`;};
  const rentalActive=rental.data?.status==='ACTIVE'&&Date.parse(rental.data.startDate)<=now&&Date.parse(rental.data.endDate)>now;
  const selectedInstance=(line:Draft)=>specs.find(spec=>spec.itemSpecId===line.itemSpecId)?.instances.find(row=>row.itemInstanceId===line.itemInstanceId);
  const sourceOptions=(spec?:UiSpec)=>{
    const grouped=new Map<string,{key:string;reservationId:string;reservationCode:string;cellId:string;cellCode:string;quantityAvailable:number}>();
    for(const row of spec?.receipts??[]){if(row.quantityAvailable<=0)continue;const key=`${row.reservationId}:${row.cellId}`,existing=grouped.get(key);
      if(existing)existing.quantityAvailable+=row.quantityAvailable;else grouped.set(key,{key,reservationId:row.reservationId,reservationCode:row.reservationCode??cells.find(cell=>cell.reservationId===row.reservationId)?.reservationCode??'Đơn thuê',cellId:row.cellId,cellCode:row.cellCode??cells.find(cell=>cell.id===row.cellId)?.code??row.cellId.slice(-6),quantityAvailable:row.quantityAvailable});}
    return [...grouped.values()];
  };
  const needsReservationScope=new Set(drafts.flatMap(line=>[line.sourceReservationId||rental.data?._id,line.destinationReservationId||rental.data?._id,...(line.destinationAllocations??[]).map(row=>row.reservationId||line.destinationReservationId||rental.data?._id)].filter(value=>!!value&&/^[a-f\d]{24}$/i.test(value))));
  const relocationSession=[...sessionRows].sort((a,b)=>Number(refId(b.reservationId)===rental.data?._id)-Number(refId(a.reservationId)===rental.data?._id))
    .find(session=>managedSessionEligibility(session,{customerId:owner,facilityId:refId(rental.data?.facilityId??''),reservationId:rental.data?._id??'',purpose:'RELOCATION',now}).eligible&&
      [...needsReservationScope].every(value=>(session.scopedReservationIds??[session.reservationId]).map(refId).includes(value!))&&
      managedRelocationCells(drafts).every(cellId=>session.allowedCellIds.map(refId).includes(cellId)));
  const patchLine=(lineId:string,patch:Partial<Draft>)=>{setPreview(null);setResult(null);setDrafts(rows=>rows.map(row=>row.lineId===lineId?{...row,...patch}:row));};
  const lineSpec=(line:Draft)=>specs.find(spec=>spec.itemSpecId===line.itemSpecId);
  const destinations=(sourceIds:string[])=>cells.filter(cell=>cell.operationalStatus==='AVAILABLE'&&cell.canReceiveRelocation&&!sourceIds.includes(cell.id));
  const sessionScopeError=(session:any,lines:Draft[])=>{
    if(!session)return 'Chọn phiên đến kho đang hoạt động có quyền RELOCATION.';
    const reservationScope=new Set((session.scopedReservationIds??[session.reservationId]).map(refId));
    const requiredReservations=new Set(lines.flatMap(line=>[line.sourceReservationId||rental.data?._id,line.destinationReservationId||rental.data?._id,...(line.destinationAllocations??[]).map(row=>row.reservationId||line.destinationReservationId||rental.data?._id)].filter(Boolean)));
    const allowedCells=new Set(session.allowedCellIds.map(refId));
    if([...requiredReservations].some(value=>!reservationScope.has(value)))return 'Phiên RELOCATION chưa bao phủ các Reservation nguồn và đích.';
    if(managedRelocationCells(lines).some(value=>!allowedCells.has(value)))return 'Phiên RELOCATION chưa bao phủ tất cả ô nguồn và ô đích.';
    return '';
  };
  const requestFor=(lines:Draft[],session:any,revision:number,confirmed=false)=>buildManagedRelocationRequest({accessSessionId:session._id,sessionRevision:session.revision,skuRevision:revision,lines,confirmed});
  const addLine=()=>{if(drafts.length>=50)return;setPreview(null);setDrafts(rows=>[...rows,newLine()]);};
  const updateChoice=(line:Draft,specIdValue:string)=>{
    const spec=specs.find(row=>row.itemSpecId===specIdValue),hasLots=!!spec?.receipts.some(row=>row.quantityAvailable>0),hasInstances=!!spec?.instances.length;
    patchLine(line.lineId,{itemSpecId:specIdValue,itemSpecRevision:spec?.revision??0,kind:hasLots?'LOT':'INSTANCE',sourceCellId:undefined,destinationCellId:undefined,
      sourceReservationId:'',destinationReservationId:'',sourceOption:'',quantity:1,availableQuantity:0,itemInstanceId:undefined,sourceCellIds:[],instanceSourceCellIds:[],destinationAllocations:[]});
  };
  const handlePreview=async()=>{
    if(lock.current||busy||attempt)return;lock.current=true;setBusy(true);setError('');setPreview(null);
    try{
      if(!rental.data||!item.data||!rentalActive||!context.data)throw new Error('Reservation phải đang hoạt động và tồn kho đã được xác minh.');
      const previewSession=relocationSession??selectedSession;
      const sessionMessage=sessionScopeError(previewSession,drafts);if(sessionMessage)throw new Error(sessionMessage);
      const latestContext=await managedStockOperations.relocationContext(item.data,owner);
      if(latestContext.sku.revision!==relocationContext?.sku.revision||latestContext.ledgerRevision!==relocationContext?.ledgerRevision){context.reload();throw new Error('Tồn kho vừa thay đổi. Tải lại và tạo bản xem trước mới.');}
      for(const line of drafts){const latestSpec=latestContext.itemSpecifications.find((row:any)=>row.itemSpecId===line.itemSpecId),oldSpec=specs.find(row=>row.itemSpecId===line.itemSpecId);
        if(!latestSpec||!oldSpec||latestSpec.revision!==line.itemSpecRevision)throw new Error('Quy cách hàng hóa vừa thay đổi. Tải lại tồn kho.');
        const usedCells=managedRelocationCells([line]);for(const cellId of usedCells){const before=cells.find(row=>row.id===cellId),after=latestContext.cells.find((row:any)=>row.id===cellId);
          if(!before||!after||before.managedInventoryRevision!==after.managedInventoryRevision)throw new Error('Cell nguồn hoặc đích vừa thay đổi. Tải lại vị trí.');}
      }
      const latestSession=previewSession?await managedReservationReads.session(rental.data,owner,previewSession._id):null;
      if(!latestSession||!managedSessionEligibility(latestSession,{customerId:owner,facilityId:refId(rental.data.facilityId),reservationId:rental.data._id,purpose:'RELOCATION',
        revision:previewSession?.revision,cellIds:managedRelocationCells(drafts),now:Date.now()}).eligible||sessionScopeError(latestSession,drafts))throw new Error('Phiên RELOCATION vừa hết hạn hoặc thay đổi. Hãy tải lại phiên.');
      const request=requestFor(drafts,latestSession,latestContext.sku.revision);
      const sessionMessageLatest=sessionScopeError(latestSession,drafts);if(sessionMessageLatest)throw new Error(sessionMessageLatest);
      const sourceInstanceCells=drafts.filter(line=>line.kind==='INSTANCE').flatMap(line=>line.instanceSourceCellIds);
      const proof=await managedStockOperations.relocationPreviewForScope(item.data,owner,latestSession,request,sourceInstanceCells);
      const snapshot=Object.fromEntries(managedRelocationCells(drafts).map(cellId=>[cellId,cells.find(row=>row.id===cellId)?.managedInventoryRevision]));
      setPreview({body:request,result:proof,cellRevisions:snapshot});
    }catch(cause){setError(cause instanceof Error&&!axios.isAxiosError(cause)?cause.message:relocationIssue(cause));}
    finally{lock.current=false;setBusy(false);}
  };
  const readBack=async(operation:any,store:any,saved:any)=>{
    if(!item.data||!rental.data)throw new Error('Chưa tải được thông tin hàng hóa hoặc đơn thuê để xác minh kết quả.');
    sessions.reload();
    setResult({state:'COMMITTED_READBACK_PENDING',operation,preview:saved.inboundBody?.preview});
    const body=saved.inboundBody?.body as any,affectedSpecIds=[...new Set((body?.lines??[]).map((line:any)=>line.itemSpecId))] as string[];
    const affectedReservationIds=[...new Set((body?.lines??[]).flatMap((line:any)=>[line.sourceReservationId??rental.data!._id,line.destinationReservationId??rental.data!._id,...(line.destinationAllocations??[]).map((row:any)=>row.reservationId??line.destinationReservationId??rental.data!._id)]))] as string[];
    try{
      const [stock,specificationStocks,movementRead,movementHistory,reservations]=await Promise.all([
        mobileRepo.inventoryStock(item.data,owner),
        Promise.all(affectedSpecIds.map(specId=>managedInboundPreview.specificationStockReadback(item.data!,rental.data!,owner,specId))),
        managedStockOperations.relocationOperation(item.data,rental.data,owner,saved.key,body),mobileRepo.inventoryMovements(item.data,owner),
        Promise.all(affectedReservationIds.map(reservationId=>managedInventory.rental(refId(reservationId),owner,refId(rental.data!.facilityId)))),
      ]);
      const cellStock=stock.kind==='V3'?stock.stock.byReservation?.map((row:any)=>({reservationId:refId(row.reservationId),reconciliationStatus:stock.stock.reconciliationStatus,
        byCell:stock.stock.byCell.filter((cell:any)=>refId(cell.reservationId??stock.stock.reservationId)===refId(row.reservationId))}))??[]:[];
      if(stock.kind!=='V3'||stock.stock.reconciliationStatus!=='VERIFIED'||
        specificationStocks.some(row=>row.reconciliationStatus!=='VERIFIED')||reservations.some(row=>row.status!=='ACTIVE'||!Number.isFinite(row.usedCapacityM3)||!Number.isFinite(row.allocatedCapacity)))
        throw new Error('Đã ghi nhận chuyển hàng, nhưng dữ liệu tồn hoặc Reservation chưa thể xác minh đầy đủ.');
      const movement=movementRead.movement;
      for(const line of body.lines){
        const specId=line.itemSpecId,sourceReservationId=line.sourceReservationId??rental.data._id,destinationReservationId=line.destinationReservationId??rental.data._id;
        const sourceCellId=line.sourceCellId,destinationCellId=line.destinationCellId;
        const sourceRead=cellStock.find(row=>row.reservationId===sourceReservationId),destinationRead=cellStock.find(row=>row.reservationId===destinationReservationId);
        const specRead=specificationStocks.find(row=>row.itemSpecId===specId);
        if(!sourceRead||!destinationRead||!specRead)throw new Error('Thiếu dữ liệu quy cách hàng hóa hoặc ô lưu trữ tại đơn thuê nguồn/đích.');
        const specByCell=specRead.byCell??[];
        if(line.itemInstanceId){
          const move=movement.stockEffect as any,sourceEffects=move.source?.filter((row:any)=>row.lineId===line.lineId)??[],destinationEffects=move.destination?.filter((row:any)=>row.lineId===line.lineId)??[];
          if(!sourceEffects.length||!destinationEffects.length||sourceEffects.some((effect:any)=>!sourceRead.byCell.some((cell:any)=>cell.cellId===refId(effect.cellId)))||
            destinationEffects.some((effect:any)=>!destinationRead.byCell.some((cell:any)=>cell.cellId===refId(effect.cellId))))throw new Error('Dữ liệu vị trí chưa bao gồm đầy đủ các ô của món hàng nguyên vẹn.');
        }else{
          const sourceRows=sourceRead.byCell.filter((cell:any)=>cell.cellId===sourceCellId),destinationRows=destinationRead.byCell.filter((cell:any)=>cell.cellId===destinationCellId);
          if(!sourceRows.length||!destinationRows.length)throw new Error('Dữ liệu cập nhật còn thiếu ô nguồn hoặc ô đích của dòng chuyển.');
        }
        if(!line.itemInstanceId&&(!specByCell.some((cell:any)=>cell.cellId===sourceCellId)||!specByCell.some((cell:any)=>cell.cellId===destinationCellId)))throw new Error('Thông tin quy cách chưa bao gồm ô nguồn và ô đích.');
      }
      const historyRows=movementHistory.kind==='V3'?movementHistory.rows:[],historyContains=historyRows.some((row:any)=>typeof row._id==='string'&&row._id===movement._id&&row.type==='RELOCATION'&&row.stockEffect?.action==='MOVE');
      const reservationReads=stock.stock.byReservation??[];
      if(affectedReservationIds.some(reservationId=>!reservationReads.some((row:any)=>row.reservationId===reservationId)))throw new Error('Tồn kho chưa bao gồm đầy đủ đơn thuê nguồn và đơn thuê đích.');
      for(const row of reservations){const read=reservationReads.find((entry:any)=>entry.reservationId===row._id);if(!read||typeof read.totalVolumeM3!=='number'||Math.abs(read.totalVolumeM3-(row.usedCapacityM3??Number.NaN))>0.000001||read.totalVolumeM3>(row.allocatedCapacity??0)+0.000001)throw new Error('Dung tích tồn theo Reservation chưa khớp dữ liệu usage của Reservation.');}
      const complete={state:'COMMITTED_AND_READBACK_VERIFIED',operation:movementRead,stock:stock.stock,cellStock,specificationStocks,reservationReads,
        movementHistoryContains:historyContains,historyMayBeLimited:!historyContains&&historyRows.length>=200,reservations};
      setResult(complete);context.reload();rental.reload();
      await store.clear();setAttempt(null);
    }catch{
      const incomplete={...saved,inboundCommitted:true};await store.write(incomplete);setAttempt(incomplete);
      setResult({state:'COMMITTED_READBACK_PENDING',operation,preview:saved.inboundBody?.preview});
      setError('Đã ghi nhận chuyển hàng. Một số dữ liệu tồn kho đang được cập nhật; hãy kiểm tra lại trạng thái phiếu.');
    }
  };
  const handleConfirm=async()=>{
    if(lock.current||busy||!preview?.result?.canConfirm||!attested||attempt||!item.data||!rental.data)return;
    lock.current=true;setBusy(true);setError('');
    try{
       const requestNow=requestFor(drafts,relocationSession??selectedSession,preview.body.skuRevision);
      if(JSON.stringify(requestNow)!==JSON.stringify(preview.body))throw new Error('Thông tin phiếu đã thay đổi. Hãy xem trước lại.');
      const latestContext=await managedStockOperations.relocationContext(item.data,owner);
      if(latestContext.sku.revision!==preview.result.skuRevision||latestContext.ledgerRevision!==preview.result.ledgerRevision)throw new Error('Tồn kho vừa thay đổi. Hãy tải lại và xem trước lại.');
      for(const [cellId,revision] of Object.entries(preview.cellRevisions) as [string,number][])if(latestContext.cells.find((cell:any)=>cell.id===cellId)?.managedInventoryRevision!==revision)
        throw new Error('Sức chứa hoặc vị trí Cell vừa thay đổi. Hãy xem trước lại.');
       const confirmSession=relocationSession??selectedSession;
      const freshSession=confirmSession?await managedReservationReads.session(rental.data,owner,confirmSession._id):null;
      if(!managedSessionEligibility(freshSession,{customerId:owner,facilityId:refId(rental.data.facilityId),reservationId:rental.data._id,purpose:'RELOCATION',
        revision:preview.body.sessionRevision,cellIds:managedRelocationCells(drafts),now:Date.now()}).eligible||sessionScopeError(freshSession,drafts))throw new Error('Phiên RELOCATION đã thay đổi hoặc hết hạn. Hãy xem trước lại.');
      const confirmBody=requestFor(drafts,freshSession,latestContext.sku.revision,true);
      const store=await journal('managed-v3-relocation',owner,`${id}:${rental.data._id}`),existing=await store.read();
      if(existing)throw new Error('Phiếu chuyển trước đang chờ đối soát. Hãy kiểm tra phiếu đó trước khi tạo thao tác mới.');
      const saved={...newAttempt(),resourceId:id,inboundBody:{mode:'RELOCATION',body:confirmBody,preview:preview.result},inboundCommitted:false};
      if(!await store.claim(saved))throw new Error('Một phiếu chuyển khác đang được xử lý.');
      setAttempt(saved);
      const committed=await managedStockOperations.relocationConfirm(item.data,rental.data,owner,confirmBody,saved.key);
      const committedAttempt={...saved,inboundCommitted:true};await store.write(committedAttempt);setAttempt(committedAttempt);setPreview(null);
      sessions.reload();
      setResult({state:'COMMITTED_READBACK_PENDING',operation:committed,preview:preview.result});
      void readBack(committed,store,committedAttempt);
    }catch(cause){
      if(deterministicNoCommit(cause)){
        const store=await journal('managed-v3-relocation',owner,`${id}:${rental.data?._id}`);await store.clear();setAttempt(null);
      }
      setError(relocationIssue(cause));
    }finally{lock.current=false;setBusy(false);}
  };
  const recover=async()=>{
    if(lock.current||busy||!attempt||!item.data||!rental.data)return;lock.current=true;setBusy(true);setError('');
    try{
      const store=await journal('managed-v3-relocation',owner,`${id}:${rental.data._id}`),saved=await store.read();
      if(!saved||saved.resourceId!==id||saved.inboundBody?.mode!=='RELOCATION')throw new Error('Không tìm thấy phiếu chuyển phù hợp để đối soát.');
      const operation=await managedStockOperations.relocationOperation(item.data,rental.data,owner,saved.key,saved.inboundBody.body);
      const committedAttempt={...saved,inboundCommitted:true};await store.write(committedAttempt);setAttempt(committedAttempt);
      await readBack(operation,store,committedAttempt);
    }catch(cause){
      if(axios.isAxiosError(cause)&&cause.response?.status===404)setError('Chưa tìm thấy kết quả đã ghi nhận. Kết quả vẫn chưa xác định; phiếu đang được giữ để đối soát và chưa thể tạo phiếu mới.');
      else setError('Chưa xác định kết quả chuyển hàng. Phiếu đang được giữ để kiểm tra lại; không gửi thao tác mới.');
    }finally{lock.current=false;setBusy(false);}
  };
  const textForResult=result?.state==='COMMITTED_AND_READBACK_VERIFIED'?'Đã xác minh tồn kho, vị trí, đơn thuê và lịch sử hàng hóa.':result?.state==='COMMITTED_READBACK_PENDING'?'Đã ghi nhận chuyển hàng. Đang cập nhật thông tin tồn kho.':'';
  const selectedReservations=new Set(drafts.flatMap(line=>[line.sourceReservationId,line.destinationReservationId,...(line.destinationAllocations??[]).map(row=>row.reservationId)].filter(Boolean)));
  const selectedSessionScopeError=sessionScopeError(relocationSession??selectedSession,drafts);
  const destinationCapacity=(cell:UiCell)=>`Tải ${cellValue(cell.usedWeightKg)}/${cellValue(cell.maxWeightKg)} kg · thể tích ${cellValue(cell.usedVolumeM3,6)}/${cellValue(cell.maxVolumeM3,6)} m³`;

  return <LiveScreen title="Chuyển vị trí hàng" eyebrow="KHO KÝ GỬI" subtitle="Chọn vị trí lấy hàng và vị trí mới, xem trước sức chứa rồi xác nhận thao tác tại kho."
    backButton={{disabled:!id,onPress:()=>router.replace({pathname:'/inventory/[id]',params:{id,...(requestedSession?{accessSessionId:requestedSession}:{}),operation:'RELOCATION'}} as unknown as Href)}}
    onRefresh={()=>{item.reload();rental.reload();context.reload();sessions.reload();requestedSessionDetail.reload();}} refreshing={item.loading||rental.loading||context.loading}>
    <ResourceState {...item} resource="hàng hóa"/><ResourceState {...rental} resource="đơn thuê"/><ResourceState {...context} resource="tồn kho và vị trí"/><ResourceState {...sessions} resource="phiên đến kho"/>
    {!!requestedSession&&<ResourceState {...requestedSessionDetail} resource="phiên truy cập"/>}
    {context.error&&<StateCard kind="error" title="Chưa thể chuyển hàng" description={context.error}/>}
    {!journalReady&&rental.data&&<StateCard kind="loading" title="Đang kiểm tra phiếu chuyển trước đó"/>}
    {relocationContext&&rental.data&&!relocationSession&&!sessions.loading&&!requestedSessionDetail.loading&&<Card><StateCard kind={sessionReadFailed?'error':'empty'} title={sessionReadFailed?'Chưa thể xác minh phiên truy cập':'Chưa có phiên chuyển vị trí hợp lệ'} description={sessionReadFailed?'Không thể tải hoặc xác minh phiên. Hãy tải lại dữ liệu trước khi tiếp tục.':sessionMessage}/>
      {!sessionReadFailed&&sessionMessage.startsWith('Chưa có phiên')&&<Button label="Mở lịch đến kho" variant="outline" onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits',params:{reservationId:rental.data?._id??''}})}/>}</Card>}
    {relocationContext&&rental.data&&<>
      {!rentalActive&&<StateCard kind="error" title="Đơn thuê chưa đủ điều kiện" description="Chỉ chuyển hàng khi đơn thuê còn hiệu lực."/>}
      <Card><AppText variant="medium">Phiên đến kho</AppText>
        <Input label="Chọn phiên RELOCATION" value={selectedSession?`${new Date(selectedSession.startedAt).toLocaleString('vi-VN')} · hết hạn ${new Date(selectedSession.expiresAt).toLocaleTimeString('vi-VN')}`:''} onChangeText={()=>{}} editable={false}/>
        {activeSessions.map(session=><Filter key={session._id} label={`Phiên đến kho · hết hạn ${new Date(session.expiresAt).toLocaleTimeString('vi-VN')}`} selected={relocationSession?._id===session._id} onPress={()=>{setSessionId(session._id);setPreview(null);setResult(null);}}/>)}
      </Card>
      <Card><AppText variant="medium">Dòng chuyển</AppText>
        {drafts.map((line,index)=>{
          const spec=lineSpec(line),options=sourceOptions(spec),instance=selectedInstance(line),sourceCells=line.kind==='INSTANCE'?(line.instanceSourceCellIds??[]):line.sourceCellId?[line.sourceCellId]:[];
          const targets=destinations(sourceCells),sourceAvailable=options.find(row=>row.key===line.sourceOption)?.quantityAvailable??line.availableQuantity??0;
          const kinds=[...(spec?.receipts.some(row=>row.quantityAvailable>0)?['LOT']:[]),...(spec?.instances.length?['INSTANCE']:[])];
          return <Card key={line.lineId}>
            <AppText variant="medium">Dòng chuyển {index+1}</AppText>
            {drafts.length>1&&<Button label="Xóa dòng" variant="quiet" onPress={()=>{setDrafts(rows=>rows.filter(row=>row.lineId!==line.lineId));setPreview(null);setResult(null);}}/>}
            <Input label="Loại hàng" value={spec?`${spec.code} · ${spec.name}`:''} onChangeText={()=>{}} editable={false}/>
            {specs.filter(row=>row.availableQuantity>0).map(row=><Filter key={row.itemSpecId} label={`${row.code} · ${row.name} · khả dụng ${row.availableQuantity} ${row.quantityUnit}`} selected={line.itemSpecId===row.itemSpecId} onPress={()=>updateChoice(line,row.itemSpecId)}/>)}
            {kinds.length>1&&<><AppText>Hình thức chuyển</AppText><Filter label="Theo số lượng hàng trong ô" selected={line.kind==='LOT'} onPress={()=>patchLine(line.lineId,{kind:'LOT',sourceCellId:undefined,destinationCellId:undefined,sourceReservationId:'',destinationReservationId:'',sourceOption:'',quantity:1,availableQuantity:0,itemInstanceId:undefined,instanceSourceCellIds:[],destinationAllocations:[]})}/>
              <Filter label="Chuyển trọn món nguyên vẹn" selected={line.kind==='INSTANCE'} onPress={()=>patchLine(line.lineId,{kind:'INSTANCE',sourceCellId:undefined,destinationCellId:undefined,sourceReservationId:'',destinationReservationId:'',sourceOption:'',quantity:1,availableQuantity:0,itemInstanceId:undefined,instanceSourceCellIds:[],destinationAllocations:[]})}/></>}
            {line.kind==='LOT'?<>
              <AppText>Vị trí lấy hàng</AppText>{options.map(option=><Filter key={option.key} label={`${option.reservationCode} · ${label(option.cellId)} · ${option.quantityAvailable} ${spec?.quantityUnit}`} selected={line.sourceOption===option.key} onPress={()=>patchLine(line.lineId,{sourceOption:option.key,sourceReservationId:option.reservationId,sourceCellId:option.cellId,destinationCellId:undefined,destinationReservationId:'',availableQuantity:option.quantityAvailable,quantity:Math.min(line.quantity,option.quantityAvailable)})}/>)}
              {!!line.sourceCellId&&<ManagedCellLocationCard cellId={line.sourceCellId} location={labels.data?.[line.sourceCellId]} title="Vị trí lấy hàng" detail={`Đơn thuê ${line.sourceReservationId===rental.data?._id?rental.data?.reservationCode:options.find(row=>row.reservationId===line.sourceReservationId)?.reservationCode??'liên quan'} · khả dụng ${sourceAvailable} ${spec?.quantityUnit??'đơn vị'}`}/>}
              {!!line.sourceCellId&&<><Input label={`Số lượng chuyển (${spec?.quantityUnit??'đơn vị'})`} keyboardType="number-pad" value={String(line.quantity)} onChangeText={value=>patchLine(line.lineId,{quantity:Number(value)})}/>
                <AppText variant="caption">Có thể chuyển tại vị trí này: {sourceAvailable} {spec?.quantityUnit}.</AppText>
                <AppText>Vị trí nhận hàng · đơn thuê cần còn ít nhất {relocationContext.minimumDestinationRemainingDays} ngày</AppText>
                {targets.map(cell=><Filter key={cell.id} label={`${cell.reservationCode} · ${label(cell.id)}`} selected={line.destinationCellId===cell.id} onPress={()=>patchLine(line.lineId,{destinationCellId:cell.id,destinationReservationId:cell.reservationId})}/>)}
                {!!line.destinationCellId&&<ManagedCellLocationCard cellId={line.destinationCellId} location={labels.data?.[line.destinationCellId]} title="Vị trí chuyển đến" detail={`${line.destinationReservationId===rental.data?._id?rental.data?.reservationCode:cells.find(cell=>cell.id===line.destinationCellId)?.reservationCode??'Đơn thuê liên quan'} · ${destinationCapacity(targets.find(cell=>cell.id===line.destinationCellId)??cells[0]!)}`}/>}
              </>}
            </>:<>
              <AppText>Món nguyên vẹn</AppText>{spec?.instances.map(row=><Filter key={row.itemInstanceId} label={`Món ${row.itemInstanceId.slice(-8)} · ${row.weightKg} kg · ${row.volumeM3} m³ · nguồn ${(row.allocations??[]).map(a=>label(a.cellId)).join(', ')}`} selected={line.itemInstanceId===row.itemInstanceId} onPress={()=>patchLine(line.lineId,{itemInstanceId:row.itemInstanceId,sourceReservationId:row.reservationId,sourceCellIds:row.allocations.map(a=>a.cellId),instanceSourceCellIds:row.allocations.map(a=>a.cellId),instanceWeightKg:row.weightKg,instanceVolumeM3:row.volumeM3,quantity:1,destinationReservationId:'',destinationAllocations:[{cellId:'',reservationId:'',weightKg:row.weightKg,volumeM3:row.volumeM3}]})}/>)}
              {instance&&<><AppText>Phân bổ tải ở ô đích phải giữ nguyên {instance.weightKg} kg và {instance.volumeM3} m³.</AppText>
                {(line.destinationAllocations??[]).map((allocation,allocationIndex)=><Card key={`${line.lineId}:destination:${allocationIndex}`}>
                  <AppText>Ô đích {allocationIndex+1}</AppText>{targets.filter(cell=>!(line.destinationAllocations??[]).some((row,rowIndex)=>rowIndex!==allocationIndex&&row.cellId===cell.id)).map(cell=><Filter key={cell.id} label={`${cell.reservationCode} · ${label(cell.id)} · ${destinationCapacity(cell)}`} selected={allocation.cellId===cell.id} onPress={()=>{
                    const next=(line.destinationAllocations??[]).map((row,rowIndex)=>rowIndex===allocationIndex?{...row,cellId:cell.id,reservationId:cell.reservationId}:row);
                    patchLine(line.lineId,{destinationAllocations:next,destinationReservationId:cell.reservationId});
                  }}/>) }
                  <Input label="Tải trọng phân bổ (kg)" keyboardType="decimal-pad" value={String(allocation.weightKg)} onChangeText={value=>patchLine(line.lineId,{destinationAllocations:(line.destinationAllocations??[]).map((row,rowIndex)=>rowIndex===allocationIndex?{...row,weightKg:Number(value)}:row)})}/>
                  <Input label="Thể tích phân bổ (m³)" keyboardType="decimal-pad" value={String(allocation.volumeM3)} onChangeText={value=>patchLine(line.lineId,{destinationAllocations:(line.destinationAllocations??[]).map((row,rowIndex)=>rowIndex===allocationIndex?{...row,volumeM3:Number(value)}:row)})}/>
                  {(line.destinationAllocations??[]).length>1&&<Button label="Bỏ ô đích" variant="quiet" onPress={()=>patchLine(line.lineId,{destinationAllocations:(line.destinationAllocations??[]).filter((_,rowIndex)=>rowIndex!==allocationIndex)})}/>}
                </Card>)}
                <Button label="Thêm ô đích" variant="outline" onPress={()=>patchLine(line.lineId,{destinationAllocations:[...(line.destinationAllocations??[]),{cellId:'',reservationId:'',weightKg:0,volumeM3:0}]})}/>
              </>}
            </>}
          </Card>;
        })}
        <Button label="Thêm dòng chuyển" variant="outline" disabled={drafts.length>=50} onPress={addLine}/>
      </Card>
      <Card><AppText variant="medium">Xem trước phiếu chuyển</AppText>
        <Button label="Xem trước phiếu chuyển" loading={busy} disabled={busy||!rentalActive||!relocationSession||!!attempt||!journalReady} onPress={()=>void handlePreview()}/>
        {preview?.result&&<Card><AppText variant="medium">{preview.result.totalQuantity} đơn vị · {cellValue(preview.result.totalWeightKg)} kg · {cellValue(preview.result.totalVolumeM3,6)} m³</AppText>
          {preview.result.lines.map((line:any)=><Card key={line.lineId}>
            <AppText>{line.itemSpecCode} · {line.itemSpecName} · {line.quantity} {specs.find(row=>row.itemSpecId===line.itemSpecId)?.quantityUnit}</AppText>
            <AppText>Nguồn</AppText>{line.source.map((source:any,index:number)=><AppText key={`source-${line.lineId}-${index}`}>{source.cellCode??label(source.cellId)} · {source.quantity} · tồn tại ô {source.quantityBefore} → {source.quantityAfter}</AppText>)}
            <AppText>Đích</AppText>{line.destination.map((destination:any,index:number)=><AppText key={`destination-${line.lineId}-${index}`}>{destination.cellCode??label(destination.cellId)} · {destination.quantity} · tồn tại ô {destination.quantityBefore} → {destination.quantityAfter}</AppText>)}
            <AppText>Khối lượng {cellValue(line.weightKg)} kg · thể tích {cellValue(line.volumeM3,6)} m³</AppText>
          </Card>)}
          {preview.result.capacity.map((cell:any)=><AppText key={`cell-${cell.cellId}`}>{label(cell.cellId)} · {cell.usedWeightBeforeKg} → {cell.usedWeightAfterKg}/{cell.maxWeightKg} kg · {cell.usedVolumeBeforeM3} → {cell.usedVolumeAfterM3}/{cell.maxVolumeM3} m³</AppText>)}
          {preview.result.levelCapacity.map((level:any,index:number)=><AppText key={`level-${index}`}>Tầng kệ {level.levelNumber} · {level.usedWeightBeforeKg} → {level.usedWeightAfterKg}/{level.maxWeightKg} kg · {level.usedVolumeBeforeM3} → {level.usedVolumeAfterM3}/{level.maxVolumeM3} m³</AppText>)}
          {preview.result.warnings.map((warning:string,index:number)=><AppText key={`warning-${index}`}>{warning}</AppText>)}
          <AppText variant="caption">Bước xem trước chưa thay đổi tồn kho. Sức chứa sẽ được xác nhận khi hoàn tất.</AppText>
          <Filter label="Tôi đã thực hiện đúng việc chuyển hàng tại kho trong phiên có nhân viên giám sát." selected={attested} onPress={()=>setAttested(value=>!value)}/>
          <Button label="Xác nhận chuyển vị trí" loading={busy} disabled={busy||!attested||!preview.result.canConfirm||!!attempt} onPress={()=>void handleConfirm()}/>
        </Card>}
      </Card>
      {!!error&&<StateCard kind="error" title="Chưa thể hoàn tất" description={error}/>}
      {result&&<Card><AppText variant="medium">{stateLabel(result.state)}</AppText><AppText>{textForResult}</AppText>
        {result.operation?.movement&&<>
          <AppText>Mã phiếu: {result.operation.movement.movementCode??result.operation.movement._id}</AppText>
          <AppText>Số lượng: {result.operation.movement.quantity} {result.operation.movement.quantityUnit}</AppText>
          <AppText>Thời gian: {result.operation.movement.performedAt?new Date(result.operation.movement.performedAt).toLocaleString('vi-VN'):'Đã hoàn tất'}</AppText>
          {result.operation.movement.stockEffect?.source?.map((row:any,index:number)=><AppText key={`result-source-${index}`}>Nguồn · {label(refId(row.cellId))} · {row.quantity}</AppText>)}
          {result.operation.movement.stockEffect?.destination?.map((row:any,index:number)=><AppText key={`result-destination-${index}`}>Đích · {label(refId(row.cellId))} · {row.quantity}</AppText>)}
        </>}
        {result.state==='COMMITTED_AND_READBACK_VERIFIED'&&<>
          <AppText>Tổng số lượng hàng: {result.stock.totalQuantity} · dung tích: {result.stock.totalVolumeM3} m³</AppText>
          {result.specificationStocks.map((spec:any,index:number)=><AppText key={`spec-stock-${index}`}>Loại hàng {spec.itemSpecId.slice(-6)} · tồn {spec.quantityOnHand} · khả dụng {spec.quantityAvailable} · {spec.totalVolumeM3} m³</AppText>)}
          {result.specificationStocks.flatMap((spec:any)=>(spec.byCell??[]).map((cell:any,index:number)=><AppText key={`${spec.itemSpecId}:${cell.cellId}:${index}`}>Ô {label(cell.cellId)} · tồn {cell.quantityOnHand} · khả dụng {cell.quantityAvailable}</AppText>))}
          {result.reservations.map((row:any)=><AppText key={row._id}>Đơn thuê {row.reservationCode} · đã sử dụng {row.usedCapacityM3??'—'} m³</AppText>)}
          <AppText>{result.movementHistoryContains?'Hoạt động đã có trong lịch sử hàng hóa.':'Hoạt động đã hoàn tất và đang được cập nhật trong lịch sử.'}</AppText>
        </>}
        <Button label="Xem lịch sử hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id}} as unknown as Href)}/>
      </Card>}
      {attempt&&<Card><AppText variant="medium">Phiếu chuyển cần đối soát</AppText>
        <AppText>{attempt.inboundCommitted?'Phiếu chuyển đã được xác nhận. Hãy kiểm tra trạng thái và tồn kho trước khi tiếp tục.':'Chưa xác định kết quả phiếu. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.'}</AppText>
        <Button label="Kiểm tra phiếu hiện tại" variant="outline" loading={busy} disabled={busy||!item.data||!rental.data} onPress={()=>void recover()}/>
      </Card>}
      {!relocationSession&&selectedSessionScopeError&&<StateCard title="Phiên đến kho chưa bao gồm đủ các vị trí đã chọn" description="Hãy chọn một phiên khác hoặc liên hệ nhân viên tại cơ sở."/>}
    <ResourceState {...labels} resource="tên vị trí"/>
    </>}
  </LiveScreen>;
}
