import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/api/facilityManagedApi';
import managedReservationApi from '@/api/managedReservationApi';
import { useAuthSession } from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import { objectId, recordId } from '@/lib/facilityReview';
import { managedItemPage, managedReadiness, scopedManagedReservation } from '@/lib/managedFacilityReview';
import { Screen, Panel, Field, Input, Select, Table, Status, Button, OpenLink, Message, Details } from '@/components/manager/ManagerUI';
import QueuePagination from '@/components/staff/QueuePagination';
import FacilityInventoryDetail from '@/components/facility/FacilityInventoryDetail';

const tabs = [ ['inventory', 'Giám sát hàng hóa'], ['visits', 'Lịch truy cập và hộ tống'],
  ['incidents', 'Sự cố và đối chiếu'], ['checkout', 'Trả không gian'] ];

export default function ManagedFacilityPage() {
  const { user, accessToken } = useAuthSession();
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'inventory';
  const role = user?.role === 'FACILITY_MANAGER' ? 'manager' : 'staff';
  const permitted = ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(user?.role) && objectId(user?.assignedFacilityId);
  const itemId = params.get('itemId');
  return <Screen title="Hàng hóa và tồn kho" notice="Tra cứu hàng hóa theo đúng nguồn ghi nhận của từng mặt hàng. Nhân viên và quản lý chỉ xem, không nhập hoặc xuất hàng thay khách.">
    {!permitted ? <Panel title="Chưa có quyền truy cập"><p>Cần tài khoản nhân viên hoặc quản lý được phân công cơ sở.</p></Panel> : <>
      <Panel title="Nghiệp vụ"><div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Button key={key} variant={tab === key ? 'default' : 'outline'} onClick={() => setParams({ tab: key })}>{label}</Button>)}</div></Panel>
      {tab === 'inventory' && (itemId ? objectId(itemId) ? <FacilityInventoryDetail key={`${user.id}:${user.assignedFacilityId}:${accessToken}:${itemId}`} itemId={itemId} user={user} role={role}/> : <Panel title="Mã mặt hàng không hợp lệ"><p>Chọn mặt hàng từ danh sách để xem tồn và lịch sử.</p><OpenLink to={`/${role}/managed`}>Về danh sách hàng hóa</OpenLink></Panel> : <Inventory key={`${user.assignedFacilityId}:${accessToken}`} user={user} role={role} />)}
      {tab === 'visits' && <Panel title="Lịch đến kho và hộ tống"><p>Quản lý phân công nhân viên cùng cơ sở. Nhân viên xác minh khách đến, bắt đầu phiên và ghi nhận khách rời kho. Thu hồi phiên phải có lý do an toàn.</p><div className="mt-4 flex flex-wrap gap-4"><OpenLink to={`/${role}/managed-access`}>Mở lịch đến kho và phiên truy cập</OpenLink><OpenLink to={`/${role}/managed-inventory-v3`}>Giám sát nhập hàng tự quản V3</OpenLink></div></Panel>}
      {tab === 'incidents' && <Panel title="Theo dõi sự cố và điều chỉnh tồn"><p>Chức năng lập sự cố hàng hóa, phê duyệt điều chỉnh và đối chiếu chuyên biệt chưa được cung cấp. Các sai lệch cần được xử lý có lý do và lịch sử xác nhận.</p><div className="mt-4 flex flex-wrap gap-4"><OpenLink to={`/${role}/support`}>Mở hỗ trợ khách hàng</OpenLink><OpenLink to={`/${role}/maintenance`}>Mở bảo trì cơ sở</OpenLink></div></Panel>}
      {tab === 'checkout' && <Panel title="Trả không gian lưu trữ"><p>Khách cần đưa tồn về không, xử lý lượng đang giữ và các yêu cầu còn mở trước khi bàn giao lại không gian. Xác nhận trả ô và giải phóng quyền thuê chưa khả dụng tại đây.</p>{role === 'manager' ? <CheckoutReadiness key={`${user.assignedFacilityId}:${accessToken}:${params.get('reservationId') || ''}`} user={user} /> : <p className="mt-3">Quản lý có thể xem báo cáo điều kiện hiện tại. Nhân viên cần chờ chức năng xác nhận trả không gian được cấp quyền.</p>}</Panel>}
    </>}
  </Screen>;
}

