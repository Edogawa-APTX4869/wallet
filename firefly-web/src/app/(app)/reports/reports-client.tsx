"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Calendar,
  CreditCard,
  PieChart,
  TrendingUp,
} from "lucide-react";
import Decimal from "decimal.js";
import { useUniversalFilter } from "@/lib/filter-context";
import { useAccounts, usePrimaryCurrency, useRatesToPrimary } from "@/lib/hooks";
import { PageHeader } from "@/components/ui";
import { AnimatedTabs, type TabItem } from "@/components/animated-tabs";
import { SwipeableWidget } from "@/components/swipeable-widget";
import { DesktopStickyFilterBar } from "@/components/filter-bar-desktop";
import { MobileFilterDock } from "@/components/filter-dock-mobile";
import { BalanceTab } from "./components/balance-tab";
import { CashFlowTab } from "./components/cashflow-tab";
import { SpendingTab } from "./components/spending-tab";
import { OutlookTab } from "./components/outlook-tab";
import { DebtTab } from "./components/debt-tab";

export type ReportTabKey = "balance" | "cash-flow" | "spending" | "outlook" | "debt";

const REPORT_TABS: TabItem<ReportTabKey>[] = [
  { key: "balance", label: "Balance", icon: TrendingUp },
  { key: "cash-flow", label: "Cash-flow", icon: BarChart3 },
  { key: "spending", label: "Spending", icon: PieChart },
  { key: "outlook", label: "30-Day Outlook", icon: Calendar },
  { key: "debt", label: "Credit & Debt", icon: CreditCard },
];

function normalizeTabKey(tab?: string | null): ReportTabKey {
  if (!tab) return "balance";
  const lower = tab.toLowerCase();
  if (lower === "balance") return "balance";
  if (lower === "cashflow" || lower === "cash-flow") return "cash-flow";
  if (lower === "spending" || lower === "categories") return "spending";
  if (lower === "outlook" || lower === "projection") return "outlook";
  if (lower === "credit" || lower === "debt" || lower === "liabilities") return "debt";
  return "balance";
}

export function ReportsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tab synchronization from URL ?tab=...
  const currentTab = useMemo(() => {
    return normalizeTabKey(searchParams.get("tab"));
  }, [searchParams]);

  const handleTabChange = useCallback(
    (key: ReportTabKey) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", key);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Universal Filter Engine integration
  const {
    startDate,
    endDate,
    priorPeriod,
    selectedAccountIds,
    filterAccounts,
    isAccountIncluded,
  } = useUniversalFilter();

  const accountsQ = useAccounts("all");
  const primaryQ = usePrimaryCurrency();

  // All currency codes across accounts for exchange rates resolution
  const allCurrencyCodes = useMemo(
    () => [...new Set((accountsQ.data ?? []).map((a) => a.attributes.currency_code || "").filter(Boolean))],
    [accountsQ.data],
  );
  const ratesToPrimaryQ = useRatesToPrimary(allCurrencyCodes, endDate);

  const primary = primaryQ.data;
  const primaryCode = primary?.code || "USD";
  const primaryDecimals = primary?.decimal_places ?? 2;

  // Currency converter to primary currency
  const toPrimary = useCallback(
    (amount: string | number | Decimal, code?: string | null): Decimal => {
      const d = new Decimal(amount || 0);
      if (!code || code === primaryCode) return d;
      const r = ratesToPrimaryQ.data?.[code];
      return r ? d.mul(r.rate) : d;
    },
    [primaryCode, ratesToPrimaryQ.data],
  );

  // Filtered asset accounts obeying Universal Filter net worth & account selection
  const filteredAssetAccounts = useMemo(() => {
    const rawAssetAccounts = (accountsQ.data ?? []).filter((a) => {
      const type = String(a.attributes.type || "").toLowerCase();
      const role = a.attributes.account_role;
      const isDebt =
        type.includes("liabilit") ||
        type.includes("loan") ||
        type.includes("debt") ||
        type.includes("mortgage") ||
        Boolean(a.attributes.liability_type) ||
        role === "ccAsset";

      if (isDebt) return false;
      return (type === "asset" || type === "cash" || type === "default") && a.attributes.active !== false;
    });

    return filterAccounts(rawAssetAccounts);
  }, [accountsQ.data, filterAccounts]);

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-8">
      {/* Page Header */}
      <PageHeader
        title="Statistics & Reports"
        subtitle="BudgetBakers-inspired deep financial analytics, cash-flow velocity, spending breakdowns, and forward projections."
      />

      {/* Desktop Sticky Universal Filter Command Bar */}
      <DesktopStickyFilterBar />

      {/* Navigation Animated Tabs */}
      <div className="overflow-x-auto py-1">
        <AnimatedTabs<ReportTabKey>
          tabs={REPORT_TABS}
          activeTab={currentTab}
          onChange={handleTabChange}
          ariaLabel="Report hub tabs"
          className="w-full sm:w-auto"
        />
      </div>

      {/* Active Tab Panel (Swipeable across report tabs) */}
      <SwipeableWidget
        activeIndex={Math.max(0, REPORT_TABS.findIndex((t) => t.key === currentTab))}
        totalViews={REPORT_TABS.length}
        viewLabels={REPORT_TABS.map((t) => String(t.label))}
        onIndexChange={(idx) => {
          const target = REPORT_TABS[idx];
          if (target) handleTabChange(target.key);
        }}
      >
        <div key={currentTab} className="animate-tab-enter">
          {currentTab === "balance" && (
            <BalanceTab
              startDate={startDate}
              endDate={endDate}
              priorPeriod={priorPeriod}
              accounts={filteredAssetAccounts}
              primaryCode={primaryCode}
              primaryDecimals={primaryDecimals}
              toPrimary={toPrimary}
            />
          )}

          {currentTab === "cash-flow" && (
            <CashFlowTab
              startDate={startDate}
              endDate={endDate}
              accounts={filteredAssetAccounts}
              primaryCode={primaryCode}
              primaryDecimals={primaryDecimals}
              toPrimary={toPrimary}
              selectedAccountIds={selectedAccountIds}
              isAccountIncluded={isAccountIncluded}
            />
          )}

          {currentTab === "spending" && (
            <SpendingTab
              startDate={startDate}
              endDate={endDate}
              accounts={filteredAssetAccounts}
              primaryCode={primaryCode}
              primaryDecimals={primaryDecimals}
              toPrimary={toPrimary}
              selectedAccountIds={selectedAccountIds}
            />
          )}

          {currentTab === "outlook" && (
            <OutlookTab
              accounts={filteredAssetAccounts}
              primaryCode={primaryCode}
              primaryDecimals={primaryDecimals}
              toPrimary={toPrimary}
            />
          )}

          {currentTab === "debt" && (
            <DebtTab
              allAccounts={accountsQ.data ?? []}
              primaryCode={primaryCode}
              primaryDecimals={primaryDecimals}
              toPrimary={toPrimary}
            />
          )}
        </div>
      </SwipeableWidget>

      {/* Mobile Floating Filter Dock */}
      <MobileFilterDock />
    </div>
  );
}
