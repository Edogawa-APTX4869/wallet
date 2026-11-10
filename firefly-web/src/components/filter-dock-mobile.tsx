"use client";

import { useId, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Wallet,
  X,
} from "lucide-react";
import { type PeriodPreset } from "@/lib/filter-presets";
import { useUniversalFilter } from "@/lib/filter-context";
import { ASSET_LIKE, useAccounts } from "@/lib/hooks";
import { isSystemContraAccount } from "@/app/(app)/dashboard-extra-cards";
import { cn, formatMoney } from "@/lib/utils";
import { Badge, Button, ModalSheet } from "@/components/ui";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

const MOBILE_PRIMARY_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "7D", label: "7D" },
  { key: "30D", label: "30D" },
  { key: "12W", label: "12W" },
  { key: "6M", label: "6M" },
  { key: "1Y", label: "1Y" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom" },
];

export interface MobileFilterDockProps {
  className?: string;
  showAccountFilter?: boolean;
}

export function MobileFilterDock({
  className,
  showAccountFilter = true,
}: MobileFilterDockProps) {
  const {
    preset,
    startDate,
    endDate,
    displayLabel,
    accountFilter,
    selectedAccountIds,
    setPreset,
    setDateRange,
    stepPeriod,
    setAccountFilter,
    toggleAccountId,
    resetFilters,
  } = useUniversalFilter();

  const accountsQ = useAccounts("all");
  const assetAccounts = useMemo(() => {
    return (accountsQ.data ?? []).filter(
      (a) =>
        ASSET_LIKE.has(a.attributes.type) &&
        !isSystemContraAccount(a) &&
        a.attributes.active !== false,
    );
  }, [accountsQ.data]);

  const [expanded, setExpanded] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);

  useEscapeDismiss(expanded, () => setExpanded(false), "mobile-filter-dock-expanded");

  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);

  const startCustomRange = () => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setCustomRangeOpen(true);
  };

  const hasActiveFilters =
    preset !== "this_month" ||
    accountFilter !== "all_stats" ||
    selectedAccountIds.length > 0;

  const accountButtonLabel = useMemo(() => {
    if (accountFilter === "all_stats") return "Stats";
    if (accountFilter === "all") return "All";
    if (selectedAccountIds.length === 0) return "None";
    if (selectedAccountIds.length === 1) return "1 Acc";
    return `${selectedAccountIds.length} Accs`;
  }, [accountFilter, selectedAccountIds]);

  const startId = useId();
  const endId = useId();

  return (
    <>
      <div
        className={cn(
          "block md:hidden rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur select-none transition-all",
          className,
        )}
        aria-label="Mobile universal filter dock"
      >
        {/* Floating Dock Handle '—' */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className="flex cursor-pointer items-center justify-center pb-2 pt-0.5"
          role="button"
          tabIndex={0}
          aria-label={expanded ? "Collapse filter dock" : "Expand filter dock"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          <span className="h-1 w-10 rounded-full bg-border transition-colors hover:bg-muted" />
        </div>

        {/* Stepper Row: < [ Period Label ▾ ] > and Quick Account Trigger */}
        <div className="flex items-center justify-between gap-2">
          {/* Stepper */}
          <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => stepPeriod(-1)}
              aria-label="Previous period"
              className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-fg active:scale-95"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-bold text-fg truncate active:scale-98"
            >
              <span className="truncate">{displayLabel}</span>
              <ChevronDown
                className={cn(
                  "size-3 text-muted shrink-0 transition-transform duration-200",
                  expanded && "rotate-180",
                )}
                aria-hidden
              />
            </button>

            <button
              type="button"
              onClick={() => stepPeriod(1)}
              aria-label="Next period"
              className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-fg active:scale-95"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          {/* Account Filter Trigger */}
          {showAccountFilter && (
            <button
              type="button"
              onClick={() => setAccountSheetOpen(true)}
              className={cn(
                "flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold transition-colors active:scale-95",
                accountFilter !== "all_stats"
                  ? "bg-primary-soft text-primary border-primary/40"
                  : "bg-surface-2 text-muted hover:text-fg",
              )}
              aria-label="Open accounts filter"
            >
              <Wallet className="size-3.5" aria-hidden />
              <span>{accountButtonLabel}</span>
            </button>
          )}

          {/* Reset button if filters active */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              aria-label="Reset filters"
              className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:text-fg active:scale-95 transition-all"
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        {/* Expandable Preset Carousel & Custom Range Inputs */}
        {expanded && (
          <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-2.5 animate-in fade-in slide-in-from-top-1">
            {/* Presets Horizontal Scroll Carousel */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {MOBILE_PRIMARY_PRESETS.map((p) => {
                const active = preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      if (p.key === "custom") {
                        startCustomRange();
                      } else {
                        setPreset(p.key);
                      }
                    }}
                    className={cn(
                      "rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all active:scale-95 shrink-0",
                      active
                        ? "bg-primary text-primary-fg font-semibold shadow-2xs"
                        : "bg-surface-2 text-muted hover:text-fg",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Custom Range Trigger / Indicator */}
            <div className="flex items-center justify-between text-[11px] text-muted px-1">
              <span className="flex items-center gap-1">
                <Calendar className="size-3" />
                {startDate} — {endDate}
              </span>
              <button
                type="button"
                onClick={startCustomRange}
                className="font-medium text-primary hover:underline"
              >
                Change range
              </button>
            </div>
          </div>
        )}

        {/* Active Filter Badges */}
        {hasActiveFilters && !expanded && (
          <div className="mt-2 flex flex-wrap items-center gap-1 pt-1.5 border-t border-border/50">
            <span className="text-[10px] font-semibold text-muted flex items-center gap-0.5">
              <Filter className="size-2.5" />
            </span>
            {preset !== "this_month" && (
              <Badge tone="primary" className="text-[10px] py-0 px-1.5" onClick={() => setPreset("this_month")}>
                {displayLabel} <X className="size-2.5 ml-0.5 inline" />
              </Badge>
            )}
            {accountFilter === "all" && (
              <Badge tone="neutral" className="text-[10px] py-0 px-1.5" onClick={() => setAccountFilter("all_stats", [])}>
                All accs <X className="size-2.5 ml-0.5 inline" />
              </Badge>
            )}
            {accountFilter === "custom" && selectedAccountIds.length > 0 && (
              <Badge tone="primary" className="text-[10px] py-0 px-1.5" onClick={() => setAccountFilter("all_stats", [])}>
                {selectedAccountIds.length} accs <X className="size-2.5 ml-0.5 inline" />
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Custom Date Range Bottom Sheet */}
      <ModalSheet
        open={customRangeOpen}
        onClose={() => setCustomRangeOpen(false)}
        title="Custom Date Range"
        subtitle="Select start and end dates for universal filtering"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={startId} className="text-xs font-semibold text-muted">
              Start Date
            </label>
            <input
              id={startId}
              type="date"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={endId} className="text-xs font-semibold text-muted">
              End Date
            </label>
            <input
              id={endId}
              type="date"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setCustomRangeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                if (draftStart && draftEnd) {
                  setDateRange(draftStart, draftEnd);
                  setCustomRangeOpen(false);
                }
              }}
            >
              Apply Filter
            </Button>
          </div>
        </div>
      </ModalSheet>

      {/* Account Filters Bottom Sheet */}
      <ModalSheet
        open={accountSheetOpen}
        onClose={() => setAccountSheetOpen(false)}
        title="Account Filters"
        subtitle="Filter records and statistics by asset & liability accounts"
      >
        <div className="flex flex-col gap-4">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => setAccountFilter("all_stats", [])}
              className={cn(
                "rounded-lg py-2 px-3 text-xs font-medium transition-all text-center",
                accountFilter === "all_stats"
                  ? "bg-surface font-semibold text-primary shadow-xs"
                  : "text-muted hover:text-fg",
              )}
            >
              Stats Default
            </button>
            <button
              type="button"
              onClick={() => setAccountFilter("all", [])}
              className={cn(
                "rounded-lg py-2 px-3 text-xs font-medium transition-all text-center",
                accountFilter === "all"
                  ? "bg-surface font-semibold text-primary shadow-xs"
                  : "text-muted hover:text-fg",
              )}
            >
              All Accounts
            </button>
          </div>

          <p className="text-xs text-muted">
            {accountFilter === "all_stats"
              ? "Excludes accounts marked as hidden from net worth in Firefly."
              : accountFilter === "all"
                ? "Includes all accounts without net-worth exclusions."
                : "Custom accounts selected."}
          </p>

          {/* Account List with Instant Feedback */}
          <div className="max-h-[50dvh] overflow-y-auto divide-y divide-border rounded-xl border border-border">
            {assetAccounts.map((account) => {
              const isSelected =
                accountFilter === "custom"
                  ? selectedAccountIds.includes(account.id)
                  : accountFilter === "all_stats"
                    ? account.attributes.include_net_worth !== false
                    : true;

              return (
                <div
                  key={account.id}
                  onClick={() => toggleAccountId(account.id)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleAccountId(account.id);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-between p-3 text-sm transition-colors hover:bg-surface-2 active:bg-surface-2",
                    isSelected && "bg-primary-soft/30",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border bg-surface",
                      )}
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </div>
                    <div className="truncate">
                      <span className="font-medium text-fg block truncate">
                        {account.attributes.name}
                      </span>
                      {account.attributes.include_net_worth === false && (
                        <span className="text-[11px] text-amber-500 block">
                          Excluded from net worth
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="font-mono text-xs tabular text-muted shrink-0">
                    {formatMoney(
                      account.attributes.current_balance,
                      account.attributes.currency_code,
                      account.attributes.currency_decimal_places,
                      account.attributes.currency_symbol,
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <Button
            variant="primary"
            onClick={() => setAccountSheetOpen(false)}
            className="w-full mt-1"
          >
            Done
          </Button>
        </div>
      </ModalSheet>
    </>
  );
}
