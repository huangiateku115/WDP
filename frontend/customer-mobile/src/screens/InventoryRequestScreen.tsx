import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {Controller, useForm, type Resolver} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {usePreventRemove} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {requestDraftKey, useRequestDraftStore} from '../state/useRequestDraftStore';
import {inventoryRequests, requestContext, scopedRequest} from '../fixtures/inventoryRequests';
import {inboundRequestSchema, outboundRequestSchema, requestActionEligibility, requestFingerprint, requestInitialValues, type InboundValues, type OutboundValues, type InventoryRequest, type RequestContext, type RequestKind} from '../domain/inventoryRequests';
import {canonicalStock, quantityText} from '../domain/inventory';
import {AppText, Button, Card, Input, StateCard, ui} from '../components/ui';
import {DiscardDraftDialog} from '../components/inventory';
import {RequestConfirmation, RequestDraftNotice, RequestItemContext, RequestUnavailableState, RequestWorkspace} from '../components/InventoryRequests';

export default function InventoryRequestScreen({kind, loading = false, error}: {kind: RequestKind; loading?: boolean; error?: string}) {
  const {id, requestId} = useLocalSearchParams<{id: string; requestId?: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures);
  const context = requestContext(data, id, kind), request = context && requestId ? scopedRequest(context.ownerId, id, requestId) : undefined;
  const [discard, setDiscard] = useState(false), intent = requestId ? 'AMEND' as const : 'CREATE' as const;
  const key = context ? requestDraftKey({ownerId: context.ownerId, itemId: id, kind, intent, requestId}) : '';
  const saved = useRequestDraftStore(s => s.drafts[key]);
  const fingerprint = context ? requestFingerprint(context, request) : '';
  const rows = context ? inventoryRequests.filter(r => r.ownerId === context.ownerId && r.itemId === id && r.kind === kind).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/inventory');
  const open = (r: InventoryRequest) => router.push({pathname: '/inventory/[id]/requests/[requestId]', params: {id, requestId: r.id}});
  const eligibility = context ? requestActionEligibility(context, request, intent, kind) : null;
  if (loading || error || !context || !eligibility?.eligible || saved && saved.sourceFingerprint !== fingerprint) return <RequestWorkspace testID={'screen-' + kind.toLowerCase() + '-requests'} back={back} rows={rows} onOpen={open} header={<>
    <AppText variant="title">{kind === 'INBOUND' ? 'Yêu cầu nhập thêm hàng' : 'Yêu cầu xuất kho'}</AppText>
    {loading ? <StateCard kind="loading" title="Đang chuẩn bị yêu cầu mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị yêu cầu" description={error}/> : !context ? <StateCard title="Không tìm thấy dữ liệu mẫu"/> : saved && saved.sourceFingerprint !== fingerprint ? <><RequestUnavailableState reason="Bản nháp cũ không còn khớp dữ liệu nguồn. Không tự khôi phục hoặc xác nhận."/><Button label="Bỏ bản nháp yêu cầu cũ" variant="outline" onPress={() => setDiscard(true)}/><DiscardDraftDialog visible={discard} stale onCancel={() => setDiscard(false)} onDiscard={() => {useRequestDraftStore.getState().remove(context.ownerId, key); setDiscard(false);}}/></> : <><RequestItemContext context={context} kind={kind}/><RequestUnavailableState reason={eligibility?.reason ?? 'Chưa đủ điều kiện.'}/></>}
  </>}/>;
  return <RequestEditor key={key} context={context} kind={kind} request={request} requestId={requestId} fingerprint={fingerprint} rows={rows} back={back} open={open}/>;
}

