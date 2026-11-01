import {ScrollView, View} from 'react-native';
import {AppText, Button, ui} from './ui';
import {money} from '../domain/models';
import {assessManagedDraft, type ManagedDraft, type ManagedFacility} from '../domain/managedBooking';
import {volumeLabel} from './managedWarehouse';

export function ManagedBookingSummary({facility, draft, label, disabled = false, onContinue}: {facility: ManagedFacility; draft: ManagedDraft; label: string; disabled?: boolean; onContinue: () => void}) {
  const check = assessManagedDraft(facility, draft);
  return <View style={{gap: 8, width: '100%', maxWidth: 720, alignSelf: 'center'}}>
    <View style={ui.wrap}><AppText variant="medium">{draft.cellIds.length} ô đã chọn</AppText><AppText variant="medium">{volumeLabel(check.capacity)}</AppText></View>
    <ScrollView style={{maxHeight: 40}} nestedScrollEnabled><AppText variant="caption" style={ui.muted}>{check.cells.map(e => e.cell.code).join(' · ') || 'Chưa chọn ô'}</AppText></ScrollView>
    <AppText variant="label">{check.quote ? money(check.quote.monthlyPrice) + ' / tháng · mẫu' : 'Chưa có báo giá'}</AppText>
    <Button label={label} disabled={disabled || !check.valid || !check.quote} onPress={onContinue}/>
  </View>;
}
