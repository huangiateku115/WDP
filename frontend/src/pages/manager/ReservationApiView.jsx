import FacilityHandoverPanel from '@/components/staff/FacilityHandoverPanel';
import ManagedV3LifecyclePanel from '@/components/manager/ManagedV3LifecyclePanel';
import { useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { facilityReservationApi } from '@/api/facilityReviewApi';
import { useAuthSession } from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import { apiRecord, apiRows, reservationRecord, objectId } from '@/lib/facilityReview';
import { Screen, Panel, Table, OpenLink, Input, Details, Status, Select, Message, Button, Timeline, money } from '@/components/manager/ManagerUI';

const statuses = ['RESERVED', 'CONTRACTED', 'DEPOSIT_PAID', 'CHECKIN_READY', 'PAID', 'ACTIVE', 'OVERDUE', 'CHECKED_OUT', 'CLOSED', 'CANCELLED'];
export default function ReservationApiView({ workspace = 'manager' }) {
    const { id } = useParams(), [params] = useSearchParams();
    return <ReservationApiContent key={(id || 'directory') + ':' + params.get('service')} workspace={workspace} />;
}
function ReservationApiContent({ workspace }) {
    const { id } = useParams(), [params] = useSearchParams(), nav = useNavigate(), { user, accessToken } = useAuthSession(), base = '/' + workspace, managed = params.get('service') === 'managed';
    const [status, setStatus] = useState(''), [lookup, setLookup] = useState('');
    const facilityId = user?.assignedFacilityId, manager = !!accessToken && user?.role === 'FACILITY_MANAGER', reader = !!accessToken && ['FACILITY_MANAGER', 'FACILITY_STAFF'].includes(user?.role), hasFacility = objectId(facilityId), valid = !id || objectId(id);

    const load = useCallback(
        async (signal) => {
            if (id) {
                return reservationRecord(
                    apiRecord(
                        await facilityReservationApi.detail(
                            id,
                            managed,
                            { signal }
                        )
                    )
                );
            }

            const response = managed
                ? await facilityReservationApi.listManaged(
                    facilityId,
                    { signal }
                )
                : await facilityReservationApi.list(
                    facilityId,
                    { signal }
                );

            return apiRows(response).map(reservationRecord);
        },
        [id, managed, facilityId]
    );

    const resource = useFacilityResource(
        load,
        reader &&
        hasFacility &&
        valid &&
        (!managed || manager),
        { refreshOnFocus: !id }
    );
    const row = id ? resource.data : null, scoped = !!row && row.facility === facilityId;
    return <Screen title={id ? "Chi tiết đơn thuê" : "Đơn đặt thuê"} code="P013" notice={row?.bookingFlowVersion === 3 ? "Hàng hóa phiên bản 3 · Kiểm tra bản chốt báo giá ô, hoàn tất chữ ký và ghi nhận bàn giao quyền truy cập. Nhập hàng thực tế là bước riêng." : "Theo dõi hợp đồng, thanh toán và bàn giao theo trạng thái hiện tại của hệ thống."} action={<Button variant="outline" disabled={resource.loading} onClick={resource.reload}>Tải lại</Button>}>
        {!reader ? <Panel title="Không có quyền truy cập"><p role="alert">Chỉ nhân viên và quản lý cơ sở có quyền xem đơn thuê. Đơn hàng hóa được giới hạn theo cơ sở được phân công.</p></Panel> : !hasFacility ? <Panel title="Chưa được phân công cơ sở"><p role="alert">Tài khoản cần được phân công cơ sở để xem đơn thuê.</p></Panel> : !valid ? <Panel title="Mã định danh đơn thuê không hợp lệ"><p role="alert">Nhập mã định danh đơn thuê hợp lệ thay cho mã trình diễn.</p></Panel> : <>
            {!id && <Panel title="Loại dịch vụ"><Select label="Loại dịch vụ thuê" value={managed ? 'managed' : 'self'} onChange={value => nav(`${base}/reservations${value === 'managed' ? '?service=managed' : ''}`)} options={manager ? [['self', "Thuê kho riêng"], ['managed', "Lưu trữ hàng hóa"]] : [['self', "Thuê kho riêng"]]} /></Panel>}
            {managed && !manager && <Panel title="Chưa có quyền xem chi tiết"><p>Nhân viên xem giám sát hàng hóa tại mục Lưu trữ hàng hóa. Quyền đọc đơn hàng hóa và lịch bàn giao cần được hệ thống cấp bổ sung.</p></Panel>}

            {resource.loading && <p role="status">Đang tải đơn thuê…</p>}<Message error={resource.error} />
            {manager && !managed && !id && resource.data && <Panel title="Theo dõi hạn ký hợp đồng giấy"><p className="mb-3">Đơn thanh toán 100% quá hạn ký cần quản lý xem xét. Danh sách này chỉ theo dõi; không tự hủy đơn, khấu trừ hoặc xác nhận hoàn tiền.</p><Table empty="Không có đơn đã thanh toán 100% quá hạn ký trong dữ liệu đang tải." rows={resource.data.filter(row => row.facility === facilityId && row.rentalPaymentFlow === 'FULL_UPFRONT_V1' && row.status === 'PAID' && row.signingDeadline && Date.parse(row.signingDeadline) <= Date.now())} columns={[{ key: 'reservationCode', label: 'Đơn thuê', render: row => <OpenLink to={`${base}/reservations/${row.id}`}>{row.reservationCode || row.id}</OpenLink> }, { key: 'signingDeadline', label: 'Hạn ký', render: row => new Date(row.signingDeadline).toLocaleString('vi-VN') }, { key: 'status', label: 'Trạng thái', render: row => <Status value={row.status} /> }]} /></Panel>}
            {!id && resource.data && <Panel title={managed ? "Đơn lưu trữ hàng hóa tại cơ sở được phân công" : "Đơn thuê kho riêng tại cơ sở được phân công"}><Select label="Lọc trạng thái đơn thuê" value={status} onChange={setStatus} options={[['', "Tất cả trạng thái"], ...statuses]} /><Table rows={resource.data.filter(r => r.facility === facilityId && (!status || r.status === status))} columns={[{ key: 'reservationCode', label: "Đơn thuê", render: r => <OpenLink to={`${base}/reservations/${r.id}${managed ? '?service=managed' : ''}`}>{r.reservationCode || r.id}</OpenLink> }, { key: 'customerName', label: "Khách hàng" }, { key: 'unit', label: managed ? "Dung lượng thuê" : "Kho", render: r => managed ? `${r.allocatedCapacity ?? '—'} m³` : r.unit }, { key: 'status', label: "Trạng thái", render: r => <Status value={r.status} /> }, { key: 'startDate', label: "Ngày bắt đầu", render: r => new Date(r.startDate).toLocaleDateString('vi-VN') }, { key: 'endDate', label: "Ngày kết thúc", render: r => new Date(r.endDate).toLocaleDateString('vi-VN') }]} /></Panel>}
            {row && !scoped && <Panel title="Ngoài cơ sở được phân công"><p role="alert">Không thể xem hoặc duyệt đơn ngoài cơ sở được phân công.</p></Panel>}
            {row && scoped && <><Panel title="Thông tin đơn thuê"><Details values={[["Mã đơn thuê", row.reservationCode || row.id], ["Trạng thái", <Status value={row.status} />], ["Dịch vụ", row.serviceType], ["Khách hàng", row.customerName], ["Email", row.customerId?.email || "Chưa cung cấp"], ["Số điện thoại", row.customerId?.phone || "Chưa cung cấp"], ["Kho / dung lượng", managed ? `${row.allocatedCapacity ?? '—'} m³` : row.unit], ["Bắt đầu", new Date(row.startDate).toLocaleDateString('vi-VN')], ["Kết thúc", new Date(row.endDate).toLocaleDateString('vi-VN')], ...(row.actualCheckoutDate || row.status === 'CHECKED_OUT' ? [["Ngày trả kho", row.actualCheckoutDate ? new Date(row.actualCheckoutDate).toLocaleString('vi-VN') : '—']] : []), ...(managed ? [["Tiền thuê", money(row.estimatedRent)], ["Khoản trả trước", money(row.depositAmount)]] : [["Tổng tiền thanh toán", money(row.estimatedRent)]]), ["Lý do từ chối", row.rejectReason || '—']]} /></Panel>
                {!managed && <FacilityHandoverPanel reservationId={row.id} />}
                {managed && (row.bookingFlowVersion === 3 ? <ManagedV3LifecyclePanel reservation={row} onRefresh={resource.reload} /> : <Panel title="Đơn thuê phiên bản trước"><p>Hồ sơ được giữ để tra cứu lịch sử. Các thao tác tiếp nhận hàng theo phiên bản trước đã ngừng sử dụng trong quy trình mới.</p></Panel>)}<Panel title="Lịch sử trạng thái"><Timeline entries={row.history} /></Panel></>}
        </>}
    </Screen>;
}
