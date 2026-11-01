import {useLocalSearchParams, useRouter} from 'expo-router';
import {useManagedBookingStore} from '../state/useManagedBookingStore';
import {useCustomerStore} from '../state/useCustomerStore';
import {findManagedWarehouse} from '../fixtures/managedWarehouse';
import {assessManagedDraft} from '../domain/managedBooking';
import {dayLabel, endDay} from '../domain/booking';
import {AppText, Button, Card, Chip, FixtureNotice, Screen, StateCard} from '../components/ui';
import {BackAction, PricingSummary, Value} from '../components/booking';
import {PrototypeConfirmationHeader} from '../components/PrototypeConfirmation';
import {volumeLabel} from '../components/managedWarehouse';

export default function ManagedConfirmationScreen() {
  const {facilityId} = useLocalSearchParams<{facilityId: string}>(), router = useRouter();
  const draft = useManagedBookingStore(s => s.draft), facility = findManagedWarehouse(facilityId);
  const customerFacility = useCustomerStore(s => s.fixtures.facilities.find(f => f.id === facilityId));
  const check = assessManagedDraft(facility, draft);
  const valid = check.valid && !!check.quote && draft?.previewed && draft.previewFingerprint === check.fingerprint && draft.facilityId === facilityId && customerFacility?.services.includes('MANAGED_INVENTORY');
  return <Screen safeTop={false} testID="screen-managed-confirmation"><FixtureNotice/>
    {!valid || !draft || !facility ? <StateCard title="Chưa có bản xem trước hợp lệ" description="Lựa chọn có thể thiếu, đã thay đổi hoặc không còn đủ điều kiện theo kỳ thuê. Quay lại bản đồ để kiểm tra."/> : <>
      <PrototypeConfirmationHeader/>
      <Chip label="Kho ký gửi · nhiều ô"/>
      <Card><AppText variant="card">{facility.name}</AppText><AppText>{customerFacility?.address ?? 'Chưa có địa chỉ mẫu'}</AppText><AppText>{dayLabel(draft.start)} – {dayLabel(endDay(draft.start, draft.months) ?? '')} · {draft.months} tháng</AppText><Value label="Dung tích lựa chọn" value={volumeLabel(check.capacity)}/>{check.cells.map(e => <AppText key={e.cell.id}>{e.zone.name} · {e.rack.code} · {e.cell.code} · {volumeLabel(e.cell.usableVolumeM3)}</AppText>)}</Card>
      <PricingSummary quote={check.quote}/>
      <Card><AppText variant="card">Lộ trình minh họa tiếp theo</AppText><AppText>1. Backend xác minh khả dụng và tạo đơn thuê thực tế.</AppText><AppText>2. Xác nhận tiền thuê trả trước trước các bước tiếp theo.</AppText><AppText>3. Khai báo hàng và gửi yêu cầu để nhân viên kiểm tra, tiếp nhận.</AppText><AppText>4. Hoàn tất ký hai bên, số dư và điều kiện kích hoạt theo trạng thái đã xác minh.</AppText><AppText>Bản xem trước không phân bổ ô vật lý, không đổi tồn kho và không thêm bản ghi vào Kho thuê của tôi. Draft được giữ trong phiên để xem lại; sửa ô hoặc kỳ thuê sẽ hủy cờ xem trước.</AppText></Card>
      <Button label="Xem kho thuê của tôi" onPress={() => router.replace('/(tabs)/rentals')}/><Button label="Quay về Khám phá" variant="outline" onPress={() => router.replace('/(tabs)/explore')}/>
    </>}
    <BackAction/>
  </Screen>;
}
