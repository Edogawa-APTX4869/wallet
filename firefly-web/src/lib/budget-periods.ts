import Decimal from "decimal.js";
import type { Budget, BudgetLimit, Resource, SpentEntry } from "@/lib/firefly/types";
import { sumDecimal } from "@/lib/utils";

export interface BudgetLimitSlice {
  id: string;
  start: string;
  end: string;
  amount: Decimal;
  spent: Decimal;
  left: Decimal;
  hasExplicitSpent: boolean;
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
  } = params;

  const spentEntries = b.attributes.spent ?? [];
  const budgetMonthSpent = sumDecimal(spentEntries.map((s) => new Decimal(s.sum || 0).abs()));

  const matchingLimits = limits
    .filter((l) => String(l.attributes.budget_id) === String(b.id))
    .sort((a, z) => (z.attributes.start || "").localeCompare(a.attributes.start || ""));

  const periodLimits: BudgetLimitSlice[] = matchingLimits.map((l) => {
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
    const spent = parsedSpent ?? new Decimal(0);
    const sliceDecimals =
      l.attributes.currency_decimal_places ??
      (sliceCode && currencyDecimalsByCode ? currencyDecimalsByCode[sliceCode.toUpperCase()] : undefined) ??
      spentEntries[0]?.currency_decimal_places ??
      defaultDecimals;

    return {
      id: l.id,
      start,
      end,
      amount,
      spent,
      left: amount.minus(spent),
      hasExplicitSpent,
      isActive: start <= today && end >= today,
      currencyCode: l.attributes.currency_code,
      decimals: sliceDecimals,
      notes: l.attributes.notes ?? null,
    };
  });

  // For single-limit budgets where the API response omitted `spent` on the limit object,
  // carry over the budget's period spent so single monthly budgets stay accurate.
  if (periodLimits.length === 1 && !periodLimits[0].hasExplicitSpent) {
    periodLimits[0] = {
      ...periodLimits[0],
      spent: budgetMonthSpent,
      left: periodLimits[0].amount.minus(budgetMonthSpent),
    };
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

  // Primary display stats: use the active/selected period slice when available
  // (e.g. current week `2026-11-16 -> 2026-11-22`: Spent BHD 0.000 of BHD 10.000),
  // rather than mixing summed weekly limits with cumulative monthly spending.
  const limitVal = activeSlice
    ? activeSlice.amount
    : new Decimal(b.attributes.auto_budget_amount ?? 0);
  const spentVal = activeSlice ? activeSlice.spent : monthSpent;
  const leftVal = limitVal.minus(spentVal);

  return {
    raw: b,
    id: b.id,
    limitId: activeSlice?.id ?? null,
    limitStart: activeSlice?.start ?? rangeStart,
    limitEnd: activeSlice?.end ?? rangeEnd,
    limitNotes: activeSlice?.notes ?? null,
    periodLimits,
    isSubPeriod,
    hasActiveSlice: Boolean(activeSlice?.isActive),
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
    code,
    decimals,
  };
}
