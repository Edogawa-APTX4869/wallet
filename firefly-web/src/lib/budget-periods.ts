import Decimal from "decimal.js";
import type { Budget, BudgetLimit, Resource, SpentEntry, TransactionGroup } from "@/lib/firefly/types";
import { extractLocalDate, sumDecimal } from "@/lib/utils";

interface TemporalPlainDateLike {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  add(duration: { days?: number }): TemporalPlainDateLike;
  until(other: TemporalPlainDateLike, options?: { largestUnit?: string }): { days: number };
  toString(): string;
}

interface TemporalGlobalLike {
  PlainDate?: {
    from(item: string): TemporalPlainDateLike;
  };
}

function getTemporalPlainDateConstructor(): TemporalGlobalLike["PlainDate"] | undefined {
  const g = globalThis as typeof globalThis & { Temporal?: TemporalGlobalLike };
  return g.Temporal?.PlainDate;
}

function parseIsoCalendarParts(iso: string): [number, number, number] {
  const clean = iso.slice(0, 10);
  const [yStr, mStr, dStr] = clean.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  return [y, m, d];
}

/** Shifts a location-agnostic `YYYY-MM-DD` calendar date by `deltaDays` without local-timezone drift. */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const clean = iso.slice(0, 10);
  const PlainDate = getTemporalPlainDateConstructor();
  if (PlainDate) {
    return PlainDate.from(clean).add({ days: deltaDays }).toString();
  }
  const [y, m, d] = parseIsoCalendarParts(clean);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Returns ISO day of week (`1` = Monday .. `7` = Sunday) for a `YYYY-MM-DD` calendar date. */
export function isoDayOfWeek(iso: string): number {
  const clean = iso.slice(0, 10);
  const PlainDate = getTemporalPlainDateConstructor();
  if (PlainDate) {
    return PlainDate.from(clean).dayOfWeek;
  }
  const [y, m, d] = parseIsoCalendarParts(clean);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Returns the inclusive number of calendar days between `startIso` and `endIso`. */
export function daysBetweenIso(startIso: string, endIso: string): number {
  const s = startIso.slice(0, 10);
  const e = endIso.slice(0, 10);
  const PlainDate = getTemporalPlainDateConstructor();
  if (PlainDate) {
    return PlainDate.from(s).until(PlainDate.from(e), { largestUnit: "days" }).days + 1;
  }
  const [sy, sm, sd] = parseIsoCalendarParts(s);
  const [ey, em, ed] = parseIsoCalendarParts(e);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Pads a month/period query range by ±7 days so weekly limits straddling month
 * boundaries (e.g. `10-26 -> 11-01` or `11-30 -> 12-06`) are included by Firefly III.
 */
export function paddedBudgetLimitRange(rangeStart: string, rangeEnd: string): { start: string; end: string } {
  return {
    start: shiftIsoDate(rangeStart, -7),
    end: shiftIsoDate(rangeEnd, 7),
  };
}

export interface BudgetLimitSlice {
  id: string;
  limitId: string | null;
  start: string;
  end: string;
  amount: Decimal;
  spent: Decimal;
  left: Decimal;
  inMonthSpent?: Decimal;
  hasExplicitSpent: boolean;
  isSynthesized?: boolean;
  isActive: boolean;
  currencyCode?: string;
  decimals?: number;
  notes: string | null;
}

export interface BudgetPeriodRow {
  raw: Resource<Budget>;
  id: string;
  limitId: string | null;
  limitStart: string;
  limitEnd: string;
  limitNotes: string | null;
  periodLimits?: BudgetLimitSlice[];
  /** True when the budget uses sub-monthly limits (e.g. weekly limits inside a monthly view). */
  isSubPeriod?: boolean;
  /** True when `today` falls inside the selected primary limit's `[start, end]` window. */
  hasActiveSlice?: boolean;
  name: string;
  active: boolean;
  autoBudgetType?: string | null;
  autoBudgetAmount?: string | null;
  autoBudgetPeriod?: string | null;
  autoBudgetCurrencyCode?: string | null;
  /** Active/primary period limit amount (for sub-period budgets, the active week's limit). */
  limit: Decimal;
  /** Active/primary period spent amount (for sub-period budgets, the active week's spent). */
  spent: Decimal;
  /** Active/primary period remaining amount (`limit - spent`). */
  left: Decimal;
  /** Full selected-range cumulative limit across all `budget_limits` slices in the month. */
  monthLimit?: Decimal;
  /** Full selected-range cumulative spending across the month. */
  monthSpent?: Decimal;
  /** Full selected-range cumulative remaining (`monthLimit - monthSpent`). */
  monthLeft?: Decimal;
  /** Positive residual spending in `[rangeStart, rangeEnd]` not yet reflected in `periodLimits`. */
  unattributedSpent?: Decimal;
  code: string;
  decimals?: number;
}

/**
 * Formats a Decimal/numeric budget amount respecting the currency's decimal places (e.g. 3 for BHD).
 */
export function formatBudgetAmountInput(
  value: Decimal.Value | null | undefined,
  decimals?: number,
): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    const d = new Decimal(value);
    if (!d.isFinite()) return "";
    return typeof decimals === "number" ? d.toFixed(decimals) : d.toString();
  } catch {
    return "";
  }
}

