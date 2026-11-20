import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  BudgetAdjustModal,
  type BudgetPeriodRow,
  computeAdjustedBudgetLimit,
} from "./budget-adjust-modal";
import { BudgetTransferModal, computeBudgetTransfer } from "./budget-transfer-modal";
import {
  formatBudgetAmountInput,
  parseBudgetLimitSpent,
  resolveBudgetPeriodRow,
  selectActiveBudgetLimit,
} from "@/lib/budget-periods";
import { api } from "@/lib/firefly/api";
import type { Budget, BudgetLimit, Resource } from "@/lib/firefly/types";

const API_SRC = readFileSync(path.resolve(__dirname, "../lib/firefly/api.ts"), "utf8");
const BUDGETS_CLIENT_SRC = readFileSync(
  path.resolve(__dirname, "../app/(app)/budgets/budgets-client.tsx"),
  "utf8",
);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeRow(overrides: Partial<BudgetPeriodRow> & { id: string; name: string }): BudgetPeriodRow {
  const limit = overrides.limit ?? new Decimal(100);
  const spent = overrides.spent ?? new Decimal(25);
  return {
    raw: {
      id: overrides.id,
      type: "budgets",
      attributes: {
        name: overrides.name,
        active: true,
      },
    },
    limitId: overrides.limitId === undefined ? `lim-${overrides.id}` : overrides.limitId,
    limitStart: overrides.limitStart ?? "2026-11-01",
    limitEnd: overrides.limitEnd ?? "2026-11-30",
    limitNotes: overrides.limitNotes ?? null,
    active: overrides.active ?? true,
    limit,
    spent,
    left: overrides.left ?? limit.minus(spent),
    code: overrides.code ?? "BHD",
    decimals: overrides.decimals ?? 3,
    ...overrides,
  };
}

describe("computeAdjustedBudgetLimit", () => {
  it("adds delta to the current budget limit in add mode", () => {
    const res = computeAdjustedBudgetLimit({
      currentLimit: new Decimal(100),
      mode: "add",
      inputAmount: "25.5",
      decimals: 3,
    });
    expect(res.newLimit.toString()).toBe("125.5");
    expect(res.delta.toString()).toBe("25.5");
    expect(res.formatted).toBe("125.500");
  });

  it("subtracts delta from the current limit and rejects negative results", () => {
    const res = computeAdjustedBudgetLimit({
      currentLimit: "100",
      mode: "subtract",
      inputAmount: "40",
      decimals: 3,
    });
    expect(res.newLimit.toString()).toBe("60");
    expect(res.delta.toString()).toBe("-40");
    expect(res.formatted).toBe("60.000");

    expect(() =>
      computeAdjustedBudgetLimit({
        currentLimit: "100",
        mode: "subtract",
        inputAmount: "150",
        decimals: 3,
      }),
    ).toThrow("Resulting budget limit cannot be negative.");
  });

  it("sets exact limit in set mode and rejects non-positive or invalid values", () => {
    const res = computeAdjustedBudgetLimit({
      currentLimit: "100",
      mode: "set",
      inputAmount: "250",
      decimals: 3,
    });
    expect(res.newLimit.toString()).toBe("250");
    expect(res.delta.toString()).toBe("150");
    expect(res.formatted).toBe("250.000");

    expect(() =>
      computeAdjustedBudgetLimit({
        currentLimit: "100",
        mode: "set",
        inputAmount: "0",
        decimals: 3,
      }),
    ).toThrow("Enter an amount greater than 0.");
  });
});

