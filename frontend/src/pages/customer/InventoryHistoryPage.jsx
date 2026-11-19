import { Link, useParams } from 'react-router-dom';
import {inventoryRecord,inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {inventoryMovements,movementBatchLines} from '@/lib/inventoryMovementHistory';
import {reservationVietnamTime} from '@/lib/customerReservationDisplay';
import {weightText} from '@/lib/warehouseMap';
import {volumeText} from '@/lib/managedCellBooking';
import {inventoryApi,useInventoryBackend} from '@/components/customer/inventory/InventoryBackendUI';
import {inventoryCellLocationDetails} from '@/components/customer/inventory/managedInventoryContext';
import {useAuthSession} from '@/lib/authSession';
import {LoadState} from '@/components/customer/RentalBackendUI';
import { CustomerScreen, EmptyState } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
export function MovementMeasurements({movement:m}){
 if(m.schemaVersion===4){const effect=m.stockEffect,rows=[...(effect?.source||[]).map(line=>({...line,side:'Source'})),...(effect?.destination||[]).map(line=>({...line,side:'Destination'}))];return <><p>Total weight: {weightText(m.actualTotalWeightKg)}</p><p>Total volume: {volumeText(m.actualTotalVolumeM3)}</p><details className="mt-3 min-w-0"><summary className="cursor-pointer font-semibold">Placement details ({rows.length})</summary><ul className="mt-3 space-y-3">{rows.map((line,index)=><li key={`${line.lineId||line.receiptId}:${line.cellId}:${index}`} className="min-w-0 break-words rounded-lg border p-3"><p className="font-semibold">{line.side} · Cell {inventoryId(line.cellId)}</p><p>Item Specification: {inventoryId(line.itemSpecId)}</p><p>Quantity: {line.quantity} {line.quantityUnitSnapshot||m.quantityUnit}</p><p>Unit weight: {weightText(line.unitWeightKgSnapshot)}</p><p>Unit dimensions: {line.unitDimensionsSnapshot.widthM} × {line.unitDimensionsSnapshot.depthM} × {line.unitDimensionsSnapshot.heightM} m</p><p>Allocated weight: {weightText(line.allocatedWeightKg)}</p><p>Allocated volume: {volumeText(line.allocatedVolumeM3)}</p>{line.itemInstanceId&&<p>Physical item: {line.itemInstanceId}</p>}</li>)}</ul></details></>}
 const lines=movementBatchLines(m),multiple=lines.length>1;
 return <><p>{lines.length?'Parent total weight':'Total weight'}: {weightText(m.actualTotalWeightKg)}</p><p>{lines.length?'Parent total volume':'Total volume'}: {volumeText(m.actualTotalVolumeM3)}</p>
  {multiple?<p className="mt-2 text-xs text-slate-600">Unit measurements are shown separately for each batch. Parent unit fields describe the first batch only.</p>:<><p>Unit weight: {weightText(m.actualUnitWeightKg)}</p><p className="mt-2 text-xs">{m.actualUnitDimensionsM.widthM} × {m.actualUnitDimensionsM.depthM} × {m.actualUnitDimensionsM.heightM} m</p></>}
  {lines.length>0&&<details className="mt-3 min-w-0"><summary className="cursor-pointer font-semibold">Batch details ({lines.length})</summary><ul className="mt-3 space-y-3">{lines.map((line,index)=><li key={`${line.batchId}:${index}`} className="min-w-0 break-words rounded-lg border p-3"><p className="break-all font-semibold">{line.batchId} · {line.action}</p><p>Batch quantity: {line.quantity} {line.quantityUnit}</p><p>Batch unit weight: {weightText(line.actualUnitWeightKg)}</p><p>Batch dimensions: {line.actualUnitDimensionsM.widthM} × {line.actualUnitDimensionsM.depthM} × {line.actualUnitDimensionsM.heightM} m</p><p>Batch total weight: {weightText(line.actualTotalWeightKg)}</p><p>Batch total volume: {volumeText(line.actualTotalVolumeM3)}</p>{[['Receipt movement',line.receiptMovementId],['Receipt request',line.receiptRequestId],['Receiving inspection evidence',line.receivingInspectionEvidenceId]].filter(([,value])=>value!==undefined).map(([label,value])=><p key={label} className="mt-1 break-all text-xs">{label}: {inventoryId(value)}</p>)}</li>)}</ul></details>}
 </>;
}
const operationLabels={INBOUND:'Nhập hàng',OUTBOUND:'Xuất hàng',RELOCATION:'Chuyển vị trí'};
const noteLabels={inspectionNote:'Kiểm tra',handoverNote:'Bàn giao',relocationNote:'Chuyển vị trí'};
function noteText(value){
 if(value==='Customer xác nhận đã thực hiện nhập hàng trong Access Session có Staff giám sát.')return 'Khách hàng xác nhận đã nhập hàng trong buổi làm việc có nhân viên hỗ trợ.';
 return value;
}
function locationText(cellId,locations,movement,side){
 if(cellId===null)return 'Ngoài kho';
 const location=locations?.[inventoryId(cellId)];
 if(!location)return 'Chưa có thông tin vị trí';
 return `Kệ ${location.rackCode||'—'} · Tầng ${location.levelNumber??'—'} · Ô ${location.cellCode||location.cellNumber||'—'}`;
}
function locationsFor(m,side){
 if(m.schemaVersion===4)return (m.stockEffect?.[side]||[]).map(line=>line.cellId);
 const id=m[side==='source'?'sourceCellId':'destinationCellId'];return id===null?[]:[id];
}
function CellSummary({movement,side,locations}){
 const ids=locationsFor(movement,side);
 if(movement.schemaVersion===4&&!ids.length&&((side==='source'&&movement.type==='INBOUND')||(side==='destination'&&movement.type==='OUTBOUND')))return 'Ngoài kho';
 const uniqueIds=[...new Set(ids.map(inventoryId))];
 if(movement.schemaVersion===4&&uniqueIds.length>1)return <details><summary className="cursor-pointer text-sky-800 underline">{uniqueIds.length} vị trí lưu trữ</summary><ul className="mt-2 space-y-1">{uniqueIds.map(id=><li key={id}>{locationText(id,locations,movement,side)}</li>)}</ul></details>;
 const id=movement.schemaVersion===4?ids[0]??undefined:movement[side==='source'?'sourceCellId':'destinationCellId'];
 return locationText(id,locations,movement,side);
}
function CustomerMovementDetails({movement,locations,specifications,item}){
 const isV4=movement.schemaVersion===4,effect=movement.stockEffect;
 const allocations=isV4?[...(effect?.source||[]).map(line=>({...line,side:'Vị trí ban đầu'})),...(effect?.destination||[]).map(line=>({...line,side:'Vị trí mới'}))]:[];
 const batches=movementBatchLines(movement);
 return <details className="min-w-52"><summary className="cursor-pointer font-semibold text-sky-800 underline">Xem chi tiết</summary><div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
  <p><b>Hàng hóa:</b> {item?.name||'Mặt hàng'}{item?.itemCode?` · ${item.itemCode}`:''}</p><p><b>Loại thao tác:</b> {operationLabels[movement.type]}</p><p><b>Số lượng:</b> {movement.quantity} {movement.quantityUnit}</p>
  <p><b>Tổng khối lượng:</b> {weightText(movement.actualTotalWeightKg)} · <b>Tổng thể tích:</b> {volumeText(movement.actualTotalVolumeM3)}</p>
  <p><b>Thời gian:</b> {reservationVietnamTime(movement.performedAt)}</p>
  {allocations.length>0&&<div><b>Phân bổ theo vị trí</b><ul className="mt-2 space-y-2">{allocations.map((line,index)=><li key={`${line.lineId||line.receiptId}:${inventoryId(line.cellId)}:${index}`} className="rounded-lg border bg-white p-2"><p>{line.side}: {locationText(line.cellId,locations,movement,line.side)}</p><p>Quy cách: {specifications?.[inventoryId(line.itemSpecId)]||'Chưa có thông tin quy cách'}</p><p>Số lượng: {line.quantity} {line.quantityUnitSnapshot||movement.quantityUnit}</p><p>Khối lượng: {weightText(line.allocatedWeightKg)} · Thể tích: {volumeText(line.allocatedVolumeM3)}</p></li>)}</ul></div>}
  {batches.length>0&&<div><b>Chi tiết từng lô hàng</b><ul className="mt-2 space-y-2">{batches.map((line,index)=><li key={index} className="rounded-lg border bg-white p-2"><p>Số lượng: {line.quantity} {line.quantityUnit}</p><p>Khối lượng: {weightText(line.actualTotalWeightKg)} · Thể tích: {volumeText(line.actualTotalVolumeM3)}</p><p>Vị trí lấy hàng: <CellSummary movement={movement} side="source" locations={locations}/></p><p>Vị trí chuyển đến: <CellSummary movement={movement} side="destination" locations={locations}/></p></li>)}</ul></div>}
  {!isV4&&!batches.length&&<><p><b>Vị trí lấy hàng:</b> <CellSummary movement={movement} side="source" locations={locations}/></p><p><b>Vị trí chuyển đến:</b> <CellSummary movement={movement} side="destination" locations={locations}/></p></>}
  {movement.inspectionNote&&<p className="whitespace-pre-wrap"><b>{noteLabels.inspectionNote}:</b> {noteText(movement.inspectionNote)}</p>}{movement.handoverNote&&<p className="whitespace-pre-wrap"><b>{noteLabels.handoverNote}:</b> {noteText(movement.handoverNote)}</p>}{movement.relocationNote&&<p className="whitespace-pre-wrap"><b>{noteLabels.relocationNote}:</b> {noteText(movement.relocationNote)}</p>}
 </div></details>;
}
export default function InventoryHistoryPage(){
 const {id}=useParams(),session=useAuthSession(),customerId=inventoryId(session.user);
 const resource=useInventoryBackend(async config=>{
   const item=inventoryRecord(await inventoryApi.get(id,config));
   if(inventoryId(item)!==id)throw Error('Inventory response does not match the requested item.');
   const movements=inventoryMovements(await inventoryApi.movements(id,config),item),cellIds=[...new Set(movements.flatMap(m=>[...locationsFor(m,'source'),...locationsFor(m,'destination')]).map(inventoryId).filter(validInventoryId))];
   const [locationResult,specResult]=await Promise.allSettled([inventoryCellLocationDetails(customerId,{facilityId:item.facilityId},cellIds,config),inventoryApi.specifications(id,config)]);
   const locations=locationResult.status==='fulfilled'?locationResult.value:{};
   const specs=specResult.status==='fulfilled'&&specResult.value.data?.success===true&&Array.isArray(specResult.value.data.data)?Object.fromEntries(specResult.value.data.data.map(spec=>[inventoryId(spec),`${spec.code} · ${spec.name}`])):{};
   return {item,movements,locations,specifications:specs,locationUnavailable:locationResult.status==='rejected'};
 },[id,customerId]);
 const item=resource.data?.item,movements=resource.data?.movements,locations=resource.data?.locations||{},specifications=resource.data?.specifications||{};
 return <CustomerScreen eyebrow="HÀNG HÓA CỦA TÔI" title="Lịch sử hàng hóa" description="Theo dõi lịch sử nhập, xuất và chuyển vị trí hàng hóa của bạn." action={<Button asChild variant="outline"><Link to={`/portal/inventory/${id}`}>Chi tiết hàng hóa</Link></Button>}>
  <LoadState resource={resource}/>
  {resource.data?.locationUnavailable&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Chưa tải được thông tin vị trí. Lịch sử thao tác vẫn hiển thị; hãy tải lại để thử xác minh vị trí.</p>}
  {movements?.length>0&&<Card className="min-w-0 overflow-hidden"><div className="customer-table-scroll"><table className="customer-table"><caption className="sr-only">Lịch sử thao tác hàng hóa</caption><thead><tr>{['Thao tác','Hàng hóa','Số lượng','Vị trí lấy hàng','Vị trí chuyển đến','Khối lượng / Thể tích','Thời gian','Chi tiết'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{movements.map(m=><tr key={inventoryId(m)}><td><Badge variant={m.type==='OUTBOUND'?'orange':'green'}>{operationLabels[m.type]}</Badge><time className="mt-2 block whitespace-nowrap text-xs text-slate-600" dateTime={m.performedAt}>{reservationVietnamTime(m.performedAt)}</time></td><td className="min-w-36">{item?.name}<p className="mt-1 text-xs text-slate-500">{item?.itemCode}</p></td><td>{m.quantity} {m.quantityUnit}</td><td><CellSummary movement={m} side="source" locations={locations}/></td><td><CellSummary movement={m} side="destination" locations={locations}/></td><td>{weightText(m.actualTotalWeightKg)}<p className="text-sm text-slate-600">{volumeText(m.actualTotalVolumeM3)}</p></td><td><time dateTime={m.performedAt}>{reservationVietnamTime(m.performedAt)}</time></td><td><CustomerMovementDetails movement={m} locations={locations} specifications={specifications} item={item}/></td></tr>)}</tbody></table></div></Card>}
  {movements?.length===0&&<EmptyState title="Chưa có lịch sử hàng hóa" description="Các thao tác đã hoàn tất sẽ xuất hiện tại đây."/>}
  <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={resource.loading} onClick={resource.retry}>Tải lại lịch sử</Button><Button asChild variant="outline"><Link to="/portal/inventory">Hàng hóa của tôi</Link></Button></div>
 </CustomerScreen>;
}
