import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {rentalDocumentScenarios} from '../fixtures/rentalDocuments';
import {ownedRentalScenario, paymentPresentation, reviewFinance, type PaymentPurpose} from '../domain/rentalDocuments';
import {money} from '../domain/models';
import {movementTime} from '../domain/inventory';
import {AppText, Button, Card, Chip, Filter, FixtureNotice, Icon, Screen, StateCard, ui} from '../components/ui';
import {BackAction, Value} from '../components/booking';
import {FinancialBreakdown, FinancialScenarioPicker, PaymentTimeline, PrototypeFinancialNotice} from '../components/rentalDocuments';

export default function PaymentDetailScreen({loading = false, error}: {loading?: boolean; error?: string}) {
  const {id, scenario, purpose: queryPurpose} = useLocalSearchParams<{id: string; scenario?: string; purpose?: string}>(), data = useCustomerStore(s => s.fixtures);
  const [selected, setSelected] = useState<string | undefined>(scenario), [purpose, setPurpose] = useState<PaymentPurpose>(queryPurpose === 'BALANCE' ? 'BALANCE' : 'DEPOSIT');
  useEffect(() => {setSelected(scenario); setPurpose(queryPurpose === 'BALANCE' ? 'BALANCE' : 'DEPOSIT');}, [id, scenario, queryPurpose]);
  const context = ownedRentalScenario(data, id, rentalDocumentScenarios, selected), scenarios = rentalDocumentScenarios.filter(s => s.rentalId === id && s.ownerId === data.customer?.id);
  const presentation = context ? paymentPresentation(context.scenario, purpose) : null, finance = reviewFinance(context?.scenario.finance);
  const invalidPurpose = queryPurpose !== undefined && !['DEPOSIT', 'BALANCE'].includes(queryPurpose);
  return <Screen safeTop={false} testID="screen-payment-detail"><FixtureNotice/><AppText variant="title">Chi tiết thanh toán</AppText>
    {loading ? <StateCard kind="loading" title="Đang chuẩn bị tài chính mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị thanh toán" description={error}/> : !context || invalidPurpose ? <StateCard title="Không tìm thấy hồ sơ thanh toán mẫu" description="Kỳ thuê, tình huống hoặc mục đích không hợp lệ với khách hàng hiện tại."/> : <>
      <PrototypeFinancialNotice/>{context.scenario.alternate && <Chip label="Tình huống độc lập · không thay đổi kỳ thuê" tone="orange"/>}
      <Card><AppText variant="card">{context.rental.code}</AppText><AppText>{data.facilities.find(f => f.id === context.rental.facilityId)?.name ?? 'Chưa có thông tin cơ sở'}</AppText><AppText>{context.rental.unit}</AppText><View style={ui.wrap}><Filter label="Tiền thuê trả trước" selected={purpose === 'DEPOSIT'} onPress={() => setPurpose('DEPOSIT')}/><Filter label="Số dư ban đầu" selected={purpose === 'BALANCE'} onPress={() => setPurpose('BALANCE')}/></View></Card>
      <Card><AppText variant="card">{purpose === 'DEPOSIT' ? 'Khoản trả trước, cấn trừ tiền thuê' : 'Thanh toán số dư kỳ đầu'}</AppText><Chip label={presentation!.label} tone={presentation?.record?.status === 'CONFIRMED_DEMO' || finance.valid && finance.settled ? 'green' : 'orange'}/>{presentation?.amount !== null && presentation?.amount !== undefined ? <><AppText variant="caption" style={ui.muted}>{presentation.record?.status === 'CONFIRMED_DEMO' ? 'Số tiền đã ghi nhận trong mẫu' : 'Số tiền của yêu cầu minh họa'}</AppText><AppText variant="display">{money(presentation.amount)}</AppText></> : <AppText>Chưa có số tiền yêu cầu để hiển thị.</AppText>}<AppText>{presentation!.reason}</AppText>{presentation?.record?.recordedAt && <Value label="Thời điểm ghi nhận trong dữ liệu mẫu" value={movementTime(presentation.record.recordedAt)}/>}<AppText variant="caption" style={ui.muted}>Không có tham chiếu giao dịch thật, tài khoản ngân hàng hoặc xác nhận từ đơn vị thanh toán.</AppText></Card>
      <FinancialBreakdown snapshot={context.scenario.finance}/>
      {finance.valid && finance.settled && <Card><AppText variant="card">Không cần thanh toán thêm · dữ liệu mẫu</AppText><AppText>Trạng thái tất toán chỉ đọc từ bằng chứng minh họa. Không tự xác nhận bàn giao, nhập hàng hoặc kích hoạt kỳ thuê.</AppText></Card>}
      <Card><Icon name="wallet-outline" size={36}/><AppText variant="card">Thông tin thanh toán sẽ hiển thị khi kết nối hệ thống.</AppText><AppText style={ui.muted}>Không có mã QR, liên kết thanh toán hoặc hướng dẫn chuyển tiền trong bản mẫu ngoại tuyến.</AppText><Button label="Thanh toán · chưa kết nối" disabled onPress={() => {}}/><Button label="Làm mới trực tuyến · chưa khả dụng" variant="outline" disabled onPress={() => {}}/></Card>
      <PaymentTimeline scenario={context.scenario}/>
      <FinancialScenarioPicker scenarios={scenarios} selected={context.scenario.id} onSelect={setSelected}/>
    </>}
    <BackAction fallback="/(tabs)/rentals"/>
  </Screen>;
}
