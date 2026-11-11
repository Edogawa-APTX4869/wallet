import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Account } from "@/lib/firefly/types";
import { computeAccount30dKpi, EditAccountModal, formatAccountRole } from "./account-detail-client";

describe("computeAccount30dKpi", () => {
  it("returns zero metrics when there are no transactions in the 30-day window", () => {
    const stats = computeAccount30dKpi([], "123");
    expect(stats.inflow.toString()).toBe("0");
    expect(stats.outflow.toString()).toBe("0");
    expect(stats.netChange.toString()).toBe("0");
    expect(stats.count).toBe(0);
  });

  it("accurately sums deposits as inflow and increments count", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            { type: "deposit", amount: "100.50", destination_id: "123" },
            { type: "deposit", amount: "50.25", destination_id: "123" },
          ],
        },
      },
    ];
    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("150.75");
    expect(stats.outflow.toString()).toBe("0");
    expect(stats.netChange.toString()).toBe("150.75");
    expect(stats.count).toBe(2);
  });

  it("accurately sums withdrawals as outflow and computes negative net change", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            { type: "withdrawal", amount: "80.00", source_id: "123" },
            { type: "withdrawal", amount: "25.50", source_id: "123" },
          ],
        },
      },
    ];
    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("0");
    expect(stats.outflow.toString()).toBe("105.5");
    expect(stats.netChange.toString()).toBe("-105.5");
    expect(stats.count).toBe(2);
  });

  it("accurately accounts for transfers where the account is destination (inflow) or source (outflow)", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            // Outgoing transfer
            { type: "transfer", amount: "200.00", source_id: "123", destination_id: "456" },
            // Incoming transfer with foreign currency conversion
            {
              type: "transfer",
              amount: "150.00",
              foreign_amount: "175.50",
              source_id: "789",
              destination_id: "123",
            },
          ],
        },
      },
    ];
    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("175.5");
    expect(stats.outflow.toString()).toBe("200");
    expect(stats.netChange.toString()).toBe("-24.5");
    expect(stats.count).toBe(2);
  });

  it("handles opening balance splits correctly for positive and negative values", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            { type: "opening balance", amount: "500.00", destination_id: "123" },
            { type: "opening balance", amount: "-50.00", source_id: "123" },
          ],
        },
      },
    ];
    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("500");
    expect(stats.outflow.toString()).toBe("50");
    expect(stats.netChange.toString()).toBe("450");
    expect(stats.count).toBe(2);
  });

  it("preserves exact decimal precision without floating point inaccuracies", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            { type: "deposit", amount: "0.1", destination_id: "123" },
            { type: "deposit", amount: "0.2", destination_id: "123" },
          ],
        },
      },
    ];
    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("0.3");
    expect(stats.netChange.toString()).toBe("0.3");
  });

  it("excludes splits belonging to other accounts in a multi-split journal", () => {
    const groups = [
      {
        attributes: {
          transactions: [
            // Outflow from target account 123
            { type: "withdrawal", amount: "100.00", source_id: "123", destination_id: "999" },
            // Outflow from another account 456 (should be ignored)
            { type: "withdrawal", amount: "50.00", source_id: "456", destination_id: "999" },
            // Inflow to target account 123
            { type: "deposit", amount: "250.00", source_id: "888", destination_id: "123" },
            // Inflow to another account 789 (should be ignored)
            { type: "deposit", amount: "75.00", source_id: "888", destination_id: "789" },
            // Transfer between other accounts (should be ignored)
            { type: "transfer", amount: "30.00", source_id: "456", destination_id: "789" },
            // Opening balance for another account (should be ignored)
            { type: "opening balance", amount: "1000.00", destination_id: "789" },
          ],
        },
      },
    ];

    const stats = computeAccount30dKpi(groups, "123");
    expect(stats.inflow.toString()).toBe("250");
    expect(stats.outflow.toString()).toBe("100");
    expect(stats.netChange.toString()).toBe("150");
    expect(stats.count).toBe(2);
  });
});

describe("formatAccountRole", () => {
  it("formats standard roles and liability types correctly", () => {
    expect(formatAccountRole("defaultAsset")).toBe("Default asset account");
    expect(formatAccountRole("loan")).toBe("Loan liability");
    expect(formatAccountRole("debt")).toBe("Debt liability");
    expect(formatAccountRole("mortgage")).toBe("Mortgage liability");
    expect(formatAccountRole("liability")).toBe("Liability account");
    expect(formatAccountRole(null)).toBe("—");
  });
});

describe("EditAccountModal liability rendering", () => {
  it("renders liability type and liability direction fields for liability accounts", () => {
    const mockLiabilityAccount: Account = {
      name: "Tesla Auto Loan",
      type: "liability",
      active: true,
      liability_type: "loan",
      liability_direction: "debit",
    };

    const html = renderToStaticMarkup(
      React.createElement(EditAccountModal, {
        open: true,
        account: mockLiabilityAccount,
        onClose: () => {},
        onSave: () => {},
        isSaving: false,
      }),
    );

    expect(html).toContain("Liability type");
    expect(html).toContain("Liability direction");
    expect(html).toContain("I owe this debt (debit)");
    expect(html).toContain("I am owed this debt (credit)");
    expect(html).not.toContain("Default asset account");
  });

  it("renders asset account roles and omits liability direction for asset accounts", () => {
    const mockAssetAccount: Account = {
      name: "Main Checking",
      type: "asset",
      active: true,
      account_role: "defaultAsset",
    };

    const html = renderToStaticMarkup(
      React.createElement(EditAccountModal, {
        open: true,
        account: mockAssetAccount,
        onClose: () => {},
        onSave: () => {},
        isSaving: false,
      }),
    );

    expect(html).toContain("Account role");
    expect(html).toContain("Default asset account");
    expect(html).not.toContain("Liability direction");
  });
});
