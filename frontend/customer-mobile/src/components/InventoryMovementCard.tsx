import {useState} from 'react';
import {View} from 'react-native';
import {AppText, Button, Card, Chip, Icon, ui} from './ui';
import {Value} from './booking';
import {BatchDetails} from './inventory';
import {movementLabel, movementTime, quantityText, type InventoryMovement} from '../domain/inventory';

export function InventoryMovementCard({movement}: {movement: InventoryMovement}) {
  const [expanded, setExpanded] = useState(false);
  const m = movement, canonical = Array.isArray(m.batchLines) && m.batchLines.length > 0;
  return <Card><View style={ui.row}><Icon name={m.type === 'INBOUND' ? 'arrow-down-circle-outline' : m.type === 'OUTBOUND' ? 'arrow-up-circle-outline' : m.type === 'RELOCATION' ? 'swap-horizontal-outline' : 'help-circle-outline'}/><Chip label={movementLabel(m.type)} tone={m.type === 'OUTBOUND' ? 'orange' : m.type === 'RELOCATION' ? 'neutral' : 'green'}/></View>
    <AppText variant="caption" style={ui.muted}>{movementTime(m.occurredAt)} · giờ Việt Nam</AppText><Value label="Số lượng sự kiện được ghi nhận" value={quantityText(m.quantity, m.unit)}/><Value label={m.type === 'RELOCATION' ? 'Ô trước đó' : 'Ô nguồn'} value={m.sourceCell ?? 'Chưa có thông tin ô nguồn'}/><Value label={m.type === 'RELOCATION' ? 'Ô mới' : 'Ô đích'} value={m.destinationCell ?? 'Chưa có thông tin ô đích'}/>
    {m.staffProcessed === true && <AppText variant="caption">Nhân viên đã xử lý · dữ liệu mẫu, khách hàng chỉ xem</AppText>}
    <Button testID={'movement-toggle-' + m.id} label={(expanded ? 'Thu gọn ' : 'Chi tiết ') + movementLabel(m.type).toLocaleLowerCase('vi')} variant="outline" onPress={() => setExpanded(v => !v)}/>
    {expanded && <View style={ui.gap}>
      {!!m.note && <AppText>{m.note}</AppText>}
      {m.schemaVersion != null && <Value label="Phiên bản bản ghi mẫu" value={String(m.schemaVersion)}/>}
      <Value label="Chính sách tính được ghi nhận" value={m.arithmeticPolicy === 'SUM_BATCH_QUANTITIES' ? 'Tổng số lượng theo lô (dữ liệu mẫu khai báo)' : m.arithmeticPolicy ?? 'Chưa có thông tin; không tự suy diễn'}/>
      {!!m.evidence && <Value label="Tham chiếu chứng từ mẫu" value={m.evidence}/>}
      {canonical ? <><AppText variant="medium">Chi tiết từng lô · không thay số đo cho toàn sự kiện</AppText>{m.batchLines!.map((batch, i) => <BatchDetails key={i} batch={batch} expectedUnit={m.unit}/>)}</> : <AppText>Không có chi tiết lô trong bản ghi này. Không suy ra mã lô hoặc số đo bị thiếu.</AppText>}
    </View>}
  </Card>;
}
