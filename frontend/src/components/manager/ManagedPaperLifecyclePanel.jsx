import { useCallback, useRef, useState } from 'react';
import client from '@/api/axiosClient';
import paperApi from '@/api/facilityHandoverApi';
import managedApi from '@/api/managedReservationApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';
import useFacilityResource, { announceReviewChange } from '@/lib/useFacilityResource';
import { apiRecord, recordId, objectId, reviewError } from '@/lib/facilityReview';
import { scopedManagedReservation } from '@/lib/managedFacilityReview';
import { currentDocument, paperEvidence } from '@/lib/facilityPaperContract';
import { managedContract, managedHandoverReady, managedHandoverPayload } from '@/lib/managedPaperContract';
import { Panel, Details, Status, Message, Button, Field, Input, Textarea, Select, Dialog, OpenLink, money } from '@/components/manager/ManagerUI';

export default function ManagedPaperLifecyclePanel({ reservation, onRefresh }) {
  const session = useAuthSession();
  return <ManagedPaperContent key={`${recordId(reservation)}:${session.user?.assignedFacilityId}:${session.accessToken}`} reservation={reservation} onRefresh={onRefresh} />;
}
function ManagedPaperContent({ reservation, onRefresh }) {
  const { user, accessToken } = useAuthSession(), facilityId = user?.assignedFacilityId, reservationId = recordId(reservation);
  // Current Managed detail API does not grant FACILITY_STAFF read access.
  const permitted = user?.role === 'FACILITY_MANAGER' && !!accessToken && objectId(facilityId) && objectId(reservationId) && recordId(reservation.facilityId) === facilityId;
  const [file, setFile] = useState(null), [number, setNumber] = useState(''), [customerSignedAt, setCustomerSignedAt] = useState(''), [facilitySignedAt, setFacilitySignedAt] = useState('');
  const [identityVerified, setIdentityVerified] = useState(false), [condition, setCondition] = useState('GOOD'), [notes, setNotes] = useState('');
  const [action, setAction] = useState(null), [saving, setSaving] = useState(false), [feedback, setFeedback] = useState({}), [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async signal => {
    const row = scopedManagedReservation(await managedApi.detail(reservationId, { signal }), reservationId, facilityId);
    if (row.bookingFlowVersion !== 3 || row.rentalPaymentFlow !== 'FULL_UPFRONT_V1') throw Error('Đơn không thuộc luồng hàng hóa thanh toán 100%. Tải lại để mở đúng quy trình.');
    let contract;
    try { contract = managedContract(await paperApi.contract(reservationId, { signal }), row); }
    catch (cause) { if (cause.response?.status !== 404) throw cause; contract = null; }
    return { reservation: row, contract };
  }, [reservationId, facilityId, accessToken]);
  const resource = useFacilityResource(load, permitted, { refreshOnFocus: false }), data = resource.data;
  const document = currentDocument(data?.contract), snapshot = document?.content;
  const expired = !!data?.reservation.signingDeadline && Date.parse(data.reservation.signingDeadline) <= Date.now();
  const paperAllowed = data?.reservation.status === 'PAID' && data?.contract?.status === 'DRAFT' && !expired;
  const ready = managedHandoverReady(data);
  async function run(event) {
    event.preventDefault(); if (busy.current || !data || uncertain || !permitted) return;
    busy.current = true; setSaving(true); setFeedback({}); let sent = false;
    const token = getAccessToken(), checkSession = () => { if (!token || token !== getAccessToken()) throw Error('Phiên đăng nhập đã thay đổi. Tải lại trước khi thao tác.'); };
    try {
      checkSession(); const fresh = await load(); checkSession();
      if (action === 'create') {
        if (fresh.reservation.status !== 'PAID' || fresh.contract || (fresh.reservation.signingDeadline && Date.parse(fresh.reservation.signingDeadline) <= Date.now())) throw Error('Chưa đủ điều kiện tạo hợp đồng. Tải lại để đối chiếu.');
        sent = true;
        const response = await client.post(`/reservations/managed/${reservationId}/contract`, {});
        const contract = managedContract(response, fresh.reservation);
        const verified = await load(); checkSession();
        if (!verified.contract || recordId(verified.contract) !== recordId(contract) || verified.contract.status !== 'DRAFT') throw Error('Chưa đọc lại được hợp đồng đã tạo.');
        setFeedback({ success: 'Đã tạo và đọc lại bản hợp đồng hiện hành. Hai bên ký bản giấy trước khi lưu bằng chứng.' });
      } else if (action === 'paper') {
        if (!file || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) throw Error('Chọn ảnh JPEG, PNG, WEBP hoặc PDF hợp đồng đã ký, tối đa 10 MB.');
        const input = { customerSignedAt, facilitySignedAt, customerIdentityVerified: identityVerified };
        const evidence = paperEvidence(data, input), latest = currentDocument(fresh.contract);
        if (!latest || recordId(fresh.contract) !== recordId(data.contract) || latest.version !== evidence.documentVersion || latest.contentHash !== evidence.documentHash) throw Error('Phiên bản hợp đồng đã thay đổi. Tải lại và đối chiếu trước khi lưu.');
        paperEvidence(fresh, input); checkSession(); sent = true;
        await paperApi.confirmPaper(recordId(fresh.contract), file, number, evidence);
        const verified = await load(); checkSession();
        if (verified.reservation.status !== 'CHECKIN_READY' || verified.contract?.status !== 'SIGNED' || !verified.contract.verifiedAt || !verified.contract.signedProofPublicId || !verified.contract.signedProofUrl) throw Error('Chưa xác minh được hợp đồng đã ký và trạng thái sẵn sàng bàn giao.');
        setFile(null); setCustomerSignedAt(''); setFacilitySignedAt(''); setIdentityVerified(false);
        setFeedback({ success: 'Đã xác minh hợp đồng giấy. Đơn chuyển sang sẵn sàng bàn giao; không có bước thanh toán phần còn lại.' });
      } else if (action === 'handover') {
        const latest = currentDocument(fresh.contract);
        if (!latest || latest.version !== document?.version || latest.contentHash !== document?.contentHash) throw Error('Hợp đồng đã thay đổi. Tải lại và kiểm tra trước khi bàn giao.');
        const body = managedHandoverPayload(fresh, { condition, notes, identityVerified }); checkSession(); sent = true;
        const result = apiRecord(await client.post(`/reservations/managed/${reservationId}/handover`, body));
        if (recordId(result) !== reservationId || result.status !== 'ACTIVE') throw Error('Kết quả bàn giao không khớp đơn hàng hóa.');
        const verified = await load(); checkSession();
        if (verified.reservation.status !== 'ACTIVE' || !verified.reservation.handoverAt || recordId(verified.reservation.handoverByStaffId) !== recordId(user) || verified.reservation.storageCondition !== body.storageCondition || verified.reservation.handoverAccessNotes !== body.accessNotes) throw Error('Chưa xác minh được bản ghi bàn giao từ hệ thống.');
        setIdentityVerified(false); setNotes(''); setFeedback({ success: 'Đã ghi nhận bàn giao không gian, đơn đang sử dụng. Thao tác này không nhập hàng, không cấp mã khóa số.' });
      } else throw Error('Thao tác không hợp lệ.');
      setAction(null); resource.reload(); onRefresh?.(); announceReviewChange();
    } catch (cause) {
      if (getAccessToken() === token) { setUncertain(sent); setFeedback({ error: reviewError(cause) + (sent ? ' Tải lại và đối chiếu trạng thái trước khi gửi tiếp.' : '') }); }
    } finally { busy.current = false; setSaving(false); }
  }
  if (!permitted) return <Panel title="Hợp đồng và bàn giao hàng hóa"><p>Chỉ quản lý thuộc cơ sở này có thể tải đơn qua API hiện tại. Quyền nhân viên đọc đơn hàng hóa cần được backend bổ sung.</p></Panel>;
  return <Panel title="Hợp đồng giấy và bàn giao hàng hóa" action={<Button variant="outline" disabled={saving} onClick={() => { setAction(null); setFile(null); setUncertain(false); resource.reload(); }}>Tải lại và đối chiếu</Button>}>
    <Message {...feedback} /><Message error={resource.error} />{resource.loading && <p role="status">Đang tải hợp đồng hàng hóa…</p>}
    {data && <div className="space-y-4">
      <Details values={[["Trạng thái đơn", <Status value={data.reservation.status} />], ["Hợp đồng", data.contract?.contractCode || 'Chưa tạo'], ["Trạng thái hợp đồng", data.contract ? <Status value={data.contract.status} /> : 'Chưa tạo'], ["Phiên bản hợp đồng", document?.version ?? 'Chưa tạo'], ["Bằng chứng đã ký", data.contract?.signedProofUrl ? 'Đã lưu' : 'Chưa có'], ["Hạn ký", data.reservation.signingDeadline ? new Date(data.reservation.signingDeadline).toLocaleString('vi-VN') : 'Chưa được cung cấp']]} />
      {snapshot?.reservation && <Details values={[["Cơ sở", snapshot.facility?.name || snapshot.reservation.facilityId], ["Ô đã phân bổ", snapshot.reservation.cellIds?.join(', ') || 'Chưa có'], ["Dung lượng thuê", `${snapshot.reservation.allocatedCapacityM3 ?? '—'} m³`], ["Tiền đã thanh toán", typeof snapshot.pricing?.totalPaid === 'number' ? money(snapshot.pricing.totalPaid) : 'Chưa được cung cấp'], ["Ngày bắt đầu", new Date(snapshot.reservation.startDate).toLocaleString('vi-VN')], ["Ngày kết thúc", new Date(snapshot.reservation.endDate).toLocaleString('vi-VN')]]} />}
      {data.reservation.status === 'PAID' && <p>Đã thanh toán đủ tiền thuê. Hai bên ký hợp đồng giấy tại cơ sở; người xác minh ghi thời điểm ký thực tế và lưu ảnh hoặc PDF.</p>}
      {expired && data.contract?.status !== 'SIGNED' && <p role="alert">Đã quá hạn ký. Cần quản lý xem xét; chưa có chức năng tự hủy hoặc hoàn tiền tại đây.</p>}
      {!data.contract && data.reservation.status === 'PAID' && !expired && <Button disabled={saving || uncertain} onClick={() => setAction('create')}>Tạo hợp đồng từ báo giá đã thanh toán</Button>}
      {paperAllowed && <fieldset disabled={saving || uncertain} className="space-y-3"><Field label="Ảnh hoặc PDF hợp đồng đã ký"><Input aria-label="Hợp đồng giấy hàng hóa" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setFile(event.target.files?.[0] || null)} /></Field><Field label="Số hợp đồng giấy (không bắt buộc)"><Input maxLength={100} value={number} onChange={event => setNumber(event.target.value)} /></Field><Field label="Thời điểm khách hàng ký"><Input aria-label="Thời điểm khách hàng ký" type="datetime-local" step="1" value={customerSignedAt} onChange={event => setCustomerSignedAt(event.target.value)} /></Field><Field label="Thời điểm đại diện cơ sở ký"><Input aria-label="Thời điểm đại diện cơ sở ký" type="datetime-local" step="1" value={facilitySignedAt} onChange={event => setFacilitySignedAt(event.target.value)} /></Field><label className="flex gap-2"><input type="checkbox" checked={identityVerified} onChange={event => setIdentityVerified(event.target.checked)} />Tôi đã xác minh danh tính khách và đối chiếu hai chữ ký trên bản giấy hiện hành.</label><Button disabled={!file || !customerSignedAt || !facilitySignedAt || !identityVerified} onClick={() => setAction('paper')}>Kiểm tra và xác minh hợp đồng giấy</Button></fieldset>}
      {data.reservation.status === 'CHECKIN_READY' && <p>Đã thanh toán đủ và xác minh hợp đồng. Bàn giao khi đến thời gian thuê, các ô còn được phân bổ và điều kiện an toàn đạt yêu cầu.</p>}
      {ready && <fieldset disabled={saving || uncertain} className="space-y-3"><Select label="Điều kiện không gian khi bàn giao" value={condition} onChange={setCondition} options={[["GOOD", 'Tốt'], ["MINOR_DAMAGE", 'Có hư hỏng nhẹ đã ghi nhận'], ["UNSAFE", 'Không an toàn — không bàn giao']]} /><Field label="Ghi chú bàn giao"><Textarea aria-label="Ghi chú bàn giao hàng hóa" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><label className="flex gap-2"><input type="checkbox" checked={identityVerified} onChange={event => setIdentityVerified(event.target.checked)} />Đã xác minh khách đến nhận đúng không gian được thuê.</label><Button disabled={!identityVerified || !notes.trim() || condition === 'UNSAFE'} onClick={() => setAction('handover')}>Kiểm tra và bàn giao không gian</Button></fieldset>}
      {data.reservation.status === 'ACTIVE' && <p role="status">Đã ghi nhận bàn giao lúc {data.reservation.handoverAt ? new Date(data.reservation.handoverAt).toLocaleString('vi-VN') : 'Chưa có thời điểm bàn giao'}. Đơn đang sử dụng; việc ghi hàng vào ô và cấp mã khóa số là các chức năng riêng.</p>}
      <div className="flex flex-wrap gap-4"><OpenLink to={`/manager/managed?tab=inventory`}>Giám sát hàng hóa</OpenLink><OpenLink to={`/manager/managed?tab=checkout&reservationId=${reservationId}`}>Kiểm tra điều kiện trả không gian</OpenLink></div>
    </div>}
    {action && <Dialog title={action === 'create' ? 'Tạo hợp đồng hiện hành' : action === 'paper' ? 'Xác nhận bằng chứng hợp đồng giấy' : 'Xác nhận bàn giao không gian'} onClose={() => { if (!busy.current) setAction(null); }}><form onSubmit={run} className="space-y-4"><p>{action === 'paper' ? 'Chỉ ghi nhận chữ ký thực tế của hai bên trên đúng phiên bản hợp đồng. Thao tác này không thay thế việc ký giấy.' : action === 'handover' ? 'Ghi nhận bàn giao không gian đã thuê. Không xác nhận nhập hàng hoặc cấp mã khóa số.' : 'Tạo bản hợp đồng dựa trên đơn, ô và báo giá đã được thanh toán.'}</p><Message {...feedback} /><Button type="submit" disabled={saving || uncertain}>{saving ? 'Đang xử lý…' : 'Xác nhận'}</Button></form></Dialog>}
  </Panel>;
}