/**
 * Parses Firefly III `BudgetLimit.attributes.spent` (and optional `pc_spent`) across all API shapes:
 * - `SpentEntry[]`: `[]` -> `0`, or sums matching-currency entries (`abs(sum)`)
 * - `string` / `number`: e.g. `"-18.750000000000"` -> `18.75`
 * - `null` / `""`: Firefly III explicit zero -> `0`
 * - `undefined`: field omitted -> returns `null` so callers can detect missing data
 */
export function parseBudgetLimitSpent(
  rawSpent: BudgetLimit["spent"],
  preferredCurrency?: string | null,
  rawPcSpent?: SpentEntry[] | null,
): Decimal | null {
  if (rawSpent === undefined) {
    if (Array.isArray(rawPcSpent)) {
      return sumDecimal(rawPcSpent.map((s) => new Decimal(s.sum || 0).abs()));
    }
    return null;
  }
  if (rawSpent === null || rawSpent === "") {
    return new Decimal(0);
  }
  if (Array.isArray(rawSpent)) {
    if (rawSpent.length === 0) return new Decimal(0);
    if (preferredCurrency) {
      const sameCurrency = rawSpent.filter(
        (entry) =>
          entry.currency_code &&
          entry.currency_code.toUpperCase() === preferredCurrency.toUpperCase(),
      );
      if (sameCurrency.length > 0) {
        return sumDecimal(sameCurrency.map((s) => new Decimal(s.sum || 0).abs()));
      }
    }
    return sumDecimal(rawSpent.map((s) => new Decimal(s.sum || 0).abs()));
  }
  try {
    return new Decimal(rawSpent).abs();
  } catch {
    return new Decimal(0);
  }
}

/**
 * Selects the currently active `budget_limit` slice (`start <= today <= end`),
 * falling back to the most recent limit slice when `today` is outside all limits.
 */
export function selectActiveBudgetLimit(
  slices: BudgetLimitSlice[],
  today: string,
): BudgetLimitSlice | null {
  if (slices.length === 0) return null;
  const active = slices.find((s) => s.start <= today && s.end >= today);
  return active ?? slices[0];
}

/**
 * Computes both active-period stats and full-month cumulative stats for a Firefly III budget.
 */
