import {FlatList, Modal, Pressable, ScrollView, View, type ListRenderItem} from 'react-native';
import type {ReactNode} from 'react';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {AppText, Button, Card, Chip, Icon, ui} from './ui';
import {colors} from '../theme/tokens';
import {useCustomerStore} from '../state/useCustomerStore';
import {useCareSessionStore} from '../state/useCareSessionStore';
import {customerNotifications} from '../fixtures/customerCare';
import {isNotificationRead, notificationCategory, notificationMessage, notificationTitle, ownNotifications, supportStatus, type CustomerNotification, type CustomerSupportRequest, type SupportMessage} from '../domain/customerCare';
import {movementTime} from '../domain/inventory';

export function CareList<T extends {id: string}>({testID, data, header, renderItem, empty, footer}: {testID: string; data: readonly T[]; header: ReactNode; renderItem: ListRenderItem<T>; empty?: ReactNode; footer?: ReactNode}) {
  return <SafeAreaView testID={testID} edges={['left', 'right', 'bottom']} style={{flex: 1, backgroundColor: colors.background}}><FlatList data={data} keyExtractor={row => row.id} renderItem={renderItem} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} keyboardShouldPersistTaps="handled" style={{flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center'}} contentContainerStyle={{padding: 20, gap: 16, paddingBottom: 32}} ListHeaderComponent={<View style={ui.gap}>{header}</View>} ListEmptyComponent={empty ? <View>{empty}</View> : null} ListFooterComponent={footer ? <View style={ui.gap}>{footer}</View> : null}/></SafeAreaView>;
}
export function OfflineCareNotice() {return <AppText variant="caption" style={ui.muted}>Chỉ dữ liệu mẫu và tương tác trong bộ nhớ phiên. Không gửi thông báo, yêu cầu hỗ trợ hoặc tin nhắn lên hệ thống.</AppText>;}
export function NotificationBell() {
  const router = useRouter(), ownerId = useCustomerStore(s => s.fixtures.customer?.id), overrides = useCareSessionStore(s => ownerId ? s.readOverrides[ownerId] : undefined);
  const unread = ownNotifications(customerNotifications, ownerId).filter(n => !isNotificationRead(n, overrides)).length;
  return <Pressable accessibilityRole="button" accessibilityLabel={'Mở thông báo, ' + unread + ' chưa đọc trong phiên'} onPress={() => router.push('/notifications')} style={{minWidth: 46, minHeight: 46, borderRadius: 23, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line}}><Icon name="notifications-outline"/>{unread > 0 && <View style={{position: 'absolute', right: -2, top: -3, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.orangeTint}}><AppText variant="caption" style={{color: colors.orangeText}}>{unread}</AppText></View>}</Pressable>;
}
const noticeIcon = (category: string | null | undefined) => category === 'PAYMENT' ? 'wallet-outline' : category === 'CONTRACT' ? 'document-text-outline' : category === 'INBOUND' || category === 'OUTBOUND' ? 'swap-horizontal-outline' : category === 'SUPPORT' ? 'chatbubbles-outline' : 'notifications-outline';
export function NotificationCard({notification: n, read, onRead, onOpen}: {notification: CustomerNotification; read: boolean; onRead: () => void; onOpen: () => void}) {
  const title = notificationTitle(n);
  return <Card style={{borderLeftWidth: read ? 1 : 4, borderLeftColor: read ? colors.line : colors.orange}}><View style={ui.row}><Icon name={noticeIcon(n.category)}/><View style={{flex: 1, gap: 4}}><AppText variant="caption" style={ui.muted}>{notificationCategory(n.category)}</AppText><AppText variant="card">{title}</AppText></View></View><Chip label={read ? 'Đã đọc trong bản mẫu' : 'Chưa đọc trong bản mẫu'} tone={read ? 'neutral' : 'orange'}/><AppText>{notificationMessage(n)}</AppText><AppText variant="caption" style={ui.muted}>{movementTime(n.createdAt ?? null)}</AppText>{!read && <Button label={'Đánh dấu đã đọc: ' + title} variant="quiet" onPress={onRead}/>}<Button label={'Xem nội dung liên quan: ' + title} variant="outline" onPress={onOpen}/></Card>;
}
export function SupportStatusChip({status}: {status: string}) {return <Chip label={supportStatus(status)} tone={status === 'RESOLVED_DEMO' ? 'green' : status === 'OPEN_DEMO' || status === 'PROCESSING_DEMO' ? 'orange' : 'neutral'}/>;}
export function SupportRequestCard({request, onOpen}: {request: CustomerSupportRequest; onOpen: () => void}) {
  return <Card><View style={ui.row}><Icon name="chatbubble-ellipses-outline"/><AppText variant="label" style={{flex: 1}}>{request.reference}</AppText></View><SupportStatusChip status={request.status}/><AppText variant="card">{request.subject}</AppText><AppText variant="caption" style={ui.muted}>{request.category} · Cập nhật {movementTime(request.updatedAt)}</AppText><Button label={'Xem yêu cầu ' + request.reference} variant="outline" onPress={onOpen}/></Card>;
}
export function SupportMessageBubble({message}: {message: SupportMessage}) {
  const own = message.author === 'CUSTOMER_DEMO';
  return <Card style={{backgroundColor: own ? colors.mint : colors.card, marginLeft: own ? 16 : 0, marginRight: own ? 0 : 16}}><AppText variant="label">{own ? 'Khách hàng · mẫu' : 'Hỗ trợ khách hàng · phản hồi dựng sẵn'}</AppText><AppText>{message.body || 'Chưa có nội dung mẫu.'}</AppText><AppText variant="caption" style={ui.muted}>{movementTime(message.at)}</AppText></Card>;
}
export function CareDraftDialog({visible, onKeep, onDiscard, mode = 'unsaved'}: {visible: boolean; onKeep: () => void; onDiscard: () => void; mode?: 'unsaved' | 'remove' | 'stale'}) {
  const title = mode === 'unsaved' ? 'Rời biểu mẫu chưa lưu?' : mode === 'stale' ? 'Bỏ bản nháp hỗ trợ cũ?' : 'Xóa bản nháp hỗ trợ trong phiên?';
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeep}><View style={{flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#103D2B99'}}><ScrollView style={{maxHeight: '80%'}} contentContainerStyle={{maxWidth: 520, width: '100%', alignSelf: 'center'}}><Card><AppText variant="card" accessibilityRole="header">{title}</AppText><AppText>{mode === 'unsaved' ? 'Chỉ bỏ phần chưa lưu; bản nháp đã lưu vẫn còn trong phiên.' : 'Chỉ xóa bản nháp trong bộ nhớ phiên, không thay đổi yêu cầu hỗ trợ hoặc dữ liệu gốc.'}</AppText><Button label="Tiếp tục chỉnh sửa" onPress={onKeep}/><Button label={mode === 'unsaved' ? 'Bỏ thay đổi và rời trang' : 'Xác nhận xóa bản nháp hỗ trợ'} variant="outline" onPress={onDiscard}/></Card></ScrollView></View></Modal>;
}
