"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Filter, Plus, RotateCcw, Search } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Resource, TransactionGroup } from "@/lib/firefly/types";
import { ASSET_LIKE, useAccounts } from "@/lib/hooks";
import { monthRange, parseAmount } from "@/lib/utils";
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
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { DesktopStickyFilterBar } from "@/components/filter-bar-desktop";
import { MobileFilterDock } from "@/components/filter-dock-mobile";
import { useUniversalFilter, type AccountFilterMode } from "@/lib/filter-context";
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

      <Card>
        {txQ.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title="No matching transactions">
            {hasActiveFilters ? "Try adjusting or resetting your filters." : "Create your first transaction to get started."}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {groups.map((g) => (
                <TransactionRow
                  key={g.id}
                  group={g}
                  onEdit={(item) => setEditingGroup(item)}
                  onDelete={(id) => delMut.mutate(id)}
                />
              ))}
            </ul>
            <div ref={sentinelRef} className="mt-4 flex justify-center">
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
