import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { bomManagedInventoryCatalogApi as api } from '@/api/bomApi';
import { Button, Input, Panel, Screen, Status, Table, Field, Select, Message } from '@/components/manager/ManagerUI';
import ListPager from '@/components/manager/ListPager';
import { AsyncBoundary, ConfirmDialog } from '@/components/bom/LiveBomUI';
import { useAsyncData } from '@/lib/useAsyncData';
import { usePageIndex } from '@/lib/usePageIndex';
import { apiErrorMessage } from '@/lib/apiError';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { catalogConfig, CATALOG_KIND_KEYS } from '@/lib/managedCatalogKinds';

// List screen only. Create and edit live on their own routes
// (`managed-inventory-catalog/new/:kind`, `managed-inventory-catalog/:kind/:id/edit`), so the
// table never grows a form underneath it.
const ALL = "__all__";

export default function ManagedInventoryCatalogPage({ basePath = '/bom/managed-inventory-catalog' }) {
  const location = useLocation();
  const [kind, setKind] = useState(CATALOG_KIND_KEYS[0]);
  const [searchDraft, setSearchDraft] = useState('');
  const [status, setStatus] = useState(ALL);
  const [deactivating, setDeactivating] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(location.state?.catalogNotice || '');
  const config = catalogConfig(kind);
  // A free-text search that hits the API on every keystroke breaks quy ước 2, so it is debounced.
  const search = useDebouncedValue(searchDraft);
  // The page resets to 1 whenever the kind, the search or the status filter changes.
  const [page, setPage] = usePageIndex(`${kind}|${search}|${status}`);

  const list = useAsyncData(
    async ({ signal }) => {
      // The backend only accepts ACTIVE / INACTIVE for `status`; sending an empty string for the
      // "all" choice is rejected with 400 (Bộ lọc trạng thái không hợp lệ), so the filter is
      // omitted entirely instead of being sent blank.
      const filters = { page, limit: 20 };
      if (search) filters.search = search;
      if (status !== ALL) filters.status = status;
      const response = await api[config.list](filters, { signal });
      if (response.data?.success !== true || !Array.isArray(response.data.data) || !response.data.pagination) {
        throw Error('Dữ liệu danh mục trả về không hợp lệ.');
      }
      // The catalog DTO exposes `id` and never `_id`, so rows are normalised once here and the
      // edit link plus the deactivate request keep pointing at a real record.
      const rows = response.data.data.map((row) => ({ ...row, _id: row.id ?? row._id }));
      return { rows, pagination: response.data.pagination };
    },
    [config, search, status, page],
  );

  const switchKind = useCallback((value) => {
    setKind(value);
    setSearchDraft('');
    setStatus(ALL);
    setError('');
    setSuccess('');
  }, []);

  async function deactivate(row) {
    setError('');
    setSuccess('');
    try {
      await api[config.remove](row._id);
      setSuccess(`Đã ngừng sử dụng “${row.name}”.`);
      list.reload();
    } catch (e) {
      setError(apiErrorMessage(e, 'Không thể ngừng sử dụng bản ghi.'));
    }
  }

  const columns = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên' },
    { key: 'description', label: 'Mô tả' },
    { key: 'sortOrder', label: 'Thứ tự' },
    { key: 'isActive', label: 'Trạng thái', render: (r) => <Status value={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions',
      label: 'Thao tác',
      render: (r) => (
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={`${basePath}/${kind}/${encodeURIComponent(r._id)}/edit`}>Sửa</Link>
          </Button>
          {r.isActive && <Button size="sm" variant="outline" onClick={() => setDeactivating(r)}>Ngừng dùng</Button>}
        </div>
      ),
    },
  ];

  return (
    <Screen
      title="Danh mục hàng hóa và đơn vị tính"
      description="Danh mục và đơn vị tính dùng chung toàn hệ thống. Khách hàng chỉ chọn được giá trị đang hoạt động."
      action={(
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={list.reload} disabled={list.loading}>Tải lại</Button>
          <Button asChild><Link to={`${basePath}/new/${kind}`}>Tạo {config.plural.toLowerCase()}</Link></Button>
        </div>
      )}
    >
      <Panel title="Danh mục chuẩn" subtitle="Đây là dữ liệu dùng chung, không cấu hình riêng theo cơ sở.">
        <div className="mb-5 flex flex-wrap gap-2">
          {CATALOG_KIND_KEYS.map((value) => (
            <Button key={value} variant={kind === value ? 'default' : 'outline'} onClick={() => switchKind(value)}>
              {catalogConfig(value).title}
            </Button>
          ))}
        </div>
        <div className="manager-filters">
          <Field label="Tìm kiếm">
            <Input aria-label="Tìm danh mục" placeholder="Tìm theo mã hoặc tên" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
          </Field>
          <Field label="Trạng thái">
            <Select
              label="Lọc trạng thái danh mục"
              value={status}
              onChange={setStatus}
              options={[[ALL, 'Tất cả trạng thái'], ['ACTIVE', 'Đang hoạt động'], ['INACTIVE', 'Ngừng sử dụng']]}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Message error={error} success={success} />
        </div>
        <AsyncBoundary state={list} render={(data) => (
          <>
            {data.pagination.truncated && <p className="bom-note mb-4">Đang hiển thị một phần dữ liệu. Hãy thu hẹp bộ lọc.</p>}
            <Table
              columns={columns}
              rows={data.rows}
              label={config.title}
              empty="Chưa có dữ liệu phù hợp. Tạo bản ghi đầu tiên để Customer có thể chọn."
            />
            <ListPager
              page={Number(data.pagination.page || page)}
              totalPages={Number(data.pagination.totalPages || 1)}
              total={Number(data.pagination.total || 0)}
              loading={list.loading}
              onPageChange={setPage}
            />
          </>
        )} />
      </Panel>

      {deactivating && (
        <ConfirmDialog
          title={`Ngừng sử dụng “${deactivating.name}”?`}
          summary="Bản ghi sẽ được giữ lại và không xuất hiện trong lựa chọn mới."
          confirmLabel="Ngừng sử dụng"
          onClose={() => setDeactivating(null)}
          onConfirm={() => deactivate(deactivating)}
        />
      )}
    </Screen>
  );
}
