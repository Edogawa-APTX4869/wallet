import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Decimal from "decimal.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeCashFlowKpis, computeCreditDebtGauge } from "@/app/(app)/reports/components/reports-math";
import { computeAccount30dKpi } from "@/app/(app)/accounts/[id]/account-detail-client";
import {
  ExtraCard,
  isSystemContraAccount,
  LIABILITY_TYPES,
  type ExtraCardContext,
} from "@/app/(app)/dashboard-extra-cards";
import type { Account, Resource, TransactionGroup, TransactionSplit } from "@/lib/firefly/types";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeMockAccount(attrs: Partial<Account> & { id: string }): Resource<Account> {
  const { id, ...attributes } = attrs;
  return {
    id,
    type: "accounts",
    attributes: {
      name: attributes.name || `Account ${id}`,
      type: attributes.type || "asset",
      active: attributes.active ?? true,
      current_balance: attributes.current_balance ?? "0.000",
      currency_code: attributes.currency_code ?? "BHD",
      currency_decimal_places: attributes.currency_decimal_places ?? 3,
      currency_symbol: attributes.currency_symbol ?? "BHD",
      ...attributes,
    },
  };
}

function makeMockSplit(attrs: Partial<TransactionSplit>): TransactionSplit {
  return {
    transaction_journal_id: `tj-${Math.random()}`,
    type: attrs.type || "deposit",
    date: attrs.date || "2026-11-01T12:00:00Z",
    amount: attrs.amount || "100.000",
    description: attrs.description || "Split description",
    currency_code: attrs.currency_code || "BHD",
    currency_decimal_places: attrs.currency_decimal_places ?? 3,
    ...attrs,
  };
}

function makeMockTxGroup(splits: TransactionSplit[], id?: string): Resource<TransactionGroup> {
  const gid = id || `g-${Math.random()}`;
  return {
    id: gid,
    type: "transactions",
    attributes: {
      group_title: splits[0]?.description || "Group",
      transactions: splits,
    },
  };
}

