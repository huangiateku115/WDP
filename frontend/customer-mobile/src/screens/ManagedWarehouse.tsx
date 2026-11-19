import {ManagedBookingConfirmation} from '../components/ManagedBookingConfirmation';
import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {managedInventory,type ManagedRange,type ManagedTerm} from '../api/managedInventory';
import {WarehouseRack2D} from '../components/WarehouseRack2D';
import {warehouseRackLayout} from '../domain/warehouseRackLayout';
import {managedCellState,managedCellVolume,toggleManagedCellChoice,type ManagedCellChoice} from '../domain/managedCellSelection';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Chip,Filter,ui} from '../components/ui';
import {dateLabel,LiveScreen,money,ResourceState,useResource} from '../components/liveUI';
import {ManagedFacilityVisual} from '../components/ManagedFacilityVisual';
import {colors,radius} from '../theme/tokens';

const periodDateLabel=(value:string)=>value.slice(0,10).split('-').reverse().join('/');

export function ManagedMap(){
  const {facilityId}=useLocalSearchParams<{facilityId:string}>();
  const router=useRouter();
  const facility=useResource(facilityId,signal=>managedInventory.facility(facilityId,signal));
  return <LiveScreen title="Sơ đồ kho" eyebrow="KHO KÝ GỬI" subtitle="Khám phá các khu, kệ và vị trí lưu trữ." onRefresh={facility.reload} refreshing={facility.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...facility}/>
    {facility.data&&<>
      <Card style={styles.facilityCard}><ManagedFacilityVisual facility={facility.data}/></Card>
      <ManagedMapPanel key={facilityId} facilityId={facilityId}/>
    </>}
  </LiveScreen>;
}

