"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Columns2,
  CreditCard,
  Eye,
  EyeOff,
  GripVertical,
  List,
  Maximize2,
  Minimize2,
  MoreVertical,
  PiggyBank,
  Plus,
  Repeat,
  SlidersHorizontal,
  Square,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Account, BasicSummary, ChartDataSet, Resource, SummaryEntry, TransactionGroup } from "@/lib/firefly/types";
import {
  CARD_CATALOG,
  CARD_GROUP_LABELS,
  CATALOG_BY_KEY,
  DEFAULT_DASHBOARD_PREFS,
  makeCard,
  type CardGroup,
  type DashboardCardConfig,
  type DashboardCardKey,
  type DashboardPreferences,
} from "@/lib/dashboard-cards";
import {
  useDashboardDnd,
  DashboardDropPlaceholder,
} from "@/components/dashboard-dnd";
import { SwipeableWidget } from "@/components/swipeable-widget";
import { ExtraCard, inPeriod, isSystemContraAccount, type ExtraCardContext } from "./dashboard-extra-cards";
import { useAccounts, usePrimaryCurrency, useRatesToPrimary } from "@/lib/hooks";
import { cn, formatMoney, isoDate, monthRange, sumDecimal } from "@/lib/utils";
import {
  COLOR_PALETTE,
  inferAccountDefaultStyle,
  ResourceIconBadge,
  useResourceMeta,
} from "@/components/resource-icon";
import { CreateAccountModal } from "@/components/create-account-modal";
import { NeedleGauge } from "@/components/needle-gauge";
import { TransactionRow } from "@/components/transaction-row";
import {
  AnimatedMoney,
  AnimatedNumber,
  AnimatedTabs,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorBox,
  ModalSheet,
  Money,
  Progress,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

function extractSummaryByPrefix(summary: BasicSummary | undefined, prefix: string): SummaryEntry[] {
  if (!summary) return [];
  return Object.entries(summary)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .filter((v) => v && v.currency_code);
}

function normaliseChartEntries(ds: ChartDataSet): Array<{ date: string; value: number }> {
  const entries = ds.entries;
  if (!entries) return [];
  if (Array.isArray(entries)) {
    return entries.map((e, i) => ({
      date: (e.date || e.key || String(i)).slice(0, 10),
      value: Number(e.value) || 0,
    }));
  }
  return Object.entries(entries).map(([k, v]) => ({
    date: k.slice(0, 10),
    value: Number(v) || 0,
  }));
}

export interface DashboardSegmentedTabsProps {
  activeTab: "accounts" | "budgets";
  onChange: (tab: "accounts" | "budgets") => void;
  className?: string;
}

export function DashboardSegmentedTabs({
  activeTab,
  onChange,
  className,
}: DashboardSegmentedTabsProps) {
  return (
    <AnimatedTabs
      tabs={[
        { key: "accounts", label: "Accounts" },
        { key: "budgets", label: "Budgets & Goals" },
      ]}
      activeTab={activeTab}
      onChange={(key) => onChange(key as "accounts" | "budgets")}
      size="md"
      className={cn("grid grid-cols-2 sm:w-88 md:w-96 sm:min-w-[340px]", className)}
      tabClassName="py-1.5 px-3 text-xs sm:text-sm font-semibold"
      ariaLabel="Dashboard views"
    />
  );
}

export function RecordsQuickActionPill({ className }: { className?: string } = {}) {
  return (
    <Link
      href="/transactions"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95",
        className,
      )}
    >
      <List className="size-3 text-primary" aria-hidden="true" />
      <span>Records</span>
    </Link>
  );
}

export interface AccountsSectionHeaderProps {
  accountCount: number;
  selectedCount?: number;
  onSelectAll?: () => void;
}

export function AccountsSectionHeader({
  accountCount,
  selectedCount = 0,
  onSelectAll,
}: AccountsSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <Link
        href="/accounts"
        aria-label={`Accounts list, ${accountCount} accounts total`}
        className="flex items-center gap-1.5 font-semibold text-fg text-sm sm:text-base hover:text-primary transition"
      >
        <span>Accounts</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-muted font-normal">
          {accountCount}
        </span>
        <ChevronRight className="size-4 text-muted" aria-hidden="true" />
      </Link>

      <div className="flex items-center gap-1.5">
        {selectedCount > 0 && onSelectAll && (
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft/40 transition-colors"
          >
            Select all
          </button>
        )}
        <RecordsQuickActionPill className="hidden sm:inline-flex" />
      </div>
    </div>
  );
}

/**
 * Determines whether an account is eligible for the Dashboard's primary Accounts Grid & Net Worth calculation.
 *
 * Rules:
 * - Must be active (`active !== false`).
 * - Must not be explicitly excluded from Net Worth (`include_net_worth !== false`).
 * - Must not be a system double-entry contra-account (`!isSystemContraAccount(a)`).
 * - Active Credit Cards (whether `ccAsset` role, credit card liability, card type, or name match) are always included.
 * - Active Asset accounts (checking, cash, savings, investments, general assets) are included.
 * - Non-card standalone liabilities (loans, mortgages, general debts) are kept in the dedicated liabilities card.
 */
export function isEligibleWalletAccount(a: Resource<Account>): boolean {
  if (a.attributes.active === false) return false;
  if (a.attributes.include_net_worth === false) return false;
  if (isSystemContraAccount(a)) return false;

  const role = String(a.attributes.account_role || "").toLowerCase();
  const type = String(a.attributes.type || "").toLowerCase();
  const liabType = String(a.attributes.liability_type || "").toLowerCase();
  const nameLower = (a.attributes.name || "").toLowerCase();

  // 1. Credit card accounts (whether ccAsset role, credit card liability, card type, or name match)
  const isCreditCard =
    role === "ccasset" ||
    liabType === "credit_card" ||
    liabType === "credit card" ||
    type.includes("credit") ||
    /credit|card|visa|mastercard|amex/.test(nameLower);

  if (isCreditCard) return true;

  // 2. Exclude standalone non-card liabilities (loans, debts, mortgages)
  if (
    type.includes("liabilit") ||
    type.includes("loan") ||
    type.includes("debt") ||
    type.includes("mortgage") ||
    (Boolean(a.attributes.liability_type) && !isCreditCard)
  ) {
    return false;
  }

  // 3. Asset accounts (asset, cash, default, savings, investments, etc.)
  return (
    type.includes("asset") ||
    type === "cash" ||
    type === "default" ||
    role.includes("asset") ||
    role === "cashwalletasset" ||
    role === "defaultasset" ||
    role === "savingasset" ||
    role === "sharedasset"
  );
}

export type AccountGridItem =
  | Resource<Account>
  | {
      id: string;
      name: string;
      balance: string | number;
      currencyCode?: string;
      currencySymbol?: string;
      color?: string;
      iconName?: string;
      isSelected?: boolean;
    };

export interface TwoColumnAccountGridProps {
  accounts: AccountGridItem[];
  selectedIdSet?: Set<string>;
  onToggleAccount?: (id: string) => void;
  showManageLink?: boolean;
}

