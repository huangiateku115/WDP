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
        <Card><AppText variant="card">Hợp đồng tham khảo</AppText><AppText>{document.reference}</AppText><Chip label={'Bản số ' + document.version}/><AppText variant="caption" style={ui.muted}>Tài liệu này chỉ để tham khảo và không thể chỉnh sửa tại đây.</AppText></Card>
        <ContractProgressCard document={document}/>
        <Card><AppText variant="heading">Nội dung tham khảo</AppText><AppText variant="card">1. Các bên</AppText><AppText>Thông tin khách hàng và đại diện cơ sở trong tài liệu này chỉ mang tính minh họa.</AppText><AppText variant="card">2. Không gian lưu trữ</AppText><AppText>{context.rental.service === 'SELF_STORAGE' ? 'Kho riêng: ' : 'Các ô ký gửi: '}{snapshot?.resource}. Dung tích tham khảo: {snapshot?.capacityLabel}.</AppText><AppText variant="card">3. Thời gian</AppText><AppText>{safeRentalDate(snapshot?.start)} – {safeRentalDate(snapshot?.end)}. Ngày giờ hiển thị theo lịch Việt Nam.</AppText><AppText variant="card">4. Chi phí</AppText><AppText>Các khoản tham khảo được tính theo thông tin trong tài liệu. Tiền thuê trả trước được trừ vào tổng tiền thuê.</AppText><AppText variant="card">5. Lưu ý</AppText><AppText>Đây không phải hợp đồng để ký kết. Vui lòng xem và ký tài liệu chính thức tại cơ sở.</AppText><AppText>Việc đọc tài liệu, ký hợp đồng, thanh toán và bàn giao là các bước riêng biệt. Chỉ nhân viên cơ sở mới xác nhận bàn giao và tiếp nhận hàng.</AppText></Card>
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
  return <Card><Pressable accessibilityRole="checkbox" accessibilityLabel="Tôi đã đọc nội dung hợp đồng minh họa." accessibilityState={{checked: read}} onPress={() => setRead(v => !v)} style={{minHeight: 50, paddingVertical: 12}}><AppText variant="medium">{read ? '☑' : '☐'} Tôi đã đọc nội dung hợp đồng minh họa.</AppText></Pressable>{read && <AppText variant="caption" style={ui.muted}>Thao tác này chỉ xác nhận bạn đã đọc nội dung trên màn hình.</AppText>}<Button label={progress.state === 'SIGNED' ? 'Đã ký · chỉ xem' : 'Ký hợp đồng tại cơ sở'} disabled onPress={() => {}}/><AppText variant="caption" style={ui.muted}>Tính năng ký trực tuyến chưa khả dụng. Vui lòng hoàn tất việc ký tại cơ sở.</AppText></Card>;
}
