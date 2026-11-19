import {useState} from 'react';
import {useRouter} from 'expo-router';
import {managedInboundPreview} from '../api/managedInboundPreview';
import {managedInventory} from '../api/managedInventory';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';
import {mobileRepo} from '../api/mobileRepository';
import {movementActionLabel,movementIdentifier,movementOccurredAt,movementTime} from '../domain/managedV3Movements';
import {AppText,Button,Card,Chip,NavigationRow,SectionTitle} from './ui';
import {ResourceState,useResource} from './liveUI';
import {ManagedCellLocationCard} from './ManagedCellLocationCard';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
const quantity=(value:number|null|undefined,unit='đơn vị')=>value==null?'Chưa xác minh':`${value.toLocaleString('vi-VN')} ${unit}`;
const statusLabel=(status:string)=>status==='VERIFIED'?'Đã xác minh':status==='NO_ACTIVITY'?'Chưa phát sinh':status==='CHECKING'?'Đang kiểm tra':'Chưa xác minh';

export function ManagedSkuStockPanel({item,owner,reservation:providedReservation,refreshRevision=0}:{item:Item;owner:string;reservation?:ReservationDto;refreshRevision?:number}){
  const router=useRouter(),[expanded,setExpanded]=useState(false);
  const reservationId=refId(item.managedReservationId),facilityId=refId(item.facilityId);
  const reservation=useResource(owner+':stock-reservation:'+reservationId+(providedReservation?':provided:'+providedReservation.status:''),signal=>
    providedReservation?Promise.resolve(providedReservation):mobileRepo.managedRental(reservationId,owner,signal));
  const stock=useResource(owner+':sku-stock:'+item._id+':'+refreshRevision+(item.inventorySchemaVersion===3?':'+(reservation.data?'ready':reservation.error?'error':'waiting'):''),signal=>{
    if(item.inventorySchemaVersion===3){
      if(reservation.data?.bookingFlowVersion===3)return managedInboundPreview.stockReadback(item,reservation.data,owner,signal).then(value=>({kind:'V3' as const,stock:value}));
      if(reservation.error)return Promise.reject(new Error(reservation.error));
      if(reservation.data)return Promise.reject(new Error('Không thể xác định đơn thuê liên quan.'));
      return Promise.resolve(null);
    }
    return mobileRepo.inventoryStock(item,owner,signal);
  });
  const v3=stock.data?.kind==='V3'?stock.data.stock:null;
  const cellStock=useResource(expanded&&v3?owner+':sku-cell-stock:'+item._id+':'+refreshRevision:'',signal=>expanded&&v3&&reservation.data?.bookingFlowVersion===3
    ?managedInboundPreview.cellStockReadback(item,reservation.data,owner,signal):Promise.resolve(null));
  const cellIds=v3?[...new Set([...v3.byCell.map(row=>row.cellId),...v3.itemSpecifications.flatMap(spec=>spec.byCell.map(row=>row.cellId))])]:[];
  const cellLabels=useResource(cellIds.length?owner+':sku-cell-labels:'+facilityId+':'+cellIds.join(','):'',signal=>cellIds.length
    ?managedInventory.cellLocations(facilityId,cellIds,signal):Promise.resolve({} as Awaited<ReturnType<typeof managedInventory.cellLocations>>));
  return <Card>
    <SectionTitle title="Tồn kho hiện tại"/>
    <ResourceState {...reservation} resource="đơn thuê"/>{!(item.inventorySchemaVersion===3&&reservation.error)&&<ResourceState {...stock} resource="số lượng tồn kho"/>}
    {v3&&<>
      <Chip label={statusLabel(v3.reconciliationStatus)} tone={v3.reconciliationStatus==='VERIFIED'?'green':v3.reconciliationStatus==='NO_ACTIVITY'?'neutral':'orange'}/>
      {v3.reconciliationStatus==='CHECKING'?<AppText>{v3.verificationMessage??'Thông tin tồn kho đang được kiểm tra; số lượng chưa được xác minh.'}</AppText>:<AppText>{v3.reconciliationStatus==='NO_ACTIVITY'?'Chưa có hàng trong kho':'Tổng số lượng'}: {quantity(v3.totalQuantity)}</AppText>}
      {v3.reconciliationStatus!=='CHECKING'&&<AppText>Khối lượng: {v3.totalWeightKg==null?'Chưa xác minh':`${v3.totalWeightKg} kg`} · Thể tích: {v3.totalVolumeM3==null?'Chưa xác minh':`${v3.totalVolumeM3} m³`}</AppText>}
    {reservation.data&&<AppText>Dung tích đơn thuê: {reservation.data.usedCapacityM3==null?'Mức sử dụng chưa xác minh':`${reservation.data.usedCapacityM3} m³ đã dùng`} / {reservation.data.allocatedCapacity==null?'Chưa xác minh dung tích được phân bổ':`${reservation.data.allocatedCapacity} m³ được phân bổ`}</AppText>}
      <Button label={expanded?'Thu gọn chi tiết':'Xem tồn theo loại hàng và vị trí'} variant="outline" onPress={()=>setExpanded(value=>!value)}/>
      {expanded&&<>
        <ResourceState {...cellLabels} resource="tên vị trí"/>
        {v3.reconciliationStatus==='CHECKING'?<AppText>Số liệu theo loại hàng và vị trí chưa được xác minh.</AppText>:v3.itemSpecifications.map(spec=><Card key={spec.itemSpecId} style={{padding:12}}>
          <AppText variant="label">{spec.code} · {spec.name}</AppText>
          <AppText>Đang lưu {quantity(spec.quantityOnHand,spec.quantityUnit??'đơn vị')} · Đang giữ {quantity(spec.quantityHeld,spec.quantityUnit??'đơn vị')} · Khả dụng {quantity(spec.quantityAvailable,spec.quantityUnit??'đơn vị')}</AppText>
          {spec.byCell.map(cell=><ManagedCellLocationCard key={cell.cellId} cellId={cell.cellId} location={cellLabels.data?.[cell.cellId]} detail={`${quantity(cell.quantityOnHand,spec.quantityUnit??'đơn vị')} · ${cell.weightKg} kg · ${cell.volumeM3} m³`}/>)}
          {!spec.byCell.length&&<AppText variant="caption">Chưa có số lượng theo vị trí cho loại hàng này.</AppText>}
        </Card>)}
        <SectionTitle title="Tồn theo vị trí"/><ResourceState {...cellStock} resource="tồn theo vị trí"/>
        {cellStock.data&&<><Chip label={statusLabel(cellStock.data.reconciliationStatus)} tone={cellStock.data.reconciliationStatus==='VERIFIED'?'green':cellStock.data.reconciliationStatus==='NO_ACTIVITY'?'neutral':'orange'}/>
          {cellStock.data.reconciliationStatus==='CHECKING'?<AppText>{cellStock.data.verificationMessage??'Số liệu theo vị trí chưa được xác minh.'}</AppText>:cellStock.data.byCell.map(cell=><ManagedCellLocationCard key={cell.cellId} cellId={cell.cellId} location={cellLabels.data?.[cell.cellId]} detail={`${quantity(cell.quantityOnHand)} · ${cell.weightKg} · ${cell.volumeM3} m³`}/>)}
          {cellStock.data.reconciliationStatus==='NO_ACTIVITY'&&<AppText>Chưa phát sinh tồn theo vị trí.</AppText>}
        </>}
      </>}
    </>}
    {stock.data?.kind==='LEGACY'&&<>
      <Chip label={stock.data.stock.source==='LEDGER_V2'?'Tồn kho theo lô':'Tồn kho đã xác minh'} tone="neutral"/>
      <AppText>Đang lưu: {quantity(stock.data.stock.onHandQuantity,stock.data.stock.quantityUnit)}</AppText>
      <AppText>Đang giữ: {quantity(stock.data.stock.heldQuantity,stock.data.stock.quantityUnit)} · Khả dụng: {quantity(stock.data.stock.availableQuantity,stock.data.stock.quantityUnit)}</AppText>
    </>}
    <NavigationRow label="Xem chi tiết hàng hóa" onPress={()=>router.push({pathname:'/inventory/[id]',params:{id:item._id}})}/>
    <NavigationRow label="Xem lịch sử hàng hóa" icon="time-outline" onPress={()=>router.push({pathname:'/inventory/[id]/history',params:{id:item._id}})}/>
  </Card>;
}
