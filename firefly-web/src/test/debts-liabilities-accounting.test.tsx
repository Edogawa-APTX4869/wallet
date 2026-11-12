import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Decimal from "decimal.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Resource, TransactionGroup, TransactionType } from "@/lib/firefly/types";
import {
  ExtraCard,
  isSystemContraAccount,
  LIABILITY_TYPES,
  type ExtraCardContext,
} from "@/app/(app)/dashboard-extra-cards";

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

function makeMockTx(params: {
  id: string;
  type: TransactionType;
  amount: string;
  date?: string;
  sourceId?: string;
  sourceName?: string;
  destId?: string;
  destName?: string;
  desc?: string;
}): Resource<TransactionGroup> {
  return {
    id: params.id,
    type: "transactions",
    attributes: {
      group_title: params.desc || "Transaction",
      transactions: [
        {
          transaction_journal_id: `${params.id}-1`,
          type: params.type,
          date: params.date || "2026-11-01T12:00:00Z",
          amount: params.amount,
          description: params.desc || "Test transaction",
          source_id: params.sourceId,
          source_name: params.sourceName || "Source",
          destination_id: params.destId,
          destination_name: params.destName || "Destination",
          currency_code: "BHD",
          currency_decimal_places: 3,
        },
      ],
    },
  };
}

