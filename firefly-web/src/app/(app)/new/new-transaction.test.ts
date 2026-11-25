import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getMostFrequentCategories, resolveDefaultAccountForList, resolveDefaultAccountId } from "@/lib/recent-selections";
import { AccountPicker } from "@/components/account-picker";
import { CategoryCascadeSelect } from "@/components/category-cascade";
import {
  FullScreenAccountSelectView,
  FullScreenBudgetSelectView,
  FullScreenCategorySelectView,
} from "@/components/wallet-selection-views";
import {
  extractLocalDate,
  extractLocalTime,
  formatDateTime,
  formatTime,
  isoDateTimeWithOffset,
  isoTime,
} from "@/lib/utils";
import { parseTime24h, stepTime24h, TimeInput24h } from "@/components/time-input-24h";
import { buildEditTransactionPayload } from "@/components/edit-transaction-modal";
import { evaluateCalcExpression } from "./new-transaction";
import {
  buildLiabilityActionHref,
  isLiabilityAccount,
  resolveLiabilityCategory,
} from "@/lib/liability-actions";
import type { Account, Resource } from "@/lib/firefly/types";

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

  it("uses edge-to-edge BudgetBakers-style mobile layout with a single Save button, Back arrow, and no duplicate back or AI Magic tab", () => {
    expect(APP_SHELL_SRC).toContain("isFullBleedOverlayRoute\n            ? \"p-0 md:px-8 md:pt-7 md:pb-24\"");
    expect(NEW_TX_SRC).toContain("min-h-dvh w-full flex-col overflow-hidden bg-surface lg:min-h-0 lg:max-w-5xl lg:rounded-2xl");
    expect(NEW_TX_SRC).toContain("<ArrowLeft className=\"size-5\" />");
    expect(NEW_TX_SRC).toContain("!min-h-0 !min-w-0 absolute top-1/2 right-0 z-10 flex h-11 w-7 -translate-y-1/2 items-center justify-center rounded-l-full");
    expect(NEW_TX_SRC).not.toContain("fixed top-1/2 right-0");
    expect(NEW_TX_SRC).not.toContain("fixed top-1/2 left-0");
    expect(NEW_TX_SRC).not.toContain("← Back to Calculator");
    expect(NEW_TX_SRC).not.toContain("AI MAGIC");
    expect(NEW_TX_SRC).not.toContain("(tap to add note / description)");
    expect(NEW_TX_SRC).toContain("className=\"grid grid-cols-3\"");
    expect(NEW_TX_SRC).toContain("animate-swipe-next");
    expect(NEW_TX_SRC).toContain("animate-swipe-prev");
    expect(NEW_TX_SRC).not.toContain("More details (Category, Budget, Tags)");
    expect(NEW_TX_SRC).not.toContain("Details & Category →");
    expect(NEW_TX_SRC).not.toContain("Save as 1-tap Template");
    expect(NEW_TX_SRC).toContain("aria-label=\"Save transaction\"");
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

    // Always opens at Level 1 ("Category") even when a subcategory is selected, highlighting the selected sub on its parent row
    const reopenedHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenCategorySelectView, {
          categories,
          selectedCategory: "Vehicle: Fuel",
          frequentCategories: ["Vehicle: Fuel"],
          allowEmpty: true,
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(reopenedHtml).toContain(">Category</h1>");
    expect(reopenedHtml).toContain("MOST FREQUENT");
    expect(reopenedHtml).toContain("ALL CATEGORIES");
    expect(reopenedHtml).toContain("Any category");
    expect(reopenedHtml).toContain(">Fuel</span>");
    expect(reopenedHtml).toContain("Clear");
  });

  it("diversifies parent categories in getMostFrequentCategories before repeating parents", () => {
    const picked = getMostFrequentCategories(
      [
        "Vehicle: Fuel",
        "Vehicle: Parking",
        "Vehicle: Leasing",
        "Food: Groceries",
        "Shopping",
        "Housing: Rent",
      ],
      4,
    );
    expect(picked).toEqual([
      "Vehicle: Fuel",
      "Food: Groceries",
      "Shopping",
      "Housing: Rent",
    ]);
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

    // /new has an aligned amount-card details trigger, swipe animation, and quick date/budget controls (no floating duplicate back buttons)
    expect(NEW_TX_SRC).toContain("aria-label=\"Transaction date\"");
    expect(NEW_TX_SRC).toContain("aria-label=\"Select budget\"");
    expect(NEW_TX_SRC).toContain("{state.isCross && (");
    expect(NEW_TX_SRC).not.toContain("left-0 z-20 flex h-12 w-7");

    // Category & Account full-screen pickers use system bg-surface navbar and widget SwipePaginationDots
    const viewsSrc = readFileSync(
      path.resolve(__dirname, "../../../components/wallet-selection-views.tsx"),
      "utf8",
    );
    expect(viewsSrc).toContain("SwipePaginationDots");
    expect(viewsSrc).toContain("border-b border-border bg-surface px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-fg");
    expect(viewsSrc).not.toContain("bg-primary px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-primary-fg");

    // Render FullScreenCategorySelectView with 5+ frequent categories to verify widget dots and system header
    const qc = createTestQueryClient();
    const fullCatHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenCategorySelectView, {
          categories: [
            { id: "c-1", type: "categories", attributes: { name: "Entertainment" } },
            { id: "c-2", type: "categories", attributes: { name: "Food" } },
            { id: "c-3", type: "categories", attributes: { name: "Health" } },
            { id: "c-4", type: "categories", attributes: { name: "Transport" } },
            { id: "c-5", type: "categories", attributes: { name: "Utilities" } },
          ],
          selectedCategory: "Food",
          frequentCategories: ["Entertainment", "Food", "Health", "Transport", "Utilities"],
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );
    expect(fullCatHtml).toContain("bg-surface");
    expect(fullCatHtml).toContain("aria-label=\"View pagination\"");
    expect(fullCatHtml).toContain("data-pagination-dot=\"true\"");
    expect(fullCatHtml).toContain("!min-h-0 !min-w-0");

    // Shared EditTransactionModal supports AccountPicker, 24h time preservation, omits category on transfers, and is wired across screens
    const editModalSrc = readFileSync(
      path.resolve(__dirname, "../../../components/edit-transaction-modal.tsx"),
      "utf8",
    );
    const accountDetailSrc = readFileSync(
      path.resolve(__dirname, "../accounts/[id]/account-detail-client.tsx"),
      "utf8",
    );
    const dashboardSrc = readFileSync(
      path.resolve(__dirname, "../dashboard-client.tsx"),
      "utf8",
    );
    expect(editModalSrc).toContain("accounts?: Awaited<ReturnType<typeof api.accounts>>");
    expect(editModalSrc).toContain("txType === \"deposit\" ? \"To account\" : \"From account\"");
    expect(editModalSrc).toContain("txType !== \"transfer\" && !isSystemType && (");
    expect(editModalSrc).toContain("isoDateTimeWithOffset(draft.date, draft.time)");
    expect(editModalSrc).toContain("<TimeInput24h");
    expect(editModalSrc).not.toContain("type=\"time\"");
    expect(txSrc).toContain("<EditTransactionModal");
    expect(txSrc).not.toContain("type=\"time\"");
    expect(accountDetailSrc).toContain("<EditTransactionModal");
    expect(accountDetailSrc).toContain("onEdit={(tx) => setEditingTx(tx)}");
    expect(dashboardSrc).toContain("<EditTransactionModal");
    expect(rulesSrc).toContain("<EditTransactionModal");
    expect(NEW_TX_SRC).toContain("<TimeInput24h");
    expect(NEW_TX_SRC).not.toContain("type=\"time\"");

    // buildEditTransactionPayload preserves transaction_journal_id, multi-split siblings, cross-currency amounts, and liability links
    const multiSplitPayload = buildEditTransactionPayload({
      splits: [
        {
          transaction_journal_id: "j-1",
          type: "withdrawal",
          date: "2026-11-21T14:30:00+03:00",
          amount: "25.000",
          currency_code: "BHD",
          description: "Supermarket",
          source_id: "1",
          source_name: "Khaleeji Bank",
          destination_id: "99",
          destination_name: "Lulu",
          category_name: "Groceries",
          budget_id: "5",
          tags: ["food"],
          notes: "Weekly run",
        },
        {
          transaction_journal_id: "j-2",
          type: "withdrawal",
          date: "2026-11-21T14:30:00+03:00",
          amount: "5.000",
          currency_code: "BHD",
          description: "Coffee",
          source_id: "1",
          source_name: "Khaleeji Bank",
          destination_id: "100",
          destination_name: "Cafe",
          category_name: "Dining",
        },
      ],
      activeSplitIndex: 0,
      draft: {
        description: "Supermarket Updated",
        amount: "30.500",
        foreignAmount: "",
        foreignCurrencyCode: "",
        date: "2026-11-21",
        time: "18:45",
        sourceId: "2",
        destId: "",
        counterparty: "Carrefour",
        category: "",
        budgetId: "",
        tags: "food, family",
        notes: "",
      },
    });
    expect(multiSplitPayload).toHaveLength(2);
    expect(multiSplitPayload[0].transaction_journal_id).toBe("j-1");
    expect(multiSplitPayload[0].amount).toBe("30.5");
    expect(multiSplitPayload[0].source_id).toBe("2");
    expect(multiSplitPayload[0].destination_name).toBe("Carrefour");
    expect(multiSplitPayload[0].category_name).toBeNull();
    expect(multiSplitPayload[0].budget_id).toBeNull();
    expect(multiSplitPayload[0].date).toMatch(/^2026-11-21T18:45:/);
    expect(multiSplitPayload[0].tags).toEqual(["food", "family"]);
    expect(multiSplitPayload[1].transaction_journal_id).toBe("j-2");
    expect(multiSplitPayload[1].description).toBe("Coffee");

    const crossTransferPayload = buildEditTransactionPayload({
      splits: [
        {
          transaction_journal_id: "j-3",
          type: "transfer",
          date: "2026-11-17T18:30:00+03:00",
          amount: "2.075",
          currency_code: "BHD",
          foreign_amount: "5.50",
          foreign_currency_code: "USD",
          description: "Transfer to ila Bank - USD",
          source_id: "1",
          source_name: "Khaleeji Bank",
          destination_id: "4",
          destination_name: "ila Bank - USD",
        },
      ],
      draft: {
        description: "Transfer to ila Bank - USD",
        amount: "3.770",
        foreignAmount: "10.00",
        foreignCurrencyCode: "USD",
        date: "2026-11-17",
        time: "18:30",
        sourceId: "1",
        destId: "4",
        counterparty: "",
        category: "IgnoredOnTransfer",
        budgetId: "5",
        tags: "",
        notes: "FX transfer",
      },
    });
    expect(crossTransferPayload[0].category_name).toBeUndefined();
    expect(crossTransferPayload[0].budget_id).toBeUndefined();
    expect(crossTransferPayload[0].foreign_amount).toBe("10");
    expect(crossTransferPayload[0].foreign_currency_code).toBe("USD");

    // Budget picker matches Category/Account/Payee slide-in selection sub-view
    const fullBudgetHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(FullScreenBudgetSelectView, {
          budgets: [
            {
              id: "b-1",
              type: "budgets",
              attributes: {
                name: "Groceries",
                active: true,
                auto_budget_period: "monthly",
              },
            },
            {
              id: "b-2",
              type: "budgets",
              attributes: {
                name: "Archived Budget",
                active: false,
              },
            },
          ],
          selectedBudgetId: "b-1",
          onSelect: () => {},
          onBack: () => {},
        }),
      ),
    );
    expect(fullBudgetHtml).toContain("No budget");
    expect(fullBudgetHtml).toContain("Groceries");
    expect(fullBudgetHtml).not.toContain("Archived Budget");
    expect(NEW_TX_SRC).toContain("key=\"subview-budget\"");
    expect(NEW_TX_SRC).toContain("<FullScreenBudgetSelectView");

    // Category & Account pickers animate both opening (animate-swipe-next) and back/level drilldown
    expect(NEW_TX_SRC).toContain("key=\"subview-category\"");
    expect(NEW_TX_SRC).toContain("paneTransition === \"from-subview\" && \"animate-swipe-prev\"");
    expect(viewsSrc).toContain("levelAnimDir === \"next\" && \"animate-swipe-next\"");
    expect(viewsSrc).toContain("levelAnimDir === \"prev\" && \"animate-swipe-prev\"");
    expect(NEW_TX_SRC).toContain("isoDateTimeWithOffset(date, time)");
    expect(NEW_TX_SRC).toContain("aria-label=\"Transaction time\"");
  });

  it("formats and preserves local date + current time as ISO-8601 timestamps in strict 24-hour format", () => {
    const sample = new Date(2026, 10, 17, 22, 19, 33); // 2026-11-17 22:19:33 local
    expect(isoTime(sample)).toBe("22:19");
    expect(formatTime(sample)).toBe("22:19");
    expect(formatTime(new Date(2026, 10, 17, 0, 5, 0))).toBe("00:05");
    expect(formatTime(new Date(2026, 10, 17, 13, 39, 0))).toBe("13:39");

    const stampNow = isoDateTimeWithOffset("2026-11-17", "22:19", sample);
    expect(stampNow).toMatch(/^2026-11-17T22:19:33[+-]\d{2}:\d{2}$/);

    const stampEdited = isoDateTimeWithOffset("2026-11-17", "08:05", sample);
    expect(stampEdited).toMatch(/^2026-11-17T08:05:00[+-]\d{2}:\d{2}$/);

    expect(extractLocalDate(stampEdited)).toBe("2026-11-17");
    expect(extractLocalTime(stampEdited)).toBe("08:05");
    expect(extractLocalDate("2026-11-17")).toBe("2026-11-17");
    expect(extractLocalTime("2026-11-17", sample)).toBe("22:19");

    const formattedEvening = formatDateTime(stampNow);
    expect(formattedEvening).toContain("22:19");
    expect(formattedEvening).not.toMatch(/\b(AM|PM)\b/i);

    const formattedMidnight = formatDateTime(new Date(2026, 10, 17, 0, 5, 0));
    expect(formattedMidnight).toContain("00:05");
    expect(formattedMidnight).not.toContain("24:05");
    expect(formattedMidnight).not.toMatch(/\b(AM|PM)\b/i);

    // 24-hour time input parsing, stepping, and SSR markup
    expect(parseTime24h("15:30")).toBe("15:30");
    expect(parseTime24h("00:00")).toBe("00:00");
    expect(parseTime24h("23:59")).toBe("23:59");
    expect(parseTime24h("9:5")).toBe("09:05");
    expect(parseTime24h("1530")).toBe("15:30");
    expect(parseTime24h("930")).toBe("09:30");
    expect(parseTime24h("14")).toBe("14:00");
    expect(parseTime24h("24:00")).toBeNull();
    expect(parseTime24h("12:60")).toBeNull();
    expect(parseTime24h("abc")).toBeNull();

    expect(stepTime24h("23:59", "hour", 1)).toBe("00:59");
    expect(stepTime24h("00:00", "hour", -1)).toBe("23:00");
    expect(stepTime24h("13:59", "minute", 1)).toBe("13:00");
    expect(stepTime24h("13:00", "minute", -1)).toBe("13:59");

    const pickerHtml = renderToStaticMarkup(
      React.createElement(TimeInput24h, {
        id: "tx-time",
        value: "18:30",
        onChange: () => {},
        required: true,
      }),
    );
    expect(pickerHtml).toContain('value="18:30"');
    expect(pickerHtml).toContain('inputMode="numeric"');
    expect(pickerHtml).toContain('aria-label="Open 24-hour time picker"');
    expect(pickerHtml).not.toContain('type="time"');

    // Mobile / coarse-pointer mode delegates to native type="time" so Android/iOS open the system clock dialog
    const timePickerSrc = readFileSync(
      path.resolve(__dirname, "../../../components/time-input-24h.tsx"),
      "utf8",
    );
    expect(timePickerSrc).toContain("shouldUseNativeMobileTimePicker");
    expect(timePickerSrc).toContain('(pointer: coarse)');
    expect(timePickerSrc).toContain('type="time"');
  });

  it("builds prefilled fast-access liability repayment/loan URLs with Settings category mapping", () => {
    const owedToMeAcc: Resource<Account> = {
      id: "101",
      type: "accounts",
      attributes: {
        name: "Ali Sarhan - 415",
        type: "liabilities",
        active: true,
        liability_type: "loan",
        liability_direction: "credit",
        current_balance: "265.000",
        currency_code: "BHD",
        currency_decimal_places: 3,
      },
    };

    const iOweAcc: Resource<Account> = {
      id: "102",
      type: "accounts",
      attributes: {
        name: "Car Loan",
        type: "liabilities",
        active: true,
        liability_type: "loan",
        liability_direction: "debit",
        current_balance: "-120.500",
        currency_code: "BHD",
        currency_decimal_places: 3,
      },
    };

    expect(isLiabilityAccount(owedToMeAcc)).toBe(true);
    expect(isLiabilityAccount(iOweAcc)).toBe(true);

    // 1. Owed to me -> "They paid me" (repay) maps to deposit (Income) with liabilityId + configured category
    const collectHref = buildLiabilityActionHref({
      account: owedToMeAcc,
      action: "repay",
      prefs: { owedToMeCategory: "Loan (Owed to me)", iOweCategory: "Debt Payment" },
    });
    expect(collectHref).toContain("/new?");
    expect(collectHref).toContain("type=deposit");
    expect(collectHref).toContain("liabilityId=101");
    expect(collectHref).toContain("category=Loan+%28Owed+to+me%29");
    expect(collectHref).toContain("amount=265");

    // 2. Owed to me -> "+ Lend" (advance) maps to withdrawal (Expense)
    const lendHref = buildLiabilityActionHref({
      account: owedToMeAcc,
      action: "advance",
      prefs: { owedToMeCategory: "Loan (Owed to me)", iOweCategory: "Debt Payment" },
    });
    expect(lendHref).toContain("type=withdrawal");
    expect(lendHref).toContain("liabilityId=101");
    expect(lendHref).toContain("category=Loan+%28Owed+to+me%29");

    // 3. I owe -> "I'm paying" (repay) maps to withdrawal (Expense) with iOweCategory
    const payHref = buildLiabilityActionHref({
      account: iOweAcc,
      action: "repay",
      prefs: { owedToMeCategory: "Loan (Owed to me)", iOweCategory: "Debt Payment" },
    });
    expect(payHref).toContain("type=withdrawal");
    expect(payHref).toContain("liabilityId=102");
    expect(payHref).toContain("category=Debt+Payment");
    expect(payHref).toContain("amount=120.5");

    // 4. Auto-detects existing category from Firefly III when explicit setting is blank
    expect(
      resolveLiabilityCategory({
        direction: "credit",
        categories: ["Groceries", "Loan (Owed to me)", "Utilities"],
      }),
    ).toBe("Loan (Owed to me)");

    const settingsSrc = readFileSync(
      path.resolve(__dirname, "../settings/settings-client.tsx"),
      "utf8",
    );
    const accountsSrc = readFileSync(
      path.resolve(__dirname, "../accounts/accounts-client.tsx"),
      "utf8",
    );
    expect(settingsSrc).toContain("Liability & Loan Categories");
    expect(accountsSrc).toContain("They paid me");
    expect(NEW_TX_SRC).toContain("linkedLiability");
    expect(NEW_TX_SRC).toContain("FullScreenCounterpartySelectView");
    expect(NEW_TX_SRC).toContain('setActiveSubView("counterparty")');
    expect(NEW_TX_SRC).not.toContain("Pay / Lend:");
  });

  it("exposes a fast-access Payee / Merchant (or Payer) button directly below Category on mobile", () => {
    const mobilePaneStart = NEW_TX_SRC.indexOf("Inline From → To / Category bar");
    const desktopPaneStart = NEW_TX_SRC.indexOf("DESKTOP KEYBOARD-FIRST FINANCIAL COLUMN");
    expect(mobilePaneStart).toBeGreaterThan(-1);
    expect(desktopPaneStart).toBeGreaterThan(mobilePaneStart);

    const mobileFastAccessSection = NEW_TX_SRC.slice(mobilePaneStart, desktopPaneStart);
    expect(mobileFastAccessSection).toContain('setActiveSubView("category")');
    expect(mobileFastAccessSection).toContain('setActiveSubView("counterparty")');
    expect(mobileFastAccessSection).toContain(
      'aria-label={type === "withdrawal" ? "Select payee or merchant" : "Select payer"}',
    );
    expect(mobileFastAccessSection).toContain("Payee / Merchant");
  });

  it("auto-fills linked budget on category change while preserving manual budget selection", () => {
    expect(NEW_TX_SRC).toContain("computeBudgetOnCategoryChange");
    expect(NEW_TX_SRC).toContain("resolveLinkedBudgetId");
    expect(NEW_TX_SRC).toContain("budgetManuallySet");
    expect(NEW_TX_SRC).toContain("setBudgetManuallySet(true);");
    expect(NEW_TX_SRC).toContain("applyCategorySelection(catName)");
  });
});
