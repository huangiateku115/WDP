import { useState } from 'react';
import { ArrowUpRight, Clock3, MapPin, Warehouse } from 'lucide-react';
import facilityApi from '@/api/facilityApi';
import { CustomerScreen, Card, CardContent, Button, Link, LoadState, useBackend, rows, recordId, validId, addressText } from '@/components/customer/RentalBackendUI';
import WarehouseBreadcrumbs from '@/components/customer/WarehouseBreadcrumbs';

const serviceLabels = {
  SELF_STORAGE: 'Kho tự lưu trữ',
  MANAGED_INVENTORY: 'Kho quản lý hàng hóa',
};

export default function WarehouseFacilitySelectionPage() {
  const [page, setPage] = useState(1);
  const facilities = useBackend(async config => {
    const response = await facilityApi.publicList({ ...config, params: { serviceType: 'MANAGED_INVENTORY', page, limit: 6 } });
    const items = rows(response);
    if (items.some(f => !f || typeof f !== 'object' || !validId(recordId(f)) || typeof f.name !== 'string' || (f.serviceTypes !== undefined && !Array.isArray(f.serviceTypes)))) throw Error('Thông tin cơ sở không hợp lệ. Vui lòng tải lại.');
    const pagination = response.data.pagination;
    if (pagination && (!Number.isInteger(pagination.totalPages) || pagination.totalPages < 0)) throw Error('Thông tin phân trang cơ sở không hợp lệ. Vui lòng tải lại.');
    return { items: items.filter(f => (f.status === undefined || f.status === 'ACTIVE') && (f.serviceTypes === undefined || f.serviceTypes.includes('MANAGED_INVENTORY'))), pagination };
  }, [page]);
  const totalPages = Math.max(1, facilities.data?.pagination?.totalPages || 1);

  return <CustomerScreen
    title="Sơ đồ kho"
    description="Chọn cơ sở để xem cách bố trí khu vực, kệ và ô lưu trữ."
    notice="Bạn có thể xem sơ đồ mà không cần có đơn thuê. Trạng thái khả dụng và điều kiện đặt ô được kiểm tra theo thời hạn thuê; thông tin tồn kho thực tế chỉ hiển thị trong phạm vi được phép."
  >
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-800 shadow-sm" aria-hidden="true"><Warehouse size={21} /></span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">Bản đồ cơ sở</p>
          <p className="mt-1 text-sm text-slate-600">{facilities.data?.pagination ? `${facilities.data.pagination.totalItems ?? facilities.data.items.length} cơ sở` : 'Các cơ sở có kho quản lý hàng hóa'}</p>
        </div>
      </div>
      <WarehouseBreadcrumbs />
    </div>

    <LoadState resource={facilities} />
    {!!facilities.data?.items.length && <div className="grid auto-rows-fr gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {facilities.data.items.map(f => {
        const labels = (f.serviceTypes || []).map(type => serviceLabels[type]).filter(Boolean);
        return <Card key={recordId(f)} className="group h-full min-h-[288px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg">
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex min-h-[112px] items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-5">
              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800">Cơ sở lưu trữ</span>
                <h2 className="mt-3 break-words text-lg font-bold leading-snug text-slate-900">{f.name}</h2>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-800 text-white shadow-sm" aria-hidden="true"><Warehouse size={19} /></span>
            </div>

            <div className="flex flex-1 flex-col px-5 py-4">
              <div className="flex items-start gap-2.5 text-sm leading-6 text-slate-600">
                <MapPin size={16} className="mt-1 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="break-words">{addressText(f.address) || 'Chưa có địa chỉ'}</span>
              </div>
              {f.operatingHours && <div className="mt-3 flex items-center gap-2.5 text-sm text-slate-600">
                <Clock3 size={16} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <span><span className="font-medium text-slate-700">Giờ hoạt động:</span> {f.operatingHours}</span>
              </div>}

              {!!labels.length && <div className="mt-4 flex flex-wrap gap-2" aria-label="Dịch vụ tại cơ sở">
                {labels.map(label => <span key={label} className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{label}</span>)}
              </div>}

              <div className="mt-auto pt-5">
                <Button asChild variant="orange" className="w-full justify-between rounded-xl px-4 py-3 font-semibold shadow-sm transition group-hover:shadow-md">
                  <Link to={`/portal/warehouse-map/${recordId(f)}`} aria-label={`Mở sơ đồ kho tại ${f.name}`}>
                    <span>Xem sơ đồ kho</span><ArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>;
      })}
    </div>}

    {facilities.data?.items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Warehouse size={28} className="mx-auto text-slate-400" aria-hidden="true" />
      <p className="mt-3 font-semibold text-slate-800">Chưa có cơ sở kho đang hoạt động.</p>
      <p className="mt-1 text-sm text-slate-500">Vui lòng quay lại sau hoặc liên hệ bộ phận hỗ trợ.</p>
    </div>}

    {facilities.data?.pagination && <nav className="mt-6 flex flex-wrap items-center justify-center gap-3" aria-label="Phân trang danh sách cơ sở">
      <Button variant="outline" disabled={page <= 1 || facilities.loading} onClick={() => setPage(p => p - 1)}>Trang trước</Button>
      <span className="rounded-lg bg-white px-3 py-2 text-sm text-slate-600">Trang {page} / {totalPages}</span>
      <Button variant="outline" disabled={page >= totalPages || facilities.loading} onClick={() => setPage(p => p + 1)}>Trang sau</Button>
    </nav>}
  </CustomerScreen>;
}
