import {useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {useManagedBookingStore} from '../state/useManagedBookingStore';
import {findManagedWarehouse} from '../fixtures/managedWarehouse';
import {assessManagedDraft, cellEligibility, cellEntries} from '../domain/managedBooking';
import {AppText, Button, Chip, Filter, FixtureNotice, Screen, StateCard, ui} from '../components/ui';
import {BackAction} from '../components/booking';
import {RentalPeriodSelector} from '../components/RentalPeriodSelector';
import {AvailabilityLegend, CellDetail, RackElevation, WarehouseFloorplan} from '../components/managedWarehouse';
import {ManagedBookingSummary} from '../components/ManagedBookingSummary';

export default function WarehouseMapScreen({loading = false, error}: {loading?: boolean; error?: string}) {
  const {facilityId, rackId} = useLocalSearchParams<{facilityId: string; rackId?: string}>(), router = useRouter();
  const customerFacility = useCustomerStore(s => s.fixtures.facilities.find(f => f.id === facilityId));
  const facility = typeof facilityId === 'string' ? findManagedWarehouse(facilityId) : undefined;
  const {draft, begin, toggle, remove, setPeriod} = useManagedBookingStore();
  const [zoneId, setZoneId] = useState<string | null>(null), [activeRack, setActiveRack] = useState<string | null>(null);
  const [panel, setPanel] = useState<'floorplan' | 'rack'>('floorplan'), [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (!facility || !customerFacility?.services.includes('MANAGED_INVENTORY')) return;
    begin(facility.id);
    const requestedZone = facility.zones.find(z => z.racks.some(r => r.id === rackId));
    setZoneId(requestedZone?.id ?? facility.zones[0]?.id ?? null);
    setActiveRack(rackId ?? null); setPanel(rackId ? 'rack' : 'floorplan'); setDetailId(null);
  }, [facility, customerFacility, facilityId, rackId, begin]);
  const valid = facility && customerFacility?.services.includes('MANAGED_INVENTORY') && draft?.facilityId === facilityId;
  const zone = facility?.zones.find(z => z.id === zoneId), rack = zone?.racks.find(r => r.id === activeRack);
  const unknownRack = !!rackId && !facility?.zones.some(z => z.racks.some(r => r.id === rackId));
  const check = assessManagedDraft(facility, draft);
  const entries = cellEntries(facility);
  const available = facility && draft ? entries.filter(e => cellEligibility(facility, e.zone, e.rack, e.cell, draft.start, draft.months).eligible).length : 0;
  const detail = entries.find(e => e.cell.id === detailId && e.rack.id === rack?.id);
  const continuation = () => {
    const current = useManagedBookingStore.getState().draft;
    const latest = assessManagedDraft(facility, current);
    if (facility && current?.facilityId === facilityId && latest.valid && latest.quote) router.push({pathname: '/managed/[facilityId]/review', params: {facilityId: facility.id}});
  };
  return <Screen safeTop={false} testID="screen-managed-map" footer={!loading && !error && valid && draft && !unknownRack ? <ManagedBookingSummary facility={facility} draft={draft} label="Xem lại các ô đã chọn" onContinue={continuation}/> : undefined}>
    <FixtureNotice/>
    {loading ? <StateCard kind="loading" title="Đang chuẩn bị bản đồ mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị bản đồ mẫu" description={error}/> : !facility || !customerFacility?.services.includes('MANAGED_INVENTORY') ? <StateCard title="Không tìm thấy kho ký gửi mẫu"/> : unknownRack ? <StateCard title="Không tìm thấy kệ trong cơ sở mẫu"/> : !valid || !draft ? <StateCard kind="loading" title="Đang chuẩn bị kỳ thuê mẫu"/> : <>
      <Chip label="Kho ký gửi · lựa chọn dung tích ô kệ"/>
      <AppText variant="title">Chọn không gian cho hàng hóa</AppText><AppText variant="medium">{facility.name}</AppText>
      <AppText style={ui.muted}>{facility.zones.length} khu · {available}/{entries.length} ô đủ điều kiện theo kỳ thuê mẫu</AppText>
      <RentalPeriodSelector key={facilityId} draft={draft} onChange={setPeriod}/>
      {check.invalid.length > 0 && <View accessibilityRole="alert" style={{gap: 8}}><AppText variant="card">Lựa chọn cần kiểm tra lại</AppText><AppText>Thay đổi kỳ thuê không tự xóa ô. Hãy bỏ các lựa chọn không còn hợp lệ hoặc điều chỉnh lại kỳ thuê.</AppText>{check.invalid.map(i => <View key={i.id} style={{gap: 6}}><AppText>{entries.find(e => e.cell.id === i.id)?.cell.code ?? i.id}: {i.reason}</AppText><Button label={'Bỏ ô không hợp lệ ' + (entries.find(e => e.cell.id === i.id)?.cell.code ?? i.id)} variant="outline" onPress={() => remove(i.id)}/></View>)}</View>}
      <AppText variant="card">Khu vực lưu trữ</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{gap: 8}}>{facility.zones.map(z => <Filter key={z.id} label={z.name} selected={z.id === zoneId} onPress={() => {setZoneId(z.id); setActiveRack(null); setPanel('floorplan'); setDetailId(null);}}/>)}</ScrollView>
      {zone ? <>
        {zone.status !== 'ACTIVE' && <AppText accessibilityRole="alert">Khu này tạm ngừng; chỉ xem cấu trúc, không chọn ô.</AppText>}
        {zone.racks.length === 0 ? <StateCard title="Khu này chưa bố trí kệ"/> : <>
          {panel === 'rack' && <><Button label="Trở về mặt bằng khu" variant="outline" onPress={() => {setPanel('floorplan'); setDetailId(null);}}/><ScrollView horizontal contentContainerStyle={{gap: 8}}>{zone.racks.map(r => <Filter key={r.id} label={'Kệ ' + r.code} selected={r.id === activeRack} onPress={() => {setActiveRack(r.id); setDetailId(null);}}/>)}</ScrollView></>}
          <View style={{display: panel === 'floorplan' ? 'flex' : 'none'}}><WarehouseFloorplan key={zone.id} facility={facility} zone={zone} activeRackId={activeRack} start={draft.start} months={draft.months} onRack={id => {setActiveRack(id); setPanel('rack'); setDetailId(null);}}/></View>
          {panel === 'rack' && (rack ? <RackElevation key={rack.id} facility={facility} zone={zone} rack={rack} start={draft.start} months={draft.months} selectedIds={draft.cellIds} onToggle={toggle} onDetail={setDetailId}/> : <StateCard title="Không tìm thấy kệ mẫu"/>)}
          {detail && <CellDetail facility={facility} {...detail} start={draft.start} months={draft.months} onClose={() => setDetailId(null)}/>}
        </>}
      </> : <StateCard title="Chưa có khu lưu trữ mẫu"/>}
      <AvailabilityLegend/>
      <AppText variant="caption" style={ui.muted}>Bạn chọn dung tích thuê, không chọn vị trí đặt hàng vật lý. Không có giữ chỗ Backend, thay đổi tồn kho hoặc quyền ra vào kho.</AppText>
    </>}
    <BackAction/>
  </Screen>;
}
