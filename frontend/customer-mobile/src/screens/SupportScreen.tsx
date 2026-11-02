import {useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {customerSupportRequests} from '../fixtures/customerCare';
import {supportCategories, supportStatuses, type CustomerSupportRequest} from '../domain/customerCare';
import {AppText, Button, Card, Filter, FixtureNotice, Icon, StateCard, ui} from '../components/ui';
import {BackAction} from '../components/booking';
import {CareList, OfflineCareNotice, SupportRequestCard} from '../components/customerCare';
import {colors} from '../theme/tokens';

export default function SupportScreen({loading = false, error, requests = customerSupportRequests}: {loading?: boolean; error?: string; requests?: readonly CustomerSupportRequest[]}) {
  const router = useRouter(), data = useCustomerStore(s => s.fixtures), [status, setStatus] = useState('ALL');
  const rows = data.customer ? requests.filter(r => r.ownerId === data.customer!.id && (status === 'ALL' || status === 'UNKNOWN' ? status === 'ALL' || !Object.hasOwn(supportStatuses, r.status) : r.status === status)).slice().sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0) || a.id.localeCompare(b.id)) : [];
  const filters: [string, string][] = [['ALL', 'Tất cả yêu cầu'], ...Object.entries(supportStatuses), ['UNKNOWN', 'Chưa xác định']];
  const header = <><FixtureNotice/><AppText variant="title">Trung tâm hỗ trợ</AppText><Card style={{backgroundColor: colors.deep}}><Icon name="help-buoy-outline" color={colors.white} size={34}/><AppText variant="heading" style={{color: colors.white}}>Cùng bạn hiểu rõ không gian lưu trữ</AppText><AppText style={{color: colors.white}}>Xem trao đổi mẫu hoặc chuẩn bị nội dung cần hỗ trợ. Chưa có kết nối trực tuyến, không cam kết thời gian phản hồi.</AppText><Button label="Tạo yêu cầu hỗ trợ" variant="orange" disabled={!data.customer} onPress={() => router.push('/support/new')}/></Card><OfflineCareNotice/><AppText variant="card">Chủ đề hỗ trợ nhanh</AppText><View style={ui.wrap}>{supportCategories.map(category => <Filter key={category} label={category} selected={false} onPress={() => router.push({pathname: '/support/new', params: {category}})}/>)}</View><AppText variant="card">Yêu cầu của tôi · mẫu</AppText><View style={ui.wrap}>{filters.map(([value, label]) => <Filter key={value} label={label} selected={status === value} onPress={() => setStatus(value)}/>)}</View></>;
  return <CareList testID="screen-support" header={header} data={loading || error ? [] : rows} renderItem={({item}) => <SupportRequestCard request={item} onOpen={() => router.push({pathname: '/support/[requestId]', params: {requestId: item.id}})}/>} empty={loading ? <StateCard kind="loading" title="Đang chuẩn bị yêu cầu mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị hỗ trợ" description={error}/> : <StateCard title="Chưa có yêu cầu hỗ trợ phù hợp" description="Có thể đổi bộ lọc hoặc chuẩn bị bản nháp, chưa gửi lên hệ thống."/>} footer={<BackAction fallback="/(tabs)/profile"/>}/>;
}