describe("Accounting Adversarial Challenger Suite (accounting_challenger_2)", () => {
  // ==========================================================================
  // 1. Operating Cash Flow: Adversarial Stress-Testing
  // ==========================================================================
  describe("1. Operating Cash Flow Stress-Testing (reports-math.ts & cashflow-tab logic)", () => {
    it("1.1 refuses to inflate operating inflow with capital setup / opening balances across mixed streams", () => {
      const adversarialTxs = [
        { type: "deposit", amount: "1500.000" },          // True operating revenue
        { type: "deposit", amount: "2500.500" },          // True operating revenue
        { type: "opening balance", amount: "100000.000" }, // Opening balance capital setup (MUST BE EXCLUDED)
        { type: "opening balance", amount: "50000.000" },  // Another opening balance (MUST BE EXCLUDED)
        { type: "transfer", amount: "10000.000" },         // Internal asset movement (MUST BE EXCLUDED)
        { type: "reconciliation", amount: "350.000" },     // Reconciliation adjustment (MUST BE EXCLUDED)
        { type: "withdrawal", amount: "800.000" },         // Operating expense
        { type: "withdrawal", amount: "1200.500" },        // Operating expense
      ];

      const kpis = computeCashFlowKpis(adversarialTxs);

      // Inflow must strictly be 1500.000 + 2500.500 = 4000.500 BHD
      expect(kpis.inflow.toString()).toBe("4000.5");
      // Outflow must strictly be 800.000 + 1200.500 = 2000.500 BHD
      expect(kpis.outflow.toString()).toBe("2000.5");
      // Net saved must be 4000.5 - 2000.5 = 2000.000 BHD
      expect(kpis.netSaved.toString()).toBe("2000");
      // Savings rate = (2000 / 4000.5) * 100 = 49.99%
      expect(kpis.savingsRatePercent).toBe(49.99);
    });

    it("1.2 handles zero-revenue period with massive opening balance without division-by-zero or inflation", () => {
      const zeroRevenueTxs = [
        { type: "opening balance", amount: "500000.000" },
        { type: "withdrawal", amount: "4500.000" },
      ];

      const kpis = computeCashFlowKpis(zeroRevenueTxs);
      expect(kpis.inflow.toString()).toBe("0");
      expect(kpis.outflow.toString()).toBe("4500");
      expect(kpis.netSaved.toString()).toBe("-4500");
      expect(kpis.savingsRatePercent).toBe(0);
    });

    it("1.3 handles negative raw split amounts defensively via absolute value", () => {
      const negativeTxs = [
        { type: "deposit", amount: "-1250.000" },
        { type: "withdrawal", amount: "-350.000" },
      ];

      const kpis = computeCashFlowKpis(negativeTxs);
      expect(kpis.inflow.toString()).toBe("1250");
      expect(kpis.outflow.toString()).toBe("350");
      expect(kpis.netSaved.toString()).toBe("900");
    });

    it("1.4 handles empty transaction arrays and invalid types gracefully", () => {
      const invalidTxs = [
        { type: "unknown_future_type", amount: "1000.000" },
        { type: "", amount: "500.000" },
      ];

      const kpisEmpty = computeCashFlowKpis([]);
      expect(kpisEmpty.inflow.toString()).toBe("0");
      expect(kpisEmpty.outflow.toString()).toBe("0");
      expect(kpisEmpty.netSaved.toString()).toBe("0");
      expect(kpisEmpty.savingsRatePercent).toBe(0);

      const kpisInvalid = computeCashFlowKpis(invalidTxs);
      expect(kpisInvalid.inflow.toString()).toBe("0");
      expect(kpisInvalid.outflow.toString()).toBe("0");
    });

    it("1.5 high-volume stress test: 5,000 deposits + 5,000 opening balances + 5,000 withdrawals", () => {
      const largeBatch: Array<{ type: string; amount: string }> = [];
      for (let i = 0; i < 5000; i++) {
        largeBatch.push({ type: "deposit", amount: "10.000" });         // total 50,000
        largeBatch.push({ type: "opening balance", amount: "100.000" }); // total 500,000 (IGNORED)
        largeBatch.push({ type: "withdrawal", amount: "6.000" });        // total 30,000
      }

      const kpis = computeCashFlowKpis(largeBatch);
      expect(kpis.inflow.toString()).toBe("50000");
      expect(kpis.outflow.toString()).toBe("30000");
      expect(kpis.netSaved.toString()).toBe("20000");
      expect(kpis.savingsRatePercent).toBe(40);
    });
  });

  // ==========================================================================
  // 2. Account Detail 30-Day KPIs: Perspective Directionality
  // ==========================================================================
  describe("2. Account Detail 30-Day KPIs Perspective Directionality (account-detail-client.tsx)", () => {
    const ACC_TARGET = "acc-target-1";
    const ACC_PEER = "acc-peer-2";
    const ACC_THIRD_PARTY = "acc-third-party-3";
    const SYS_CONTRA = "sys-contra-4";

    it("2.1 deposit perspective: destination matches target -> inflow; source matches target -> ignored", () => {
      const groups = [
        // Target is destination -> Inflow
        makeMockTxGroup([
          makeMockSplit({
            type: "deposit",
            amount: "700.000",
            source_id: "rev-salary",
            destination_id: ACC_TARGET,
          }),
        ]),
        // Target is uninvolved -> Ignored
        makeMockTxGroup([
          makeMockSplit({
            type: "deposit",
            amount: "300.000",
            source_id: "rev-dividend",
            destination_id: ACC_PEER,
          }),
        ]),
      ];

      const stats = computeAccount30dKpi(groups, ACC_TARGET);
      expect(stats.inflow.toString()).toBe("700");
      expect(stats.outflow.toString()).toBe("0");
      expect(stats.netChange.toString()).toBe("700");
      expect(stats.count).toBe(1);
    });

    it("2.2 withdrawal perspective: source matches target -> outflow; destination matches target -> ignored", () => {
      const groups = [
        // Target is source -> Outflow
        makeMockTxGroup([
          makeMockSplit({
            type: "withdrawal",
            amount: "150.000",
            source_id: ACC_TARGET,
            destination_id: "exp-groceries",
          }),
        ]),
        // Peer is source -> Ignored for target
        makeMockTxGroup([
          makeMockSplit({
            type: "withdrawal",
            amount: "90.000",
            source_id: ACC_PEER,
            destination_id: "exp-utilities",
          }),
        ]),
      ];

      const stats = computeAccount30dKpi(groups, ACC_TARGET);
      expect(stats.inflow.toString()).toBe("0");
      expect(stats.outflow.toString()).toBe("150");
      expect(stats.netChange.toString()).toBe("-150");
      expect(stats.count).toBe(1);
    });

    it("2.3 transfer bi-directional perspective: symmetric inflow vs outflow across both account IDs", () => {
      const transferGroup = makeMockTxGroup([
        makeMockSplit({
          type: "transfer",
          amount: "450.000",
          source_id: ACC_TARGET,
          destination_id: ACC_PEER,
        }),
      ]);

      // Perspective A: ACC_TARGET (the sender)
      const targetStats = computeAccount30dKpi([transferGroup], ACC_TARGET);
      expect(targetStats.inflow.toString()).toBe("0");
      expect(targetStats.outflow.toString()).toBe("450");
      expect(targetStats.netChange.toString()).toBe("-450");
      expect(targetStats.count).toBe(1);

      // Perspective B: ACC_PEER (the receiver)
      const peerStats = computeAccount30dKpi([transferGroup], ACC_PEER);
      expect(peerStats.inflow.toString()).toBe("450");
      expect(peerStats.outflow.toString()).toBe("0");
      expect(peerStats.netChange.toString()).toBe("450");
      expect(peerStats.count).toBe(1);

      // Perspective C: ACC_THIRD_PARTY (completely uninvolved)
      const thirdStats = computeAccount30dKpi([transferGroup], ACC_THIRD_PARTY);
      expect(thirdStats.inflow.toString()).toBe("0");
      expect(thirdStats.outflow.toString()).toBe("0");
      expect(thirdStats.netChange.toString()).toBe("0");
      expect(thirdStats.count).toBe(0);
    });

    it("2.4 transfer foreign amount: destination uses foreign_amount, source uses native amount", () => {
      // Transfer 100 USD (source) -> 37.700 BHD (destination)
      const fxTransfer = makeMockTxGroup([
        makeMockSplit({
          type: "transfer",
          amount: "100.000",
          currency_code: "USD",
          foreign_amount: "37.700",
          foreign_currency_code: "BHD",
          source_id: ACC_TARGET,
          destination_id: ACC_PEER,
        }),
      ]);

      // Sender (ACC_TARGET in USD): outflow = 100.000
      const senderStats = computeAccount30dKpi([fxTransfer], ACC_TARGET);
      expect(senderStats.outflow.toString()).toBe("100");

      // Receiver (ACC_PEER in BHD): inflow = 37.700 (via foreign_amount)
      const receiverStats = computeAccount30dKpi([fxTransfer], ACC_PEER);
      expect(receiverStats.inflow.toString()).toBe("37.7");
    });

    it("2.5 opening balance directionality: destination is inflow, contra source is outflow", () => {
      const openingGroup = makeMockTxGroup([
        makeMockSplit({
          type: "opening balance",
          amount: "5000.000",
          source_id: SYS_CONTRA,
          destination_id: ACC_TARGET,
        }),
      ]);

      // Target asset account perspective:
      const targetStats = computeAccount30dKpi([openingGroup], ACC_TARGET);
      expect(targetStats.inflow.toString()).toBe("5000");
      expect(targetStats.outflow.toString()).toBe("0");
      expect(targetStats.netChange.toString()).toBe("5000");

      // System contra account perspective:
      const contraStats = computeAccount30dKpi([openingGroup], SYS_CONTRA);
      expect(contraStats.inflow.toString()).toBe("0");
      expect(contraStats.outflow.toString()).toBe("5000");
      expect(contraStats.netChange.toString()).toBe("-5000");
    });

    it("2.6 reconciliation directionality: upward adjustment is inflow, downward adjustment is outflow", () => {
      const reconciliationGroups = [
        // Upward: +50 BHD adjustment from reconciliation account to target
        makeMockTxGroup([
          makeMockSplit({
            type: "reconciliation",
            amount: "50.000",
            source_id: "sys-reconciliation",
            destination_id: ACC_TARGET,
          }),
        ]),
        // Downward: -15 BHD adjustment from target to reconciliation account
        makeMockTxGroup([
          makeMockSplit({
            type: "reconciliation",
            amount: "15.000",
            source_id: ACC_TARGET,
            destination_id: "sys-reconciliation",
          }),
        ]),
      ];

      const stats = computeAccount30dKpi(reconciliationGroups, ACC_TARGET);
      expect(stats.inflow.toString()).toBe("50");
      expect(stats.outflow.toString()).toBe("15");
      expect(stats.netChange.toString()).toBe("35");
      expect(stats.count).toBe(2);
    });

    it("2.7 defensive handling of corrupted splits: null amount, text amount, empty transactions", () => {
      const corruptedGroups = [
        makeMockTxGroup([
          makeMockSplit({
            type: "deposit",
            amount: "corrupted_text" as unknown as string,
            destination_id: ACC_TARGET,
          }),
          makeMockSplit({
            type: "transfer",
            amount: "100.000",
            foreign_amount: "corrupted_fx",
            source_id: ACC_PEER,
            destination_id: ACC_TARGET,
          }),
        ]),
        { attributes: { transactions: [] } } as unknown as Resource<TransactionGroup>,
      ];

      const stats = computeAccount30dKpi(corruptedGroups, ACC_TARGET);
      // Corrupted deposit amounts to 0; corrupted fx falls back to base amount 100.000
      expect(stats.inflow.toString()).toBe("100");
      expect(stats.outflow.toString()).toBe("0");
    });
  });

  // ==========================================================================
  // 3. Exact Screenshot Scenario & Adversarial Payoff Card Verification
  // ==========================================================================
  describe("3. Full Screenshot Scenario & Debts Payoff Card Empirical Challenge", () => {
    // The exact 5-account dataset observed in user screenshot media_1794079063580_4a3ae8cd.png:
    const screenshotAccounts: Resource<Account>[] = [
      makeMockAccount({
        id: "acc-loan-almosawi",
        name: "Almosawi - 100",
        type: "loan",
        liability_type: "loan",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "acc-cc-ila-white",
        name: "ila White",
        type: "asset",
        account_role: "ccAsset",
        current_balance: "0.000",
        active: true,
      }),
      makeMockAccount({
        id: "acc-contra-almosawi",
        name: 'Initial balance for "Almosawi - 100"',
        type: "initial-balance",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "acc-contra-alnoohy-100",
        name: 'Initial balance for "Alnoohy - 100 GY..."',
        type: "initial-balance",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "acc-contra-alnoohy-400",
        name: 'Initial balance for "Alnoohy - 400 Lap..."',
        type: "initial-balance",
        current_balance: "-400.000",
        active: true,
      }),
    ];

    // Adversarial transactions containing:
    // 1. Initial balance setup transaction of 100 BHD to Almosawi (MUST NOT COUNT AS REPAYMENT)
    // 2. Initial balance setup transaction of 400 BHD (MUST NOT COUNT AS REPAYMENT)
    // 3. Genuine repayment transfer of 25 BHD from Checking to Almosawi - 100
    const adversarialTxs: Resource<TransactionGroup>[] = [
      makeMockTxGroup([
        makeMockSplit({
          type: "opening balance",
          amount: "100.000",
          source_id: "acc-contra-almosawi",
          destination_id: "acc-loan-almosawi",
          description: "Initial balance for Almosawi - 100",
        }),
      ]),
      makeMockTxGroup([
        makeMockSplit({
          type: "opening balance",
          amount: "400.000",
          source_id: "acc-contra-alnoohy-400",
          destination_id: "acc-laptop-asset",
          description: "Initial balance for laptop",
        }),
      ]),
      makeMockTxGroup([
        makeMockSplit({
          type: "transfer",
          amount: "25.000",
          source_id: "acc-main-checking",
          destination_id: "acc-loan-almosawi",
          destination_name: "Almosawi - 100",
          description: "Installment #1 repayment",
        }),
      ]),
    ];

    const ctx: ExtraCardContext = {
      transactions: adversarialTxs,
      allTransactions: adversarialTxs,
      accounts: screenshotAccounts,
      allAccounts: screenshotAccounts,
      toPrimary: (amount) => new Decimal(amount),
      primaryCode: "BHD",
      primaryDecimals: 3,
      primarySymbol: "BHD",
      balancesByCurrency: [{ code: "BHD", decimals: 3, symbol: "BHD", total: new Decimal(-700) }],
      bills: [],
      piggies: [],
      barData: [],
      trendData: [],
    };

    it("3.1 excludes all 3 initial-balance contra-accounts and the 0-balance credit card from qualified debts", () => {
      const qualified = screenshotAccounts.filter((a) => {
        if (a.attributes.active === false) return false;
        if (isSystemContraAccount(a)) return false;
        const type = String(a.attributes.type || "").toLowerCase().trim();
        const role = a.attributes.account_role;
        const bal = Number(a.attributes.current_balance ?? 0);
        const isLiabilityType = LIABILITY_TYPES.has(type) || Boolean(a.attributes.liability_type);
        const isCcAssetDebt = role === "ccAsset" && bal < 0;
        return isLiabilityType || isCcAssetDebt;
      });

      // Exactly 1 account must qualify: Almosawi - 100
      expect(qualified.length).toBe(1);
      expect(qualified[0].id).toBe("acc-loan-almosawi");
      expect(qualified[0].attributes.name).toBe("Almosawi - 100");

      // Verify Remaining Debt is strictly 100 BHD, NOT 700 BHD
      const totalRemaining = qualified.reduce(
        (sum, a) => sum.plus(new Decimal(a.attributes.current_balance ?? 0).abs()),
        new Decimal(0),
      );
      expect(totalRemaining.toString()).toBe("100");
    });

    it("3.2 renders Debts & Liabilities Payoff DOM: assert 100.000 BHD remaining, 25.000 BHD paid, NO contra accounts", () => {
      const qc = createTestQueryClient();
      const html = renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <ExtraCard
            card={{
              key: "liabilities",
              title: "Debts & Liabilities Payoff",
              span: 1,
              periodDays: 30,
              visible: true,
              recordLimit: 5,
            }}
            ctx={ctx}
          />
        </QueryClientProvider>,
      );

      // Must display Almosawi - 100
      expect(html).toContain("Almosawi - 100");

      // Must NEVER display any initial balance accounts or their balances
      expect(html).not.toContain("Initial balance for");
      expect(html).not.toContain("Alnoohy - 100");
      expect(html).not.toContain("Alnoohy - 400");

      // Remaining debt must be 100.000 BHD
      expect(html).toContain("100.000");

      // Must NOT display the old erroneous 700.000 BHD
      expect(html).not.toContain("700.000");

      // Paid so far must strictly reflect genuine repayment (25.000 BHD), NOT opening balance (100.000 or 125.000)
      expect(html).toContain("25.000");
    });

    it("3.3 verifies computeCreditDebtGauge filters out all contra-accounts and 0-balance credit cards", () => {
      const gauge = computeCreditDebtGauge(
        screenshotAccounts.map((a) => ({
          type: a.attributes.type,
          liability_type: a.attributes.liability_type ?? undefined,
          account_role: a.attributes.account_role,
          current_balance: a.attributes.current_balance ?? "0",
        })),
      );

      // Only Almosawi - 100 (100.000 BHD) should count toward totalDebt
      expect(gauge.totalDebt.toString()).toBe("100");
      // ila White has balance 0, so creditCardDebt must be 0
      expect(gauge.creditCardDebt.toString()).toBe("0");
    });
  });
});
