import { useEffect, useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { weightText, measurementText, cellPeriodStatus } from "@/lib/warehouseMap";
import { cellBookingReason, volumeText } from "@/lib/managedCellBooking";
import { Button } from "@/components/ui/button";

export function WarehouseStatus({ status }) {
  const kind = [
    "AVAILABLE",
    "RESERVED",
    "OCCUPIED",
    "BLOCKED",
    "MAINTENANCE",
  ].includes(status)
    ? status.toLowerCase()
    : "unknown";
  return (
    <span className={`wm-status wm-${kind}`}>{status || "Not returned"}</span>
  );
}
function CellPeriodStatus({cell}){
  const status=cellPeriodStatus(cell);
  return <span className="inline-flex flex-wrap items-center gap-1" aria-label={`${status}${cell.isMine===true?' · YOURS':''}`}><WarehouseStatus status={status}/>{cell.isMine===true&&<span className="rounded border border-orange-300 px-1 text-xs font-semibold text-orange-500">· YOURS</span>}</span>;
}
export function CellInformation({ cell, level, rack }) {
  const fields = [
    ["Zone", rack.zoneCode],
    ["Aisle", rack.aisleCode],
    ["Rack", rack.rackCode],
    ["Level", level.levelNumber],
    ["Cell", cell.cellNumber],
    [
      "Maximum capacity",
      cell.maxWeightKg == null ? null : weightText(cell.maxWeightKg),
    ],
    [
      "Width",
      cell.dimensions?.widthM == null
        ? null
        : measurementText(cell.dimensions.widthM),
    ],
    [
      "Depth",
      cell.dimensions?.depthM == null
        ? null
        : measurementText(cell.dimensions.depthM),
    ],
    [
      "Usable clearance",
      cell.dimensions?.usableHeightM == null
        ? null
        : measurementText(cell.dimensions.usableHeightM),
    ],
    ["Weight utilization", cell.utilizationStatus],
    [
      "Physical used weight",
      cell.usedWeightKg == null ? null : weightText(cell.usedWeightKg),
    ],
  ];
  fields.push(
    ["Operational status", cell.operationalStatus || "Unknown"],
    ["Reservation-period status", cell.periodStatus || "Unknown"],
    ["Current booking status (now)", cell.bookingStatus || "Unknown"],
    ["Bookable for interval", cell.isBookable === true ? "Yes" : "Not confirmed"],
    ["Physical usage verified", cell.physicalUsageKnown === true ? "Yes" : "Unknown — booking unavailable"],
    ["Backend display status (now)", cell.displayStatus || "Unknown"],
    ["Ownership", cell.isMine === true ? "Yours" : "No ownership confirmed"],
    ["Your stored inventory", cell.hasMyInventory === true ? "Yes" : cell.hasMyInventory === false ? "No" : "Unknown"],
    ["Physical volume", volumeText(cell.usedVolumeM3)],
    ["Maximum volume", volumeText(cell.maxVolumeM3)],
    ["Remaining volume", volumeText(cell.remainingVolumeM3)],
  );
  return (
    <>
      <div className="wm-info-heading">
        <strong>{cell.code || `Cell C${cell.cellNumber}`}</strong>
        <CellPeriodStatus cell={cell}/>
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
        Physical usage counters are separate from rental allocation. Yours does
        not permit rebooking.
      </p>
    </>
  );
}
export default function WarehouseCells({
  data,
  selected,
  onSelect,
  query,
  booking,
}) {
  const [hover, setHover] = useState(null),
    [position, setPosition] = useState({ left: 12, top: 12 }),
    id = useId();
  useEffect(() => {
    if (!selected) setHover(null);
  }, [selected?.cell._id]);
  useLayoutEffect(() => {
    if (!hover) return;
    const place = () => {
      const anchor = hover.anchor;
      if (!anchor.isConnected) {
        setHover(null);
        return;
      }
      const rect = anchor.getBoundingClientRect(),
        width = Math.min(288, innerWidth - 24),
        height =
          document.getElementById(id)?.getBoundingClientRect().height || 350;
      let left = rect.right + 12;
      if (left + width > innerWidth - 12) left = rect.left - width - 12;
      setPosition({
        left: Math.max(12, Math.min(left, innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.top, innerHeight - height - 12)),
      });
    };
    const escape = (e) => {
      if (e.key === "Escape") setHover(null);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", escape);
    };
  }, [hover, id]);
  const levels = [...data.levels].sort((a, b) => b.levelNumber - a.levelNumber),
    context = [data.rack.rackCode, data.rack.zoneCode, data.rack.aisleCode]
      .join(" ")
      .toLowerCase(),
    q = query.trim().toLowerCase();
  return (
    <section className="wm-cell-area" aria-label="Rack levels and cells">
      <div className="wm-section-heading">
        <div>
          <small>RACK STRUCTURE</small>
          <h3>{data.rack.rackCode}</h3>
        </div>
        <span>
          {data.levels.reduce((n, l) => n + l.cells.length, 0)} returned cells
        </span>
      </div>
      {!levels.some((l) => l.cells.length) && (
        <p>No cells are configured for this rack.</p>
      )}
      {levels.map((level) => {
        const cells = [...level.cells]
          .sort((a, b) => a.cellNumber - b.cellNumber)
          .filter(
            (c) =>
              !q ||
              context.includes(q) ||
              String(c.code || `C${c.cellNumber}`)
                .toLowerCase()
                .includes(q),
          );
        return (
          <div className="wm-level" key={level.levelNumber}>
            <h4>Level {level.levelNumber}</h4>
            <div className="wm-cell-row">
              {cells.map((cell) => {
                const status=cellPeriodStatus(cell),picked = booking?.selection.some(
                    (x) => x.cell._id === cell._id,
                  ),
                  reason = cellBookingReason(
                    cell,
                    data.rack,
                    booking?.period.range,
                  );
                return (
                  <div
                    key={cell._id}
                    className={`wm-cell-choice ${picked ? "wm-picked" : ""}`}
                  >
                    <button
                      type="button"
                      className={`wm-cell wm-${["AVAILABLE", "RESERVED", "OCCUPIED"].includes(status) ? status.toLowerCase() : "unknown"} ${selected?.cell._id === cell._id ? "is-selected" : ""}`}
                      aria-pressed={selected?.cell._id === cell._id}
                      aria-label={`Inspect ${cell.code || `Cell C${cell.cellNumber}`}, Level ${level.levelNumber}, ${status}${cell.isMine===true?' · YOURS':''}`}
                      aria-describedby={
                        hover?.cell._id === cell._id ? id : undefined
                      }
                      data-cell-number={cell.cellNumber}
                      onPointerEnter={(e) => {
                        if (e.pointerType === "mouse")
                          setHover({ cell, level, anchor: e.currentTarget });
                      }}
                      onPointerLeave={() =>
                        setHover((current) =>
                          selected?.cell._id === current?.cell._id
                            ? current
                            : null,
                        )
                      }
                      onFocus={(e) =>
                        setHover({ cell, level, anchor: e.currentTarget })
                      }
                      onBlur={() => setHover(null)}
                      onClick={(e) => {
                        onSelect({ cell, level });
                        setHover(
                          innerWidth < 1200
                            ? null
                            : { cell, level, anchor: e.currentTarget },
                        );
                      }}
                    >
                      <span className="wm-cell-code">
                        {cell.code || `C${cell.cellNumber}`}
                      </span>
                      <CellPeriodStatus cell={cell}/>
                      {cell.hasMyInventory === true && (
                        <span>Your inventory</span>
                      )}
                      {picked && <span>Selected for booking</span>}
                      <small>
                        {cell.maxWeightKg == null
                          ? ""
                          : weightText(cell.maxWeightKg)}
                      </small>
                    </button>
                    {booking && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant={picked ? "orange" : "outline"}
                          aria-label={`${picked ? "Deselect" : "Select for booking"} ${cell.code || cell._id}`}
                          aria-pressed={picked}
                          disabled={
                            booking.locked ||
                            booking.checking ||
                            (!picked && (cell.isBookable!==true || status!=='AVAILABLE' || !!reason))
                          }
                          onClick={() => booking.toggle(cell, level, data.rack)}
                        >
                          {picked ? "Deselect" : "Select"}
                        </Button>
                        {!picked && (reason||status!=='AVAILABLE') && (
                          <small className="wm-booking-reason">{reason||'Reservation-period availability is not confirmed.'}</small>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!cells.length && level.cells.length > 0 && (
              <p className="wm-muted">No loaded cells match this search.</p>
            )}
          </div>
        );
      })}
      {hover &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="warehouse-cell-tooltip"
            style={{ ...position, width: "min(288px, calc(100vw - 24px))" }}
          >
            <CellInformation
              cell={hover.cell}
              level={hover.level}
              rack={data.rack}
            />
          </div>,
          document.fullscreenElement || document.body,
        )}
    </section>
  );
}
