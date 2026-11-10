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
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
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
import WarehouseBreadcrumbs from "@/components/customer/WarehouseBreadcrumbs";
import WarehouseCells, {
  CellInformation,
  WarehouseStatus,
} from "./CellInformation";
import { useManagedCellBooking, BookingPeriodFields, CellBookingPanel } from "./ManagedCellBooking";
import "./warehouse-dashboard.css";
// All business-state values still come from the existing map/booking hooks.
// A missing counter stays missing; it is not converted to zero.
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
          Loading warehouse structure…
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
            Retry
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
    fields = [
      ["Zone", rack.zoneCode],
      ["Aisle", rack.aisleCode],
      ["Width", measurementText(rack.dimensions?.widthM)],
      ["Depth", measurementText(rack.dimensions?.depthM)],
      ["Nominal height", measurementText(rack.dimensions?.heightM)],
      ["Orientation", rack.orientation == null ? null : `${rack.orientation}°`],
      ["Rated capacity", weightText(capacity.ratedCapacityKg)],
      ["Allocatable capacity", weightText(capacity.allocatableCapacityKg)],
      ["Returned levels", data.levels.length],
      ["Returned cells", data.levels.reduce((n, l) => n + l.cells.length, 0)],
      [
        "Physical used weight",
        capacity.usedWeightKg == null
          ? null
          : weightText(capacity.usedWeightKg),
      ],
      ["Weight utilization", capacity.utilizationStatus],
      ["Source", capacity.source],
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
      <p className="wm-baseline-note">
        Nominal rack height is not measured usable cell clearance. Usage is
        returned from warehouse counters; rental allocation is separate.
      </p>
      <Link
        className="wm-inline-link"
        to={`/portal/warehouse-map/${facilityId}/racks/${rack._id}${contextQuery.size ? `?${contextQuery}` : ""}`}
      >
        Xem chi tiết kệ
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
      aria-label={`Zone ${zone.code}`}
    >
      <div className="wm-zone-heading">
        <h3><button type="button" onClick={() => onSelectZone(zone._id)} aria-label={`Open zone ${zone.code}`}>{zone.code}</button></h3>
        <span>{zone.name}</span>
      </div>
      {!racks.length ? (
        <p className="wm-muted">No racks are available in this zone yet.</p>
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
              aria-label={`Aisle ${aisle.aisleCode}`}
              key={aisle.aisleCode}
            >
              {aisle.racks.map((rack) => (
                <button
                  type="button"
                  key={rack._id}
                  aria-label={`Select rack ${rack.rackCode}, aisle ${aisle.aisleCode}`}
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
                  <small>Aisle {aisle.aisleCode}</small>
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
    floor = useRef(null),
    zones = useRef(new Map()),
    cache = useRef(new Map()),
    drag = useRef(null),
    floorScroll = useRef({ left: 0, top: 0 }),
    pendingZone = useRef(null);
  const [rackId, setRackId] = useState(initialRackId || ""),
    [view, setView] = useState(initialRackId ? "rack-detail" : "floorplan"),
    [cell, setCell] = useState(null),
    [zoneId, setZoneId] = useState(""),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [zoom, setZoom] = useState(1),
    [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [sidebar, setSidebar] = useState(false),
    [drawer, setDrawer] = useState(false),
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
  useEffect(() => {
    if (!floor.current) return;
    const measure = () => {
      if (!floor.current?.offsetWidth) return;
      setBounds({
        width: floor.current?.offsetWidth || 1,
        height: floor.current?.offsetHeight || 1,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(floor.current);
    measure();
    return () => observer.disconnect();
  }, [map.data, query]);
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
    if (viewport.current?.getClientRects().length) floorScroll.current = { left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
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
    if (viewport.current?.getClientRects().length) floorScroll.current = { left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
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
  useEffect(() => { if (view !== "floorplan") return; const frame = requestAnimationFrame(() => viewport.current?.scrollTo(floorScroll.current)); return () => cancelAnimationFrame(frame); }, [view]);
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
  const reset = () => {
    setZoom(1);
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  };
  async function toggleFullscreen() {
    setFullscreenError("");
    if (fullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        setFullscreenError("Unable to exit fullscreen. Use Escape.");
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
        "Browser fullscreen is unavailable. Expanded dashboard view is enabled.",
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
      {!rackId ? (
        <div className="wm-empty-inspector">
          <Boxes size={34} />
          <p>Chọn một kệ hoặc ô trên sơ đồ để xem thông tin.</p>
        </div>
      ) : (
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
      className={`warehouse-dashboard ${expanded ? "wm-expanded" : ""}`}
    >
      <header className="wm-header">
        <div className="wm-header-intro">
          <span className="wm-header-eyebrow">VAULTSPACE / SƠ ĐỒ KHO</span>
          <h1>Sơ đồ kho trực quan</h1>
          <p className="wm-facility">{facility.data?.name || facilityId}</p>
          {facility.loading && (
            <small role="status">Loading facility context…</small>
          )}
          {facility.error && (
            <small role="status">
              Facility name unavailable. Map access is checked separately by the
              backend.
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
            Refresh
          </Button>
        </div>
      </header>
      {/* Thanh chọn kỳ thuê luôn hiện; không cần mở/đóng dialog để nhập ngày. */}
      <section className="wm-booking-hero wm-v5-booking-hero" aria-labelledby="wm-booking-hero-title">
        <div className="wm-v5-booking-intro">
          <span className="wm-booking-hero-symbol" aria-hidden="true"><CalendarRange size={21} /></span>
          <div>
            <span className="wm-booking-hero-eyebrow">THUÊ Ô LƯU TRỮ · 3 BƯỚC</span>
            <h2 id="wm-booking-hero-title">Chọn ngày → Chọn ô → Đặt thuê</h2>
          </div>
        </div>
        <BookingPeriodFields booking={booking} />
        <div className="wm-v5-hero-counter" aria-live="polite">
          <strong>{booking.selection.length}</strong>
          <small>ô đã chọn</small>
          {periodReady && <span className="wm-v5-period-valid">Kỳ thuê hợp lệ</span>}
        </div>
      </section>
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
          onClick={() => setSidebar((v) => !v)}
          aria-expanded={sidebar}
        >
          <SlidersHorizontal size={15} />
          Khu vực & tìm kiếm
        </Button>
        <Button
          className="wm-button"
          variant="outline"
          onClick={() => setDrawer(true)}
        >
          Xem chi tiết
        </Button>
      </div>
      <div className="wm-dashboard-columns">
        <aside
          className={`wm-zone-sidebar wm-panel ${sidebar ? "wm-sidebar-open" : ""}`}
          aria-label="Khu vực kho"
        >
          <h2>
            <Layers size={16} />
            Khu vực kho
          </h2>
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
                    {zone.aisles.reduce((n, a) => n + a.racks.length, 0)} racks
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
              <button type="button" key={status} className="wm-status-filter" aria-label={`Filter Cells: ${status}`} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(current => current === status ? '' : status)}>
                <WarehouseStatus status={status} />
              </button>
            ))}
            {statusFilter && <button type="button" className="wm-clear-status-filter" onClick={() => setStatusFilter('')}>Xóa bộ lọc</button>}
            <p className="wm-muted">
              Đã chọn = ô trong giỏ thuê. Ô của bạn không đồng nghĩa có thể đặt thuê lại.
            </p>
          </div>
          <div className="wm-inventory-context-slot"><InventoryMapContext controller={inventory} /></div>
        </aside>
        <section
          className="wm-center wm-panel"
          aria-label="Warehouse visualization"
        >
          <div className="wm-section-heading">
            <h2>
              <MapIcon size={16} />
              {view === 'floorplan' ? 'Sơ đồ kho' : `Cấu trúc kệ — ${activeZone?.code || 'Rack'}`}
            </h2>
            {view === 'floorplan' ? <span>Chọn kệ để xem các ô lưu trữ</span> : <Button className="wm-button" variant="outline" onClick={() => { setView('floorplan'); setDrawer(false); }}>← Trở về sơ đồ</Button>}
          </div>
          <div hidden={view !== "floorplan"} className="wm-floorplan-view">
            <ResourceState resource={map} />
            {map.data && !allRacks.length && (
              <p className="wm-map-empty">
                No warehouse layout is available for this facility yet.
              </p>
            )}
            {map.data && allRacks.length > 0 && (
              <>
                <div
                  className="wm-map-viewport"
                  ref={viewport}
                  role="region"
                  aria-label="Interactive warehouse map"
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
                    style={{
                      width: bounds.width * zoom,
                      height: bounds.height * zoom,
                    }}
                  >
                    <div
                      ref={floor}
                      className="wm-floor"
                      style={{ transform: `scale(${zoom})` }}
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
                <div className="wm-map-controls">
                  <Button
                    className="wm-button"
                    variant="outline"
                    size="icon"
                    aria-label="Zoom out"
                    disabled={zoom <= 0.6}
                    onClick={() =>
                      setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(1))))
                    }
                  >
                    <ZoomOut size={17} />
                  </Button>
                  <output aria-label="Map zoom">{Math.round(zoom * 100)}%</output>
                  <Button
                    className="wm-button"
                    variant="outline"
                    size="icon"
                    aria-label="Zoom in"
                    disabled={zoom >= 1.8}
                    onClick={() =>
                      setZoom((z) => Math.min(1.8, Number((z + 0.2).toFixed(1))))
                    }
                  >
                    <ZoomIn size={17} />
                  </Button>
                  <Button
                    className="wm-button"
                    variant="outline"
                    size="sm"
                    onClick={reset}
                  >
                    <RotateCcw size={15} />
                    Reset View
                  </Button>
                  <small>
                    Kéo vùng trống để di chuyển sơ đồ · Dùng nút +/− để thu phóng
                  </small>
                </div>
              </>
            )}
          </div>
          {view === 'rack-detail' && <div className="wm-drilldown-content" ref={centralScroll}>
            <ResourceState resource={map} />
            {!map.error && activeZone && zoneRacks.length !== 1 && <div className="wm-rack-picker"><p>{zoneRacks.length ? 'Choose a Rack in this Zone.' : 'No racks are available in this zone yet.'}</p>{zoneRacks.map(rack => <Button key={rack._id} type="button" className="wm-button" variant="outline" aria-pressed={rackId === rack._id} onClick={() => selectRack(rack._id)}>{rack.rackCode}</Button>)}</div>}
            {rackId && (
              <div className="wm-selected-rack wm-cells-v4">
                <div className="wm-rack-inline-state">
                  {!map.error && <ResourceState resource={detail} />}
                </div>
                {!map.error && !detail.loading && detail.data?.rack._id === rackId && (
                  <WarehouseCells
                    key={`${rackId}:${updated?.getTime() || 0}`}
                    data={detail.data}
                    selected={cell}
                    query={query}
                    statusFilter={statusFilter}
                    onClearStatusFilter={() => setStatusFilter('')}
                    booking={booking}
                    onSelect={(value) => {
                      setCell(value);
                      // The desktop inspector is already visible; drawer is for mobile.
                      if (window.matchMedia("(max-width: 1023px)").matches) {
                        setDrawer(true);
                      }
                    }}
                  />
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
        <aside
          className="wm-inspector wm-panel"
          aria-label="Selected rack or cell details"
          aria-live="polite"
        >
          {information}
        </aside>
      </div>
      {drawer &&
        createPortal(
          <section
            role="dialog"
            aria-modal="false"
            aria-label="Selected structure details"
            className="warehouse-detail-drawer"
          >
            <Button
              className="wm-drawer-close"
              variant="outline"
              size="icon"
              aria-label="Close details"
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
