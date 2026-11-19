import {
  useInventoryMapPreference,
  InventoryMapContext,
  InventoryCellPreference,
} from "../inventory/InventoryMapPreference";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowUp,
  Boxes,
  CalendarRange,
  CheckCircle2,
  Grid2X2,
  ShieldAlert,
  Wrench,
  Layers,
  Map as MapIcon,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import warehouseMapApi from "@/api/warehouseMapApi";
import facilityApi from "@/api/facilityApi";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import {
  useBackend,
  record,
  validId,
} from "@/components/customer/RentalBackendUI";
import {
  validateRackDetail,
  warehouseAxis,
  weightText,
  measurementText,
} from "@/lib/warehouseMap";
import { availableCellCount } from "@/lib/managedBookingDisplay";
import WarehouseCells, {
  CellInformation,
  WarehouseStatus,
} from "./CellInformation";
import { useManagedCellBooking, BookingPeriodFields, CellBookingPanel } from "./ManagedCellBooking";
import "./warehouse-dashboard.css";
// All business-state values still come from the existing map/booking hooks.
// A missing counter stays missing; it is not converted to zero.
// Date-only booking values are formatted without timezone conversion.
function rentalDateLabel(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Chưa xác định";
}

const STAT_APPEARANCE = [
  { Icon: Layers, tone: "neutral", hint: "Khu vực trong kho" },
  { Icon: Boxes, tone: "neutral", hint: "Kệ hàng đã tải" },
  { Icon: Grid2X2, tone: "neutral", hint: "Ô lưu trữ" },
  { Icon: CheckCircle2, tone: "success", hint: "Số ô còn khả dụng" },
  { Icon: ShieldAlert, tone: "danger", hint: "Chưa có số liệu tổng hợp" },
  { Icon: Wrench, tone: "warning", hint: "Chưa có số liệu tổng hợp" },
];
function ResourceState({ resource, onRetry }) {
  return (
    <>
      {resource.loading && (
        <div role="status" className="wm-skeleton">
          Đang tải sơ đồ kho…
          <div />
          <div />
        </div>
      )}
      {resource.error && (
        <div role="alert" className="wm-error">
          <p>{resource.error}</p>
          <Button
            className="wm-button"
            variant="outline"
            size="sm"
            onClick={onRetry || resource.retry}
          >
            Thử lại
          </Button>
        </div>
      )}
    </>
  );
}
function RackInformation({ data, facilityId, itemId }) {
  const [params] = useSearchParams(),
    contextQuery = new URLSearchParams(params);
  if (itemId) contextQuery.set("inventoryItem", itemId);
  const { rack, capacity } = data,
    capacityRedacted = capacity?.disclosure === "REDACTED",
    utilizationLabels = { EMPTY: "Chưa sử dụng", PARTIAL: "Đang sử dụng", NEAR_FULL: "Gần đầy", FULL: "Đã đầy", UNKNOWN: "Chưa xác minh" },
    capacitySourceLabels = { WAREHOUSE_CELL_COUNTERS: "Bộ đếm dung lượng của các ô" },
    fields = [
      ["Khu vực", rack.zoneCode],
      ["Lối đi", rack.aisleCode],
      ["Chiều rộng", measurementText(rack.dimensions?.widthM)],
      ["Chiều sâu", measurementText(rack.dimensions?.depthM)],
      ["Chiều cao danh nghĩa", measurementText(rack.dimensions?.heightM)],
      ["Hướng đặt kệ", rack.orientation == null ? null : `${rack.orientation}°`],
      ["Tải trọng thiết kế", capacityRedacted ? null : weightText(capacity.ratedCapacityKg)],
      ["Tải trọng có thể phân bổ", capacityRedacted ? null : weightText(capacity.allocatableCapacityKg)],
      ["Số tầng", data.levels.length],
      ["Số ô lưu trữ", data.levels.reduce((n, l) => n + l.cells.length, 0)],
      [
        "Khối lượng đang sử dụng",
        capacityRedacted || capacity.usedWeightKg == null
          ? null
          : weightText(capacity.usedWeightKg),
      ],
      ["Mức sử dụng tải trọng", capacityRedacted ? null : utilizationLabels[capacity.utilizationStatus] || "Chưa xác minh"],
      ["Nguồn số liệu", capacityRedacted ? null : capacitySourceLabels[capacity.source] || "Chưa xác định"],
    ];
  return (
    <>
      <div className="wm-info-heading">
        <strong>{rack.rackCode}</strong>
        <WarehouseStatus status={rack.operationalStatus} />
      </div>
      <dl className="wm-definition">
        {fields
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <Link
        className="wm-inline-link"
        to={`/portal/warehouse-map/${facilityId}/racks/${rack._id}${contextQuery.size ? `?${contextQuery}` : ""}`}
      >
        Mở trang chi tiết kệ
      </Link>
    </>
  );
}
const ZonePlane = memo(function ZonePlane({
  zone,
  active,
  rackId,
  onSelect,
  registerZone,
  onSelectZone,
}) {
  const racks = useMemo(() => zone.aisles.flatMap((a) => a.racks), [zone]),
    x = useMemo(() => warehouseAxis(racks.map((r) => r.mapX)), [racks]),
    y = useMemo(() => warehouseAxis(racks.map((r) => r.mapY)), [racks]);
  const zoneRef = useCallback(
    (node) => registerZone(zone._id, node),
    [zone._id, registerZone],
  );
  return (
    <section
      ref={zoneRef}
      className={`wm-zone ${active ? "is-active" : ""}`}
      aria-label={`Khu vực ${zone.code}`}
    >
      <div className="wm-zone-heading">
        <h3><button type="button" onClick={() => onSelectZone(zone._id)} aria-label={`Mở khu vực ${zone.code}`}>{zone.code}</button></h3>
        <span>{zone.name}</span>
      </div>
      {!racks.length ? (
        <p className="wm-muted">Khu vực này chưa có kệ.</p>
      ) : (
        <div
          className="wm-rack-grid"
          style={{
            gridTemplateColumns: `repeat(${x.count}, 168px)`,
            gridTemplateRows: `repeat(${y.count}, minmax(158px, auto))`,
          }}
        >
          {zone.aisles.map((aisle) => (
            <div
              className="wm-aisle-group"
              role="group"
              aria-label={`Lối đi ${aisle.aisleCode}`}
              key={aisle.aisleCode}
            >
              {aisle.racks.map((rack) => (
                <button
                  type="button"
                  key={rack._id}
                  aria-label={`Chọn kệ ${rack.rackCode}, lối đi ${aisle.aisleCode}`}
                  aria-pressed={rackId === rack._id}
                  data-rack-id={rack._id}
                  className={`wm-rack ${rackId === rack._id ? "is-selected" : ""}`}
                  style={{
                    gridColumn: x.positions.get(rack.mapX),
                    gridRow: y.positions.get(rack.mapY),
                  }}
                  onClick={() => onSelect(rack._id)}
                >
                  <span
                    className="wm-rack-symbol"
                    aria-hidden="true"
                    style={{ transform: `rotate(${rack.orientation}deg)` }}
                  >
                    <ArrowUp size={19} />
                  </span>
                  <strong>{rack.rackCode}</strong>
                  <WarehouseStatus status={rack.operationalStatus} />
                  <small>Lối đi {aisle.aisleCode}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
export default function DigitalWarehouseDashboard(props) {
  const { accessToken } = useAuthSession();
  return (
    <Dashboard
      key={`${props.facilityId}:${accessToken}`}
      {...props}
      token={accessToken}
    />
  );
}
function Dashboard({ facilityId, map, initialRackId, token }) {
  const [bookingSearch] = useSearchParams();
  const booking = useManagedCellBooking(facilityId);
  const inventory = useInventoryMapPreference(facilityId);
  const root = useRef(null),
    viewport = useRef(null),
    zones = useRef(new Map()),
    cache = useRef(new Map()),
    drag = useRef(null),
    pendingZone = useRef(null);
  const [rackId, setRackId] = useState(initialRackId || ""),
    [view, setView] = useState(initialRackId ? "rack-detail" : "floorplan"),
    [cell, setCell] = useState(null),
    [zoneId, setZoneId] = useState(""),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState("");
  const [sidebar, setSidebar] = useState(false),
    [drawer, setDrawer] = useState(false),
    [bookingDrawer, setBookingDrawer] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [bookingExpanded, setBookingExpanded] = useState(true),
    [expanded, setExpanded] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [fullscreenError, setFullscreenError] = useState(""),
    [updated, setUpdated] = useState(null),
    [myInventoryOnly, setMyInventoryOnly] = useState(false);
  const facility = useBackend(
    (config) =>
      validId(facilityId)
        ? facilityApi.publicDetail(facilityId, config).then(record)
        : Promise.resolve(null),
    [facilityId],
    true,
  );
  const detail = useBackend(
    async (config) => {
      if (!rackId) return null;
      if (!validId(facilityId) || !validId(rackId))
        throw Error("Invalid facility or rack ID.");
      const cacheKey = JSON.stringify([
        facilityId,
        rackId,
        booking.rangeKey,
        token,
      ]);
      if (cache.current.has(cacheKey)) return cache.current.get(cacheKey);
      const result = validateRackDetail(
        record(
          await warehouseMapApi.getRackDetailMap(
            rackId,
            config,
            booking.period.range,
          ),
        ),
        facilityId,
        rackId,
      );
      if (!config.signal.aborted && getAccessToken() === token)
        cache.current.set(cacheKey, result);
      return result;
    },
    [facilityId, rackId, booking.rangeKey],
  );
  useEffect(() => {
    setRackId(initialRackId || "");
    setView(initialRackId ? "rack-detail" : "floorplan");
    setCell(null);
  }, [initialRackId]);
  useEffect(() => {
    setCell(null);
  }, [detail.data]);
  useEffect(() => {
    if (rackId && map.data) {
      const zone = map.data.zones.find((z) =>
        z.aisles.some((a) => a.racks.some((r) => r._id === rackId)),
      );
      if (zone) setZoneId(zone._id);
    }
  }, [rackId, map.data]);
  useEffect(() => {
    if (map.data) setUpdated(new Date());
  }, [map.data]);
  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === root.current);
    const escape = (e) => {
      if (e.key === "Escape") {
        // Do not override dialogs: the shared Dialog component owns Escape.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setCell(null);
        setDrawer(false);
        setSidebar(false);
        setBookingDrawer(false);
        setExpanded(false);
      }
    };
    document.addEventListener("fullscreenchange", change);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const allRacks = useMemo(
    () =>
      map.data?.zones.flatMap((z) => z.aisles.flatMap((a) => a.racks)) || [],
    [map.data],
  );
  const statistics = useMemo(() => {
    const sum = (key) =>
      allRacks.every((r) => Number.isInteger(r[key]) && r[key] >= 0)
        ? allRacks.reduce((n, r) => n + r[key], 0)
        : null;
    const period = Boolean(booking.period.range);
    return [
      ["Khu vực", map.data?.zones.length],
      ["Kệ hàng", map.data ? allRacks.length : null],
      ["Tổng số ô", map.data ? sum("cellCount") : null],
      [
        period ? "Trống trong kỳ thuê" : "Đang khả dụng",
        map.data ? availableCellCount(allRacks, period) : null,
      ],
      ["Ô bị khóa", null],
      ["Ô bảo trì", null],
    ];
  }, [map.data, allRacks, booking.rangeKey]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return map.data?.zones || [];
    return (map.data?.zones || [])
      .map((zone) => {
        const zoneMatch = `${zone.code} ${zone.name || ""}`
          .toLowerCase()
          .includes(q);
        return {
          ...zone,
          aisles: zone.aisles
            .map((aisle) => ({
              ...aisle,
              racks: aisle.racks.filter(
                (r) =>
                  zoneMatch ||
                  aisle.aisleCode.toLowerCase().includes(q) ||
                  String(r.rackCode).toLowerCase().includes(q) ||
                  cache.current
                    .get(
                      JSON.stringify([
                        facilityId,
                        r._id,
                        booking.rangeKey,
                        token,
                      ]),
                    )
                    ?.levels.some((l) =>
                      l.cells.some((c) =>
                        String(c.code || `C${c.cellNumber}`)
                          .toLowerCase()
                          .includes(q),
                      ),
                    ),
              ),
            }))
            .filter((a) => a.racks.length),
        };
      })
      .filter(
        (z) =>
          z.aisles.length ||
          `${z.code} ${z.name || ""}`.toLowerCase().includes(q),
      );
  }, [map.data, query, detail.data, booking.rangeKey]);
  const registerZone = useCallback((id, node) => {
    if (node) zones.current.set(id, node);
    else zones.current.delete(id);
  }, []);
  const selectRack = useCallback((id) => {
    setView("rack-detail");
    if (innerWidth < 1200) setSidebar(false);
    setRackId(id);
    setCell(null);
    setDrawer(false);
  }, []);
  const scrollZone = (id) =>
    zones.current
      .get(id)
      ?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
        inline: "nearest",
      });
  const selectZone = (id) => {
    setZoneId(id);
    setView('rack-detail');
    if (innerWidth < 1200) setSidebar(false);
    if (!filtered.some(zone => zone._id === id)) setQuery('');
    setCell(null); setDrawer(false);
    const racks = map.data?.zones.find(zone => zone._id === id)?.aisles.flatMap(aisle => aisle.racks) || [];
    setRackId(racks.length === 1 ? racks[0]._id : '');
  };
  useEffect(() => {
    if (pendingZone.current && zones.current.has(pendingZone.current)) {
      scrollZone(pendingZone.current);
      pendingZone.current = null;
    }
  }, [filtered]);
  const centralScroll = useRef(null);
  useEffect(() => { if (centralScroll.current) centralScroll.current.scrollTop = 0; }, [view, rackId, zoneId]);
  const activeZone = map.data?.zones.find(zone => zone._id === zoneId);
  const zoneRacks = activeZone?.aisles.flatMap(aisle => aisle.racks) || [];
  const refresh = () => {
    if (map.loading || detail.loading) return;
    cache.current.clear();
    setCell(null);
    map.retry();
    detail.retry();
    booking.refresh();
  };
  useEffect(() => {
    const invalidate = () => {
      cache.current.clear();
      map.retry();
      detail.retry();
      booking.refresh();
    };
    window.addEventListener("vaultspace:map-refresh", invalidate);
    window.addEventListener("focus", invalidate);
    return () => {
      window.removeEventListener("vaultspace:map-refresh", invalidate);
      window.removeEventListener("focus", invalidate);
    };
  }, [booking.rangeKey, rackId]);
  async function toggleFullscreen() {
    setFullscreenError("");
    if (fullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        setFullscreenError("Không thể thoát chế độ toàn màn hình. Hãy nhấn phím Esc.");
      }
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    try {
      if (!root.current?.requestFullscreen) throw Error();
      await root.current.requestFullscreen();
    } catch {
      setExpanded(true);
      setFullscreenError(
        "Trình duyệt không hỗ trợ toàn màn hình. Đã mở rộng khu vực bản đồ.",
      );
    }
  }
  const periodReady = Boolean(booking.period.range && !booking.startError);
  const information = (
    <>
      <div className="wm-section-heading">
        <h2>{cell ? "Thông tin ô" : "Thông tin kệ"}</h2>
        {cell && (
          <Button
            className="wm-button"
            variant="outline"
            size="sm"
            onClick={() => setCell(null)}
          >
            Bỏ chọn xem ô
          </Button>
        )}
      </div>
      {!rackId ? null : (
        <>
          {!map.error && <ResourceState resource={detail} />}
          {!map.error &&
            !detail.loading && detail.data?.rack._id === rackId &&
            (cell ? (
              <>
                <CellInformation
                  cell={cell.cell}
                  level={cell.level}
                  rack={detail.data.rack}
                  requestedPeriod={periodReady}
                />
                <InventoryCellPreference
                  controller={inventory}
                  cell={cell.cell}
                  rack={detail.data.rack}
                />
              </>
            ) : (
              <RackInformation
                data={detail.data}
                facilityId={facilityId}
                itemId={inventory.itemId}
              />
            ))}
        </>
      )}
    </>
  );
  const portalTarget = document.fullscreenElement || document.body;
  return (
    <div
      ref={root}
      className={`warehouse-dashboard ${expanded ? "wm-expanded" : ""} ${sidebarCollapsed ? "wm-sidebar-collapsed" : ""} ${bookingExpanded ? "" : "wm-booking-collapsed"}`}
    >
      <header className="wm-header">
        <div className="wm-header-intro">
          <span className="wm-header-eyebrow">VAULTSPACE / SƠ ĐỒ KHO</span>
          <h1>Sơ đồ kho trực quan</h1>
          <p className="wm-facility">{facility.data?.name || facilityId}</p>
          {facility.loading && (
            <small role="status">Đang tải thông tin cơ sở…</small>
          )}
          {facility.error && (
            <small role="status">
              Chưa tải được tên cơ sở. Quyền xem bản đồ vẫn do hệ thống xác minh.
            </small>
          )}
        </div>
        <div className="wm-header-actions">
          <Button asChild variant="outline" className="wm-button">
            <Link
              to={
                initialRackId
                  ? `/portal/warehouse-map/${facilityId}${bookingSearch.size ? `?${bookingSearch}` : ""}`
                  : "/portal/warehouse-map"
              }
            >
              <ArrowLeft size={15} />
              {initialRackId
                ? "Về sơ đồ kho"
                : "Chọn kho khác"}
            </Link>
          </Button>
          <Button
            variant="outline"
            className="wm-button"
            disabled={map.loading || detail.loading}
            onClick={refresh}
          >
            <RefreshCw size={15} />
            Làm mới
          </Button>
        </div>
      </header>
      {fullscreenError && (
        <p role="status" className="wm-notice">
          {fullscreenError}
        </p>
      )}
      <div className="wm-stats" aria-label="Thống kê kho">
        {statistics.map(([label, value], index) => {
          const { Icon, tone, hint } = STAT_APPEARANCE[index];
          return (
            <div className={`wm-stat wm-stat--${tone}`} key={label}>
              <span className="wm-stat-icon" aria-hidden="true"><Icon size={19} /></span>
              <p>{label}</p>
              <strong className={value == null ? "wm-stat-unknown" : ""}>
                {value == null ? "—" : value.toLocaleString()}
              </strong>
              <small>{value == null ? "Chưa có dữ liệu" : hint}</small>
            </div>
          );
        })}
      </div>
      <div className="wm-mobile-tools">
        <Button
          className="wm-button"
          variant="outline"
          onClick={() => { setBookingDrawer(false); setSidebar((value) => !value); }}
          aria-expanded={sidebar}
          aria-controls="wm-zone-sidebar"
        >
          <PanelLeftOpen size={16} aria-hidden="true" />
          Khu vực kho
        </Button>
        <Button
          className="wm-button"
          variant="outline"
          onClick={() => { setSidebar(false); setBookingExpanded(true); setBookingDrawer(true); }}
          aria-expanded={bookingDrawer}
          aria-controls="wm-booking-sidebar"
        >
          <CalendarRange size={16} aria-hidden="true" />
          Thời gian thuê
        </Button>
        {rackId && (
          <Button
            className="wm-button"
            variant="outline"
            onClick={() => setDrawer(true)}
          >
            Xem chi tiết
          </Button>
        )}
      </div>
      <div className="wm-dashboard-columns">
        {sidebar && (
          <button
            type="button"
            className="wm-sidebar-backdrop"
            aria-label="Đóng bảng khu vực kho"
            onClick={() => setSidebar(false)}
          />
        )}
        <aside
          id="wm-zone-sidebar"
          className={`wm-zone-sidebar wm-panel ${sidebar ? "wm-sidebar-open" : ""} ${sidebarCollapsed ? "wm-is-collapsed" : ""}`}
          aria-label="Khu vực kho"
        >
          <div className="wm-sidebar-heading">
            <h2><Layers size={17} aria-hidden="true" /><span>Khu vực kho</span></h2>
            <button
              type="button"
              className="wm-sidebar-toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Mở rộng khu vực kho" : "Thu gọn khu vực kho"}
              title={sidebarCollapsed ? "Mở rộng khu vực kho" : "Thu gọn khu vực kho"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="wm-sidebar-content"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button
              type="button"
              className="wm-mobile-sidebar-close"
              aria-label="Đóng khu vực kho"
              onClick={() => setSidebar(false)}
            >
              <X size={19} />
            </button>
          </div>
          <div id="wm-sidebar-content" className="wm-sidebar-content">
            <div className="wm-search-wrap">
              <Search size={17} aria-hidden="true" />
              <Input
                className="wm-search"
                aria-label="Tìm khu, dãy, kệ hoặc ô"
                placeholder="Tìm khu, kệ hoặc ô..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="wm-search-clear"
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa tìm kiếm"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <p className="wm-muted">
              Chỉ tìm trên dữ liệu đã tải. Chọn một kệ để tải các ô của kệ đó.
            </p>
            <div className="wm-zone-list">
              {(map.data?.zones || []).map((zone, index) => (
                <button
                  type="button"
                  key={zone._id}
                  aria-pressed={zoneId === zone._id}
                  onClick={() => selectZone(zone._id)}
                  className={zoneId === zone._id ? "is-active" : ""}
                >
                  <span className={`wm-zone-dot wm-zone-dot-${index % 4}`} />
                  <span>
                    <strong>{zone.code}</strong>
                    {zone.name && <small>{zone.name}</small>}
                    <small>
                      {zone.aisles.reduce((n, a) => n + a.racks.length, 0)} kệ
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="wm-legend">
              <h3>Trạng thái ô lưu trữ</h3>
              {[
                "AVAILABLE",
                "RESERVED",
                "OCCUPIED",
                "BLOCKED",
                "MAINTENANCE",
              ].map((status) => (
                <button type="button" key={status} className="wm-status-filter" aria-label={`Lọc ô lưu trữ theo trạng thái ${status}`} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(current => current === status ? '' : status)}>
                  <WarehouseStatus status={status} />
                </button>
              ))}
              {statusFilter && <button type="button" className="wm-clear-status-filter" onClick={() => setStatusFilter('')}>Xóa bộ lọc</button>}
            </div>
            <div className="wm-inventory-context-slot"><InventoryMapContext controller={inventory} /></div>
          </div>
        </aside>
        <section
          className="wm-center wm-panel"
          aria-label="Sơ đồ kho"
        >
          <div className="wm-section-heading">
            {view === 'floorplan' ? <span>Chọn kệ để xem các ô lưu trữ</span> : <Button className="wm-button" variant="outline" onClick={() => { setView('floorplan'); setDrawer(false); }}>← Trở về sơ đồ</Button>}
          </div>
          <div hidden={view !== "floorplan"} className="wm-floorplan-view">
            <ResourceState resource={map} />
            {map.data && !allRacks.length && (
              <p className="wm-map-empty">
                Cơ sở này chưa có sơ đồ kho.
              </p>
            )}
            {map.data && allRacks.length > 0 && (
              <>
                <div
                  className="wm-map-viewport"
                  ref={viewport}
                  role="region"
                  aria-label="Sơ đồ kho tương tác"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    if (
                      e.pointerType !== "mouse" ||
                      e.button !== 0 ||
                      e.target.closest("button,a,input")
                    )
                      return;
                    e.preventDefault();
                    drag.current = {
                      x: e.clientX,
                      y: e.clientY,
                      left: e.currentTarget.scrollLeft,
                      top: e.currentTarget.scrollTop,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.currentTarget.classList.add("is-panning");
                  }}
                  onPointerMove={(e) => {
                    if (drag.current) {
                      e.currentTarget.scrollLeft =
                        drag.current.left + drag.current.x - e.clientX;
                      e.currentTarget.scrollTop =
                        drag.current.top + drag.current.y - e.clientY;
                    }
                  }}
                  onPointerUp={(e) => {
                    drag.current = null;
                    e.currentTarget.classList.remove("is-panning");
                  }}
                  onLostPointerCapture={(e) => {
                    drag.current = null;
                    e.currentTarget.classList.remove("is-panning");
                  }}
                >
                  <div
                    className="wm-zoom-surface"
                  >
                    <div
                      className="wm-floor"
                    >
                      {filtered.map((zone) => (
                        <ZonePlane
                          key={zone._id}
                          zone={zone}
                          active={zoneId === zone._id}
                          rackId={
                            zone.aisles.some((a) =>
                              a.racks.some((r) => r._id === rackId),
                            )
                              ? rackId
                              : ""
                          }
                          onSelect={selectRack}
                          registerZone={registerZone}
                          onSelectZone={selectZone}
                        />
                      ))}
                      {!filtered.length && (
                        <p className="wm-map-empty">
                          Không có kệ hoặc ô nào khớp với tìm kiếm.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {view === 'rack-detail' && <div className="wm-drilldown-content" ref={centralScroll}>
            <ResourceState resource={map} />
            {!map.error && activeZone && zoneRacks.length !== 1 && <div className="wm-rack-picker"><p>{zoneRacks.length ? 'Chọn kệ trong khu vực này:' : 'Khu vực này chưa có kệ.'}</p>{zoneRacks.map(rack => <Button key={rack._id} type="button" className="wm-button" variant="outline" aria-pressed={rackId === rack._id} onClick={() => selectRack(rack._id)}>{rack.rackCode}</Button>)}</div>}
            {rackId && (
              <div className="wm-selected-rack wm-cells-v4">
                <div className="wm-rack-inline-state">
                  {!map.error && <ResourceState resource={detail} />}
                </div>
                {!map.error && !detail.loading && detail.data?.rack._id === rackId && (
                  <>
                    <details className="wm-context-details">
                      <summary><span className="wm-context-summary-copy"><strong>Chi tiết kệ · {detail.data.rack.rackCode}</strong><small>Thông số kệ, sức chứa và bố trí ô</small></span><span className="wm-context-summary-hint">Mở / thu gọn</span></summary>
                      <RackInformation data={detail.data} facilityId={facilityId} itemId={inventory.itemId} />
                    </details>
                    {cell ? <details className="wm-context-details wm-cell-context-details">
                      <summary><span className="wm-context-summary-copy"><strong>Chi tiết ô · {cell.cell.code || `Ô ${cell.cell.cellNumber}`}</strong><small>Thông số, sức chứa và tồn kho được phép xem</small></span><span className="wm-context-summary-hint">Mở / thu gọn</span></summary>
                      <CellInformation cell={cell.cell} level={cell.level} rack={detail.data.rack} />
                      <InventoryCellPreference controller={inventory} cell={cell.cell} rack={detail.data.rack} />
                    </details> : <section className="wm-cell-detail-empty" aria-live="polite"><strong>Chi tiết ô lưu trữ</strong><p>Chọn một ô trên sơ đồ bên dưới để xem thông tin chi tiết.</p></section>}
                    <WarehouseCells
                      key={`${rackId}:${updated?.getTime() || 0}`}
                      data={detail.data}
                      selected={cell}
                      query={query}
                      statusFilter={statusFilter}
                      onClearStatusFilter={() => setStatusFilter('')}
                      booking={booking}
                      onSelect={setCell}
                    />
                  </>
                )}
              </div>
            )}
          </div>}
          <div className="wm-checkout-dock wm-v5-checkout-dock" role="region" aria-label="Giỏ thuê & xác nhận">
            <CellBookingPanel
              booking={booking}
              facilityId={facilityId}
              facilityName={facility.data?.name}
              compact
            />
          </div>
        </section>
        {bookingDrawer && (
          <button
            type="button"
            className="wm-booking-backdrop"
            aria-label="Đóng bảng thời gian thuê"
            onClick={() => setBookingDrawer(false)}
          />
        )}
        <aside
          id="wm-booking-sidebar"
          className={`wm-booking-sidebar wm-panel ${bookingDrawer ? "wm-booking-mobile-open" : ""}`}
          aria-label="Thiết lập thuê ô lưu trữ"
        >
          <div className="wm-booking-sidebar-heading">
            <span className="wm-booking-side-icon" aria-hidden="true">
              <CalendarRange size={20} />
            </span>
            <div className="wm-booking-side-heading-text">
              <span className="wm-booking-side-eyebrow">THUÊ Ô LƯU TRỮ · 3 BƯỚC</span>
              <h2>Chọn ngày → Chọn ô → Đặt thuê</h2>
            </div>
            <button
              type="button"
              className="wm-booking-side-toggle"
              onClick={() => setBookingExpanded((value) => !value)}
              aria-expanded={bookingExpanded}
              aria-controls="wm-booking-period-fields"
              aria-label={bookingExpanded ? "Thu gọn bảng thuê ô về bên phải" : "Mở rộng bảng thuê ô"}
              title={bookingExpanded ? "Thu gọn sang phải" : "Mở bảng thuê ô"}
            >
              {bookingExpanded ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
            </button>
            <button
              type="button"
              className="wm-booking-mobile-close"
              aria-label="Đóng bảng thuê ô"
              onClick={() => setBookingDrawer(false)}
            >
              <X size={19} />
            </button>
          </div>
          <div
            className="wm-booking-sidebar-content"
            id="wm-booking-period-fields"
            hidden={!bookingExpanded}
          >
            <p className="wm-booking-side-help">Thiết lập thời gian thuê, sau đó chọn ô trực tiếp trên sơ đồ.</p>
            <BookingPeriodFields booking={booking} />
            <div className="wm-booking-side-summary" aria-live="polite">
              <span>Thời gian thuê</span>
              <strong>
                {periodReady
                  ? `${rentalDateLabel(booking.period.range.startDate)} – ${rentalDateLabel(booking.period.range.endDate)}`
                  : "Chưa chọn ngày thuê"}
              </strong>
              <div className="wm-booking-side-count">
                <span>Ô đã chọn</span>
                <strong>{booking.selection.length}</strong>
              </div>
              {periodReady && <small className="wm-booking-side-ready">Kỳ thuê hợp lệ</small>}
              {booking.startError && <small role="alert" className="wm-booking-side-error">{booking.startError}</small>}
            </div>
            <p className="wm-booking-side-footer">
              Sau khi chọn ô, nhấn <strong>Xem báo giá & đặt thuê</strong> trong giỏ bên dưới sơ đồ.
            </p>
          </div>
          {!bookingExpanded && (
            <div
              className="wm-booking-side-rail"
              title={periodReady ? `${rentalDateLabel(booking.period.range.startDate)} – ${rentalDateLabel(booking.period.range.endDate)}` : "Chưa chọn ngày thuê"}
            >
              <span>Thời gian thuê</span>
              <strong>{booking.selection.length} ô</strong>
            </div>
          )}
        </aside>
      </div>
      {drawer &&
        createPortal(
          <section
            role="dialog"
            aria-modal="false"
            aria-label="Chi tiết cấu trúc đã chọn"
            className="warehouse-detail-drawer"
          >
            <Button
              className="wm-drawer-close"
              variant="outline"
              size="icon"
              aria-label="Đóng phần chi tiết"
              onClick={() => setDrawer(false)}
            >
              <X size={18} />
            </Button>
            {information}
          </section>,
          portalTarget,
        )}
    </div>
  );
}
