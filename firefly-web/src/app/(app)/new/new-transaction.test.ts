import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(NEW_TX_SRC).toMatch(/\{type !== "transfer" && \(\s*<div className="sm:col-span-2">\s*<CategoryCascadeSelect/);
    expect(NEW_TX_SRC).toContain("{type !== \"transfer\" && category && (");
  });

  it("uses edge-to-edge BudgetBakers-style mobile layout with a single Save button and Back arrow", () => {
    expect(APP_SHELL_SRC).toContain("isFullBleedOverlayRoute\n            ? \"p-0 md:px-8 md:pt-7 md:pb-24\"");
    expect(NEW_TX_SRC).toContain("min-h-dvh w-full flex-col overflow-hidden bg-surface lg:min-h-0 lg:max-w-5xl lg:rounded-2xl");
    expect(NEW_TX_SRC).toContain("<ArrowLeft className=\"size-5\" />");
    expect(NEW_TX_SRC).not.toContain("More details (Category, Budget, Tags)");
    expect(NEW_TX_SRC).not.toContain("Open in-depth details");
    expect(NEW_TX_SRC).toContain("className=\"hidden lg:flex items-center gap-2\"");
  });
});
