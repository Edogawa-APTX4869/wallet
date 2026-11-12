"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Check, ChevronLeft, ChevronRight, Filter, Plus, RotateCcw, Search, X } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Resource, TransactionGroup } from "@/lib/firefly/types";
import { ASSET_LIKE, useAccounts, usePrimaryCurrency } from "@/lib/hooks";
import { cn, monthRange, parseAmount } from "@/lib/utils";
import { CategoryCascadeSelect } from "@/components/category-cascade";
import { TransactionRow } from "@/components/transaction-row";
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  ModalSheet,
  Money,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { DesktopStickyFilterBar } from "@/components/filter-bar-desktop";
import { MobileFilterDock } from "@/components/filter-dock-mobile";
import { useUniversalFilter, type AccountFilterMode } from "@/lib/filter-context";
import { type PeriodPreset } from "@/lib/filter-presets";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

export interface Filters {
  text: string;
  type: "" | "withdrawal" | "deposit" | "transfer";
  accountId: string;
  category: string;
  tag: string;
  budget: string;
  dateAfter: string;
  dateBefore: string;
  amountMore: string;
  amountLess: string;
}

export const EMPTY_FILTERS: Filters = {
  text: "",
  type: "",
  accountId: "",
  category: "",
  tag: "",
  budget: "",
  dateAfter: "",
  dateBefore: "",
  amountMore: "",
  amountLess: "",
};

