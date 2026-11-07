import { describe, expect, it } from "vitest";
import { qs, FireflyError } from "@/lib/firefly/api";
import {
  getPresetDateRange,
  stepPeriod,
  getPriorPeriod,
  getPreviousPeriod,
  filterAccountsForStats,
  serializeFilterToQueryParams,
  deserializeFilterFromQueryParams,
  formatDate,
  parseDate,
  addDays,
  addMonths,
  addYears,
  getPeriodDisplayLabel,
  type PeriodPreset,
  type AccountFilterMode,
} from "@/lib/filter-presets";
import {
  evaluateCalcExpression,
  applyDenominationChip,
} from "@/app/(app)/new/new-transaction";
import {
  buildSearchQuery,
  filtersFromParams,
  EMPTY_FILTERS,
  type Filters,
} from "@/app/(app)/transactions/transactions-client";
import {
  computeBalanceTrend,
  computeCashFlowKpis,
  computeSpendingBreakdown,
  project30DayCashOutlook,
  computeCreditDebtGauge,
  type RecurrenceConfig,
  type UnpaidBillConfig,
} from "@/app/(app)/reports/components/reports-math";

describe("Tier 5 White-Box Adversarial Coverage Hardening Suite", () => {
  // ==========================================================================
  // Section 1: Firefly API Parameter Serialization & Error Hardening
  // ==========================================================================
  describe("1. Firefly API Parameter Serialization (qs) & Error Handling", () => {
    it("1.1 qs: handles empty, undefined, and null params gracefully", () => {
      expect(qs(undefined)).toBe("");
      expect(qs({})).toBe("");
    });

    it("1.2 qs: serializes primitive scalars with correct prefixes", () => {
      expect(qs({ page: 1, limit: 50 })).toBe("?page=1&limit=50");
      expect(qs({ active: true, include_net_worth: false })).toBe("?active=true&include_net_worth=false");
      expect(qs({ zero: 0 })).toBe("?zero=0");
    });

    it("1.3 qs: skips undefined, null, and empty string scalar properties", () => {
      expect(qs({ valid: "ok", undef: undefined, nul: null, empty: "" })).toBe("?valid=ok");
    });

    it("1.4 qs: handles array parameters without doubling brackets if already present", () => {
      const resWithBrackets = qs({ "accounts[]": ["1", "2"] });
      expect(resWithBrackets).toBe("?accounts%5B%5D=1&accounts%5B%5D=2");

      const resWithoutBrackets = qs({ accounts: ["1", "2"] });
      expect(resWithoutBrackets).toBe("?accounts%5B%5D=1&accounts%5B%5D=2");
    });

    it("1.5 qs: filters out null, undefined, and empty string elements inside arrays", () => {
      const res = qs({ accounts: ["1", "", null as unknown as string, undefined as unknown as string, "2"] });
      expect(res).toBe("?accounts%5B%5D=1&accounts%5B%5D=2");
    });

    it("1.6 qs: preserves numeric zero in array parameters", () => {
      const res = qs({ ids: [0, 1, 2] });
      expect(res).toBe("?ids%5B%5D=0&ids%5B%5D=1&ids%5B%5D=2");
    });

    it("1.7 qs: handles special characters, unicode, and spaces safely", () => {
      const res = qs({ query: "Coffee & Tea 🍵", tag: "groceries/supermarket" });
      expect(res).toContain("Coffee+%26+Tea+%F0%9F%8D%B5");
      expect(res).toContain("groceries%2Fsupermarket");
    });

    it("1.8 FireflyError: initializes status, message, and error fields record", () => {
      const err = new FireflyError("Validation failed", 422, { email: ["Must be valid"], amount: ["Required"] });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Validation failed");
      expect(err.status).toBe(422);
      expect(err.fields.email).toEqual(["Must be valid"]);
      expect(err.fields.amount).toEqual(["Required"]);

      // Default fields fallback to empty object
      const defaultErr = new FireflyError("Unauthorized", 401);
      expect(defaultErr.status).toBe(401);
      expect(defaultErr.fields).toEqual({});
    });
  });

  // ==========================================================================
  // Section 2: Universal Filter Engine Boundary & Calendar Math Hardening
  // ==========================================================================
  describe("2. Universal Filter Engine Boundary & Calendar Math Hardening", () => {
    it("2.1 parseDate: handles malformed, empty, and partial date strings safely", () => {
      const now = new Date();
      const emptyParsed = parseDate("");
      expect(emptyParsed).toBeInstanceOf(Date);
      expect(emptyParsed.getFullYear()).toBe(now.getFullYear());

      const gibberish = parseDate("invalid-date-string");
      expect(gibberish).toBeInstanceOf(Date);

      // Partial date without full days
      const partial = parseDate("2026-05");
      expect(partial).toBeInstanceOf(Date);

      // ISO timestamp format YYYY-MM-DDTHH:mm:ssZ parses first 10 characters cleanly
      const isoParsed = parseDate("2026-11-06T23:02:21Z");
      expect(isoParsed.getFullYear()).toBe(2026);
      expect(isoParsed.getMonth()).toBe(10); // November (0-indexed)
      expect(isoParsed.getDate()).toBe(6);
    });

    it("2.2 formatDate: correctly zero-pads single digit months and days", () => {
      const d = new Date(2026, 0, 5); // Jan 5, 2026
      expect(formatDate(d)).toBe("2026-01-05");

      const d2 = new Date(2026, 8, 9); // Sep 9, 2026
      expect(formatDate(d2)).toBe("2026-09-09");
    });

    it("2.3 addDays: negative and zero offsets across year boundaries", () => {
      const d = new Date(2026, 0, 1); // 2026-01-01
      expect(formatDate(addDays(d, 0))).toBe("2026-01-01");
      expect(formatDate(addDays(d, -1))).toBe("2025-12-31");
      expect(formatDate(addDays(d, -365))).toBe("2025-01-01");
      expect(formatDate(addDays(d, 365))).toBe("2027-01-01");
    });

    it("2.4 addMonths: end-of-month day clamping on 31-day months to 30-day and 28/29-day months", () => {
      // Jan 31 -> Feb 28 in 2025 (non-leap)
      const jan31NonLeap = new Date(2025, 0, 31);
      expect(formatDate(addMonths(jan31NonLeap, 1))).toBe("2025-02-28");

      // Jan 31 -> Feb 29 in 2024 (leap year)
      const jan31Leap = new Date(2024, 0, 31);
      expect(formatDate(addMonths(jan31Leap, 1))).toBe("2024-02-29");

      // Mar 31 -> Apr 30
      const mar31 = new Date(2026, 2, 31);
      expect(formatDate(addMonths(mar31, 1))).toBe("2026-04-30");

      // May 31 -> Jun 30
      const may31 = new Date(2026, 4, 31);
      expect(formatDate(addMonths(may31, 1))).toBe("2026-06-30");

      // Aug 31 -> Sep 30
      const aug31 = new Date(2026, 7, 31);
      expect(formatDate(addMonths(aug31, 1))).toBe("2026-09-30");

      // Oct 31 -> Nov 30
      const oct31 = new Date(2026, 9, 31);
      expect(formatDate(addMonths(oct31, 1))).toBe("2026-11-30");
    });

    it("2.5 addYears: handles leap day clamping to Feb 28 on non-leap years", () => {
      const leapDay = new Date(2024, 1, 29); // 2024-02-29
      expect(formatDate(addYears(leapDay, 1))).toBe("2025-02-28");
      expect(formatDate(addYears(leapDay, 2))).toBe("2026-02-28");
      expect(formatDate(addYears(leapDay, 3))).toBe("2027-02-28");
      expect(formatDate(addYears(leapDay, -1))).toBe("2023-02-28");
    });

    it("2.6 getPresetDateRange: validates all 10 presets with fixed reference date", () => {
      const ref = "2026-11-06";

      // 7D: T-6 to T
      const r7D = getPresetDateRange("7D", ref);
      expect(r7D.startDate).toBe("2026-10-31");
      expect(r7D.endDate).toBe("2026-11-06");

      // 30D: T-29 to T
      const r30D = getPresetDateRange("30D", ref);
      expect(r30D.startDate).toBe("2026-10-08");
      expect(r30D.endDate).toBe("2026-11-06");

      // 12W: T-83 to T (84 days)
      const r12W = getPresetDateRange("12W", ref);
      expect(r12W.startDate).toBe("2026-08-15");
      expect(r12W.endDate).toBe("2026-11-06");

      // 6M: 6 months ago to T
      const r6M = getPresetDateRange("6M", ref);
      expect(r6M.startDate).toBe("2026-05-06");
      expect(r6M.endDate).toBe("2026-11-06");

      // 1Y: 1 year ago to T
      const r1Y = getPresetDateRange("1Y", ref);
      expect(r1Y.startDate).toBe("2025-11-06");
      expect(r1Y.endDate).toBe("2026-11-06");

      // this_month: Nov 1 to Nov 30
      const rTm = getPresetDateRange("this_month", ref);
      expect(rTm.startDate).toBe("2026-11-01");
      expect(rTm.endDate).toBe("2026-11-30");

      // last_month: Oct 1 to Oct 31
      const rLm = getPresetDateRange("last_month", ref);
      expect(rLm.startDate).toBe("2026-10-01");
      expect(rLm.endDate).toBe("2026-10-31");

      // this_year: Jan 1 to Dec 31
      const rTy = getPresetDateRange("this_year", ref);
      expect(rTy.startDate).toBe("2026-01-01");
      expect(rTy.endDate).toBe("2026-12-31");

      // last_year: Jan 1 to Dec 31 of prior year
      const rLy = getPresetDateRange("last_year", ref);
      expect(rLy.startDate).toBe("2025-01-01");
      expect(rLy.endDate).toBe("2025-12-31");

      // custom: returns ref to ref
      const rCustom = getPresetDateRange("custom", ref);
      expect(rCustom.startDate).toBe("2026-11-06");
      expect(rCustom.endDate).toBe("2026-11-06");
    });

    it("2.7 stepPeriod: supports both functional overload signatures", () => {
      // 4-argument signature
      const resArgs = stepPeriod("7D", "2026-11-01", "2026-11-07", 1);
      expect(resArgs.startDate).toBe("2026-11-08");
      expect(resArgs.endDate).toBe("2026-11-14");

      // Object signature with start/end
      const resObj1 = stepPeriod({ preset: "7D", start: "2026-11-01", end: "2026-11-07" }, 1);
      expect(resObj1.startDate).toBe("2026-11-08");
      expect(resObj1.endDate).toBe("2026-11-14");

      // Object signature with startDate/endDate
      const resObj2 = stepPeriod({ preset: "7D", startDate: "2026-11-01", endDate: "2026-11-07" }, -1);
      expect(resObj2.startDate).toBe("2026-10-25");
      expect(resObj2.endDate).toBe("2026-10-31");
    });

    it("2.8 stepPeriod: custom range stepping preserves duration and handles single-day range", () => {
      // Single-day range: 2026-06-15 to 2026-06-15 (1 day duration)
      const singleDay = { preset: "custom" as PeriodPreset, startDate: "2026-06-15", endDate: "2026-06-15" };
      const nextDay = stepPeriod(singleDay, 1);
      expect(nextDay.startDate).toBe("2026-06-16");
      expect(nextDay.endDate).toBe("2026-06-16");

      const prevDay = stepPeriod(singleDay, -1);
      expect(prevDay.startDate).toBe("2026-06-14");
      expect(prevDay.endDate).toBe("2026-06-14");

      // 10-day custom range: 2026-06-01 to 2026-06-10 (10 days inclusive)
      const tenDays = { preset: "custom" as PeriodPreset, startDate: "2026-06-01", endDate: "2026-06-10" };
      const nextTen = stepPeriod(tenDays, 1);
      expect(nextTen.startDate).toBe("2026-06-11");
      expect(nextTen.endDate).toBe("2026-06-20");

      const prevTen = stepPeriod(tenDays, -1);
      expect(prevTen.startDate).toBe("2026-05-22");
      expect(prevTen.endDate).toBe("2026-05-31");
    });

    it("2.9 getPriorPeriod: perfectly contiguous, zero overlap and zero gap", () => {
      // 1 day range
      const prior1 = getPriorPeriod("2026-05-10", "2026-05-10");
      expect(prior1.startDate).toBe("2026-05-09");
      expect(prior1.endDate).toBe("2026-05-09");

      // 7 days: Nov 1 to Nov 7 -> Oct 25 to Oct 31
      const prior7 = getPriorPeriod("2026-11-01", "2026-11-07");
      expect(prior7.startDate).toBe("2026-10-25");
      expect(prior7.endDate).toBe("2026-10-31");
      expect(getPreviousPeriod("2026-11-01", "2026-11-07")).toEqual(prior7);
    });

    it("2.10 getPeriodDisplayLabel: returns human labels and custom range fallback", () => {
      expect(getPeriodDisplayLabel("7D", "2026-11-01", "2026-11-07")).toBe("Last 7 days");
      expect(getPeriodDisplayLabel("this_month", "2026-11-01", "2026-11-30")).toBe("This month");
      expect(getPeriodDisplayLabel("custom", "2026-01-10", "2026-01-20")).toBe("2026-01-10 – 2026-01-20");
    });
  });

  // ==========================================================================
  // Section 3: Account Filtering for Stats & Net Worth Exclusions
  // ==========================================================================
  describe("3. Account Filtering for Stats & Net Worth Exclusions", () => {
    const mockAccounts = [
      { id: "1", attributes: { name: "Checking", include_net_worth: true, active: true } },
      { id: "2", attributes: { name: "Savings", include_net_worth: true, active: true } },
      { id: "3", attributes: { name: "Secret Stash", include_net_worth: false, active: true } },
      { id: "4", include_net_worth: false }, // direct property variant
      { id: "5", attributes: { name: "Investment", active: true } }, // undefined include_net_worth (defaults to included)
    ];

    it("3.1 all_stats (default): filters out accounts where include_net_worth === false", () => {
      const filtered = filterAccountsForStats(mockAccounts, "all_stats");
      expect(filtered.map((a) => a.id)).toEqual(["1", "2", "5"]);
    });

    it("3.2 all: preserves all accounts without exclusions", () => {
      const filtered = filterAccountsForStats(mockAccounts, "all");
      expect(filtered.length).toBe(5);
    });

    it("3.3 custom: includes only accounts matching selectedAccountIds", () => {
      const filtered = filterAccountsForStats(mockAccounts, "custom", ["2", "3"]);
      expect(filtered.map((a) => a.id)).toEqual(["2", "3"]);
    });

    it("3.4 custom: returns empty array if no account IDs match or selection is empty", () => {
      const emptySelection = filterAccountsForStats(mockAccounts, "custom", []);
      expect(emptySelection).toEqual([]);

      const noMatch = filterAccountsForStats(mockAccounts, "custom", ["999", "888"]);
      expect(noMatch).toEqual([]);
    });
  });

  // ==========================================================================
  // Section 4: Query Serialization & Deserialization Hardening
  // ==========================================================================
  describe("4. Filter Query Serialization & Deserialization Hardening", () => {
    it("4.1 serializes FilterState cleanly to URLSearchParams", () => {
      const params = serializeFilterToQueryParams({
        preset: "30D",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        accountFilter: "custom",
        selectedAccountIds: ["1", "5"],
      });

      expect(params.get("period")).toBe("30D");
      expect(params.get("start")).toBe("2026-10-01");
      expect(params.get("end")).toBe("2026-10-31");
      expect(params.get("accountFilter")).toBe("custom");
      expect(params.getAll("accounts[]")).toEqual(["1", "5"]);
      expect(params.get("accounts")).toBe("1,5");
    });

    it("4.2 deserializes from URLSearchParams instance with array brackets", () => {
      const sp = new URLSearchParams("period=6M&start=2026-05-01&end=2026-11-01&accountFilter=custom&accounts[]=2&accounts[]=4");
      const parsed = deserializeFilterFromQueryParams(sp);

      expect(parsed.preset).toBe("6M");
      expect(parsed.startDate).toBe("2026-05-01");
      expect(parsed.endDate).toBe("2026-11-01");
      expect(parsed.accountFilter).toBe("custom");
      expect(parsed.selectedAccountIds).toEqual(["2", "4"]);
    });

    it("4.3 deserializes from comma-separated accounts query param", () => {
      const sp = new URLSearchParams("period=1Y&start=2025-11-01&end=2026-11-01&accounts=10%2C20%2C30");
      const parsed = deserializeFilterFromQueryParams(sp);

      expect(parsed.preset).toBe("1Y");
      expect(parsed.selectedAccountIds).toEqual(["10", "20", "30"]);
    });

    it("4.4 deserializes from Next.js server searchParams record object", () => {
      const record = {
        period: "this_year",
        start: "2026-01-01",
        end: "2026-12-31",
        account_filter: "all",
        "accounts[]": ["7", "8"],
      };
      const parsed = deserializeFilterFromQueryParams(record);

      expect(parsed.preset).toBe("this_year");
      expect(parsed.startDate).toBe("2026-01-01");
      expect(parsed.endDate).toBe("2026-12-31");
      expect(parsed.accountFilter).toBe("all");
      expect(parsed.selectedAccountIds).toEqual(["7", "8"]);
    });

    it("4.5 ignores unrecognized preset strings and preserves valid state", () => {
      const sp = new URLSearchParams("period=hack_the_planet&start=2026-01-01&end=2026-01-31");
      const parsed = deserializeFilterFromQueryParams(sp);
      expect(parsed.preset).toBeUndefined(); // ignores invalid preset
      expect(parsed.startDate).toBe("2026-01-01");
    });
  });

  // ==========================================================================
  // Section 5: Keyboard PEMDAS Math & Denomination Evaluator Hardening
  // ==========================================================================
  describe("5. Desktop Math Evaluator & Denomination Chips Hardening", () => {
    it("5.1 evaluateCalcExpression: PEMDAS operator precedence is strictly respected", () => {
      // 150 + 25 * 3 = 150 + 75 = 225
      expect(evaluateCalcExpression("150 + 25 * 3")).toBe("225");
      // 25 * 3 + 150 = 225
      expect(evaluateCalcExpression("25 * 3 + 150")).toBe("225");
      // 100 - 40 / 2 = 100 - 20 = 80
      expect(evaluateCalcExpression("100 - 40 / 2")).toBe("80");
      // 10 + 20 * 30 / 4 - 5 = 10 + 150 - 5 = 155
      expect(evaluateCalcExpression("10 + 20 * 30 / 4 - 5")).toBe("155");
    });

    it("5.2 evaluateCalcExpression: parentheses override default precedence", () => {
      // (150 + 25) * 3 = 175 * 3 = 525
      expect(evaluateCalcExpression("(150 + 25) * 3")).toBe("525");
      // (100 - 40) / 2 = 60 / 2 = 30
      expect(evaluateCalcExpression("(100 - 40) / 2")).toBe("30");
      // ((10 + 20) * (30 - 10)) / (5 * 4) = (30 * 20) / 20 = 600 / 20 = 30
      expect(evaluateCalcExpression("((10 + 20) * (30 - 10)) / (5 * 4)")).toBe("30");
    });

    it("5.3 evaluateCalcExpression: division by zero returns '0' safely without NaN or error", () => {
      expect(evaluateCalcExpression("100 / 0")).toBe("0");
      expect(evaluateCalcExpression("50 / (10 - 10)")).toBe("0");
      expect(evaluateCalcExpression("0 / 0")).toBe("0");
      expect(evaluateCalcExpression("(100 / 0) + 50")).toBe("50");
    });

    it("5.4 evaluateCalcExpression: negative results are clamped to '0'", () => {
      expect(evaluateCalcExpression("10 - 50")).toBe("0");
      expect(evaluateCalcExpression("0 - 100")).toBe("0");
      expect(evaluateCalcExpression("25 - 50 * 2")).toBe("0");
    });

    it("5.5 evaluateCalcExpression: handles unclosed parentheses and trailing operators gracefully", () => {
      // User is midway through typing: "150 +"
      expect(evaluateCalcExpression("150 +")).toBe("150");
      expect(evaluateCalcExpression("150 *")).toBe("150");
      expect(evaluateCalcExpression("150 -")).toBe("150");
      expect(evaluateCalcExpression("150 /")).toBe("150");

      // User opened parentheses without closing: "((10 + 20"
      expect(evaluateCalcExpression("((10 + 20")).toBe("30");
      expect(evaluateCalcExpression("(150 + 25")).toBe("175");
    });

    it("5.6 evaluateCalcExpression: handles arbitrary precision with Decimal.js", () => {
      expect(evaluateCalcExpression("9999999999 + 1")).toBe("10000000000");
      expect(evaluateCalcExpression("0.00000001 + 0.00000002")).toBe("0.00000003");
      expect(evaluateCalcExpression("12.5 * 4.2 + 8.75 / 2.5 - 1.5")).toBe("54.5");
    });

    it("5.7 applyDenominationChip: adds chip deltas to evaluated amounts with negative clamping", () => {
      expect(applyDenominationChip("100", 10)).toBe("110");
      expect(applyDenominationChip("100", 50)).toBe("150");
      expect(applyDenominationChip("100", 100)).toBe("200");
      // Applying to expression
      expect(applyDenominationChip("150 + 25 * 3", 50)).toBe("275"); // 225 + 50 = 275
      // Applying to empty string or zero
      expect(applyDenominationChip("", 100)).toBe("100");
      expect(applyDenominationChip("0", 50)).toBe("50");
      // Clamping negative delta
      expect(applyDenominationChip("50", -100)).toBe("0");
    });
  });

  // ==========================================================================
  // Section 6: Universal Transactions Search Query Builder Hardening
  // ==========================================================================
  describe("6. Universal Transactions Search Query Builder Hardening", () => {
    it("6.1 buildSearchQuery: returns empty string when no filters or scope applied", () => {
      expect(buildSearchQuery(EMPTY_FILTERS)).toBe("");
    });

    it("6.2 buildSearchQuery: quotes values containing whitespace, keeps single words unquoted", () => {
      const f: Filters = {
        ...EMPTY_FILTERS,
        category: "Food & Drinks",
        tag: "business",
        budget: "Monthly Groceries",
      };
      const query = buildSearchQuery(f);
      expect(query).toContain('category_is:"Food & Drinks"');
      expect(query).toContain("tag_is:business");
      expect(query).toContain('budget_is:"Monthly Groceries"');
    });

    it("6.3 buildSearchQuery: falls back to universal date scope when dateAfter/dateBefore not set", () => {
      const f: Filters = { ...EMPTY_FILTERS, text: "coffee" };
      const scope = { startDate: "2026-11-01", endDate: "2026-11-30" };
      const query = buildSearchQuery(f, scope);
      expect(query).toContain("date_after:2026-11-01");
      expect(query).toContain("date_before:2026-11-30");
      expect(query).toContain("coffee");
    });

    it("6.4 buildSearchQuery: explicitly set dateAfter/dateBefore takes precedence over universal scope", () => {
      const f: Filters = {
        ...EMPTY_FILTERS,
        dateAfter: "2026-11-10",
        dateBefore: "2026-11-20",
      };
      const scope = { startDate: "2026-11-01", endDate: "2026-11-30" };
      const query = buildSearchQuery(f, scope);
      expect(query).toContain("date_after:2026-11-10");
      expect(query).toContain("date_before:2026-11-20");
      expect(query).not.toContain("date_after:2026-11-01");
    });

    it("6.5 buildSearchQuery: custom universal account filter formats single ID vs OR group", () => {
      // Single account
      const scopeSingle = {
        accountFilter: "custom" as AccountFilterMode,
        selectedAccountIds: ["42"],
      };
      expect(buildSearchQuery(EMPTY_FILTERS, scopeSingle)).toBe("account_id:42");

      // Multiple accounts
      const scopeMulti = {
        accountFilter: "custom" as AccountFilterMode,
        selectedAccountIds: ["1", "2", "3"],
      };
      expect(buildSearchQuery(EMPTY_FILTERS, scopeMulti)).toBe("(account_id:1 OR account_id:2 OR account_id:3)");
    });

    it("6.6 filtersFromParams: parses valid transaction types and filters out invalid ones", () => {
      expect(filtersFromParams((k) => (k === "type" ? "withdrawal" : null)).type).toBe("withdrawal");
      expect(filtersFromParams((k) => (k === "type" ? "deposit" : null)).type).toBe("deposit");
      expect(filtersFromParams((k) => (k === "type" ? "transfer" : null)).type).toBe("transfer");
      expect(filtersFromParams((k) => (k === "type" ? "malicious_type" : null)).type).toBe("");
    });
  });

  // ==========================================================================
  // Section 7: Reports Hub Analytical Math & Edge Cases Hardening
  // ==========================================================================
  describe("7. Reports Hub Analytical Math & Edge Cases Hardening", () => {
    it("7.1 computeBalanceTrend: handles zero baselines, debt reversals, and plunges", () => {
      // Zero prior to positive
      const upFromZero = computeBalanceTrend({ currentTotal: 500, previousTotal: 0 });
      expect(upFromZero.percentageChange).toBe(100);
      expect(upFromZero.trend).toBe("up");

      // Zero prior to negative
      const downFromZero = computeBalanceTrend({ currentTotal: -500, previousTotal: 0 });
      expect(downFromZero.percentageChange).toBe(-100);
      expect(downFromZero.trend).toBe("down");

      // Both zero
      const flatZero = computeBalanceTrend({ currentTotal: 0, previousTotal: 0 });
      expect(flatZero.percentageChange).toBe(0);
      expect(flatZero.trend).toBe("flat");

      // Debt reversal (-500 to +500)
      const reversal = computeBalanceTrend({ currentTotal: 500, previousTotal: -500 });
      expect(reversal.percentageChange).toBe(200);
      expect(reversal.trend).toBe("up");

      // Deficit plunge (+500 to -500)
      const plunge = computeBalanceTrend({ currentTotal: -500, previousTotal: 500 });
      expect(plunge.percentageChange).toBe(-200);
      expect(plunge.trend).toBe("down");
    });

    it("7.2 computeCashFlowKpis: calculates inflow, outflow, net saved, and savings rate percentage", () => {
      const txs = [
        { type: "deposit", amount: "5000" },
        { type: "opening balance", amount: "1000" },
        { type: "withdrawal", amount: "3500" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("5000");
      expect(kpis.outflow.toString()).toBe("3500");
      expect(kpis.netSaved.toString()).toBe("1500");
      // (1500 / 5000) * 100 = 30%
      expect(kpis.savingsRatePercent).toBe(30);

      // Deficit cash flow (outflow > inflow)
      const deficitTxs = [
        { type: "deposit", amount: "1000" },
        { type: "withdrawal", amount: "1500" },
      ];
      const defKpis = computeCashFlowKpis(deficitTxs);
      expect(defKpis.netSaved.toString()).toBe("-500");
      expect(defKpis.savingsRatePercent).toBe(-50);

      // Zero inflow (savings rate remains 0 without divide-by-zero)
      const zeroInflowTxs = [{ type: "withdrawal", amount: "500" }];
      const zeroKpis = computeCashFlowKpis(zeroInflowTxs);
      expect(zeroKpis.savingsRatePercent).toBe(0);
    });

    it("7.3 computeSpendingBreakdown: calculates category percentages, daily averages, and sorts descending", () => {
      const expenses = [
        { category: "Food & Dining", amount: "600" },
        { category: "Housing", amount: "1200" },
        { category: "", amount: "200" }, // should fall back to "Uncategorized"
      ];
      const res = computeSpendingBreakdown({ expenses, periodDays: 30 });
      expect(res.totalSpend.toString()).toBe("2000");
      // 2000 / 30 = 66.67 daily average
      expect(res.dailyAverage.toString()).toBe("66.67");

      expect(res.categories.length).toBe(3);
      // Housing: 1200 / 2000 = 60%
      expect(res.categories[0].name).toBe("Housing");
      expect(res.categories[0].percentage).toBe(60);
      // Food & Dining: 600 / 2000 = 30%
      expect(res.categories[1].name).toBe("Food & Dining");
      expect(res.categories[1].percentage).toBe(30);
      // Uncategorized: 200 / 2000 = 10%
      expect(res.categories[2].name).toBe("Uncategorized");
      expect(res.categories[2].percentage).toBe(10);
    });

    it("7.4 project30DayCashOutlook: simulates 30-day forward balances with recurrences and unpaid bills", () => {
      const recurrences: RecurrenceConfig[] = [
        { name: "Salary", amount: "3000", type: "income", cadence: "monthly", dayOfMonth: 15 },
        { name: "Internet", amount: "50", type: "expense", cadence: "monthly", dayOfMonth: 20 },
      ];
      const unpaidBills: UnpaidBillConfig[] = [
        { name: "Electricity", amount: "120", dueDate: "2026-11-10" },
      ];

      const outlook = project30DayCashOutlook({
        startingBalance: "2000",
        startDate: "2026-11-06",
        recurrences,
        unpaidBills,
      });

      expect(outlook.dailyBalances.length).toBe(30);
      expect(outlook.dailyBalances[0].date).toBe("2026-11-07");
      expect(outlook.dailyBalances[29].date).toBe("2026-12-06");

      // Nov 10 should subtract Electricity ($120) -> 2000 - 120 = 1880
      const nov10 = outlook.dailyBalances.find((d) => d.date === "2026-11-10");
      expect(nov10?.balance.toString()).toBe("1880");

      // Nov 15 should add Salary ($3000) -> 1880 + 3000 = 4880
      const nov15 = outlook.dailyBalances.find((d) => d.date === "2026-11-15");
      expect(nov15?.balance.toString()).toBe("4880");

      // Nov 20 should subtract Internet ($50) -> 4880 - 50 = 4830
      const nov20 = outlook.dailyBalances.find((d) => d.date === "2026-11-20");
      expect(nov20?.balance.toString()).toBe("4830");

      // Min balance was Nov 10 ($1880)
      expect(outlook.minBalance.toString()).toBe("1880");
      expect(outlook.minBalanceDate).toBe("2026-11-10");
    });

    it("7.5 computeCreditDebtGauge: calculates revolving utilization, limits, and risk thresholds", () => {
      const accounts = [
        // Credit card 1: $1000 balance, $5000 limit
        { liability_type: "credit_card", current_balance: "1000", credit_limit: "5000" },
        // Credit card 2: $500 balance, $2500 limit
        { account_role: "ccAsset", current_balance: "500", credit_limit: "2500" },
        // Term loan (non-revolving): $15000 balance
        { liability_type: "mortgage", current_balance: "15000" },
      ];

      const gauge = computeCreditDebtGauge(accounts);
      expect(gauge.totalDebt.toString()).toBe("16500");
      expect(gauge.creditCardDebt.toString()).toBe("1500");
      expect(gauge.totalCreditLimit.toString()).toBe("7500");
      // (1500 / 7500) * 100 = 20%
      expect(gauge.utilizationPercent).toBe(20);
      expect(gauge.riskLevel).toBe("healthy");

      // Over-limit / high utilization check
      const highUtilAccounts = [
        { liability_type: "credit_card", current_balance: "4500", credit_limit: "5000" },
      ];
      const highGauge = computeCreditDebtGauge(highUtilAccounts);
      expect(highGauge.utilizationPercent).toBe(90);
      expect(highGauge.riskLevel).toBe("high");
    });
  });
});
