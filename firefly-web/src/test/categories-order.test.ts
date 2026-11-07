import { describe, it, expect } from "vitest";
import { buildCategoryTree } from "@/components/category-cascade";
import type { Category, Resource } from "@/lib/firefly/types";

function makeCat(id: string, name: string): Resource<Category> {
  return {
    type: "categories",
    id,
    attributes: {
      name,
      spent: [],
      earned: [],
    },
  };
}

describe("Category Tree Ordering", () => {
  const categories: Array<Resource<Category>> = [
    makeCat("1", "Utilities"),
    makeCat("2", "Utilities: Internet"),
    makeCat("3", "Food"),
    makeCat("4", "Food: Groceries"),
    makeCat("5", "Housing: Rent"),
    makeCat("6", "Entertainment"),
  ];

  it("sorts alphabetically by default when no custom order provided", () => {
    const tree = buildCategoryTree(categories);
    const parents = tree.map((g) => g.parent);
    expect(parents).toEqual(["Entertainment", "Food", "Housing", "Utilities"]);
  });

  it("sorts by custom order list with fallback for remaining items", () => {
    const customOrder = ["Utilities", "Housing", "Food"];
    const tree = buildCategoryTree(categories, customOrder);
    const parents = tree.map((g) => g.parent);
    expect(parents).toEqual(["Utilities", "Housing", "Food", "Entertainment"]);
  });

  it("handles case-insensitive custom order matching", () => {
    const customOrder = ["food", "utilities"];
    const tree = buildCategoryTree(categories, customOrder);
    const parents = tree.map((g) => g.parent);
    expect(parents[0]).toBe("Food");
    expect(parents[1]).toBe("Utilities");
  });
});
