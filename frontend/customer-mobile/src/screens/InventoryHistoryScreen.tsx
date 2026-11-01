import {useMemo, useState} from 'react';
import {FlatList, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {inventoryDetails, inventoryMovements} from '../fixtures/inventory';
import {movementLabel, ownItem, sortedMovements} from '../domain/inventory';
import {AppText, Button, Card, Filter, FixtureNotice, Input, StateCard, ui} from '../components/ui';
import {InventoryMovementCard} from '../components/InventoryMovementCard';
import {colors} from '../theme/tokens';

export default function InventoryHistoryScreen({loading = false, error}: {loading?: boolean; error?: string}) {
  const {id} = useLocalSearchParams<{id: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures);
  const record = ownItem(data, id, inventoryDetails);
  const [type, setType] = useState('ALL'), [query, setQuery] = useState('');
  const rows = useMemo(() => record && data.customer ? sortedMovements(inventoryMovements, record.item.id, data.customer.id).filter(m => (type === 'ALL' || m.type === type) && `${m.id} ${m.sourceCell ?? ''} ${m.destinationCell ?? ''} ${m.evidence ?? ''} ${movementLabel(m.type)}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))) : [], [record?.item.id, data.customer?.id, type, query]);
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/inventory');
  const header = <View style={ui.gap}><FixtureNotice/><AppText variant="title">Lịch sử di chuyển</AppText>{record && <Card><AppText variant="card">{record.item.name}</AppText><AppText variant="label">{record.item.code}</AppText><AppText variant="caption" style={ui.muted}>Nhật ký mẫu chỉ đọc. Không dùng các sự kiện này để tính tồn kho hiện tại.</AppText></Card>}<Input label="Tìm sự kiện" placeholder="Ô nguồn, ô đích hoặc chứng từ" value={query} onChangeText={setQuery}/><View style={ui.wrap}>{['ALL', 'INBOUND', 'OUTBOUND', 'RELOCATION'].map(t => <Filter key={t} label={t === 'ALL' ? 'Tất cả' : movementLabel(t)} selected={type === t} onPress={() => setType(t)}/>)}</View></View>;
  return <SafeAreaView testID="screen-inventory-history" edges={['left', 'right', 'bottom']} style={{flex: 1, backgroundColor: colors.background}}>
    <FlatList data={record && !loading && !error ? rows : []} keyExtractor={m => m.id} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} keyboardShouldPersistTaps="handled" style={{flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center'}} contentContainerStyle={{padding: 20, gap: 16, paddingBottom: 32}} ListHeaderComponent={header} renderItem={({item}) => <InventoryMovementCard movement={item}/>} ListEmptyComponent={loading ? <StateCard kind="loading" title="Đang chuẩn bị lịch sử mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị lịch sử" description={error}/> : !record ? <StateCard title="Không tìm thấy dữ liệu mẫu"/> : <StateCard title="Chưa có lịch sử phù hợp" description="Chưa có sự kiện hoặc không có kết quả theo bộ lọc."/>} ListFooterComponent={<Button label="Trở về màn hình trước" variant="quiet" onPress={back}/>}/>
  </SafeAreaView>;
}
