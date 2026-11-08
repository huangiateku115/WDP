import {useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance} from 'react-native';
import {AppText, Button, Card, Chip, ui} from './ui';
import {colors} from '../theme/tokens';
import {cellEligibility, cellLabels, type CellStatus, type ManagedCell, type ManagedFacility, type ManagedRack, type ManagedZone} from '../domain/managedBooking';

export const volumeLabel = (n: number | null) => n === null ? 'Chưa xác định' : n.toLocaleString('vi-VN', {maximumFractionDigits: 6}) + ' m³';
const palette: Record<CellStatus, {background: string; text: string}> = {
  AVAILABLE: {background: colors.mint, text: colors.primary},
  RESERVED: {background: colors.orangeTint, text: colors.orangeText},
  RESERVED_YOURS: {background: colors.orangeTint, text: colors.orangeText},
  OCCUPIED: {background: colors.deep, text: colors.white},
  MAINTENANCE: {background: colors.dangerTint, text: colors.danger},
  UNKNOWN: {background: colors.soft, text: colors.muted},
};
export function CellStatusChip({status, selected = false}: {status: CellStatus; selected?: boolean}) {
  const tone = selected ? {background: colors.primary, text: colors.white} : palette[status];
  return <View style={{backgroundColor: tone.background, padding: 8, borderRadius: 10, alignSelf: 'flex-start'}}><AppText variant="label" style={{color: tone.text}}>{selected ? '✓ Đang chọn' : cellLabels[status]}</AppText></View>;
}
export function AvailabilityLegend() {
  return <Card><AppText variant="card">Chú giải theo kỳ thuê mẫu</AppText><View style={ui.wrap}>{(Object.keys(cellLabels) as CellStatus[]).map(status => <CellStatusChip key={status} status={status}/>)}<CellStatusChip status="AVAILABLE" selected/></View><AppText variant="caption" style={ui.muted}>Của bạn không đồng nghĩa có thể đặt lại. Trống chỉ khi toàn bộ dữ liệu điều kiện đã được xác nhận trong fixture.</AppText></Card>;
}
export function WarehouseFloorplan({facility, zone, activeRackId, start, months, onRack}: {facility: ManagedFacility; zone: ManagedZone; activeRackId: string | null; start: string; months: number; onRack: (id: string) => void}) {
  const [zoom, setZoom] = useState(1);
  const horizontal = useRef<ScrollViewInstance>(null), vertical = useRef<ScrollViewInstance>(null);
  const width = Math.max(460, ...zone.racks.map(r => r.position.x + r.position.width + 30));
  const height = Math.max(250, ...zone.racks.map(r => r.position.y + r.position.height + 40));
  const reset = () => {setZoom(1); horizontal.current?.scrollTo({x: 0, animated: false}); vertical.current?.scrollTo({y: 0, animated: false});};
  return <Card style={{padding: 12}}><AppText variant="card">Mặt bằng · {zone.name}</AppText><View style={ui.wrap}><Button label="Thu nhỏ" variant="outline" disabled={zoom <= 0.75} onPress={() => setZoom(z => Math.max(0.75, z - 0.25))}/><Button label="Phóng to" variant="outline" disabled={zoom >= 1.75} onPress={() => setZoom(z => Math.min(1.75, z + 0.25))}/><Button label="Đặt lại góc nhìn" variant="quiet" onPress={reset}/></View><AppText variant="caption" style={ui.muted}>Tỷ lệ {Math.round(zoom * 100)}% · Cuộn trong mặt bằng để di chuyển. Chạm kệ để xem các tầng.</AppText>
    <ScrollView ref={vertical} nestedScrollEnabled style={{height: 280, maxHeight: 280}}><ScrollView ref={horizontal} horizontal nestedScrollEnabled><View testID="warehouse-geometry" style={{width: width * zoom, height: height * zoom, backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line, borderRadius: 12}}>
      <View style={{position: 'absolute', top: 190 * zoom, left: 20 * zoom, right: 20 * zoom, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.line}}/>
      <AppText variant="caption" style={{position: 'absolute', left: 24 * zoom, top: 210 * zoom}}>Lối đi · khu tiếp nhận (minh họa)</AppText>
      {zone.racks.map(rack => {
        const available = rack.cells.filter(c => cellEligibility(facility, zone, rack, c, start, months).eligible).length;
        const active = rack.id === activeRackId;
        return <Pressable key={rack.id} accessibilityRole="button" accessibilityLabel={'Xem kệ ' + rack.code} accessibilityState={{selected: active}} onPress={() => onRack(rack.id)} style={{position: 'absolute', left: rack.position.x * zoom, top: rack.position.y * zoom, width: rack.position.width * zoom, minHeight: rack.position.height * zoom, padding: 12, gap: 8, borderRadius: 12, borderWidth: active ? 2 : 1, borderColor: active ? colors.primary : colors.line, backgroundColor: active ? colors.mint : colors.card}}><AppText variant="card">{rack.code}</AppText><AppText variant="caption">{rack.status === 'ACTIVE' && zone.status === 'ACTIVE' ? available + ' ô đủ điều kiện' : 'Tạm ngừng'}</AppText><AppText variant="caption">{rack.levels.length} tầng · Xem ô →</AppText></Pressable>;
      })}
    </View></ScrollView></ScrollView>
  </Card>;
}
export function RackElevation({facility, zone, rack, start, months, selectedIds, onToggle, onDetail}: {facility: ManagedFacility; zone: ManagedZone; rack: ManagedRack; start: string; months: number; selectedIds: string[]; onToggle: (id: string) => void; onDetail: (id: string) => void}) {
  return <Card><AppText variant="card">Cấu trúc kệ {rack.code}</AppText><AppText variant="caption" style={ui.muted}>{rack.levels.length} tầng theo fixture · Cuộn vùng kệ để xem toàn bộ ô.</AppText><ScrollView nestedScrollEnabled style={{maxHeight: 470}} contentContainerStyle={{gap: 20}}>{[...rack.levels].sort((a, b) => b - a).map(level => <View key={level} style={{gap: 10}}><AppText variant="medium">Tầng {level}</AppText><View style={ui.wrap}>{rack.cells.filter(c => c.level === level).sort((a, b) => a.number - b.number).map(cell => {
    const status = cellEligibility(facility, zone, rack, cell, start, months), selected = selectedIds.includes(cell.id);
    return <View key={cell.id} style={[s.cell, {borderColor: selected ? status.eligible ? colors.primary : colors.danger : colors.line}]}><AppText variant="label">{cell.code}</AppText><CellStatusChip status={status.status} selected={selected && status.eligible}/><AppText variant="caption">{volumeLabel(cell.usableVolumeM3)}</AppText><AppText variant="caption">{cell.maxWeightKg === null ? 'Chưa có giới hạn tải' : 'Tối đa ' + cell.maxWeightKg + ' kg'}</AppText>{selected && !status.eligible && <AppText variant="caption" style={{color: colors.danger}}>Lựa chọn cần kiểm tra lại</AppText>}<Button label={(selected ? 'Bỏ chọn ' : 'Chọn ') + cell.code} disabled={!selected && !status.eligible} variant={selected ? 'primary' : 'outline'} onPress={() => onToggle(cell.id)}/><Button label={'Chi tiết ' + cell.code} variant="quiet" onPress={() => onDetail(cell.id)}/></View>;
  })}</View></View>)}</ScrollView></Card>;
}
export function CellDetail({facility, zone, rack, cell, start, months, onClose}: {facility: ManagedFacility; zone: ManagedZone; rack: ManagedRack; cell: ManagedCell; start: string; months: number; onClose: () => void}) {
  const check = cellEligibility(facility, zone, rack, cell, start, months);
  return <Card><AppText variant="card">Thông số {cell.code}</AppText><CellStatusChip status={check.status}/><AppText>{check.reason}</AppText><AppText>{[cell.width, cell.depth, cell.height].some(n => n === null) ? 'Chưa đủ kích thước hữu dụng' : `${cell.width} × ${cell.depth} × ${cell.height} m`}</AppText><AppText>Thể tích hữu dụng: {volumeLabel(cell.usableVolumeM3)}</AppText><AppText>Sử dụng vật lý: {cell.physicalUsage ? `${volumeLabel(cell.physicalUsage.volumeM3)} · ${cell.physicalUsage.weightKg} kg` : 'Chưa xác nhận; không coi là 0'}</AppText><AppText variant="caption" style={ui.muted}>Thể tích đang sử dụng không phải dung tích thuê. Không thao tác di chuyển hoặc tiếp nhận hàng tại đây.</AppText><Button label="Đóng thông số ô" variant="quiet" onPress={onClose}/></Card>;
}
const s = StyleSheet.create({cell: {flexGrow: 1, flexBasis: 155, minWidth: 140, gap: 8, padding: 12, borderWidth: 2, borderRadius: 14, backgroundColor: colors.card}});
