import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NeedleGauge } from "@/components/needle-gauge";
import {
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
});