function quoteIfNeeded(val: string): string {
  const trimmed = val.trim().replace(/"/g, "");
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

export interface UniversalFilterScope {
  startDate?: string;
  endDate?: string;
  accountFilter?: AccountFilterMode;
  selectedAccountIds?: string[];
}

export function buildSearchQuery(f: Filters, universal?: UniversalFilterScope): string {
  const parts: string[] = [];
  if (f.type) parts.push(`type:${f.type}`);

  if (f.accountId) {
    parts.push(`account_id:${f.accountId}`);
  } else if (universal) {
    if (universal.accountFilter === "custom" && universal.selectedAccountIds && universal.selectedAccountIds.length > 0) {
      if (universal.selectedAccountIds.length === 1) {
        parts.push(`account_id:${universal.selectedAccountIds[0]}`);
      } else {
        const joined = universal.selectedAccountIds.map((id) => `account_id:${id}`).join(" OR ");
        parts.push(`(${joined})`);
      }
    }
  }

  if (f.category.trim()) parts.push(`category_is:${quoteIfNeeded(f.category)}`);
  if (f.tag.trim()) parts.push(`tag_is:${quoteIfNeeded(f.tag)}`);
  if (f.budget.trim()) parts.push(`budget_is:${quoteIfNeeded(f.budget)}`);

  const dateAfter = f.dateAfter || universal?.startDate;
  const dateBefore = f.dateBefore || universal?.endDate;

  if (dateAfter) parts.push(`date_after:${dateAfter}`);
  if (dateBefore) parts.push(`date_before:${dateBefore}`);
  if (f.amountMore.trim()) parts.push(`amount_more:${f.amountMore.trim()}`);
  if (f.amountLess.trim()) parts.push(`amount_less:${f.amountLess.trim()}`);
  if (f.text.trim()) parts.push(f.text.trim());
  return parts.join(" ");
}

export function filtersFromParams(get: (key: string) => string | null): Filters {
  const rawType = get("type");
  const validType: Filters["type"] =
    rawType === "withdrawal" || rawType === "deposit" || rawType === "transfer" ? rawType : "";
  return {
    ...EMPTY_FILTERS,
    type: validType,
    text: get("query") ?? "",
    category: get("category") ?? "",
    accountId: get("accountId") ?? "",
    tag: get("tag") ?? "",
    budget: get("budget") ?? "",
  };
}

export function TransactionsClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const searchParams = useSearchParams();
  const paramKey = searchParams.toString();
  const universalFilter = useUniversalFilter();

  const [filters, setFilters] = useState<Filters>(() => filtersFromParams((k) => searchParams.get(k)));
  const [prevParamKey, setPrevParamKey] = useState(paramKey);
  if (paramKey !== prevParamKey) {
    setPrevParamKey(paramKey);
    setFilters(filtersFromParams((k) => searchParams.get(k)));
  }

  const [showFilters, setShowFilters] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Resource<TransactionGroup> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEscapeDismiss(showFilters, () => setShowFilters(false), "transactions-filters", { hidesChrome: true });

  const accountsQ = useAccounts("all");
  const month = useMemo(() => monthRange(0), []);
  const categoriesQ = useQuery({ queryKey: ["categories-list"], queryFn: () => api.categories(), staleTime: 5 * 60_000 });
  const tagsQ = useQuery({ queryKey: ["tags-list"], queryFn: api.tags, staleTime: 5 * 60_000 });
  const budgetsQ = useQuery({
    queryKey: ["budgets-list"],
    queryFn: () => api.budgets(month.start, month.end),
    staleTime: 5 * 60_000,
  });

  const searchQuery = useMemo(
    () =>
      buildSearchQuery(filters, {
        startDate: universalFilter.startDate,
        endDate: universalFilter.endDate,
        accountFilter: universalFilter.accountFilter,
        selectedAccountIds: universalFilter.selectedAccountIds,
      }),
    [
      filters,
      universalFilter.startDate,
      universalFilter.endDate,
      universalFilter.accountFilter,
      universalFilter.selectedAccountIds,
    ],
  );

  const hasUniversalFilters =
    universalFilter.preset !== "this_month" ||
    universalFilter.accountFilter !== "all_stats" ||
    universalFilter.selectedAccountIds.length > 0;
  const hasActiveFilters = searchQuery.length > 0 || hasUniversalFilters;

  const txQ = useInfiniteQuery({
    queryKey: ["transactions", "list", searchQuery],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchQuery ? api.searchTransactions(searchQuery, pageParam) : api.transactions(pageParam),
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      return p && p.current_page < p.total_pages ? p.current_page + 1 : undefined;
    },
  });

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !txQ.hasNextPage || txQ.isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) txQ.fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [txQ]);

  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteTransaction(id),
    onSuccess: () => {
      toast("Transaction deleted", "info");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const rawGroups = useMemo(() => txQ.data?.pages.flatMap((p) => p.data) ?? [], [txQ.data]);
  const groups = useMemo(() => {
    if (universalFilter.accountFilter !== "all_stats") return rawGroups;
    const excludedAccountIds = new Set(
      (accountsQ.data ?? [])
        .filter((a) => a.attributes.include_net_worth === false)
        .map((a) => a.id),
    );
    if (excludedAccountIds.size === 0) return rawGroups;
    return rawGroups.filter((g) => {
      const splits = g.attributes.transactions;
      if (!splits || splits.length === 0) return true;
      const allExcluded = splits.every(
        (s) =>
          (s.source_id && excludedAccountIds.has(s.source_id)) ||
          (s.destination_id && excludedAccountIds.has(s.destination_id)),
      );
      return !allExcluded;
    });
  }, [rawGroups, universalFilter.accountFilter, accountsQ.data]);

  const assetAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((a) => ASSET_LIKE.has(a.attributes.type)),
    [accountsQ.data],
  );
  const primaryQ = usePrimaryCurrency();
  const primaryCode = primaryQ.data?.code ?? "BHD";
  const primaryDecimals = primaryQ.data?.decimal_places ?? 3;

  const perspectiveAccountId = useMemo(() => {
    if (filters.accountId) return filters.accountId;
    if (universalFilter.accountFilter === "custom" && universalFilter.selectedAccountIds.length === 1) {
      return universalFilter.selectedAccountIds[0];
    }
    return undefined;
  }, [filters.accountId, universalFilter.accountFilter, universalFilter.selectedAccountIds]);

  const activeAccountObj = useMemo(() => {
    if (!perspectiveAccountId) return null;
    return (accountsQ.data ?? []).find((a) => a.id === perspectiveAccountId) ?? null;
  }, [accountsQ.data, perspectiveAccountId]);

  const summaryCurrencyCode = activeAccountObj?.attributes.currency_code || primaryCode;
  const summaryDecimals = activeAccountObj?.attributes.currency_decimal_places ?? primaryDecimals;

  // Compute signed net impact of a transaction group (from perspectiveAccountId or overall cash flow)
  const { monthlySections, periodTotalSum } = useMemo(() => {
    const sectionsMap = new Map<
      string,
      { key: string; label: string; sum: Decimal; items: Array<Resource<TransactionGroup>> }
    >();
    let grandTotal = new Decimal(0);

    for (const g of groups) {
      const s = g.attributes.transactions[0];
      const rawDate = (s?.date || "").slice(0, 10);
      const ymKey = rawDate.length >= 7 ? rawDate.slice(0, 7) : "unknown";
      let monthLabel = "RECENT";
      if (ymKey !== "unknown") {
        const [yStr, mStr] = ymKey.split("-");
        const dObj = new Date(Number(yStr), Math.max(0, Number(mStr) - 1), 1);
        monthLabel = dObj
          .toLocaleDateString("en-US", { month: "short", year: "numeric" })
          .toUpperCase();
      }

      let groupDelta = new Decimal(0);
      for (const split of g.attributes.transactions) {
        let amt = new Decimal(0);
        try {
          amt = new Decimal(split.amount || 0).abs();
        } catch {
          amt = new Decimal(0);
        }

        if (perspectiveAccountId) {
          if (split.type === "deposit" && (split.destination_id === perspectiveAccountId || !split.destination_id)) {
            groupDelta = groupDelta.plus(amt);
          } else if (split.type === "withdrawal" && split.source_id === perspectiveAccountId) {
            groupDelta = groupDelta.minus(amt);
          } else if (split.type === "transfer") {
            if (split.destination_id === perspectiveAccountId) {
              let destAmt = amt;
              if (split.foreign_amount && split.foreign_amount.trim()) {
                try {
                  destAmt = new Decimal(split.foreign_amount.trim()).abs();
                } catch {
                  destAmt = amt;
                }
              }
              groupDelta = groupDelta.plus(destAmt);
            }
            if (split.source_id === perspectiveAccountId) {
              groupDelta = groupDelta.minus(amt);
            }
          }
        } else {
          if (split.type === "deposit") {
            groupDelta = groupDelta.plus(amt);
          } else if (split.type === "withdrawal") {
            groupDelta = groupDelta.minus(amt);
          }
        }
      }

      grandTotal = grandTotal.plus(groupDelta);
      const existing = sectionsMap.get(ymKey);
      if (existing) {
        existing.sum = existing.sum.plus(groupDelta);
        existing.items.push(g);
      } else {
        sectionsMap.set(ymKey, {
          key: ymKey,
          label: monthLabel,
          sum: groupDelta,
          items: [g],
        });
      }
    }

    return {
      monthlySections: [...sectionsMap.values()],
      periodTotalSum: grandTotal,
    };
  }, [groups, perspectiveAccountId]);

  return (
    <div className="flex flex-col gap-5">
      {/* Desktop Sticky Universal Filter Bar */}
      <DesktopStickyFilterBar />

      {/* Mobile Floating Universal Filter Dock */}
      <MobileFilterDock />

      <PageHeader
        title="Transactions"
        subtitle={
          hasActiveFilters
            ? `Period: ${universalFilter.displayLabel}${searchQuery ? ` • ${searchQuery}` : ""}`
            : `${universalFilter.displayLabel} transactions`
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowFilters((s) => !s)}>
              <Filter className="size-4" aria-hidden /> Filters
            </Button>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  universalFilter.resetFilters();
                }}
              >
                <RotateCcw className="size-4" aria-hidden /> Reset
              </Button>
            )}
            <Link href="/new?type=withdrawal">
              <Button size="sm">
                <Plus className="size-4" aria-hidden /> New
              </Button>
            </Link>
          </>
        }
      />

      {/* Quick search bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={filters.text}
            onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            placeholder="Search description or Firefly query keywords…"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Filter by transaction type"
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))}
          className="w-40"
        >
          <option value="">All types</option>
          <option value="withdrawal">Expenses</option>
          <option value="deposit">Income</option>
          <option value="transfer">Transfers</option>
        </Select>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-3.5 sm:grid-cols-2 lg:grid-cols-4 shadow-2xs">
          <Field label="Account">
            {(id) => (
              <Select
                id={id}
                value={filters.accountId}
                onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value }))}
              >
                <option value="">Any account</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.attributes.name} ({a.attributes.currency_code})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="sm:col-span-2">
            <CategoryCascadeSelect
              categories={categoriesQ.data}
              value={filters.category}
              onChange={(category) => setFilters((f) => ({ ...f, category }))}
              allowCreate={false}
            />
          </div>

          <Field label="Budget">
            {(id) => (
              <Select
                id={id}
                value={filters.budget}
                onChange={(e) => setFilters((f) => ({ ...f, budget: e.target.value }))}
              >
                <option value="">Any budget</option>
                {budgetsQ.data?.map((b) => (
                  <option key={b.id} value={b.attributes.name}>
                    {b.attributes.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Tag">
            {(id) => (
              <Select
                id={id}
                value={filters.tag}
                onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
              >
                <option value="">Any tag</option>
                {tagsQ.data?.map((t) => (
                  <option key={t.id} value={t.attributes.tag}>
                    {t.attributes.tag}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Date from">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={filters.dateAfter}
                onChange={(e) => setFilters((f) => ({ ...f, dateAfter: e.target.value }))}
              />
            )}
          </Field>

          <Field label="Date to">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={filters.dateBefore}
                onChange={(e) => setFilters((f) => ({ ...f, dateBefore: e.target.value }))}
              />
            )}
          </Field>

          <Field label="Min amount">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="0.00"
                value={filters.amountMore}
                onChange={(e) => setFilters((f) => ({ ...f, amountMore: e.target.value }))}
              />
            )}
          </Field>

          <Field label="Max amount">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="1000.00"
                value={filters.amountLess}
                onChange={(e) => setFilters((f) => ({ ...f, amountLess: e.target.value }))}
              />
            )}
          </Field>
        </div>
      )}

      <ErrorBox error={txQ.error} />

      {/* Active Account Filter Pill (when navigated from Home or filtered by a single account) */}
      {activeAccountObj && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary-soft/15 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted">Account filter:</span>
            <Link
              href={`/accounts/${activeAccountObj.id}`}
              className="font-bold text-primary hover:underline"
            >
              {activeAccountObj.attributes.name}
            </Link>
            <span className="text-muted">({activeAccountObj.attributes.currency_code})</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFilters((f) => ({ ...f, accountId: "" }));
              if (universalFilter.accountFilter === "custom") {
                universalFilter.setAccountFilter("all_stats", []);
              }
            }}
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-fg hover:bg-surface-2 transition cursor-pointer"
          >
            <X className="size-3" aria-hidden="true" />
            <span>Show all accounts</span>
          </button>
        </div>
      )}

      {/* BudgetBakers Wallet-Style Top Period Summary Strip */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/60 px-4 py-2.5 text-xs sm:text-sm">
        <span className="font-bold uppercase tracking-wider text-muted">
          {universalFilter.displayLabel}
        </span>
        <span
          className={cn(
            "tabular font-mono font-bold",
            periodTotalSum.gt(0)
              ? "text-success"
              : periodTotalSum.lt(0)
                ? "text-danger"
                : "text-fg",
          )}
        >
          <span className="mr-1.5 text-muted font-sans">Σ</span>
          <Money
            amount={periodTotalSum.toString()}
            code={summaryCurrencyCode}
            decimals={summaryDecimals}
            signed
          />
        </span>
      </div>

      <Card className="p-0 overflow-hidden">
        {txQ.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : groups.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No matching transactions">
              {hasActiveFilters ? "Try adjusting or resetting your filters." : "Create your first transaction to get started."}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-border">
              {monthlySections.map((sec) => (
                <div key={sec.key} className="flex flex-col">
                  {/* Monthly Section Header (e.g., NOV 2026 | -BHD 1,110.00) */}
                  <div className="flex items-center justify-between bg-surface-2/70 px-4 py-2 text-xs border-b border-border/60">
                    <span className="font-bold uppercase tracking-wider text-muted">
                      {sec.label}
                    </span>
                    <span
                      className={cn(
                        "tabular font-mono font-semibold",
                        sec.sum.gt(0)
                          ? "text-success"
                          : sec.sum.lt(0)
                            ? "text-danger"
                            : "text-muted",
                      )}
                    >
                      <Money
                        amount={sec.sum.toString()}
                        code={summaryCurrencyCode}
                        decimals={summaryDecimals}
                        signed
                      />
                    </span>
                  </div>

                  <ul className="divide-y divide-border px-3 sm:px-4">
                    {sec.items.map((g) => (
                      <TransactionRow
                        key={g.id}
                        group={g}
                        perspectiveAccountId={perspectiveAccountId}
                        onEdit={(item) => setEditingGroup(item)}
                        onDelete={(id) => delMut.mutate(id)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div ref={sentinelRef} className="p-4 flex justify-center">
              {txQ.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={txQ.isFetchingNextPage}
                  onClick={() => txQ.fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      {/* BudgetBakers Wallet-Style Bottom Period Navigator Bar (◀ [ This month / This year ▼ ] ▶) */}
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4 z-20 flex items-center justify-between gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => universalFilter.stepPeriod(-1)}
          aria-label="Previous period"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg hover:bg-surface-3 transition active:scale-95 cursor-pointer"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2">
          <Select
            aria-label="Select period preset"
            value={universalFilter.preset}
            onChange={(e) => universalFilter.setPreset(e.target.value as PeriodPreset)}
            className="h-9 min-w-[155px] rounded-xl border-border bg-surface-2 px-3 text-center text-xs sm:text-sm font-semibold"
          >
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="30D">Last 30 days</option>
            <option value="6M">Last 6 months</option>
            <option value="this_year">This year</option>
            <option value="1Y">Last 12 months</option>
            {universalFilter.preset === "custom" && (
              <option value="custom">{universalFilter.displayLabel}</option>
            )}
          </Select>
        </div>

        <button
          type="button"
          onClick={() => universalFilter.stepPeriod(1)}
          aria-label="Next period"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg hover:bg-surface-3 transition active:scale-95 cursor-pointer"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      {editingGroup && (
        <EditTransactionModal
          key={editingGroup.id}
          group={editingGroup}
          categories={categoriesQ.data}
          budgets={budgetsQ.data}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

function EditTransactionModal({
  group,
  categories,
  budgets,
  onClose,
}: {
  group: Resource<TransactionGroup>;
  categories?: Awaited<ReturnType<typeof api.categories>>;
  budgets?: Awaited<ReturnType<typeof api.budgets>>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 240);
  };
  const first = group.attributes.transactions[0];

  const [description, setDescription] = useState(first?.description ?? "");
  const [amount, setAmount] = useState(() => String(Math.abs(Number(first?.amount ?? 0))));
  const [date, setDate] = useState(() => (first?.date ?? "").slice(0, 10));
  const [category, setCategory] = useState(first?.category_name ?? "");
  const [budgetId, setBudgetId] = useState(first?.budget_id ?? "");
  const [tags, setTags] = useState(() => (first?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(first?.notes ?? "");

  const updateMut = useMutation({
    mutationFn: async () => {
      const parsedAmt = parseAmount(amount);
      if (!parsedAmt || Number(parsedAmt) <= 0) throw new Error("Enter a valid amount greater than zero.");
      return api.updateTransaction(group.id, [
        {
          transaction_journal_id: first?.transaction_journal_id,
          type: (first?.type === "deposit" || first?.type === "transfer" ? first.type : "withdrawal") as
            | "withdrawal"
            | "deposit"
            | "transfer",
          description: description.trim() || first?.description || "Transaction",
          amount: parsedAmt,
          date: date || first?.date || "",
          category_name: category.trim() || undefined,
          budget_id: first?.type === "withdrawal" && budgetId ? budgetId : undefined,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          notes: notes.trim() || undefined,
        },
      ]);
    },
    onSuccess: () => {
      toast("Transaction updated", "success");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      handleClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  if (!first) return null;

  return (
    <ModalSheet
      open={open}
      onClose={handleClose}
      title="Edit Transaction"
      subtitle={`${first.source_name ?? ""} → ${first.destination_name ?? ""} (${first.currency_code ?? ""})`}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Description">
            {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field label={`Amount (${first.currency_code ?? ""})`}>
            {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>

        <CategoryCascadeSelect categories={categories} value={category} onChange={setCategory} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>

          {first.type === "withdrawal" && (
            <Field label="Budget">
              {(id) => (
                <Select id={id} value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                  <option value="">No budget</option>
                  {budgets
                    ?.filter((b) => b.attributes.active)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.attributes.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <Field label="Tags (comma-separated)">
          {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Field>

        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={() => updateMut.mutate()} loading={updateMut.isPending}>
            <Check className="size-4" aria-hidden /> Save changes
          </Button>
        </div>
      </div>
    </ModalSheet>
  );
}
