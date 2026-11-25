"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  PlusCircle,
  Settings2,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import { companionFetch } from "@/lib/offline-sync";
import type { DashboardPreferences } from "@/lib/dashboard-cards";
import { categoriesForBudget, resolveEffectiveCategoryBudgetMap } from "@/lib/category-budget-links";
import type { Budget, Resource } from "@/lib/firefly/types";
import {
  formatBudgetAmountInput,
  paddedBudgetLimitRange,
  resolveBudgetPeriodRow,
  type BudgetPeriodRow,
} from "@/lib/budget-periods";
import { useCurrencies, usePrimaryCurrency } from "@/lib/hooks";
import { cn, isoDate, monthRange, parseAmount, sumDecimal } from "@/lib/utils";
import { ResourceIconBadge } from "@/components/resource-icon";
import { BudgetConfigModal } from "@/components/budget-config-modal";
import { BudgetAdjustModal } from "@/components/budget-adjust-modal";
import { BudgetTransferModal } from "@/components/budget-transfer-modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  ModalSheet,
  Money,
  PageHeader,
  Progress,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

export function BudgetsClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [monthOffset, setMonthOffset] = useState(0);
  const range = useMemo(() => monthRange(monthOffset), [monthOffset]);
  const paddedRange = useMemo(
    () => paddedBudgetLimitRange(range.start, range.end),
    [range.start, range.end],
  );
  const primaryQ = usePrimaryCurrency();
  const currenciesQ = useCurrencies();

  const budgetsQ = useQuery({
    queryKey: ["budgets", range.start, range.end],
    queryFn: () => api.budgets(range.start, range.end),
  });
  const limitsQ = useQuery({
    queryKey: ["budget-limits", paddedRange.start, paddedRange.end],
    queryFn: () => api.budgetLimits(paddedRange.start, paddedRange.end),
  });
  const budgetTxQ = useQuery({
    queryKey: ["transactions", "budget-range", paddedRange.start, paddedRange.end],
    queryFn: () => api.transactionsInRange(paddedRange.start, paddedRange.end, "withdrawal"),
    staleTime: 60_000,
  });
  const availableBudgetsQ = useQuery({
    queryKey: ["available-budgets", range.start, range.end],
    queryFn: () => api.availableBudgets(range.start, range.end),
  });
  const dashboardPrefsQ = useQuery({
    queryKey: ["dashboard-prefs"],
    queryFn: async () => {
      try {
        const json = await companionFetch<{ data?: DashboardPreferences }>("/api/companion/dashboard");
        return json.data ?? null;
      } catch {
        return null as DashboardPreferences | null;
      }
    },
    staleTime: 60_000,
  });
  const categoryBudgetMap = resolveEffectiveCategoryBudgetMap(
    dashboardPrefsQ.data?.categoryBudgetMap,
  );

  const [newName, setNewName] = useState("");
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [editingSliceId, setEditingSliceId] = useState<string | null>(null);
  const [limitAmount, setLimitAmount] = useState("");
  const [editLimitError, setEditLimitError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configBudget, setConfigBudget] = useState<Resource<Budget> | null>(null);
  const [configInitialName, setConfigInitialName] = useState("");
  const [adjustRow, setAdjustRow] = useState<BudgetPeriodRow | null>(null);
  const [transferState, setTransferState] = useState<{
    open: boolean;
    sourceId: string | null;
    destId: string | null;
  }>({ open: false, sourceId: null, destId: null });
  const [editingAvail, setEditingAvail] = useState(false);
  const [availAmount, setAvailAmount] = useState("");

  useEscapeDismiss(editingAvail, () => setEditingAvail(false), "available-budget-edit");

  const createMut = useMutation({
    mutationFn: async () => {
      const name = newName.trim();
      if (!name) throw new Error("Enter a budget name.");
      return api.createBudget(name);
    },
    onSuccess: () => {
      toast("Budget created");
      setNewName("");
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets-list"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const limitMut = useMutation({
    mutationFn: async ({
      budgetId,
      limitId,
      limitStart,
      limitEnd,
      amount,
      currencyCode,
      decimals,
    }: {
      budgetId: string;
      limitId: string | null;
      limitStart?: string;
      limitEnd?: string;
      amount: string;
      currencyCode?: string;
      decimals?: number;
    }) => {
      const parsed = parseAmount(amount);
      if (!parsed || new Decimal(parsed).lte(0)) throw new Error("Enter a valid limit amount greater than 0.");
      const formattedAmount = formatBudgetAmountInput(parsed, decimals) || parsed;
      return api.upsertBudgetLimit({
        budgetId,
        limitId,
        amount: formattedAmount,
        start: (limitStart || range.start).slice(0, 10),
        end: (limitEnd || range.end).slice(0, 10),
        currency_code: currencyCode || primaryQ.data?.code,
      });
    },
    onSuccess: async () => {
      toast("Budget limit updated");
      setEditingLimitId(null);
      setEditingSliceId(null);
      setLimitAmount("");
      setEditLimitError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["budget-limits"] }),
        qc.invalidateQueries({ queryKey: ["budgets"] }),
        qc.invalidateQueries({ queryKey: ["budgets-list"] }),
        qc.invalidateQueries({ queryKey: ["available-budgets"] }),
      ]);
    },
    onError: (e) => {
      const msg = (e as Error).message || "Failed to update budget limit.";
      setEditLimitError(msg);
      toast(msg, "error");
    },
  });

  const defaultCode = primaryQ.data?.code || "USD";
  const defaultDecimals = primaryQ.data?.decimal_places;

  const currencyDecimalsByCode = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of currenciesQ.data ?? []) {
      if (c.attributes.code && typeof c.attributes.decimal_places === "number") {
        map[c.attributes.code.toUpperCase()] = c.attributes.decimal_places;
      }
    }
    if (primaryQ.data?.code && typeof primaryQ.data.decimal_places === "number") {
      map[primaryQ.data.code.toUpperCase()] = primaryQ.data.decimal_places;
    }
    return map;
  }, [currenciesQ.data, primaryQ.data]);

  const availEntry = useMemo(() => {
    const list = availableBudgetsQ.data ?? [];
    return list.find((a) => a.attributes.currency_code === defaultCode) ?? list[0] ?? null;
  }, [availableBudgetsQ.data, defaultCode]);

  const availMut = useMutation({
    mutationFn: async (amount: string) => {
      const parsed = parseAmount(amount);
      if (!parsed || new Decimal(parsed).lt(0)) throw new Error("Enter a valid available budget amount.");
      if (new Decimal(parsed).eq(0) && availEntry) {
        await api.deleteAvailableBudget(availEntry.id);
        return;
      }
      if (availEntry) {
        return api.updateAvailableBudget(availEntry.id, {
          amount: parsed,
          start: range.start,
          end: range.end,
          currency_code: availEntry.attributes.currency_code || defaultCode,
        });
      }
      return api.setAvailableBudget({
        amount: parsed,
        start: range.start,
        end: range.end,
        currency_code: defaultCode,
      });
    },
    onSuccess: () => {
      toast("Available budget updated");
      setEditingAvail(false);
      setAvailAmount("");
      qc.invalidateQueries({ queryKey: ["available-budgets"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const rows: BudgetPeriodRow[] = useMemo(() => {
    const budgets = budgetsQ.data ?? [];
    const limits = limitsQ.data ?? [];
    const transactions = budgetTxQ.data;
    const today = isoDate();
    return budgets.map((b) =>
      resolveBudgetPeriodRow({
        budget: b,
        limits,
        rangeStart: range.start,
        rangeEnd: range.end,
        today,
        defaultCode,
        defaultDecimals,
        currencyDecimalsByCode,
        transactions,
      }),
    );
  }, [
    budgetsQ.data,
    limitsQ.data,
    budgetTxQ.data,
    range.start,
    range.end,
    defaultCode,
    defaultDecimals,
    currencyDecimalsByCode,
  ]);

  const summary = useMemo(() => {
    const summaryCode = availEntry?.attributes.currency_code || defaultCode;
    const primaryRows = rows.filter((r) => r.code === summaryCode);
    const activeRows = primaryRows.length > 0 ? primaryRows : rows;
    const totalBudgeted = sumDecimal(activeRows.map((r) => r.monthLimit ?? r.limit));
    const totalSpent = sumDecimal(activeRows.map((r) => r.monthSpent ?? r.spent));
    const totalRemaining = totalBudgeted.minus(totalSpent);
    const availablePool = availEntry ? new Decimal(availEntry.attributes.amount || 0) : null;
    const unallocated = availablePool ? availablePool.minus(totalBudgeted) : null;
    const overspentRow = rows.find((r) => r.left.lt(0) || Boolean(r.monthLeft?.lt(0))) ?? null;
    return {
      code: summaryCode,
      decimals:
        availEntry?.attributes.currency_decimal_places ??
        currencyDecimalsByCode[summaryCode.toUpperCase()] ??
        defaultDecimals,
      totalBudgeted,
      totalSpent,
      totalRemaining,
      availablePool,
      unallocated,
      overspentRow,
    };
  }, [rows, availEntry, defaultCode, defaultDecimals, currencyDecimalsByCode]);

  const openInlineLimitEditor = (row: BudgetPeriodRow, targetSliceId?: string | null) => {
    const slices = row.periodLimits ?? [];
    const selectedSlice =
      (targetSliceId ? slices.find((s) => s.id === targetSliceId) : null) ??
      slices.find(
        (s) =>
          s.id === row.limitId ||
          (row.limitId === null && s.start === row.limitStart && s.end === row.limitEnd),
      ) ??
      slices[0] ??
      null;
    const seedRaw =
      selectedSlice && selectedSlice.amount.gt(0)
        ? selectedSlice.amount
        : selectedSlice && selectedSlice.amount.eq(0) && row.autoBudgetAmount
          ? row.autoBudgetAmount
          : row.limit.gt(0)
            ? row.limit
            : row.autoBudgetAmount ?? 0;
    const seed = new Decimal(seedRaw || 0);
    const dec = selectedSlice?.decimals ?? row.decimals;
    setEditingLimitId(row.id);
    setEditingSliceId(selectedSlice?.id ?? null);
    setLimitAmount(seed.gt(0) ? formatBudgetAmountInput(seed, dec) : "");
    setEditLimitError(null);
  };

  const closeLimitEditor = () => {
    setEditingLimitId(null);
    setEditingSliceId(null);
    setEditLimitError(null);
  };

  const editRow = editingLimitId ? rows.find((r) => r.id === editingLimitId) ?? null : null;
  const editSlices = editRow?.periodLimits ?? [];
  const editSlice = editRow
    ? editSlices.find((s) => s.id === editingSliceId) ??
      editSlices.find(
        (s) =>
          s.id === editRow.limitId ||
          (editRow.limitId === null && s.start === editRow.limitStart && s.end === editRow.limitEnd),
      ) ??
      editSlices[0] ??
      null
    : null;
  const editTargetLimitId = editSlice ? editSlice.limitId : editRow?.limitId ?? null;
  const editTargetStart = editSlice ? editSlice.start : editRow?.limitStart ?? range.start;
  const editTargetEnd = editSlice ? editSlice.end : editRow?.limitEnd ?? range.end;
  const editTargetCode = editSlice?.currencyCode || editRow?.code || defaultCode;
  const editTargetDecimals = editSlice?.decimals ?? editRow?.decimals;
  const editTargetSpent = editSlice ? editSlice.spent : editRow?.spent ?? new Decimal(0);
  const editTargetLimit = editSlice ? editSlice.amount : editRow?.limit ?? new Decimal(0);

  const createFromQuery = searchParams.get("create") === "1" || searchParams.get("create") === "true";
  const isConfigOpen = configOpen || createFromQuery;

  const handleCloseConfig = () => {
    setConfigOpen(false);
    if (createFromQuery) {
      router.replace("/budgets", { scroll: false });
    }
  };

  const openCreateModal = (seedName = "") => {
    setConfigBudget(null);
    setConfigInitialName(seedName);
    setConfigOpen(true);
  };

  const openEditModal = (b: Resource<Budget>) => {
    setConfigBudget(b);
    setConfigInitialName("");
    setConfigOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Budgets"
        subtitle={`${range.start} → ${range.end}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={rows.length < 2}
              onClick={() => setTransferState({ open: true, sourceId: null, destId: null })}
              title="Move budget limit between two budgets"
            >
              <ArrowLeftRight className="size-4" aria-hidden /> Transfer
            </Button>
            <Button size="sm" onClick={() => openCreateModal(newName.trim())}>
              <Plus className="size-4" aria-hidden /> New budget
            </Button>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="icon" onClick={() => setMonthOffset((m) => m - 1)} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setMonthOffset(0)}>
                {range.label}
              </Button>
              <Button variant="secondary" size="icon" onClick={() => setMonthOffset((m) => m + 1)} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        }
      />

      {!budgetsQ.isLoading && !budgetsQ.error && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-3 sm:p-3.5 shadow-2xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Quick add budget" className="min-w-56 flex-1">
              {(id) => (
                <Input
                  id={id}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Groceries, Dining Out, Subscriptions"
                  required
                />
              )}
            </Field>
            <Button type="submit" loading={createMut.isPending}>
              <Plus className="size-4" aria-hidden /> Add budget
            </Button>
          </form>
        </div>
      )}

      <ErrorBox error={budgetsQ.error || limitsQ.error} />

      {/* Period Summary & Available Budget Pool Bar */}
      {!budgetsQ.isLoading && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-2xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Available pool ({range.label})</span>
              <button
                type="button"
                onClick={() => {
                  setEditingAvail((v) => !v);
                  setAvailAmount(summary.availablePool ? summary.availablePool.toString() : "");
                }}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {editingAvail ? "Cancel" : summary.availablePool ? "Edit pool" : "Set pool"}
              </button>
            </div>
            {editingAvail ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  availMut.mutate(availAmount);
                }}
                className="mt-0.5 flex items-center gap-1.5"
              >
                <Input
                  inputMode="decimal"
                  value={availAmount}
                  onChange={(e) => setAvailAmount(e.target.value)}
                  placeholder={`Pool in ${summary.code}`}
                  className="h-8 text-xs"
                  autoFocus
                />
                <Button type="submit" size="sm" loading={availMut.isPending} className="h-8 px-2.5 text-xs">
                  Save
                </Button>
                {availEntry && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-danger"
                    title="Clear available pool"
                    aria-label="Clear available pool"
                    onClick={() => availMut.mutate("0")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-fg">
                  {summary.availablePool ? (
                    <Money
                      amount={summary.availablePool.toString()}
                      code={summary.code}
                      decimals={summary.decimals}
                    />
                  ) : (
                    <span className="text-sm font-normal text-muted">Not set</span>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Total budgeted</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-fg">
                <Money
                  amount={summary.totalBudgeted.toString()}
                  code={summary.code}
                  decimals={summary.decimals}
                />
              </span>
              {summary.unallocated !== null && (
                <Badge tone={summary.unallocated.lt(0) ? "danger" : "neutral"} className="text-[11px]">
                  {summary.unallocated.gte(0) ? "Left to budget: " : "Over-allocated: "}
                  <Money
                    amount={summary.unallocated.abs().toString()}
                    code={summary.code}
                    decimals={summary.decimals}
                  />
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Total spent</span>
            <span className="text-base font-bold text-fg">
              <Money
                amount={summary.totalSpent.toString()}
                code={summary.code}
                decimals={summary.decimals}
              />
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Remaining across budgets</span>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "text-base font-bold",
                  summary.totalRemaining.lt(0) ? "text-danger" : "text-success",
                )}
              >
                {summary.totalRemaining.lt(0) ? "−" : ""}
                <Money
                  amount={summary.totalRemaining.abs().toString()}
                  code={summary.code}
                  decimals={summary.decimals}
                />
              </span>
              {summary.overspentRow && rows.length >= 2 && (
                <button
                  type="button"
                  onClick={() =>
                    setTransferState({
                      open: true,
                      sourceId: null,
                      destId: summary.overspentRow!.id,
                    })
                  }
                  className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning hover:bg-warning/20 transition"
                >
                  Cover overspent
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {budgetsQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No budgets created yet">Use the form above to add your first monthly budget.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => {
            const pct = r.limit.gt(0) ? r.spent.div(r.limit).mul(100).toNumber() : 0;
            const tone = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "primary";
            const isEditing = editingLimitId === r.id;
            const slices = r.periodLimits ?? [];
            const isOver = r.left.lt(0) || Boolean(r.monthLeft?.lt(0));
            const todayIso = isoDate();
            const monthShort = range.label.split(" ")[0] || range.label;
            const linkedCats = categoriesForBudget(categoryBudgetMap, r.id);

            return (
              <Card key={r.id} className="flex min-w-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ResourceIconBadge entityType="budget" entityId={r.id} defaultIcon="PiggyBank" />
                    <h3 className="min-w-0 truncate text-sm font-semibold sm:text-base" title={r.name}>
                      {r.name}
                    </h3>
                  </div>
                  <div className="-mr-1 flex shrink-0 items-center gap-0.5">
                    {!r.active && <Badge tone="warning">Inactive</Badge>}
                    {rows.length >= 2 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 min-h-0 min-w-0 rounded-lg p-0"
                        onClick={() =>
                          setTransferState({
                            open: true,
                            sourceId: isOver ? null : r.id,
                            destId: isOver ? r.id : null,
                          })
                        }
                        title={isOver ? `Transfer to cover ${r.name}` : `Transfer from ${r.name}`}
                        aria-label={`Transfer between budgets for ${r.name}`}
                      >
                        <ArrowLeftRight className="size-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 min-h-0 min-w-0 rounded-lg p-0"
                      onClick={() => setAdjustRow(r)}
                      title="Manual adjust (+/-) or clear limit"
                      aria-label={`Adjust limit for ${r.name}`}
                    >
                      <PlusCircle className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 min-h-0 min-w-0 rounded-lg p-0"
                      onClick={() => openEditModal(r.raw)}
                      title="Configure budget"
                      aria-label={`Configure ${r.name}`}
                    >
                      <Settings2 className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant={isEditing ? "secondary" : "ghost"}
                      size="icon"
                      className="size-7 min-h-0 min-w-0 rounded-lg p-0"
                      onClick={() => {
                        if (isEditing) {
                          closeLimitEditor();
                        } else {
                          openInlineLimitEditor(r);
                        }
                      }}
                      title={r.limit.gt(0) ? "Edit limit" : "Set limit"}
                      aria-label={`${r.limit.gt(0) ? "Edit limit" : "Set limit"} for ${r.name}`}
                      aria-pressed={isEditing}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="whitespace-nowrap text-xs text-muted tabular-nums">
                    Spent{" "}
                    <span className="font-medium text-fg">
                      <Money amount={r.spent.toString()} code={r.code} decimals={r.decimals} />
                    </span>
                    {r.limit.gt(0) && (
                      <>
                        {" of "}
                        <Money amount={r.limit.toString()} code={r.code} decimals={r.decimals} />
                      </>
                    )}
                  </p>
                  {r.isSubPeriod && (
                    <Badge
                      tone={r.hasActiveSlice ? "primary" : "neutral"}
                      className="whitespace-nowrap font-mono text-[10px]"
                    >
                      {r.limitStart.slice(5)} → {r.limitEnd.slice(5)}
                    </Badge>
                  )}
                </div>

                {r.autoBudgetType && r.autoBudgetType !== "none" && r.autoBudgetAmount && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="neutral" className="text-[11px]">
                      Auto: {r.autoBudgetType} ·{" "}
                      <Money
                        amount={r.autoBudgetAmount}
                        code={r.autoBudgetCurrencyCode || r.code}
                        decimals={r.decimals}
                      />{" "}
                      / {r.autoBudgetPeriod || "monthly"}
                    </Badge>
                  </div>
                )}

                {linkedCats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[11px]">
                    <span className="text-muted">Auto-fill:</span>
                    {linkedCats.slice(0, 3).map((cat) => (
                      <Badge key={cat} tone="primary" className="text-[10px]">
                        {cat.replace(/\s*:\s*/g, " › ")}
                      </Badge>
                    ))}
                    {linkedCats.length > 3 && (
                      <Badge tone="neutral" className="text-[10px]">
                        +{linkedCats.length - 3}
                      </Badge>
                    )}
                  </div>
                )}

                {(slices.length > 1 || r.isSubPeriod) && slices.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-border/70 bg-surface-2/40 px-2 py-1.5 text-[11px]">
                    {slices.map((slice) => {
                      const sliceCode = slice.currencyCode || r.code;
                      const sliceDec = slice.decimals ?? r.decimals ?? 2;
                      const showSliceCode = sliceCode !== r.code;
                      const isSelectedSlice =
                        (r.limitId !== null && slice.id === r.limitId) ||
                        (slice.start === r.limitStart && slice.end === r.limitEnd);
                      const isStraddling = slice.start < range.start || slice.end > range.end;
                      const showInMonthNote =
                        isStraddling &&
                        slice.inMonthSpent !== undefined &&
                        !slice.inMonthSpent.eq(slice.spent);
                      const isUpcomingSynthesized =
                        Boolean(slice.isSynthesized) && slice.start > todayIso && slice.spent.eq(0);

                      return (
                        <button
                          key={slice.id}
                          type="button"
                          onClick={() => openInlineLimitEditor(r, slice.id)}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-surface-2",
                            isSelectedSlice && "bg-primary-soft/25 font-medium",
                          )}
                          title={`${slice.isSynthesized ? "Set limit" : "Edit limit"} for ${slice.start} → ${slice.end}`}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-1 whitespace-nowrap font-mono text-muted">
                            <span>
                              {slice.start.slice(5)} → {slice.end.slice(5)}
                            </span>
                            {slice.isActive && (
                              <span className="rounded bg-primary/15 px-1 py-0.25 font-sans text-[9px] font-semibold text-primary">
                                Active
                              </span>
                            )}
                            {slice.isSynthesized && (
                              <span
                                className={cn(
                                  "rounded px-1 py-0.25 font-sans text-[9px] font-semibold",
                                  isUpcomingSynthesized
                                    ? "bg-surface-2 text-muted font-medium"
                                    : "bg-warning/15 text-warning",
                                )}
                              >
                                {isUpcomingSynthesized ? "Upcoming" : "No limit"}
                              </span>
                            )}
                            {showInMonthNote && (
                              <span className="font-sans text-[9px] text-muted/90">
                                ({monthShort}: {slice.inMonthSpent!.toFixed(sliceDec)})
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 whitespace-nowrap tabular-nums text-fg">
                            <span
                              className={cn(
                                slice.isSynthesized
                                  ? slice.spent.gt(0)
                                    ? "text-danger font-semibold"
                                    : "text-muted"
                                  : slice.left.lt(0)
                                    ? "text-danger font-semibold"
                                    : "text-muted",
                              )}
                            >
                              {showSliceCode ? `${sliceCode} ` : ""}
                              {slice.spent.toFixed(sliceDec)}
                            </span>
                            <span className="text-muted"> / </span>
                            {slice.isSynthesized ? (
                              <span className="font-normal text-muted">No limit</span>
                            ) : (
                              <span className="font-semibold">
                                {showSliceCode ? `${sliceCode} ` : ""}
                                {slice.amount.toFixed(sliceDec)}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                    {r.unattributedSpent && r.unattributedSpent.gt(0) && (
                      <div className="flex items-center justify-between gap-2 px-1.5 py-0.5 text-[11px] text-warning">
                        <span className="truncate">Unallocated dates</span>
                        <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">
                          <Money amount={r.unattributedSpent.toString()} code={r.code} decimals={r.decimals} />
                        </span>
                      </div>
                    )}
                    {r.monthLimit && r.monthSpent && r.monthLeft && (
                      <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-1.5 text-[11px] text-muted">
                        <span className="truncate">Month total ({range.label})</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">
                          <span className={cn(r.monthLeft.lt(0) && "font-semibold text-danger")}>
                            <Money amount={r.monthSpent.toString()} code={r.code} decimals={r.decimals} />
                          </span>
                          {" / "}
                          <Money amount={r.monthLimit.toString()} code={r.code} decimals={r.decimals} />
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {r.limitNotes && (
                  <p className="truncate text-[11px] italic text-muted" title={r.limitNotes}>
                    {r.limitNotes}
                  </p>
                )}

                {r.limit.gt(0) ? (
                  <div className="mt-auto flex flex-col gap-1.5 pt-1">
                    <Progress value={pct} tone={tone} />
                    <div className="flex justify-between gap-2 whitespace-nowrap text-xs text-muted tabular-nums">
                      <span>{Math.round(pct)}% used</span>
                      <span>
                        {r.left.gte(0) ? (
                          <>
                            <Money amount={r.left.toString()} code={r.code} decimals={r.decimals} /> left
                          </>
                        ) : (
                          <span className="text-danger">
                            <Money amount={r.left.abs().toString()} code={r.code} decimals={r.decimals} /> over budget
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-auto pt-1 text-xs text-muted">
                    {r.isSubPeriod
                      ? `No limit set for ${r.limitStart.slice(5)} → ${r.limitEnd.slice(5)}`
                      : `No limit set for ${range.label}`}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ModalSheet
        open={editRow !== null}
        onClose={closeLimitEditor}
        title={editRow ? `${editTargetLimit.gt(0) ? "Edit limit" : "Set limit"} · ${editRow.name}` : "Edit limit"}
        subtitle={
          editRow ? (
            <span className="font-mono">
              {editTargetStart} → {editTargetEnd}
            </span>
          ) : undefined
        }
        maxWidth="max-w-md"
      >
        {editRow && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditLimitError(null);
              limitMut.mutate({
                budgetId: editRow.id,
                limitId: editTargetLimitId,
                limitStart: editTargetStart,
                limitEnd: editTargetEnd,
                amount: limitAmount,
                currencyCode: editTargetCode,
                decimals: editTargetDecimals,
              });
            }}
            className="flex flex-col gap-4"
          >
            {editSlices.length > 1 && (
              <Field label="Period">
                {(id) => (
                  <Select
                    id={id}
                    value={editSlice?.id ?? ""}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      const nextSlice = editSlices.find((s) => s.id === nextId);
                      setEditingSliceId(nextId);
                      setEditLimitError(null);
                      if (nextSlice) {
                        const seed = nextSlice.amount.gt(0)
                          ? nextSlice.amount
                          : editRow.autoBudgetAmount ?? 0;
                        const seedDec = new Decimal(seed || 0);
                        setLimitAmount(
                          seedDec.gt(0)
                            ? formatBudgetAmountInput(seedDec, nextSlice.decimals ?? editRow.decimals)
                            : "",
                        );
                      }
                    }}
                  >
                    {editSlices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.start} → {s.end}
                        {s.isActive ? " (Active)" : s.isSynthesized ? " (No limit)" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2/60 p-3 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted">Spent</span>
                <span className="font-semibold tabular-nums">
                  <Money amount={editTargetSpent.toString()} code={editTargetCode} decimals={editTargetDecimals} />
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted">Current limit</span>
                <span className="font-semibold tabular-nums">
                  <Money amount={editTargetLimit.toString()} code={editTargetCode} decimals={editTargetDecimals} />
                </span>
              </div>
            </div>

            <Field label={`New limit (${editTargetCode})`}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={limitAmount}
                  onChange={(e) => {
                    setLimitAmount(e.target.value);
                    if (editLimitError) setEditLimitError(null);
                  }}
                  placeholder={formatBudgetAmountInput(0, editTargetDecimals) || "0"}
                  className="tabular-nums"
                  autoFocus
                />
              )}
            </Field>

            <ErrorBox error={editLimitError} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeLimitEditor}>
                Cancel
              </Button>
              <Button type="submit" loading={limitMut.isPending}>
                Save limit
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>

      <BudgetConfigModal
        open={isConfigOpen}
        onClose={handleCloseConfig}
        budget={configBudget}
        initialName={configInitialName}
      />

      <BudgetAdjustModal
        open={adjustRow !== null}
        onClose={() => setAdjustRow(null)}
        row={adjustRow}
        start={range.start}
        end={range.end}
        periodLabel={range.label}
      />

      <BudgetTransferModal
        open={transferState.open}
        onClose={() => setTransferState({ open: false, sourceId: null, destId: null })}
        rows={rows}
        initialSourceId={transferState.sourceId}
        initialDestId={transferState.destId}
        start={range.start}
        end={range.end}
        periodLabel={range.label}
      />
    </div>
  );
}
