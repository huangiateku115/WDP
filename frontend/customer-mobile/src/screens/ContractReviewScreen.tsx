import {useEffect, useState} from 'react';
import {Pressable} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {rentalDocumentScenarios} from '../fixtures/rentalDocuments';
import {contractAvailabilityReason, ownedRentalScenario, signatureProgress, type ContractDocument} from '../domain/rentalDocuments';
import {serviceLabel} from '../domain/models';
import {AppText, Button, Card, Chip, FixtureNotice, Screen, StateCard, ui} from '../components/ui';
import {BackAction, Value} from '../components/booking';
import {ContractProgressCard, ContractSignatureStatus, FinancialBreakdown, FinancialScenarioPicker, PrototypeFinancialNotice, safeRentalDate} from '../components/rentalDocuments';

export default function ContractReviewScreen({loading = false, error}: {loading?: boolean; error?: string}) {
  const {id, scenario} = useLocalSearchParams<{id: string; scenario?: string}>(), data = useCustomerStore(s => s.fixtures);
  const [selected, setSelected] = useState<string | undefined>(scenario);
  useEffect(() => setSelected(scenario), [id, scenario]);
  const context = ownedRentalScenario(data, id, rentalDocumentScenarios, selected);
  const scenarios = rentalDocumentScenarios.filter(s => s.rentalId === id && s.ownerId === data.customer?.id);
  const unavailable = context ? contractAvailabilityReason(context.scenario) : null;
  const document = context?.scenario.contract;
  const snapshot = !unavailable ? document?.snapshot : null;
  return <Screen safeTop={false} testID="screen-contract-review"><FixtureNotice/><AppText variant="title">Hợp đồng thuê kho</AppText>
    {loading ? <StateCard kind="loading" title="Đang chuẩn bị tài liệu mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị hợp đồng" description={error}/> : !context ? <StateCard title="Không tìm thấy hồ sơ hợp đồng mẫu" description="Kỳ thuê/tình huống không thuộc khách hàng hiện tại hoặc đường dẫn không hợp lệ."/> : <>
      <PrototypeFinancialNotice/>
      {context.scenario.alternate && <Chip label="Tình huống độc lập · không thay đổi kỳ thuê" tone="orange"/>}
      <Card><AppText variant="card">{snapshot?.facilityName ?? data.facilities.find(f => f.id === context.rental.facilityId)?.name ?? 'Chưa có thông tin cơ sở'}</AppText><Value label="Khách hàng trong tài liệu minh họa" value={snapshot?.customerLabel ?? 'Khách hàng bản mẫu'}/><Value label="Kỳ thuê" value={snapshot?.rentalCode ?? context.rental.code}/><Chip label={serviceLabel(context.rental.service)}/><Value label="Thời gian thuê" value={safeRentalDate(snapshot?.start ?? context.rental.start) + ' – ' + safeRentalDate(snapshot?.end ?? context.rental.end)}/><Value label={context.rental.service === 'SELF_STORAGE' ? 'Kho riêng' : 'Các ô ký gửi'} value={(snapshot?.resource ?? context.rental.unit) + ' · ' + (snapshot?.capacityLabel ?? context.rental.capacityLabel)}/></Card>
      {unavailable || !document ? <StateCard title="Hợp đồng chưa khả dụng" description={unavailable ?? 'Chưa có tài liệu mẫu.'}/> : <>
        <Card><AppText variant="card">Bản đọc hợp đồng minh họa</AppText><AppText>{document.reference}</AppText><Chip label={'Phiên bản ' + document.version}/><AppText variant="caption" style={ui.muted}>Chỉ có nhãn tham chiếu nội dung mẫu, không có mã băm hay chứng thư xác thực. Tài liệu không thể chỉnh sửa tại màn hình này.</AppText></Card>
        <ContractProgressCard document={document}/>
        <Card><AppText variant="heading">Nội dung để đọc</AppText><AppText variant="card">1. Các bên trong bản mẫu</AppText><AppText>Khách hàng bản mẫu và đại diện cơ sở kho bản mẫu. Không chứa giấy tờ định danh, chứng nhận hoặc thông tin cá nhân thực của bên khác.</AppText><AppText variant="card">2. Tài nguyên lưu trữ</AppText><AppText>{context.rental.service === 'SELF_STORAGE' ? 'Mô tả kho riêng: ' : 'Mô tả các ô ký gửi: '}{snapshot?.resource}. Dung tích tham chiếu: {snapshot?.capacityLabel}.</AppText><AppText variant="card">3. Thời gian</AppText><AppText>{safeRentalDate(snapshot?.start)} – {safeRentalDate(snapshot?.end)}. Giữ thời điểm trong dữ liệu mẫu, hiển thị theo lịch Việt Nam.</AppText><AppText variant="card">4. Tài chính</AppText><AppText>Các khoản dưới đây lấy từ cùng ảnh chụp dữ liệu tài chính của ví dụ. Tiền thuê trả trước cấn trừ vào tổng thuê; không tự thêm phí, thuế hoặc quyền hoàn tiền.</AppText><AppText variant="card">5. Phạm vi bản đọc</AppText><AppText>Đây là các phần mô tả để đánh giá giao diện, không phải điều khoản pháp lý hoặc hợp đồng để giao kết. Văn bản chính thức và điều kiện có hiệu lực chỉ có thể xem khi hệ thống đã được tích hợp, xác minh.</AppText><AppText>Đọc tài liệu, ghi nhận đã đọc, ký đủ hai bên và thanh toán là các bước độc lập. Khách hàng không thể xác nhận bàn giao, nhập hàng hay kích hoạt thay nhân viên.</AppText></Card>
        <FinancialBreakdown snapshot={context.scenario.finance}/>
        <ContractSignatureStatus signature={document.customer} currentVersion={document.version}/><ContractSignatureStatus signature={document.facility} currentVersion={document.version}/>
        <ReviewAcknowledgement key={context.scenario.id + ':' + document.version + ':' + document.documentReference} document={document}/>
        <Card><AppText variant="card">Bản sao tài liệu</AppText><Button label="Tải PDF · chưa khả dụng" variant="outline" disabled onPress={() => {}}/><Button label="Gửi bản sao · chưa khả dụng" variant="outline" disabled onPress={() => {}}/><AppText variant="caption" style={ui.muted}>Không tạo, tải hoặc gửi tệp trong chế độ ngoại tuyến.</AppText></Card>
      </>}
      <FinancialScenarioPicker scenarios={scenarios} selected={context.scenario.id} onSelect={setSelected}/>
    </>}
    <BackAction fallback="/(tabs)/rentals"/>
  </Screen>;
}
function ReviewAcknowledgement({document}: {document: ContractDocument}) {
  const [read, setRead] = useState(false), progress = signatureProgress(document);
  return <Card><Pressable accessibilityRole="checkbox" accessibilityLabel="Tôi đã đọc nội dung hợp đồng minh họa." accessibilityState={{checked: read}} onPress={() => setRead(v => !v)} style={{minHeight: 50, paddingVertical: 12}}><AppText variant="medium">{read ? '☑' : '☐'} Tôi đã đọc nội dung hợp đồng minh họa.</AppText></Pressable>{read && <AppText variant="caption" style={ui.muted}>Chỉ ghi nhận đã đọc trên màn hình, không tạo chữ ký hoặc mở bước thanh toán/kích hoạt.</AppText>}<Button label={progress.state === 'SIGNED' ? 'Đã ghi nhận đủ hai bên · chỉ xem' : 'Ký hợp đồng · chưa kết nối'} disabled onPress={() => {}}/><AppText variant="caption" style={ui.muted}>Tạm khóa ký: Backend chưa ràng buộc đúng phiên bản/mã băm đã đọc. Không có xác thực OTP, ký số hoặc hành động ký thay đại diện cơ sở.</AppText></Card>;
}
