import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NeedleGauge } from "@/components/needle-gauge";
import {
  computeNextAccountSelection,
  isEligibleWalletAccount,
  TwoColumnAccountGrid,
  type AccountGridItem,
} from "@/app/(app)/dashboard-client";
import type { Account, Resource } from "@/lib/firefly/types";

function makeAccount(attrs: Partial<Account>, id = "1"): Resource<Account> {
  return {
    id,
    type: "accounts",
    attributes: {
      name: attrs.name ?? "Account",
      type: attrs.type ?? "asset",
      active: attrs.active ?? true,
      include_net_worth: attrs.include_net_worth ?? true,
      ...attrs,
    },
  };
}

describe("BudgetBakers Wallet Mobile Experience Components", () => {
  it("renders NeedleGauge with tri-color arc and animated needle transform", () => {
    const html = renderToStaticMarkup(
      <NeedleGauge pct={75} label="BALANCE" value="BHD 5,676.032" size="lg" />,
    );
    expect(html).toContain("BALANCE");
    expect(html).toContain("BHD 5,676.032");
    // 75% maps to -85 + 0.75 * 170 = +42.5deg
    expect(html).toContain("rotate(42.5deg)");
    expect(html).toContain("#ef4444");
    expect(html).toContain("#f59e0b");
    expect(html).toContain("#10b981");
  });

  it("clamps NeedleGauge pct between 0 and 100 (-85deg to +85deg)", () => {
    const htmlLow = renderToStaticMarkup(<NeedleGauge pct={-20} label="CASH-FLOW" size="sm" />);
    expect(htmlLow).toContain("rotate(-85.0deg)");

    const htmlHigh = renderToStaticMarkup(<NeedleGauge pct={150} label="OUTLOOK" size="sm" />);
    expect(htmlHigh).toContain("rotate(85.0deg)");
  });

  it("renders vibrant selected tile and muted slate deselected tile in TwoColumnAccountGrid", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const accounts: AccountGridItem[] = [
      { id: "1", name: "Khaleeji Bank", balance: "100.00", currencyCode: "BHD", color: "#3b82f6" },
      { id: "2", name: "Scholarship", balance: "975.00", currencyCode: "BHD", color: "#10b981" },
    ];
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <TwoColumnAccountGrid
          accounts={accounts}
          selectedIdSet={new Set(["2"])}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("Khaleeji Bank");
    expect(html).toContain("Scholarship");
    // Selected tile (#2) has #10b981 border/bg and ring-1
    expect(html).toContain("#10b981");
    expect(html).toContain("ring-1 ring-primary/40");
    // Deselected tile (#1) has muted slate #78909c border/bg
    expect(html).toContain("#78909c");
  });

  describe("isEligibleWalletAccount Net Worth & Credit Card Inclusions", () => {
    it("includes active credit cards (role: ccAsset)", () => {
      const cc = makeAccount({ name: "ila White", type: "asset", account_role: "ccAsset" });
      expect(isEligibleWalletAccount(cc)).toBe(true);
    });

    it("includes active credit cards configured as liability accounts (liability_type: credit_card)", () => {
      const ccLiab = makeAccount({
        name: "Visa Credit Card",
        type: "liability",
        liability_type: "credit_card",
      });
      expect(isEligibleWalletAccount(ccLiab)).toBe(true);
    });

    it("includes active asset accounts (checking, cash, savings)", () => {
      const checking = makeAccount({ name: "Salary Account", type: "asset", account_role: "defaultAsset" });
      const cash = makeAccount({ name: "Cash Wallet", type: "cash" });
      const savings = makeAccount({ name: "Fixed Deposit", type: "asset", account_role: "savingAsset" });
      expect(isEligibleWalletAccount(checking)).toBe(true);
      expect(isEligibleWalletAccount(cash)).toBe(true);
      expect(isEligibleWalletAccount(savings)).toBe(true);
    });

    it("excludes accounts explicitly excluded from net worth (include_net_worth: false)", () => {
      const excluded = makeAccount({ name: "Secret Stash", type: "asset", include_net_worth: false });
      expect(isEligibleWalletAccount(excluded)).toBe(false);
    });

    it("excludes inactive accounts (active: false)", () => {
      const inactive = makeAccount({ name: "Old Closed Bank", type: "asset", active: false });
      expect(isEligibleWalletAccount(inactive)).toBe(false);
    });

    it("excludes non-card standalone liabilities (loans, debts, mortgages)", () => {
      const loan = makeAccount({ name: "Car Loan", type: "loan", liability_type: "loan" });
      const mortgage = makeAccount({ name: "Home Mortgage", type: "mortgage", liability_type: "mortgage" });
      expect(isEligibleWalletAccount(loan)).toBe(false);
      expect(isEligibleWalletAccount(mortgage)).toBe(false);
    });

    it("excludes system double-entry contra-accounts", () => {
      const initialBal = makeAccount({
        name: 'Initial balance for "Main Account"',
        type: "initial-balance",
        account_role: "initialBalance",
      });
      expect(isEligibleWalletAccount(initialBal)).toBe(false);
    });
  });

  describe("computeNextAccountSelection (Single-Click vs Long-Press Multi-Select)", () => {
    it("solo-selects on a single click, switches solo target, and toggles back to all when tapping the only selected account", () => {
      // Clicking an account when all ([]) are active solo-selects it
      expect(
        computeNextAccountSelection({
          currentSelectedIds: [],
          targetId: "acc-1",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual(["acc-1"]);

      // Single-clicking another account when 1 is selected replaces selection with just that one account
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1"],
          targetId: "acc-3",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual(["acc-3"]);

      // Single-clicking the already solo-selected account restores all accounts ([])
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-3"],
          targetId: "acc-3",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual([]);
    });

    it("treats any short click as multi-add/toggle once more than one account is selected", () => {
      // With 2+ selected, a normal click (multi: false) adds to the selection instead of collapsing to 1
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2"],
          targetId: "acc-3",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual(["acc-1", "acc-2", "acc-3"]);

      // Normal click on an already-selected account removes just that account
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2", "acc-3"],
          targetId: "acc-2",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual(["acc-1", "acc-3"]);

      // Normal click on the last unselected account normalizes back to all ([])
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2", "acc-3"],
          targetId: "acc-4",
          totalAccountCount: 4,
          multi: false,
        }),
      ).toEqual([]);
    });

    it("adds or toggles accounts in selection on long-press (multi: true)", () => {
      // Long-pressing a second account adds it alongside the first
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1"],
          targetId: "acc-2",
          totalAccountCount: 4,
          multi: true,
        }),
      ).toEqual(["acc-1", "acc-2"]);

      // Long-pressing a third account keeps all three selected
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2"],
          targetId: "acc-3",
          totalAccountCount: 4,
          multi: true,
        }),
      ).toEqual(["acc-1", "acc-2", "acc-3"]);

      // Long-pressing an already selected account removes only that one
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2", "acc-3"],
          targetId: "acc-2",
          totalAccountCount: 4,
          multi: true,
        }),
      ).toEqual(["acc-1", "acc-3"]);

      // Long-pressing the final remaining unselected account normalizes back to all ([])
      expect(
        computeNextAccountSelection({
          currentSelectedIds: ["acc-1", "acc-2", "acc-3"],
          targetId: "acc-4",
          totalAccountCount: 4,
          multi: true,
        }),
      ).toEqual([]);
    });

    it("removes duplicate actions on Home and Budgets pages", () => {
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const dashSrc = readFileSync(path.resolve(__dirname, "../app/(app)/dashboard-client.tsx"), "utf8");
      const budgetsSrc = readFileSync(path.resolve(__dirname, "../app/(app)/budgets/budgets-client.tsx"), "utf8");

      // Home Accounts card keeps Manage accounts + and removes duplicate + Add account, Select all non-excluded, and top Records pill
      expect(dashSrc).toContain("showRecordsPill={false}");
      expect(dashSrc).toContain("<p className=\"text-xs font-medium text-muted\">Net worth</p>");
      expect(dashSrc).not.toContain("Net worth ·");
      expect(dashSrc).not.toContain("<span>Add account</span>");
      expect(dashSrc).not.toContain("Select all non-excluded");
      expect(dashSrc).not.toContain("aria-label=\"Manage budgets\"");
      expect(dashSrc).toContain("href=\"/budgets?create=1\"");
      expect(dashSrc).toContain("href=\"/piggy-banks?create=1\"");

      // Budgets page removes duplicate Full configuration button (uses header New budget button)
      expect(budgetsSrc).not.toContain("Full configuration");
    });
  });
});
