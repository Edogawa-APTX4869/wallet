import { describe, expect, it } from "vitest";
import {
  categoriesForBudget,
  computeBudgetOnCategoryChange,
  resolveLinkedBudgetId,
  sanitizeCategoryBudgetMap,
} from "./category-budget-links";

describe("sanitizeCategoryBudgetMap", () => {
  it("keeps trimmed non-empty string/number mappings and drops invalid values", () => {
    expect(
      sanitizeCategoryBudgetMap({
        "  Petrol ": " 12 ",
        Fuel: 15,
        "": "9",
        EmptyVal: "   ",
        BadNull: null,
      }),
    ).toEqual({
      Petrol: "12",
      Fuel: "15",
    });

    expect(sanitizeCategoryBudgetMap(null)).toEqual({});
    expect(sanitizeCategoryBudgetMap(["Petrol"])).toEqual({});
  });
});

describe("resolveLinkedBudgetId", () => {
  const activeBudgets = [
    { id: "10", attributes: { active: true } },
    { id: "11", attributes: { active: true } },
    { id: "12", attributes: { active: true } },
    { id: "99", attributes: { active: false } },
  ];

  const map = {
    Food: "10",
    "Food : Dining Out": "11",
    Petrol: "12",
    ArchivedCat: "99",
  };

  it("matches exact categories case-insensitively", () => {
    expect(resolveLinkedBudgetId({ category: "petrol", map, activeBudgets })).toBe("12");
    expect(resolveLinkedBudgetId({ category: "Food", map, activeBudgets })).toBe("10");
  });

  it("prefers child link over parent link, and falls back to parent for unlinked subcategories", () => {
    expect(
      resolveLinkedBudgetId({ category: "Food : Dining Out", map, activeBudgets }),
    ).toBe("11");
    expect(
      resolveLinkedBudgetId({ category: "Food : Groceries", map, activeBudgets }),
    ).toBe("10");
    expect(
      resolveLinkedBudgetId({ category: "food:supermarket", map, activeBudgets }),
    ).toBe("10");
  });

  it("ignores inactive or missing budgets and blank categories", () => {
    expect(resolveLinkedBudgetId({ category: "ArchivedCat", map, activeBudgets })).toBeNull();
    expect(resolveLinkedBudgetId({ category: "Unmapped", map, activeBudgets })).toBeNull();
    expect(resolveLinkedBudgetId({ category: "   ", map, activeBudgets })).toBeNull();
  });
});

describe("categoriesForBudget", () => {
  it("lists sorted categories assigned to a budget ID", () => {
    expect(
      categoriesForBudget(
        {
          Taxi: "2",
          Petrol: "2",
          Groceries: "1",
        },
        "2",
      ),
    ).toEqual(["Petrol", "Taxi"]);
  });
});

describe("computeBudgetOnCategoryChange", () => {
  const activeBudgets = [
    { id: "10", attributes: { active: true } },
    { id: "11", attributes: { active: true } },
  ];
  const map = {
    Petrol: "10",
    "Transport : Fuel": "10",
    Groceries: "11",
  };

  it("auto-fills linked budget on withdrawal when not manually overridden", () => {
    expect(
      computeBudgetOnCategoryChange({
        type: "withdrawal",
        nextCategory: "Petrol",
        currentBudgetId: "",
        budgetManuallySet: false,
        budgetAutoFilled: false,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "10", budgetAutoFilled: true });
  });

  it("updates auto-filled budget when switching to another linked category, and clears when switching to unlinked", () => {
    expect(
      computeBudgetOnCategoryChange({
        type: "withdrawal",
        nextCategory: "Groceries",
        currentBudgetId: "10",
        budgetManuallySet: false,
        budgetAutoFilled: true,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "11", budgetAutoFilled: true });

    expect(
      computeBudgetOnCategoryChange({
        type: "withdrawal",
        nextCategory: "Gifts",
        currentBudgetId: "11",
        budgetManuallySet: false,
        budgetAutoFilled: true,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "", budgetAutoFilled: false });
  });

  it("preserves manual budget choices including manually clearing to No budget", () => {
    expect(
      computeBudgetOnCategoryChange({
        type: "withdrawal",
        nextCategory: "Petrol",
        currentBudgetId: "11",
        budgetManuallySet: true,
        budgetAutoFilled: false,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "11", budgetAutoFilled: false });

    expect(
      computeBudgetOnCategoryChange({
        type: "withdrawal",
        nextCategory: "Petrol",
        currentBudgetId: "",
        budgetManuallySet: true,
        budgetAutoFilled: false,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "", budgetAutoFilled: false });
  });

  it("never fills budgets for deposit or transfer transactions", () => {
    expect(
      computeBudgetOnCategoryChange({
        type: "deposit",
        nextCategory: "Petrol",
        currentBudgetId: "",
        budgetManuallySet: false,
        budgetAutoFilled: false,
        map,
        activeBudgets,
      }),
    ).toEqual({ budgetId: "", budgetAutoFilled: false });
  });
});