export function ManagedMapPanel({facilityId,range,term,onChangePeriod}:{facilityId:string;range?:ManagedRange;term?:ManagedTerm;onChangePeriod?:()=>void}){
  const owner=useLiveSession(s=>s.user?._id??'');
  const [zoneId,setZone]=useState(''),[rackId,setRack]=useState(''),[level,setLevel]=useState(0);
  const [cellId,setCell]=useState(''),[selected,setSelected]=useState<ManagedCellChoice[]>([]),[request,setRequest]=useState('');
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
  const volume=selected.reduce((total,cell)=>total+cell.maxVolumeM3,0);
  const selectedCell=cells.find(cell=>cell._id===cellId);
  const requestScope=JSON.stringify([scope,term,selected.map(cell=>cell.id).sort(),volume]);
  const canQuote=!!layout&&!!range&&!!term&&!!owner&&selected.length>0&&selected.every(cell=>Number.isFinite(cell.maxVolumeM3)&&cell.maxVolumeM3>0);
  const quoteEnabled=canQuote&&request===requestScope;
  const quote=useResource(quoteEnabled?requestScope:'',signal=>quoteEnabled&&range&&term?managedInventory.quote({
    facilityId,startDate:range.startDate,term,allocatedCapacityM3:volume,cellIds:selected.map(cell=>cell.id),
  },range,signal):Promise.resolve(null));

  function clearSelection(){setCell('');setSelected([]);setRequest('');}
  function reload(){setCell('');setRequest('');map.reload();detail.reload();}
  function toggle(id:string){
    const cell=cells.find(row=>row._id===id);
    if(!layout||!cell)return;
    const alreadySelected=selected.some(row=>row.id===id);
    if(!alreadySelected&&!managedCellState(cell,!!range,rackAvailable).selectable)return;
    const volumeM3=managedCellVolume(cell);
    if(!alreadySelected&&(!zone||!rack||currentLevel?.levelNumber==null||volumeM3==null))return;
    setRequest('');
    if(alreadySelected)setSelected(previous=>toggleManagedCellChoice(previous,{id,code:cell.code??id,maxVolumeM3:cell.maxVolumeM3??0,zoneName:zone?.name??'',rackCode:rack?.rackCode??'',levelNumber:currentLevel?.levelNumber??0}));
    else setSelected(previous=>toggleManagedCellChoice(previous,{id,code:cell.code??id,maxVolumeM3:volumeM3!,zoneName:zone!.name,rackCode:rack!.rackCode,levelNumber:currentLevel!.levelNumber!}));
  }
  const status=selectedCell?managedCellState(selectedCell,!!range,rackAvailable):null;

  return <>
    {range&&term&&<TintedPanel>
      <View style={styles.periodContext}><View style={{flex:1,gap:3}}>
        <AppText variant="label">KỲ THUÊ ĐANG XEM</AppText>
        <AppText variant="medium">{term.value} {term.unit==='MONTH'?'tháng':term.unit==='YEAR'?'năm':'ngày'}</AppText>
        <AppText variant="caption">{periodDateLabel(range.startDate)} – {periodDateLabel(range.endDate)}</AppText>
      </View>
      {onChangePeriod&&<Button label="Đổi kỳ thuê" variant="outline" onPress={onChangePeriod}/>}
      </View>
    </TintedPanel>}
    <Card style={styles.mapCard}>
      <CardHeading icon="grid-outline" title="Bản đồ kho trực quan" subtitle="Dữ liệu khu, kệ, tầng và ô được tải từ sơ đồ kho."/>
      <Button label="Làm mới sơ đồ" icon="refresh-outline" variant="quiet" onPress={reload}/>
      <ResourceState {...map}/>
      {map.data?.zones.length===0&&<AppText>Chưa có khu vực trên sơ đồ.</AppText>}
      {map.data&&<View style={styles.selectorBlock}>
        <View style={styles.selectorHeading}><AppText variant="label" style={styles.eyebrow}>PHÂN KHU</AppText><AppText variant="caption" style={styles.caption}>Chọn khu vực</AppText></View>
        <View style={ui.wrap}>{map.data.zones.map(item=><Filter key={item._id}
          label={item.name+' · '+item.code} selected={zone?._id===item._id}
          onPress={()=>{setZone(item._id);setRack('');setLevel(0);setCell('');setRequest('');}}/>)}</View>
      </View>}
      {zone&&<View style={styles.context}><Chip label={zone.name}/><AppText variant="caption" style={styles.caption}>Khu vực đang xem</AppText></View>}
      {zone&&!racks.length&&<AppText>Chưa có kệ trong khu vực này.</AppText>}
      {!!racks.length&&<View style={styles.selectorBlock}>
        <View style={styles.selectorHeading}><AppText variant="label" style={styles.eyebrow}>DÃY KỆ</AppText><AppText variant="caption" style={styles.caption}>{racks.length} kệ</AppText></View>
        <View style={ui.wrap}>{racks.map(item=><Filter key={item._id} label={'Kệ '+item.rackCode} selected={rack?._id===item._id}
          onPress={()=>{setRack(item._id);setLevel(0);setCell('');setRequest('');}}/>)}</View>
      </View>}
      {rack&&<ResourceState {...detail} reload={reload}/>}
      {detail.data?.levels.length===0&&<AppText>Kệ chưa có tầng.</AppText>}
      {detail.data&&levels.length>0&&<View style={styles.mapStage}>
        <View style={styles.mapHeading}><View style={{flex:1}}><AppText variant="card">Kệ {rack?.rackCode}</AppText><AppText variant="caption" style={styles.caption}>{levels.length} tầng · chạm ô để xem thông tin</AppText></View><Chip label={layout?'Sơ đồ vật lý':'Danh sách theo tầng'} tone="neutral"/></View>
        <WarehouseRack2D key={rack?._id} levels={levels} layout={layout} levelIndex={levelIndex}
          hasPeriod={!!range} rackAvailable={rackAvailable} inspectedId={cellId}
          selectedIds={new Set(selected.map(cell=>cell.id))}
          onInspect={(id,index)=>{
            if(index!==levelIndex){setLevel(index);setRequest('');}
            setCell(id);
          }}/>
      </View>}
    </Card>
    {selectedCell&&status&&<Card>
      <CardHeading icon="cube-outline" title={`Thông tin ô ${selectedCell.code}`} subtitle={`Kệ ${rack?.rackCode} · Tầng ${currentLevel?.levelNumber??'chưa xác minh'} · Vị trí ${selectedCell.cellNumber??'chưa xác minh'}`}/>
      <View style={styles.statusRow}><Chip label={status.label} tone={status.kind==='RESERVED'?'orange':status.kind==='OCCUPIED'||status.kind==='MAINTENANCE'?'danger':status.kind==='AVAILABLE'?'green':'neutral'}/>
        {selectedCell.isMine&&<Chip label="Ô của bạn" tone="neutral"/>}{selectedCell.hasMyInventory&&<Chip label="Có hàng của bạn" tone="neutral"/>}</View>
      <View style={styles.metricGrid}>
        <View style={styles.metric}><AppText variant="caption" style={styles.caption}>Kích thước</AppText><AppText variant="medium">{selectedCell.dimensions.widthM} × {selectedCell.dimensions.depthM}{selectedCell.dimensions.usableHeightM!==undefined?' × '+selectedCell.dimensions.usableHeightM:''} m</AppText></View>
        {selectedCell.capacityDisclosure!=='REDACTED'&&selectedCell.maxVolumeM3!=null&&<View style={styles.metric}><AppText variant="caption" style={styles.caption}>Dung tích tối đa</AppText><AppText variant="medium">{selectedCell.maxVolumeM3} m³</AppText></View>}
        {selectedCell.capacityDisclosure!=='REDACTED'&&selectedCell.maxWeightKg!==undefined&&<View style={styles.metric}><AppText variant="caption" style={styles.caption}>Tải trọng tối đa</AppText><AppText variant="medium">{selectedCell.maxWeightKg} kg</AppText></View>}
        {selectedCell.capacityDisclosure!=='REDACTED'&&selectedCell.physicalUsageKnown===true&&<View style={styles.metric}><AppText variant="caption" style={styles.caption}>Đang sử dụng</AppText><AppText variant="medium">{selectedCell.usedVolumeM3!==undefined?selectedCell.usedVolumeM3+' m³':'Chưa có số liệu thể tích'}{selectedCell.usedWeightKg!==undefined?' · '+selectedCell.usedWeightKg+' kg':''}</AppText></View>}
      </View>
      {range&&<Button label={selected.some(row=>row.id===selectedCell._id)?'Bỏ chọn ô':'Thêm ô vào kỳ thuê'} disabled={!layout||
        (!status.selectable&&!selected.some(row=>row.id===selectedCell._id))||
        (selected.length>=100&&!selected.some(row=>row.id===selectedCell._id))} onPress={()=>toggle(selectedCell._id)}/>}
    </Card>}
    {range&&<Card>
      <CardHeading icon="layers-outline" title="Tóm tắt lựa chọn" subtitle="Chỉ gồm các vị trí hiện còn phù hợp."/>
      <View style={styles.selectionStats}><Chip label={`${selected.length} ô đã chọn`}/><Chip label={`${volume} m³`} tone="neutral"/></View>
      <AppText>{periodDateLabel(range.startDate)} – {periodDateLabel(range.endDate)}</AppText>
      <AppText>Chọn ô ở nhiều tầng, kệ hoặc khu vực. Báo giá sẽ xác minh lại khả dụng và sức chứa; lựa chọn này chưa giữ chỗ.</AppText>
      {selected.map(cell=><View key={cell.id} style={styles.selectedCellRow}><AppText style={{flex:1}}>{cell.code} · {cell.zoneName} · Kệ {cell.rackCode} · Tầng {cell.levelNumber} · {cell.maxVolumeM3} m³</AppText><Button label="Bỏ" variant="quiet" onPress={()=>{setSelected(previous=>toggleManagedCellChoice(previous,cell));setRequest('');}}/></View>)}
      {!!selected.length&&<Button label="Xóa tất cả ô đã chọn" variant="quiet" onPress={clearSelection}/>}
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

const styles=StyleSheet.create({
  facilityCard:{padding:12},
  mapCard:{gap:14},
  selectorBlock:{gap:8,padding:12,borderRadius:radius.md,backgroundColor:colors.soft,borderWidth:1,borderColor:colors.line},
  selectorHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  eyebrow:{color:colors.primary,letterSpacing:1},
  caption:{color:colors.muted},
  context:{flexDirection:'row',alignItems:'center',gap:8},
  mapStage:{gap:10,padding:10,borderRadius:radius.md,backgroundColor:colors.soft,borderWidth:1,borderColor:colors.line},
  mapHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  statusRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  metricGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  metric:{flexGrow:1,flexBasis:'44%',minWidth:130,padding:10,borderRadius:radius.sm,backgroundColor:colors.soft,gap:3},
  selectionStats:{flexDirection:'row',alignItems:'center',gap:8},
  selectedCellRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,borderBottomWidth:1,borderBottomColor:colors.line},
  periodContext:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
});

