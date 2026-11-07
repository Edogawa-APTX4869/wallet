import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Decimal from "decimal.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Bill, Resource, TransactionGroup, TransactionType } from "@/lib/firefly/types";
import {
  ExtraCard,
  isSystemContraAccount,
  type ExtraCardContext,
} from "@/app/(app)/dashboard-extra-cards";
import {
  computeCreditDebtGauge,
} from "@/app/(app)/reports/components/reports-math";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeAccount(attrs: Partial<Account> & { id: string }): Resource<Account> {
  const { id, ...rest } = attrs;
  return {
    id,
    type: "accounts",
    attributes: {
      name: rest.name || `Account ${id}`,
      type: rest.type || "asset",
      active: rest.active ?? true,
      current_balance: rest.current_balance ?? "0.000",
      currency_code: rest.currency_code ?? "BHD",
      currency_decimal_places: rest.currency_decimal_places ?? 3,
      currency_symbol: rest.currency_symbol ?? "BHD",
      ...rest,
    },
  };
}

function makeTxGroup(params: {
  id: string;
  splits: Array<{
    type: TransactionType;
    amount: string;
    sourceId?: string;
    sourceName?: string;
    destId?: string;
    destName?: string;
    desc?: string;
    date?: string;
  }>;
}): Resource<TransactionGroup> {
  return {
    id: params.id,
    type: "transactions",
    attributes: {
      group_title: params.splits[0]?.desc || "Tx Group",
      transactions: params.splits.map((s, idx) => ({
        transaction_journal_id: `${params.id}-${idx}`,
        type: s.type,
        date: s.date || "2026-11-01T12:00:00Z",
        amount: s.amount,
        description: s.desc || "Split",
        source_id: s.sourceId,
        source_name: s.sourceName || "Source",
        destination_id: s.destId,
        destination_name: s.destName || "Destination",
        currency_code: "BHD",
        currency_decimal_places: 3,
      })),
    },
  };
}

function makeContext(params: {
  accounts: Resource<Account>[];
  transactions?: Resource<TransactionGroup>[];
  bills?: Resource<Bill>[];
}): ExtraCardContext {
  return {
    transactions: params.transactions || [],
    allTransactions: params.transactions || [],
    accounts: params.accounts,
    allAccounts: params.accounts,
    toPrimary: (amount) => new Decimal(amount),
    primaryCode: "BHD",
    primaryDecimals: 3,
    primarySymbol: "BHD",
    balancesByCurrency: [{ code: "BHD", decimals: 3, symbol: "BHD", total: new Decimal(0) }],
    bills: params.bills || [],
    piggies: [],
    barData: [],
    trendData: [],
  };
}