function RequestEditor({context, kind, request, requestId, fingerprint, rows, back, open}: {context: RequestContext; kind: RequestKind; request?: InventoryRequest; requestId?: string; fingerprint: string; rows: InventoryRequest[]; back: () => void; open: (request: InventoryRequest) => void}) {
  const demo = useCustomerStore(s => s.demoSession), intent = requestId ? 'AMEND' as const : 'CREATE' as const;
  const key = requestDraftKey({ownerId: context.ownerId, itemId: context.item.id, kind, intent, requestId}), saved = useRequestDraftStore(s => s.drafts[key]);
  const initial = saved?.values ?? requestInitialValues(context, kind, request);
  const schema = kind === 'INBOUND' ? inboundRequestSchema(context) : outboundRequestSchema(context);
  // The mounted editor's kind selects both its schema and its field set.
  const {control, watch, trigger, reset, getValues, handleSubmit, formState: {isValid, isDirty, isSubmitting}} = useForm<InboundValues | OutboundValues>({defaultValues: initial, resolver: zodResolver(schema) as Resolver<InboundValues | OutboundValues>, mode: 'onChange'});
  const [pending, setPending] = useState<{values: InboundValues | OutboundValues; fingerprint: string; version: number | null | undefined} | null>(null), [discard, setDiscard] = useState(false), [message, setMessage] = useState('');
  const pendingNavigation = useRef<(() => void) | null>(null), confirmationBusy = useRef(false);
  useEffect(() => {void trigger();}, [trigger]);
  usePreventRemove(isDirty && demo, ({repeat}) => {pendingNavigation.current = repeat; setDiscard(true);});
  const current = schema.safeParse(watch());
  const duplicate = saved?.sourceFingerprint === fingerprint && current.success && JSON.stringify(saved.values) === JSON.stringify(current.data);
  const stock = canonicalStock(context.item, context.detail).balance;
  const confirm = () => {
    if (!pending || confirmationBusy.current) return;
    confirmationBusy.current = true;
    const result = useRequestDraftStore.getState().confirm(useCustomerStore.getState().fixtures, {ownerId: context.ownerId, itemId: context.item.id, kind, intent, requestId, values: pending.values, sourceFingerprint: pending.fingerprint, expectedVersion: pending.version});
    if (result.ok) {
      const actual = useRequestDraftStore.getState().drafts[key]!;
      reset(actual.values!);
      setMessage(intent === 'AMEND' ? 'Đã lưu bản nháp điều chỉnh trong phiên — yêu cầu gốc chưa thay đổi.' : kind === 'OUTBOUND' ? 'Đã lưu bản nháp yêu cầu xuất kho trong phiên — chưa gửi lên hệ thống.' : 'Đã lưu bản nháp yêu cầu nhập thêm trong phiên — chưa gửi lên hệ thống.');
    } else setMessage(result.reason ?? 'Không thể lưu bản nháp.');
    setPending(null); confirmationBusy.current = false;
  };
  const field = (name: 'quantity' | 'note' | 'widthM' | 'depthM' | 'heightM' | 'weightKg', label: string) => <Controller key={name} control={control} name={name} render={({field: f, fieldState}) => <Input label={label} value={f.value} keyboardType={name === 'note' ? 'default' : 'decimal-pad'} multiline={name === 'note'} maxLength={name === 'note' ? 1000 : 16} onChangeText={v => {f.onChange(v); setMessage('');}} onBlur={f.onBlur} error={fieldState.isDirty || fieldState.isTouched ? fieldState.error?.message : undefined}/>}/>;
  return <RequestWorkspace testID={'screen-' + kind.toLowerCase() + '-requests'} back={back} rows={rows} onOpen={open} footer={<Button label={intent === 'AMEND' ? 'Xem trước điều chỉnh yêu cầu' : kind === 'INBOUND' ? 'Xem trước yêu cầu nhập thêm' : 'Xem trước yêu cầu xuất kho'} disabled={!isValid || isSubmitting || !!duplicate} loading={isSubmitting} onPress={handleSubmit(values => {setMessage(''); setPending({values, fingerprint, version: request?.version});})}/>} header={<>
    <RequestItemContext context={context} kind={kind}/>
    <Card><AppText variant="card">{intent === 'AMEND' ? 'Bản nháp điều chỉnh ' + request?.reference : kind === 'INBOUND' ? 'Chuẩn bị đợt nhập thêm' : 'Chuẩn bị xuất một phần hoặc toàn bộ'}</AppText>
      {request && <AppText>Phiên bản mẫu hiện tại: {request.version}. Cần kiểm tra lại trước khi lưu; không có thao tác cập nhật Backend.</AppText>}
      {saved && <AppText variant="caption" style={ui.muted}>Đã khôi phục bản nháp tương thích trong bộ nhớ phiên.</AppText>}
      {field('quantity', kind === 'INBOUND' ? 'Số lượng nhập thêm' : 'Số lượng yêu cầu xuất')}
      <AppText>Đơn vị cố định: {context.item.unit}</AppText>
      {kind === 'OUTBOUND' && <AppText variant="caption" style={ui.muted}>Tối đa {quantityText(stock?.available ?? null, context.item.unit)} theo số dư mẫu đã kiểm tra; không theo số lượng đăng ký.</AppText>}
      {kind === 'INBOUND' && <>{field('widthM', 'Chiều rộng đơn vị nhập (m)')}{field('depthM', 'Chiều sâu đơn vị nhập (m)')}{field('heightM', 'Chiều cao đơn vị nhập (m)')}{field('weightKg', 'Khối lượng đơn vị nhập (kg)')}<AppText variant="caption" style={ui.muted}>Số đo khai báo dương, tối đa 3 chữ số thập phân. Không phải phê duyệt dung tích hay vị trí đặt hàng.</AppText></>}
      {field('note', 'Ghi chú minh họa (tùy chọn)')}<AppText variant="caption" style={ui.muted}>Ghi chú chỉ là dữ liệu thiết kế; chưa xác nhận trường gửi lên Backend.</AppText>
    </Card>
    {duplicate && <AppText>Bản xem trước hiện tại đã được lưu trong phiên. Thay đổi nội dung để chuẩn bị bản nháp khác.</AppText>}
    {!!message && <RequestDraftNotice message={message}/>}
    <Card><AppText variant="card">Yêu cầu không phải thao tác kho</AppText><AppText>Chỉ chuẩn bị bản nháp. Nhân viên mới thực hiện kiểm tra, nhập/xuất và bàn giao thực tế. Không đổi tồn kho, số đang giữ hay vị trí ô khi lưu.</AppText></Card>
    <RequestConfirmation visible={!!pending} title="Xác nhận bản xem trước cục bộ" onCancel={() => setPending(null)} onConfirm={confirm}>
      <AppText>{context.item.name}</AppText><AppText>Số lượng: {pending ? quantityText(Number(pending.values.quantity), pending.values.unit) : 'Chưa chọn'}</AppText>{kind === 'OUTBOUND' && <AppText>Có thể xuất trước yêu cầu: {quantityText(stock?.available ?? null, context.item.unit)}</AppText>}{request && <AppText>Tham chiếu mẫu {request.reference} · phiên bản {pending?.version}</AppText>}
    </RequestConfirmation>
    <DiscardDraftDialog visible={discard} onCancel={() => {pendingNavigation.current = null; setDiscard(false);}} onDiscard={() => {const action = pendingNavigation.current; pendingNavigation.current = null; reset(getValues()); setDiscard(false); action?.();}}/>
  </>}/>;
}