export function TwoColumnAccountGrid({
  accounts,
  selectedIdSet,
  onToggleAccount,
  showManageLink = false,
}: TwoColumnAccountGridProps) {
  const meta = useResourceMeta();

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
      {accounts.map((acc, idx) => {
        const isResource = "attributes" in acc;
        const id = acc.id;
        const name = isResource ? acc.attributes.name : acc.name;
        const rawBalance = isResource ? (acc.attributes.current_balance ?? 0) : acc.balance;
        const balance = typeof rawBalance === "string" ? rawBalance.replace(/,/g, "") : rawBalance;
        const currencyCode = isResource ? acc.attributes.currency_code : (acc.currencyCode ?? "USD");
        const currencySymbol = isResource ? acc.attributes.currency_symbol : (acc.currencySymbol ?? "$");
        const currencyDecimals = isResource ? acc.attributes.currency_decimal_places : undefined;
        const isSelected = selectedIdSet ? selectedIdSet.has(id) : Boolean(isResource || acc.isSelected !== false);

        const customMeta = meta.get("account", id);
        const inferred = isResource
          ? inferAccountDefaultStyle(acc.attributes, idx)
          : { icon: "wallet", color: ("color" in acc && acc.color) || COLOR_PALETTE[idx % COLOR_PALETTE.length] };
        const bg = ("color" in acc && acc.color) || customMeta?.color || inferred.color || COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const isSubsetFiltered = Boolean(selectedIdSet && selectedIdSet.size > 0 && selectedIdSet.size < accounts.length);

        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => onToggleAccount?.(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggleAccount?.(id)}
            aria-pressed={isSelected}
            style={
              isSelected
                ? {
                    borderColor: `${bg}88`,
                    backgroundColor: `${bg}24`,
                  }
                : {
                    borderColor: "#78909c45",
                    backgroundColor: "#78909c18",
                  }
            }
            className={cn(
              "group relative flex cursor-pointer flex-col justify-between gap-1 rounded-xl border px-2.5 py-1.5 sm:p-2.5 transition-all duration-200 select-none min-w-0 shadow-2xs active:scale-[0.98]",
              isSelected
                ? cn("shadow-xs", isSubsetFiltered && "ring-1 ring-primary/40 shadow-sm")
                : "border-border/80 bg-surface-2/60 opacity-55 grayscale-[70%] hover:opacity-85",
            )}
          >
            {/* Top Row: Compact non-editable icon on mobile, editable icon on desktop + Account Name */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-flex shrink-0 sm:hidden">
                <ResourceIconBadge
                  entityType="account"
                  entityId={id}
                  defaultIcon={inferred.icon}
                  defaultColor={bg}
                  size="sm"
                  editable={false}
                />
              </span>
              <span className="hidden shrink-0 sm:inline-flex">
                <ResourceIconBadge
                  entityType="account"
                  entityId={id}
                  defaultIcon={inferred.icon}
                  defaultColor={bg}
                  size="xs"
                />
              </span>
              <p className="truncate text-xs font-semibold text-fg leading-tight" title={name}>
                {name}
              </p>
            </div>

            {/* Bottom Row: Fully Responsive Unclipped Balance */}
            <div className="min-w-0 overflow-hidden leading-tight">
              <p className="tabular font-mono text-xs sm:text-sm font-bold tracking-tight text-fg truncate">
                {typeof balance === "number" || typeof balance === "string" ? (
                  <Money
                    amount={balance}
                    code={currencyCode}
                    decimals={currencyDecimals}
                    symbol={currencySymbol}
                  />
                ) : (
                  balance
                )}
              </p>
            </div>
          </div>
        );
      })}

      {showManageLink && (
        <Link
          href="/accounts"
          className="flex min-h-[44px] sm:min-h-[50px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary-soft/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-soft/25 active:translate-y-0 active:scale-[0.98]"
        >
          <span>Manage accounts</span>
          <Plus className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export function DashboardQuickFilterChips() {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
      <Link
        href="/rules?tab=recurrences"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs font-medium sm:font-semibold text-fg shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xs active:translate-y-0 active:scale-95 hover:bg-surface-2"
      >
        <Repeat className="size-3 sm:size-3.5 text-warning" aria-hidden="true" />
        <span>Planned payments</span>
      </Link>
      <Link
        href="/accounts?tab=liabilities"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs font-medium sm:font-semibold text-fg shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xs active:translate-y-0 active:scale-95 hover:bg-surface-2"
      >
        <CreditCard className="size-3 sm:size-3.5 text-danger" aria-hidden="true" />
        <span>Debts</span>
      </Link>
      <Link
        href="/budgets"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs font-medium sm:font-semibold text-fg shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xs active:translate-y-0 active:scale-95 hover:bg-surface-2"
      >
        <TrendingUp className="size-3 sm:size-3.5 text-success" aria-hidden="true" />
        <span>Budgets</span>
      </Link>
      <Link
        href="/piggy-banks"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs font-medium sm:font-semibold text-fg shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xs active:translate-y-0 active:scale-95 hover:bg-surface-2"
      >
        <PiggyBank className="size-3 sm:size-3.5 text-primary" aria-hidden="true" />
        <span>Savings Goals</span>
      </Link>
    </div>
  );
}

export interface EdgeResizeDragPhysics {
  effectiveDx: number;
  scaleX: number;
  scaleY: number;
  blurPx: number;
  opacity: number;
  shadow: string;
}

export function computeEdgeResizePhysics(
  dx: number,
  cardWidth: number,
  span: 1 | 2,
): EdgeResizeDragPhysics {
  const safeWidth = Math.max(240, cardWidth);
  // Expand direction is dx > 0 when span === 1; shrink direction is dx < 0 when span === 2
  const isBlockedDirection = (span === 1 && dx < 0) || (span === 2 && dx > 0);

  let effectiveDx = dx;
  if (isBlockedDirection) {
    // Logarithmic rubber-band resistance (~0.35 decay factor)
    const sign = Math.sign(dx);
    const abs = Math.abs(dx);
    effectiveDx = sign * Math.min(abs * 0.35, 65 * Math.log10(1 + abs / 35));
  } else {
    // Smooth elastic tracking up to +/- 180px
    const sign = Math.sign(dx);
    const abs = Math.abs(dx);
    effectiveDx = sign * Math.min(180, abs * 0.65);
  }

  const absEff = Math.abs(effectiveDx);
  const progress = Math.min(1, absEff / Math.min(160, safeWidth * 0.35));

  // Stretch or compress card width dynamically during drag
  const scaleDelta = (effectiveDx / safeWidth) * 0.22;
  const scaleX = Number(Math.max(0.88, Math.min(1.16, 1 + scaleDelta)).toFixed(4));
  const scaleY = Number((1 - progress * 0.012).toFixed(4));

  // Progressive motion blur & depth softening (0px -> 10px)
  const blurPx = Number(Math.min(10, progress * 10).toFixed(2));
  const opacity = Number((1 - progress * 0.12).toFixed(3));
  const shadow =
    effectiveDx >= 0
      ? "14px 0 28px -6px rgba(99, 102, 241, 0.38), 0 12px 24px -6px rgba(0, 0, 0, 0.35)"
      : "-14px 0 28px -6px rgba(99, 102, 241, 0.38), 0 12px 24px -6px rgba(0, 0, 0, 0.35)";

  return {
    effectiveDx,
    scaleX,
    scaleY,
    blurPx,
    opacity,
    shadow,
  };
}

function CardEdgeResizeHandle({
  span,
  onSetSpan,
  onToggleSpan,
  onDragPhysicsChange,
}: {
  span: 1 | 2;
  onSetSpan: (s: 1 | 2) => void;
  onToggleSpan: () => void;
  onDragPhysicsChange?: (state: {
    isDragging: boolean;
    isRubberBanding: boolean;
    physics: EdgeResizeDragPhysics | null;
  }) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<{
    startX: number;
    lastX: number;
    lastTime: number;
    velocityX: number;
    cardWidth: number;
    initialSpan: 1 | 2;
  }>({
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    cardWidth: 400,
    initialSpan: span,
  });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={span === 2 ? "Shrink card width to 1 column" : "Expand card width to 2 columns"}
      title={span === 2 ? "Click or swipe left to shrink card (1 col)" : "Click or swipe right to expand card (2 cols)"}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const cardEl = (e.currentTarget as HTMLElement).closest("[data-card-key]") as HTMLElement | null;
        const rect = cardEl?.getBoundingClientRect();
        setIsDragging(true);
        gestureRef.current = {
          startX: e.clientX,
          lastX: e.clientX,
          lastTime: performance.now(),
          velocityX: 0,
          cardWidth: rect?.width || 400,
          initialSpan: span,
        };
        onDragPhysicsChange?.({ isDragging: true, isRubberBanding: false, physics: null });
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }}
      onPointerMove={(e) => {
        if (!isDragging) return;
        const g = gestureRef.current;
        const dx = e.clientX - g.startX;
        const now = performance.now();
        const dt = Math.max(1, now - g.lastTime);
        const instantVel = (e.clientX - g.lastX) / dt;
        g.velocityX = g.velocityX * 0.4 + instantVel * 0.6;
        g.lastX = e.clientX;
        g.lastTime = now;

        const physics = computeEdgeResizePhysics(dx, g.cardWidth, g.initialSpan);
        onDragPhysicsChange?.({
          isDragging: true,
          isRubberBanding: false,
          physics,
        });
      }}
      onPointerUp={(e) => {
        if (!isDragging) return;
        setIsDragging(false);
        const g = gestureRef.current;
        const dx = e.clientX - g.startX;
        const absDx = Math.abs(dx);
        const absVel = Math.abs(g.velocityX);

        // Tap / click toggle (< 6px movement)
        if (absDx < 6) {
          onDragPhysicsChange?.({ isDragging: false, isRubberBanding: false, physics: null });
          onToggleSpan();
          return;
        }

        // Velocity-aware threshold: >= 20% card width OR >= 55px drag OR flick velocity > 0.45 px/ms
        const thresholdMet = absDx >= Math.min(75, g.cardWidth * 0.2) || absVel > 0.45;

        if (thresholdMet && dx > 0 && g.initialSpan === 1) {
          onDragPhysicsChange?.({ isDragging: false, isRubberBanding: false, physics: null });
          onSetSpan(2);
        } else if (thresholdMet && dx < 0 && g.initialSpan === 2) {
          onDragPhysicsChange?.({ isDragging: false, isRubberBanding: false, physics: null });
          onSetSpan(1);
        } else {
          // Rubber-band bounce back
          onDragPhysicsChange?.({ isDragging: false, isRubberBanding: true, physics: null });
        }
      }}
      onPointerCancel={() => {
        setIsDragging(false);
        onDragPhysicsChange?.({ isDragging: false, isRubberBanding: true, physics: null });
      }}
      className="group/edge absolute -right-3 inset-y-6 hidden w-6 cursor-grab active:cursor-grabbing items-center justify-center lg:flex select-none touch-none z-20"
    >
      {/* Tactile Capsule Resize Pill with 2-position indicator dots (1 col vs 2 cols) */}
      <div
        className={cn(
          "flex h-14 w-2.5 flex-col items-center justify-center gap-1 rounded-full border border-border/60 bg-surface-2/90 backdrop-blur-md shadow-xs transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/edge:w-3.5 group-hover/edge:border-primary/60 group-hover/edge:bg-primary/20 group-hover/edge:shadow-[0_0_14px_rgba(99,102,241,0.45)]",
          isDragging && "w-4 border-primary bg-primary text-primary-fg ring-4 ring-primary/25 scale-y-110 shadow-[0_0_20px_rgba(99,102,241,0.65)]",
        )}
      >
        <span
          className={cn(
            "rounded-full transition-all duration-300",
            span === 1
              ? "h-3 w-1 bg-primary group-hover/edge:bg-primary"
              : "size-1 bg-muted/60",
            isDragging && "bg-white",
          )}
        />
        <span
          className={cn(
            "rounded-full transition-all duration-300",
            span === 2
              ? "h-3 w-1 bg-primary group-hover/edge:bg-primary"
              : "size-1 bg-muted/60",
            isDragging && "bg-white",
          )}
        />
      </div>
      <span className="pointer-events-none absolute -bottom-7 right-0 hidden rounded-lg border border-border/50 bg-fg/95 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold text-bg shadow-lg group-hover/edge:block whitespace-nowrap z-30">
        {span === 2 ? "← Swipe / click to shrink (1 col)" : "Swipe / click to expand (2 cols) →"}
      </span>
    </div>
  );
}

export function CardMiniPreview({ cardKey }: { cardKey: DashboardCardKey }) {
  switch (cardKey) {
    case "gauges":
      return (
        <div className="flex items-center justify-around rounded-lg bg-surface-2/60 p-2 text-center">
          <div className="flex flex-col items-center">
            <div className="relative flex size-12 items-center justify-center">
              <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
                <path className="text-border" strokeWidth="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" strokeDasharray="100, 100" />
                <path className="text-primary" strokeWidth="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831" strokeDasharray="75, 100" />
              </svg>
              <span className="absolute text-[9px] font-bold">5.6K</span>
            </div>
            <span className="text-[9px] font-medium text-muted">Liquid</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="relative flex size-12 items-center justify-center">
              <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
                <path className="text-border" strokeWidth="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" strokeDasharray="100, 100" />
                <path className="text-success" strokeWidth="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831" strokeDasharray="85, 100" />
              </svg>
              <span className="absolute text-[9px] font-bold text-success">+782</span>
            </div>
            <span className="text-[9px] font-medium text-muted">Cash Flow</span>
          </div>
        </div>
      );
    case "quick_stats":
      return (
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="rounded border border-border/60 bg-surface p-1">
            <p className="text-[9px] text-muted">Spent Today</p>
            <p className="font-bold text-fg">14.50 BHD</p>
          </div>
          <div className="rounded border border-border/60 bg-surface p-1">
            <p className="text-[9px] text-muted">Last 7 Days</p>
            <p className="font-bold text-fg">120.00 BHD</p>
          </div>
          <div className="rounded border border-border/60 bg-surface p-1">
            <p className="text-[9px] text-muted">This Month</p>
            <p className="font-bold text-fg">540.00 BHD</p>
          </div>
          <div className="rounded border border-border/60 bg-surface p-1">
            <p className="text-[9px] text-muted">Daily Average</p>
            <p className="font-bold text-fg">18.00 BHD</p>
          </div>
        </div>
      );
    case "recent_records":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between border-b border-border/40 pb-1">
            <span className="font-semibold text-fg">Lulu Hypermarket</span>
            <span className="font-mono font-bold text-danger">-32.40 BHD</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/40 pb-1">
            <span className="font-semibold text-fg">Salary Deposit</span>
            <span className="font-mono font-bold text-success">+1,250 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">Coffee Shop</span>
            <span className="font-mono font-bold text-danger">-3.20 BHD</span>
          </div>
        </div>
      );
    case "cashflow_table":
      return (
        <div className="rounded-lg bg-surface-2/60 p-1.5 text-[9px]">
          <table className="w-full">
            <thead>
              <tr className="text-muted border-b border-border/50">
                <th className="text-left font-medium pb-0.5">Overview</th>
                <th className="text-right text-success pb-0.5">In</th>
                <th className="text-right text-danger pb-0.5">Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              <tr>
                <td className="py-0.5 text-muted">Count</td>
                <td className="text-right font-mono font-medium">12</td>
                <td className="text-right font-mono font-medium text-danger">38</td>
              </tr>
              <tr>
                <td className="py-0.5 text-muted">Total</td>
                <td className="text-right font-mono font-bold text-success">1,250</td>
                <td className="text-right font-mono font-bold text-danger">-468</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    case "top_categories":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div>
            <div className="flex justify-between font-semibold">
              <span>Groceries</span>
              <span className="text-muted">45%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: "45%" }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-semibold">
              <span>Dining & Cafes</span>
              <span className="text-muted">30%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: "30%" }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-semibold">
              <span>Transport</span>
              <span className="text-muted">25%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: "25%" }} />
            </div>
          </div>
        </div>
      );
    case "top_payees":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">1. Lulu Hypermarket</span>
            <span className="font-mono text-muted">180 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">2. Amazon Online</span>
            <span className="font-mono text-muted">95 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">3. Shell Petrol</span>
            <span className="font-mono text-muted">42 BHD</span>
          </div>
        </div>
      );
    case "largest_expenses":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold text-fg">Annual Car Insurance</span>
            <span className="font-mono font-bold text-danger">-240 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold text-fg">Flight Tickets</span>
            <span className="font-mono font-bold text-danger">-185 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold text-fg">Electronics Store</span>
            <span className="font-mono font-bold text-danger">-120 BHD</span>
          </div>
        </div>
      );
    case "spending_by_account":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div>
            <div className="flex justify-between font-semibold">
              <span>Daily Account</span>
              <span className="font-mono text-muted">62%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: "62%" }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-semibold">
              <span>Credit Card</span>
              <span className="font-mono text-muted">38%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-danger rounded-full" style={{ width: "38%" }} />
            </div>
          </div>
        </div>
      );
    case "charts":
      return (
        <div className="flex h-14 items-end justify-between gap-1 rounded-lg bg-surface-2/60 p-2">
          <div className="flex h-full flex-1 items-end gap-1 border-r border-border/50 pr-2">
            <div className="w-2.5 rounded-t bg-emerald-500" style={{ height: "65%" }} />
            <div className="w-2.5 rounded-t bg-rose-500" style={{ height: "45%" }} />
            <div className="w-2.5 rounded-t bg-emerald-500" style={{ height: "80%" }} />
            <div className="w-2.5 rounded-t bg-rose-500" style={{ height: "55%" }} />
          </div>
          <div className="relative flex h-full flex-1 items-end justify-center">
            <svg viewBox="0 0 60 30" className="w-full h-8 overflow-visible">
              <path d="M0,25 Q15,10 30,18 T60,5" fill="none" stroke="var(--primary)" strokeWidth="2.5" />
            </svg>
          </div>
        </div>
      );
    case "balance_trend":
      return (
        <div className="flex h-12 items-center justify-center rounded-lg bg-surface-2/60 p-2">
          <svg viewBox="0 0 100 35" className="w-full h-8 overflow-visible">
            <path d="M0,30 Q25,20 50,24 T100,6" fill="none" stroke="var(--primary)" strokeWidth="2.5" />
          </svg>
        </div>
      );
    case "income_expense_bars":
      return (
        <div className="flex h-12 items-end justify-around rounded-lg bg-surface-2/60 p-2">
          <div className="w-2 rounded-t bg-emerald-500" style={{ height: "60%" }} />
          <div className="w-2 rounded-t bg-rose-500" style={{ height: "40%" }} />
          <div className="w-2 rounded-t bg-emerald-500" style={{ height: "75%" }} />
          <div className="w-2 rounded-t bg-rose-500" style={{ height: "50%" }} />
          <div className="w-2 rounded-t bg-emerald-500" style={{ height: "85%" }} />
          <div className="w-2 rounded-t bg-rose-500" style={{ height: "45%" }} />
        </div>
      );
    case "balance_by_currency":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">BHD (Primary)</span>
            <span className="font-mono font-bold text-fg">4,768.110</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">USD (Dollar)</span>
            <span className="font-mono text-muted">$2,224.55</span>
          </div>
        </div>
      );
    case "budgets_goals":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div>
            <div className="flex justify-between font-semibold">
              <span>Groceries</span>
              <span className="text-warning">75%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-warning rounded-full" style={{ width: "75%" }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-semibold">
              <span>Vacation</span>
              <span className="text-primary">40%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: "40%" }} />
            </div>
          </div>
        </div>
      );
    case "piggy_banks":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between font-semibold">
            <span>Emergency Fund</span>
            <span className="text-success font-bold">65%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: "65%" }} />
          </div>
          <p className="text-[9px] text-muted">1,950 of 3,000 BHD saved</p>
        </div>
      );
    case "upcoming_bills":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex items-center justify-between">
            <div>
              <span className="block font-semibold text-fg">Home Fiber Internet</span>
              <span className="text-[9px] text-warning font-medium">Due in 3 days</span>
            </div>
            <span className="font-mono font-bold text-fg">25.00 BHD</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="block font-semibold text-fg">Cloud Storage</span>
              <span className="text-[9px] text-muted font-medium">Due in 14 days</span>
            </div>
            <span className="font-mono font-bold text-fg">4.50 BHD</span>
          </div>
        </div>
      );
    case "liabilities":
      return (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2/60 p-2 text-[10px]">
          <div className="flex justify-between font-semibold">
            <span>Car Loan Payoff</span>
            <span className="text-success font-bold">60% Paid</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: "60%" }} />
          </div>
          <p className="text-[9px] text-muted">12 installments remaining</p>
        </div>
      );
    default:
      return null;
  }
}

