import { useEffect, useId, useLayoutEffect, useState } from "react";

import { createPortal } from "react-dom";

import { measurementText, weightText, cellPeriodStatus } from "@/lib/warehouseMap";

import { cellBookingReason, volumeText } from "@/lib/managedCellBooking";

import { Button } from "@/components/ui/button";



const statusLabels = {
  AVAILABLE: "Còn chỗ",
  RESERVED: "Đã được đặt",
  OCCUPIED: "Đang sử dụng",
  BLOCKED: "Tạm thời chưa thể đặt ô này",
  UNAVAILABLE: "Tạm thời chưa thể đặt ô này",
  MAINTENANCE: "Đang bảo trì",
  UNKNOWN: "Vui lòng liên hệ cơ sở",
};
const isCapacityValue = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const capacityText = (value, formatter, fallback) => isCapacityValue(value) ? formatter(value) : fallback;

export function WarehouseStatus({ status }) {

  const kind = [

    "AVAILABLE",

    "RESERVED",

    "OCCUPIED",

    "BLOCKED",

    "MAINTENANCE",
    "UNAVAILABLE",

  ].includes(status)

    ? status.toLowerCase()

    : "unknown";

  return <span className={`wm-status wm-${kind}`}>{statusLabels[status] || statusLabels.UNKNOWN}</span>;

}

function CellPeriodStatus({ cell }) {

  const status = cellPeriodStatus(cell);

  return <span className="inline-flex flex-wrap items-center gap-1"><WarehouseStatus status={status} /></span>;

}

export function CellInformation({ cell, level = {}, rack = {} }) {
  if (!cell || typeof cell !== "object") return <p role="status">Thông tin ô lưu trữ hiện chưa có.</p>;
  const capacityRedacted = cell.capacityDisclosure === "REDACTED";
  const configuredWeight = isCapacityValue(cell.maxWeightKg) && cell.maxWeightKg > 0;
  const configuredVolume = isCapacityValue(cell.maxVolumeM3) && cell.maxVolumeM3 > 0;
  const usageKnown = cell.physicalUsageKnown === true;
  const measuredValue = (value, formatter) => usageKnown ? capacityText(value, formatter, "Chưa xác định") : "Chưa xác định";
  const myStock = cell.myStock;
  const myStockValue = (key, formatter) => ["LEDGER_MATCHED", "PROJECTION_MISMATCH"].includes(myStock?.status)
    ? capacityText(myStock[key], formatter, "Chưa xác định")
    : myStock?.status === "NO_DATA" ? "Chưa có dữ liệu tồn kho của bạn" : "Đang cần cơ sở đối soát";

  const fields = [

    ["Khu vực", rack?.zoneCode],

    ["Lối đi", rack?.aisleCode],

    ["Kệ", rack?.rackCode],

    ["Tầng", level?.levelNumber],

    ["Ô lưu trữ", cell.cellNumber],

    ...(cell.isMine === true || cell.hasMyInventory === true ? [
      ["Số lượng hàng của bạn (theo sổ tồn)", myStockValue("quantity", value => `${value.toLocaleString()} món`)],
      ["Khối lượng hàng của bạn (theo sổ tồn)", myStockValue("weightKg", weightText)],
      ["Thể tích hàng của bạn (theo sổ tồn)", myStockValue("volumeM3", volumeText)],
    ] : []),

    ["Tải trọng tối đa", capacityRedacted ? null : configuredWeight ? weightText(cell.maxWeightKg) : "Chưa cấu hình"],

    ["Tải trọng đang sử dụng", capacityRedacted ? null : measuredValue(cell.usedWeightKg, weightText)],

    ["Tải trọng còn lại", capacityRedacted ? null : !configuredWeight ? "Chưa cấu hình" : measuredValue(cell.remainingWeightKg, weightText)],

    ["Thể tích tối đa", capacityRedacted ? null : configuredVolume ? volumeText(cell.maxVolumeM3) : "Chưa cấu hình"],

    ["Thể tích đang sử dụng", capacityRedacted ? null : measuredValue(cell.usedVolumeM3, volumeText)],

    ["Thể tích còn lại", capacityRedacted ? null : !configuredVolume ? "Chưa cấu hình" : measuredValue(cell.remainingVolumeM3, volumeText)],

    [

      "Chiều rộng",

      cell.dimensions?.widthM == null

        ? null

        : measurementText(cell.dimensions.widthM),

    ],

    [

      "Chiều sâu",

      cell.dimensions?.depthM == null

        ? null

        : measurementText(cell.dimensions.depthM),

    ],

    [

      "Chiều cao sử dụng",

      cell.dimensions?.usableHeightM == null

        ? null

        : measurementText(cell.dimensions.usableHeightM),

    ],

  ];

  return (

    <>

      <div className="wm-info-heading">

        <strong>{cell.code || `Ô ${cell.cellNumber}`}</strong>

        <span className="inline-flex flex-wrap items-center gap-1">
          <CellPeriodStatus cell={cell} />
          {cell.isMine === true && <span className="wm-owned-chip">Ô thuê của bạn</span>}
          {cell.hasMyInventory === true && <span className="wm-owned-chip">Hàng của bạn</span>}
          {(cell.isMine === true || cell.hasMyInventory === true) && ["LEDGER_MATCHED", "PROJECTION_MISMATCH"].includes(cell.myStock?.status) && <span className="wm-cell-stock-chip">{cell.myStock.quantity} món · {weightText(cell.myStock.weightKg)} theo sổ tồn</span>}
          {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === "PROJECTION_MISMATCH" && <span className="wm-cell-warning-chip">Sổ tồn đã đọc; cơ sở cần kiểm tra bảng tổng hợp.</span>}
          {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === "UNKNOWN" && <span className="wm-cell-warning-chip">Tồn kho cần đối soát</span>}
        </span>

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

      <p className="wm-baseline-note">{capacityRedacted
        ? "Trạng thái đặt thuê do hệ thống xác định; thông số sử dụng chung chỉ dành cho nhân viên cơ sở."
        : !usageKnown
          ? "Thông tin dung lượng hiện chưa được xác minh. Vui lòng liên hệ cơ sở nếu bạn cần biết thêm."
          : cell.isBookable === false
            ? ({
              CELL_WEIGHT_CAPACITY_NOT_CONFIGURED: "Ô này chưa được cơ sở cấu hình tải trọng tối đa nên hiện chưa thể đặt.",
              CELL_VOLUME_CAPACITY_INVALID: "Kích thước sử dụng của ô này chưa hợp lệ nên hiện chưa thể đặt.",
              CELL_DIMENSIONS_NOT_CONFIGURED: "Kích thước sử dụng của ô này chưa được cấu hình nên hiện chưa thể đặt.",
              CAPACITY_COUNTER_EXCEEDS_LIMIT: "Số liệu sức chứa của ô cần được cơ sở kiểm tra trước khi đặt.",
              STOCK_RECONCILIATION_REQUIRED: "Cơ sở cần kiểm tra lại lịch sử sử dụng ô này trước khi cho đặt.",
            }[cell.bookingReasonCode] || "Ô này hiện chưa thể đặt trong thời hạn đã chọn. Vui lòng thử ô khác hoặc liên hệ cơ sở.")
            : "Trạng thái khả dụng được xác nhận theo thời hạn thuê bạn đã chọn."}</p>

    </>

  );

}

