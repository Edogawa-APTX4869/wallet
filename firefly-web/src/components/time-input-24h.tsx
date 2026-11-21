"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { cn, isoTime } from "@/lib/utils";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parses a user-entered 24-hour time string into strict `HH:MM` (00:00–23:59),
 * or returns `null` if invalid.
 * Accepts `"15:30"`, `"9:05"`, `"9:5"`, `"1530"`, `"930"`, `"14"`.
 */
export function parseTime24h(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const colonMatch = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = Number(colonMatch[1]);
    const m = Number(colonMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${pad2(h)}:${pad2(m)}`;
    }
    return null;
  }

  const fourDigits = s.match(/^(\d{2})(\d{2})$/);
  if (fourDigits) {
    const h = Number(fourDigits[1]);
    const m = Number(fourDigits[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${pad2(h)}:${pad2(m)}`;
    }
    return null;
  }

  const threeDigits = s.match(/^(\d)(\d{2})$/);
  if (threeDigits) {
    const h = Number(threeDigits[1]);
    const m = Number(threeDigits[2]);
    if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
      return `${pad2(h)}:${pad2(m)}`;
    }
    return null;
  }

  const hourOnly = s.match(/^(\d{1,2})$/);
  if (hourOnly) {
    const h = Number(hourOnly[1]);
    if (h >= 0 && h <= 23) {
      return `${pad2(h)}:00`;
    }
    return null;
  }

  return null;
}

/** Increments or decrements the hour (00–23) or minute (00–59) with wrap-around. */
export function stepTime24h(current: string, part: "hour" | "minute", delta: number): string {
  const parsed = parseTime24h(current) ?? "00:00";
  let h = Number(parsed.slice(0, 2));
  let m = Number(parsed.slice(3, 5));
  if (part === "hour") {
    h = ((h + delta) % 24 + 24) % 24;
  } else {
    m = ((m + delta) % 60 + 60) % 60;
  }
  return `${pad2(h)}:${pad2(m)}`;
}

export interface TimeInput24hProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (nextTime: string) => void;
  required?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  "aria-label"?: string;
}

interface PopoverCoords {
  top: number;
  left: number;
}

const POPOVER_WIDTH = 224;
const POPOVER_HEIGHT = 276;

function computePopoverCoords(el: HTMLElement): PopoverCoords {
  const rect = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const openAbove = spaceBelow < POPOVER_HEIGHT && rect.top > POPOVER_HEIGHT + 12;
  const top = openAbove
    ? Math.max(8, rect.top - POPOVER_HEIGHT - 6)
    : Math.min(window.innerHeight - POPOVER_HEIGHT - 8, rect.bottom + 6);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
  return { top, left };
}