describe("Adversarial Empirical Stress Suite: Accounting & Debt Payoff Logic", () => {
  // ==========================================================================
  // Section 1: System Contra-Account Filtering & Casing Stress Test
  // ==========================================================================
  describe("1. System Contra-Account Stress Testing", () => {
    it("1.1 catches all system account types regardless of casing, trimming, and hyphens", () => {
      const edgeAccounts = [
        makeAccount({ id: "1", type: "initial-balance" }),
        makeAccount({ id: "2", type: "INITIAL-BALANCE" }),
        makeAccount({ id: "3", type: "  initial-balance  " }),
        makeAccount({ id: "4", type: "initial_balance" }),
        makeAccount({ id: "5", type: "INITIAL_BALANCE" }),
        makeAccount({ id: "6", type: "reconciliation" }),
        makeAccount({ id: "7", type: "RECONCILIATION" }),
        makeAccount({ id: "8", type: "import" }),
        makeAccount({ id: "9", type: "IMPORT" }),
        makeAccount({ id: "10", type: "system" }),
        makeAccount({ id: "11", type: "SYSTEM" }),
      ];

      for (const acc of edgeAccounts) {
        expect(isSystemContraAccount(acc), `Account type '${acc.attributes.type}' should be contra-account`).toBe(true);
      }
    });

    it("1.2 catches accounts whose name starts with 'initial balance for' with arbitrary casing and formatting", () => {
      const namedAccounts = [
        makeAccount({ id: "20", name: 'Initial balance for "Almosawi - 100"', type: "asset" }),
        makeAccount({ id: "21", name: 'INITIAL BALANCE FOR "ALNOOHY"', type: "asset" }),
        makeAccount({ id: "22", name: '  initial balance for "Spaced Account"  ', type: "asset" }),
        makeAccount({ id: "23", name: 'Initial Balance For Checking', type: "asset" }),
        makeAccount({ id: "24", name: 'initial balance for credit card', type: "asset" }),
      ];

      for (const acc of namedAccounts) {
        expect(isSystemContraAccount(acc), `Account name '${acc.attributes.name}' should be contra-account`).toBe(true);
      }
    });

    it("1.3 identifies system account roles (initialBalance, initial-balance, reconciliation)", () => {
      const roleAccounts = [
        makeAccount({ id: "30", account_role: "initialBalance" }),
        makeAccount({ id: "31", account_role: "initial-balance" }),
        makeAccount({ id: "32", account_role: "reconciliation" }),
        makeAccount({ id: "33", account_role: "INITIALBALANCE" }),
      ];

      for (const acc of roleAccounts) {
        expect(isSystemContraAccount(acc), `Account role '${acc.attributes.account_role}' should be contra-account`).toBe(true);
      }
    });

    it("1.4 does NOT false-positive genuine user accounts with 'initial' in the middle or end of name", () => {
      const genuineAccounts = [
        makeAccount({ id: "40", name: "Initial Public Offering Fund", type: "asset" }),
        makeAccount({ id: "41", name: "My Initial Capital", type: "asset" }),
        makeAccount({ id: "42", name: "Client Initials Account", type: "asset" }),
        makeAccount({ id: "43", name: "Mortgage Loan", type: "mortgage" }),
        makeAccount({ id: "44", name: "Student Loan - Initial Phase", type: "loan" }),
      ];

      for (const acc of genuineAccounts) {
        expect(isSystemContraAccount(acc), `Account '${acc.attributes.name}' must NOT be flagged as contra-account`).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Section 2: Overdrawn Asset Accounts Exclusion
  // ==========================================================================
  describe("2. Overdrawn Asset Accounts Exclusion", () => {
    it("2.1 excludes overdrawn general asset accounts with negative balances from liabilities", () => {
      const overdrawnChecking = makeAccount({
        id: "50",
        name: "Main Overdrawn Checking",
        type: "asset",
        account_role: "defaultAsset",
        current_balance: "-1500.000",
        active: true,
      });

      const overdrawnSavings = makeAccount({
        id: "51",
        name: "Overdraft Savings",
        type: "asset",
        account_role: null,
        current_balance: "-50.000",
        active: true,
      });

      const realLoan = makeAccount({
        id: "52",
        name: "Car Loan",
        type: "loan",
        current_balance: "-3000.000",
        active: true,
      });

      const ctx = makeContext({ accounts: [overdrawnChecking, overdrawnSavings, realLoan] });

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

      // Only Car Loan should be rendered
      expect(html).toContain("Car Loan");
      expect(html).not.toContain("Main Overdrawn Checking");
      expect(html).not.toContain("Overdraft Savings");
      // Remaining debt should be 3,000.000 BHD, not 4,550.000 BHD
      expect(html).toContain("3,000.000");
      expect(html).not.toContain("4,550.000");
    });

    it("2.2 renders empty state when ONLY overdrawn asset accounts exist", () => {
      const overdrawnOnly = [
        makeAccount({ id: "60", name: "Checking Negative", type: "asset", current_balance: "-200.000" }),
        makeAccount({ id: "61", name: "Cash Wallet Deficit", type: "asset", current_balance: "-10.000" }),
      ];

      const ctx = makeContext({ accounts: overdrawnOnly });
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

      expect(html).toContain("No active liabilities or debts — well done!");
    });
  });

  // ==========================================================================
  // Section 3: Credit Card (ccAsset) Triple-State Verification
  // ==========================================================================
  describe("3. Credit Card (ccAsset) State Verification", () => {
    it("3.1 State 1: Active debt (balance < 0) IS included in Debts & Liabilities Payoff", () => {
      const ccWithDebt = makeAccount({
        id: "70",
        name: "Standard Chartered CC",
        type: "asset",
        account_role: "ccAsset",
        current_balance: "-450.000",
        active: true,
      });

      const ctx = makeContext({ accounts: [ccWithDebt] });
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

      expect(html).toContain("Standard Chartered CC");
      expect(html).toContain("450.000");
    });

    it("3.2 State 2: Zero balance (balance === 0) is EXCLUDED from Debts & Liabilities Payoff", () => {
      const ccZero = makeAccount({
        id: "71",
        name: "ila White Zero CC",
        type: "asset",
        account_role: "ccAsset",
        current_balance: "0.000",
        active: true,
      });

      const ctx = makeContext({ accounts: [ccZero] });
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

      expect(html).toContain("No active liabilities or debts — well done!");
      expect(html).not.toContain("ila White Zero CC");
    });

    it("3.3 State 3: Positive balance / credit surplus (balance > 0) is EXCLUDED from Debts & Liabilities Payoff", () => {
      const ccSurplus = makeAccount({
        id: "72",
        name: "Amex Overpaid CC",
        type: "asset",
        account_role: "ccAsset",
        current_balance: "120.000",
        active: true,
      });

      const ctx = makeContext({ accounts: [ccSurplus] });
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

      expect(html).toContain("No active liabilities or debts — well done!");
      expect(html).not.toContain("Amex Overpaid CC");
    });
  });

  // ==========================================================================
  // Section 4: Loan Repayments, Split Transactions & Opening Balances
  // ==========================================================================
  describe("4. Loan Repayments, Splits & Opening Balances in paidRaw", () => {
    it("4.1 accurately separates genuine transfers, split payments, and ignores opening balances", () => {
      const loan = makeAccount({
        id: "80",
        name: "Auto Loan",
        type: "loan",
        current_balance: "-4000.000",
        active: true,
      });

      const txs = [
        // 1. Opening balance: must NOT be counted as payment
        makeTxGroup({
          id: "tx-open",
          splits: [
            {
              type: "opening balance",
              amount: "5000.000",
              destId: "80",
              destName: "Auto Loan",
            },
          ],
        }),
        // 2. Reconciliation balance correction: must NOT be counted as payment
        makeTxGroup({
          id: "tx-rec",
          splits: [
            {
              type: "reconciliation",
              amount: "100.000",
              destId: "80",
              destName: "Auto Loan",
            },
          ],
        }),
        // 3. Regular monthly transfer installment: MUST be counted as payment
        makeTxGroup({
          id: "tx-pay-1",
          splits: [
            {
              type: "transfer",
              amount: "500.000",
              sourceId: "checking-1",
              destId: "80",
              destName: "Auto Loan",
            },
          ],
        }),
        // 4. Split repayment transaction:
        //    Split 4a: Principal repayment to loan account (destId === 80) -> MUST be counted
        //    Split 4b: Loan interest to bank expense account -> destination_name contains loan name
        makeTxGroup({
          id: "tx-split-pay",
          splits: [
            {
              type: "transfer",
              amount: "400.000",
              sourceId: "checking-1",
              destId: "80",
              destName: "Auto Loan",
              desc: "Principal payment",
            },
            {
              type: "withdrawal",
              amount: "100.000",
              sourceId: "checking-1",
              destId: "bank-fees",
              destName: "Bank Fees",
              desc: "Interest on Auto Loan",
            },
          ],
        }),
        // 5. Loan advance / disbursement (loan is SOURCE, checking is DESTINATION):
        //    Must NOT be counted as a payment made toward the loan
        makeTxGroup({
          id: "tx-disburse",
          splits: [
            {
              type: "transfer",
              amount: "1000.000",
              sourceId: "80",
              sourceName: "Auto Loan",
              destId: "checking-1",
              destName: "Checking",
              desc: "Additional borrowing",
            },
          ],
        }),
      ];

      const ctx = makeContext({ accounts: [loan], transactions: txs });
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

      // Verify that:
      // - Opening balance (5000) was excluded
      // - Reconciliation (100) was excluded
      // - Loan advance (1000) was excluded
      // - Transfer 1 (500) + Split transfer (400) + Split withdrawal (100) = 1,000 BHD paid
      expect(html).toContain("Auto Loan");
      expect(html).toContain("1,000.000"); // Paid so far
      expect(html).toContain("4,000.000"); // Remaining
      // Total principal = 1000 + 4000 = 5000 -> 1000 / 5000 = 20%
      expect(html).toContain("20%");
    });
  });

  // ==========================================================================
  // Section 5: computeCreditDebtGauge Empirical Behavioral Audit
  // ==========================================================================
  describe("5. computeCreditDebtGauge Mathematical & Filtering Verification", () => {
    it("5.1 filters system accounts with type initial-balance, reconciliation, import regardless of casing", () => {
      const mixedAccounts = [
        { type: "initial-balance", current_balance: "500.00", credit_limit: "0" },
        { type: "INITIAL-BALANCE", current_balance: "200.00", credit_limit: "0" },
        { type: "reconciliation", current_balance: "100.00", credit_limit: "0" },
        { type: "import", current_balance: "50.00", credit_limit: "0" },
        { type: "initial_balance", current_balance: "300.00", credit_limit: "0" },
        // Genuine liability
        { type: "liability", liability_type: "loan", current_balance: "1500.00", credit_limit: "0" },
      ];

      const gauge = computeCreditDebtGauge(mixedAccounts);
      expect(gauge.totalDebt.toString()).toBe("1500");
      expect(gauge.creditCardDebt.toString()).toBe("0");
    });

    it("5.2 calculates revolving credit utilization and risk tiers accurately", () => {
      // Healthy (< 30%)
      const healthy = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "250.00", credit_limit: "1000.00" },
      ]);
      expect(healthy.utilizationPercent).toBe(25);
      expect(healthy.riskLevel).toBe("healthy");

      // Moderate (30% - 50%)
      const moderate = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "400.00", credit_limit: "1000.00" },
      ]);
      expect(moderate.utilizationPercent).toBe(40);
      expect(moderate.riskLevel).toBe("moderate");

      // High (> 50%)
      const high = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "750.00", credit_limit: "1000.00" },
      ]);
      expect(high.utilizationPercent).toBe(75);
      expect(high.riskLevel).toBe("high");
    });

    it("5.3 handles zero credit limit gracefully without dividing by zero", () => {
      const zeroLimit = computeCreditDebtGauge([
        { type: "liability", liability_type: "credit_card", current_balance: "500.00", credit_limit: "0" },
      ]);
      expect(zeroLimit.utilizationPercent).toBe(0);
      expect(zeroLimit.riskLevel).toBe("healthy");
      expect(zeroLimit.creditCardDebt.toString()).toBe("500");
      expect(zeroLimit.totalDebt.toString()).toBe("500");
    });

    it("5.4 empirical behavior on ccAsset with zero, negative, and positive balances", () => {
      // When ccAsset has 0 balance:
      const zeroCard = computeCreditDebtGauge([
        { account_role: "ccAsset", current_balance: "0", credit_limit: "2000" },
      ]);
      expect(zeroCard.creditCardDebt.toString()).toBe("0");
      expect(zeroCard.totalDebt.toString()).toBe("0");
      expect(zeroCard.totalCreditLimit.toString()).toBe("2000");
      expect(zeroCard.utilizationPercent).toBe(0);

      // When ccAsset has negative balance (active debt: -500):
      const debtCard = computeCreditDebtGauge([
        { account_role: "ccAsset", current_balance: "-500", credit_limit: "2000" },
      ]);
      expect(debtCard.creditCardDebt.toString()).toBe("500");
      expect(debtCard.totalDebt.toString()).toBe("500");
      expect(debtCard.utilizationPercent).toBe(25);

      // Observation on ccAsset with positive balance (e.g. +100):
      // In computeCreditDebtGauge, bal = new Decimal(acc.current_balance || 0).abs()
      // which evaluates +100 as 100 debt if passed directly to computeCreditDebtGauge.
      // But in dashboard-extra-cards.tsx, isCcAssetDebt requires bal < 0,
      // so it never enters the card in the first place!
      const positiveCard = computeCreditDebtGauge([
        { account_role: "ccAsset", current_balance: "100", credit_limit: "2000" },
      ]);
      expect(positiveCard.creditCardDebt.toString()).toBe("100");
    });
  });

  // ==========================================================================
  // Section 6: Comprehensive Screenshot Scenario Verification
  // ==========================================================================
  describe("6. Reference Screenshot Complete Scenario Verification", () => {
    it("6.1 reproduces the exact screenshot scenario and proves 100.000 BHD debt", () => {
      const accounts = [
        makeAccount({
          id: "1",
          name: "Almosawi - 100",
          type: "loan",
          current_balance: "-100.000",
          active: true,
        }),
        makeAccount({
          id: "2",
          name: "ila White",
          type: "asset",
          account_role: "ccAsset",
          current_balance: "0.000",
          active: true,
        }),
        makeAccount({
          id: "3",
          name: 'Initial balance for "Almosawi - 100"',
          type: "initial-balance",
          current_balance: "-100.000",
          active: true,
        }),
        makeAccount({
          id: "4",
          name: 'Initial balance for "Alnoohy - 100 GY..."',
          type: "initial-balance",
          current_balance: "-100.000",
          active: true,
        }),
        makeAccount({
          id: "5",
          name: 'Initial balance for "Alnoohy - 400 Lap..."',
          type: "initial-balance",
          current_balance: "-400.000",
          active: true,
        }),
      ];

      const ctx = makeContext({ accounts });
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

      // Must render exactly one card for Almosawi - 100
      expect(html).toContain("Almosawi - 100");
      // Must NOT contain any contra-accounts or 0-balance ccAsset
      expect(html).not.toContain("Initial balance for");
      expect(html).not.toContain("Alnoohy");
      expect(html).not.toContain("ila White");

      // Verify KPI values: Remaining must be exactly 100.000 BHD
      expect(html).toContain("100.000");
      // Must NOT contain old 700.000 BHD sum
      expect(html).not.toContain("700.000");
    });
  });
});