export default function WarehouseCells({

  data,

  selected,

  onSelect,

  query,

  statusFilter,

  onClearStatusFilter,

  booking,

}) {

  const [hover, setHover] = useState(null),

    [position, setPosition] = useState({ left: 12, top: 12 }),

    id = useId();

  useEffect(() => {

    if (!selected) setHover(null);

  }, [selected?.cell?._id]);

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

  if (!data || !data.rack || !Array.isArray(data.levels)) {
    return <section className="wm-cell-area" role="status">Chưa tải được thông tin kệ và ô lưu trữ. Vui lòng thử lại.</section>;
  }

  const sourceLevels = data.levels.filter((level) => level && Number.isSafeInteger(level.levelNumber) && Array.isArray(level.cells));
  const levels = sourceLevels
    .map((level) => ({ ...level, cells: level.cells.filter((cell) => cell && typeof cell === "object" && typeof cell._id === "string" && Number.isSafeInteger(cell.cellNumber)) }))
    .sort((a, b) => b.levelNumber - a.levelNumber);
  const sourceCellCount = sourceLevels.reduce((count, level) => count + level.cells.length, 0);
  const validCellCount = levels.reduce((count, level) => count + level.cells.length, 0);
  const context = [data.rack.rackCode, data.rack.zoneCode, data.rack.aisleCode].join(" ").toLowerCase();
  const q = String(query ?? "").trim().toLowerCase();

  return (

    <section className="wm-cell-area" aria-label="Tầng kệ và ô lưu trữ">

      <div className="wm-section-heading">

        <div>

          <small>CẤU TRÚC KỆ</small>

          <h3>{data.rack.rackCode}</h3>

        </div>

        <span>

          {validCellCount} ô trong kệ

        </span>

      </div>

      {(sourceLevels.length !== data.levels.length || sourceCellCount !== validCellCount) && <p role="status" className="wm-muted">Một phần thông tin ô chưa đầy đủ nên không thể hiển thị.</p>}

      {!levels.some((l) => l.cells.length) && (

        <p>Kệ này chưa được cấu hình ô lưu trữ.</p>

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

            <h4>Tầng {level.levelNumber}</h4>

            <div className="wm-cell-row">

              {cells.map((cell) => {

                const status = cellPeriodStatus(cell), picked = Array.isArray(booking?.selection) && booking.selection.some(

                  (x) => x?.cell?._id === cell._id,

                ),

                  reason = cellBookingReason(

                    cell,

                    data.rack,

                    booking?.period?.range,

                  );

                return (

                  <div

                    key={cell._id}

                    className={`wm-cell-choice ${picked ? "wm-picked" : ""} ${statusFilter && status !== statusFilter ? "wm-status-muted" : ""}`}
                    data-cell-status={status}
                    data-cell-bookable={String(cell.isBookable === true && status === "AVAILABLE" && !reason)}

                    data-status-match={statusFilter ? String(status === statusFilter) : undefined}

                  >

                    <button

                      type="button"

                      className={`wm-cell wm-${["AVAILABLE", "RESERVED", "OCCUPIED", "BLOCKED", "MAINTENANCE"].includes(status) ? status.toLowerCase() : "unknown"} ${selected?.cell?._id === cell._id ? "is-selected" : ""}`}

                      aria-pressed={selected?.cell?._id === cell._id}

                      aria-label={`Xem ${cell.code || `Ô ${cell.cellNumber}`}, tầng ${level.levelNumber}, ${statusLabels[status] || statusLabels.UNKNOWN}`}

                      aria-describedby={

                        hover?.cell?._id === cell._id ? id : undefined

                      }

                      data-cell-number={cell.cellNumber}

                      onPointerEnter={(e) => {

                        if (e.pointerType === "mouse")

                          setHover({ cell, level, anchor: e.currentTarget });

                      }}

                      onPointerLeave={() =>

                        setHover((current) =>

                          selected?.cell?._id === current?.cell?._id

                            ? current

                            : null,

                        )

                      }

                      onFocus={(e) =>

                        setHover({ cell, level, anchor: e.currentTarget })

                      }

                      onBlur={() => setHover(null)}

                      onClick={(e) => {

                        onSelect?.({ cell, level });

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

                      <span className="wm-cell-badges">
                        <CellPeriodStatus cell={cell} />
                        {cell.isMine === true && <span className="wm-owned-chip">Ô thuê của bạn</span>}
                        {cell.hasMyInventory === true && <span className="wm-owned-chip">Hàng của bạn</span>}
                        {(cell.isMine === true || cell.hasMyInventory === true) && ["LEDGER_MATCHED", "PROJECTION_MISMATCH"].includes(cell.myStock?.status) && <span className="wm-cell-stock-chip">{cell.myStock.quantity} món · {weightText(cell.myStock.weightKg)}</span>}
                        {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === "PROJECTION_MISMATCH" && <span className="wm-cell-warning-chip">Cần kiểm tra số liệu tổng hợp</span>}
                        {(cell.isMine === true || cell.hasMyInventory === true) && cell.myStock?.status === "UNKNOWN" && <span className="wm-cell-warning-chip">Tồn kho cần đối soát</span>}
                        {picked && <span className="wm-picked-chip">Đã chọn thuê</span>}
                      </span>


                    </button>

                    {booking && (

                      <>

                        <Button

                          type="button"

                          size="sm"

                          variant={picked ? "orange" : "outline"}

                          aria-label={`${picked ? "Bỏ chọn" : "Chọn để thuê"} ${cell.code || cell._id}`}

                          aria-pressed={picked}

                          disabled={

                            booking.locked ||

                            booking.checking ||

                            (!picked && (cell.isBookable !== true || status !== 'AVAILABLE' || !!reason))

                          }

                          onClick={() => booking.toggle?.(cell, level, data.rack)}

                        >

                          {picked ? "Bỏ chọn" : "Chọn ô"}

                        </Button>

                        <small
                          className="wm-booking-reason"
                          title={booking.period?.range ? reason || undefined : undefined}
                        >
                          {!booking.period?.range || picked
                            ? ""
                            : status === "RESERVED" ? "Đã được đặt trong kỳ này"
                              : status === "OCCUPIED" ? "Ô đang được sử dụng"
                                : status === "BLOCKED" ? "Ô đang bị khóa"
                                  : status === "MAINTENANCE" ? "Ô đang bảo trì"
                                    : reason ? "Chưa đủ điều kiện đặt" : ""}
                        </small>

                      </>

                    )}

                  </div>

                );

              })}

            </div>

            {!cells.length && level.cells.length > 0 && (

              <p className="wm-muted">Không có ô lưu trữ phù hợp với nội dung tìm kiếm.</p>

            )}

          </div>

        );

      })}

      {statusFilter && <div className="wm-cell-filter-summary" role="status">

        <span>Đang lọc theo trạng thái: {statusLabels[statusFilter] || "Chưa xác định"}. Các ô khác được làm mờ.</span>

        <button type="button" className="wm-clear-status-filter" onClick={onClearStatusFilter}>Xóa bộ lọc</button>

        {!levels.some(level => level.cells.some(c => cellPeriodStatus(c) === statusFilter && (!q || context.includes(q) || String(c.code || `C${c.cellNumber}`).toLowerCase().includes(q)))) && <p>Không có ô lưu trữ nào trong kệ này khớp với trạng thái đã chọn.</p>}

      </div>}

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
