import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  BudgetAdjustModal,
  type BudgetPeriodRow,
  computeAdjustedBudgetLimit,
} from "./budget-adjust-modal";
import { BudgetTransferModal, computeBudgetTransfer } from "./budget-transfer-modal";

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

  it("renders weekly sub-period slice selector in BudgetAdjustModal when a budget has multiple limits", () => {
    const qc = createTestQueryClient();
    const row = makeRow({
      id: "b-petrol",
      name: "Petrol",
      limitId: "lim-w2",
      limitStart: "2026-11-09",
      limitEnd: "2026-11-15",
      limit: new Decimal(20),
      spent: new Decimal(18.75),
      left: new Decimal(1.25),
      periodLimits: [
        { id: "lim-w2", start: "2026-11-09", end: "2026-11-15", amount: new Decimal(10), notes: null },
        { id: "lim-w1", start: "2026-11-02", end: "2026-11-08", amount: new Decimal(10), notes: null },
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
    expect(html).toContain("2026-11-09 → 2026-11-15 (BHD 10.000)");
    expect(html).toContain("2026-11-02 → 2026-11-08 (BHD 10.000)");
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
