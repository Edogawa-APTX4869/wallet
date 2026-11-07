"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import {
  PERIOD_PRESETS,
  type PeriodPreset,
} from "@/lib/filter-presets";
import { useUniversalFilter } from "@/lib/filter-context";
import { ASSET_LIKE, useAccounts } from "@/lib/hooks";
import { cn, formatMoney } from "@/lib/utils";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { Badge, Button } from "@/components/ui";

const DESKTOP_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "7D", label: "7D" },
  { key: "30D", label: "30D" },
  { key: "12W", label: "12W" },
  { key: "6M", label: "6M" },
  { key: "1Y", label: "1Y" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "last_year", label: "Last year" },
  { key: "custom", label: "Custom" },
];

export interface DesktopStickyFilterBarProps {
  className?: string;
  showAccountFilter?: boolean;
  extraActions?: React.ReactNode;
}

export function DesktopStickyFilterBar({
  className,
  showAccountFilter = true,
  extraActions,
}: DesktopStickyFilterBarProps) {
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
      (a) => ASSET_LIKE.has(a.attributes.type) && a.attributes.active !== false,
    );
  }, [accountsQ.data]);

  // Dropdown states
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);

  // Local draft dates for custom range popover
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);

  const openDatePopover = useCallback(() => {
    setCustomStart(startDate);
    setCustomEnd(endDate);
    setDatePopoverOpen(true);
  }, [startDate, endDate]);

  const toggleDatePopover = useCallback(() => {
    if (!datePopoverOpen) {
      setCustomStart(startDate);
      setCustomEnd(endDate);
      setDatePopoverOpen(true);
    } else {
      setDatePopoverOpen(false);
    }
  }, [datePopoverOpen, startDate, endDate]);

  // Escape key dismiss handlers
  useEscapeDismiss(periodDropdownOpen, () => setPeriodDropdownOpen(false), "filter-period-menu");
  useEscapeDismiss(datePopoverOpen, () => setDatePopoverOpen(false), "filter-custom-date");
  useEscapeDismiss(accountDropdownOpen, () => setAccountDropdownOpen(false), "filter-account-menu");

  // Keyboard shortcuts: [ = prev period, ] = next period, T = today/this_month, F = toggle filter popover
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.isComposing) return;
      if (!(e.target instanceof Element)) return;
      if (e.target.closest("input, textarea, select, [contenteditable=true]")) return;

      if (e.altKey) {
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setPreset("this_month");
        }
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        stepPeriod(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        stepPeriod(1);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setPreset("this_month");
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleDatePopover();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepPeriod, setPreset, toggleDatePopover]);

  // Popover references for click-outside
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const datePopoverRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (periodMenuRef.current && !periodMenuRef.current.contains(target)) {
        setPeriodDropdownOpen(false);
      }
      if (datePopoverRef.current && !datePopoverRef.current.contains(target)) {
        setDatePopoverOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) {
        setAccountDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasActiveFilters =
    preset !== "this_month" ||
    accountFilter !== "all_stats" ||
    selectedAccountIds.length > 0;

  const accountLabel = useMemo(() => {
    if (accountFilter === "all_stats") {
      return "All (stats)";
    }
    if (accountFilter === "all") {
      return "All accounts";
    }
    if (selectedAccountIds.length === 0) {
      return "No accounts";
    }
    if (selectedAccountIds.length === 1) {
      const acc = assetAccounts.find((a) => a.id === selectedAccountIds[0]);
      return acc?.attributes.name ?? "1 account";
    }
    return `${selectedAccountIds.length} accounts`;
  }, [accountFilter, selectedAccountIds, assetAccounts]);

  const dateId = useId();

  return (
    <div
      className={cn(
        "sticky top-0 z-30 hidden md:flex flex-col gap-2 rounded-2xl border border-border bg-surface/95 px-4 py-2.5 shadow-2xs backdrop-blur transition-all",
        className,
      )}
      aria-label="Desktop universal filter bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left Section: Period Stepper & Preset Pills */}
        <div className="flex items-center gap-2">
          {/* Stepper: < [ Period Label ▾ ] > */}
          <div className="flex items-center rounded-xl border border-border bg-surface-2 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => stepPeriod(-1)}
              title="Previous period (Hotkey: [ )"
              aria-label="Previous period"
              className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-fg active:scale-95"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>

            {/* Period Dropdown Button */}
            <div className="relative" ref={periodMenuRef}>
              <button
                type="button"
                onClick={() => setPeriodDropdownOpen((v) => !v)}
                aria-expanded={periodDropdownOpen}
                aria-haspopup="menu"
                title="Select period preset"
                className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold text-fg transition-colors hover:bg-surface rounded-lg"
              >
                <span>{displayLabel}</span>
                <ChevronDown className="size-3 text-muted" aria-hidden />
              </button>

              {/* Period Dropdown Menu */}
              {periodDropdownOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-1.5 z-50 w-56 rounded-2xl border border-border bg-surface p-1.5 shadow-xl popover-in"
                >
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted uppercase tracking-wider">
                    Select Period
                  </div>
                  {PERIOD_PRESETS.map((p) => {
                    const isSelected = preset === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setPreset(p.key);
                          setPeriodDropdownOpen(false);
                          if (p.key === "custom") {
                            openDatePopover();
                          }
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
                          isSelected
                            ? "bg-primary-soft text-primary font-semibold"
                            : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <span>{p.label}</span>
                        {isSelected && <Check className="size-3.5 text-primary" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => stepPeriod(1)}
              title="Next period (Hotkey: ] )"
              aria-label="Next period"
              className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-fg active:scale-95"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          {/* Preset Selector Pills */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5" role="tablist" aria-label="Period presets">
            {DESKTOP_PRESETS.map((p) => {
              const active = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (p.key === "custom") {
                      openDatePopover();
                    } else {
                      setPreset(p.key);
                    }
                  }}
                  className={cn(
                    "rounded-xl px-2.5 py-1 text-xs font-medium transition-all select-none whitespace-nowrap active:scale-95",
                    active
                      ? "bg-primary text-primary-fg font-semibold shadow-2xs"
                      : "bg-surface-2 text-muted hover:bg-surface-2/80 hover:text-fg",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Custom Date Range Popover Button */}
          <div className="relative" ref={datePopoverRef}>
            <button
              type="button"
              onClick={toggleDatePopover}
              aria-expanded={datePopoverOpen}
              title="Custom date range (Hotkey: F)"
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-medium transition-colors",
                preset === "custom" || datePopoverOpen
                  ? "bg-primary-soft text-primary border-primary/40"
                  : "bg-surface-2 text-muted hover:text-fg",
              )}
            >
              <Calendar className="size-3.5" aria-hidden />
              <span>
                {startDate} – {endDate}
              </span>
            </button>

            {/* Dual Date Range Popover */}
            {datePopoverOpen && (
              <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-2xl border border-border bg-surface p-4 shadow-xl popover-in">
                <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                  <h4 className="text-xs font-bold text-fg flex items-center gap-1.5">
                    <Calendar className="size-3.5 text-primary" />
                    Custom Date Range
                  </h4>
                  <button
                    type="button"
                    onClick={() => setDatePopoverOpen(false)}
                    className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <label htmlFor={`${dateId}-start`} className="text-[11px] font-semibold text-muted block mb-1">
                      Start Date
                    </label>
                    <input
                      id={`${dateId}-start`}
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="h-9 w-full rounded-xl border border-border bg-surface px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/25"
                    />
                  </div>

                  <div>
                    <label htmlFor={`${dateId}-end`} className="text-[11px] font-semibold text-muted block mb-1">
                      End Date
                    </label>
                    <input
                      id={`${dateId}-end`}
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="h-9 w-full rounded-xl border border-border bg-surface px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/25"
                    />
                  </div>

                  <div className="mt-1 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDatePopoverOpen(false)}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      Cancel
                    </button>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (customStart && customEnd) {
                          setDateRange(customStart, customEnd);
                          setDatePopoverOpen(false);
                        }
                      }}
                      className="h-8 min-h-[32px] px-3 text-xs"
                    >
                      Apply Range
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Accounts multi-select dropdown, extra actions, and active badges */}
        <div className="flex items-center gap-2">
          {showAccountFilter && (
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountDropdownOpen((v) => !v)}
                aria-expanded={accountDropdownOpen}
                aria-haspopup="dialog"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-medium transition-colors",
                  accountFilter !== "all_stats"
                    ? "bg-primary-soft text-primary border-primary/40 font-semibold"
                    : "bg-surface-2 text-muted hover:text-fg",
                )}
              >
                <Wallet className="size-3.5" aria-hidden />
                <span>{accountLabel}</span>
                <ChevronDown className="size-3 text-muted" aria-hidden />
              </button>

              {accountDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl border border-border bg-surface p-3 shadow-xl popover-in">
                  <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                    <div className="text-xs font-bold text-fg flex items-center gap-1.5">
                      <SlidersHorizontal className="size-3.5 text-primary" />
                      Filter Accounts
                    </div>
                    <button
                      type="button"
                      onClick={() => setAccountDropdownOpen(false)}
                      className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Mode Selector */}
                  <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setAccountFilter("all_stats", [])}
                      className={cn(
                        "rounded-lg py-1 px-2 text-center font-medium transition-colors",
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
                        "rounded-lg py-1 px-2 text-center font-medium transition-colors",
                        accountFilter === "all"
                          ? "bg-surface font-semibold text-primary shadow-xs"
                          : "text-muted hover:text-fg",
                      )}
                    >
                      All Accounts
                    </button>
                  </div>

                  <p className="mb-2 text-[11px] text-muted leading-tight">
                    {accountFilter === "all_stats"
                      ? "Showing accounts included in net worth calculations."
                      : accountFilter === "all"
                        ? "Showing all asset & liability accounts without exclusion."
                        : "Custom account selection active."}
                  </p>

                  {/* Account List */}
                  <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-xl border border-border">
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
                            "flex cursor-pointer items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-surface-2",
                            isSelected && "bg-primary-soft/40",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                                isSelected
                                  ? "border-primary bg-primary text-primary-fg"
                                  : "border-border bg-surface",
                              )}
                            >
                              {isSelected && <Check className="size-3" />}
                            </div>
                            <div className="truncate">
                              <span className="font-medium text-fg block truncate">
                                {account.attributes.name}
                              </span>
                              {account.attributes.include_net_worth === false && (
                                <span className="text-[10px] text-amber-500 font-normal">
                                  Excluded from stats
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-mono text-xs tabular text-muted">
                              {formatMoney(
                                account.attributes.current_balance,
                                account.attributes.currency_code,
                                account.attributes.currency_decimal_places,
                                account.attributes.currency_symbol,
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {extraActions}

          {/* Reset Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              title="Reset all filters to defaults"
              className="flex h-8 items-center gap-1 rounded-xl border border-border bg-surface-2 px-2 text-xs font-medium text-muted hover:text-fg hover:bg-surface-2/80 active:scale-95 transition-all"
            >
              <RotateCcw className="size-3" aria-hidden />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
          <span className="text-[11px] font-semibold text-muted flex items-center gap-1">
            <Filter className="size-3" />
            Active:
          </span>

          {preset !== "this_month" && (
            <Badge tone="primary" className="cursor-pointer" onClick={() => setPreset("this_month")}>
              <span>Period: {displayLabel}</span>
              <X className="size-3 ml-0.5" />
            </Badge>
          )}

          {accountFilter === "all" && (
            <Badge tone="neutral" className="cursor-pointer" onClick={() => setAccountFilter("all_stats", [])}>
              <span>All accounts (including excluded)</span>
              <X className="size-3 ml-0.5" />
            </Badge>
          )}

          {accountFilter === "custom" && selectedAccountIds.map((id) => {
            const acc = assetAccounts.find((a) => a.id === id);
            return (
              <Badge key={id} tone="primary" className="cursor-pointer" onClick={() => toggleAccountId(id)}>
                <span>{acc?.attributes.name ?? `Account #${id}`}</span>
                <X className="size-3 ml-0.5" />
              </Badge>
            );
          })}

          <button
            type="button"
            onClick={resetFilters}
            className="text-[11px] text-muted hover:text-danger hover:underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