export function TimeInput24h({
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  compact = false,
  className,
  "aria-label": ariaLabel,
}: TimeInput24hProps) {
  const popoverId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minListRef = useRef<HTMLDivElement>(null);

  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords>({ top: 0, left: 0 });

  useEscapeDismiss(open, () => setOpen(false), `time-picker-24h-${popoverId}`);

  const displayValue = editingDraft !== null ? editingDraft : value;
  const normalizedCurrent = parseTime24h(displayValue) ?? parseTime24h(value) ?? "00:00";
  const selectedHour = normalizedCurrent.slice(0, 2);
  const selectedMinute = normalizedCurrent.slice(3, 5);

  // Keep popover anchored on scroll/resize and dismiss on outside click
  useEffect(() => {
    if (!open) return;

    const updatePos = () => {
      if (wrapperRef.current) {
        setCoords(computePopoverCoords(wrapperRef.current));
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    document.addEventListener("pointerdown", handlePointerDown);

    // Center active hour & minute options smoothly when opened
    const raf = window.requestAnimationFrame(() => {
      const activeH = hourListRef.current?.querySelector<HTMLElement>('[data-active="true"]');
      const activeM = minListRef.current?.querySelector<HTMLElement>('[data-active="true"]');
      activeH?.scrollIntoView({ block: "center" });
      activeM?.scrollIntoView({ block: "center" });
    });

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  function togglePicker() {
    if (disabled) return;
    if (!open && wrapperRef.current) {
      setCoords(computePopoverCoords(wrapperRef.current));
    }
    setOpen((prev) => !prev);
  }

  function commitTime(next: string) {
    setEditingDraft(null);
    setInvalid(false);
    inputRef.current?.setCustomValidity("");
    onChange(next);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const prev = editingDraft ?? value;
    let next = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);

    // Auto-insert colon when typing forward past 2 hour digits or pasting 4 digits (never fights Backspace)
    if (next.length === 4 && /^\d{4}$/.test(next)) {
      next = `${next.slice(0, 2)}:${next.slice(2)}`;
    } else if (next.length === 3 && /^\d{3}$/.test(next) && next.length > prev.length) {
      next = `${next.slice(0, 2)}:${next.slice(2)}`;
    }

    e.currentTarget.setCustomValidity("");
    setInvalid(false);
    setEditingDraft(next);

    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) {
      onChange(next);
    }
  }

  function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = (editingDraft ?? value).trim();
    if (!raw) {
      setEditingDraft(null);
      setInvalid(false);
      e.currentTarget.setCustomValidity("");
      if (!required) onChange("");
      return;
    }

    const parsed = parseTime24h(raw);
    if (parsed) {
      setEditingDraft(null);
      setInvalid(false);
      e.currentTarget.setCustomValidity("");
      onChange(parsed);
    } else {
      setInvalid(true);
      e.currentTarget.setCustomValidity("Enter a valid 24-hour time (00:00–23:59).");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const cursor = e.currentTarget.selectionStart ?? 0;
    const part: "hour" | "minute" = cursor <= 2 ? "hour" : "minute";
    const next = stepTime24h(normalizedCurrent, part, e.key === "ArrowUp" ? 1 : -1);
    commitTime(next);
    const input = e.currentTarget;
    window.requestAnimationFrame(() => {
      if (part === "hour") {
        input.setSelectionRange(0, 2);
      } else {
        input.setSelectionRange(3, 5);
      }
    });
  }

  const popoverNode =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label="Choose 24-hour time"
            style={{ top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
            className="fixed z-[140] rounded-2xl border border-border bg-surface p-2.5 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                24-Hour Time
              </span>
              <span className="rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary">
                {selectedHour}:{selectedMinute}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col">
                <span className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Hour
                </span>
                <div
                  ref={hourListRef}
                  className="flex h-44 flex-col gap-0.5 overflow-y-auto pr-0.5"
                >
                  {HOURS_24.map((h) => {
                    const active = h === selectedHour;
                    return (
                      <button
                        key={h}
                        type="button"
                        data-active={active ? "true" : undefined}
                        onClick={() => commitTime(`${h}:${selectedMinute}`)}
                        className={cn(
                          "!min-h-0 !min-w-0 flex h-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors",
                          active
                            ? "bg-primary text-primary-fg shadow-2xs"
                            : "text-fg hover:bg-surface-2",
                        )}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col">
                <span className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Min
                </span>
                <div
                  ref={minListRef}
                  className="flex h-44 flex-col gap-0.5 overflow-y-auto pr-0.5"
                >
                  {MINUTES_60.map((m) => {
                    const active = m === selectedMinute;
                    return (
                      <button
                        key={m}
                        type="button"
                        data-active={active ? "true" : undefined}
                        onClick={() => commitTime(`${selectedHour}:${m}`)}
                        className={cn(
                          "!min-h-0 !min-w-0 flex h-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors",
                          active
                            ? "bg-primary text-primary-fg shadow-2xs"
                            : "text-fg hover:bg-surface-2",
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => {
                  commitTime(isoTime(new Date()));
                  setOpen(false);
                }}
                className="!min-h-0 !min-w-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft transition-colors"
              >
                Now
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="!min-h-0 !min-w-0 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-fg hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "flex items-center justify-between gap-1.5 border border-border bg-surface text-fg transition-colors",
        compact
          ? "w-[5.5rem] rounded-lg px-2 py-1 text-xs font-medium focus-within:border-primary"
          : "h-11 w-full rounded-xl px-3 text-base md:text-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25",
        invalid && "border-danger focus-within:border-danger focus-within:ring-danger/25",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={5}
        placeholder="HH:MM"
        pattern="^([01]\d|2[0-3]):[0-5]\d$"
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "min-w-0 flex-1 bg-transparent tabular-nums text-fg outline-none placeholder:text-muted",
          compact ? "text-xs font-medium" : "text-base md:text-sm",
          disabled && "cursor-not-allowed",
        )}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={togglePicker}
        aria-label="Open 24-hour time picker"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-haspopup="dialog"
        className={cn(
          "!min-h-0 !min-w-0 flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
          compact ? "size-4" : "size-6",
        )}
      >
        <Clock className={compact ? "size-3.5" : "size-4"} aria-hidden />
      </button>
      {popoverNode}
    </div>
  );
}
