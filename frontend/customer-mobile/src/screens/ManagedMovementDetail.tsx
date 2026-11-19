import {useLocalSearchParams,useRouter} from 'expo-router';
import {managedSpecifications} from '../api/managedSpecifications';
import {mobileRepo} from '../api/mobileRepository';
import {managedInventory} from '../api/managedInventory';
import {refId} from '../api/contracts/core';
import {useLiveSession} from '../state/useLiveSession';
import {movementActionLabel,movementCellIds,movementIdentifier,movementNotes,movementOccurredAt,movementPlacements,movementTime,type ManagedMovement} from '../domain/managedV3Movements';
import {AppText,Card,Chip} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';

export default function ManagedMovementDetail(){
  const {id='',movementId=''}=useLocalSearchParams<{id:string;movementId:string|string[]}>();
  const selectedId=Array.isArray(movementId)?movementId[0]??'':movementId,owner=useLiveSession(state=>state.user?._id??''),router=useRouter();
  const record=useResource(owner+':movement-detail:'+id+':'+selectedId,async signal=>{
    const item=await mobileRepo.item(id,owner,signal),history=await mobileRepo.inventoryMovements(item,owner,signal);
    const movement=history.rows.find(row=>row._id===selectedId);
    if(!movement)throw new Error('Không tìm thấy phiếu hàng hóa liên quan.');
    const specifications=item.inventorySchemaVersion===3?await managedSpecifications.list(item,owner,signal):[];
    return {item,movement,specifications};
  });
  const cellIds=record.data?movementCellIds(record.data.movement):[];
  const labels=useResource(record.data&&cellIds.length?owner+':movement-detail-cells:'+id+':'+cellIds.join(','):'',signal=>record.data&&cellIds.length
    ?managedInventory.cellLabels(refId(record.data.item.facilityId),cellIds,signal):Promise.resolve({} as Record<string,string>));
  const row=record.data?.movement as ManagedMovement|undefined;
  const specificationName=(specId:string)=>{const spec=record.data?.specifications.find(spec=>spec._id===specId);return spec?`${spec.code} · ${spec.name}`:'Không có thông tin loại hàng';};
  return <LiveScreen title="Chi tiết hoạt động hàng hóa" eyebrow="KHO KÝ GỬI" subtitle="Thông tin về lần nhập, xuất hoặc chuyển vị trí đã hoàn tất."
    backButton={{disabled:!id,onPress:()=>router.replace({pathname:'/inventory/[id]/history',params:{id}} as never)}} onRefresh={record.reload} refreshing={record.loading}>
    <ResourceState {...record} resource="chi tiết hoạt động"/>
    {row&&record.data&&<>
      <Card><Chip label="Đã hoàn tất" tone="green"/><AppText variant="heading">{movementActionLabel(row)}</AppText>
        <AppText>{record.data.item.itemCode} · {record.data.item.name}</AppText>
        <AppText>{row.quantity} {row.quantityUnit} · {movementTime(movementOccurredAt(row))}</AppText>
        <AppText>Mã hoạt động: {String(row.movementCode??row._id)}</AppText>
      </Card>
      <ResourceState {...labels} resource="tên vị trí"/>
      {(['source','destination'] as const).map(side=>{
        const placements=movementPlacements(row,side);
        return placements.length?<Card key={side}><AppText variant="card">{side==='source'?'Cell nguồn':'Cell đích'}</AppText>
          {placements.map((line,index)=><Card key={`${line.cellId}-${index}`} style={{padding:12}}>
            <AppText>{labels.data?.[line.cellId]??'Đang xác định vị trí'}</AppText>
            {!!line.itemSpecId&&<AppText>Loại hàng: {specificationName(line.itemSpecId)||'Không có thông tin loại hàng'}</AppText>}
            {line.quantity!=null&&<AppText>Số lượng: {line.quantity} {row.quantityUnit}</AppText>}
            {line.quantityBefore!=null&&line.quantityAfter!=null&&<AppText>Tồn theo dòng: {line.quantityBefore} → {line.quantityAfter} {row.quantityUnit}</AppText>}
            {line.weightKg!=null&&<AppText>Khối lượng: {line.weightKg} kg</AppText>}
            {line.volumeM3!=null&&<AppText>Thể tích: {line.volumeM3} m³</AppText>}
            {!!line.receiptId&&<AppText>Mã phiếu nhập: {line.receiptId}</AppText>}
            {!!line.itemInstanceId&&<AppText>Mã kiện: {line.itemInstanceId}</AppText>}
          </Card>)}
        </Card>:null;
      })}
      {Array.isArray(row.batchLines)&&row.batchLines.length>0&&<Card><AppText variant="card">Chi tiết theo lô đã ghi nhận</AppText>{row.batchLines.map((line:ManagedMovement,index:number)=><AppText key={`${String(line.batchId??'lot')}-${index}`}>{String(line.action??'')} · {String(line.quantity??'—')} {String(line.quantityUnit??row.quantityUnit)}{line.actualTotalWeightKg!=null?` · ${String(line.actualTotalWeightKg)} kg`:''}{line.actualTotalVolumeM3!=null?` · ${String(line.actualTotalVolumeM3)} m³`:''}</AppText>)}</Card>}
      {row.actualUnitWeightKg!=null&&<Card><AppText variant="card">Số đo ghi nhận</AppText><AppText>Khối lượng mỗi đơn vị: {row.actualUnitWeightKg} kg</AppText>
        {row.actualUnitDimensionsM&&<AppText>Kích thước: {row.actualUnitDimensionsM.widthM} × {row.actualUnitDimensionsM.depthM} × {row.actualUnitDimensionsM.heightM} m</AppText>}
        {row.actualTotalWeightKg!=null&&<AppText>Tổng khối lượng: {row.actualTotalWeightKg} kg</AppText>}
        {row.actualTotalVolumeM3!=null&&<AppText>Tổng thể tích: {row.actualTotalVolumeM3} m³</AppText>}
      </Card>}
      {movementNotes(row).map((note,index)=><Card key={index}><AppText variant="card">Ghi chú</AppText><AppText>{note}</AppText></Card>)}
      {row.stockEffect?.customerAttestation?.statement&&<Card><AppText variant="card">Xác nhận thao tác</AppText><AppText>{row.stockEffect.customerAttestation.statement}</AppText></Card>}
    </>}
  </LiveScreen>;
}