export function DashboardClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = isoDate();
  const currentMonth = useMemo(() => monthRange(0), []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDate(d);
  }, []);

  const [topTab, setTopTab] = useState<"accounts" | "budgets">("accounts");
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [dragKey, setDragKey] = useState<DashboardCardKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<DashboardCardKey | null>(null);
  const [configOpenKey, setConfigOpenKey] = useState<DashboardCardKey | null>(null);
  const [showCardManager, setShowCardManager] = useState(false);
  const [previewCardKey, setPreviewCardKey] = useState<DashboardCardKey | null>(null);
  const [closingPreview, setClosingPreview] = useState(false);

  useEscapeDismiss(configOpenKey !== null, () => setConfigOpenKey(null), "dashboard-card-config");

  const handleClosePreview = useCallback(() => {
    setClosingPreview(true);
    window.setTimeout(() => {
      setPreviewCardKey(null);
      setClosingPreview(false);
    }, 220);
  }, []);

  const primaryQ = usePrimaryCurrency();
  const accountsQ = useAccounts("all");

  // Load persisted dashboard preferences (selected accounts + card order/config)
  const prefsQ = useQuery({
    queryKey: ["dashboard-prefs"],
    queryFn: async () => {
      const res = await fetch("/api/companion/dashboard");
      if (!res.ok) return DEFAULT_DASHBOARD_PREFS;
      const json = (await res.json()) as { data?: DashboardPreferences };
      return json.data ?? DEFAULT_DASHBOARD_PREFS;
    },
    staleTime: 60_000,
  });

  const savePrefsMut = useMutation({
    mutationFn: async (next: Partial<DashboardPreferences>) => {
      const res = await fetch("/api/companion/dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("Failed to save dashboard layout");
      return (await res.json()) as { data: DashboardPreferences };
    },
    onMutate: (next) => {
      qc.setQueryData(["dashboard-prefs"], (old: unknown) => {
        const prev = (old && typeof old === "object" ? old : DEFAULT_DASHBOARD_PREFS) as Record<string, unknown>;
        return { ...prev, ...next };
      });
    },
    onSuccess: (res) => {
      qc.setQueryData(["dashboard-prefs"], res.data);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const prefs = prefsQ.data ?? DEFAULT_DASHBOARD_PREFS;
  const selectedIds = useMemo(() => prefs.selectedAccountIds ?? [], [prefs.selectedAccountIds]);
  const cards = Array.isArray(prefs.cards) ? prefs.cards : DEFAULT_DASHBOARD_PREFS.cards;

  const handleReorderCards = useCallback(
    (newCards: DashboardCardConfig[]) => {
      qc.setQueryData(["dashboard-prefs"], (old: unknown) => {
        const prev = (old && typeof old === "object" ? old : {}) as Record<string, unknown>;
        return { ...prev, cards: newCards };
      });
      savePrefsMut.mutate({ cards: newCards });
    },
    [qc, savePrefsMut],
  );

  const summaryQ = useQuery({
    queryKey: ["dashboard", "summary", currentMonth.start, currentMonth.end],
    queryFn: () => api.summary(currentMonth.start, currentMonth.end),
    staleTime: 60_000,
  });

  // 6-month history
  const months = useMemo(() => [-5, -4, -3, -2, -1, 0].map((off) => monthRange(off)), []);
  const monthSummaries = useQueries({
    queries: months.map((m) => ({
      queryKey: ["dashboard", "summary", m.start, m.end],
      queryFn: () => api.summary(m.start, m.end),
      staleTime: 5 * 60_000,
    })),
  });

  const chartQ = useQuery({
    queryKey: ["dashboard", "account-chart", thirtyDaysAgo, today],
    queryFn: () => api.accountChart(thirtyDaysAgo, today),
    staleTime: 2 * 60_000,
  });

  const budgetsQ = useQuery({
    queryKey: ["budgets", currentMonth.start, currentMonth.end],
    queryFn: () => api.budgets(currentMonth.start, currentMonth.end),
    staleTime: 60_000,
  });
  const limitsQ = useQuery({
    queryKey: ["budget-limits", currentMonth.start, currentMonth.end],
    queryFn: () => api.budgetLimits(currentMonth.start, currentMonth.end),
    staleTime: 60_000,
  });
  const billsQ = useQuery({
    queryKey: ["bills", currentMonth.start, currentMonth.end],
    queryFn: () => api.bills(currentMonth.start, currentMonth.end),
    staleTime: 60_000,
  });
  const piggyQ = useQuery({
    queryKey: ["piggy-banks"],
    queryFn: api.piggyBanks,
    staleTime: 60_000,
  });

  // Fetch recent transactions (up to 50) so we can dynamically filter by selected accounts & compute Cash Flow Table
  const recentTxQ = useQuery({
    queryKey: ["transactions", "dashboard-pool"],
    queryFn: () => api.transactions(1, { limit: 250 }),
    staleTime: 30_000,
  });

  // Net-Worth asset accounts eligible for the Wallet grid:
  // Strictly excludes inactive accounts, accounts excluded from Net Worth, system contra-accounts, and non-card liability types (loans, debts, mortgages).
  // Active credit card accounts (type: asset, role: ccAsset, or credit card liability) included in net worth are supported and shown.
  const walletAccounts = useMemo(
    () => (accountsQ.data ?? []).filter(isEligibleWalletAccount),
    [accountsQ.data],
  );

  // Which accounts are currently selected for Net Worth, Gauges, Recent Records & Cash Flow
  const activeSelectedAccounts = useMemo(() => {
    if (selectedIds.length === 0) {
      return walletAccounts;
    }
    const set = new Set(selectedIds);
    return walletAccounts.filter((a) => set.has(a.id));
  }, [walletAccounts, selectedIds]);

  const selectedIdSet = useMemo(
    () => new Set(activeSelectedAccounts.map((a) => a.id)),
    [activeSelectedAccounts],
  );

  function toggleAccountSelection(id: string) {
    let nextIds: string[];
    if (selectedIds.length === 0) {
      // Wallet behavior: tapping an account when all are active solo-selects that account
      nextIds = [id];
    } else if (selectedIds.includes(id)) {
      const remaining = selectedIds.filter((x) => x !== id);
      // If deselecting the last selected account, restore all accounts
      nextIds = remaining.length === 0 ? [] : remaining;
    } else {
      const combined = [...selectedIds, id];
      // If all accounts are now selected, normalize back to empty array ("all non-excluded")
      nextIds = combined.length >= walletAccounts.length ? [] : combined;
    }
    savePrefsMut.mutate({ selectedAccountIds: nextIds });
  }

  function selectAllAccounts() {
    savePrefsMut.mutate({ selectedAccountIds: [] });
  }

  // Group balances by currency from currently selected accounts
  const balancesByCurrency = useMemo(() => {
    const map = new Map<string, { code: string; decimals: number; symbol?: string | null; total: Decimal }>();
    for (const acc of activeSelectedAccounts) {
      const code = acc.attributes.currency_code || "";
      if (!code) continue;
      const cur = map.get(code) ?? {
        code,
        decimals: acc.attributes.currency_decimal_places ?? 2,
        symbol: acc.attributes.currency_symbol,
        total: new Decimal(0),
      };
      const rawBal = new Decimal(acc.attributes.current_balance ?? 0);
      const isLiabilityType = String(acc.attributes.type || "").toLowerCase().includes("liabilit");
      const liabDirection = acc.attributes.liability_direction;
      // In Firefly III, if a liability credit card has direction "debit" and positive raw balance, it reduces net worth
      const signedBal =
        isLiabilityType && liabDirection === "debit" && rawBal.gt(0)
          ? rawBal.neg()
          : rawBal;
      cur.total = cur.total.plus(signedBal);
      map.set(code, cur);
    }
    return [...map.values()];
  }, [activeSelectedAccounts]);

  const allCurrencyCodes = useMemo(
    () => [...new Set(walletAccounts.map((a) => a.attributes.currency_code || "").filter(Boolean))],
    [walletAccounts],
  );
  const ratesToPrimaryQ = useRatesToPrimary(allCurrencyCodes, today);
  const primary = primaryQ.data;
  const primaryCode = primary?.code || balancesByCurrency[0]?.code || "BHD";
  const primaryDecimals = primary?.decimal_places ?? 3;

  // Convert any amount in `code` to `primaryCode`
  const toPrimary = useMemo(() => {
    return (amount: string | number | Decimal, code?: string | null): Decimal => {
      const d = new Decimal(amount || 0);
      if (!code || code === primaryCode) return d;
      const r = ratesToPrimaryQ.data?.[code];
      return r ? d.mul(r.rate) : d;
    };
  }, [primaryCode, ratesToPrimaryQ.data]);

  // Converted net worth of selected accounts in primary currency
  const selectedBalancePrimary = useMemo(() => {
    let total = new Decimal(0);
    for (const b of balancesByCurrency) {
      total = total.plus(toPrimary(b.total, b.code));
    }
    return total;
  }, [balancesByCurrency, toPrimary]);

  // Filter recent transactions by selected accounts
  const filteredTransactions = useMemo(() => {
    const allTx = recentTxQ.data?.data ?? [];
    if (selectedIds.length === 0) return allTx;
    return allTx.filter((g) => {
      const s = g.attributes.transactions[0];
      if (!s) return false;
      return (
        (s.source_id && selectedIdSet.has(String(s.source_id))) ||
        (s.destination_id && selectedIdSet.has(String(s.destination_id)))
      );
    });
  }, [recentTxQ.data, selectedIds.length, selectedIdSet]);

  // Compute Cash Flow Table & Gauge metrics for any given period (7, 30, or 90 days)
  function computeMetricsForPeriod(days: number) {
    // Next 7 days outlook from active unpaid bills
    let outlookNext7 = new Decimal(0);
    for (const b of billsQ.data ?? []) {
      if (!b.attributes.active) continue;
      const paid = (b.attributes.paid_dates?.length ?? 0) > 0;
      if (!paid) {
        const avgBill = new Decimal(b.attributes.amount_min || 0)
          .plus(b.attributes.amount_max || 0)
          .div(2);
        outlookNext7 = outlookNext7.minus(toPrimary(avgBill, b.attributes.currency_code).div(4));
      }
    }

    // Debt & Credit ratios across selected accounts
    let debtSum = new Decimal(0);
    let creditUsedSum = new Decimal(0);
    let positiveAssetSum = new Decimal(0);
    for (const acc of activeSelectedAccounts) {
      const bal = toPrimary(acc.attributes.current_balance ?? 0, acc.attributes.currency_code);
      if (bal.lt(0)) {
        debtSum = debtSum.plus(bal.abs());
        if (acc.attributes.account_role === "ccAsset" || String(acc.attributes.type).toLowerCase().includes("credit")) {
          creditUsedSum = creditUsedSum.plus(bal.abs());
        }
      } else {
        positiveAssetSum = positiveAssetSum.plus(bal);
      }
    }
    const debtPct = positiveAssetSum.gt(0)
      ? Math.min(100, Math.round(debtSum.div(positiveAssetSum).mul(100).toNumber()))
      : 0;
    const creditPct = positiveAssetSum.gt(0)
      ? Math.min(100, Math.round(creditUsedSum.div(positiveAssetSum).mul(100).toNumber()))
      : 0;

    let incomeCount = 0;
    let expenseCount = 0;
    let incomeSum = new Decimal(0);
    let expenseSum = new Decimal(0);

    const periodTxs = inPeriod(filteredTransactions, days);
    for (const g of periodTxs) {
      for (const s of g.attributes.transactions) {
        const amtPrimary = toPrimary(Math.abs(Number(s.amount || 0)), s.currency_code);
        if (s.type === "deposit") {
          incomeCount++;
          incomeSum = incomeSum.plus(amtPrimary);
        } else if (s.type === "withdrawal") {
          expenseCount++;
          expenseSum = expenseSum.plus(amtPrimary);
        }
      }
    }

    // If 30-day window and all accounts are selected, fall back to summaryQ if larger
    if (days === 30 && selectedIds.length === 0 && summaryQ.data) {
      const earnedEntries = extractSummaryByPrefix(summaryQ.data, "earned-in-");
      const spentEntries = extractSummaryByPrefix(summaryQ.data, "spent-in-");
      if (earnedEntries.length > 0 || spentEntries.length > 0) {
        let sumE = new Decimal(0);
        let sumS = new Decimal(0);
        for (const e of earnedEntries) sumE = sumE.plus(toPrimary(Math.abs(Number(e.monetary_value)), e.currency_code));
        for (const s of spentEntries) sumS = sumS.plus(toPrimary(Math.abs(Number(s.monetary_value)), s.currency_code));
        if (sumE.gt(incomeSum)) incomeSum = sumE;
        if (sumS.gt(expenseSum)) expenseSum = sumS;
      }
    }

    const netCashflow = incomeSum.minus(expenseSum);
    const safeDays = Math.max(1, days);
    return {
      days: safeDays,
      incomeCount,
      expenseCount,
      incomeSum,
      expenseSum,
      netCashflow,
      avgIncomeDay: incomeSum.div(safeDays),
      avgExpenseDay: expenseSum.div(safeDays),
      avgIncomeRec: incomeCount > 0 ? incomeSum.div(incomeCount) : new Decimal(0),
      avgExpenseRec: expenseCount > 0 ? expenseSum.div(expenseCount) : new Decimal(0),
      outlookNext7,
      debtPct,
      creditPct,
    };
  }

  // 6-month bar chart data
  const barData = months.map((m, i) => {
    const s = monthSummaries[i]?.data;
    const earned = extractSummaryByPrefix(s, "earned-in-").find((e) => e.currency_code === primaryCode);
    const spent = extractSummaryByPrefix(s, "spent-in-").find((e) => e.currency_code === primaryCode);
    return {
      name: m.label,
      Income: Math.abs(Number(earned?.monetary_value ?? 0)),
      Expense: Math.abs(Number(spent?.monetary_value ?? 0)),
    };
  });

  // Account overview area chart (filtered by selected account names when applicable)
  const selectedNamesSet = useMemo(
    () => new Set(activeSelectedAccounts.map((a) => a.attributes.name.toLowerCase())),
    [activeSelectedAccounts],
  );
  const sets = chartQ.data ?? [];
  const chosenSets = sets.filter((s) => selectedNamesSet.has((s.label || "").toLowerCase()));
  const effectiveSets = chosenSets.length > 0 ? chosenSets : sets;
  const byDate = new Map<string, number>();
  for (const ds of effectiveSets) {
    for (const pt of normaliseChartEntries(ds)) {
      byDate.set(pt.date, (byDate.get(pt.date) ?? 0) + pt.value);
    }
  }
  const trendData = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, balance]) => ({
      date: date.slice(5),
      Balance: Math.round(balance * 100) / 100,
    }));

  // Budgets progress
  const activeBudgets = (budgetsQ.data ?? []).filter((b) => b.attributes.active);
  const limitsList = limitsQ.data ?? [];
  const budgetRows = activeBudgets
    .map((b) => {
      const lim = limitsList.find((l) => l.attributes.budget_id === b.id);
      const limitAmt = Number(lim?.attributes.amount ?? b.attributes.auto_budget_amount ?? 0);
      const spentArr = b.attributes.spent ?? [];
      const spentAmt = sumDecimal(spentArr.map((s) => Math.abs(Number(s.sum)))).toNumber();
      const code =
        lim?.attributes.currency_code ||
        spentArr[0]?.currency_code ||
        b.attributes.auto_budget_currency_code ||
        primaryCode;
      const decimals =
        lim?.attributes.currency_decimal_places ??
        spentArr[0]?.currency_decimal_places ??
        primaryDecimals;
      return { id: b.id, name: b.attributes.name, spent: spentAmt, limit: limitAmt, code, decimals };
    })
    .filter((r) => r.limit > 0 || r.spent > 0);

  // Reorder cards helper (drag-and-drop + up/down buttons)
  function moveCard(fromKey: DashboardCardKey, toKey: DashboardCardKey) {
    if (fromKey === toKey) return;
    const list = [...cards];
    const fromIdx = list.findIndex((c) => c.key === fromKey);
    const toIdx = list.findIndex((c) => c.key === toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    savePrefsMut.mutate({ cards: list });
  }

  function stepCardOrder(key: DashboardCardKey, dir: -1 | 1) {
    const list = [...cards];
    const idx = list.findIndex((c) => c.key === key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(target, 0, moved);
    savePrefsMut.mutate({ cards: list });
  }

  function handleTouchDragMove(e: React.TouchEvent, containerAttr: string) {
    if (e.cancelable) {
      e.preventDefault();
    }
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const target = el?.closest(`[${containerAttr}]`) as HTMLElement | null;
    const targetKey = target?.getAttribute(containerAttr) as DashboardCardKey | null;
    if (targetKey && targetKey !== dragOverKey) {
      setDragOverKey(targetKey);
    }
  }

  function handleTouchDragEnd() {
    if (dragKey && dragOverKey && dragKey !== dragOverKey) {
      moveCard(dragKey, dragOverKey);
    }
    setDragKey(null);
    setDragOverKey(null);
  }

  function updateCardConfig(key: DashboardCardKey, patch: Partial<DashboardCardConfig>) {
    const next = cards.map((c) => (c.key === key ? { ...c, ...patch } : c));
    qc.setQueryData(["dashboard-prefs"], (old: unknown) => {
      const prev = (old && typeof old === "object" ? old : DEFAULT_DASHBOARD_PREFS) as Record<string, unknown>;
      return { ...prev, cards: next };
    });
    savePrefsMut.mutate({ cards: next });
  }

  function addCard(key: DashboardCardKey) {
    if (cards.some((c) => c.key === key)) {
      updateCardConfig(key, { visible: true });
    } else {
      savePrefsMut.mutate({ cards: [...cards, makeCard(key)] });
    }
    toast(`Added “${CATALOG_BY_KEY.get(key)?.title ?? key}”`, "success");
  }

  function removeCard(key: DashboardCardKey) {
    savePrefsMut.mutate({ cards: cards.filter((c) => c.key !== key) });
    setConfigOpenKey(null);
  }

  function resetCards() {
    savePrefsMut.mutate({ cards: DEFAULT_DASHBOARD_PREFS.cards });
  }

  const shownKeys = new Set(cards.filter((c) => c.visible).map((c) => c.key));
  const availableCards = CARD_CATALOG.filter((c) => !shownKeys.has(c.key));

  const extraCtx: ExtraCardContext = {
    transactions: filteredTransactions,
    allTransactions: recentTxQ.data?.data ?? [],
    accounts: activeSelectedAccounts,
    allAccounts: accountsQ.data ?? [],
    toPrimary,
    primaryCode,
    primaryDecimals,
    primarySymbol: primary?.symbol,
    balancesByCurrency,
    bills: billsQ.data ?? [],
    piggies: piggyQ.data ?? [],
    barData,
    trendData,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header: title + net worth of the selected accounts + segmented switch */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted">
            Net worth · {activeSelectedAccounts.length} of {walletAccounts.length} accounts
          </p>
          <p className="tabular text-3xl font-semibold tracking-tight">
            <Money
              amount={selectedBalancePrimary.toFixed(primaryDecimals)}
              code={primaryCode}
              decimals={primaryDecimals}
              symbol={primary?.symbol}
              animated
            />
          </p>
        </div>
        <DashboardSegmentedTabs
          activeTab={topTab}
          onChange={setTopTab}
        />
      </div>


      <ErrorBox error={accountsQ.error || summaryQ.error} />

      {/* Top Panel: My Accounts in Wallet (Multi-Select Tiles) OR Budgets & Goals (Swipeable with dynamic blur) */}
      <SwipeableWidget
        activeIndex={topTab === "accounts" ? 0 : 1}
        totalViews={2}
        viewLabels={["Accounts", "Budgets & Goals"]}
        onIndexChange={(idx) => setTopTab(idx === 0 ? "accounts" : "budgets")}
      >
        <div key={`top-${topTab}`}>
          {topTab === "accounts" ? (
          <Card className="flex flex-col gap-2.5 p-2.5 sm:p-4 md:p-5">
            <AccountsSectionHeader
              accountCount={walletAccounts.length}
              selectedCount={selectedIds.length}
              onSelectAll={selectAllAccounts}
            />

            {accountsQ.isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <>
                <TwoColumnAccountGrid
                  accounts={walletAccounts}
                  selectedIdSet={selectedIdSet}
                  onToggleAccount={toggleAccountSelection}
                  showManageLink={true}
                />

                {/* Wallet-style "Select all non-excluded" quick link when subset is selected */}
                {selectedIds.length > 0 && (
                  <div className="flex justify-center pt-0.5">
                    <button
                      type="button"
                      onClick={selectAllAccounts}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/30 transition-colors cursor-pointer"
                    >
                      Select all non-excluded
                    </button>
                  </div>
                )}

                {/* Wallet-style Context-Aware Bottom Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedIds.length > 0 && activeSelectedAccounts.length > 0 && (
                      <Link
                        href={`/accounts/${activeSelectedAccounts[0].id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95 shadow-2xs"
                      >
                        <span>Account Detail</span>
                        {activeSelectedAccounts.length === 1 && (
                          <span className="max-w-[110px] truncate text-muted font-normal">
                            ({activeSelectedAccounts[0].attributes.name})
                          </span>
                        )}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setCreateAccountOpen(true)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95 cursor-pointer shadow-2xs"
                    >
                      <Plus className="size-3.5 text-primary" aria-hidden="true" />
                      <span>Add account</span>
                    </button>
                  </div>

                  <Link
                    href={
                      selectedIds.length === 1
                        ? `/transactions?accountId=${selectedIds[0]}`
                        : "/transactions"
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95 shadow-2xs"
                  >
                    <List className="size-3.5 text-primary" aria-hidden="true" />
                    <span>Records</span>
                  </Link>
                </div>
              </>
            )}
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Card 1: Budget Left to Spend (Wallet Style) */}
            <Card className="flex flex-col gap-3 p-3 sm:p-4 md:p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-fg">Budget Left to Spend</h2>
                  <p className="text-xs text-muted">In {primaryCode}</p>
                </div>
                <Link
                  href="/budgets"
                  className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg transition-colors"
                  aria-label="Manage budgets"
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </Link>
              </div>

              {budgetRows.length === 0 ? (
                <p className="py-2 text-xs text-muted">
                  No active monthly budgets configured yet. Create a budget to track how much you have left to spend.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-border/60">
                  {budgetRows.map((b) => {
                    const pct = b.limit > 0 ? Math.min(100, Math.round((b.spent / b.limit) * 100)) : 0;
                    const isTrendingOver = pct >= 80;
                    return (
                      <Link
                        key={b.id}
                        href="/budgets"
                        className="group flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 hover:opacity-90 transition-opacity"
                      >
                        <div className="flex items-center justify-between text-xs sm:text-sm">
                          <span className="font-semibold text-fg group-hover:text-primary transition-colors">
                            {b.name}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            <Money amount={b.spent} code={b.code} decimals={b.decimals} skipCurrency />
                            <span>/</span>
                            <Money amount={b.limit} code={b.code} decimals={b.decimals} skipCurrency />
                            <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              isTrendingOver ? "bg-warning" : "bg-success",
                            )}
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Status Legend */}
              <div className="flex items-center gap-4 pt-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-success" aria-hidden="true" />
                  <span>On Track</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-xs bg-warning" aria-hidden="true" />
                  <span>Trending Over</span>
                </span>
              </div>

              {/* Action Pills */}
              <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <Link
                  href="/budgets"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
                >
                  <span>Show more</span>
                </Link>
                <Link
                  href="/budgets"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
                >
                  <span>Create budget</span>
                </Link>
              </div>
            </Card>

            {/* Card 2: Savings Goals / Piggy Banks (Wallet Style) */}
            <Card className="flex flex-col gap-3 p-3 sm:p-4 md:p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
                  <PiggyBank className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-fg">Goals</h2>
                  <p className="text-xs text-muted">
                    {(piggyQ.data?.length ?? 0) === 0
                      ? "Set your first goal and have a quick overview of your progress."
                      : "Track your active savings goals and piggy banks."}
                  </p>
                </div>
              </div>

              {(piggyQ.data?.length ?? 0) > 0 && (
                <div className="flex flex-col divide-y divide-border/60">
                  {(piggyQ.data ?? []).map((p) => {
                    const a = p.attributes;
                    const cur = Number(a.current_amount || 0);
                    const target = Number(a.target_amount || 0);
                    const pct = target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0;
                    return (
                      <Link
                        key={p.id}
                        href="/piggy-banks"
                        className="group flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 hover:opacity-90 transition-opacity"
                      >
                        <div className="flex items-center justify-between text-xs sm:text-sm">
                          <span className="flex items-center gap-2 font-semibold text-fg group-hover:text-primary transition-colors">
                            <ResourceIconBadge entityType="piggy" entityId={p.id} defaultIcon="PiggyBank" size="xs" />
                            <span>{a.name}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                            <Money amount={cur} code={a.currency_code} decimals={a.currency_decimal_places} />
                            {target > 0 && (
                              <>
                                <span>/</span>
                                <Money amount={target} code={a.currency_code} decimals={a.currency_decimal_places} />
                              </>
                            )}
                            <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
                          </span>
                        </div>
                        <Progress value={pct} tone="success" />
                      </Link>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2.5">
                {(piggyQ.data?.length ?? 0) > 0 && (
                  <Link
                    href="/piggy-banks"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95 mr-auto"
                  >
                    <span>Show more</span>
                  </Link>
                )}
                <Link
                  href="/piggy-banks"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
                >
                  <span>Create goal</span>
                </Link>
              </div>
            </Card>
          </div>
        )}
        </div>
      </SwipeableWidget>

      {/* Horizontal Quick-Action Filter Chips (Planned payments, Debts, Budgets, Savings Goals) */}
      <DashboardQuickFilterChips />

      {/* Draggable & Configurable Dashboard Cards (1 col on Mobile, 2-col Bento Grid on Desktop) */}
      <DashboardCardsGrid
        cards={cards}
        onReorderCards={handleReorderCards}
        configOpenKey={configOpenKey}
        setConfigOpenKey={setConfigOpenKey}
        stepCardOrder={stepCardOrder}
        updateCardConfig={updateCardConfig}
        removeCard={removeCard}
        computeMetricsForPeriod={computeMetricsForPeriod}
        filteredTransactions={filteredTransactions}
        primaryCode={primaryCode}
        primaryDecimals={primaryDecimals}
        primarySymbol={primary?.symbol}
        selectedBalancePrimary={selectedBalancePrimary}
        barData={barData}
        trendData={trendData}
        chartLoading={chartQ.isLoading}
        budgetRows={budgetRows}
        extraCtx={extraCtx}
      />

      {/* Compact "Add more cards / Customize Dashboard" toolbar (Sleek, zero bulk) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 pb-2 text-xs text-muted">
        <span>
          Showing <strong className="text-fg">{cards.filter((c) => c.visible).length}</strong> of{" "}
          <strong>{CARD_CATALOG.length}</strong> available cards
        </span>
        <button
          type="button"
          onClick={() => setShowCardManager(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-surface-2 active:scale-95 cursor-pointer"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <span>Add more cards &amp; rearrange</span>
        </button>
      </div>

      <ModalSheet
        open={showCardManager}
        onClose={() => setShowCardManager(false)}
        title="Customize Dashboard Cards"
        subtitle="Add, remove, reorder, or toggle cards on your dashboard"
        maxWidth="max-w-2xl"
      >
        <div className="flex flex-col gap-6">
          {/* Active Cards Section */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-wide uppercase text-muted">
                  Your Dashboard Layout
                </span>
                <Badge tone="primary">
                  {cards.filter((c) => c.visible).length} visible · {cards.length} total
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={resetCards}>
                Reset to default
              </Button>
            </div>

            {cards.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">
                No cards on your dashboard yet — pick any card from the catalog below.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {cards.map((c, idx) => {
                const entry = CATALOG_BY_KEY.get(c.key);
                const span = c.span ?? entry?.defaultSpan ?? 1;
                const isDragging = dragKey === c.key;
                const isDropTarget = dragOverKey === c.key && dragKey !== null && dragKey !== c.key;
                return (
                  <div
                    key={c.key}
                    data-modal-card-key={c.key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.key);
                      setDragKey(c.key);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (dragKey && dragKey !== c.key) {
                        setDragOverKey(c.key);
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragKey && dragKey !== c.key && dragOverKey !== c.key) {
                        setDragOverKey(c.key);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverKey((prev) => (prev === c.key ? null : prev));
                      }
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey && dragKey !== c.key) {
                        moveCard(dragKey, c.key);
                      }
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-2.5 transition-all duration-150 sm:p-3",
                      !c.visible && "opacity-60 bg-surface-2/40",
                      isDragging && "scale-[0.98] opacity-50 ring-2 ring-primary/40",
                      isDropTarget && "border-primary bg-primary-soft/20 ring-2 ring-primary",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-lg bg-surface-2 text-muted hover:text-fg active:cursor-grabbing touch-none"
                        title="Drag to reorder"
                        onTouchStart={() => setDragKey(c.key)}
                        onTouchMove={(e) => handleTouchDragMove(e, "data-modal-card-key")}
                        onTouchEnd={handleTouchDragEnd}
                      >
                        <GripVertical className="size-4" aria-hidden />
                      </span>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted">
                        #{idx + 1}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("text-sm font-semibold", !c.visible && "text-muted line-through")}>
                            {c.title}
                          </span>
                          {entry?.group && (
                            <Badge tone="neutral" className="text-[10px] uppercase">
                              {entry.group}
                            </Badge>
                          )}
                          <Badge tone={span === 2 ? "primary" : "neutral"} className="hidden sm:inline-flex text-[10px]">
                            {span === 2 ? "2 cols" : "1 col"}
                          </Badge>
                        </div>
                        {entry?.description && (
                          <p className="truncate text-xs text-muted">{entry.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPreviewCardKey(c.key)}
                        title="Preview card layout"
                        aria-label="Preview card layout"
                      >
                        <Eye className="size-4 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hidden sm:inline-flex"
                        onClick={() => updateCardConfig(c.key, { span: span === 2 ? 1 : 2 })}
                        title={span === 2 ? "Switch to half width (1 col on desktop)" : "Switch to full width (2 cols on desktop)"}
                        aria-label="Toggle card width"
                      >
                        {span === 2 ? <Columns2 className="size-4" /> : <Square className="size-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === 0}
                        onClick={() => stepCardOrder(c.key, -1)}
                        aria-label="Move card up"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === cards.length - 1}
                        onClick={() => stepCardOrder(c.key, 1)}
                        aria-label="Move card down"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => updateCardConfig(c.key, { visible: !c.visible })}
                        aria-label={c.visible ? "Hide card" : "Show card"}
                      >
                        {c.visible ? <Eye className="size-4 text-primary" /> : <EyeOff className="size-4 text-muted" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCard(c.key)}
                        aria-label="Remove card"
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Categorized Catalog of Available Cards with Live Dummy Previews */}
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wider text-muted uppercase">
                Add More Cards ({availableCards.length} available)
              </p>
              <span className="text-[11px] text-muted">Click preview to see visual card mockup</span>
            </div>
            {availableCards.length === 0 ? (
              <p className="text-xs text-muted">All available cards are already active in your dashboard.</p>
            ) : (
              (["overview", "spending", "charts", "planning"] as CardGroup[]).map((grp) => {
                const items = availableCards.filter((c) => c.group === grp);
                if (items.length === 0) return null;
                return (
                  <div key={grp} className="flex flex-col gap-2.5">
                    <p className="text-xs font-medium text-muted">{CARD_GROUP_LABELS[grp]}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {items.map((c) => (
                        <div
                          key={c.key}
                          className="flex flex-col justify-between gap-2.5 rounded-xl border border-border/80 bg-surface p-3 transition-all hover:border-primary/60 hover:shadow-xs"
                        >
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-sm font-semibold text-fg">{c.title}</h4>
                              <Badge tone={c.defaultSpan === 2 ? "primary" : "neutral"} className="text-[10px]">
                                {c.defaultSpan === 2 ? "2 cols" : "1 col"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted line-clamp-2">{c.description}</p>
                          </div>

                          {/* Visual Dummy Mockup Thumbnail Preview */}
                          <div className="rounded-lg border border-border/60 bg-surface-2/30 p-1.5">
                            <CardMiniPreview cardKey={c.key} />
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                            <button
                              type="button"
                              onClick={() => setPreviewCardKey(c.key)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary transition-colors"
                            >
                              <Eye className="size-3.5" /> Preview
                            </button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => addCard(c.key)}
                              className="h-7 text-xs font-semibold"
                            >
                              <Plus className="size-3.5 text-primary" /> Add card
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </ModalSheet>

      {/* Enlarged Card Mockup Preview Sheet */}
      <ModalSheet
        open={previewCardKey !== null && !closingPreview}
        onClose={handleClosePreview}
        title={previewCardKey ? `Preview: ${CATALOG_BY_KEY.get(previewCardKey)?.title ?? ""}` : "Card Preview"}
        subtitle={previewCardKey ? CATALOG_BY_KEY.get(previewCardKey)?.description : ""}
        maxWidth="max-w-md"
      >
        {previewCardKey && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-2/40 px-3 py-2 text-xs">
              <span className="text-muted">
                Group: <strong className="text-fg">{CARD_GROUP_LABELS[CATALOG_BY_KEY.get(previewCardKey)?.group ?? "overview"]}</strong>
              </span>
              <span className="text-muted">
                Default: <strong className="text-fg">{CATALOG_BY_KEY.get(previewCardKey)?.defaultSpan === 2 ? "Full width (2 cols)" : "Half width (1 col)"}</strong>
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-fg">
                  {CATALOG_BY_KEY.get(previewCardKey)?.title}
                </span>
                <span className="rounded-full bg-primary-soft/40 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Mockup Preview
                </span>
              </div>
              <CardMiniPreview cardKey={previewCardKey} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={handleClosePreview}>
                Close
              </Button>
              {cards.some((c) => c.key === previewCardKey && c.visible) ? (
                <Button variant="ghost" size="sm" disabled>
                  Already on dashboard
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    addCard(previewCardKey);
                    handleClosePreview();
                  }}
                >
                  <Plus className="size-4" /> Add to dashboard
                </Button>
              )}
            </div>
          </div>
        )}
      </ModalSheet>

      <CreateAccountModal
        open={createAccountOpen}
        onClose={() => setCreateAccountOpen(false)}
        initialType="asset"
      />
    </div>
  );
}

// ============================================================================
// DRAGGABLE DASHBOARD CARDS GRID (ISOLATES DRAG STATE & PREVENTS ROOT RE-RENDERS)
// ============================================================================

interface DashboardCardsGridProps {
  cards: DashboardCardConfig[];
  onReorderCards: (newCards: DashboardCardConfig[]) => void;
  configOpenKey: DashboardCardKey | null;
  setConfigOpenKey: (key: DashboardCardKey | null) => void;
  stepCardOrder: (key: DashboardCardKey, delta: -1 | 1) => void;
  updateCardConfig: (key: DashboardCardKey, patch: Partial<DashboardCardConfig>) => void;
  removeCard: (key: DashboardCardKey) => void;
  computeMetricsForPeriod: (days: number) => {
    days: number;
    incomeCount: number;
    expenseCount: number;
    incomeSum: Decimal;
    expenseSum: Decimal;
    netCashflow: Decimal;
    avgIncomeDay: Decimal;
    avgExpenseDay: Decimal;
    avgIncomeRec: Decimal;
    avgExpenseRec: Decimal;
    outlookNext7: Decimal;
    debtPct: number;
    creditPct: number;
  };
  filteredTransactions: Array<Resource<TransactionGroup>>;
  primaryCode: string;
  primaryDecimals: number;
  primarySymbol?: string;
  selectedBalancePrimary: Decimal;
  barData: Array<{ name: string; Income: number; Expense: number }>;
  trendData: Array<{ date: string; Balance: number }>;
  chartLoading: boolean;
  budgetRows: Array<{ id: string; name: string; spent: number; limit: number; code: string; decimals?: number }>;
  extraCtx: ExtraCardContext;
}

function DashboardCardsGrid({
  cards,
  onReorderCards,
  configOpenKey,
  setConfigOpenKey,
  stepCardOrder,
  updateCardConfig,
  removeCard,
  computeMetricsForPeriod,
  filteredTransactions,
  primaryCode,
  primaryDecimals,
  primarySymbol,
  selectedBalancePrimary,
  barData,
  trendData,
  chartLoading,
  budgetRows,
  extraCtx,
}: DashboardCardsGridProps) {
  const {
    containerRef,
    activeDrag,
    isDraggingAny,
    itemsToRender,
    startDrag,
  } = useDashboardDnd({
    cards,
    onReorderCards,
  });

  const resizePrevRectsRef = useRef<Map<DashboardCardKey, DOMRect> | null>(null);

  // Record bounding rects right before a card span changes, then FLIP-animate all cards smoothly
  const handleUpdateCardWithFlip = useCallback(
    (key: DashboardCardKey, patch: Partial<DashboardCardConfig>) => {
      if (patch.span !== undefined && typeof document !== "undefined") {
        const map = new Map<DashboardCardKey, DOMRect>();
        for (const c of cards) {
          if (!c.visible) continue;
          const el = document.getElementById(`card-${c.key}`);
          if (el) {
            map.set(c.key, el.getBoundingClientRect());
          }
        }
        resizePrevRectsRef.current = map;
      }
      updateCardConfig(key, patch);
    },
    [cards, updateCardConfig],
  );

  // Trigger smooth spring FLIP animation whenever any card's span changes
  const spanSignature = useMemo(
    () => cards.map((c) => `${c.key}:${c.span}`).join(","),
    [cards],
  );
  useEffect(() => {
    if (typeof window === "undefined" || !resizePrevRectsRef.current) return;
    const prevRects = resizePrevRectsRef.current;
    resizePrevRectsRef.current = null;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    for (const c of cards) {
      if (!c.visible) continue;
      const el = document.getElementById(`card-${c.key}`);
      const first = prevRects.get(c.key);
      if (!el || !first) continue;

      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const scaleW = last.width > 0 ? first.width / last.width : 1;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(scaleW - 1) > 0.02) {
        if (typeof el.animate === "function") {
          el.animate(
            [
              {
                transformOrigin: "left top",
                transform: `translate3d(${dx}px, ${dy}px, 0) scaleX(${scaleW.toFixed(3)})`,
                filter: Math.abs(scaleW - 1) > 0.05 ? "blur(6px)" : "blur(0px)",
                opacity: Math.abs(scaleW - 1) > 0.05 ? 0.82 : 1,
              },
              {
                transformOrigin: "left top",
                transform: "translate3d(0, 0, 0) scaleX(1)",
                filter: "blur(0px)",
                opacity: 1,
              },
            ],
            {
              duration: 360,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "none",
            },
          );
        }
      }
    }
  }, [spanSignature, cards]);

  const metrics7 = useMemo(() => computeMetricsForPeriod(7), [computeMetricsForPeriod]);
  const metrics30 = useMemo(() => computeMetricsForPeriod(30), [computeMetricsForPeriod]);
  const metrics90 = useMemo(() => computeMetricsForPeriod(90), [computeMetricsForPeriod]);

  const getMetrics = useCallback(
    (periodDays: number) => {
      if (periodDays === 7) return metrics7;
      if (periodDays === 90) return metrics90;
      return metrics30;
    },
    [metrics7, metrics30, metrics90],
  );

  return (
    <div
      ref={containerRef}
      style={isDraggingAny ? { touchAction: "none" } : undefined}
      className={cn(
        "grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4",
        isDraggingAny && "touch-none select-none",
      )}
    >
      {itemsToRender.map((item, index) => {
        if (item.type === "placeholder") {
          return (
            <DashboardDropPlaceholder
              key={item.key}
              height={item.height}
              span={item.span}
            />
          );
        }

        const card = item.card;

        return (
          <DashboardCardItem
            key={card.key}
            card={card}
            index={index}
            totalItems={itemsToRender.length}
            configOpenKey={configOpenKey}
            setConfigOpenKey={setConfigOpenKey}
            stepCardOrder={stepCardOrder}
            updateCardConfig={handleUpdateCardWithFlip}
            removeCard={removeCard}
            onStartDrag={(e) => startDrag(e, card.key)}
            isCurrent={activeDrag?.key === card.key}
            isDraggingAny={isDraggingAny}
            cardMetrics={getMetrics(card.periodDays)}
            filteredTransactions={filteredTransactions}
            primaryCode={primaryCode}
            primaryDecimals={primaryDecimals}
            primarySymbol={primarySymbol}
            selectedBalancePrimary={selectedBalancePrimary}
            barData={barData}
            trendData={trendData}
            chartLoading={chartLoading}
            budgetRows={budgetRows}
            extraCtx={extraCtx}
          />
        );
      })}
    </div>
  );
}

interface DashboardCardItemProps {
  card: DashboardCardConfig;
  index: number;
  totalItems: number;
  configOpenKey: DashboardCardKey | null;
  setConfigOpenKey: (key: DashboardCardKey | null) => void;
  stepCardOrder: (key: DashboardCardKey, delta: -1 | 1) => void;
  updateCardConfig: (key: DashboardCardKey, patch: Partial<DashboardCardConfig>) => void;
  removeCard: (key: DashboardCardKey) => void;
  onStartDrag: (e: React.PointerEvent) => void;
  isCurrent: boolean;
  isDraggingAny: boolean;
  cardMetrics: ReturnType<DashboardCardsGridProps["computeMetricsForPeriod"]>;
  filteredTransactions: Array<Resource<TransactionGroup>>;
  primaryCode: string;
  primaryDecimals: number;
  primarySymbol?: string;
  selectedBalancePrimary: Decimal;
  barData: Array<{ name: string; Income: number; Expense: number }>;
  trendData: Array<{ date: string; Balance: number }>;
  chartLoading: boolean;
  budgetRows: Array<{ id: string; name: string; spent: number; limit: number; code: string; decimals?: number }>;
  extraCtx: ExtraCardContext;
}

const DashboardCardItem = React.memo(function DashboardCardItem({
  card,
  index,
  totalItems,
  configOpenKey,
  setConfigOpenKey,
  stepCardOrder,
  updateCardConfig,
  removeCard,
  onStartDrag,
  isCurrent,
  isDraggingAny,
  cardMetrics,
  filteredTransactions,
  primaryCode,
  primaryDecimals,
  primarySymbol,
  selectedBalancePrimary,
  barData,
  trendData,
  chartLoading,
  budgetRows,
  extraCtx,
}: DashboardCardItemProps) {
  const span = card.span ?? CATALOG_BY_KEY.get(card.key)?.defaultSpan ?? 1;

  return (
    <div
      id={`card-${card.key}`}
      data-card-key={card.key}
      className={cn(
        "@container scroll-mt-6 rounded-2xl transition-opacity duration-200 h-full flex flex-col",
        span === 2 ? "lg:col-span-2 2xl:col-span-2 3xl:col-span-2" : "lg:col-span-1 2xl:col-span-1 3xl:col-span-1",
        isDraggingAny && !isCurrent && "widget-card-recessed widget-card-sibling",
        isDraggingAny && "will-change-transform [backface-visibility:hidden] [transform:translate3d(0,0,0)]",
      )}
    >
      <DashboardCardShell
        card={card}
        isFirst={index === 0}
        isLast={index === totalItems - 1}
        configOpen={configOpenKey === card.key}
        onToggleConfig={() => setConfigOpenKey(configOpenKey === card.key ? null : card.key)}
        onMoveUp={() => stepCardOrder(card.key, -1)}
        onMoveDown={() => stepCardOrder(card.key, 1)}
        onUpdate={(patch) => updateCardConfig(card.key, patch)}
        onRemove={() => removeCard(card.key)}
        onStartDrag={onStartDrag}
      >
        {card.key === "gauges" && (
          <WalletGaugesCard
            primaryCode={primaryCode}
            primaryDecimals={primaryDecimals}
            primarySymbol={primarySymbol}
            balance={selectedBalancePrimary}
            cashflow={cardMetrics.netCashflow}
            outlook={cardMetrics.outlookNext7}
            spending={cardMetrics.expenseSum.negated()}
            income={cardMetrics.incomeSum}
            creditPct={cardMetrics.creditPct}
            debtPct={cardMetrics.debtPct}
          />
        )}

        {card.key === "recent_records" && (
          <RecentRecordsCard
            transactions={inPeriod(filteredTransactions, card.periodDays).slice(0, card.recordLimit || 5)}
            periodDays={card.periodDays}
            perspectiveAccountId={extraCtx.accounts.length === 1 ? extraCtx.accounts[0].id : undefined}
          />
        )}

        {card.key === "cashflow_table" && (
          <CashFlowTableCard
            primaryCode={primaryCode}
            primaryDecimals={primaryDecimals}
            periodDays={card.periodDays}
            metrics={cardMetrics}
          />
        )}

        {card.key === "charts" && (
          <ChartsCard
            primaryCode={primaryCode}
            barData={barData}
            trendData={trendData}
            loadingTrend={chartLoading}
          />
        )}

        {card.key === "budgets_goals" && (
          <BudgetsGoalsCard budgetRows={budgetRows.slice(0, card.recordLimit || 5)} />
        )}

        <ExtraCard card={card} ctx={extraCtx} />
      </DashboardCardShell>
    </div>
  );
});

// ============================================================================
// CARD SHELL WITH DRAG HANDLE & 3-DOT CONFIGURATION POPOVER
// ============================================================================

function DashboardCardShell({
  card,
  isFirst,
  isLast,
  configOpen,
  onToggleConfig,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRemove,
  onStartDrag,
  children,
}: {
  card: DashboardCardConfig;
  isFirst: boolean;
  isLast: boolean;
  configOpen: boolean;
  onToggleConfig: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (patch: Partial<DashboardCardConfig>) => void;
  onRemove: () => void;
  onStartDrag?: (e: React.PointerEvent) => void;
  children: React.ReactNode;
}) {
  const entry = CATALOG_BY_KEY.get(card.key);
  const span = card.span ?? entry?.defaultSpan ?? 1;
  const [resizeDragState, setResizeDragState] = useState<{
    isDragging: boolean;
    isRubberBanding: boolean;
    physics: EdgeResizeDragPhysics | null;
  }>({
    isDragging: false,
    isRubberBanding: false,
    physics: null,
  });

  const subtitle =
    card.key === "gauges"
      ? `Past ${card.periodDays} days performance, and outlook for next 7 days.`
      : entry?.usesPeriod
        ? `Last ${card.periodDays} days · ${entry.description}`
        : entry?.description;

  const rp = resizeDragState.physics;
  const resizeCssVars = rp
    ? ({
        "--resize-x": `${(rp.effectiveDx * 0.18).toFixed(1)}px`,
        "--resize-scale-x": String(rp.scaleX),
        "--resize-scale-y": String(rp.scaleY),
        "--resize-blur": `${rp.blurPx}px`,
        "--resize-content-blur": `${(rp.blurPx * 0.35).toFixed(1)}px`,
        "--resize-opacity": String(rp.opacity),
        "--resize-shadow": rp.shadow,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      style={resizeCssVars}
      className={cn(
        "resizable-bento-card h-full flex flex-col",
        resizeDragState.isDragging && "is-resizing",
        resizeDragState.isRubberBanding && "is-rubber-banding",
      )}
    >
    <Card className="relative flex flex-col gap-3 h-full">
      {/* Outside edge resizer (swipe left/right or click to expand/shrink card) */}
      <CardEdgeResizeHandle
        span={span as 1 | 2}
        onSetSpan={(nextSpan) => onUpdate({ span: nextSpan })}
        onToggleSpan={() => onUpdate({ span: span === 2 ? 1 : 2 })}
        onDragPhysicsChange={setResizeDragState}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="relative flex size-8 sm:size-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg active:cursor-grabbing touch-none select-none -m-1 p-1"
            style={{ touchAction: "none" }}
            title="Drag to reorder card"
            aria-label="Drag to reorder card"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.cancelable) {
                e.preventDefault();
              }
              onStartDrag?.(e);
            }}
          >
            <GripVertical className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold">{card.title}</h2>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ span: span === 2 ? 1 : 2 })}
            title={span === 2 ? "Shrink to 1 column (half width)" : "Expand to 2 columns (full width)"}
            aria-label="Toggle card width"
            className="hidden size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg lg:flex transition-colors"
          >
            {span === 2 ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleConfig}
            aria-label={`Configure ${card.title}`}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <MoreVertical className="size-4" />
          </button>
        </div>
      </div>

      {/* Animated Sliding Settings Drawer (Smooth accordion slide + generous select sizing) */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          configOpen ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0 pointer-events-none",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3 text-xs shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              {entry?.usesPeriod && (
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-muted">Period:</label>
                  <Select
                    value={String(card.periodDays)}
                    onChange={(e) => onUpdate({ periodDays: Number(e.target.value) as 7 | 30 | 90 })}
                    className="h-8 min-w-[145px] w-auto pl-2.5 pr-7 text-xs font-medium"
                  >
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                  </Select>
                </div>
              )}

              {entry?.usesLimit && (
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-muted">Rows:</label>
                  <Select
                    value={String(card.recordLimit)}
                    onChange={(e) => onUpdate({ recordLimit: Number(e.target.value) })}
                    className="h-8 min-w-[75px] w-auto pl-2.5 pr-6 text-xs font-medium"
                  >
                    <option value="5">5</option>
                    <option value="8">8</option>
                    <option value="12">12</option>
                  </Select>
                </div>
              )}

              <div className="hidden items-center gap-1.5 lg:flex">
                <label className="font-semibold text-muted">Width:</label>
                <Select
                  value={String(card.span ?? entry?.defaultSpan ?? 1)}
                  onChange={(e) => onUpdate({ span: Number(e.target.value) as 1 | 2 })}
                  className="h-8 min-w-[145px] w-auto pl-2.5 pr-7 text-xs font-medium"
                >
                  <option value="1">1 col (Half)</option>
                  <option value="2">2 cols (Full)</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" disabled={isFirst} onClick={onMoveUp}>
                <ArrowUp className="size-3.5" /> Up
              </Button>
              <Button variant="ghost" size="sm" disabled={isLast} onClick={onMoveDown}>
                <ArrowDown className="size-3.5" /> Down
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onUpdate({ visible: false })}>
                <EyeOff className="size-3.5" /> Hide
              </Button>
              <Button variant="ghost" size="sm" onClick={onRemove}>
                <Trash2 className="size-3.5 text-danger" /> Remove
              </Button>
            </div>
          </div>
        </div>
      </div>

      {entry?.usesPeriod ? (
        <SwipeableWidget
          activeIndex={card.periodDays === 7 ? 0 : card.periodDays === 30 ? 1 : 2}
          totalViews={3}
          viewLabels={["Last 7 days", "Last 30 days", "Last 90 days"]}
          onIndexChange={(idx) => {
            const periods: Array<7 | 30 | 90> = [7, 30, 90];
            const nextPeriod = periods[idx] ?? 30;
            onUpdate({ periodDays: nextPeriod });
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          <div key={`period-${card.periodDays}`} className="flex-1 flex flex-col min-h-0">
            {children}
          </div>
        </SwipeableWidget>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {children}
        </div>
      )}
    </Card>
    </div>
  );
}

// ============================================================================
// 1. MODERN FINANCIAL HEALTH METRIC CARDS & RADIAL METERS (No needles)
// ============================================================================

function RadialArcMeter({
  value,
  label,
  pct,
  tone = "primary",
  size = "md",
}: {
  value: React.ReactNode;
  label: string;
  pct: number;
  tone?: "primary" | "success" | "danger" | "warning";
  size?: "lg" | "md";
}) {
  const clampedPct = Math.max(0, Math.min(100, pct));
  const ratio = clampedPct / 100;
  // Semicircle arc: radius 40, center (50, 48)
  // Arc length = PI * 40 ≈ 125.66
  const arcLength = 125.66;
  const strokeOffset = arcLength * (1 - ratio);

  const strokeColors = {
    primary: "var(--primary)",
    success: "var(--success)",
    danger: "var(--danger)",
    warning: "var(--warning)",
  };

  return (
    <div className="flex flex-col items-center justify-center text-center min-w-0">
      <div className={cn("relative flex items-center justify-center", size === "lg" ? "w-24 h-16 sm:w-28 sm:h-18" : "w-20 h-14 sm:w-24 sm:h-16")}>
        <svg viewBox="0 0 100 56" className="w-full h-full overflow-visible">
          {/* Background Track */}
          <path
            d="M 10 48 A 40 40 0 0 1 90 48"
            fill="none"
            stroke="var(--border)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          {/* Active Animated Progress Arc */}
          <path
            d="M 10 48 A 40 40 0 0 1 90 48"
            fill="none"
            stroke={strokeColors[tone]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeOffset}
            style={{
              transition: "stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease",
            }}
          />
        </svg>
        {/* Value Inside Arc */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end">
          <span className={cn("tabular font-bold tracking-tight text-fg whitespace-nowrap max-w-full px-1", size === "lg" ? "text-sm sm:text-base" : "text-xs")}>
            {value}
          </span>
        </div>
      </div>
      <span className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap max-w-full">
        {label}
      </span>
    </div>
  );
}

const WalletGaugesCard = React.memo(function WalletGaugesCard({
  primaryCode,
  primaryDecimals,
  primarySymbol,
  balance,
  cashflow,
  outlook,
  spending,
  income,
  creditPct,
  debtPct,
}: {
  primaryCode: string;
  primaryDecimals: number;
  primarySymbol?: string | null;
  balance: Decimal;
  cashflow: Decimal;
  outlook: Decimal;
  spending: Decimal;
  income: Decimal;
  creditPct: number;
  debtPct: number;
}) {
  const spendingAmt = spending.abs();
  const savingsPct = income.gt(0)
    ? Math.round(cashflow.div(income).mul(100).toNumber())
    : cashflow.gte(0)
      ? 100
      : -100;
  const spendingRatio = income.gt(0)
    ? Math.min(100, Math.round(spendingAmt.div(income).mul(100).toNumber()))
    : spendingAmt.gt(0)
      ? 100
      : 0;

  // Compute dynamic needle positions (0 = far-left Red, 50 = center Yellow, 100 = far-right Green)
  const balanceNeedlePct = balance.gt(0)
    ? Math.min(96, 62 + Math.min(34, Math.log10(balance.toNumber() + 1) * 10))
    : balance.eq(0)
      ? 50
      : Math.max(8, 35 - Math.min(27, Math.log10(balance.abs().toNumber() + 1) * 10));

  const cashflowNeedlePct = cashflow.gt(0)
    ? Math.min(95, 55 + Math.min(40, Math.max(8, savingsPct * 0.4)))
    : cashflow.eq(0)
      ? 50
      : Math.max(8, 45 - Math.min(37, Math.max(10, Math.abs(savingsPct) * 0.35)));

  const outlookNeedlePct = outlook.gte(0) ? 78 : 28;
  const spendingNeedlePct = spendingAmt.eq(0) ? 85 : Math.max(12, 90 - spendingRatio * 0.75);
  const creditNeedlePct = Math.max(8, 92 - creditPct * 0.85);
  const debtNeedlePct = Math.max(8, 92 - debtPct * 0.85);

  // Proportional breakdown widths
  const totalFlow = Decimal.max(income, spendingAmt).toNumber() || 1;
  const incomeBarWidth = Math.min(100, Math.max(8, Math.round((income.toNumber() / totalFlow) * 100)));
  const spendingBarWidth = Math.min(100, Math.max(8, Math.round((spendingAmt.toNumber() / totalFlow) * 100)));

  return (
    <div className="flex flex-1 flex-col justify-between gap-4">
      <p className="text-[11px] text-muted -mt-1">
        Showing all amounts in base currency.
      </p>

      {/* 2 Primary Speedometer Needle Gauges: BALANCE & CASH-FLOW */}
      <div className="grid grid-cols-1 gap-3 @[720px]:grid-cols-2">
        {/* Liquid Balance Gauge Card */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-surface-2/40 p-3 sm:p-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap">
              Liquid Balance
            </span>
            <span className="tabular mt-0.5 text-lg sm:text-xl xl:text-2xl font-bold tracking-tight text-fg whitespace-nowrap">
              <AnimatedMoney
                amount={balance.toNumber()}
                code={primaryCode}
                decimals={primaryDecimals}
                symbol={primarySymbol}
              />
            </span>
            <span className="mt-0.5 text-[11px] text-muted leading-tight">
              Selected accounts total
            </span>
          </div>
          <div className="shrink-0 pl-1">
            <NeedleGauge
              size="lg"
              pct={balanceNeedlePct}
              label="BALANCE"
            />
          </div>
        </div>

        {/* Net Cash Flow Gauge Card */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-surface-2/40 p-3 sm:p-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap">
                Net Cash Flow
              </span>
              <Badge tone={cashflow.gte(0) ? "success" : "danger"} className="text-[10px] whitespace-nowrap">
                {cashflow.gte(0) ? `+${savingsPct}% saved` : `${savingsPct}% deficit`}
              </Badge>
            </div>
            <span className={cn("tabular mt-0.5 text-lg sm:text-xl xl:text-2xl font-bold tracking-tight whitespace-nowrap", cashflow.gte(0) ? "text-success" : "text-danger")}>
              <AnimatedMoney
                amount={cashflow.toNumber()}
                code={primaryCode}
                decimals={primaryDecimals}
                symbol={primarySymbol}
                signed
              />
            </span>
            <span className="mt-0.5 text-[11px] text-muted leading-tight">
              Income minus expenses (30d)
            </span>
          </div>
          <div className="shrink-0 pl-1">
            <NeedleGauge
              size="lg"
              pct={cashflowNeedlePct}
              label="CASH-FLOW"
            />
          </div>
        </div>
      </div>

      {/* 4 Secondary Speedometer Needle Gauges (OUTLOOK, SPENDING, CREDIT, DEBT) */}
      <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-border/80 bg-surface-2/20 p-3 sm:grid-cols-4">
        <NeedleGauge
          size="sm"
          pct={outlookNeedlePct}
          label="OUTLOOK"
          value={
            <AnimatedMoney
              amount={outlook.toNumber()}
              code={primaryCode}
              decimals={primaryDecimals}
              symbol={primarySymbol}
            />
          }
        />

        <NeedleGauge
          size="sm"
          pct={spendingNeedlePct}
          label="SPENDING"
          value={
            <AnimatedMoney
              amount={spendingAmt.negated().toNumber()}
              code={primaryCode}
              decimals={primaryDecimals}
              symbol={primarySymbol}
              signed
            />
          }
        />

        <NeedleGauge
          size="sm"
          pct={creditNeedlePct}
          label="CREDIT"
          value={<AnimatedNumber value={creditPct} suffix="%" />}
        />

        <NeedleGauge
          size="sm"
          pct={debtNeedlePct}
          label="DEBT"
          value={<AnimatedNumber value={debtPct} suffix="%" />}
        />
      </div>

      {/* Cash Flow Visual Proportional Bar */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-fg">Monthly Income vs Spending</span>
          <span className="text-muted">Ratio: {spendingRatio}% spent</span>
        </div>

        {/* Dual Proportional Track */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 gap-1 p-0.5">
          <div
            className="h-full rounded-full bg-success transition-all duration-700 ease-out"
            style={{ width: `${incomeBarWidth}%` }}
            title={`Income: ${formatMoney(income.toString(), primaryCode, primaryDecimals, primarySymbol)}`}
          />
          <div
            className="h-full rounded-full bg-danger transition-all duration-700 ease-out"
            style={{ width: `${spendingBarWidth}%` }}
            title={`Spending: ${formatMoney(spendingAmt.toString(), primaryCode, primaryDecimals, primarySymbol)}`}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" />
            <span className="text-muted">Earned:</span>
            <span className="font-semibold text-fg whitespace-nowrap">
              <Money amount={income.toString()} code={primaryCode} decimals={primaryDecimals} symbol={primarySymbol} skipCurrency />
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-danger" />
            <span className="text-muted">Spent:</span>
            <span className="font-semibold text-fg whitespace-nowrap">
              <Money amount={spendingAmt.toString()} code={primaryCode} decimals={primaryDecimals} symbol={primarySymbol} skipCurrency />
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            <span className="text-muted">Net:</span>
            <span className={cn("font-semibold whitespace-nowrap", cashflow.gte(0) ? "text-success" : "text-danger")}>
              <Money amount={cashflow.toString()} code={primaryCode} decimals={primaryDecimals} symbol={primarySymbol} signed skipCurrency />
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-0.5">
        <Link href="/transactions" className="font-semibold text-primary hover:underline flex items-center gap-1">
          Show more <ArrowRight className="size-3" aria-hidden />
        </Link>
        <span className="text-[11px] text-muted">
          Base: {primaryCode} · {primaryDecimals} decimals
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// 2. LAST RECORDS OVERVIEW CARD
// ============================================================================

const RecentRecordsCard = React.memo(function RecentRecordsCard({
  transactions,
  periodDays,
  perspectiveAccountId,
}: {
  transactions: Array<Resource<TransactionGroup>>;
  periodDays: number;
  perspectiveAccountId?: string;
}) {
  return (
    <div className="flex flex-1 flex-col justify-between gap-2">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Last {periodDays} days</p>
        {transactions.length === 0 ? (
          <EmptyState title="No matching records for selected accounts" />
        ) : (
          <ul className="divide-y divide-border">
            {transactions.map((g) => (
              <TransactionRow key={g.id} group={g} perspectiveAccountId={perspectiveAccountId} />
            ))}
          </ul>
        )}
      </div>
      <div className="pt-1">
        <Link
          href={perspectiveAccountId ? `/transactions?accountId=${perspectiveAccountId}` : "/transactions"}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
        >
          <span>Show more</span>
        </Link>
      </div>
    </div>
  );
});

// ============================================================================
// 3. CASH FLOW TABLE CARD (Count, Average Day, Average Record, Total, Cash Flow)
// ============================================================================

const CashFlowTableCard = React.memo(function CashFlowTableCard({
  primaryCode,
  primaryDecimals,
  periodDays,
  metrics,
}: {
  primaryCode: string;
  primaryDecimals: number;
  periodDays: number;
  metrics: {
    incomeCount: number;
    expenseCount: number;
    incomeSum: Decimal;
    expenseSum: Decimal;
    netCashflow: Decimal;
    avgIncomeDay: Decimal;
    avgExpenseDay: Decimal;
    avgIncomeRec: Decimal;
    avgExpenseRec: Decimal;
  };
}) {
  return (
    <div className="flex flex-1 flex-col justify-between gap-3">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Last {periodDays} days</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-1.5 text-left font-medium">Quick overview</th>
                <th className="py-1.5 text-right font-medium">Income</th>
                <th className="py-1.5 text-right font-medium text-danger">Expenses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular">
              <tr className="bg-surface-2/60">
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 font-medium">Count</td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right">
                  <AnimatedNumber value={metrics.incomeCount} />
                </td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right text-danger">
                  <AnimatedNumber value={metrics.expenseCount} />
                </td>
              </tr>
              <tr>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 font-medium">Average (Day)</td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right">
                  <Money animated amount={metrics.avgIncomeDay.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right text-danger">
                  -<Money animated amount={metrics.avgExpenseDay.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
              </tr>
              <tr className="bg-surface-2/60">
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 font-medium">Average (Record)</td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right">
                  <Money animated amount={metrics.avgIncomeRec.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right text-danger">
                  -<Money animated amount={metrics.avgExpenseRec.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
              </tr>
              <tr>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 font-semibold">Total</td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right font-semibold">
                  <Money animated amount={metrics.incomeSum.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
                <td className="px-1.5 py-1 sm:px-2 sm:py-1.5 text-right font-semibold text-danger">
                  -<Money animated amount={metrics.expenseSum.toString()} code={primaryCode} decimals={primaryDecimals} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <div className="flex items-baseline justify-end gap-3 text-sm">
          <span className="text-xs text-muted">Cash flow</span>
          <span className={cn("text-base font-bold", metrics.netCashflow.lt(0) ? "text-danger" : "text-fg")}>
            <Money animated amount={metrics.netCashflow.toString()} code={primaryCode} decimals={primaryDecimals} />
          </span>
        </div>

        <div>
          <Link href="/transactions" className="text-xs font-semibold text-primary hover:underline">
            Show more
          </Link>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// 4. CHARTS CARD (Income vs Expense & Balance Trend)
// ============================================================================

const ChartsCard = React.memo(function ChartsCard({
  primaryCode,
  barData,
  trendData,
  loadingTrend,
}: {
  primaryCode: string;
  barData: Array<{ name: string; Income: number; Expense: number }>;
  trendData: Array<{ date: string; Balance: number }>;
  loadingTrend: boolean;
}) {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <CardTitle>Income vs Expense (6 months · {primaryCode})</CardTitle>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                }}
              />
              <Bar dataKey="Income" fill="var(--success)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
              <Bar dataKey="Expense" fill="var(--danger)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <CardTitle>Balance Trend (selected accounts)</CardTitle>
        {loadingTrend ? (
          <Skeleton className="h-56 w-full" />
        ) : trendData.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted">No chart data available</div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    borderColor: "var(--border)",
                    borderRadius: "0.75rem",
                    fontSize: "0.875rem",
                  }}
                />
                <Area type="monotone" dataKey="Balance" stroke="var(--primary)" strokeWidth={2} fill="url(#balFill)" isAnimationActive animationDuration={900} animationEasing="ease-out" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// 5. BUDGETS & GOALS CARD
// ============================================================================

const BudgetsGoalsCard = React.memo(function BudgetsGoalsCard({
  budgetRows,
}: {
  budgetRows: Array<{ id: string; name: string; spent: number; limit: number; code: string; decimals?: number }>;
}) {
  if (budgetRows.length === 0) {
    return (
      <EmptyState title="No active budgets this month">
        <Link href="/budgets" className="text-primary hover:underline">
          Set up a monthly budget
        </Link>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-1 flex-col justify-between gap-3">
      <div className="flex flex-col divide-y divide-border/60">
        {budgetRows.map((b) => {
          const pct = b.limit > 0 ? Math.min(100, Math.round((b.spent / b.limit) * 100)) : 0;
          const isTrendingOver = pct >= 80;
          return (
            <Link
              key={b.id}
              href="/budgets"
              className="group flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 hover:opacity-90 transition-opacity"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-fg group-hover:text-primary transition-colors">{b.name}</span>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                  <Money amount={b.spent} code={b.code} decimals={b.decimals} />
                  {b.limit > 0 && (
                    <>
                      <span>/</span>
                      <Money amount={b.limit} code={b.code} decimals={b.decimals} />
                    </>
                  )}
                  <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
                </span>
              </div>
              {b.limit > 0 && (
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      isTrendingOver ? "bg-warning" : "bg-success",
                    )}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border/60 pt-2.5">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-success" aria-hidden="true" />
            <span>On Track</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-warning" aria-hidden="true" />
            <span>Trending Over</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Link
            href="/budgets"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
          >
            <span>Show more</span>
          </Link>
          <Link
            href="/budgets"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-fg hover:bg-surface-3 transition active:scale-95"
          >
            <span>Create budget</span>
          </Link>
        </div>
      </div>
    </div>
  );
});
