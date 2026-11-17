import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Screen, Panel, Field, Input, Select, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { bomManagedInventoryCatalogApi as api } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { blankCatalogRecord, catalogConfig, CATALOG_KIND_KEYS } from "@/lib/managedCatalogKinds";

// Create/edit route for the shared managed-inventory catalog. The list screen only links here,
// so the form is a page of its own instead of a panel that appears under the table.
//   /…/managed-inventory-catalog/new/:kind
//   /…/managed-inventory-catalog/:kind/:id/edit
export default function CatalogRecordPage({ basePath = "/bom/managed-inventory-catalog", mode = "new" }) {
  const { kind = "category", id = "" } = useParams();
  const nav = useNavigate();
  const editing = mode === "edit";
  const config = catalogConfig(kind);
  const listPath = basePath;

  const record = useAsyncData(
    ({ signal }) => (editing && config ? api[config.get](id, { signal }).then((response) => response?.data?.data ?? null) : Promise.resolve(null)),
    [editing, id, kind],
  );

  const [form, setForm] = useState(blankCatalogRecord());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // The edit form is seeded from the record the route fetched, never from a list row.
  useEffect(() => {
    const row = record.data;
    if (!editing || !row) return;
    setForm({
      code: row.code || "",
      name: row.name || "",
      description: row.description || "",
      sortOrder: row.sortOrder ?? 0,
      isActive: row.isActive !== false,
    });
  }, [editing, record.data]);

  if (!config) {
    return (
      <Screen title="Không hỗ trợ loại danh mục" description="Chỉ có danh mục hàng hóa và đơn vị tính.">
        <Panel title="Loại danh mục không hợp lệ">
          <p className="text-sm text-slate-500">Đường dẫn phải là một trong: {CATALOG_KIND_KEYS.join(", ")}.</p>
          <Button asChild variant="outline" className="mt-4"><Link to={listPath}>Quay lại danh mục</Link></Button>
        </Panel>
      </Screen>
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), sortOrder: Number(form.sortOrder) };
      if (editing) body.isActive = Boolean(form.isActive);
      else body.code = form.code.trim().toUpperCase();
      if (editing) await api[config.update](id, body);
      else await api[config.create](body);
      nav(listPath, { state: { catalogNotice: editing ? `${config.plural} đã được cập nhật.` : `Đã tạo ${config.plural.toLowerCase()} mới.` } });
    } catch (err) {
      setError(apiErrorMessage(err, "Không lưu được danh mục."));
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? `Sửa ${config.plural.toLowerCase()}` : `Tạo ${config.plural.toLowerCase()}`;

  return (
    <Screen
      title={title}
      description="Danh mục và đơn vị tính dùng chung toàn hệ thống; khách hàng chỉ chọn được giá trị đang hoạt động."
      action={<Button asChild variant="outline"><Link to={listPath}>Quay lại danh mục</Link></Button>}
    >
      {editing && (
        <AsyncBoundary state={record} render={(row) => (row ? null : (
          <Panel title="Không tìm thấy bản ghi">
            <p className="text-sm text-slate-500">Bản ghi này không tồn tại hoặc đã bị xóa.</p>
            <Button asChild variant="outline" className="mt-4"><Link to={listPath}>Quay lại danh mục</Link></Button>
          </Panel>
        ))} />
      )}
      <Panel title={title} subtitle={editing ? "Mã định danh không thể thay đổi sau khi tạo." : "Mã định danh phải là duy nhất trong toàn hệ thống."}>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <Field label="Mã định danh" hint={`Chữ in hoa, không dấu. Ví dụ ${config.codePlaceholder.replace("VD: ", "")}.`}>
              <Input required maxLength={config.codeMax} value={form.code} placeholder={config.codePlaceholder} onChange={(e) => change("code", e.target.value)} />
            </Field>
          )}
          <Field label="Tên hiển thị" hint="Tên khách hàng và nhân viên nhìn thấy khi chọn.">
            <Input required maxLength={config.nameMax} value={form.name} onChange={(e) => change("name", e.target.value)} />
          </Field>
          <Field label="Thứ tự hiển thị" hint="Số nhỏ hiện trước trong danh sách chọn.">
            <Input type="number" min="0" max="1000000" step="1" required value={form.sortOrder} onChange={(e) => change("sortOrder", e.target.value)} />
          </Field>
          <Field label="Mô tả" hint="Không bắt buộc, tối đa 1000 ký tự.">
            <Input maxLength={1000} value={form.description} onChange={(e) => change("description", e.target.value)} />
          </Field>
          {editing && (
            <Field label="Trạng thái" hint="Ngừng sử dụng để ẩn khỏi lựa chọn mới mà vẫn giữ dữ liệu cũ.">
              <Select
                label="Trạng thái danh mục"
                value={form.isActive ? "true" : "false"}
                onChange={(value) => change("isActive", value === "true")}
                options={[["true", "Đang hoạt động"], ["false", "Ngừng sử dụng"]]}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Message error={error} />
          </div>
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => nav(listPath)}>Hủy</Button>
          </div>
        </form>
      </Panel>
    </Screen>
  );
}