describe("computeBudgetTransfer", () => {
  it("reallocates budget limit from source to destination while preserving the total sum", () => {
    const res = computeBudgetTransfer({
      sourceLimit: 200,
      sourceSpent: 40,
      destLimit: 100,
      destSpent: 120,
      amount: "50",
      decimals: 3,
      sourceId: "b-1",
      destId: "b-2",
      sourceCurrency: "BHD",
      destCurrency: "BHD",
    });

    expect(res.transferAmount.toString()).toBe("50");
    expect(res.newSourceLimit.toString()).toBe("150");
    expect(res.newDestLimit.toString()).toBe("150");
    expect(res.newSourceLimit.plus(res.newDestLimit).toString()).toBe("300");
    expect(res.newSourceLeft.toString()).toBe("110");
    expect(res.newDestLeft.toString()).toBe("30");
    expect(res.formattedSourceLimit).toBe("150.000");
    expect(res.formattedDestLimit).toBe("150.000");
  });

  it("validates distinct budgets, matching currencies, positive amount, and non-negative source", () => {
    expect(() =>
      computeBudgetTransfer({
        sourceLimit: 200,
        destLimit: 100,
        amount: "25",
        sourceId: "b-1",
        destId: "b-1",
      }),
    ).toThrow("Choose two different budgets.");

    expect(() =>
      computeBudgetTransfer({
        sourceLimit: 200,
        destLimit: 100,
        amount: "25",
        sourceId: "b-1",
        destId: "b-2",
        sourceCurrency: "BHD",
        destCurrency: "USD",
      }),
    ).toThrow("Budgets must use the same currency to transfer directly.");

    expect(() =>
      computeBudgetTransfer({
        sourceLimit: 200,
        destLimit: 100,
        amount: "0",
        sourceId: "b-1",
        destId: "b-2",
      }),
    ).toThrow("Enter a transfer amount greater than 0.");

    expect(() =>
      computeBudgetTransfer({
        sourceLimit: 50,
        destLimit: 100,
        amount: "75",
        sourceId: "b-1",
        destId: "b-2",
      }),
    ).toThrow("Transfer amount exceeds the source budget limit.");
  });
});

describe("Firefly III v6 budget API and modal rendering", () => {
  it("exposes PUT/DELETE limit endpoints, upsertBudgetLimit POST-vs-PUT routing, and availableBudgets", () => {
    expect(API_SRC).toContain("updateBudgetLimit:");
    expect(API_SRC).toContain("deleteBudgetLimit:");
    expect(API_SRC).toContain("upsertBudgetLimit:");
    expect(API_SRC).toContain("params.limitId");
    expect(API_SRC).toContain("availableBudgets:");
    expect(API_SRC).toContain("setAvailableBudget:");
    expect(API_SRC).toContain("updateAvailableBudget:");
    expect(API_SRC).toContain("deleteAvailableBudget:");

    expect(BUDGETS_CLIENT_SRC).toContain("api.upsertBudgetLimit");
    expect(BUDGETS_CLIENT_SRC).toContain("available-budgets");
    expect(BUDGETS_CLIENT_SRC).toContain("BudgetAdjustModal");
    expect(BUDGETS_CLIENT_SRC).toContain("BudgetTransferModal");
  });

  it("renders BudgetAdjustModal markup with delta modes, cover overspent chip, and Clear limit", () => {
    const qc = createTestQueryClient();
    const row = makeRow({
      id: "b-1",
      name: "Dining Out",
      limit: new Decimal(100),
      spent: new Decimal(125),
      left: new Decimal(-25),
    });

    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(BudgetAdjustModal, {
          open: true,
          onClose: () => {},
          row,
          start: "2026-11-01",
          end: "2026-11-30",
          periodLabel: "Nov 2026",
        }),
      ),
    );

    expect(html).toContain("Adjust Budget · Dining Out");
    expect(html).toContain("Add (+)");
    expect(html).toContain("Subtract (−)");
    expect(html).toContain("Set exact");
    expect(html).toContain("Cover overspent (+25.000)");
    expect(html).toContain("Clear limit");
    expect(html).toContain("Save adjustment");
    expect(html).toContain("Auto-budget rule stays unchanged");
  });

  it("renders weekly sub-period slice selector in BudgetAdjustModal and uses active-slice spent", () => {
    const qc = createTestQueryClient();
    const row = makeRow({
      id: "b-petrol",
      name: "Petrol",
      limitId: "lim-w3",
      limitStart: "2026-11-16",
      limitEnd: "2026-11-22",
      limit: new Decimal(10),
      spent: new Decimal(0),
      left: new Decimal(10),
      monthLimit: new Decimal(20),
      monthSpent: new Decimal(18.75),
      monthLeft: new Decimal(1.25),
      isSubPeriod: true,
      hasActiveSlice: true,
      periodLimits: [
        {
          id: "lim-w3",
          start: "2026-11-16",
          end: "2026-11-22",
          amount: new Decimal(10),
          spent: new Decimal(0),
          left: new Decimal(10),
          hasExplicitSpent: true,
          isActive: true,
          currencyCode: "BHD",
          decimals: 3,
          notes: null,
        },
        {
          id: "lim-w1",
          start: "2026-11-02",
          end: "2026-11-08",
          amount: new Decimal(10),
          spent: new Decimal(18.75),
          left: new Decimal(-8.75),
          hasExplicitSpent: true,
          isActive: false,
          currencyCode: "BHD",
          decimals: 3,
          notes: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(BudgetAdjustModal, {
          open: true,
          onClose: () => {},
          row,
          start: "2026-11-01",
          end: "2026-11-30",
          periodLabel: "Nov 2026",
        }),
      ),
    );

    expect(html).toContain("Target period slice (weekly / sub-period)");
    expect(html).toContain("2026-11-16 → 2026-11-22");
    expect(html).toContain("2026-11-02 → 2026-11-08");
    // Active week spent is 0.000 / 10.000, so Cover overspent must NOT be offered.
    expect(html).not.toContain("Cover overspent");
  });

  it("renders BudgetTransferModal markup with smart chips and budget selectors", () => {
    const qc = createTestQueryClient();
    const rows = [
      makeRow({
        id: "b-1",
        name: "Groceries",
        limit: new Decimal(200),
        spent: new Decimal(80),
        left: new Decimal(120),
      }),
      makeRow({
        id: "b-2",
        name: "Dining Out",
        limit: new Decimal(50),
        spent: new Decimal(70),
        left: new Decimal(-20),
      }),
    ];

    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(BudgetTransferModal, {
          open: true,
          onClose: () => {},
          rows,
          initialSourceId: "b-1",
          initialDestId: "b-2",
          start: "2026-11-01",
          end: "2026-11-30",
          periodLabel: "Nov 2026",
        }),
      ),
    );

    expect(html).toContain("Transfer Between Budgets");
    expect(html).toContain("From budget");
    expect(html).toContain("To budget");
    expect(html).toContain("Move all remaining (120.000)");
    expect(html).toContain("Cover overspending (20.000)");
    expect(html).toContain("Confirm transfer");
  });
});