export function resolveBudgetPeriodRow(params: {
  budget: Resource<Budget>;
  limits: Resource<BudgetLimit>[];
  rangeStart: string;
  rangeEnd: string;
  today: string;
  defaultCode: string;
  defaultDecimals?: number;
  currencyDecimalsByCode?: Record<string, number>;
  transactions?: Resource<TransactionGroup>[];
}): BudgetPeriodRow {
  const {
    budget: b,
    limits,
    rangeStart,
    rangeEnd,
    today,
    defaultCode,
    defaultDecimals,
    currencyDecimalsByCode,
    transactions,
  } = params;

  const spentEntries = b.attributes.spent ?? [];
  const budgetMonthSpent = sumDecimal(spentEntries.map((s) => new Decimal(s.sum || 0).abs()));

  const matchingLimits = limits
    .filter((l) => {
      if (String(l.attributes.budget_id) !== String(b.id)) return false;
      const lStart = (l.attributes.start || rangeStart).slice(0, 10);
      const lEnd = (l.attributes.end || rangeEnd).slice(0, 10);
      return lEnd >= rangeStart && lStart <= rangeEnd;
    })
    .sort((a, z) => (z.attributes.start || "").localeCompare(a.attributes.start || ""));

  const primaryBudgetCode =
    matchingLimits[0]?.attributes.currency_code ||
    spentEntries[0]?.currency_code ||
    b.attributes.auto_budget_currency_code ||
    defaultCode;

  const primaryBudgetDecimals =
    matchingLimits[0]?.attributes.currency_decimal_places ??
    spentEntries[0]?.currency_decimal_places ??
    (primaryBudgetCode && currencyDecimalsByCode
      ? currencyDecimalsByCode[primaryBudgetCode.toUpperCase()]
      : undefined) ??
    defaultDecimals;

  const budgetIdStr = String(b.id);
  const budgetNameNorm = b.attributes.name.trim().toLowerCase();
  const preferredUpper = primaryBudgetCode.toUpperCase();

  const sumBudgetTxInRange = (winStart: string, winEnd: string): Decimal => {
    if (!transactions || transactions.length === 0) return new Decimal(0);
    let total = new Decimal(0);
    for (const grp of transactions) {
      for (const sp of grp.attributes.transactions ?? []) {
        if (sp.type !== "withdrawal") continue;
        const matchesBudget =
          (sp.budget_id !== undefined &&
            sp.budget_id !== null &&
            String(sp.budget_id) !== "" &&
            String(sp.budget_id) === budgetIdStr) ||
          Boolean(sp.budget_name && sp.budget_name.trim().toLowerCase() === budgetNameNorm);
        if (!matchesBudget) continue;
        const rawDate = (sp.date ?? "").trim();
        const spDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : extractLocalDate(rawDate);
        if (spDate < winStart || spDate > winEnd) continue;
        const spExt = sp as typeof sp & {
          pc_amount?: string | null;
          pc_currency_code?: string | null;
        };
        let amt = new Decimal(0);
        if (sp.currency_code && sp.currency_code.toUpperCase() === preferredUpper) {
          amt = new Decimal(sp.amount || 0).abs();
        } else if (
          sp.foreign_currency_code &&
          sp.foreign_currency_code.toUpperCase() === preferredUpper &&
          sp.foreign_amount
        ) {
          amt = new Decimal(sp.foreign_amount || 0).abs();
        } else if (
          spExt.pc_currency_code &&
          spExt.pc_currency_code.toUpperCase() === preferredUpper &&
          spExt.pc_amount
        ) {
          amt = new Decimal(spExt.pc_amount || 0).abs();
        } else {
          amt = new Decimal(sp.amount || 0).abs();
        }
        total = total.plus(amt);
      }
    }
    return total;
  };

  const totalTxInMonth = transactions ? sumBudgetTxInRange(rangeStart, rangeEnd) : null;
  const txMatchesBudgetMonth =
    totalTxInMonth !== null &&
    budgetMonthSpent.minus(totalTxInMonth).abs().lte(new Decimal("0.005"));

  const realSlices: BudgetLimitSlice[] = matchingLimits.map((l) => {
    const start = (l.attributes.start || rangeStart).slice(0, 10);
    const end = (l.attributes.end || rangeEnd).slice(0, 10);
    const amount = new Decimal(l.attributes.amount || 0);
    const sliceCode =
      l.attributes.currency_code ||
      b.attributes.auto_budget_currency_code ||
      spentEntries[0]?.currency_code ||
      defaultCode;
    const parsedSpent = parseBudgetLimitSpent(l.attributes.spent, sliceCode, l.attributes.pc_spent);
    const hasExplicitSpent = parsedSpent !== null;
    const txWeekSpent = transactions ? sumBudgetTxInRange(start, end) : null;
    let spent: Decimal;
    if (txWeekSpent !== null) {
      if (txMatchesBudgetMonth || parsedSpent === null) {
        spent = txWeekSpent;
      } else {
        spent = Decimal.max(parsedSpent, txWeekSpent);
      }
    } else {
      spent = parsedSpent ?? new Decimal(0);
    }
    const isStraddling = start < rangeStart || end > rangeEnd;
    const inMonthSpent = transactions
      ? isStraddling
        ? sumBudgetTxInRange(start < rangeStart ? rangeStart : start, end > rangeEnd ? rangeEnd : end)
        : spent
      : undefined;
    const sliceDecimals =
      l.attributes.currency_decimal_places ??
      (sliceCode && currencyDecimalsByCode ? currencyDecimalsByCode[sliceCode.toUpperCase()] : undefined) ??
      spentEntries[0]?.currency_decimal_places ??
      defaultDecimals;

    return {
      id: l.id,
      limitId: l.id,
      start,
      end,
      amount,
      spent,
      left: amount.minus(spent),
      inMonthSpent,
      hasExplicitSpent,
      isSynthesized: false,
      isActive: start <= today && end >= today,
      currencyCode: l.attributes.currency_code,
      decimals: sliceDecimals,
      notes: l.attributes.notes ?? null,
    };
  });

  // For single-limit budgets where the API response omitted `spent` on the limit object,
  // carry over the budget's period spent so single monthly budgets stay accurate.
  if (
    realSlices.length === 1 &&
    !realSlices[0].hasExplicitSpent &&
    (!transactions || realSlices[0].spent.eq(0))
  ) {
    realSlices[0] = {
      ...realSlices[0],
      spent: budgetMonthSpent,
      left: realSlices[0].amount.minus(budgetMonthSpent),
      inMonthSpent: budgetMonthSpent,
    };
  }

  const isWeeklyBudget =
    b.attributes.auto_budget_period === "weekly" ||
    realSlices.some((s) => {
      const d = daysBetweenIso(s.start, s.end);
      return d >= 5 && d <= 8;
    });

  let periodLimits: BudgetLimitSlice[] = [...realSlices];

  if (isWeeklyBudget) {
    const sevenDaySlice = realSlices.find((s) => daysBetweenIso(s.start, s.end) === 7);
    const weekStartDay = sevenDaySlice ? isoDayOfWeek(sevenDaySlice.start) : 1;
    const startDow = isoDayOfWeek(rangeStart);
    const backDays = (startDow - weekStartDay + 7) % 7;
    let curStart = shiftIsoDate(rangeStart, -backDays);

    while (curStart <= rangeEnd) {
      const curEnd = shiftIsoDate(curStart, 6);
      const hasOverlappingReal = realSlices.some((s) => s.end >= curStart && s.start <= curEnd);
      if (!hasOverlappingReal) {
        const clampedStart = curStart < rangeStart ? rangeStart : curStart;
        const clampedEnd = curEnd > rangeEnd ? rangeEnd : curEnd;
        const txWeekSpent = transactions ? sumBudgetTxInRange(curStart, curEnd) : new Decimal(0);
        const txInMonthSpent = transactions
          ? sumBudgetTxInRange(clampedStart, clampedEnd)
          : new Decimal(0);
        const isInterior = curStart >= rangeStart && curEnd <= rangeEnd;
        const isCurrentWeek = curStart <= today && curEnd >= today;

        if (isInterior || txInMonthSpent.gt(0) || isCurrentWeek) {
          periodLimits.push({
            id: `week:${curStart}:${curEnd}`,
            limitId: null,
            start: curStart,
            end: curEnd,
            amount: new Decimal(0),
            spent: txWeekSpent,
            left: new Decimal(0).minus(txWeekSpent),
            inMonthSpent: txInMonthSpent,
            hasExplicitSpent: Boolean(transactions),
            isSynthesized: true,
            isActive: isCurrentWeek,
            currencyCode: primaryBudgetCode,
            decimals: primaryBudgetDecimals,
            notes: null,
          });
        }
      }
      curStart = shiftIsoDate(curStart, 7);
    }

    periodLimits = periodLimits.sort((a, z) => z.start.localeCompare(a.start));
  }

  const activeSlice = selectActiveBudgetLimit(periodLimits, today);
  const isSubPeriod =
    periodLimits.length > 1 ||
    (activeSlice !== null && (activeSlice.start > rangeStart || activeSlice.end < rangeEnd));

  const code =
    activeSlice?.currencyCode ||
    spentEntries[0]?.currency_code ||
    b.attributes.auto_budget_currency_code ||
    defaultCode;

  const decimals =
    activeSlice?.decimals ??
    spentEntries[0]?.currency_decimal_places ??
    (code && currencyDecimalsByCode ? currencyDecimalsByCode[code.toUpperCase()] : undefined) ??
    defaultDecimals;

  const monthLimit =
    periodLimits.length > 0
      ? sumDecimal(periodLimits.map((l) => l.amount))
      : new Decimal(b.attributes.auto_budget_amount ?? 0);

  const slicesSpentSum =
    periodLimits.length > 0 ? sumDecimal(periodLimits.map((l) => l.spent)) : new Decimal(0);
  const monthSpent =
    spentEntries.length > 0 || budgetMonthSpent.gt(0) ? budgetMonthSpent : slicesSpentSum;
  const monthLeft = monthLimit.minus(monthSpent);

  const attributedSum =
    periodLimits.length > 0
      ? sumDecimal(periodLimits.map((s) => (transactions ? (s.inMonthSpent ?? s.spent) : s.spent)))
      : new Decimal(0);
  const rawResidual = monthSpent.minus(attributedSum);
  const unattributedSpent = rawResidual.gt(new Decimal("0.0005")) ? rawResidual : new Decimal(0);

  const isCurrentRange = today >= rangeStart && today <= rangeEnd;

  // Primary display stats: use the active/selected period slice when viewing the current range,
  // or full-month cumulative totals when viewing a historical/future month.
  const useMonthlyHeadline = isSubPeriod && !isCurrentRange;
  const limitVal = useMonthlyHeadline
    ? monthLimit
    : activeSlice
      ? activeSlice.amount
      : new Decimal(b.attributes.auto_budget_amount ?? 0);
  const spentVal = useMonthlyHeadline
    ? monthSpent
    : activeSlice
      ? activeSlice.spent
      : monthSpent;
  const leftVal = limitVal.minus(spentVal);

  return {
    raw: b,
    id: b.id,
    limitId: activeSlice?.limitId ?? null,
    limitStart: useMonthlyHeadline ? rangeStart : (activeSlice?.start ?? rangeStart),
    limitEnd: useMonthlyHeadline ? rangeEnd : (activeSlice?.end ?? rangeEnd),
    limitNotes: useMonthlyHeadline ? null : (activeSlice?.notes ?? null),
    periodLimits,
    isSubPeriod,
    hasActiveSlice: useMonthlyHeadline ? false : Boolean(activeSlice?.isActive),
    name: b.attributes.name,
    active: b.attributes.active,
    autoBudgetType: b.attributes.auto_budget_type,
    autoBudgetAmount: b.attributes.auto_budget_amount,
    autoBudgetPeriod: b.attributes.auto_budget_period,
    autoBudgetCurrencyCode: b.attributes.auto_budget_currency_code,
    limit: limitVal,
    spent: spentVal,
    left: leftVal,
    monthLimit,
    monthSpent,
    monthLeft,
    unattributedSpent,
    code,
    decimals,
  };
}
