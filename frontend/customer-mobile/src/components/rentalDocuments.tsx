import {useState} from 'react';
import {View} from 'react-native';
import {AppText, Button, Card, Chip, Filter, Icon, StateCard, ui} from './ui';
import {Value} from './booking';
import {money, shortDate} from '../domain/models';
import {movementTime} from '../domain/inventory';
import {reviewFinance, signatureProgress, type ContractDocument, type FinancialSnapshot, type PartySignature, type RentalDocumentScenario} from '../domain/rentalDocuments';

export function PrototypeFinancialNotice() {
  return <Card><View style={ui.row}><Icon name="information-circle-outline"/><AppText variant="medium" style={{flex: 1}}>Hồ sơ minh họa · không phải chứng từ giao dịch</AppText></View><AppText variant="caption" style={ui.muted}>Nội dung và trạng thái có sẵn trong dữ liệu mẫu. Không ký hợp đồng, thanh toán, đối soát hoặc kích hoạt kỳ thuê tại đây.</AppText></Card>;
}
export function safeRentalDate(value: string | null | undefined) {return value && !Number.isNaN(new Date(value).valueOf()) ? shortDate(value) : 'Chưa có ngày hợp lệ';}
export function FinancialBreakdown({snapshot}: {snapshot: FinancialSnapshot | null}) {
  const f = reviewFinance(snapshot);
  if (!f.valid) return <StateCard kind="error" title="Dữ liệu tài chính chưa nhất quán" description={f.reason}/>;
  return <Card><AppText variant="card">Phân bổ tiền thuê · mẫu</AppText><Value label="Tổng tiền thuê ban đầu" value={money(f.total)}/><Value label="Tiền thuê trả trước cần xác nhận" value={money(f.required)}/><Value label="Khoản trả trước đã xác nhận, cấn trừ" value={money(f.credited)}/><Value label="Số dư ban đầu sau cấn trừ" value={money(f.initialBalance)}/><Value label="Số dư đã thanh toán, xác nhận" value={money(f.paid)}/><Value label="Còn phải thanh toán trong kỳ đầu" value={money(f.outstanding)}/><Chip label={f.settled ? 'Đã tất toán kỳ đầu · mẫu' : f.settlementUnknown ? 'Chờ xác minh tất toán · mẫu' : 'Chưa tất toán kỳ đầu · mẫu'} tone={f.settled ? 'green' : 'orange'}/><AppText variant="caption" style={ui.muted}>Tiền trả trước được cấn trừ vào tổng thuê, không phải khoản bảo đảm bổ sung. Khoản chờ/thất bại không được cấn trừ; không suy ra quyền hoàn tiền.</AppText></Card>;
}
export function ContractSignatureStatus({signature, currentVersion}: {signature: PartySignature | null | undefined; currentVersion: number}) {
  if (!signature) return <StateCard title="Chưa có thông tin bên ký"/>;
  const recorded = signature.status === 'RECORDED_DEMO';
  return <Card><View style={ui.row}><Icon name={recorded ? 'checkmark-circle-outline' : 'time-outline'}/><AppText variant="card" style={{flex: 1}}>{signature.party === 'CUSTOMER' ? 'Khách hàng' : 'Đại diện cơ sở kho'}</AppText></View><AppText>{signature.name}</AppText><AppText variant="caption" style={ui.muted}>{signature.roleLabel}</AppText><Chip label={recorded ? 'Đã ghi nhận ký · mẫu' : 'Chờ ký · mẫu'} tone={recorded ? 'green' : 'orange'}/><Value label="Phiên bản được ghi nhận" value={signature.signedVersion == null ? 'Chưa có' : String(signature.signedVersion)}/>{recorded && signature.signedVersion !== currentVersion && <AppText accessibilityRole="alert">Khác phiên bản tài liệu hiện tại ({currentVersion}).</AppText>}{recorded && !!signature.recordedAt && <Value label="Thời điểm trong dữ liệu mẫu" value={movementTime(signature.recordedAt)}/>}</Card>;
}
export function ContractProgressCard({document}: {document: ContractDocument}) {
  const progress = signatureProgress(document);
  return <Card><AppText variant="card">Tiến độ hai bên · phiên bản {document.version}</AppText><AppText accessibilityRole={progress.state === 'INVALID' ? 'alert' : undefined}>{progress.reason}</AppText>{document.legacyReadOnly && <Chip label="Tài liệu lịch sử · chỉ xem" tone="neutral"/>}<AppText variant="caption" style={ui.muted}>Đối chiếu phiên bản và tham chiếu nội dung trong fixture, không phải kiểm tra chữ ký số hoặc chứng thư xác thực.</AppText></Card>;
}
export function FinancialScenarioPicker({scenarios, selected, onSelect}: {scenarios: readonly RentalDocumentScenario[]; selected: string; onSelect: (id: string) => void}) {
  const [expanded, setExpanded] = useState(false);
  if (scenarios.length < 2) return null;
  return <Card><AppText variant="card">Các tình huống minh họa</AppText><AppText variant="caption" style={ui.muted}>Chỉ đổi ví dụ đang xem, không đổi hồ sơ kỳ thuê hoặc số dư gốc. Mỗi ví dụ có dữ liệu độc lập, không mô phỏng một giao dịch thành công.</AppText><Button label={expanded ? 'Thu gọn tình huống' : 'Xem tình huống khác'} variant="outline" onPress={() => setExpanded(v => !v)}/>{expanded && <View style={{gap: 8}}>{scenarios.map(s => <Filter key={s.id} label={s.label} selected={s.id === selected} onPress={() => onSelect(s.id)}/>)}</View>}</Card>;
}
export function PaymentTimeline({scenario}: {scenario: RentalDocumentScenario}) {
  const f = reviewFinance(scenario.finance), l = scenario.lifecycle, signature = signatureProgress(scenario.contract);
  const milestones = [
    {label: scenario.service === 'SELF_STORAGE' ? 'Đặt kho tự quản' : 'Đặt dung tích ô ký gửi', done: l?.reservationCreated},
    {label: 'Xác nhận tiền thuê trả trước', done: f.valid && f.required > 0 && f.credited >= f.required},
    ...(scenario.service === 'MANAGED_INVENTORY' ? [{label: 'Khai báo hàng / chuẩn bị tiếp nhận', done: l?.registrationComplete}] : []),
    {label: scenario.service === 'SELF_STORAGE' ? 'Kiểm tra thực tế kho riêng' : 'Nhân viên kiểm tra hàng', done: l?.inspectionComplete},
    {label: 'Hai bên ký cùng phiên bản', done: signature.state === 'SIGNED'},
    {label: 'Tất toán số dư kỳ đầu', done: f.valid && f.settled},
    {label: scenario.service === 'SELF_STORAGE' ? 'Nhân viên bàn giao kho' : 'Nhân viên xác nhận nhập lần đầu', done: scenario.service === 'SELF_STORAGE' ? l?.handoverComplete : l?.firstInboundConfirmed},
    {label: 'Nhân viên kích hoạt kỳ thuê', done: l?.activatedByStaff},
  ];
  return <Card><AppText variant="card">Diễn tiến tài chính và bàn giao · mẫu</AppText>{milestones.map(m => <View key={m.label} style={{flexDirection: 'row', alignItems: 'flex-start', gap: 10}}><Icon name={m.done ? 'checkmark-circle-outline' : 'ellipse-outline'}/><View style={{flex: 1}}><AppText variant="medium">{m.label}</AppText><AppText variant="caption" style={ui.muted}>{m.done ? 'Có dữ kiện riêng trong ví dụ' : 'Chưa có xác nhận trong ví dụ'}</AppText></View></View>)}<AppText variant="caption" style={ui.muted}>Một bước hoàn tất không tự hoàn tất bước sau. Ký đủ hoặc thanh toán đủ không tự bàn giao/kích hoạt; khách hàng không có nút xác nhận thay nhân viên.</AppText></Card>;
}
