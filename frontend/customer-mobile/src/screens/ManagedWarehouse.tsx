import {ManagedBookingConfirmation} from '../components/ManagedBookingConfirmation';
import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {managedInventory,type ManagedRange,type ManagedTerm} from '../api/managedInventory';
import {WarehouseRack2D} from '../components/WarehouseRack2D';
import {warehouseRackLayout} from '../domain/warehouseRackLayout';
import {managedCellState} from '../domain/managedCellSelection';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,ui} from '../components/ui';
import {dateLabel,LiveScreen,money,ResourceState,useResource} from '../components/liveUI';

export function ManagedMap(){
  const {facilityId}=useLocalSearchParams<{facilityId:string}>();
  const router=useRouter();
  const facility=useResource(facilityId,signal=>managedInventory.facility(facilityId,signal));
  return <LiveScreen title="Sơ đồ kho ký gửi" eyebrow="KHÔNG GIAN LƯU TRỮ" onRefresh={facility.reload} refreshing={facility.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...facility}/>
    {facility.data&&<>
      <AppText variant="card">{facility.data.name}</AppText>
      <AppText>Xem cấu trúc và trạng thái hiện tại của kho.</AppText>
      <ManagedMapPanel key={facilityId} facilityId={facilityId}/>
    </>}
  </LiveScreen>;
}

