import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NeedleGauge } from "@/components/needle-gauge";
import { TwoColumnAccountGrid, type AccountGridItem } from "@/app/(app)/dashboard-client";

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
});
