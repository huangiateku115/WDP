import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Arbitrary time-range picker built with the libraries already in the project
 * (react + react-dom portal + tailwind + lucide-react). No extra dependency.
 *
 * Trigger shows `start To end` (e.g. "08:00 To 18:00"); the panel renders two
 * scrollable column groups ("Start Time" / "End Time") with Cancel / OK.
 * Value is a string in the form `HH:MM - HH:MM` (or `HH:MM:SS` with seconds).
 */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const pad = (n) => String(n).padStart(2, "0");

/** Accepts `08:00 - 18:00`, `8:00-18:00`, `08:00 to 18:00`, `08:00 – 18:00`, optionally with seconds. */
const RANGE_PATTERN = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:[-–]|to|đến)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i;

const clamp = (value, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(0, Math.trunc(n)), max);
};
const partOf = (h, m, s) => ({ h: clamp(h, 23), m: clamp(m, 59), s: clamp(s ?? 0, 59) });
const secondsOf = (part) => part.h * 3600 + part.m * 60 + part.s;
const totalOf = (part) => secondsOf(part);

export const DEFAULT_TIME_RANGE = { start: partOf(8, 0), end: partOf(18, 0) };

export function parseTimeRange(value) {
  const match = RANGE_PATTERN.exec(String(value ?? ""));
  if (!match) return null;
  return { start: partOf(match[1], match[2], match[3]), end: partOf(match[4], match[5], match[6]) };
}

export function formatTimePart(part, withSeconds = false) {
  const safe = part || { h: 0, m: 0, s: 0 };
  return withSeconds ? `${pad(safe.h)}:${pad(safe.m)}:${pad(safe.s)}` : `${pad(safe.h)}:${pad(safe.m)}`;
}

export function formatTimeRange(range, withSeconds = false, separator = " - ") {
  const safe = range || DEFAULT_TIME_RANGE;
  return `${formatTimePart(safe.start, withSeconds)}${separator}${formatTimePart(safe.end, withSeconds)}`;
}

/** Returns "" when the range is valid, otherwise a Vietnamese error message. */
export function timeRangeError(range) {
  const safe = range || DEFAULT_TIME_RANGE;
  return totalOf(safe.end) <= totalOf(safe.start) ? "End time must be later than start time." : "";
}

function TimeColumn({ label, items, value, onSelect }) {
  const boxRef = useRef(null);
  const activeRef = useRef(null);

  const centreSelected = useCallback(() => {
    const box = boxRef.current;
    const active = activeRef.current;
    if (!box || !active) return;
    box.scrollTop = Math.max(0, active.offsetTop - (box.clientHeight - active.clientHeight) / 2);
  }, []);

  // Runs once on mount: the panel is unmounted when closed, so a new draft always re-centres.
  useLayoutEffect(() => {
    centreSelected();
  }, [centreSelected]);

  return (
    <div
      ref={boxRef}
      role="listbox"
      aria-label={label}
      className="h-44 w-12 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((n) => {
        const selected = n === value;
        return (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={selected}
            ref={selected ? activeRef : undefined}
            onClick={() => onSelect(n)}
            className={cn(
              "block h-8 w-full text-center text-sm tabular-nums transition-colors",
              selected ? "font-semibold text-blue-600" : "text-slate-500 hover:bg-slate-50",
              n % 10 === 0 && n !== 0 && "border-b border-slate-100",
            )}
          >
            {pad(n)}
          </button>
        );
      })}
    </div>
  );
}

function TimeGroup({ title, part, withSeconds, onChange }) {
  return (
    <div>
      <p className="mb-2 text-center text-sm text-slate-600">{title}</p>
      <div className="flex justify-center gap-0.5 rounded-xl border border-slate-100 p-1">
        <TimeColumn label={`${title} — hour`} items={HOURS} value={part.h} onSelect={(v) => onChange("h", v)} />
        <TimeColumn label={`${title} — minute`} items={MINUTES} value={part.m} onSelect={(v) => onChange("m", v)} />
        {withSeconds && (
          <TimeColumn label={`${title} — second`} items={MINUTES} value={part.s} onSelect={(v) => onChange("s", v)} />
        )}
      </div>
    </div>
  );
}

export function TimeRangePicker({
  value = "",
  onChange,
  withSeconds = false,
  disabled = false,
  placeholder = "Select a time range",
  ariaLabel = "Time range",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_TIME_RANGE);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const parsed = parseTimeRange(value);
  const error = timeRangeError(draft);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, withSeconds ? 430 : 340);
    const height = panelRef.current?.offsetHeight || 320;
    const margin = 12;
    let top = rect.bottom + 8;
    if (top + height + margin > window.innerHeight) {
      const above = rect.top - height - 8;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - height - margin);
    }
    setPosition({
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - margin)),
      width,
    });
  }, [withSeconds]);

  const openPanel = () => {
    setDraft(parseTimeRange(value) || DEFAULT_TIME_RANGE);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onViewportChange = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commit = () => {
    if (error) return;
    onChange?.(formatTimeRange(draft, withSeconds));
    setOpen(false);
  };

  const updatePart = (side, key, next) => {
    setDraft((current) => ({ ...current, [side]: { ...current[side], [key]: next } }));
  };

  const paired = parsed;

  return (
    <>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openPanel();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) setOpen(false);
            else openPanel();
          }
        }}
        className={cn(
          "flex h-12 w-full cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none",
          "focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
          open && "border-blue-500 ring-2 ring-blue-100",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        {paired ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-semibold tabular-nums text-blue-600">{formatTimePart(paired.start, withSeconds)}</span>
            <span className="text-xs text-slate-400">To</span>
            <span className="font-semibold tabular-nums text-blue-600">{formatTimePart(paired.end, withSeconds)}</span>
          </span>
        ) : (
          <span className={cn("min-w-0 flex-1 truncate", value ? "text-slate-600" : "text-slate-400")}>
            {value || placeholder}
          </span>
        )}
        {value && !disabled && (
          <button
            type="button"
            aria-label="Clear time range"
            onClick={(event) => {
              event.stopPropagation();
              onChange?.("");
            }}
            className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
            className="z-[60] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_36px_rgba(19,27,46,0.14)]"
          >
            <div className="grid grid-cols-2 gap-3">
              <TimeGroup
                title="Start Time"
                part={draft.start}
                withSeconds={withSeconds}
                onChange={(key, next) => updatePart("start", key, next)}
              />
              <TimeGroup
                title="End Time"
                part={draft.end}
                withSeconds={withSeconds}
                onChange={(key, next) => updatePart("end", key, next)}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <div className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(error)}
                onClick={commit}
                className="h-9 rounded-lg px-4 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-40"
              >
                OK
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
