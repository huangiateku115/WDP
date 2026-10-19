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
import { useManagedCellBooking, CellBookingPanel } from "./ManagedCellBooking";
import "./warehouse-dashboard.css";

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
        Open rack detail
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
        <h3>{zone.code}</h3>
        <span>{zone.name}</span>
      </div>
      {(x.condensed || y.condensed) && (
        <p className="wm-muted">
          Large empty coordinate gaps are condensed; exact X/Y positions remain
          labeled.
        </p>
      )}
      {!racks.length ? (
        <p className="wm-muted">No racks are available in this zone yet.</p>
      ) : (
        <div
          className="wm-rack-grid"
          style={{
            gridTemplateColumns: `repeat(${x.count}, 148px)`,
            gridTemplateRows: `repeat(${y.count}, minmax(116px, auto))`,
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
                  <small>
                    {rack.orientation}° · X {rack.mapX}, Y {rack.mapY}
                  </small>
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
    pendingZone = useRef(null);
  const [rackId, setRackId] = useState(initialRackId || ""),
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
    const measure = () =>
      setBounds({
        width: floor.current?.offsetWidth || 1,
        height: floor.current?.offsetHeight || 1,
      });
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
    const period = !!booking?.startDate && !!booking?.endDate;
    return [
      ["Zones", map.data?.zones.length],
      ["Racks", map.data ? allRacks.length : null],
      ["Cells", map.data ? sum("cellCount") : null],
      [
        period ? "Available for selected period" : "Available now",
        map.data ? availableCellCount(allRacks, period) : null,
      ],
      ["Blocked cells", null],
      ["Maintenance cells", null],
    ];
  }, [map.data, allRacks, booking?.startDate, booking?.endDate]);
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
    if (zones.current.has(id)) scrollZone(id);
    else {
      pendingZone.current = id;
      setQuery("");
    }
  };
  useEffect(() => {
    if (pendingZone.current && zones.current.has(pendingZone.current)) {
      scrollZone(pendingZone.current);
      pendingZone.current = null;
    }
  }, [filtered]);
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
  const information = (
    <>
      <div className="wm-section-heading">
        <h2>{cell ? "Cell details" : "Rack details"}</h2>
        {cell && (
          <Button
            className="wm-button"
            variant="outline"
            size="sm"
            onClick={() => setCell(null)}
          >
            Clear cell
          </Button>
        )}
      </div>
      {!rackId ? (
        <div className="wm-empty-inspector">
          <Boxes size={34} />
          <p>Select a rack or cell on the map to view details.</p>
        </div>
      ) : (
        <>
          {!map.error && <ResourceState resource={detail} />}
          {!map.error &&
            detail.data &&
            (cell ? (
              <>
                <CellInformation
                  cell={cell.cell}
                  level={cell.level}
                  rack={detail.data.rack}
                  requestedPeriod={!!booking?.startDate && !!booking?.endDate}
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
        <div>
          <p className="wm-eyebrow">
            <MapIcon size={14} /> WAREHOUSE EXPLORER · MI-01
          </p>
          <h1>Digital Warehouse Map</h1>
          <p>Explore warehouse zones, racks and storage cells.</p>
          <WarehouseBreadcrumbs
            facilityId={validId(facilityId) ? facilityId : undefined}
            facilityName={facility.data?.name}
            rackCode={
              initialRackId
                ? detail.data?.rack.rackCode || "Rack Detail"
                : undefined
            }
          />
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
          {updated && (
            <small>Last updated {updated.toLocaleTimeString()}</small>
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
                ? "Back to Warehouse Map"
                : "Back to Facility Selection"}
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
          <Button
            variant="outline"
            className="wm-button"
            onClick={toggleFullscreen}
          >
            {fullscreen || expanded ? (
              <Minimize2 size={15} />
            ) : (
              <Maximize2 size={15} />
            )}
            <span>
              {fullscreen || expanded ? "Exit fullscreen" : "Fullscreen"}
            </span>
          </Button>
        </div>
      </header>
      <p className="wm-notice">
        {booking.period.range
          ? "Availability for the selected UTC rental interval."
          : "Current-time warehouse overview. Choose a rental period to check booking availability."}{" "}
        Reserving Cells is separate from Staff-confirmed physical occupancy.
      </p>
      <details className="wm-booking-drawer">
        <summary>Rental period &amp; Cell selection</summary>
      <CellBookingPanel
        booking={booking}
        facilityId={facilityId}
        facilityName={facility.data?.name}
      />
      </details>
      <InventoryMapContext controller={inventory} />
      {fullscreenError && (
        <p role="status" className="wm-notice">
          {fullscreenError}
        </p>
      )}
      <div className="wm-stats" aria-label="Warehouse statistics">
        {statistics.map(([label, value], index) => (
          <div className="wm-stat" key={label}>
            <span className={`wm-stat-dot wm-stat-dot-${index}`} />
            <p>{label}</p>
            <strong>
              {value == null ? "Not available" : value.toLocaleString()}
            </strong>
          </div>
        ))}
      </div>
      <div className="wm-mobile-tools">
        <Button
          className="wm-button"
          variant="outline"
          onClick={() => setSidebar((v) => !v)}
          aria-expanded={sidebar}
        >
          <SlidersHorizontal size={15} />
          Zones & search
        </Button>
        <Button
          className="wm-button"
          variant="outline"
          onClick={() => setDrawer(true)}
        >
          View details
        </Button>
      </div>
      <div className="wm-dashboard-columns">
        <aside
          className={`wm-zone-sidebar wm-panel ${sidebar ? "wm-sidebar-open" : ""}`}
          aria-label="Warehouse zones"
        >
          <h2>
            <Layers size={16} />
            Warehouse zones
          </h2>
          <div className="wm-search-wrap">
            <Search size={16} />
            <Input
              className="wm-search"
              aria-label="Search zones, aisles, racks, cells"
              placeholder="Search zones, aisles, racks, cells..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="wm-muted">
            Search loaded structure only. Select a rack to load its cells.
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
            <h3>Cell display status</h3>
            {[
              "AVAILABLE",
              "RESERVED",
              "OCCUPIED",
              "BLOCKED",
              "MAINTENANCE",
            ].map((status) => (
              <button type="button" key={status} className="wm-status-filter" aria-label={`Filter Cells: ${status}`} aria-pressed={statusFilter===status} onClick={()=>setStatusFilter(current=>current===status?'':status)}>
                <WarehouseStatus status={status} />
              </button>
            ))}
            {statusFilter&&<button type="button" className="wm-clear-status-filter" onClick={()=>setStatusFilter('')}>Clear filter</button>}
            <p className="wm-muted">
              Selected = booking basket. Yours = ownership, not permission to
              rebook.
            </p>
          </div>
        </aside>
        <section
          className="wm-center wm-panel"
          aria-label="Warehouse visualization"
        >
          <div className="wm-section-heading">
            <h2>
              <MapIcon size={16} />
              Warehouse floorplan
            </h2>
            <span>Coordinates: X → · Y ↓</span>
          </div>
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
                      />
                    ))}
                    {!filtered.length && (
                      <p className="wm-map-empty">
                        No loaded structure matches your search.
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
                  Grid positions, not meters · Drag blank space to pan · Scroll
                  on touch
                </small>
              </div>
            </>
          )}
          {rackId && (
            <div className="wm-selected-rack">
              <div className="wm-rack-inline-state">
                {!map.error && <ResourceState resource={detail} />}
              </div>
              {!map.error && detail.data && (
                <WarehouseCells
                  key={`${rackId}:${updated?.getTime() || 0}`}
                  data={detail.data}
                  selected={cell}
                  query={query}
                  statusFilter={statusFilter}
                  onClearStatusFilter={()=>setStatusFilter('')}
                  booking={booking}
                  onSelect={(value) => {
                    setCell(value);
                    setDrawer(true);
                  }}
                />
              )}
            </div>
          )}
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
