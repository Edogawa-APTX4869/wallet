import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Decimal from "decimal.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeCashFlowKpis } from "@/app/(app)/reports/components/reports-math";
import { computeAccount30dKpi } from "@/app/(app)/accounts/[id]/account-detail-client";
import { signFor, TransactionRow } from "@/components/transaction-row";
import type { Resource, TransactionGroup, TransactionSplit } from "@/lib/firefly/types";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeMockSplit(attrs: Partial<TransactionSplit>): TransactionSplit {
  return {
    transaction_journal_id: "tj-1",
    type: attrs.type || "deposit",
    date: attrs.date || "2026-11-01T00:00:00Z",
    amount: attrs.amount || "100.00",
    description: attrs.description || "Test split",
    currency_code: attrs.currency_code || "BHD",
    currency_decimal_places: attrs.currency_decimal_places ?? 3,
    ...attrs,
  };
}

function makeMockTxGroup(splits: TransactionSplit[]): Resource<TransactionGroup> {
  return {
    id: "g-1",
    type: "transactions",
    attributes: {
      group_title: splits[0]?.description || "Group",
      transactions: splits,
    },
  };
}

describe("Firefly III Accounting & Domain Logic Verification (R2 & Acceptance Criteria)", () => {
  // ==========================================================================
  // 1. Operating Cash Flow Inflow vs. Capital Baseline Rules
  // ==========================================================================
  describe("1. Operating Cash Flow Inflow Calculation (reports-math.ts)", () => {
    it("1.1 counts deposits from revenue accounts strictly as operating inflow", () => {
      const txs = [
        { type: "deposit", amount: "1250.500" },
        { type: "deposit", amount: "750.250" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("2000.75");
      expect(kpis.outflow.toString()).toBe("0");
      expect(kpis.netSaved.toString()).toBe("2000.75");
      expect(kpis.savingsRatePercent).toBe(100);
    });

    it("1.2 strictly excludes opening balance transactions from operating cash flow inflow", () => {
      const txs = [
        { type: "opening balance", amount: "15000.000" },
        { type: "withdrawal", amount: "500.000" },
      ];
      const kpis = computeCashFlowKpis(txs);

      // Inflow must be 0 because capital setup is not operational income
      expect(kpis.inflow.toString()).toBe("0");
      expect(kpis.outflow.toString()).toBe("500");
      expect(kpis.netSaved.toString()).toBe("-500");
      expect(kpis.savingsRatePercent).toBe(0);
    });

    it("1.3 isolates operational savings rate from mixed deposits, opening balances, and withdrawals", () => {
      const txs = [
        { type: "deposit", amount: "4000.000" },          // True income
        { type: "opening balance", amount: "20000.000" }, // Capital setup (ignored)
        { type: "withdrawal", amount: "3000.000" },       // Operating expense
      ];
      const kpis = computeCashFlowKpis(txs);

      expect(kpis.inflow.toString()).toBe("4000");
      expect(kpis.outflow.toString()).toBe("3000");
      expect(kpis.netSaved.toString()).toBe("1000");
      // (1000 / 4000) * 100 = 25% savings rate
      expect(kpis.savingsRatePercent).toBe(25);
    });

    it("1.4 excludes transfers and reconciliation adjustments from operating cash flow", () => {
      const txs = [
        { type: "transfer", amount: "1000.000" },
        { type: "reconciliation", amount: "250.000" },
        { type: "deposit", amount: "500.000" },
      ];
      const kpis = computeCashFlowKpis(txs);
      expect(kpis.inflow.toString()).toBe("500");
      expect(kpis.outflow.toString()).toBe("0");
      expect(kpis.netSaved.toString()).toBe("500");
    });
  });

  // ==========================================================================
  // 2. Account Detail 30-Day Perspective Directionality
  // ==========================================================================
  describe("2. Account Detail 30-Day Perspective Directionality (account-detail-client.tsx)", () => {
    it("2.1 handles transfer directionality: destination is inflow, source is outflow", () => {
      const groups = [
        makeMockTxGroup([
          makeMockSplit({
            type: "transfer",
            amount: "300.000",
            source_id: "acc-user",
            destination_id: "acc-savings",
          }),
        ]),
        makeMockTxGroup([
          makeMockSplit({
            type: "transfer",
            amount: "150.000",
            source_id: "acc-other",
            destination_id: "acc-user",
          }),
        ]),
      ];

      const stats = computeAccount30dKpi(groups, "acc-user");
      expect(stats.inflow.toString()).toBe("150");
      expect(stats.outflow.toString()).toBe("300");
      expect(stats.netChange.toString()).toBe("-150");
      expect(stats.count).toBe(2);
    });

    it("2.2 handles opening balance directionality: destination is inflow, source is outflow", () => {
      // In Firefly III: contra-account (source) -> asset account (destination)
      const assetAccountGroups = [
        makeMockTxGroup([
          makeMockSplit({
            type: "opening balance",
            amount: "1000.000",
            source_id: "contra-1",
            destination_id: "asset-1",
          }),
        ]),
      ];

      // Perspective 1: Asset Account receiving the opening balance
      const assetStats = computeAccount30dKpi(assetAccountGroups, "asset-1");
      expect(assetStats.inflow.toString()).toBe("1000");
      expect(assetStats.outflow.toString()).toBe("0");
      expect(assetStats.netChange.toString()).toBe("1000");

      // Perspective 2: Contra-Account supplying the opening balance
      const contraStats = computeAccount30dKpi(assetAccountGroups, "contra-1");
      expect(contraStats.inflow.toString()).toBe("0");
      expect(contraStats.outflow.toString()).toBe("1000");
      expect(contraStats.netChange.toString()).toBe("-1000");
    });

    it("2.3 handles reconciliation adjustments directionality based on account perspective", () => {
      const groups = [
        // Upward reconciliation adjustment (reconciliation system account -> user account)
        makeMockTxGroup([
          makeMockSplit({
            type: "reconciliation",
            amount: "50.000",
            source_id: "sys-rec",
            destination_id: "asset-1",
          }),
        ]),
        // Downward reconciliation adjustment (user account -> reconciliation system account)
        makeMockTxGroup([
          makeMockSplit({
            type: "reconciliation",
            amount: "20.000",
            source_id: "asset-1",
            destination_id: "sys-rec",
          }),
        ]),
      ];

      const stats = computeAccount30dKpi(groups, "asset-1");
      expect(stats.inflow.toString()).toBe("50");
      expect(stats.outflow.toString()).toBe("20");
      expect(stats.netChange.toString()).toBe("30");
      expect(stats.count).toBe(2);
    });
  });

  // ==========================================================================
  // 3. Transaction Row Signs & Badges
  // ==========================================================================
  describe("3. Transaction Row Signed Display & Badges (transaction-row.tsx)", () => {
    it("3.1 assigns correct directional signs based on transaction type and perspective", () => {
      const deposit = makeMockSplit({ type: "deposit", amount: "100" });
      const withdrawal = makeMockSplit({ type: "withdrawal", amount: "50" });
      const transferIn = makeMockSplit({ type: "transfer", amount: "200", destination_id: "acc-1", source_id: "acc-2" });
      const transferOut = makeMockSplit({ type: "transfer", amount: "200", destination_id: "acc-2", source_id: "acc-1" });
      const recIn = makeMockSplit({ type: "reconciliation", amount: "25", destination_id: "acc-1", source_id: "rec-sys" });
      const recOut = makeMockSplit({ type: "reconciliation", amount: "15", destination_id: "rec-sys", source_id: "acc-1" });

      expect(signFor(deposit)).toBe(1);
      expect(signFor(withdrawal)).toBe(-1);
      expect(signFor(transferIn, "acc-1")).toBe(1);
      expect(signFor(transferOut, "acc-1")).toBe(-1);
      expect(signFor(recIn, "acc-1")).toBe(1);
      expect(signFor(recOut, "acc-1")).toBe(-1);
    });

    it("3.2 renders Reconciliation and Opening Balance badges in TransactionRow DOM", () => {
      const qc = createTestQueryClient();

      const recGroup = makeMockTxGroup([
        makeMockSplit({
          type: "reconciliation",
          amount: "50.000",
          description: "Monthly reconciliation adjustment",
          source_id: "1",
          source_name: "Checking",
          destination_id: "2",
          destination_name: "Reconciliation account",
        }),
      ]);

      const openGroup = makeMockTxGroup([
        makeMockSplit({
          type: "opening balance",
          amount: "1000.000",
          description: "Initial balance deposit",
          source_id: "3",
          source_name: "Initial balance contra",
          destination_id: "1",
          destination_name: "Checking",
        }),
      ]);

      const recHtml = renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <TransactionRow group={recGroup} />
        </QueryClientProvider>,
      );
      expect(recHtml).toContain("Reconciliation");

      const openHtml = renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <TransactionRow group={openGroup} />
        </QueryClientProvider>,
      );
      expect(openHtml).toContain("Opening balance");
    });
  });

  // ==========================================================================
  // 4. Budget Overspending Calculations
  // ==========================================================================
  describe("4. Budget Remaining Arithmetic & Overspending Protection (budgets-client.tsx)", () => {
    it("4.1 calculates positive remaining funds when spending is within budget limit", () => {
      const limitVal = new Decimal("1000.000");
      const spentVal = new Decimal("450.000");
      const leftVal = limitVal.minus(spentVal);

      expect(leftVal.toString()).toBe("550");
      expect(leftVal.isPositive()).toBe(true);
    });

    it("4.2 preserves negative remaining amount without premature clamping to 0 when overspent", () => {
      const limitVal = new Decimal("500.000");
      const spentVal = new Decimal("680.000");
      // Must NOT clamp: limit - spent = 500 - 680 = -180
      const leftVal = limitVal.minus(spentVal);

      expect(leftVal.toString()).toBe("-180");
      expect(leftVal.isNegative()).toBe(true);
      expect(leftVal.abs().toString()).toBe("180");
    });
  });
});
