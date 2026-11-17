import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button,
} from "@/components/manager/ManagerUI";
import { Checkbox } from "@/components/ui/checkbox";
import { TimeRangePicker } from "@/components/ui/time-range-picker";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { ResourceGallery, ResourceThumb } from "@/components/bom/ResourceImages";
import { ImageEditor } from "@/components/bom/ImageEditor";
import { bomFacilityApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilitiesIncludingDeleted, invalidateFacilities, loadFacilityUnits, loadWarehouseStructure } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, facilityFromDto, facilityForm, facilityBody, responseData, serviceLabel,
} from "@/lib/bomMappers";
import { COUNTRIES, CUSTOM_WARD, citiesFor, wardsFor } from "@/lib/addressData";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

const EMPTY_FORM = {
  code: "", name: "", line1: "", ward: "", wardCustom: false, district: "", city: "", country: "",
  openingHours: "", allDay: false, contactPhone: "", contactEmail: "",
  description: "", serviceTypes: ["SELF_STORAGE"], images: [], status: "ACTIVE",
  visitScheduleEnabled: false,
  visitScheduleDraft: { slotDurationMinutes: 60, weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: false, opensAt: "09:00", closesAt: "18:00" })) },
};
const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

// Single "opening hours" field: validates a `HH:MM - HH:MM` range (en-dash accepted).
const HOURS_PATTERN = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/;
const toMinutes = (hours, minutes) => Number(hours) * 60 + Number(minutes);
function hoursError(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = HOURS_PATTERN.exec(raw);
  if (!match) return "Dùng định dạng HH:MM - HH:MM (ví dụ 08:00 - 18:00).";
  const [h1, m1, h2, m2] = match.slice(1).map(Number);
  if (h1 > 23 || m1 > 59 || h2 > 23 || m2 > 59) return "Giờ hoặc phút không hợp lệ.";
  if (toMinutes(h2, m2) <= toMinutes(h1, m1)) return "Giờ đóng phải sau giờ mở.";
  return "";
}
function formatHours(value) {
  const match = HOURS_PATTERN.exec(String(value || ""));
  if (!match) return String(value || "").trim();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(match[1])}:${match[2]} - ${pad(match[3])}:${match[4]}`;
}

// `basePath` and `oversightRoot` keep the same facility console usable from the BOM and the
// Admin workspace: every internal link, the breadcrumb back-action and the post-save
// redirect are derived from them instead of being hard-coded to /bom/*.
export default function FacilityPage({
  mode = "list", basePath = "/bom/facilities", oversightRoot = "/bom/oversight",
}) {
  if (mode === "new") return <FacilityForm mode="new" basePath={basePath} oversightRoot={oversightRoot} />;
  if (mode === "edit") return <FacilityForm mode="edit" basePath={basePath} oversightRoot={oversightRoot} />;
  if (mode === "detail") return <FacilityDetail basePath={basePath} oversightRoot={oversightRoot} />;
  return <FacilityList basePath={basePath} />;
}

function FacilityList({ basePath }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const state = useAsyncData(
    ({ signal }) => (showDeleted ? loadFacilitiesIncludingDeleted({ signal }) : loadFacilities()),
    [showDeleted],
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const facilities = state.data || [];
  const cities = [...new Set(facilities.map((f) => f.city).filter(Boolean))];
  const rows = facilities.filter((f) =>
    (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())) &&
    (!status || f.status === status) &&
    (!city || f.city === city));

  return (
    <Screen
      title="Cơ sở"
      description="Tạo mới, sửa, kích hoạt, ngừng hoạt động hoặc xóa cơ sở."
      action={<Button asChild variant="orange"><Link to={`${basePath}/new`}>Tạo cơ sở</Link></Button>}
    >
      <Panel title="Bộ lọc cơ sở">
        <div className="manager-filters">
          <Field label="Tìm kiếm">
            <Input aria-label="Tìm cơ sở" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Trạng thái">
            <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
          </Field>
          <Field label="Thành phố">
            <Select label="Lọc theo thành phố" value={city} onChange={setCity} options={[["", "Tất cả thành phố"], ...cities]} />
          </Field>
            <Field label="Bản ghi">
            <Select
              label="Lọc bản ghi"
              value={showDeleted ? "deleted" : "live"}
              onChange={(value) => setShowDeleted(value === "deleted")}
              options={[["live", "Cơ sở đang hoạt động"], ["deleted", "Cơ sở đã xóa"]]}
            />
          </Field>
        </div>
      </Panel>
      <AsyncBoundary state={state} render={() => (
        <Panel title="Danh sách cơ sở" subtitle={`${rows.length} / ${facilities.length} cơ sở`}>
          <Table
            label="Cơ sở"
            rows={rows}
            columns={[
              { key: "cover", label: "Photo", render: (f) => <ResourceThumb src={f.coverImage} alt={`${f.name} cover`} /> },
              { key: "name", label: "Facility", render: (f) => (f.deleted
                ? f.name
                : <OpenLink to={`${basePath}/${f.id}`}>{f.name}</OpenLink>) },
              { key: "code", label: "Code" },
              { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
              { key: "city", label: "City / Province" },
              { key: "address", label: "Address" },
              { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
              { key: "openingHours", label: "Opening hours" },
              {
                key: "actions",
                label: "Actions",
                render: (f) => (f.deleted
                  ? <Button size="sm" variant="outline" onClick={() => setRestoreTarget(f)}>Khôi phục</Button>
                  : <OpenLink to={`${basePath}/${f.id}`}>Mở</OpenLink>),
              },
            ]}
            empty={showDeleted ? "Không có cơ sở đã xóa." : "Không có cơ sở phù hợp bộ lọc."}
          />
        </Panel>
      )} />
      {restoreTarget && (
        <ConfirmDialog
          title={`Khôi phục ${restoreTarget.code}?`}
          confirmLabel="Khôi phục cơ sở"
          onClose={() => setRestoreTarget(null)}
          onConfirm={async () => {
            await bomFacilityApi.restore(restoreTarget.id);
            invalidateFacilities();
            state.reload();
          }}
        >
          <p className="text-sm text-slate-500">
            <b>{restoreTarget.name}</b> sẽ hiển thị trở lại và có thể nhận đơn khi đang ở trạng thái ACTIVE.
          </p>
        </ConfirmDialog>
      )}
    </Screen>
  );
}

// Navigation context comes from the ROUTE first, so the sidebar, the back action and the
// edit flow stay correct on reload, bookmark or shared link. `location.state` is only a
// fallback for entry points that have no dedicated route yet (e.g. the dashboard).
function facilityNav(location, { basePath = "/bom/facilities", oversightRoot = "/bom/oversight" } = {}) {
  const pathname = location?.pathname || "";
  if (pathname === oversightRoot || pathname.startsWith(`${oversightRoot}/`)) {
    return { base: `${oversightRoot}/facilities`, backTo: oversightRoot, backLabel: "Quay lại giám sát" };
  }
  const backTo = location?.state?.from || basePath;
  const backLabel = backTo.endsWith("/dashboard") ? "Quay lại tổng quan" : "Quay lại danh sách cơ sở";
  return { base: basePath, backTo, backLabel };
}

function FacilityDetail({ basePath, oversightRoot }) {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const state = useAsyncData(() => bomFacilityApi.get(id).then(responseData).then(facilityFromDto), [id]);
  const warehouse = useAsyncData(({ signal }) => loadWarehouseStructure(id, { signal }), [id]);
  const units = useAsyncData(({ signal }) => loadFacilityUnits(id, { signal }), [id]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { base, backTo, backLabel } = facilityNav(location, { basePath, oversightRoot });

  if (!state.loading && state.error && /not found|unavailable|invalid|404/i.test(state.error)) return <BomUnavailable />;

  return (
    <Screen
      title="Chi tiết cơ sở"
      description="Thông tin và trạng thái cơ sở."
      action={<Button asChild variant="outline"><Link to={backTo}>{backLabel}</Link></Button>}
    >
      <AsyncBoundary state={state} render={(facility) => {
        const nextStatus = facility.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return (
          <>
            <Panel
              title="Thông tin cơ sở"
              action={(
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline"><Link to={`${base}/${id}/edit`} state={{ from: backTo }}>Sửa cơ sở</Link></Button>
                  <Button variant="outline" onClick={() => setDeleteOpen(true)}>Xóa cơ sở</Button>
                </div>
              )}
            >
              <Details values={[
                ["Facility code", facility.code],
                ["Country", facility.country],
                ["City / Province", facility.city],
                ["Ward / Commune", facility.ward],
                ["Street / area", facility.district],
                ["Address", facility.address],
                ["Opening hours", facility.openingHours],
                ["Service models", facility.serviceTypes.join(", ") || "—"],
                ["Managed visit schedule", facility.managedVisitSchedule ? `${facility.managedVisitSchedule.timeZone} · khung ${facility.managedVisitSchedule.slotDurationMinutes} phút · ${facility.managedVisitSchedule.weeklyHours?.length || 0} ngày đã cấu hình` : "Chưa cấu hình"],
                ["Business status", <Status value={facility.status} />],
                ["Contact phone", facility.contact?.phone],
                ["Contact email", facility.contact?.email],
                ["Description", facility.description],
              ]} />
              <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Kích hoạt cơ sở" : "Ngừng hoạt động cơ sở"}
                </Button>
              </div>
            </Panel>
            <Panel title="Hình ảnh cơ sở">
              <ResourceGallery images={facility.images} alt={`${facility.name} photo`} />
            </Panel>
            {facility.serviceTypes.includes("MANAGED_INVENTORY") && (
              <AsyncBoundary state={warehouse} render={({ zones, racks, available, reason }) => {
                const cells = sumBy(racks, "cellCount");
                const availableCells = sumBy(racks, "availableCellCount");
                return (
                  <Panel title="Thông tin kho">
                    {!available && (
                      <p className="bom-note mb-5">
                        Cơ sở này không thuộc bản đồ kho: {reason || "cơ sở không cung cấp dịch vụ lưu trữ hàng hóa"}.
                      </p>
                    )}
                  <Details values={[
                    ["Zones", zones.length],
                    ["Racks", racks.length],
                    ["Cells", cells ? `${availableCells} / ${cells} ô trống` : "—"],
                    ["Rated / allocatable weight", `${kg(sumBy(racks, "ratedCapacityKg"))} / ${kg(sumBy(racks, "allocatableCapacityKg"))}`],
                  ]} />
                  <div className="mt-5">
                    <Table
                      label="Kệ của cơ sở"
                      rows={racks}
                      columns={[
                        { key: "rackCode", label: "Rack" },
                        { key: "zone", label: "Zone", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
                        { key: "aisleCode", label: "Aisle" },
                        { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
                        { key: "cells", label: "Cells", render: (r) => `${r.availableCellCount} / ${r.cellCount} ô trống` },
                        { key: "ratedCapacityKg", label: "Rated / allocatable", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
                      ]}
                      empty="Chưa cấu hình khu vực, kệ hoặc ô chứa cho cơ sở này."
                    />
                  </div>
                </Panel>
              );
            }} />
            )}
            {facility.serviceTypes.includes("SELF_STORAGE") && (
            <AsyncBoundary state={units} render={({ rows, total, truncated }) => (
              <Panel title="Kho riêng" subtitle={`${rows.length} / ${total} kho`}>
                {truncated && <TruncatedNotice total={total} shown={rows.length} />}
                <Details values={[
                  ["Occupied", countBy(rows, "status", "OCCUPIED")],
                  ["Available", countBy(rows, "status", "AVAILABLE")],
                  ["Blocked", countBy(rows, "status", "HELD") + countBy(rows, "status", "MAINTENANCE") + countBy(rows, "status", "INACTIVE")],
                  ["Registered volume", m3(sumBy(rows, "volumeM3"))],
                ]} />
                <div className="mt-5">
                  <Table
                    label="Kho riêng của cơ sở"
                    rows={rows}
                    columns={[
                      { key: "code", label: "Unit" },
                      { key: "size", label: "Size" },
                      { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
                      { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                    ]}
                    empty="Cơ sở này chưa đăng ký kho riêng nào."
                  />
                </div>
              </Panel>
            )} />
            )}
            {confirmOpen && (
              <ConfirmDialog
                title="Xác nhận trạng thái cơ sở"
                confirmLabel={`Chuyển sang ${nextStatus === "ACTIVE" ? "ACTIVE" : "INACTIVE"}`}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                  await bomFacilityApi.setStatus(id, nextStatus);
                  invalidateFacilities();
                  state.reload();
                }}
              >
                <p className="text-sm text-slate-500">
                  Cơ sở <b>{facility.name}</b> sẽ được chuyển sang trạng thái <b>{nextStatus}</b>.
                </p>
              </ConfirmDialog>
            )}
            {deleteOpen && (
              <ConfirmDialog
                title="Xóa cơ sở"
                confirmLabel="Xóa cơ sở"
                onClose={() => setDeleteOpen(false)}
                onConfirm={async () => {
                  await bomFacilityApi.remove(id);
                  invalidateFacilities();
                  nav(backTo);
                }}
              >
                <p className="text-sm text-slate-500">
                  <b>{facility.name}</b> sẽ bị gỡ khỏi mọi danh sách, bản đồ kho và luồng đặt thuê. Không thể xóa khi còn kho riêng
                  hoặc khu vực kho tham chiếu tới cơ sở.
                </p>
              </ConfirmDialog>
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function FacilityForm({ mode, basePath, oversightRoot }) {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const { backTo } = facilityNav(location, { basePath, oversightRoot });
  const isEdit = mode === "edit";
  const state = useAsyncData(
    () => (isEdit ? bomFacilityApi.get(id).then(responseData).then(facilityForm) : Promise.resolve(null)),
    [id, isEdit],
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const next = state.data || EMPTY_FORM;
    const stored = String(next.openingHours || "").trim();
    const allDay = stored.toLowerCase() === "24/7";
    setForm({
      ...next,
      allDay,
      openingHours: allDay ? "" : stored,
      wardCustom: Boolean(next.ward) && !wardsFor(next.city).includes(next.ward),
    });
  }, [state.data]);

  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const wards = wardsFor(form.city);
  const wardChosen = form.wardCustom ? Boolean(form.ward.trim()) : Boolean(form.ward);
  const toggleService = (service) => setForm((f) => ({
    ...f,
    serviceTypes: f.serviceTypes.includes(service)
      ? f.serviceTypes.filter((s) => s !== service)
      : [...f.serviceTypes, service],
  }));

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      if (!form.country) throw new Error("Hãy chọn quốc gia.");
      if (!form.city) throw new Error("Hãy chọn tỉnh / thành phố.");
      if (!form.ward.trim()) throw new Error("Hãy chọn hoặc nhập phường / xã.");
      if (!form.district.trim()) throw new Error("Hãy nhập đường / khu vực.");
      if (!form.line1.trim()) throw new Error("Hãy nhập địa chỉ / số nhà.");
      if (form.contactEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) {
        throw new Error("Email liên hệ không hợp lệ.");
      }
      const hours = form.allDay ? "" : form.openingHours.trim();
      if (hours) {
        const message = hoursError(hours);
        if (message) throw new Error(message);
      }
      const openingHours = form.allDay ? "24/7" : (hours ? formatHours(hours) : "");
      if (form.visitScheduleEnabled) {
        const configuredDays = form.visitScheduleDraft?.weeklyHours?.filter((entry) => entry.enabled) || [];
        if (!configuredDays.length) throw new Error("Hãy chọn ít nhất một ngày cho lịch thăm kho.");
        const duration = Number(form.visitScheduleDraft.slotDurationMinutes);
        if (!Number.isSafeInteger(duration) || duration < 30 || duration > 480 || duration % 15) throw new Error("Khung giờ thăm phải từ 30–480 phút, theo bước 15 phút.");
        if (configuredDays.some((entry) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.closesAt) || entry.opensAt >= entry.closesAt)) throw new Error("Mỗi ngày thăm cần giờ mở và giờ đóng hợp lệ.");
      }
      const imageUrls = (form.images || []).map((url) => String(url).trim()).filter(Boolean);
      if (imageUrls.length > 10) throw new Error("Chỉ cho phép tối đa 10 ảnh cơ sở.");
      if (imageUrls.some((url) => {
        try {
          const parsed = new URL(url);
          return !["http:", "https:"].includes(parsed.protocol);
        } catch {
          return true;
        }
      })) throw new Error("Mỗi ảnh cơ sở phải là URL HTTP(S) hợp lệ.");
      const body = facilityBody({ ...form, openingHours, images: imageUrls }, { includeCode: !isEdit });
      if (isEdit) await bomFacilityApi.update(id, body);
      else await bomFacilityApi.create(body);
      invalidateFacilities();
      nav(backTo);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen
      title={isEdit ? "Sửa cơ sở" : "Tạo cơ sở"}
    >
      <AsyncBoundary
        state={isEdit ? state : { loading: false, data: null, error: "" }}
        render={() => (
          <Panel title="Thông tin cơ sở">
            <form className="bom-form" onSubmit={submit}>
              {!isEdit && (
                <Field label="Mã cơ sở" hint="Phải là duy nhất.">
                  <Input aria-label="Mã cơ sở" required value={form.code} onChange={(e) => change("code", e.target.value)} />
                </Field>
              )}
              <Field label="Tên cơ sở">
                <Input aria-label="Tên cơ sở" required value={form.name} onChange={(e) => change("name", e.target.value)} />
              </Field>
              <Field label="Quốc gia">
                <Select
                  label="Quốc gia"
                  value={form.country}
                  onChange={(v) => setForm((f) => ({ ...f, country: v, city: "", ward: "", wardCustom: false, district: "", line1: "" }))}
                  options={[["", "Chọn quốc gia"], ...COUNTRIES]}
                />
              </Field>
              <Field label="Tỉnh / Thành phố">
                <Select
                  label="Tỉnh / Thành phố"
                  value={form.city}
                  disabled={!form.country}
                  onChange={(v) => setForm((f) => ({ ...f, city: v, ward: "", wardCustom: false, district: "", line1: "" }))}
                  options={[["", form.country ? "Chọn tỉnh / thành phố" : "Chọn quốc gia trước"], ...citiesFor(form.country)]}
                />
              </Field>
              <Field label="Phường / Xã">
                <Select
                  label="Phường / Xã"
                  value={form.wardCustom ? CUSTOM_WARD : form.ward}
                  disabled={!form.city}
                  onChange={(v) => setForm((f) => ({ ...f, wardCustom: v === CUSTOM_WARD, ward: v === CUSTOM_WARD ? "" : v, district: "", line1: "" }))}
                  options={[["", form.city ? "Chọn phường / xã" : "Chọn tỉnh / thành phố trước"], ...wards, [CUSTOM_WARD, "Khác (nhập tay)"]]}
                />
              </Field>
              {form.wardCustom && (
                <Field label="Phường / Xã (nhập tay)">
                  <Input aria-label="Phường / Xã" required value={form.ward} onChange={(e) => change("ward", e.target.value)} />
                </Field>
              )}
              <Field label="Đường / Khu vực">
                <Input
                  aria-label="Đường / Khu vực"
                  required
                  disabled={!wardChosen}
                  value={form.district}
                  onChange={(e) => change("district", e.target.value)}
                />
              </Field>
              <Field label="Địa chỉ / Số nhà">
                <Input
                  aria-label="Địa chỉ / Số nhà"
                  required
                  disabled={!form.district.trim()}
                  value={form.line1}
                  onChange={(e) => change("line1", e.target.value)}
                />
              </Field>
              {/* Not <Field/>: a <label> would forward clicks from the custom trigger
                  to the first labelable child (the 24/7 checkbox input). */}
              <div className="manager-field">
                <span>Giờ mở cửa</span>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[240px] flex-1">
                    <TimeRangePicker
                      ariaLabel="Giờ mở cửa"
                      placeholder="08:00 - 18:00"
                      disabled={form.allDay}
                      value={form.openingHours}
                      onChange={(next) => setForm((f) => ({ ...f, openingHours: next }))}
                    />
                  </div>
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox aria-label="Mở cửa 24/7" checked={form.allDay} onCheckedChange={(v) => setForm((f) => ({ ...f, allDay: v === true }))} />
                    Mở cửa 24/7
                  </span>
                </div>
                <small>Chọn giờ mở và giờ đóng, hoặc đánh dấu cơ sở mở cửa 24/7.</small>
                {!form.allDay && hoursError(form.openingHours) && (
                  <small role="alert" className="text-xs text-red-700">{hoursError(form.openingHours)}</small>
                )}
              </div>
              {form.serviceTypes.includes("MANAGED_INVENTORY") && <div className="manager-field">
                <span>Lịch thăm kho</span>
                <small>Tách biệt với giờ mở cửa cơ sở. Giờ dùng múi giờ Asia/Ho_Chi_Minh.</small>
                <label className="mt-2 flex items-center gap-2 text-sm"><Checkbox aria-label="Cấu hình lịch thăm kho" checked={form.visitScheduleEnabled} onCheckedChange={(checked) => change("visitScheduleEnabled", checked === true)} />Cấu hình lịch đặt thăm kho cho khách</label>
                {form.visitScheduleEnabled && <div className="mt-3 space-y-3">
                  <Field label="Thời lượng khung thăm" hint="30–480 phút, theo bước 15 phút.">
                    <Select label="Thời lượng khung thăm" value={String(form.visitScheduleDraft.slotDurationMinutes)} onChange={(value) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, slotDurationMinutes: Number(value) } }))} options={Array.from({ length: 31 }, (_, index) => String(30 + index * 15))} />
                  </Field>
                  {form.visitScheduleDraft.weeklyHours.map((day, index) => <div key={day.weekday} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                    <label className="flex items-center gap-2 text-sm"><Checkbox aria-label={`${WEEKDAYS[day.weekday]} có lịch thăm`} checked={day.enabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, enabled: checked === true } : entry) } }))} />{WEEKDAYS[day.weekday]}</label>
                    <Field label={`${WEEKDAYS[day.weekday]} mở`}><Input aria-label={`${WEEKDAYS[day.weekday]} mở`} type="time" disabled={!day.enabled} value={day.opensAt} onChange={(event) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, opensAt: event.target.value } : entry) } }))} /></Field>
                    <Field label={`${WEEKDAYS[day.weekday]} đóng`}><Input aria-label={`${WEEKDAYS[day.weekday]} đóng`} type="time" disabled={!day.enabled} value={day.closesAt} onChange={(event) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, closesAt: event.target.value } : entry) } }))} /></Field>
                  </div>)}
                </div>}
              </div>}
              <Field label="Trạng thái hoạt động">
                <Select label="Trạng thái hoạt động" value={form.status} onChange={(v) => change("status", v)} options={["ACTIVE", "INACTIVE"]} />
              </Field>
              <Field label="Số điện thoại liên hệ">
                <Input aria-label="Số điện thoại liên hệ" value={form.contactPhone || ""} onChange={(e) => change("contactPhone", e.target.value)} />
              </Field>
              <Field label="Email liên hệ" hint="Không bắt buộc.">
                <Input aria-label="Email liên hệ" type="email" value={form.contactEmail || ""} onChange={(e) => change("contactEmail", e.target.value)} />
              </Field>
              <Field label="Mô hình dịch vụ" hint="Cần chọn ít nhất một mô hình dịch vụ.">
                <div className="flex flex-wrap gap-4 py-2">
                  {BOM_SERVICE_TYPES.map((service) => (
                    <label key={service} className="flex items-center gap-2 text-sm">
                      <Checkbox aria-label={service} checked={form.serviceTypes.includes(service)} onCheckedChange={() => toggleService(service)} />
                      {serviceLabel(service)}
                    </label>
                  ))}
                </div>
              </Field>
              <ImageEditor
                label="Hình ảnh cơ sở"
                target="facility"
                images={form.images}
                onChange={(next) => setForm((f) => ({ ...f, images: next }))}
              />
              <div className="bom-wide">
                <Field label="Mô tả">
                  <Textarea aria-label="Mô tả" value={form.description} onChange={(e) => change("description", e.target.value)} />
                </Field>
                {form.status === "INACTIVE" && (
                  <p className="bom-warning mb-5">Cơ sở đang ngừng hoạt động nên không nhận đơn mới.</p>                )}
                {error && <p role="alert" className="bom-error">{error}</p>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : isEdit ? "Lưu cơ sở" : "Tạo cơ sở"}</Button>
                  <Button type="button" variant="outline" onClick={() => nav(backTo)}>Hủy</Button>
                </div>
              </div>
            </form>
          </Panel>
        )}
      />
    </Screen>
  );
}
