import {useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {AppText, Button, Card, Filter, FixtureNotice, StateCard, ui} from '../components/ui';
import {BackAction} from '../components/booking';
import {CareList, NotificationCard, OfflineCareNotice} from '../components/customerCare';
import {useCustomerStore} from '../state/useCustomerStore';
import {useCareSessionStore} from '../state/useCareSessionStore';
import {careContext, customerNotifications} from '../fixtures/customerCare';
import {isNotificationRead, notificationDate, ownNotifications, resolveNotificationTarget, type CustomerNotification} from '../domain/customerCare';

export default function NotificationsScreen({loading = false, error, notifications = customerNotifications}: {loading?: boolean; error?: string; notifications?: readonly CustomerNotification[]}) {
  const router = useRouter(), data = useCustomerStore(s => s.fixtures), ownerId = data.customer?.id;
  const overrides = useCareSessionStore(s => ownerId ? s.readOverrides[ownerId] : undefined), markRead = useCareSessionStore(s => s.markRead);
  const [unreadOnly, setUnreadOnly] = useState(false), [unavailable, setUnavailable] = useState(false);
  const all = ownNotifications(notifications, ownerId), unread = all.filter(n => !isNotificationRead(n, overrides)).length;
  const rows = all.filter(n => !unreadOnly || !isNotificationRead(n, overrides));
  const header = <><FixtureNotice/><AppText variant="title">Thông báo</AppText><Card><AppText variant="heading">{unread} thông báo chưa đọc</AppText><OfflineCareNotice/><Button label="Đánh dấu tất cả đã đọc trong phiên" variant="outline" disabled={!ownerId || unread === 0 || loading || !!error} onPress={() => {if (ownerId) markRead(ownerId);}}/></Card><View style={ui.wrap}><Filter label="Tất cả thông báo" selected={!unreadOnly} onPress={() => setUnreadOnly(false)}/><Filter label="Chưa đọc" selected={unreadOnly} onPress={() => setUnreadOnly(true)}/></View>{unavailable && <StateCard kind="error" title="Nội dung liên quan chưa khả dụng" description="Tham chiếu bị thiếu, chưa được hỗ trợ hoặc không thuộc khách hàng hiện tại. Không mở hồ sơ thay thế."/>}</>;
  return <CareList testID="screen-notifications" data={loading || error ? [] : rows} header={header} renderItem={({item, index}) => <View style={ui.gap}>{(index === 0 || notificationDate(rows[index - 1]?.createdAt) !== notificationDate(item.createdAt)) && <AppText variant="label" accessibilityRole="header">{notificationDate(item.createdAt)}</AppText>}<NotificationCard notification={item} read={isNotificationRead(item, overrides)} onRead={() => {if (ownerId) markRead(ownerId, item.id);}} onOpen={() => {const target = resolveNotificationTarget(careContext(data), item); if (target) {setUnavailable(false); router.push(target);} else setUnavailable(true);}}/></View>} empty={loading ? <StateCard kind="loading" title="Đang chuẩn bị thông báo mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị thông báo" description={error}/> : <StateCard title={unreadOnly ? 'Không còn thông báo chưa đọc trong bản mẫu' : 'Chưa có thông báo mẫu'} description="Đây là trạng thái cục bộ; không xác nhận thông báo trên máy chủ."/>} footer={<BackAction fallback="/(tabs)"/>}/>;
}
