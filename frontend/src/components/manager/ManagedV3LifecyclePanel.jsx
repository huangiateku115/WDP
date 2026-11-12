import { useEffect, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import contractApi from '@/api/contractApi';
import { useAuthSession, getAccessToken } from '@/lib/authSession';
import { apiRecord, objectId, recordId, reviewError } from '@/lib/facilityReview';
import { Screen, Panel, Details, Message, Button, Select, Textarea } from '@/components/manager/ManagerUI';
import ManagedPaperLifecyclePanel from './ManagedPaperLifecyclePanel';

export default function ManagedV3LifecyclePanel({ reservation, onRefresh }) {
  if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1') return <ManagedPaperLifecyclePanel reservation={reservation} onRefresh={onRefresh} />;
  return <LegacyManagedV3LifecyclePanel reservation={reservation} onRefresh={onRefresh} />;
}
function LegacyManagedV3LifecyclePanel({ reservation, onRefresh }) {
  const { accessToken, user } = useAuthSession();
  const [contract, setContract] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [condition, setCondition] = useState('GOOD'), [notes, setNotes] = useState('');
  const operation = useRef(false);
  const reservationId = recordId(reservation), facilityId = recordId(reservation?.facilityId);
  const operator = ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(user?.role) && recordId(user?.assignedFacilityId) === facilityId;
  const reload = async () => {
    setError('');
    try { setContract(apiRecord(await contractApi.byReservationReal(reservationId))); }
    catch (cause) { if (cause?.response?.status === 404) setContract(null); else setError(reviewError(cause)); }
  };
  useEffect(() => { void reload(); }, [reservationId, accessToken]);
  const transact = async work => {
    if (operation.current || !operator) return;
    operation.current = true; setBusy(true); setError('');
    try { await work(); await reload(); onRefresh?.(); }
    catch (cause) { setError(reviewError(cause)); }
    finally { operation.current = false; setBusy(false); }
  };
  const createContract = () => transact(async () => {
    if (reservation.status !== 'DEPOSIT_PAID') throw Error("Cần xác minh khoản trả trước để tạo bản chốt hợp đồng.");
    const response = await axiosClient.post(`/reservations/managed/${encodeURIComponent(reservationId)}/contract`, {});
    const value = apiRecord(response);
    if (recordId(value.reservationId) !== reservationId || value.termsVersion !== 'MI-V3-1' || value.currentContentVersion !== 1 || !value.contentVersions?.some(v => v.version === 1 && /^[a-f\d]{64}$/i.test(v.contentHash) && v.content?.schemaVersion === 3)) throw Error("Máy chủ chưa xác nhận bản chốt hợp đồng phiên bản 3.");
    setContract(value);
  });
  const signFacility = () => transact(async () => {
    if (!contract?._id || contract.status !== 'DRAFT') throw Error("Cần hợp đồng nháp phiên bản 3.");
    const response = await contractApi.signFacilityReal(contract._id);
    const value = apiRecord(response), active = value.contentVersions?.find(v => v.version === value.currentContentVersion);
    const customerSigned = value.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER');
    const facilitySigned = value.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(s.signerRole));
    if (recordId(value) !== recordId(contract) || !customerSigned || !facilitySigned || value.status !== 'SIGNED') throw Error("Máy chủ chưa xác nhận đủ hai chữ ký trên cùng phiên bản hợp đồng hiện hành.");
    setContract(value);
  });
  const handover = () => transact(async () => {
    if (reservation.status !== 'PAID' || !contract || contract.status !== 'SIGNED' || !reservation.balanceSettledAt || !notes.trim()) throw Error("Cần đơn đã thanh toán, hợp đồng đủ chữ ký và ghi chú bàn giao quyền truy cập.");
    const response = await axiosClient.post(`/reservations/managed/${encodeURIComponent(reservationId)}/handover`, { storageCondition: condition, accessNotes: notes.trim() });
    const value = apiRecord(response);
    if (recordId(value) !== reservationId || value.bookingFlowVersion !== 3 || value.status !== 'ACTIVE' || !value.handoverAt || !value.handoverByStaffId || value.storageCondition !== condition || value.handoverAccessNotes !== notes.trim()) throw Error("Máy chủ chưa xác nhận bàn giao hàng hóa phiên bản 3.");
  });
  const active = contract?.contentVersions?.find(v => v.version === contract.currentContentVersion);
  const content = active?.content;
  if (!operator) return <Panel title="Luồng thuê hàng hóa phiên bản 3"><p>Chỉ nhân viên hoặc quản lý được phân công tại cơ sở này có quyền xử lý hợp đồng và bàn giao truy cập phiên bản 3.</p></Panel>;
  return <Panel title="Luồng thuê hàng hóa phiên bản 3"><Message error={error}/>
    <Details values={[["Trạng thái đơn thuê", reservation.status], ["Phiên bản hợp đồng", active?.version ?? "Chưa tạo"], ["Mã kiểm chứng nội dung", active?.contentHash ?? "Máy chủ chưa trả dữ liệu"], ["Chữ ký", contract?.signatures?.filter(s => s.version === active?.version && s.contentHash === active?.contentHash).map(s => `${s.signerRole} · ${s.signedAt}`).join("; ") || "None"]]}/>
    {content?.reservation && <Details values={[["Cơ sở trong bản chốt", content.facility?.name || content.reservation.facilityId], ["Các ô lưu trữ", content.reservation.cellIds?.join(', ') || "Máy chủ chưa trả dữ liệu"], ["Dung lượng đã phân bổ", `${content.reservation.allocatedCapacityM3 ?? "—"} m³`], ["Khoảng thời gian thuê", `${content.reservation.startDate} – ${content.reservation.endDate}`], ["Kỳ hạn", JSON.stringify(content.reservation.term)], ["Tiền thuê theo báo giá", content.pricing?.estimatedRent], ["Tiền thuê trả trước", content.pricing?.depositAmount]]}/>}
    {!contract && reservation.status === 'DEPOSIT_PAID' && <Button disabled={busy} onClick={createContract}>{busy ? "Đang tạo…" : "Tạo bản chốt hợp đồng phiên bản 3"}</Button>}
    {contract?.status === 'DRAFT' && !contract.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER') && <p>Cần chữ ký khách trên bản chốt hiện hành. Máy chủ từ chối chữ ký cho phiên bản đã thay đổi.</p>}
    {contract?.status === 'DRAFT' && contract.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER') && <Button disabled={busy} onClick={signFacility}>{busy ? "Đang ký…" : "Ký hợp đồng hiện hành với tư cách đại diện cơ sở"}</Button>}
    {reservation.status === 'PAID' && <div className="mt-4 space-y-3"><Select label="Tình trạng kho khi bàn giao quyền truy cập" value={condition} onChange={setCondition} options={[["GOOD","Tốt"],["MINOR_DAMAGE","Có hư hỏng nhẹ đã ghi nhận"],["UNSAFE","Không an toàn"]]}/><Textarea aria-label="Ghi chú bàn giao quyền truy cập" required maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Ghi thông tin quyền truy cập hoặc ghi chú bàn giao"/><Button disabled={busy||!notes.trim()||contract?.status!=='SIGNED'} onClick={handover}>{busy ? "Đang ghi nhận…" : "Xác nhận bàn giao quyền truy cập"}</Button></div>}
    {reservation.status === 'ACTIVE' && <p role="status">Đã ghi nhận bàn giao quyền truy cập lúc {reservation.handoverAt || '—'} bởi {recordId(reservation.handoverByStaffId) || '—'}. Nhập hàng thực tế lần đầu là bước riêng.</p>}
    <p className="mt-3 text-sm">Hợp đồng phiên bản 3 dùng bản chốt ô, dung lượng, ngày thuê, kỳ hạn và giá. Bàn giao kích hoạt đơn thuê ngay cả khi chưa có hàng.</p>
  </Panel>;
}
