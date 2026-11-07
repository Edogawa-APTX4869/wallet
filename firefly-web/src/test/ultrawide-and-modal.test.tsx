import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResourceIconBadge } from "@/components/resource-icon";
import { DashboardSegmentedTabs, TwoColumnAccountGrid } from "@/app/(app)/dashboard-client";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("ResourceIconBadge modal and trigger", () => {
  it("renders trigger button with correct accessibility and styling", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <ResourceIconBadge entityType="account" entityId="acc-1" defaultIcon="Wallet" defaultColor="#6366f1" />
      </QueryClientProvider>,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('title="Click to customize icon &amp; color (saved to database)"');
    expect(html).toContain("svg");
  });

  it("applies custom size and color correctly", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <ResourceIconBadge entityType="account" entityId="acc-2" size="lg" defaultColor="#10b981" />
      </QueryClientProvider>,
    );

    expect(html).toContain("size-11");
    expect(html).toContain("#10b981");
  });

  it("supports compact size='xs' for mobile account tiles", () => {
    const qc = createTestQueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <ResourceIconBadge entityType="account" entityId="acc-3" size="xs" defaultColor="#ef4444" />
      </QueryClientProvider>,
    );

    expect(html).toContain("size-5");
    expect(html).toContain("size-3");
    expect(html).toContain("#ef4444");
  });
});

describe("Ultra-Wide & Multi-Screen Responsive Grid Architecture", () => {
  it("renders TwoColumnAccountGrid with 5-col on 2xl and 6-col on 3xl", () => {
    const qc = createTestQueryClient();
    const mockAccounts = [
      { id: "1", name: "Bank 1", balance: "100.00", currencyCode: "BHD", currencySymbol: "BHD" },
      { id: "2", name: "Bank 2", balance: "200.00", currencyCode: "BHD", currencySymbol: "BHD" },
    ];

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <TwoColumnAccountGrid accounts={mockAccounts} />
      </QueryClientProvider>,
    );

    expect(html).toContain("grid-cols-2");
    expect(html).toContain("sm:grid-cols-3");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("2xl:grid-cols-5");
    expect(html).toContain("3xl:grid-cols-6");
    expect(html).toContain("Bank 1");
    expect(html).toContain("Bank 2");
  });

  it("renders compact mobile tiles with xs icon badges and streamlined manage button", () => {
    const qc = createTestQueryClient();
    const mockAccounts = [
      { id: "1", name: "Salary Account", balance: "2642.464", currencyCode: "BHD", currencySymbol: "BHD" },
    ];

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <TwoColumnAccountGrid accounts={mockAccounts} showManageLink />
      </QueryClientProvider>,
    );

    // Streamlined tile padding
    expect(html).toContain("px-2.5 py-1.5 sm:p-2.5");
    // Sizing xs icon badge
    expect(html).toContain("size-5");
    // Streamlined manage accounts button
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("Manage accounts");
  });

  it("renders compact mobile segmented tabs with py-1.5", () => {
    const html = renderToStaticMarkup(
      <DashboardSegmentedTabs activeTab="accounts" onChange={() => {}} />,
    );

    expect(html).toContain("py-1.5 px-3 text-xs sm:text-sm font-semibold");
    expect(html).toContain("Accounts");
    expect(html).toContain("Budgets &amp; Goals");
  });
});
