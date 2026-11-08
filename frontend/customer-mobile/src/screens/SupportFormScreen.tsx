import {useRef, useState} from 'react';
import {View} from 'react-native';
import {Controller, useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {usePreventRemove} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {useCareSessionStore} from '../state/useCareSessionStore';
import {careContext} from '../fixtures/customerCare';
import {ownedSupportItems, ownedSupportRentals, supportCategories, supportSourceBinding, type CareContext} from '../domain/customerCare';
import {emptySupportForm, supportFormSchema, type SupportFormValues} from '../forms/support';
import {AppText, Button, Card, Filter, FixtureNotice, Input, Screen, StateCard, ui} from '../components/ui';
import {CareDraftDialog, OfflineCareNotice} from '../components/customerCare';

export default function SupportFormScreen() {
  const {category} = useLocalSearchParams<{category?: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures), ownerId = data.customer?.id;
  const ctx = careContext(data), binding = supportSourceBinding(ctx), saved = useCareSessionStore(s => ownerId ? s.drafts[ownerId] : undefined), [staleDialog, setStaleDialog] = useState(false);
  const back = () => router.canGoBack() ? router.back() : router.replace('/support');
  const invalidCategory = category !== undefined && !(supportCategories as readonly string[]).includes(category);
  if (!ownerId || invalidCategory) return <Screen safeTop={false} testID="screen-support-form"><FixtureNotice/><StateCard title="Không thể mở bản nháp hỗ trợ" description="Chưa có khách hàng mẫu hoặc chủ đề liên kết không hợp lệ."/><Button label="Trở về màn hình trước" variant="quiet" onPress={back}/></Screen>;
  if (saved && (saved.ownerId !== ownerId || saved.sourceBinding !== binding || !supportFormSchema(ctx).safeParse(saved.values).success)) return <Screen safeTop={false} testID="screen-support-form"><FixtureNotice/><StateCard kind="error" title="Bản nháp hỗ trợ không còn khớp" description="Không khôi phục dữ liệu khi chủ sở hữu hoặc tài nguyên liên quan đã thay đổi."/><Button label="Bỏ bản nháp hỗ trợ cũ" variant="outline" onPress={() => setStaleDialog(true)}/><Button label="Trở về màn hình trước" variant="quiet" onPress={back}/><CareDraftDialog visible={staleDialog} mode="stale" onKeep={() => setStaleDialog(false)} onDiscard={() => {useCareSessionStore.getState().removeDraft(ownerId); setStaleDialog(false);}}/></Screen>;
  return <SupportEditor key={ownerId} ctx={ctx} binding={binding} restored={!!saved} initial={saved?.values ?? {...emptySupportForm(), category: category ?? ''}} onBack={back}/>;
}
function SupportEditor({ctx, binding, restored, initial, onBack}: {ctx: CareContext; binding: string; restored: boolean; initial: SupportFormValues; onBack: () => void}) {
  const demo = useCustomerStore(s => s.demoSession), ownerId = ctx.data.customer!.id;
  const pending = useRef<(() => void) | null>(null), [dialog, setDialog] = useState<'unsaved' | 'remove' | null>(null), [message, setMessage] = useState('');
  const {control, reset, getValues, handleSubmit, formState: {isDirty, isSubmitting, errors}} = useForm<SupportFormValues>({resolver: zodResolver(supportFormSchema(ctx)), defaultValues: initial, mode: 'onBlur'});
  usePreventRemove(isDirty && demo, ({repeat}) => {pending.current = repeat; setDialog('unsaved');});
  const save = handleSubmit(values => {
    const currentData = useCustomerStore.getState().fixtures;
    if (currentData.customer?.id === ownerId && useCareSessionStore.getState().saveDraft(currentData, values, binding)) {reset(values); setMessage('Đã lưu bản nháp yêu cầu hỗ trợ trong phiên — chưa gửi lên hệ thống.');}
    else setMessage('Không thể lưu: dữ liệu hoặc ngữ cảnh khách hàng đã thay đổi.');
  });
  const rentals = ownedSupportRentals(ctx), items = ownedSupportItems(ctx);
  return <Screen safeTop={false} testID="screen-support-form"><FixtureNotice/><AppText variant="title">Chuẩn bị yêu cầu hỗ trợ</AppText><OfflineCareNotice/>{restored && <AppText variant="caption" style={ui.muted}>Đã khôi phục bản nháp đã lưu trong phiên. Giữ chủ đề của bản nháp hiện có.</AppText>}
    <Card><AppText variant="card">Bạn cần hỗ trợ về điều gì?</AppText><Controller name="category" control={control} render={({field}) => <View style={ui.wrap}>{supportCategories.map(c => <Filter key={c} label={c} selected={field.value === c} onPress={() => {setMessage(''); field.onChange(c);}}/>)}</View>}/>{errors.category && <AppText accessibilityRole="alert">{errors.category.message}</AppText>}
      {(['subject', 'description'] as const).map(name => <Controller key={name} name={name} control={control} render={({field, fieldState}) => <Input label={name === 'subject' ? 'Tiêu đề yêu cầu' : 'Mô tả cần hỗ trợ'} value={field.value} onBlur={field.onBlur} onChangeText={value => {setMessage(''); field.onChange(value);}} multiline={name === 'description'} style={name === 'description' ? {minHeight: 140, textAlignVertical: 'top'} : undefined} maxLength={name === 'subject' ? 120 : 2000} error={fieldState.error?.message}/>}/>)}<AppText variant="caption" style={ui.muted}>Chỉ nhập thông tin mẫu. Giới hạn độ dài là validation giao diện, chưa phải yêu cầu Backend.</AppText>
    </Card>
    <Card><AppText variant="card">Tài nguyên liên quan · tùy chọn</AppText><AppText variant="label">Kỳ thuê</AppText><Controller name="rentalId" control={control} render={({field}) => <View style={ui.wrap}><Filter label="Không gắn kỳ thuê" selected={!field.value} onPress={() => {setMessage(''); field.onChange('');}}/>{rentals.map(r => <Filter key={r.id} label={r.label} selected={field.value === r.id} onPress={() => {setMessage(''); field.onChange(r.id);}}/>)}</View>}/>{errors.rentalId && <AppText accessibilityRole="alert">{errors.rentalId.message}</AppText>}<AppText variant="label">Hàng hóa</AppText><Controller name="itemId" control={control} render={({field}) => <View style={ui.wrap}><Filter label="Không gắn hàng hóa" selected={!field.value} onPress={() => {setMessage(''); field.onChange('');}}/>{items.map(item => <Filter key={item.id} label={item.label} selected={field.value === item.id} onPress={() => {setMessage(''); field.onChange(item.id);}}/>)}</View>}/>{errors.itemId && <AppText accessibilityRole="alert">{errors.itemId.message}</AppText>}<AppText variant="caption" style={ui.muted}>Ngữ cảnh kỳ thuê hàng hóa là fixture riêng của danh mục. Nếu chọn cả hai, hàng hóa phải thuộc đúng kỳ thuê; không tạo kỳ thuê mới.</AppText></Card>
    {!!message && <AppText accessibilityRole="alert">{message}</AppText>}<Button label="Lưu bản nháp hỗ trợ trong phiên" loading={isSubmitting} onPress={save}/>{restored && <Button label="Xóa bản nháp hỗ trợ" variant="outline" onPress={() => setDialog('remove')}/>}<Button label="Trở về màn hình trước" variant="quiet" onPress={onBack}/><CareDraftDialog visible={dialog !== null} mode={dialog ?? 'unsaved'} onKeep={() => {setDialog(null); pending.current = null;}} onDiscard={() => {if (dialog === 'remove') {useCareSessionStore.getState().removeDraft(ownerId); reset(emptySupportForm()); setMessage('Đã xóa bản nháp hỗ trợ khỏi bộ nhớ phiên.');} else {const action = pending.current; pending.current = null; reset(getValues()); action?.();} setDialog(null);}}/>
  </Screen>;
}