function Inventory({ user, role }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('');
  const load = useCallback(async signal => managedItemPage(await api.items(user.assignedFacilityId,
    { page, limit: 20, ...(query ? { search: query } : {}), ...(status ? { status } : {}) }, { signal }), user.assignedFacilityId, page),
  [user.assignedFacilityId, page, query, status]);
  const resource = useFacilityResource(load);
  return <Panel title="Hàng hóa trong cơ sở" action={<Button variant="outline" onClick={resource.reload}>Tải lại</Button>}>
    <p className="mb-4">Chọn Xem tồn và lịch sử tại một mặt hàng. Hệ thống tự tải đúng nguồn ghi nhận, không cần chọn phiên bản. Số lượng đăng ký chưa phải số lượng đang lưu thực tế.</p>
    <p className="mb-4"><OpenLink to={`/${role}/managed-inventory-v3`}>{role === 'manager' ? 'Báo cáo hàng hóa tự quản tại cơ sở' : 'Giám sát hàng hóa trong phiên được giao'}</OpenLink></p>
    <form className="facility-filter-row mb-4" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
      <Field label="Tìm mã hoặc tên mặt hàng"><Input maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <Field label="Trạng thái"><Select label="Trạng thái hàng hóa" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[["", 'Tất cả trạng thái'], ...['REGISTERED', 'PENDING_INBOUND', 'RECEIVED_PENDING_ACCEPTANCE', 'IN_STORAGE', 'PENDING_OUTBOUND', 'CHECKED_OUT'].map(value => [value, value])]} /></Field>
      <Button type="submit">Tìm kiếm</Button>
    </form>
    <Message error={resource.error} />{resource.loading && <p role="status">Đang tải hàng hóa…</p>}
    {resource.data && <><Table label="Giám sát hàng hóa" rows={resource.data.rows} columns={[
      { key: 'itemCode', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' },
      { key: 'customerId', label: 'Khách hàng', render: row => recordId(row.customerId) },
      { key: 'status', label: 'Trạng thái', render: row => <Status value={row.status} /> },
      { key: 'actions', label: 'Theo dõi', render: row => <div className="flex flex-wrap gap-3"><OpenLink to={`/${role}/managed?itemId=${row.id}`}>Xem tồn và lịch sử</OpenLink>{role === 'manager' && <><OpenLink to={`/manager/reservations/${recordId(row.managedReservationId)}?service=managed`}>Đơn thuê và hợp đồng</OpenLink><OpenLink to={`/manager/managed?tab=checkout&reservationId=${recordId(row.managedReservationId)}`}>Điều kiện trả không gian</OpenLink></>}</div> },
    ]} /><QueuePagination page={page} pagination={resource.data.pagination} loading={resource.loading} onPageChange={setPage} /></>}
  </Panel>;
}

function CheckoutReadiness({ user }) {
  const [params] = useSearchParams(), initial = params.get('reservationId') || '';
  const [input, setInput] = useState(initial), [reservationId, setReservationId] = useState(objectId(initial) ? initial : '');
  const load = useCallback(async signal => {
    scopedManagedReservation(await managedReservationApi.detail(reservationId, { signal }), reservationId, user.assignedFacilityId);
    return managedReadiness(await api.readiness(reservationId, { signal }), reservationId);
  }, [reservationId, user.assignedFacilityId]);
  const resource = useFacilityResource(load, objectId(reservationId));
  return <div className="mt-5 space-y-4"><form className="facility-filter-row" onSubmit={event => { event.preventDefault(); if (input === reservationId) resource.reload(); else setReservationId(input); }}><Field label="Mã định danh đơn hàng hóa"><Input value={input} onChange={event => setInput(event.target.value.trim())} /></Field><Button disabled={!objectId(input)}>Kiểm tra điều kiện</Button></form>
    <Message error={resource.error} />{resource.loading && <p role="status">Đang kiểm tra điều kiện…</p>}
    {resource.data && <><Details values={[
      ['Trạng thái đơn', resource.data.reservationStatus], ['Kết quả tổng thể', <Status value={resource.data.overallReadiness} />],
      ['Điều kiện hàng hóa', <Status value={resource.data.physicalReadiness} />], ['Điều kiện vận hành', <Status value={resource.data.operationalReadiness} />],
      ['Tồn hiện tại', resource.data.stockSummary?.currentQuantity ?? 'Chưa xác định'], ['Lượng đang giữ', resource.data.stockSummary?.heldQuantity ?? 'Chưa xác định'],
      ['Tài chính', <Status value={resource.data.financialReadiness} />], ['Thời điểm kiểm tra', new Date(resource.data.evaluatedAt).toLocaleString('vi-VN')],
    ]}/><p>Đây là kết quả kiểm tra chỉ đọc. Cần hoàn tất các điều kiện và xác nhận trả không gian trước khi kết thúc đơn.</p>
      <Table label="Điều kiện còn vướng" rows={resource.data.blockers.map((row, i) => ({ ...row, id: `${row.code}:${i}` }))} columns={[{ key: 'code', label: 'Mã điều kiện' }, { key: 'scope', label: 'Phạm vi' }, { key: 'message', label: 'Chi tiết từ hệ thống' }]} empty="Chưa có điều kiện chặn được ghi nhận. Kiểm tra cả các điều kiện chưa xác định." />
    </>}
  </div>;
}
