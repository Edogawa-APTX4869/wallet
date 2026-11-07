import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeBalanceTrend,
  computeCashFlowKpis,
  computeSpendingBreakdown,
  project30DayCashOutlook,
  computeCreditDebtGauge,
  type RecurrenceConfig,
  type UnpaidBillConfig,
} from "@/app/(app)/reports/components/reports-math";

describe("Milestone 4 Adversarial Stress Testing & Edge Cases", () => {
  // ==========================================================================
  // Section 1: Balance Trend Stress Tests
  // ==========================================================================
  describe("1. computeBalanceTrend: Extreme Boundaries & Inversions", () => {
    it("1.1: handles zero prior balance with positive current balance (+100%, up)", () => {
      const res = computeBalanceTrend({ currentTotal: 1000, previousTotal: 0 });
      expect(res.percentageChange).toBe(100);
      expect(res.difference.toString()).toBe("1000");
      expect(res.trend).toBe("up");
    });

    it("1.2: handles zero prior balance with negative current balance (-100%, down)", () => {
      const res = computeBalanceTrend({ currentTotal: -750, previousTotal: 0 });
      expect(res.percentageChange).toBe(-100);
      expect(res.difference.toString()).toBe("-750");
      expect(res.trend).toBe("down");
    });

    it("1.3: handles both current and prior zero balance (0%, flat)", () => {
      const res = computeBalanceTrend({ currentTotal: 0, previousTotal: 0 });
      expect(res.percentageChange).toBe(0);
      expect(res.difference.toString()).toBe("0");
      expect(res.trend).toBe("flat");
    });

    it("1.4: handles positive prior balance dropping to zero (-100%, down)", () => {
      const res = computeBalanceTrend({ currentTotal: 0, previousTotal: 2500 });
      expect(res.percentageChange).toBe(-100);
      expect(res.difference.toString()).toBe("-2500");
      expect(res.trend).toBe("down");
    });

    it("1.5: handles negative prior balance rising to zero (+100%, up)", () => {
      const res = computeBalanceTrend({ currentTotal: 0, previousTotal: -1200 });
      expect(res.percentageChange).toBe(100);
      expect(res.difference.toString()).toBe("1200");
      expect(res.trend).toBe("up");
    });

    it("1.6: handles debt turnaround (negative prior to positive current balance)", () => {
      // Prior was -500, now +500. Difference is +1000.
      // Percentage change relative to |prev|: (1000 / 500) * 100 = +200%
      const res = computeBalanceTrend({ currentTotal: 500, previousTotal: -500 });
      expect(res.difference.toString()).toBe("1000");
      expect(res.percentageChange).toBe(200);
      expect(res.trend).toBe("up");
    });

    it("1.7: handles deficit plunge (positive prior to negative current balance)", () => {
      // Prior was +500, now -500. Difference is -1000.
      // Percentage change: (-1000 / 500) * 100 = -200%
      const res = computeBalanceTrend({ currentTotal: -500, previousTotal: 500 });
      expect(res.difference.toString()).toBe("-1000");
      expect(res.percentageChange).toBe(-200);
      expect(res.trend).toBe("down");
    });

    it("1.8: handles deepening debt (negative prior to more negative current)", () => {
      // Prior was -1000, now -2500. Diff = -1500.
      // Percentage change: (-1500 / |-1000|) * 100 = -150%
      const res = computeBalanceTrend({ currentTotal: -2500, previousTotal: -1000 });
      expect(res.difference.toString()).toBe("-1500");
      expect(res.percentageChange).toBe(-150);
      expect(res.trend).toBe("down");
    });

    it("1.9: handles debt reduction (negative prior to less negative current)", () => {
      // Prior was -2000, now -800. Diff = +1200.
      // Percentage change: (+1200 / |-2000|) * 100 = +60%
      const res = computeBalanceTrend({ currentTotal: -800, previousTotal: -2000 });
      expect(res.difference.toString()).toBe("1200");
      expect(res.percentageChange).toBe(60);
      expect(res.trend).toBe("up");
    });

    it("1.10: maintains precision with multi-trillion balances without overflow", () => {
      const prev = "1000000000000.00"; // 1 trillion
      const cur = "1150000000000.00";  // 1.15 trillion
      const res = computeBalanceTrend({ currentTotal: cur, previousTotal: prev });
      expect(res.difference.toString()).toBe("150000000000");
      expect(res.percentageChange).toBe(15);
      expect(res.trend).toBe("up");
    });

    it("1.11: detects trend direction on microscopic sub-cent differences", () => {
      // 10000.0001 vs 10000.0000 -> difference is 0.0001
      const res = computeBalanceTrend({ currentTotal: "10000.0001", previousTotal: "10000.0000" });
      expect(res.difference.toString()).toBe("0.0001");
      expect(res.trend).toBe("up");
      // 0.0001 / 10000 * 100 = 0.000001 -> rounds to 0.00
      expect(res.percentageChange).toBe(0);
    });

    it("1.12: accepts Decimal instances, strings, and numbers interchangeably", () => {
      const fromDec = computeBalanceTrend({ currentTotal: new Decimal(150), previousTotal: new Decimal(100) });
      const fromStr = computeBalanceTrend({ currentTotal: "150", previousTotal: "100" });
      const fromNum = computeBalanceTrend({ currentTotal: 150, previousTotal: 100 });

      expect(fromDec.percentageChange).toBe(50);
      expect(fromStr.percentageChange).toBe(50);
      expect(fromNum.percentageChange).toBe(50);
      expect(fromDec.trend).toBe("up");
    });

    it("1.13: defaults missing or falsy values to 0 gracefully", () => {
      const res = computeBalanceTrend({ currentTotal: "" as unknown as string, previousTotal: 0 });
      expect(res.currentTotal.toString()).toBe("0");
      expect(res.percentageChange).toBe(0);
      expect(res.trend).toBe("flat");
    });
  });

  // ==========================================================================
  // Section 2: Cash-Flow KPIs & Savings Rate Stress Tests
  // ==========================================================================
  describe("2. computeCashFlowKpis: Zero Inflow, Massive Outflow & Precision", () => {
    it("2.1: handles zero inflow with massive outflow without division by zero", () => {
      const txs = [{ type: "withdrawal", amount: "10000000.00" }];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("0");
      expect(kpis.outflow.toString()).toBe("10000000");
      expect(kpis.netSaved.toString()).toBe("-10000000");
      // Division by zero inflow must safely yield 0% savings rate
      expect(kpis.savingsRatePercent).toBe(0);
      expect(Number.isFinite(kpis.savingsRatePercent)).toBe(true);
    });

    it("2.2: handles massive inflow with zero outflow (100% savings rate)", () => {
      const txs = [{ type: "deposit", amount: "5000000.00" }];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("5000000");
      expect(kpis.outflow.toString()).toBe("0");
      expect(kpis.netSaved.toString()).toBe("5000000");
      expect(kpis.savingsRatePercent).toBe(100);
    });

    it("2.3: handles empty transactions array safely", () => {
      const kpis = computeCashFlowKpis([]);
      expect(kpis.inflow.toString()).toBe("0");
      expect(kpis.outflow.toString()).toBe("0");
      expect(kpis.netSaved.toString()).toBe("0");
      expect(kpis.savingsRatePercent).toBe(0);
    });

    it("2.4: sanitizes negative transaction amounts via absolute value", () => {
      const txs = [
        { type: "deposit", amount: "-1500.00" },
        { type: "withdrawal", amount: "-800.00" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("1500");
      expect(kpis.outflow.toString()).toBe("800");
      expect(kpis.netSaved.toString()).toBe("700");
      // (700 / 1500) * 100 = 46.67%
      expect(kpis.savingsRatePercent).toBe(46.67);
    });

    it("2.5: handles dissaving / deficit cash flow correctly", () => {
      const txs = [
        { type: "deposit", amount: "1000.00" },
        { type: "withdrawal", amount: "2500.00" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("1000");
      expect(kpis.outflow.toString()).toBe("2500");
      expect(kpis.netSaved.toString()).toBe("-1500");
      // (-1500 / 1000) * 100 = -150%
      expect(kpis.savingsRatePercent).toBe(-150);
    });

    it("2.6: excludes 'opening balance' transactions from operating cash flow inflow", () => {
      const txs = [
        { type: "opening balance", amount: "10000.00" },
        { type: "withdrawal", amount: "2000.00" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("0");
      expect(kpis.outflow.toString()).toBe("2000");
      expect(kpis.netSaved.toString()).toBe("-2000");
      expect(kpis.savingsRatePercent).toBe(0);
    });

    it("2.7: ignores transfers and non-flow transaction types", () => {
      const txs = [
        { type: "transfer", amount: "5000.00" },
        { type: "reconciliation", amount: "300.00" },
        { type: "deposit", amount: "1000.00" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("1000");
      expect(kpis.outflow.toString()).toBe("0");
      expect(kpis.netSaved.toString()).toBe("1000");
      expect(kpis.savingsRatePercent).toBe(100);
    });

    it("2.8: processes 1,000 micro-transactions without precision drift", () => {
      const txs: Array<{ type: string; amount: string }> = [];
      // 500 deposits of 1.25 = 625.00
      for (let i = 0; i < 500; i++) {
        txs.push({ type: "deposit", amount: "1.25" });
      }
      // 500 withdrawals of 0.75 = 375.00
      for (let i = 0; i < 500; i++) {
        txs.push({ type: "withdrawal", amount: "0.75" });
      }
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("625");
      expect(kpis.outflow.toString()).toBe("375");
      expect(kpis.netSaved.toString()).toBe("250");
      // (250 / 625) * 100 = 40%
      expect(kpis.savingsRatePercent).toBe(40);
    });

    it("2.9: evaluates sub-penny transaction amounts without loss of precision", () => {
      const txs = [
        { type: "deposit", amount: "0.001" },
        { type: "deposit", amount: "0.002" },
        { type: "withdrawal", amount: "0.001" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("0.003");
      expect(kpis.outflow.toString()).toBe("0.001");
      expect(kpis.netSaved.toString()).toBe("0.002");
      // (0.002 / 0.003) * 100 = 66.67%
      expect(kpis.savingsRatePercent).toBe(66.67);
    });

    it("2.10: equal inflow and outflow yields exactly 0% savings rate and $0 net saved", () => {
      const txs = [
        { type: "deposit", amount: "3456.78" },
        { type: "withdrawal", amount: "3456.78" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("3456.78");
      expect(kpis.outflow.toString()).toBe("3456.78");
      expect(kpis.netSaved.toString()).toBe("0");
      expect(kpis.savingsRatePercent).toBe(0);
    });
  });

  // ==========================================================================
  // Section 3: Spending Breakdown Stress Tests
  // ==========================================================================
  describe("3. computeSpendingBreakdown: Micro-Transactions, Zero Period & Categories", () => {
    it("3.1: handles empty expenses array safely", () => {
      const res = computeSpendingBreakdown({ expenses: [], periodDays: 30 });
      expect(res.totalSpend.toString()).toBe("0");
      expect(res.categories).toEqual([]);
      expect(res.dailyAverage.toString()).toBe("0");
    });

    it("3.2: single category represents exactly 100% of spending", () => {
      const expenses = [{ category: "Rent", amount: "1800.00" }];
      const res = computeSpendingBreakdown({ expenses, periodDays: 30 });
      expect(res.totalSpend.toString()).toBe("1800");
      expect(res.categories.length).toBe(1);
      expect(res.categories[0].name).toBe("Rent");
      expect(res.categories[0].percentage).toBe(100);
      expect(res.dailyAverage.toString()).toBe("60");
    });

    it("3.3: processes hundreds of micro-transactions across categories", () => {
      const expenses: Array<{ category: string; amount: string }> = [];
      // 100 expenses in Groceries of 2.50 = 250
      for (let i = 0; i < 100; i++) expenses.push({ category: "Groceries", amount: "2.50" });
      // 100 expenses in Transit of 1.50 = 150
      for (let i = 0; i < 100; i++) expenses.push({ category: "Transit", amount: "1.50" });
      // 100 expenses in Coffee of 1.00 = 100
      for (let i = 0; i < 100; i++) expenses.push({ category: "Coffee", amount: "1.00" });

      const res = computeSpendingBreakdown({ expenses, periodDays: 25 });
      expect(res.totalSpend.toString()).toBe("500");
      expect(res.dailyAverage.toString()).toBe("20"); // 500 / 25
      expect(res.categories.length).toBe(3);
      expect(res.categories[0].name).toBe("Groceries");
      expect(res.categories[0].percentage).toBe(50);
      expect(res.categories[1].name).toBe("Transit");
      expect(res.categories[1].percentage).toBe(30);
      expect(res.categories[2].name).toBe("Coffee");
      expect(res.categories[2].percentage).toBe(20);
    });

    it("3.4: clamps zero periodDays to 1 to prevent division by zero", () => {
      const expenses = [{ category: "Snacks", amount: "25.00" }];
      const res = computeSpendingBreakdown({ expenses, periodDays: 0 });
      expect(res.totalSpend.toString()).toBe("25");
      expect(res.dailyAverage.toString()).toBe("25");
    });

    it("3.5: clamps negative periodDays to 1 to prevent invalid negative averages", () => {
      const expenses = [{ category: "Snacks", amount: "30.00" }];
      const res = computeSpendingBreakdown({ expenses, periodDays: -7 });
      expect(res.totalSpend.toString()).toBe("30");
      expect(res.dailyAverage.toString()).toBe("30");
    });

    it("3.6: calculates daily average over leap year duration (366 days)", () => {
      const expenses = [{ category: "Insurance", amount: "3660.00" }];
      const res = computeSpendingBreakdown({ expenses, periodDays: 366 });
      expect(res.dailyAverage.toString()).toBe("10");
    });

    it("3.7: unifies undefined, null, empty string, and whitespace categories to 'Uncategorized'", () => {
      const expenses = [
        { category: undefined, amount: "100.00" },
        { category: "", amount: "50.00" },
        { category: "   ", amount: "30.00" },
        { category: "\t\n", amount: "20.00" },
      ];
      const res = computeSpendingBreakdown({ expenses, periodDays: 10 });
      expect(res.categories.length).toBe(1);
      expect(res.categories[0].name).toBe("Uncategorized");
      expect(res.categories[0].amount.toString()).toBe("200");
      expect(res.categories[0].percentage).toBe(100);
    });

    it("3.8: normalizes negative expense amounts using absolute values", () => {
      const expenses = [{ category: "Refund", amount: "-75.50" }];
      const res = computeSpendingBreakdown({ expenses, periodDays: 1 });
      expect(res.totalSpend.toString()).toBe("75.5");
      expect(res.categories[0].amount.toString()).toBe("75.5");
    });

    it("3.9: handles tied spend amounts stably without crashing sort", () => {
      const expenses = [
        { category: "Alpha", amount: "500" },
        { category: "Beta", amount: "500" },
        { category: "Gamma", amount: "500" },
      ];
      const res = computeSpendingBreakdown({ expenses, periodDays: 15 });
      expect(res.categories.length).toBe(3);
      for (const cat of res.categories) {
        expect(cat.amount.toString()).toBe("500");
        expect(cat.percentage).toBe(33.33);
      }
    });

    it("3.10: percentages sum to 100% within standard rounding margin across multi-category split", () => {
      const expenses = [
        { category: "A", amount: "123.45" },
        { category: "B", amount: "234.56" },
        { category: "C", amount: "345.67" },
        { category: "D", amount: "456.78" },
      ];
      const res = computeSpendingBreakdown({ expenses, periodDays: 30 });
      const sumPct = res.categories.reduce((acc, c) => acc + c.percentage, 0);
      expect(Math.round(sumPct)).toBe(100);
    });
  });

  // ==========================================================================
  // Section 4: 30-Day Outlook Forward Runway Stress Tests
  // ==========================================================================
  describe("4. project30DayCashOutlook: Leap Years, Month Flips & Recurrences", () => {
    it("4.1: steps accurately across February 29 in leap year (2024)", () => {
      // 2024 is leap year: Feb 15 + 30 days ends on Mar 16
      const outlook = project30DayCashOutlook({
        startingBalance: "1000",
        startDate: "2024-02-15",
        recurrences: [{ name: "Daily", amount: "10", type: "expense", cadence: "daily" }],
        unpaidBills: [{ name: "Leap Bill", amount: "100", dueDate: "2024-02-29" }],
      });

      expect(outlook.dailyBalances.length).toBe(30);

      // Verify Feb 29 exists in leap year
      const feb29 = outlook.dailyBalances.find((d) => d.date === "2024-02-29");
      expect(feb29).toBeDefined();

      // Feb 15 to Feb 29 = 14 days offset.
      // Balance: 1000 - (14 * 10) - 100 = 760
      expect(feb29?.balance.toString()).toBe("760");

      // Verify the day after Feb 29 is March 1
      const mar01 = outlook.dailyBalances.find((d) => d.date === "2024-03-01");
      expect(mar01).toBeDefined();
      expect(mar01?.balance.toString()).toBe("750");

      // Day 30 is March 16 (since Feb has 29 days)
      expect(outlook.dailyBalances[29].date).toBe("2024-03-16");
    });

    it("4.2: steps across non-leap February (2025) skipping February 29 directly to March 1", () => {
      // 2025 is non-leap year: Feb 15 + 30 days ends on Mar 17
      const outlook = project30DayCashOutlook({
        startingBalance: "1000",
        startDate: "2025-02-15",
        recurrences: [{ name: "Daily", amount: "10", type: "expense", cadence: "daily" }],
        unpaidBills: [],
      });

      expect(outlook.dailyBalances.length).toBe(30);

      // Verify Feb 29 does NOT exist in 2025
      const feb29 = outlook.dailyBalances.find((d) => d.date === "2025-02-29");
      expect(feb29).toBeUndefined();

      // Feb 28 must be followed immediately by Mar 01
      const feb28 = outlook.dailyBalances.find((d) => d.date === "2025-02-28");
      const mar01 = outlook.dailyBalances.find((d) => d.date === "2025-03-01");
      expect(feb28).toBeDefined();
      expect(mar01).toBeDefined();

      // Day 30 is March 17 (since Feb has 28 days)
      expect(outlook.dailyBalances[29].date).toBe("2025-03-17");
    });

    it("4.3: handles century leap year 2000 (leap) vs century non-leap year 2100 (non-leap)", () => {
      // Year 2000: leap year
      const y2000 = project30DayCashOutlook({
        startingBalance: "500",
        startDate: "2000-02-20",
        recurrences: [],
        unpaidBills: [],
      });
      expect(y2000.dailyBalances.some((d) => d.date === "2000-02-29")).toBe(true);

      // Year 2100: century non-leap year
      const y2100 = project30DayCashOutlook({
        startingBalance: "500",
        startDate: "2100-02-20",
        recurrences: [],
        unpaidBills: [],
      });
      expect(y2100.dailyBalances.some((d) => d.date === "2100-02-29")).toBe(false);
    });

    it("4.4: steps across 31-day month transition into shorter month (Jan 15 -> Feb)", () => {
      const outlook = project30DayCashOutlook({
        startingBalance: "2000",
        startDate: "2026-01-15",
        recurrences: [],
        unpaidBills: [],
      });
      expect(outlook.dailyBalances.length).toBe(30);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-01-31")).toBe(true);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-02-01")).toBe(true);
      // Jan 15 + 30 days = Feb 14
      expect(outlook.dailyBalances[29].date).toBe("2026-02-14");
    });

    it("4.5: steps across 30-day month transition into 31-day month (Apr 15 -> May)", () => {
      const outlook = project30DayCashOutlook({
        startingBalance: "2000",
        startDate: "2026-04-15",
        recurrences: [],
        unpaidBills: [],
      });
      expect(outlook.dailyBalances.length).toBe(30);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-04-30")).toBe(true);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-04-31")).toBe(false);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-05-01")).toBe(true);
      // Apr 15 + 30 days = May 15
      expect(outlook.dailyBalances[29].date).toBe("2026-05-15");
    });

    it("4.6: steps across New Year rollover (Dec 15 -> Jan)", () => {
      const outlook = project30DayCashOutlook({
        startingBalance: "3000",
        startDate: "2026-12-15",
        recurrences: [],
        unpaidBills: [],
      });
      expect(outlook.dailyBalances.length).toBe(30);
      expect(outlook.dailyBalances.some((d) => d.date === "2026-12-31")).toBe(true);
      expect(outlook.dailyBalances.some((d) => d.date === "2027-01-01")).toBe(true);
      expect(outlook.dailyBalances[29].date).toBe("2027-01-14");
    });

    it("4.7: recurrence on day 31 does not fire in shorter month without day 31", () => {
      const recurrences: RecurrenceConfig[] = [
        { name: "Month-End Bonus", amount: "500", type: "income", cadence: "monthly", dayOfMonth: 31 },
      ];
      // February has no day 31
      const outlook = project30DayCashOutlook({
        startingBalance: "1000",
        startDate: "2026-02-01",
        recurrences,
        unpaidBills: [],
      });
      // Should remain flat 1000 because day 31 never occurs in February or early March
      expect(outlook.endingBalance.toString()).toBe("1000");
    });

    it("4.8: weekly recurrence fires on matching day of week", () => {
      // 2026-11-08 is Sunday (UTC day 0).
      // Weekly expense on Friday (dayOfWeek 5):
      // Nov 13, Nov 20, Nov 27, Dec 04 (4 Fridays in 30 days)
      const recurrences: RecurrenceConfig[] = [
        { name: "Friday Dining", amount: "50", type: "expense", cadence: "weekly", dayOfWeek: 5 },
      ];
      const outlook = project30DayCashOutlook({
        startingBalance: "1000",
        startDate: "2026-11-08",
        recurrences,
        unpaidBills: [],
      });

      // 4 Fridays * 50 = 200 expense -> ending balance 800
      expect(outlook.endingBalance.toString()).toBe("800");

      // Verify Friday Nov 13 dropped by 50
      const nov12 = outlook.dailyBalances.find((d) => d.date === "2026-11-12");
      const nov13 = outlook.dailyBalances.find((d) => d.date === "2026-11-13");
      expect(nov12?.balance.toString()).toBe("1000");
      expect(nov13?.balance.toString()).toBe("950");
    });

    it("4.9: handles negative starting balance in deep debt runway simulation", () => {
      const recurrences: RecurrenceConfig[] = [
        { name: "Salary", amount: "3000", type: "income", cadence: "monthly", dayOfMonth: 20 },
      ];
      const unpaidBills: UnpaidBillConfig[] = [
        { name: "Late Penalty", amount: "200", dueDate: "2026-11-12" },
      ];
      const outlook = project30DayCashOutlook({
        startingBalance: "-1500",
        startDate: "2026-11-06",
        recurrences,
        unpaidBills,
      });

      // Day 1 to 5: -1500
      // Day 6 (Nov 12): -1500 - 200 = -1700 (min balance)
      // Day 14 (Nov 20): -1700 + 3000 = +1300
      expect(outlook.minBalance.toString()).toBe("-1700");
      expect(outlook.minBalanceDate).toBe("2026-11-12");
      expect(outlook.endingBalance.toString()).toBe("1300");
    });

    it("4.10: processes multiple bills and recurrences occurring on the exact same date", () => {
      const unpaidBills: UnpaidBillConfig[] = [
        { name: "Bill 1", amount: "100", dueDate: "2026-11-15" },
        { name: "Bill 2", amount: "250", dueDate: "2026-11-15" },
      ];
      const recurrences: RecurrenceConfig[] = [
        { name: "Recurrence Expense", amount: "50", type: "expense", cadence: "monthly", dayOfMonth: 15 },
        { name: "Recurrence Income", amount: "500", type: "income", cadence: "monthly", dayOfMonth: 15 },
      ];
      const outlook = project30DayCashOutlook({
        startingBalance: "1000",
        startDate: "2026-11-06",
        recurrences,
        unpaidBills,
      });

      // On Nov 15: +500 - 50 - 100 - 250 = +100 net
      const nov14 = outlook.dailyBalances.find((d) => d.date === "2026-11-14");
      const nov15 = outlook.dailyBalances.find((d) => d.date === "2026-11-15");
      expect(nov14?.balance.toString()).toBe("1000");
      expect(nov15?.balance.toString()).toBe("1100");
    });

    it("4.11: ignores unpaid bills outside the 30-day window", () => {
      const unpaidBills: UnpaidBillConfig[] = [
        { name: "Past Bill", amount: "500", dueDate: "2026-11-01" }, // In past
        { name: "Distant Bill", amount: "800", dueDate: "2027-02-15" }, // Far future
      ];
      const outlook = project30DayCashOutlook({
        startingBalance: "2000",
        startDate: "2026-11-06",
        recurrences: [],
        unpaidBills,
      });

      // Both bills outside window, balance remains unchanged
      expect(outlook.endingBalance.toString()).toBe("2000");
      expect(outlook.minBalance.toString()).toBe("2000");
    });

    it("4.12: correctly retains startingDate as minBalanceDate when balance only increases", () => {
      const recurrences: RecurrenceConfig[] = [
        { name: "Daily Income", amount: "100", type: "income", cadence: "daily" },
      ];
      const outlook = project30DayCashOutlook({
        startingBalance: "500",
        startDate: "2026-11-06",
        recurrences,
        unpaidBills: [],
      });

      expect(outlook.minBalance.toString()).toBe("500");
      expect(outlook.minBalanceDate).toBe("2026-11-06");
      expect(outlook.endingBalance.toString()).toBe("3500");
    });
  });

  // ==========================================================================
  // Section 5: Credit & Debt Gauge Stress Tests
  // ==========================================================================
  describe("5. computeCreditDebtGauge: Boundary Thresholds & Zero Limits", () => {
    it("5.1: handles zero total credit limit safely without throwing or NaN", () => {
      const accounts = [
        { type: "liability", liability_type: "credit_card", current_balance: "750", credit_limit: "0" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.totalCreditLimit.toString()).toBe("0");
      expect(res.creditCardDebt.toString()).toBe("750");
      expect(res.utilizationPercent).toBe(0);
      expect(res.riskLevel).toBe("healthy");
    });

    it("5.2: verifies strict boundary thresholds for risk tiers", () => {
      // 29.99% -> healthy (< 30%)
      const r29 = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "299.90", credit_limit: "1000" },
      ]);
      expect(r29.utilizationPercent).toBe(29.99);
      expect(r29.riskLevel).toBe("healthy");

      // Exactly 30.00% -> moderate (>= 30% and <= 50%)
      const r30 = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "300.00", credit_limit: "1000" },
      ]);
      expect(r30.utilizationPercent).toBe(30);
      expect(r30.riskLevel).toBe("moderate");

      // Exactly 50.00% -> moderate
      const r50 = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "500.00", credit_limit: "1000" },
      ]);
      expect(r50.utilizationPercent).toBe(50);
      expect(r50.riskLevel).toBe("moderate");

      // 50.01% -> high (> 50%)
      const r501 = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "500.10", credit_limit: "1000" },
      ]);
      expect(r501.utilizationPercent).toBe(50.01);
      expect(r501.riskLevel).toBe("high");
    });

    it("5.3: handles over-limit credit card debt (> 100%) as high risk", () => {
      const accounts = [
        { type: "liability", liability_type: "credit_card", current_balance: "3500", credit_limit: "2000" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.utilizationPercent).toBe(175);
      expect(res.riskLevel).toBe("high");
    });

    it("5.4: aggregates multiple credit cards limits and balances proportionally", () => {
      const accounts = [
        { type: "liability", liability_type: "credit_card", current_balance: "300", credit_limit: "1000" },
        { type: "liability", liability_type: "credit_card", current_balance: "900", credit_limit: "3000" },
      ];
      // Total bal 1200, total limit 4000 -> 30% -> moderate
      const res = computeCreditDebtGauge(accounts);
      expect(res.creditCardDebt.toString()).toBe("1200");
      expect(res.totalCreditLimit.toString()).toBe("4000");
      expect(res.utilizationPercent).toBe(30);
      expect(res.riskLevel).toBe("moderate");
    });

    it("5.5: isolates fixed loan liabilities from revolving card utilization", () => {
      const accounts = [
        { type: "liability", liability_type: "mortgage", current_balance: "350000" },
        { type: "liability", liability_type: "student_loan", current_balance: "45000" },
        { type: "liability", liability_type: "credit_card", current_balance: "500", credit_limit: "5000" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.totalDebt.toString()).toBe("395500");
      expect(res.creditCardDebt.toString()).toBe("500");
      expect(res.totalCreditLimit.toString()).toBe("5000");
      expect(res.utilizationPercent).toBe(10);
      expect(res.riskLevel).toBe("healthy");
    });

    it("5.6: completely excludes non-liability assets and expense accounts", () => {
      const accounts = [
        { type: "asset", current_balance: "50000" },
        { type: "expense", current_balance: "1200" },
        { type: "revenue", current_balance: "4000" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.totalDebt.toString()).toBe("0");
      expect(res.creditCardDebt.toString()).toBe("0");
      expect(res.totalCreditLimit.toString()).toBe("0");
      expect(res.utilizationPercent).toBe(0);
      expect(res.riskLevel).toBe("healthy");
    });

    it("5.7: normalizes negative credit card balance (credit/overpayment) via absolute value", () => {
      const accounts = [
        { type: "liability", liability_type: "credit_card", current_balance: "-150", credit_limit: "1000" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.creditCardDebt.toString()).toBe("150");
      expect(res.utilizationPercent).toBe(15);
      expect(res.riskLevel).toBe("healthy");
    });

    it("5.8: recognizes account_role ccAsset as revolving credit card liability", () => {
      const accounts = [
        { type: "asset", account_role: "ccAsset", current_balance: "800", credit_limit: "2000" },
      ];
      const res = computeCreditDebtGauge(accounts);
      expect(res.totalDebt.toString()).toBe("800");
      expect(res.creditCardDebt.toString()).toBe("800");
      expect(res.totalCreditLimit.toString()).toBe("2000");
      expect(res.utilizationPercent).toBe(40);
      expect(res.riskLevel).toBe("moderate");
    });
  });
});
