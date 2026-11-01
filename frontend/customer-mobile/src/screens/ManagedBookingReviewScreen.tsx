import {useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {findManagedWarehouse} from '../fixtures/managedWarehouse';
import {useManagedBookingStore} from '../state/useManagedBookingStore';
import {useCustomerStore} from '../state/useCustomerStore';
import {assessManagedDraft, illustrativeMonthlyPrice} from '../domain/managedBooking';
import {dayLabel, endDay} from '../domain/booking';
import {money} from '../domain/models';
import {AppText, Button, Card, Chip, FixtureNotice, Screen, StateCard, ui} from '../components/ui';
import {BackAction, PricingSummary, Value} from '../components/booking';
import {volumeLabel} from '../components/managedWarehouse';
import {ManagedBookingSummary} from '../components/ManagedBookingSummary';

export default function ManagedBookingReviewScreen() {
  const {facilityId} = useLocalSearchParams<{facilityId: string}>(), router = useRouter();
  const {draft, preview} = useManagedBookingStore();
  const facility = findManagedWarehouse(facilityId);
  const customerFacility = useCustomerStore(s => s.fixtures.facilities.find(f => f.id === facilityId));
  const [accepted, setAccepted] = useState(false), [error, setError] = useState('');
  useEffect(() => {setAccepted(false); setError('');}, [draft]);
  const check = assessManagedDraft(facility, draft);
  const context = facility && customerFacility?.services.includes('MANAGED_INVENTORY') && draft?.facilityId === facilityId;
  const edit = () => {
    if (!facility) return;
    if (router.canGoBack()) router.back();
    else router.replace({pathname: '/managed/[facilityId]/map', params: {facilityId: facility.id}});
  };
  const confirm = () => {
    if (!accepted || !context) return;
    if (preview()) router.push({pathname: '/managed/[facilityId]/confirmation', params: {facilityId}});
    else setError('Lựa chọn không còn hợp lệ hoặc đã được xem trước. Hãy kiểm tra lại bản đồ.');
  };
  return <Screen safeTop={false} testID="screen-managed-review" footer={context && draft ? <ManagedBookingSummary facility={facility} draft={draft} label="Xem trước xác nhận đặt chỗ" disabled={!accepted || draft.previewed} onContinue={confirm}/> : undefined}>
    <FixtureNotice/>
    {!context || !draft ? <StateCard title="Chưa có lựa chọn ô hợp lệ" description="Hãy mở cơ sở kho ký gửi và chọn các ô trên bản đồ."/> : <>
      <Chip label="Kho ký gửi · kiểm tra lựa chọn"/>
      <AppText variant="title">Dung tích của bạn, rõ từng ô</AppText>
      <Card><AppText variant="card">{facility.name}</AppText><AppText style={ui.muted}>{customerFacility?.address ?? 'Chưa có địa chỉ mẫu'}</AppText><Value label="Kỳ thuê dự kiến" value={`${dayLabel(draft.start)} – ${dayLabel(endDay(draft.start, draft.months) ?? '')}`}/><AppText>{draft.months} tháng · minh họa</AppText><Button label="Chỉnh sửa ô trên bản đồ" variant="outline" onPress={edit}/></Card>
      {!check.valid && <StateCard kind="error" title="Lựa chọn cần kiểm tra lại" description={check.invalid.map(i => i.reason).join(' ') || 'Cần ít nhất một ô và kỳ thuê hợp lệ thuộc cùng cơ sở.'}/>}
      <Card><AppText variant="card">Dung tích thuê đã chọn</AppText><Value label="Số ô" value={String(draft.cellIds.length)}/><Value label="Tổng thể tích hữu dụng" value={volumeLabel(check.capacity)}/><AppText variant="caption" style={ui.muted}>Cộng thể tích hữu dụng từng ô; không dùng tồn kho hoặc thể tích hàng đang lưu.</AppText></Card>
      {check.cells.map(({zone, rack, cell}) => <Card key={cell.id}><View style={ui.between}><AppText variant="card">{cell.code}</AppText><Chip label={'Tầng ' + cell.level}/></View><AppText>{zone.name} · Kệ {rack.code}</AppText><Value label="Thể tích hữu dụng" value={volumeLabel(cell.usableVolumeM3)}/><AppText>{cell.maxWeightKg === null ? 'Chưa có giới hạn tải mẫu' : `Giới hạn tải: ${cell.maxWeightKg} kg`}</AppText><AppText variant="caption" style={ui.muted}>{illustrativeMonthlyPrice(cell.usableVolumeM3, facility.monthlyRatePerM3) !== null ? money(illustrativeMonthlyPrice(cell.usableVolumeM3, facility.monthlyRatePerM3)!) + ' / tháng · minh họa' : 'Chưa có giá mẫu cho ô'}</AppText></Card>)}
      <Card><AppText variant="card">Cách tính minh họa</AppText><Value label="Đơn giá theo m³ / tháng" value={facility.monthlyRatePerM3 ? money(facility.monthlyRatePerM3) : 'Chưa có báo giá'}/><AppText>Tổng tiền thuê = tổng m³ hữu dụng × đơn giá mẫu × số tháng. Không chiết khấu hoặc phụ phí giả định.</AppText><AppText variant="caption" style={ui.muted}>Đây là cấu hình fixture, chưa phải chính sách giá hoặc báo giá Backend.</AppText></Card>
      {!check.quote && <AppText accessibilityRole="alert">Chưa có báo giá</AppText>}
      <PricingSummary quote={check.quote}/>
      <Card><AppText variant="card">Trước khi xem trước</AppText><AppText>• Bạn thuê dung tích ô kệ, không có quyền ra vào trực tiếp kho chung.</AppText><AppText>• Nhân viên thực hiện tiếp nhận và di chuyển hàng vật lý.</AppText><AppText>• Hàng đã khai báo không tự động được coi là đã nhập kho.</AppText><AppText>• Cần xác nhận tiền thuê trả trước trước các bước tiếp theo của vòng đời thuê.</AppText><AppText variant="caption" style={ui.muted}>Cọc được cấn trừ vào tổng tiền thuê; không phải khoản bảo đảm bổ sung. Không thanh toán trong bản mẫu.</AppText><Pressable accessibilityRole="checkbox" accessibilityLabel="Tôi hiểu đây là bản xem trước kho ký gửi" accessibilityState={{checked: accepted}} onPress={() => setAccepted(v => !v)} style={{minHeight: 50, paddingVertical: 12}}><AppText variant="medium">{accepted ? '☑' : '☐'} Tôi hiểu đây là bản xem trước kho ký gửi</AppText></Pressable></Card>
      {draft.previewed && <AppText>Bạn đã xem trước lựa chọn này. Chỉnh sửa ô hoặc kỳ thuê trên bản đồ để bắt đầu lượt xem trước mới.</AppText>}
      {!!error && <AppText accessibilityRole="alert">{error}</AppText>}
    </>}
    <BackAction/>
  </Screen>;
}
