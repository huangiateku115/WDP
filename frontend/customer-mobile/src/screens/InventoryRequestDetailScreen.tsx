import {useRef, useState} from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {requestDraftKey, useRequestDraftStore} from '../state/useRequestDraftStore';
import {requestContext, scopedRequest} from '../fixtures/inventoryRequests';
import {requestActionEligibility, requestFingerprint} from '../domain/inventoryRequests';
import {quantityText} from '../domain/inventory';
import {AppText, Button, Card, FixtureNotice, Screen, StateCard, ui} from '../components/ui';
import {RequestConfirmation, RequestDetails, RequestDraftNotice} from '../components/InventoryRequests';

export default function InventoryRequestDetailScreen() {
  const {id, requestId} = useLocalSearchParams<{id: string; requestId: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures);
  const request = data.customer ? scopedRequest(data.customer.id, id, requestId) : undefined;
  const context = request ? requestContext(data, id, request.kind) : null;
  const [modal, setModal] = useState<{fingerprint: string; version: number | null} | null>(null), [message, setMessage] = useState(''), busy = useRef(false);
  const key = context && request ? requestDraftKey({ownerId: context.ownerId, itemId: id, kind: request.kind, intent: 'CANCEL', requestId}) : '';
  const saved = useRequestDraftStore(s => s.drafts[key]);
  const cancelEligibility = context ? requestActionEligibility(context, request, 'CANCEL', request!.kind) : null;
  const amendEligibility = context ? requestActionEligibility(context, request, 'AMEND', request!.kind) : null;
  const fingerprint = context && request ? requestFingerprint(context, request) : '';
  const cancel = () => {
    if (!modal || busy.current || !context || !request) return;
    busy.current = true;
    const result = useRequestDraftStore.getState().confirm(useCustomerStore.getState().fixtures, {ownerId: context.ownerId, itemId: id, kind: request.kind, intent: 'CANCEL', requestId, values: null, sourceFingerprint: modal.fingerprint, expectedVersion: modal.version});
    setMessage(result.ok ? 'Đã lưu bản nháp hủy trong phiên — chưa hủy yêu cầu trên hệ thống.' : result.reason ?? 'Không thể lưu bản xem trước hủy.');
    setModal(null); busy.current = false;
  };
  return <Screen safeTop={false} testID="screen-inventory-request-detail"><FixtureNotice/>{!request || !context ? <StateCard title="Không tìm thấy yêu cầu mẫu"/> : <>
    <AppText variant="title">Chi tiết yêu cầu {request.kind === 'INBOUND' ? 'nhập thêm' : 'xuất kho'}</AppText><AppText variant="medium">{context.item.name} · {context.item.code}</AppText><RequestDetails request={request}/>
    <Card><AppText variant="card">Thao tác xem trước</AppText>{request.kind === 'INBOUND' && <><Button label="Chuẩn bị điều chỉnh bản nháp" variant="outline" disabled={!amendEligibility?.eligible} onPress={() => router.push({pathname: '/inventory/[id]/inbound', params: {id, requestId}})}/>{!amendEligibility?.eligible && <AppText variant="caption" style={ui.muted}>{amendEligibility?.reason}</AppText>}</>}
      <Button label="Xem trước hủy yêu cầu" variant="outline" disabled={!cancelEligibility?.eligible || !!saved} onPress={() => setModal({fingerprint, version: request.version})}/>{!cancelEligibility?.eligible && <AppText variant="caption" style={ui.muted}>{cancelEligibility?.reason}</AppText>}<AppText variant="caption" style={ui.muted}>Không hủy thật, không thay đổi phiên bản gốc hoặc số hàng đang giữ.</AppText>
    </Card>
    {!!saved && <RequestDraftNotice message={saved.sourceFingerprint === fingerprint ? 'Có bản nháp hủy trong phiên; trạng thái yêu cầu gốc giữ nguyên.' : 'Bản nháp hủy không còn khớp dữ liệu nguồn; không xác nhận lại.'}/>}{!!message && <RequestDraftNotice message={message}/>}
    <RequestConfirmation visible={!!modal} title="Xem trước hủy — chưa gửi lên hệ thống" onCancel={() => setModal(null)} onConfirm={cancel}>
      <AppText>{context.item.name} · {request.reference}</AppText><AppText>{quantityText(request.quantity, request.unit)} · phiên bản mẫu {request.version}</AppText><AppText>Lưu bản nháp hủy không giải phóng số giữ hoặc xác nhận hủy của Backend.</AppText>
    </RequestConfirmation>
  </>}<Button label="Trở về màn hình trước" variant="quiet" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/inventory')}/></Screen>;
}
