import type {ReactNode} from 'react';
import {FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppText, Button, Card, Chip, FixtureNotice, StateCard, ui} from './ui';
import {ItemArtwork, StockBalance} from './inventory';
import {Value} from './booking';
import {measurementText, movementTime, quantityText} from '../domain/inventory';
import {issueMessages, requestStatusLabels, type InventoryRequest, type RequestContext, type RequestKind} from '../domain/inventoryRequests';
import {colors} from '../theme/tokens';

export function RequestWorkspace({testID, header, rows = [], onOpen, footer, back}: {testID: string; header: ReactNode; rows?: InventoryRequest[]; onOpen?: (request: InventoryRequest) => void; footer?: ReactNode; back: () => void}) {
  return <SafeAreaView testID={testID} edges={['left', 'right', 'bottom']} style={{flex: 1, backgroundColor: colors.background}}><KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <FlatList data={rows} keyExtractor={r => r.id} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={7} style={{flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center'}} contentContainerStyle={{padding: 20, gap: 16, paddingBottom: 32}} keyboardShouldPersistTaps="handled" ListHeaderComponent={<View style={ui.gap}><FixtureNotice/>{header}<AppText variant="card">Lịch sử yêu cầu · minh họa</AppText></View>} renderItem={({item}) => <InventoryRequestCard request={item} onOpen={() => onOpen?.(item)}/>} ListEmptyComponent={<StateCard title="Chưa có yêu cầu mẫu"/>} ListFooterComponent={<Button label="Trở về màn hình trước" variant="quiet" onPress={back}/>}/>
    {footer && <View style={{padding: 12, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card}}><View style={{width: '100%', maxWidth: 720, alignSelf: 'center'}}>{footer}</View></View>}
  </KeyboardAvoidingView></SafeAreaView>;
}
export function RequestStatusChip({request}: {request: InventoryRequest}) {return <Chip label={requestStatusLabels[request.status] ?? 'Trạng thái mẫu chưa xác định'} tone={request.status === 'WAITING_DEMO' || request.status === 'PARTIAL_DEMO' ? 'orange' : request.status === 'CANCELLED_DEMO' ? 'neutral' : 'green'}/>;}
export function InventoryRequestCard({request, onOpen}: {request: InventoryRequest; onOpen: () => void}) {
  return <Card><AppText variant="card">{request.reference}</AppText><RequestStatusChip request={request}/><AppText>{quantityText(request.quantity, request.unit)}</AppText><AppText variant="caption" style={ui.muted}>Tạo: {movementTime(request.createdAt)}</AppText><AppText variant="caption" style={ui.muted}>Cập nhật: {movementTime(request.updatedAt)}</AppText><Button label={'Xem yêu cầu ' + request.reference} variant="outline" onPress={onOpen}/></Card>;
}
export function RequestItemContext({context, kind}: {context: RequestContext; kind: RequestKind}) {
  return <><Chip label={kind === 'INBOUND' ? 'Nhập thêm · bản mẫu' : 'Xuất theo số dư · bản mẫu'}/><AppText variant="title">{context.item.name}</AppText><AppText variant="label" style={ui.muted}>{context.item.code}</AppText><ItemArtwork variant={context.detail.images[0] ?? 'box'}/><Card><Value label="Kỳ thuê mẫu" value={context.rental?.code ?? 'Chưa có kỳ thuê phù hợp'}/><Value label="Trạng thái mặt hàng" value={context.item.status === 'IN_STORAGE' ? 'Đang lưu kho · mẫu' : 'Mới đăng ký · mẫu'}/><Value label="Ô lưu trữ hiện tại" value={context.item.cell ?? 'Chưa có vị trí đã xác minh'}/></Card><StockBalance item={context.item} detail={context.detail}/></>;
}
export function RequestUnavailableState({reason}: {reason: string}) {return <StateCard kind="error" title="Chưa thể chuẩn bị yêu cầu" description={reason}/>;}
export function RequestDraftNotice({message}: {message: string}) {return <Card><AppText accessibilityRole="alert">{message}</AppText><AppText variant="caption" style={ui.muted}>Chỉ trong bộ nhớ phiên, mất khi đăng xuất hoặc khởi động lại. Yêu cầu gốc, tồn kho, số đang giữ và lịch sử di chuyển không thay đổi.</AppText></Card>;}
export function RequestDetails({request}: {request: InventoryRequest}) {
  const m = request.declared;
  return <><Card><AppText variant="card">{request.reference}</AppText><RequestStatusChip request={request}/><Value label="Số lượng yêu cầu" value={quantityText(request.quantity, request.unit)}/><Value label="Phiên bản mẫu" value={request.version == null ? 'Chưa có thông tin' : String(request.version)}/><Value label="Ngày tạo" value={movementTime(request.createdAt)}/><Value label="Cập nhật gần nhất" value={movementTime(request.updatedAt)}/>{m && <Value label="Số đo đơn vị khai báo, chưa phải kiểm đếm" value={measurementText({widthM: Number(m.widthM.replace(',', '.')), depthM: Number(m.depthM.replace(',', '.')), heightM: Number(m.heightM.replace(',', '.')), weightKg: Number(m.weightKg.replace(',', '.'))})}/>}{request.fulfilledQuantity !== null && <Value label="Nhân viên đã xử lý trong lịch sử mẫu" value={quantityText(request.fulfilledQuantity, request.unit)}/>}{request.heldQuantity !== null && <Value label="Số đang giữ của yêu cầu mẫu này" value={quantityText(request.heldQuantity, request.unit)}/>}<AppText>{request.note}</AppText><AppText variant="caption" style={ui.muted}>Không tính lại số dư tồn kho từ số đang giữ của từng yêu cầu.</AppText></Card>
    {request.issue !== 'NONE' && <RequestUnavailableState reason={issueMessages[request.issue]}/>}
    <Card><AppText variant="card">Diễn tiến minh họa · chỉ đọc</AppText>{request.timeline.map((event, i) => <View key={i} style={{gap: 4}}><AppText variant="medium">{event.label}</AppText><AppText variant="caption" style={ui.muted}>{movementTime(event.at)} · {event.actor === 'STAFF_DEMO' ? 'Nhân viên (chỉ xem)' : 'Khách hàng (mẫu)'}</AppText></View>)}</Card></>;
}
export function RequestConfirmation({visible, title, children, onCancel, onConfirm, disabled = false}: {visible: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void; disabled?: boolean}) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}><View style={{flex: 1, backgroundColor: '#103D2B99', justifyContent: 'center', padding: 20}}><ScrollView style={{maxHeight: '85%'}} contentContainerStyle={{maxWidth: 520, width: '100%', alignSelf: 'center'}}><Card><AppText variant="card">{title}</AppText>{children}<AppText>Chỉ lưu bản nháp cục bộ. Nhân viên phụ trách xử lý vật lý; không có yêu cầu nào được gửi hay hoàn tất tại đây.</AppText><Button label="Xác nhận lưu bản nháp" disabled={disabled} onPress={onConfirm}/><Button label="Quay lại chỉnh sửa" variant="outline" onPress={onCancel}/></Card></ScrollView></View></Modal>;
}
