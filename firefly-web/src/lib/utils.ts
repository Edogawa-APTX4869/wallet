import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Decimal from "decimal.js";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const fmtCache = new Map<string, Intl.NumberFormat>();

/** Formats money using the currency code when Intl knows it, else symbol + number. */
export function formatMoney(
  amount: Decimal.Value | null | undefined,
  code?: string | null,
  decimals?: number | null,
  symbol?: string | null,
  opts: { signed?: boolean; skipCurrency?: boolean } = {},
): string {
  let n: number;
  try {
    n = new Decimal(amount ?? 0).toNumber();
  } catch {
    n = 0;
  }
  const hasExplicitDecimals = typeof decimals === "number";

  if (opts.skipCurrency) {
    const key = `decimal|${hasExplicitDecimals ? decimals : "auto"}|${opts.signed}`;
    let f = fmtCache.get(key);
    if (!f) {
      f = new Intl.NumberFormat(undefined, {
        style: "decimal",
        ...(hasExplicitDecimals
          ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
          : {}),
        signDisplay: opts.signed ? "exceptZero" : "auto",
      });
      fmtCache.set(key, f);
    }
    return f.format(n);
  }

  const key = `${code}|${hasExplicitDecimals ? decimals : "auto"}|${opts.signed}`;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, {
        style: code ? "currency" : "decimal",
        currency: code || undefined,
        ...(hasExplicitDecimals
          ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
          : {}),
        signDisplay: opts.signed ? "exceptZero" : "auto",
      });
    } catch {
      const fallbackDec = decimals ?? 2;
      f = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: fallbackDec,
        maximumFractionDigits: fallbackDec,
        signDisplay: opts.signed ? "exceptZero" : "auto",
      });
      const plain = f;
      const sym = symbol || code || "";
      return `${sym} ${plain.format(n)}`.trim();
    }
    fmtCache.set(key, f);
  }
  return f.format(n);
}

/** Returns a zero placeholder like "0.000" for 3-decimal currencies (BHD) or "0.00" for 2-decimal currencies. */
export function zeroPlaceholder(decimals = 2): string {
  return decimals > 0 ? `0.${"0".repeat(decimals)}` : "0";
}

/** Local date as YYYY-MM-DD (not UTC, so late-evening entries don't shift a day). */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local time as HH:MM (24-hour). */
export function isoTime(d: Date = new Date()): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Combines a local date (`YYYY-MM-DD`) and local time (`HH:MM` or `HH:MM:SS`)
 * into an ISO-8601 timestamp with local timezone offset for Firefly III storage.
 */
export function isoDateTimeWithOffset(
  dateStr?: string,
  timeStr?: string,
  now: Date = new Date(),
): string {
  const trimmedDate = (dateStr ?? "").trim();
  if (trimmedDate.includes("T") && !timeStr) {
    return trimmedDate;
  }
  const datePart = /^\d{4}-\d{2}-\d{2}/.test(trimmedDate)
    ? trimmedDate.slice(0, 10)
    : isoDate(now);

  const cleanTime = (timeStr ?? "").trim();
  let hh: string;
  let mm: string;
  let ss: string;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime)) {
    hh = cleanTime.slice(0, 2);
    mm = cleanTime.slice(3, 5);
    if (cleanTime.length >= 8) {
      ss = cleanTime.slice(6, 8);
    } else {
      ss = cleanTime.slice(0, 5) === isoTime(now)
        ? String(now.getSeconds()).padStart(2, "0")
        : "00";
    }
  } else {
    hh = String(now.getHours()).padStart(2, "0");
    mm = String(now.getMinutes()).padStart(2, "0");
    ss = String(now.getSeconds()).padStart(2, "0");
  }

  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOff = Math.abs(offsetMinutes);
  const offH = String(Math.floor(absOff / 60)).padStart(2, "0");
  const offM = String(absOff % 60).padStart(2, "0");
  return `${datePart}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

/** Extracts local `YYYY-MM-DD` from a Firefly ISO timestamp or date-only string. */
export function extractLocalDate(raw?: string | null, fallback: Date = new Date()): string {
  const s = (raw ?? "").trim();
  if (!s) return isoDate(fallback);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : isoDate(fallback);
  }
  return isoDate(parsed);
}

/** Extracts local `HH:MM` from a Firefly ISO timestamp (falls back to current time if date-only/missing). */
export function extractLocalTime(raw?: string | null, fallback: Date = new Date()): string {
  const s = (raw ?? "").trim();
  if (!s || !s.includes("T")) return isoTime(fallback);
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return isoTime(fallback);
  return isoTime(parsed);
}

export function monthRange(offset = 0, base: Date = new Date()): { start: string; end: string; label: string } {
  const s = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const e = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
  return {
    start: isoDate(s),
    end: isoDate(e),
    label: s.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
  };
}

export function formatDate(d: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, opts);
}

/** Formats a timestamp's local time in strict 24-hour HH:MM format (00:00–23:59). */
export function formatTime(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return isoTime(date);
}

/** Formats a transaction timestamp with date + 24-hour time (HH:MM) when a time component exists. */
export function formatDateTime(d: string | Date): string {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    return formatDate(d);
  }
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return `${formatDate(date)}, ${formatTime(date)}`;
}

/** Accepts "1,234.50", "1234,50" and similar; returns a canonical decimal string or "". */
export function parseAmount(input: string): string {
  let s = input.trim().replace(/\s/g, "");
  if (!s) return "";
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is decimal separator
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d.toString() : "";
  } catch {
    return "";
  }
}

export function sumDecimal(values: Array<Decimal.Value | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => {
    try {
      return acc.plus(v ?? 0);
    } catch {
      return acc;
    }
  }, new Decimal(0));
}
