import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveDefaultAccountForList, resolveDefaultAccountId } from "@/lib/recent-selections";
import { AccountPicker } from "@/components/account-picker";
import { CategoryCascadeSelect } from "@/components/category-cascade";
import {
  FullScreenAccountSelectView,
  FullScreenCategorySelectView,
} from "@/components/wallet-selection-views";
import { evaluateCalcExpression } from "./new-transaction";

const NEW_TX_SRC = readFileSync(path.resolve(__dirname, "new-transaction.tsx"), "utf8");
const LINKED_AMOUNTS_SRC = readFileSync(
  path.resolve(__dirname, "../../../components/linked-amounts.tsx"),
  "utf8",
);
const APP_SHELL_SRC = readFileSync(
  path.resolve(__dirname, "../../../components/app-shell.tsx"),
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

describe("NewTransaction regression guards", () => {
  it("evaluates single-digit integer and decimal calculator inputs identically", () => {
    expect(evaluateCalcExpression("6")).toBe("6");
    expect(evaluateCalcExpression("6.000")).toBe("6");
    expect(evaluateCalcExpression("6+4")).toBe("10");
  });

  it("preserves entered amount when switching accounts or currency", () => {
    expect(LINKED_AMOUNTS_SRC).toContain("reset: (keepFrom?: boolean) =>");
    expect(LINKED_AMOUNTS_SRC).toContain("if (!keepFrom) setFromInput(\"\");");
    expect(NEW_TX_SRC).toContain("function resetFxKeepAmount()");
    const rawResets = NEW_TX_SRC.match(/linked\.controls\.reset\(\)/g) ?? [];
    expect(rawResets).toHaveLength(1); // Only in onSuccess after saving
    expect(NEW_TX_SRC).toContain(
      "const amount = state.fromAmount || (expr ? parseAmount(evaluateCalcExpression(expr)) : \"\");",
    );
  });

  it("hides category selection and omits category_name in transfer mode", () => {
    expect(NEW_TX_SRC).toContain("category_name: type === \"transfer\" ? undefined : category.trim() || undefined");
    expect(NEW_TX_SRC).toContain("activeSubView === \"category\" && type !== \"transfer\"");
    expect(NEW_TX_SRC).toMatch(/\{type !== "transfer" && \(\s*<div className="sm:col-span-2 flex flex-col gap-1\.5">/);
    expect(NEW_TX_SRC).toContain("{type !== \"transfer\" && category && (");
  });

  it("uses edge-to-edge BudgetBakers-style mobile layout with a single Save button and Back arrow", () => {
    expect(APP_SHELL_SRC).toContain("isFullBleedOverlayRoute\n            ? \"p-0 md:px-8 md:pt-7 md:pb-24\"");
    expect(NEW_TX_SRC).toContain("min-h-dvh w-full flex-col overflow-hidden bg-surface lg:min-h-0 lg:max-w-5xl lg:rounded-2xl");
    expect(NEW_TX_SRC).toContain("<ArrowLeft className=\"size-5\" />");
    expect(NEW_TX_SRC).toContain("right-0 z-20 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-l-full");
    expect(NEW_TX_SRC).not.toContain("More details (Category, Budget, Tags)");
    expect(NEW_TX_SRC).not.toContain("Details & Category →");
    expect(NEW_TX_SRC).toContain("className=\"hidden lg:flex items-center gap-2\"");
  });

  it("uses full-screen drill-down selection views for accounts and categories with no pop-up modals", () => {
    expect(NEW_TX_SRC).toContain("FullScreenAccountSelectView");
    expect(NEW_TX_SRC).toContain("FullScreenCategorySelectView");
    expect(NEW_TX_SRC).not.toContain("<AccountPicker");
    expect(NEW_TX_SRC).not.toContain("<CategoryCascadeSelect");
  });
});

describe("resolveDefaultAccountId", () => {
  const eligible = ["acc-1", "acc-2", "acc-3", "acc-4"];

  it("picks the single account selected outside", () => {
    expect(
      resolveDefaultAccountId({
        outsideSelectedIds: ["acc-3"],
        recentAccountIds: ["acc-1"],
        eligibleAccountIds: eligible,
      }),
    ).toBe("acc-3");
  });

  it("picks the most recently used/chosen account when multiple accounts are selected outside", () => {
    expect(
      resolveDefaultAccountId({
        outsideSelectedIds: ["acc-2", "acc-4"],
        recentAccountIds: ["acc-1", "acc-4", "acc-2"],
        eligibleAccountIds: eligible,
      }),
    ).toBe("acc-4");

    // Falls back to the last selected item in outsideSelectedIds when recent history has no match
    expect(
      resolveDefaultAccountId({
        outsideSelectedIds: ["acc-2", "acc-3"],
        recentAccountIds: [],
        eligibleAccountIds: eligible,
      }),
    ).toBe("acc-3");
  });

  it("uses recent account history when all accounts are active outside", () => {
    expect(
      resolveDefaultAccountId({
        outsideSelectedIds: [],
        recentAccountIds: ["acc-2", "acc-1"],
        eligibleAccountIds: eligible,
      }),
    ).toBe("acc-2");
  });

  it("honors explicit urlSourceId over outside selections", () => {
    expect(
      resolveDefaultAccountId({
        urlSourceId: "acc-4",
        outsideSelectedIds: ["acc-1"],
        recentAccountIds: ["acc-2"],
        eligibleAccountIds: eligible,
      }),
    ).toBe("acc-4");
  });
});

describe("FullScreenAccountSelectView & FullScreenCategorySelectView", () => {
  it("renders FullScreenAccountSelectView with MOST FREQUENT and ALL ACCOUNTS sections", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenAccountSelectView, {
          accounts: [
            {
              id: "acc-1",
              type: "accounts",
              attributes: {
                name: "ila White",
                type: "asset",
                active: true,
                currency_code: "BHD",
                currency_symbol: "BD",
                currency_decimal_places: 3,
                current_balance: "120.500",
              },
            },
            {
              id: "acc-2",
              type: "accounts",
              attributes: {
                name: "Khaleeji Bank",
                type: "asset",
                active: true,
                currency_code: "BHD",
                currency_symbol: "BD",
                currency_decimal_places: 3,
                current_balance: "50.000",
              },
            },
          ],
          selectedId: "acc-1",
          recentIds: ["acc-2", "acc-1"],
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(html).toContain("Select account");
    expect(html).toContain("MOST FREQUENT");
    expect(html).toContain("ALL ACCOUNTS");
    expect(html).toContain("ila White");
    expect(html).toContain("Khaleeji Bank");
    expect(html).not.toContain("ModalSheet");
  });

  it("renders FullScreenCategorySelectView Level 1 (Category) and Level 2 (Parent -> Subcategories)", () => {
    const qc = createTestQueryClient();
    const categories = [
      { id: "c-1", type: "categories", attributes: { name: "Vehicle" } },
      { id: "c-2", type: "categories", attributes: { name: "Vehicle: Fuel" } },
      { id: "c-3", type: "categories", attributes: { name: "Vehicle: Parking" } },
      { id: "c-4", type: "categories", attributes: { name: "Food & Drinks" } },
    ];

    const level1Html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenCategorySelectView, {
          categories,
          selectedCategory: "",
          frequentCategories: ["Vehicle: Fuel", "Food & Drinks"],
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(level1Html).toContain("Category");
    expect(level1Html).toContain("MOST FREQUENT");
    expect(level1Html).toContain("ALL CATEGORIES");
    expect(level1Html).toContain("Vehicle");
    expect(level1Html).toContain("Food &amp; Drinks");

    // When a subcategory is selected, opens directly to Level 2 for that parent (GENERAL + SUBCATEGORIES)
    const level2Html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenCategorySelectView, {
          categories,
          selectedCategory: "Vehicle: Fuel",
          frequentCategories: ["Vehicle: Fuel"],
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(level2Html).toContain(">Vehicle</h1>");
    expect(level2Html).toContain("GENERAL");
    expect(level2Html).toContain("SUBCATEGORIES");
    expect(level2Html).toContain("Fuel");
    expect(level2Html).toContain("Parking");
  });

  it("supports allowEmpty and Clear in FullScreenAccountSelectView for filter views", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenAccountSelectView, {
          title: "Filter by account",
          accounts: [
            {
              id: "acc-1",
              type: "accounts",
              attributes: {
                name: "ila White",
                type: "asset",
                active: true,
                currency_code: "BHD",
                current_balance: "100.000",
              },
            },
          ],
          selectedId: "acc-1",
          allowEmpty: true,
          emptyLabel: "Any account",
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(html).toContain("Any account");
    expect(html).toContain("Clear");
    expect(html).toContain("Filter by account");
  });

  it("renders mobile full-screen drill-down triggers inside AccountPicker and CategoryCascadeSelect", () => {
    const qc = createTestQueryClient();
    const accounts = [
      {
        id: "acc-1",
        type: "accounts",
        attributes: {
          name: "ila White",
          type: "asset",
          active: true,
          currency_code: "BHD",
          current_balance: "100.000",
        },
      },
    ];
    const categories = [
      { id: "c-1", type: "categories", attributes: { name: "Vehicle" } },
      { id: "c-2", type: "categories", attributes: { name: "Vehicle: Fuel" } },
    ];

    const accHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(AccountPicker, {
          label: "Account",
          accounts,
          value: null,
          allowEmpty: true,
          emptyLabel: "Any account",
          onChange: () => {},
        }),
      ),
    );
    expect(accHtml).toContain("lg:hidden");
    expect(accHtml).toContain("hidden lg:flex");
    expect(accHtml).toContain("Any account");

    const catHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(CategoryCascadeSelect, {
          categories,
          value: "Vehicle: Fuel",
          onChange: () => {},
        }),
      ),
    );
    expect(catHtml).toContain("lg:hidden");
    expect(catHtml).toContain("Vehicle › Fuel");
  });

  it("resolves default account across Piggy Banks, Rules/Bills, Transactions, and AI Magic", () => {
    const eligible = [{ id: "acc-1" }, { id: "acc-2" }, { id: "acc-3" }];
    expect(
      resolveDefaultAccountForList(eligible, {
        filterSelectedIds: ["acc-2"],
      }),
    ).toBe("acc-2");
    expect(
      resolveDefaultAccountForList(eligible, {
        dashboardSelectedIds: ["acc-1", "acc-3"],
      }),
    ).toBe("acc-3");

    const piggySrc = readFileSync(
      path.resolve(__dirname, "../piggy-banks/piggy-banks-client.tsx"),
      "utf8",
    );
    const rulesSrc = readFileSync(
      path.resolve(__dirname, "../rules/rules-client.tsx"),
      "utf8",
    );
    const txSrc = readFileSync(
      path.resolve(__dirname, "../transactions/transactions-client.tsx"),
      "utf8",
    );
    const chatSrc = readFileSync(
      path.resolve(__dirname, "../../../components/magic-chatbar.tsx"),
      "utf8",
    );

    expect(piggySrc).toContain("resolveDefaultAccountForList");
    expect(piggySrc).toContain("<AccountPicker");
    expect(rulesSrc).toContain("resolveDefaultAccountForList");
    expect(rulesSrc).toContain("<AccountPicker");
    expect(txSrc).toContain("<AccountPicker");
    expect(chatSrc).toContain("resolveDefaultAccountForList");
    expect(chatSrc).toContain("FullScreenAccountSelectView");
    expect(chatSrc).toContain("FullScreenCategorySelectView");
  });
});