export function ManagedMapPanel({facilityId,range,term}:{facilityId:string;range?:ManagedRange;term?:ManagedTerm}){
  const owner=useLiveSession(s=>s.user?._id??'');
  const [zoneId,setZone]=useState(''),[rackId,setRack]=useState(''),[level,setLevel]=useState(0);
  const [cellId,setCell]=useState(''),[selected,setSelected]=useState<string[]>([]),[request,setRequest]=useState('');
  const scope=[owner,facilityId,range?.startDate,range?.endDate].join(':');
  const map=useResource(scope,signal=>managedInventory.map(facilityId,range,signal));
  const zone=map.data?.zones.find(item=>item._id===zoneId)??map.data?.zones[0];
  const racks=zone?.aisles.flatMap(aisle=>aisle.racks)??[];
  const rack=racks.find(item=>item._id===rackId)??racks[0];
  const detail=useResource(scope+':'+rack?._id,signal=>zone&&rack?managedInventory.rack(facilityId,zone._id,rack._id,range,signal):Promise.resolve(null));
  const levels=detail.data?.levels??[];
  const levelIndex=levels[level]?level:0;
  const currentLevel=levels[levelIndex];
  const layout=warehouseRackLayout(levels,detail.data?.rack.cellsPerLevel);
  const cells=[...(currentLevel?.cells??[])].sort((a,b)=>(a.cellNumber??Infinity)-(b.cellNumber??Infinity));
  const rackAvailable=detail.data?.rack.operationalStatus==='AVAILABLE';
  const activeCells=layout?cells.filter(cell=>selected.includes(cell._id)&&managedCellState(cell,!!range,rackAvailable).selectable):[];
  const volume=activeCells.reduce((total,cell)=>total+(cell.maxVolumeM3??0),0);
  const selectedCell=cells.find(cell=>cell._id===cellId);
  const requestScope=JSON.stringify([scope,rack?._id,currentLevel?.levelNumber,term,activeCells.map(cell=>cell._id),volume]);
  const canQuote=!!layout&&!!range&&!!term&&!!owner&&activeCells.length>0&&activeCells.length===selected.length;
  const quoteEnabled=canQuote&&request===requestScope;
  const quote=useResource(quoteEnabled?requestScope:'',signal=>quoteEnabled&&range&&term?managedInventory.quote({
    facilityId,startDate:range.startDate,term,allocatedCapacityM3:volume,cellIds:activeCells.map(cell=>cell._id),
  },range,signal):Promise.resolve(null));

  function reset(){setCell('');setSelected([]);setRequest('');}
  function reload(){reset();map.reload();detail.reload();}
  function toggle(id:string){
    if(!layout||!cells.some(cell=>cell._id===id&&managedCellState(cell,!!range,rackAvailable).selectable))return;
    setRequest('');
    setSelected(previous=>previous.includes(id)?previous.filter(cell=>cell!==id):previous.length<100?[...previous,id]:previous);
  }
  const status=selectedCell?managedCellState(selectedCell,!!range,rackAvailable):null;

  return <>
    <Card>
      <CardHeading icon="grid-outline" title="Sơ đồ khu vực và kệ" subtitle="Chọn khu vực, chọn kệ rồi chạm ô để xem chi tiết."/>
      <Button label="Làm mới sơ đồ" icon="refresh-outline" variant="quiet" onPress={reload}/>
      <ResourceState {...map}/>
      {map.data?.zones.length===0&&<AppText>Chưa có khu vực trên sơ đồ.</AppText>}
      {map.data&&<View style={ui.wrap}>{map.data.zones.map(item=><Filter key={item._id}
        label={item.name+' · '+item.code} selected={zone?._id===item._id}
        onPress={()=>{setZone(item._id);setRack('');setLevel(0);reset();}}/>)}</View>}
      {zone&&<AppText>Khu vực: {zone.name}</AppText>}
      {zone&&!racks.length&&<AppText>Chưa có kệ trong khu vực này.</AppText>}
      <View style={ui.wrap}>{racks.map(item=><Filter key={item._id} label={'Kệ '+item.rackCode} selected={rack?._id===item._id}
        onPress={()=>{setRack(item._id);setLevel(0);reset();}}/>)}</View>
      {rack&&<ResourceState {...detail} reload={reload}/>}
      {detail.data?.levels.length===0&&<AppText>Kệ chưa có tầng.</AppText>}
      {detail.data&&levels.length>0&&<WarehouseRack2D key={rack?._id} levels={levels} layout={layout} levelIndex={levelIndex}
        hasPeriod={!!range} rackAvailable={rackAvailable} inspectedId={cellId}
        selectedIds={new Set(activeCells.map(cell=>cell._id))}
        onInspect={(id,index)=>{
          if(index!==levelIndex){setLevel(index);reset();}
          setCell(id);
        }}/>}
    </Card>
    {selectedCell&&status&&<Card>
      <CardHeading icon="cube-outline" title={`Ô ${selectedCell.code}`}/>
      <AppText>Kệ {rack?.rackCode} · Tầng {currentLevel?.levelNumber??'chưa xác minh'} · Vị trí {selectedCell.cellNumber??'chưa xác minh'}</AppText>
      <AppText>{status.label}{selectedCell.isMine?' · Ô của bạn':''}{selectedCell.hasMyInventory?' · Có hàng của bạn':''}</AppText>
      <AppText>Rộng {selectedCell.dimensions.widthM} m · Sâu {selectedCell.dimensions.depthM} m</AppText>
      {selectedCell.dimensions.usableHeightM!==undefined&&<AppText>Cao sử dụng {selectedCell.dimensions.usableHeightM} m</AppText>}
      {selectedCell.maxWeightKg!==undefined&&<AppText>Tải trọng tối đa {selectedCell.maxWeightKg} kg</AppText>}
      {range&&<Button label={selected.includes(selectedCell._id)?'Bỏ chọn ô':'Thêm ô vào kỳ thuê'} disabled={!layout||!status.selectable||
        (selected.length>=100&&!selected.includes(selectedCell._id))} onPress={()=>toggle(selectedCell._id)}/>}
    </Card>}
    {range&&<Card>
      <CardHeading icon="layers-outline" title="Các ô chọn để thuê"/>
      <AppText>{dateLabel(range.startDate)} – {dateLabel(range.endDate)}</AppText>
      <AppText>Chọn nhiều ô trong tầng hiện tại để kiểm tra báo giá thuê. Việc chọn ô ở đây chưa giữ chỗ hay xác nhận vị trí đặt hàng vật lý.</AppText>
      {activeCells.map(cell=><AppText key={cell._id}>{cell.code} · {cell.maxVolumeM3} m³</AppText>)}
      {activeCells.length!==selected.length&&<AppText>Khả dụng đã thay đổi. Hãy xóa lựa chọn rồi chọn lại.</AppText>}
      {!!selected.length&&<Button label="Xóa lựa chọn" variant="quiet" onPress={reset}/>}
      <Button label="Kiểm tra khả dụng và báo giá" disabled={!canQuote} loading={quoteEnabled&&quote.loading}
        onPress={()=>{setRequest(requestScope);quote.reload();}}/>
      {quoteEnabled&&<ResourceState {...quote}/>}
      {quoteEnabled&&quote.data&&<TintedPanel>
        <AppText variant="card">Báo giá kho ký gửi V{quote.data.bookingFlowVersion}</AppText>
        <AppText>Dung tích thuê: {quote.data.allocatedCapacityM3} m³</AppText>
        <AppText>Tiền thuê dự kiến: {money(quote.data.pricing.estimatedRent)}</AppText>
        <AppText>Thuế: {money(quote.data.taxAmount)}</AppText>
        {quote.data.bookingFlowVersion===3
          ? <AppText>Thanh toán 100% tiền thuê: {money(quote.data.payment.amount)}</AppText>
          : <>
            <AppText>Tiền thuê trả trước: {money(quote.data.deposit.amount)}</AppText>
            <AppText>Tổng tiền dự kiến: {money(quote.data.paymentBreakdown.totalDue)}</AppText>
            <AppText>Phần còn lại: {money(quote.data.paymentBreakdown.balanceDue)}</AppText>
          </>}
      </TintedPanel>}

      {!!owner&&<ManagedBookingConfirmation key={owner} owner={owner}
        review={quoteEnabled&&quote.data?.bookingFlowVersion===3?quote.data:undefined}
        onReviewChanged={quote.reload}/>}
    </Card>}
  </>;
}

