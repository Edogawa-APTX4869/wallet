import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateAccountModal, normalizeType } from "./create-account-modal";

describe("CreateAccountModal normalizeType", () => {
  it("defaults to asset when undefined or empty", () => {
    expect(normalizeType(undefined)).toBe("asset");
    expect(normalizeType("")).toBe("asset");
  });

  it("normalizes liabilities tab values to liability", () => {
    expect(normalizeType("liabilities")).toBe("liability");
    expect(normalizeType("liability")).toBe("liability");
    expect(normalizeType("loan")).toBe("liability");
    expect(normalizeType("debt")).toBe("liability");
    expect(normalizeType("mortgage")).toBe("liability");
  });

  it("normalizes expense variations to expense", () => {
    expect(normalizeType("expense")).toBe("expense");
    expect(normalizeType("expenses")).toBe("expense");
  });

  it("normalizes revenue variations to revenue", () => {
    expect(normalizeType("revenue")).toBe("revenue");
    expect(normalizeType("revenues")).toBe("revenue");
    expect(normalizeType("income")).toBe("revenue");
  });

  it("normalizes asset and cash to asset", () => {
    expect(normalizeType("asset")).toBe("asset");
    expect(normalizeType("cash")).toBe("asset");
  });

  it("handles mixed case and unknown types gracefully", () => {
    expect(normalizeType("LIABILITY")).toBe("liability");
    expect(normalizeType("Expenses")).toBe("expense");
    expect(normalizeType("REVENUE")).toBe("revenue");
    expect(normalizeType("unknownType123")).toBe("asset");
  });
});

describe("CreateAccountModal markup and liability_direction", () => {
  const createQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("renders liability direction select with debit and credit when initialType is liability", () => {
    const qc = createQc();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(CreateAccountModal, {
          open: true,
          onClose: () => {},
          initialType: "liability",
        }),
      ),
    );

    expect(html).toContain("Liability direction");
    expect(html).toContain("I owe this debt (debit)");
    expect(html).toContain("I am owed this debt (credit)");
    expect(html).toContain('value="debit"');
    expect(html).toContain('value="credit"');
  });

  it("does not render liability direction select when initialType is asset", () => {
    const qc = createQc();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(CreateAccountModal, {
          open: true,
          onClose: () => {},
          initialType: "asset",
        }),
      ),
    );

    expect(html).not.toContain("Liability direction");
    expect(html).toContain("Account role");
  });

  it("does not render liability direction select when initialType is expense", () => {
    const qc = createQc();
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(CreateAccountModal, {
          open: true,
          onClose: () => {},
          initialType: "expense",
        }),
      ),
    );

    expect(html).not.toContain("Liability direction");
    expect(html).not.toContain("Account role");
  });
});
