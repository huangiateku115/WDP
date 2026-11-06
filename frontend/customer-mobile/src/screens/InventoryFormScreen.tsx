import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {Controller, useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {useLocalSearchParams, useNavigation, useRouter} from 'expo-router';
import {usePreventRemove} from 'expo-router/react-navigation';
import {useCustomerStore} from '../state/useCustomerStore';
import {inventoryDraftKey, useInventoryDraftStore} from '../state/useInventoryDraftStore';
import {inventoryDetails, inventoryRentals} from '../fixtures/inventory';
import {canEditItem, ownItem} from '../domain/inventory';
import {emptyInventoryForm, initialInventoryForm, inventoryCategories, inventoryFormSchema, inventoryUnits, type InventoryFormValues} from '../forms/inventory';
import {AppText, Button, Card, Chip, Filter, FixtureNotice, Input, Screen, StateCard, ui} from '../components/ui';
import {DiscardDraftDialog, IllustrationDraft} from '../components/inventory';

export default function InventoryFormScreen({mode = 'register'}: {mode?: 'register' | 'edit'}) {
  const {id} = useLocalSearchParams<{id: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures);
  const [discardStale, setDiscardStale] = useState(false);
  const record = ownItem(data, id, inventoryDetails), ownerId = data.customer?.id;
  const key = ownerId ? inventoryDraftKey(ownerId, mode === 'edit' ? id : undefined) : '';
  const saved = useInventoryDraftStore(s => s.drafts[key]);
  const sourceFingerprint = JSON.stringify(mode === 'edit' ? record : {ownerId, mode});
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/inventory');
  if (!ownerId || mode === 'edit' && !record) return <Screen safeTop={false} testID="screen-inventory-form"><FixtureNotice/><StateCard title="Không tìm thấy dữ liệu mẫu"/><Button label="Trở về màn hình trước" variant="quiet" onPress={back}/></Screen>;
  if (mode === 'edit' && record && !canEditItem(record.item, record.detail)) return <Screen safeTop={false} testID="screen-inventory-form"><FixtureNotice/><StateCard title="Không thể chỉnh sửa hàng hóa này" description={record.detail.editReason}/><Button label="Trở về màn hình trước" variant="quiet" onPress={back}/></Screen>;
  if (saved && (saved.ownerId !== ownerId || saved.sourceFingerprint !== sourceFingerprint)) return <Screen safeTop={false} testID="screen-inventory-form"><FixtureNotice/><StateCard kind="error" title="Bản nháp không còn khớp dữ liệu mẫu" description="Không tự khôi phục bản nháp của dữ liệu đã thay đổi."/><Button label="Bỏ bản nháp cũ" variant="outline" onPress={() => setDiscardStale(true)}/><Button label="Trở về màn hình trước" variant="quiet" onPress={back}/><DiscardDraftDialog visible={discardStale} stale onCancel={() => setDiscardStale(false)} onDiscard={() => {useInventoryDraftStore.getState().remove(ownerId, key); setDiscardStale(false);}}/></Screen>;
  const initial = saved?.values ?? (mode === 'edit' && record ? initialInventoryForm(record.item, record.detail) : emptyInventoryForm());
  return <InventoryFormEditor key={key} ownerId={ownerId} draftKey={key} initial={initial} restored={!!saved} sourceFingerprint={sourceFingerprint} mode={mode} onBack={back}/>;
}

function InventoryFormEditor({ownerId, draftKey, initial, restored, sourceFingerprint, mode, onBack}: {ownerId: string; draftKey: string; initial: InventoryFormValues; restored: boolean; sourceFingerprint: string; mode: 'register' | 'edit'; onBack: () => void}) {
  const navigation = useNavigation(), demo = useCustomerStore(s => s.demoSession);
  const [dialog, setDialog] = useState(false), [message, setMessage] = useState('');
  const pending = useRef<(() => void) | null>(null);
  const {control, watch, getValues, setValue, reset, trigger, handleSubmit, formState: {isDirty, isValid, isSubmitting, errors}} = useForm<InventoryFormValues>({resolver: zodResolver(inventoryFormSchema(ownerId, inventoryRentals)), defaultValues: initial, mode: 'onChange'});
  const rentalId = watch('rentalId'), rental = inventoryRentals.find(r => r.id === rentalId && r.ownerId === ownerId);
  const rentals = inventoryRentals.filter(r => r.ownerId === ownerId);
  useEffect(() => {void trigger();}, [trigger]);
  usePreventRemove(isDirty && demo, ({data}) => {pending.current = () => navigation.dispatch(data.action); setDialog(true);});
  const save = handleSubmit(async values => {
    setMessage('');
    // Only the dedicated memory store changes, never the item/stock fixtures.
    const saved = useInventoryDraftStore.getState().save(ownerId, draftKey, values, sourceFingerprint);
    if (saved) {reset(values); setMessage('Đã lưu bản nháp trong phiên — chưa gửi lên hệ thống. Bản nháp mất khi đăng xuất hoặc khởi động lại.');}
    else setMessage('Không thể lưu bản nháp: kiểm tra lại dữ liệu và kỳ thuê mẫu.');
  });
  const field = (name: keyof Pick<InventoryFormValues, 'name' | 'description' | 'quantity' | 'widthM' | 'depthM' | 'heightM' | 'weightKg'>, label: string, numeric = false) => <Controller key={name} name={name} control={control} render={({field: f, fieldState}) => <Input label={label} value={f.value} onChangeText={v => {setMessage(''); f.onChange(v);}} onBlur={f.onBlur} error={fieldState.isTouched || fieldState.isDirty ? fieldState.error?.message : undefined} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={name === 'description'} maxLength={name === 'description' ? 1000 : numeric ? 16 : 120}/>}/>;
  return <Screen safeTop={false} testID="screen-inventory-form"><FixtureNotice/><Chip label={mode === 'edit' ? 'Chỉnh sửa bản khai báo mẫu' : 'Chuẩn bị danh mục · bản nháp'}/><AppText variant="title">{mode === 'edit' ? 'Chỉnh sửa hàng hóa' : 'Đăng ký hàng hóa'}</AppText>
    {restored && <AppText variant="caption" style={ui.muted}>Đã khôi phục bản nháp đã lưu trong bộ nhớ của phiên này.</AppText>}
    <Card><AppText variant="card">Kỳ thuê kho ký gửi mẫu</AppText><AppText variant="caption" style={ui.muted}>Điều kiện riêng theo fixture; không phải mọi kỳ thuê đều đủ điều kiện.</AppText><Controller name="rentalId" control={control} render={({field: f}) => <View style={{gap: 10}}>{rentals.map(r => <View key={r.id} style={{gap: 4}}><Button label={r.code + ' · ' + (r.stage === 'DEPOSIT_PAID' ? 'Đã xác nhận cọc' : r.stage === 'ACTIVE' ? 'Đang thuê' : r.stage === 'CLOSED' ? 'Đã kết thúc' : 'Chờ cọc')} variant={f.value === r.id ? 'primary' : 'outline'} disabled={!r.canRegister} onPress={() => {f.onChange(r.id); setValue('preferredCell', '', {shouldDirty: true, shouldValidate: true}); setMessage('');}}/><AppText variant="caption" style={ui.muted}>{r.reason}</AppText></View>)}</View>}/>{errors.rentalId && <AppText accessibilityRole="alert">{errors.rentalId.message}</AppText>}
      <AppText variant="label">Ô ưu tiên (tùy chọn)</AppText><Controller name="preferredCell" control={control} render={({field: f}) => <View style={ui.wrap}><Filter label="Không chỉ định" selected={f.value === ''} onPress={() => f.onChange('')}/>{rental?.preferredCells.map(cell => <Filter key={cell} label={cell} selected={f.value === cell} onPress={() => f.onChange(cell)}/>)}</View>}/>{errors.preferredCell && <AppText accessibilityRole="alert">{errors.preferredCell.message}</AppText>}<AppText variant="caption" style={ui.muted}>Chỉ ghi nguyện vọng; không phân ô thực tế hoặc thay đổi vị trí hàng, dung tích đang sử dụng.</AppText>
    </Card>
    <Controller name="images" control={control} render={({field: f}) => <IllustrationDraft images={f.value} onChange={f.onChange}/>}/>
    <Card><AppText variant="card">Thông tin mặt hàng</AppText>{field('name', 'Tên hàng hóa')}{field('description', 'Mô tả (tùy chọn)')}<AppText variant="label">Danh mục</AppText><Controller name="category" control={control} render={({field: f}) => <View style={ui.wrap}>{inventoryCategories.map(c => <Filter key={c} label={c} selected={f.value === c} onPress={() => f.onChange(c)}/>)}</View>}/>{errors.category && <AppText accessibilityRole="alert">{errors.category.message}</AppText>}{field('quantity', 'Số lượng đăng ký', true)}<AppText variant="label">Đơn vị tính</AppText><Controller name="unit" control={control} render={({field: f}) => <View style={ui.wrap}>{inventoryUnits.map(unit => <Filter key={unit} label={unit} selected={f.value === unit} onPress={() => f.onChange(unit)}/>)}</View>}/>{errors.unit && <AppText accessibilityRole="alert">{errors.unit.message}</AppText>}</Card>
    <Card><AppText variant="card">Số đo đơn vị dự kiến</AppText>{field('widthM', 'Chiều rộng mỗi đơn vị (m)', true)}{field('depthM', 'Chiều sâu mỗi đơn vị (m)', true)}{field('heightM', 'Chiều cao mỗi đơn vị (m)', true)}{field('weightKg', 'Khối lượng mỗi đơn vị (kg)', true)}<AppText variant="caption" style={ui.muted}>Số dương, tối đa 3 chữ số thập phân; chấp nhận dấu phẩy hoặc chấm. Đây là validation minh họa, chưa phải DTO Backend. Số đo khai báo chưa được nhân viên kiểm tra.</AppText></Card>
    <Card><AppText variant="card">Danh mục không phải tồn kho</AppText><AppText>Lưu nháp không tạo Item thật, mã hàng, phiếu nhập hoặc di chuyển. Chỉ sau quy trình tiếp nhận đã được xác minh mới có dữ liệu tồn vật lý.</AppText></Card>
    {!!message && <AppText accessibilityRole="alert">{message}</AppText>}
    <Button label="Lưu bản nháp trong phiên" disabled={!isValid || isSubmitting} loading={isSubmitting} onPress={save}/><Button label="Trở về màn hình trước" variant="quiet" onPress={onBack}/>
    <DiscardDraftDialog visible={dialog} onCancel={() => {pending.current = null; setDialog(false);}} onDiscard={() => {const action = pending.current; pending.current = null; reset(getValues()); setDialog(false); action?.();}}/>
  </Screen>;
}
