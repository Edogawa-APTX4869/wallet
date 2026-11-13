import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AUTO_BUDGET_PERIODS,
  AUTO_BUDGET_TYPES,
  BudgetConfigModal,
  buildBudgetPayload,
} from "./budget-config-modal";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("BudgetConfigModal & buildBudgetPayload", () => {
  it("exports all 6 Firefly III auto-budget periods including half-year", () => {
    const values = AUTO_BUDGET_PERIODS.map((p) => p.value);
    expect(values).toEqual(["daily", "weekly", "monthly", "quarterly", "half-year", "yearly"]);
  });

  it("exports all 4 Firefly III auto-budget types", () => {
    const values = AUTO_BUDGET_TYPES.map((t) => t.value);
    expect(values).toEqual(["none", "reset", "rollover", "adjusted"]);
  });

  it("builds a clean payload when auto-budget is disabled (none)", () => {
    const payload = buildBudgetPayload({
      name: "  Groceries  ",
      active: true,
      autoBudgetType: "none",
      currencyCode: "BHD",
      autoBudgetAmount: "",
      autoBudgetPeriod: "monthly",
      notes: "  Monthly food  ",
    });

    expect(payload).toEqual({
      name: "Groceries",
      active: true,
      notes: "Monthly food",
      auto_budget_type: "none",
      auto_budget_amount: null,
      auto_budget_currency_code: null,
      auto_budget_period: null,
    });
  });

  it("builds a complete auto-budget payload for reset / rollover / adjusted", () => {
    const payload = buildBudgetPayload({
      name: "Dining Out",
      active: true,
      autoBudgetType: "reset",
      currencyCode: "BHD",
      autoBudgetAmount: "75.500",
      autoBudgetPeriod: "half-year",
      notes: "",
    });

    expect(payload).toEqual({
      name: "Dining Out",
      active: true,
      notes: null,
      auto_budget_type: "reset",
      auto_budget_amount: "75.5",
      auto_budget_currency_code: "BHD",
      auto_budget_period: "half-year",
    });
  });

  it("throws validation error when name is empty", () => {
    expect(() =>
      buildBudgetPayload({
        name: "   ",
        active: true,
        autoBudgetType: "none",
        currencyCode: "BHD",
        autoBudgetAmount: "",
        autoBudgetPeriod: "monthly",
        notes: "",
      }),
    ).toThrow("Enter a budget name.");
  });

  it("throws validation error when auto-budget is enabled without a positive amount", () => {
    expect(() =>
      buildBudgetPayload({
        name: "Travel",
        active: true,
        autoBudgetType: "rollover",
        currencyCode: "BHD",
        autoBudgetAmount: "0",
        autoBudgetPeriod: "yearly",
        notes: "",
      }),
    ).toThrow("Enter a valid auto-budget amount greater than 0.");
  });

  it("renders create mode markup with full configuration options", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(BudgetConfigModal, {
          open: true,
          onClose: () => {},
          initialName: "Subscriptions",
        }),
      ),
    );

    expect(html).toContain("Create a new budget");
    expect(html).toContain("Mandatory fields");
    expect(html).toContain("Optional fields");
    expect(html).toContain("Auto-budget");
    expect(html).toContain("Set a fixed amount every period");
    expect(html).toContain("Attachments");
    expect(html).toContain("After storing, return here to create another one.");
    expect(html).toContain("Store new budget");
  });

  it("renders edit mode markup with Save changes and Delete budget", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(BudgetConfigModal, {
          open: true,
          onClose: () => {},
          budget: {
            id: "b-1",
            type: "budgets",
            attributes: {
              name: "Groceries",
              active: true,
              auto_budget_type: "reset",
              auto_budget_amount: "120.000",
              auto_budget_currency_code: "BHD",
              auto_budget_period: "monthly",
              notes: "Supermarket",
            },
          },
        }),
      ),
    );

    expect(html).toContain("Configure Budget · Groceries");
    expect(html).toContain("Every half year");
    expect(html).toContain("Save changes");
    expect(html).toContain("Delete budget");
    expect(html).not.toContain("After storing, return here to create another one.");
  });
});