describe("Debts & Liabilities Payoff Accounting & Initial-Balance Exclusion (R1 & Acceptance Criteria)", () => {
  describe("1. isSystemContraAccount: Precision System Account Recognition", () => {
    it("1.1 identifies system contra-account types (initial-balance, reconciliation, import)", () => {
      const initAcc = makeMockAccount({ id: "1", type: "initial-balance" });
      const recAcc = makeMockAccount({ id: "2", type: "reconciliation" });
      const impAcc = makeMockAccount({ id: "3", type: "import" });
      const sysAcc = makeMockAccount({ id: "4", type: "system" });

      expect(isSystemContraAccount(initAcc)).toBe(true);
      expect(isSystemContraAccount(recAcc)).toBe(true);
      expect(isSystemContraAccount(impAcc)).toBe(true);
      expect(isSystemContraAccount(sysAcc)).toBe(true);
    });

    it("1.2 identifies accounts whose name starts with 'Initial balance for' regardless of casing", () => {
      const namedContra1 = makeMockAccount({
        id: "10",
        name: 'Initial balance for "Almosawi - 100"',
        type: "asset",
      });
      const namedContra2 = makeMockAccount({
        id: "11",
        name: "initial balance for Checking",
        type: "initial-balance",
      });

      expect(isSystemContraAccount(namedContra1)).toBe(true);
      expect(isSystemContraAccount(namedContra2)).toBe(true);
    });

    it("1.3 identifies system account roles (initialBalance, reconciliation)", () => {
      const roleContra = makeMockAccount({
        id: "20",
        name: "Opening Equity",
        account_role: "initialBalance",
      });
      expect(isSystemContraAccount(roleContra)).toBe(true);
    });

    it("1.4 correctly preserves real user accounts (loans, debts, assets, credit cards)", () => {
      const loanAcc = makeMockAccount({ id: "30", name: "Almosawi - 100", type: "loan" });
      const assetAcc = makeMockAccount({ id: "31", name: "ila White", type: "asset", account_role: "ccAsset" });
      const checkingAcc = makeMockAccount({ id: "32", name: "Main Checking", type: "asset" });
      const mortgageAcc = makeMockAccount({ id: "33", name: "Home Mortgage", type: "mortgage" });

      expect(isSystemContraAccount(loanAcc)).toBe(false);
      expect(isSystemContraAccount(assetAcc)).toBe(false);
      expect(isSystemContraAccount(checkingAcc)).toBe(false);
      expect(isSystemContraAccount(mortgageAcc)).toBe(false);
    });
  });

  describe("2. Screenshot Reference Scenario: 100 BHD True Debt Verification", () => {
    // Realistic dataset matching user-uploaded artifact media_1794079063580_4a3ae8cd.png
    const screenshotAccounts = [
      makeMockAccount({
        id: "101",
        name: "Almosawi - 100",
        type: "loan",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "102",
        name: "ila White",
        type: "asset",
        account_role: "ccAsset",
        current_balance: "0.000",
        active: true,
      }),
      makeMockAccount({
        id: "103",
        name: 'Initial balance for "Almosawi - 100"',
        type: "initial-balance",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "104",
        name: 'Initial balance for "Alnoohy - 100 GY..."',
        type: "initial-balance",
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "105",
        name: 'Initial balance for "Alnoohy - 400 Lap..."',
        type: "initial-balance",
        current_balance: "-400.000",
        active: true,
      }),
    ];

    const ctx: ExtraCardContext = {
      transactions: [],
      allTransactions: [],
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

    it("2.1 excludes all 3 initial-balance contra-accounts and 0-balance ccAsset from liabilities", () => {
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

      // Exactly 1 account qualifies: Almosawi - 100
      expect(qualified.length).toBe(1);
      expect(qualified[0].attributes.name).toBe("Almosawi - 100");
      expect(qualified[0].attributes.type).toBe("loan");

      // Verify ZERO initial-balance accounts qualify
      const contraFound = qualified.some((a) => isSystemContraAccount(a));
      expect(contraFound).toBe(false);

      // Verify remaining debt is exactly 100 BHD, not 700 BHD
      const totalRemaining = qualified.reduce(
        (sum, a) => sum.plus(new Decimal(a.attributes.current_balance ?? 0).abs()),
        new Decimal(0),
      );
      expect(totalRemaining.toString()).toBe("100");
    });

    it("2.2 renders ExtraCard DOM matching exactly 100.000 BHD remaining and 0 contra accounts", () => {
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

      // Must render true loan
      expect(html).toContain("Almosawi - 100");

      // Must NEVER render initial-balance system accounts
      expect(html).not.toContain("Initial balance for");
      expect(html).not.toContain("Alnoohy - 100");
      expect(html).not.toContain("Alnoohy - 400");

      // Must render remaining debt of 100.000 BHD
      expect(html).toContain("100.000");
      // Must NOT show old inflated 700.000 BHD
      expect(html).not.toContain("700.000");
    });
  });

  describe("3. Credit Cards & Overdrawn Accounts Classification", () => {
    it("3.1 includes asset credit cards (ccAsset) with active debt (balance < 0)", () => {
      const accounts = [
        makeMockAccount({
          id: "201",
          name: "Visa Platinum",
          type: "asset",
          account_role: "ccAsset",
          current_balance: "-250.500",
        }),
      ];

      const qualified = accounts.filter((a) => {
        if (a.attributes.active === false) return false;
        if (isSystemContraAccount(a)) return false;
        const type = String(a.attributes.type || "").toLowerCase().trim();
        const role = a.attributes.account_role;
        const bal = Number(a.attributes.current_balance ?? 0);
        return LIABILITY_TYPES.has(type) || Boolean(a.attributes.liability_type) || (role === "ccAsset" && bal < 0);
      });

      expect(qualified.length).toBe(1);
      expect(new Decimal(qualified[0].attributes.current_balance ?? 0).abs().toString()).toBe("250.5");
    });

    it("3.2 excludes asset credit cards with zero or positive balance (no active debt)", () => {
      const accounts = [
        makeMockAccount({
          id: "202",
          name: "Zero Balance CC",
          type: "asset",
          account_role: "ccAsset",
          current_balance: "0.000",
        }),
        makeMockAccount({
          id: "203",
          name: "Credit Surplus CC",
          type: "asset",
          account_role: "ccAsset",
          current_balance: "50.000",
        }),
      ];

      const qualified = accounts.filter((a) => {
        if (a.attributes.active === false) return false;
        if (isSystemContraAccount(a)) return false;
        const type = String(a.attributes.type || "").toLowerCase().trim();
        const role = a.attributes.account_role;
        const bal = Number(a.attributes.current_balance ?? 0);
        return LIABILITY_TYPES.has(type) || Boolean(a.attributes.liability_type) || (role === "ccAsset" && bal < 0);
      });

      expect(qualified.length).toBe(0);
    });

    it("3.3 does NOT classify overdrawn general asset accounts as debts/loans", () => {
      const accounts = [
        makeMockAccount({
          id: "204",
          name: "Overdrawn Checking",
          type: "asset",
          account_role: "defaultAsset",
          current_balance: "-350.000",
        }),
      ];

      const qualified = accounts.filter((a) => {
        if (a.attributes.active === false) return false;
        if (isSystemContraAccount(a)) return false;
        const type = String(a.attributes.type || "").toLowerCase().trim();
        const role = a.attributes.account_role;
        const bal = Number(a.attributes.current_balance ?? 0);
        return LIABILITY_TYPES.has(type) || Boolean(a.attributes.liability_type) || (role === "ccAsset" && bal < 0);
      });

      expect(qualified.length).toBe(0);
    });
  });

  describe("4. Debt Repayment Calculation (paidRaw)", () => {
    it("4.1 excludes opening balance and reconciliation transactions from debt repayment", () => {
      const loan = makeMockAccount({
        id: "301",
        name: "Personal Loan",
        type: "loan",
        current_balance: "-500.000",
      });

      const transactions = [
        // Opening balance journal entry (must NOT be counted as payment)
        makeMockTx({
          id: "tx-1",
          type: "opening balance",
          amount: "500.000",
          destId: "301",
          destName: "Personal Loan",
        }),
        // Reconciliation adjustment (must NOT be counted as payment)
        makeMockTx({
          id: "tx-2",
          type: "reconciliation",
          amount: "25.000",
          destId: "301",
          destName: "Personal Loan",
        }),
        // Actual transfer payment toward loan (counted as repayment)
        makeMockTx({
          id: "tx-3",
          type: "transfer",
          amount: "100.000",
          destId: "301",
          destName: "Personal Loan",
        }),
        // Second installment payment (counted as repayment)
        makeMockTx({
          id: "tx-4",
          type: "transfer",
          amount: "50.000",
          destId: "301",
          destName: "Personal Loan",
        }),
      ];

      const accNameLower = loan.attributes.name.toLowerCase();
      let paidRaw = new Decimal(0);
      let paymentCount = 0;

      for (const g of transactions) {
        for (const s of g.attributes.transactions) {
          if (s.type === "opening balance" || s.type === "reconciliation") {
            continue;
          }

          const isDest = String(s.destination_id) === String(loan.id);
          const isSource = String(s.source_id) === String(loan.id);
          const nameMatch =
            (s.destination_name || "").toLowerCase() === accNameLower ||
            (s.description || "").toLowerCase().includes(accNameLower);

          if (isDest || (s.type === "withdrawal" && nameMatch && !isSource)) {
            const amt = new Decimal(s.amount || 0).abs();
            paidRaw = paidRaw.plus(amt);
            paymentCount++;
          }
        }
      }

      // Only tx-3 (100) and tx-4 (50) should be counted -> 150 BHD paid
      expect(paidRaw.toString()).toBe("150");
      expect(paymentCount).toBe(2);
    });
  });

  describe("5. Firefly III Direction-Aware Liabilities Scenario (media_1794482692716_2e4b6db2)", () => {
    // 5 accounts matching the user's Firefly III liabilities table
    const fireflyLiabilities = [
      makeMockAccount({
        id: "l-1",
        name: "Almosawi - 100",
        type: "loan",
        liability_type: "loan",
        liability_direction: "credit", // Owed this debt
        current_balance: "-70.000",
        active: true,
      }),
      makeMockAccount({
        id: "l-2",
        name: "Alnoohy - 100 GYM",
        type: "loan",
        liability_type: "loan",
        liability_direction: "credit", // Owed this debt
        current_balance: "-100.000",
        active: true,
      }),
      makeMockAccount({
        id: "l-3",
        name: "Alnoohy - 400 Laptop",
        type: "loan",
        liability_type: "loan",
        liability_direction: "credit", // Owed this debt
        current_balance: "-400.000",
        active: true,
      }),
      makeMockAccount({
        id: "l-4",
        name: "Ali Sarhan - 415",
        type: "loan",
        liability_type: "loan",
        liability_direction: "credit", // Owed this debt
        current_balance: "-265.000",
        active: true,
      }),
      makeMockAccount({
        id: "l-5",
        name: "Ali Abdulwahed - 200",
        type: "loan",
        liability_type: "loan",
        liability_direction: "credit", // Owed this debt
        current_balance: "-200.000",
        active: true,
      }),
    ];

    // Transactions including loan disbursements (withdrawals to the borrowers)
    // In credit liabilities, disbursements must NEVER be counted as repayments!
    const transactions = [
      // Disbursed initial loan to Ali Sarhan (withdrawal)
      makeMockTx({
        id: "disburse-1",
        type: "withdrawal",
        amount: "415.000",
        destName: "Ali Sarhan - 415",
        desc: "Lend money to Ali Sarhan",
      }),
      // Disbursed initial loan to Ali Abdulwahed (withdrawal)
      makeMockTx({
        id: "disburse-2",
        type: "withdrawal",
        amount: "200.000",
        destName: "Ali Abdulwahed - 200",
        desc: "Lend money to Ali Abdulwahed",
      }),
    ];

    const ctx: ExtraCardContext = {
      transactions,
      allTransactions: transactions,
      accounts: fireflyLiabilities,
      allAccounts: fireflyLiabilities,
      toPrimary: (amount) => new Decimal(amount),
      primaryCode: "BHD",
      primaryDecimals: 3,
      primarySymbol: "BHD",
      balancesByCurrency: [{ code: "BHD", decimals: 3, symbol: "BHD", total: new Decimal(-1035) }],
      bills: [],
      piggies: [],
      barData: [],
      trendData: [],
    };

    it("5.1 computes correct Remaining (1,035.000 BHD) and Collected (180.000 BHD) without disbursement inflation", () => {
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
              recordLimit: 10,
            }}
            ctx={ctx}
          />
        </QueryClientProvider>,
      );

      // Remaining total across all 5 accounts: 70 + 100 + 400 + 265 + 200 = 1,035.000 BHD
      expect(html).toContain("1,035.000");

      // Collected total across all 5 accounts: (100-70=30) + 0 + 0 + (415-265=150) + 0 = 180.000 BHD
      expect(html).toContain("180.000");

      // Verify that the old inflated total of 680 (415 + 265) or 400 (200 + 200) is NOT present
      expect(html).not.toContain("680.000");
      expect(html).not.toContain("415.000 remaining");

      // Ali Sarhan: Paid/Collected = 150.000, Remaining = 265.000 (36%)
      expect(html).toContain("Ali Sarhan - 415");
      expect(html).toContain("150.000");
      expect(html).toContain("265.000");
      expect(html).toContain("36%");

      // Ali Abdulwahed: Paid/Collected = 0.000, Remaining = 200.000 (0%)
      expect(html).toContain("Ali Abdulwahed - 200");
      expect(html).toContain("200.000");

      // Direction badge & role label
      expect(html).toContain("Owed to me");
      expect(html).toContain("Collected");

      // No fake ~1 payment remaining when expected is 0
      expect(html).not.toContain("Est. payoff: ~1 payment remaining");
    });

    it("5.2 treats incoming repayments (deposits from debtor) as genuine debt collection", () => {
      // Suppose Ali Sarhan pays back 65 BHD more via deposit
      const repaymentTx = makeMockTx({
        id: "repay-1",
        type: "deposit",
        amount: "65.000",
        sourceName: "Ali Sarhan - 415",
        desc: "Repayment from Ali Sarhan",
      });

      const updatedTxs = [...transactions, repaymentTx];
      // Remaining drops from 265 to 200
      const updatedAccounts = fireflyLiabilities.map((a) =>
        a.id === "l-4" ? { ...a, attributes: { ...a.attributes, current_balance: "-200.000" } } : a,
      );

      const updatedCtx: ExtraCardContext = {
        ...ctx,
        transactions: updatedTxs,
        allTransactions: updatedTxs,
        accounts: updatedAccounts,
        allAccounts: updatedAccounts,
      };

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
              recordLimit: 10,
            }}
            ctx={updatedCtx}
          />
        </QueryClientProvider>,
      );

      // Ali Sarhan: 415 total, remaining 200, paid 215 -> 52%
      expect(html).toContain("215.000");
      expect(html).toContain("52%");
    });
  });
});