describe("weekly vs monthly budget sub-period resolution", () => {
  it("parses Firefly III spent payloads across arrays, negative strings, nulls, and undefined", () => {
    expect(parseBudgetLimitSpent([], "BHD")?.toFixed(3)).toBe("0.000");
    expect(parseBudgetLimitSpent(null, "BHD")?.toFixed(3)).toBe("0.000");
    expect(parseBudgetLimitSpent("", "BHD")?.toFixed(3)).toBe("0.000");
    expect(parseBudgetLimitSpent("-18.750", "BHD")?.toFixed(3)).toBe("18.750");
    expect(
      parseBudgetLimitSpent(
        [
          { sum: "-18.750", currency_code: "BHD", currency_decimal_places: 3 },
          { sum: "-5.00", currency_code: "USD", currency_decimal_places: 2 },
        ],
        "BHD",
      )?.toFixed(3),
    ).toBe("18.750");
    expect(parseBudgetLimitSpent(undefined, "BHD")).toBeNull();
    expect(formatBudgetAmountInput(new Decimal("10"), 3)).toBe("10.000");
  });

  it("uses the currently active weekly limit for primary stats while preserving full-month totals", () => {
    const petrolBudget: Resource<Budget> = {
      id: "7",
      type: "budgets",
      attributes: {
        name: "Petrol",
        active: true,
        auto_budget_type: "reset",
        auto_budget_amount: "10.000",
        auto_budget_period: "weekly",
        auto_budget_currency_code: "BHD",
        spent: [{ sum: "-18.750", currency_code: "BHD", currency_decimal_places: 3 }],
      },
    };

    const limits: Resource<BudgetLimit>[] = [
      {
        id: "101",
        type: "budget_limits",
        attributes: {
          budget_id: "7",
          start: "2026-11-02T00:00:00+03:00",
          end: "2026-11-08T23:59:59+03:00",
          amount: "10.000",
          currency_code: "BHD",
          currency_decimal_places: 3,
          spent: [{ sum: "-18.750", currency_code: "BHD", currency_decimal_places: 3 }],
        },
      },
      {
        id: "102",
        type: "budget_limits",
        attributes: {
          budget_id: "7",
          start: "2026-11-16T00:00:00+03:00",
          end: "2026-11-22T23:59:59+03:00",
          amount: "10.000",
          currency_code: "BHD",
          currency_decimal_places: 3,
          spent: [],
        },
      },
    ];

    const row = resolveBudgetPeriodRow({
      budget: petrolBudget,
      limits,
      rangeStart: "2026-11-01",
      rangeEnd: "2026-11-30",
      today: "2026-11-20",
      defaultCode: "BHD",
      defaultDecimals: 3,
      currencyDecimalsByCode: { BHD: 3 },
    });

    // Primary stats reflect the currently active week (2026-11-16 -> 2026-11-22)
    expect(row.limitId).toBe("102");
    expect(row.limitStart).toBe("2026-11-16");
    expect(row.limitEnd).toBe("2026-11-22");
    expect(row.isSubPeriod).toBe(true);
    expect(row.hasActiveSlice).toBe(true);
    expect(row.decimals).toBe(3);
    expect(row.limit.toFixed(3)).toBe("10.000");
    expect(row.spent.toFixed(3)).toBe("0.000");
    expect(row.left.toFixed(3)).toBe("10.000");

    // Monthly cumulative totals remain available for summary bar & breakdown footer
    expect(row.monthLimit?.toFixed(3)).toBe("20.000");
    expect(row.monthSpent?.toFixed(3)).toBe("18.750");
    expect(row.monthLeft?.toFixed(3)).toBe("1.250");

    // Sub-period list keeps each week's independent spent/left
    expect(row.periodLimits).toHaveLength(2);
    expect(row.periodLimits?.[0].id).toBe("102");
    expect(row.periodLimits?.[0].isActive).toBe(true);
    expect(row.periodLimits?.[0].spent.toFixed(3)).toBe("0.000");
    expect(row.periodLimits?.[1].id).toBe("101");
    expect(row.periodLimits?.[1].isActive).toBe(false);
    expect(row.periodLimits?.[1].spent.toFixed(3)).toBe("18.750");
    expect(row.periodLimits?.[1].left.toFixed(3)).toBe("-8.750");
  });

  it("falls back to the most recent limit when today is outside all limit windows", () => {
    const slices = [
      {
        id: "lim-recent",
        start: "2026-10-26",
        end: "2026-11-01",
        amount: new Decimal(10),
        spent: new Decimal(4),
        left: new Decimal(6),
        hasExplicitSpent: true,
        isActive: false,
        notes: null,
      },
      {
        id: "lim-older",
        start: "2026-10-19",
        end: "2026-10-25",
        amount: new Decimal(10),
        spent: new Decimal(10),
        left: new Decimal(0),
        hasExplicitSpent: true,
        isActive: false,
        notes: null,
      },
    ];

    expect(selectActiveBudgetLimit(slices, "2026-11-20")?.id).toBe("lim-recent");
  });
});

describe("api.upsertBudgetLimit Firefly III payloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends PUT /budgets/{id}/limits/{limit_id} with normalized dates and budget_id when limitId exists", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "102", type: "budget_limits", attributes: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.upsertBudgetLimit({
      budgetId: "7",
      limitId: "102",
      amount: "15.000",
      start: "2026-11-16T00:00:00+03:00",
      end: "2026-11-22T23:59:59+03:00",
      currency_code: "BHD",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/ff/budgets/7/limits/102");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      budget_id: "7",
      amount: "15.000",
      start: "2026-11-16",
      end: "2026-11-22",
      currency_code: "BHD",
    });
  });

  it("sends POST /budgets/{id}/limits when no limitId exists yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "103", type: "budget_limits", attributes: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.upsertBudgetLimit({
      budgetId: "7",
      limitId: null,
      amount: "12.500",
      start: "2026-11-01",
      end: "2026-11-30",
      currency_code: "BHD",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/ff/budgets/7/limits");
    expect(String(url)).not.toContain("/limits/null");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      budget_id: "7",
      amount: "12.500",
      start: "2026-11-01",
      end: "2026-11-30",
      currency_code: "BHD",
    });
  });
});
