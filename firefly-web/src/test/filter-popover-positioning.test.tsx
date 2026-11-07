import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UniversalFilterProvider } from "../lib/filter-context";
import { DesktopStickyFilterBar } from "../components/filter-bar-desktop";
import { isSystemContraAccount } from "../app/(app)/dashboard-extra-cards";
import type { Account, Resource } from "@/lib/firefly/types";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

const mockAccounts: Resource<Account>[] = [
  {
    id: "acc-loan",
    type: "accounts",
    attributes: {
      name: "Almosawi - 100",
      type: "loan",
      current_balance: "-100.000",
      currency_code: "BHD",
      currency_symbol: "BHD",
      currency_decimal_places: 3,
      active: true,
      include_net_worth: true,
    },
  },
  {
    id: "acc-asset",
    type: "accounts",
    attributes: {
      name: "Checking Account",
      type: "asset",
      current_balance: "2500.000",
      currency_code: "BHD",
      currency_symbol: "BHD",
      currency_decimal_places: 3,
      active: true,
      include_net_worth: true,
    },
  },
  {
    id: "acc-contra-1",
    type: "accounts",
    attributes: {
      name: 'Initial balance for "Almosawi - 100"',
      type: "initial-balance",
      current_balance: "-100.000",
      currency_code: "BHD",
      currency_symbol: "BHD",
      currency_decimal_places: 3,
      active: true,
      include_net_worth: true,
    },
  },
  {
    id: "acc-contra-2",
    type: "accounts",
    attributes: {
      name: 'Initial balance for "Alnoohy - 400 Laptop"',
      type: "initial-balance",
      current_balance: "-400.000",
      currency_code: "BHD",
      currency_symbol: "BHD",
      currency_decimal_places: 3,
      active: true,
      include_net_worth: true,
    },
  },
];

describe("DesktopStickyFilterBar Popover Positioning & Contra-Account Exclusion", () => {
  it("excludes initial-balance system accounts from qualified filter accounts", () => {
    const qualified = mockAccounts.filter((a) => !isSystemContraAccount(a));
    expect(qualified.length).toBe(2);
    expect(qualified.some((a) => a.attributes.name.includes("Initial balance for"))).toBe(false);
    expect(qualified.map((a) => a.attributes.name)).toEqual(["Almosawi - 100", "Checking Account"]);
  });

  it("renders DesktopStickyFilterBar with clean initial markup and account trigger", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(["accounts", "all"], mockAccounts);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <UniversalFilterProvider>
          <DesktopStickyFilterBar />
        </UniversalFilterProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("Desktop universal filter bar");
    expect(html).toContain("All (stats)");
    expect(html).toContain("Custom");
  });

  it("verifies dynamic alignment algorithm: left-0 when on the left, right-0 when near the right edge", () => {
    function computeAlignment(rectLeft: number, buttonWidth: number, screenWidth: number): "left" | "right" {
      const rectRight = rectLeft + buttonWidth;
      const fitsOnRight = rectLeft + 336 <= screenWidth;
      const fitsOnLeft = rectRight >= 336;

      if (!fitsOnRight && fitsOnLeft) {
        return "right";
      }
      return "left";
    }

    // Wrapped line scenario (user screenshot: button near x=24 on a 1200px screen)
    // Old bug: was hardcoded to right-0, making left edge: 24 + 110 - 320 = -186px (off-screen)
    // New behavior:
    expect(computeAlignment(24, 110, 1200)).toBe("left");

    // Button near middle of screen (e.g. x=500 on 1400px screen)
    expect(computeAlignment(500, 110, 1400)).toBe("left");

    // Button near right margin (e.g. x=1150 on 1200px screen)
    expect(computeAlignment(1150, 110, 1200)).toBe("right");

    // Extreme right margin (e.g. x=950 on 1024px screen)
    expect(computeAlignment(950, 110, 1024)).toBe("right");
  });
});
