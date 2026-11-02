import {useState} from 'react';
import {Modal, ScrollView, View} from 'react-native';
import Svg, {Path, Rect, Line} from 'react-native-svg';
import {AppText, Button, Card, Chip, Icon, ui} from './ui';
import {Value} from './booking';
import {colors} from '../theme/tokens';
import {canonicalStock, measurementText, quantityText, type Illustration, type InventoryDetail, type StockBatch} from '../domain/inventory';
import type {InventoryItem} from '../domain/models';

export const illustrationLabels: Record<Illustration, string> = {box: 'Kiện hàng', stack: 'Hộp xếp chồng', label: 'Nhãn hàng'};
export function ItemArtwork({variant}: {variant: Illustration}) {
  return <View accessibilityRole="image" accessibilityLabel={'Hình minh họa cục bộ: ' + illustrationLabels[variant]} style={{backgroundColor: colors.mint, borderRadius: 16, padding: 14, alignItems: 'center'}}><Svg width="100%" height={135} viewBox="0 0 260 150">
    {variant === 'label' ? <><Rect x={65} y={15} width={130} height={120} rx={14} fill={colors.white}/><Rect x={82} y={34} width={96} height={24} rx={6} fill={colors.primary}/>{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Line key={i} x1={85 + i * 12} y1={75} x2={85 + i * 12} y2={112} stroke={colors.deep} strokeWidth={i % 2 ? 3 : 5}/>)}</> : <><Path d="M55 50 L130 20 L205 50 L130 82 Z" fill={colors.orange}/><Path d="M55 50 L130 82 L130 138 L55 108 Z" fill={colors.primary}/><Path d="M130 82 L205 50 L205 108 L130 138 Z" fill={colors.primaryContainer}/><Path d="M95 35 L170 66" stroke={colors.white} strokeWidth={10}/>{variant === 'stack' && <Rect x={10} y={100} width={55} height={40} rx={6} fill={colors.orange}/>}</>}
  </Svg><AppText variant="caption" style={ui.muted}>{illustrationLabels[variant]} · hình minh họa, không phải ảnh hàng thực tế</AppText></View>;
}
export function ItemGallery({images}: {images: Illustration[]}) {
  const [selected, setSelected] = useState(0);
  const image = images[selected] ?? images[0];
  return <Card>{image ? <><ItemArtwork variant={image}/><View style={ui.wrap}>{images.map((v, i) => <Button key={v} label={'Xem hình ' + (i + 1)} variant={i === selected ? 'primary' : 'outline'} onPress={() => setSelected(i)}/>)}</View></> : <View style={{alignItems: 'center', gap: 12, padding: 20}}><Icon name="image-outline" size={40}/><AppText>Chưa có hình minh họa</AppText></View>}</Card>;
}
export function StockBalance({item, detail}: {item: InventoryItem; detail: InventoryDetail}) {
  const result = canonicalStock(item, detail);
  return <Card><AppText variant="card">Số dư tồn kho · dữ liệu mẫu</AppText><Value label="Số lượng đăng ký" value={quantityText(item.registeredQuantity, item.unit)}/>{result.balance ? <View style={ui.gap}><Value label="Tồn thực tế" value={quantityText(result.balance.onHand, item.unit)}/><Value label="Đang giữ" value={quantityText(result.balance.held, item.unit)}/><Value label="Có thể xuất" value={quantityText(result.balance.available, item.unit)}/></View> : <><AppText>Chưa có dữ liệu tồn kho đã xác minh</AppText>{result.state === 'INCONSISTENT' && <AppText variant="caption" style={{color: colors.danger}}>Dữ liệu số dư hoặc đơn vị không nhất quán; không suy ra khả dụng.</AppText>}</>}<AppText variant="caption" style={ui.muted}>Số lượng đăng ký không phải tồn vật lý. Không suy ra số dư từ lịch sử minh họa hoặc cộng các đơn vị khác nhau.</AppText></Card>;
}
export function BatchDetails({batch, expectedUnit}: {batch: StockBatch; expectedUnit: string | null}) {
  return <View style={{gap: 8, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12}}>
    <AppText variant="medium">{batch.reference ? 'Lô ' + batch.reference : 'Chưa có mã lô'}</AppText><AppText>{quantityText(batch.quantity, batch.unit)}</AppText>{expectedUnit && batch.unit && expectedUnit !== batch.unit && <AppText variant="caption" style={{color: colors.danger}}>Đơn vị lô khác đơn vị sự kiện; không cộng gộp.</AppText>}
    {batch.receipt && <Value label="Tham chiếu biên nhận mẫu" value={batch.receipt}/>}<Value label="Ô lưu trữ của lô" value={batch.cell ?? 'Chưa có vị trí lô'}/><Value label="Số đo đơn vị của riêng lô này" value={measurementText(batch.measurements)}/>
  </View>;
}
export function BatchOverview({batches, unit}: {batches: StockBatch[]; unit: string}) {
  const [expanded, setExpanded] = useState(false);
  return <Card><AppText variant="card">Nguồn hàng & lô mẫu</AppText>{batches.length ? <><AppText>{batches.length} lô · số đo riêng từng lô</AppText><Button label={expanded ? 'Thu gọn nguồn hàng' : 'Xem nguồn hàng & lô'} variant="outline" onPress={() => setExpanded(v => !v)}/>{expanded && batches.map((b, i) => <BatchDetails key={i} batch={b} expectedUnit={unit}/>)}</> : <AppText>Chưa có dữ liệu nguồn hàng hoặc lô</AppText>}</Card>;
}
export function IllustrationDraft({images, onChange}: {images: Illustration[]; onChange: (images: Illustration[]) => void}) {
  const next = (['box', 'stack', 'label'] as Illustration[]).find(v => !images.includes(v));
  return <Card><AppText variant="card">Hình minh họa bản nháp</AppText><AppText variant="caption" style={ui.muted}>Chỉ chọn hình dựng sẵn cục bộ. Không mở camera, chọn tệp hoặc tải ảnh lên hệ thống.</AppText>{images.length === 0 && <AppText>Chưa có hình trong bản nháp</AppText>}
    {images.map((image, i) => <View key={image} style={{gap: 8}}><ItemArtwork variant={image}/><Chip label={'Hình ' + (i + 1)}/><View style={ui.wrap}><Button label={'Xóa hình ' + (i + 1)} variant="outline" onPress={() => onChange(images.filter(v => v !== image))}/><Button label={'Đưa hình ' + (i + 1) + ' lên trước'} variant="quiet" disabled={i === 0} onPress={() => {const copy = [...images]; [copy[i - 1], copy[i]] = [copy[i]!, copy[i - 1]!]; onChange(copy);}}/></View></View>)}
    <Button label="Thêm hình minh họa" variant="outline" disabled={!next} onPress={() => {if (next) onChange([...images, next]);}}/>
  </Card>;
}
export function DiscardDraftDialog({visible, onCancel, onDiscard, stale = false}: {visible: boolean; onCancel: () => void; onDiscard: () => void; stale?: boolean}) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}><View style={{flex: 1, backgroundColor: '#103D2B99', justifyContent: 'center', padding: 20}}><ScrollView style={{maxHeight: '80%'}} contentContainerStyle={{width: '100%', maxWidth: 520, alignSelf: 'center'}}><Card><AppText variant="card" accessibilityRole="header">{stale ? 'Bỏ bản nháp cũ?' : 'Rời biểu mẫu chưa lưu?'}</AppText><AppText>{stale ? 'Chỉ xóa bản nháp không còn khớp khỏi bộ nhớ phiên. Dữ liệu hàng hóa mẫu giữ nguyên.' : 'Những thay đổi kể từ lần lưu nháp gần nhất sẽ bị bỏ. Bản nháp đã lưu trong phiên được giữ nguyên.'}</AppText><Button label={stale ? 'Giữ bản nháp cũ' : 'Tiếp tục chỉnh sửa'} onPress={onCancel}/><Button label={stale ? 'Xác nhận bỏ bản nháp cũ' : 'Bỏ thay đổi và rời trang'} variant="outline" onPress={onDiscard}/></Card></ScrollView></View></Modal>;
}
