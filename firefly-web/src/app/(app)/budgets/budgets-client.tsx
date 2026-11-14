"use client";

import { useMemo, useState } from "react";
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
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Budget, Resource } from "@/lib/firefly/types";
import { usePrimaryCurrency } from "@/lib/hooks";
import { cn, isoDate, monthRange, parseAmount, sumDecimal } from "@/lib/utils";
import { ResourceIconBadge } from "@/components/resource-icon";
import { BudgetConfigModal } from "@/components/budget-config-modal";
import { BudgetAdjustModal, type BudgetPeriodRow } from "@/components/budget-adjust-modal";
import { BudgetTransferModal } from "@/components/budget-transfer-modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Money,
  PageHeader,
  Progress,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

export function BudgetsClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const [monthOffset, setMonthOffset] = useState(0);
  const range = useMemo(() => monthRange(monthOffset), [monthOffset]);
  const primaryQ = usePrimaryCurrency();

  const budgetsQ = useQuery({
    queryKey: ["budgets", range.start, range.end],
    queryFn: () => api.budgets(range.start, range.end),
  });
  const limitsQ = useQuery({
    queryKey: ["budget-limits", range.start, range.end],
    queryFn: () => api.budgetLimits(range.start, range.end),
  });
  const availableBudgetsQ = useQuery({
    queryKey: ["available-budgets", range.start, range.end],
    queryFn: () => api.availableBudgets(range.start, range.end),
  });

  const [newName, setNewName] = useState("");
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [limitAmount, setLimitAmount] = useState("");
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

  useEscapeDismiss(editingLimitId !== null, () => setEditingLimitId(null), "budget-edit-limit");
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
    }: {
      budgetId: string;
      limitId: string | null;
      limitStart?: string;
      limitEnd?: string;
      amount: string;
      currencyCode?: string;
    }) => {
      const parsed = parseAmount(amount);
      if (!parsed || new Decimal(parsed).lte(0)) throw new Error("Enter a valid limit amount.");
      return api.upsertBudgetLimit({
        budgetId,
        limitId,
        amount: parsed,
        start: limitStart || range.start,
        end: limitEnd || range.end,
        currency_code: currencyCode || primaryQ.data?.code,
      });
    },
    onSuccess: () => {
      toast("Budget limit updated");
      setEditingLimitId(null);
      setLimitAmount("");
      qc.invalidateQueries({ queryKey: ["budget-limits"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["available-budgets"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const defaultCode = primaryQ.data?.code || "USD";
  const defaultDecimals = primaryQ.data?.decimal_places;

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
    const today = isoDate();
    return budgets.map((b) => {
      const matchingLimits = limits
        .filter((l) => l.attributes.budget_id === b.id)
        .sort((a, z) => (z.attributes.start || "").localeCompare(a.attributes.start || ""));

      const periodLimits = matchingLimits.map((l) => ({
        id: l.id,
        start: (l.attributes.start || range.start).slice(0, 10),
        end: (l.attributes.end || range.end).slice(0, 10),
        amount: new Decimal(l.attributes.amount || 0),
        currencyCode: l.attributes.currency_code,
        decimals: l.attributes.currency_decimal_places,
        notes: l.attributes.notes ?? null,
      }));

      const primaryLim =
        periodLimits.find((l) => l.start <= today && l.end >= today) ?? periodLimits[0] ?? null;
      const limitVal =
        periodLimits.length > 0
          ? sumDecimal(periodLimits.map((l) => l.amount))
          : new Decimal(b.attributes.auto_budget_amount ?? 0);
      const spentEntries = b.attributes.spent ?? [];
      const spentVal = sumDecimal(spentEntries.map((s) => new Decimal(s.sum).abs()));
      const leftVal = limitVal.minus(spentVal);
      const code =
        primaryLim?.currencyCode ||
        spentEntries[0]?.currency_code ||
        b.attributes.auto_budget_currency_code ||
        defaultCode;
      const decimals =
        primaryLim?.decimals ??
        spentEntries[0]?.currency_decimal_places ??
        defaultDecimals;
      return {
        raw: b,
        id: b.id,
        limitId: primaryLim?.id ?? null,
        limitStart: primaryLim?.start ?? range.start,
        limitEnd: primaryLim?.end ?? range.end,
        limitNotes: primaryLim?.notes ?? null,
        periodLimits,
        name: b.attributes.name,
        active: b.attributes.active,
        autoBudgetType: b.attributes.auto_budget_type,
        autoBudgetAmount: b.attributes.auto_budget_amount,
        autoBudgetPeriod: b.attributes.auto_budget_period,
        autoBudgetCurrencyCode: b.attributes.auto_budget_currency_code,
        limit: limitVal,
        spent: spentVal,
        left: leftVal,
        code,
        decimals,
      };
    });
  }, [budgetsQ.data, limitsQ.data, range.start, range.end, defaultCode, defaultDecimals]);

  const summary = useMemo(() => {
    const summaryCode = availEntry?.attributes.currency_code || defaultCode;
    const primaryRows = rows.filter((r) => r.code === summaryCode);
    const activeRows = primaryRows.length > 0 ? primaryRows : rows;
    const totalBudgeted = sumDecimal(activeRows.map((r) => r.limit));
    const totalSpent = sumDecimal(activeRows.map((r) => r.spent));
    const totalRemaining = totalBudgeted.minus(totalSpent);
    const availablePool = availEntry ? new Decimal(availEntry.attributes.amount || 0) : null;
    const unallocated = availablePool ? availablePool.minus(totalBudgeted) : null;
    const overspentRow = rows.find((r) => r.left.lt(0)) ?? null;
    return {
      code: summaryCode,
      decimals: availEntry?.attributes.currency_decimal_places ?? defaultDecimals,
      totalBudgeted,
      totalSpent,
      totalRemaining,
      availablePool,
      unallocated,
      overspentRow,
    };
  }, [rows, availEntry, defaultCode, defaultDecimals]);

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
            <Button size="sm" onClick={() => openCreateModal("")}>
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => openCreateModal(newName.trim())}
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Full configuration
          </Button>
        </form>
      </div>

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
            return (
              <Card key={r.id} className="flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <ResourceIconBadge entityType="budget" entityId={r.id} defaultIcon="PiggyBank" />
                    <div>
                      <h3 className="font-semibold">{r.name}</h3>
                      <p className="text-xs text-muted">
                        Spent <Money amount={r.spent.toString()} code={r.code} decimals={r.decimals} />
                        {r.limit.gt(0) && (
                          <>
                            {" of "}
                            <Money amount={r.limit.toString()} code={r.code} decimals={r.decimals} />
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {!r.active && <Badge tone="warning">Inactive</Badge>}
                    {rows.length >= 2 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setTransferState({
                            open: true,
                            sourceId: r.left.lt(0) ? null : r.id,
                            destId: r.left.lt(0) ? r.id : null,
                          })
                        }
                        title={r.left.lt(0) ? `Transfer to cover ${r.name}` : `Transfer from ${r.name}`}
                        aria-label={`Transfer between budgets for ${r.name}`}
                      >
                        <ArrowLeftRight className="size-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAdjustRow(r)}
                      title="Manual adjust (+/-) or clear limit"
                      aria-label={`Adjust limit for ${r.name}`}
                    >
                      <PlusCircle className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(r.raw)}
                      title="Configure budget"
                      aria-label={`Configure ${r.name}`}
                    >
                      <Settings2 className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingLimitId(isEditing ? null : r.id);
                        const activeSlice =
                          r.periodLimits?.find((s) => s.id === r.limitId) ?? r.periodLimits?.[0];
                        const seed = activeSlice ? activeSlice.amount : r.limit;
                        setLimitAmount(seed.gt(0) ? seed.toString() : "");
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden /> {r.limit.gt(0) ? "Edit limit" : "Set limit"}
                    </Button>
                  </div>
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

                {r.periodLimits && r.periodLimits.length > 1 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-border/70 bg-surface-2/40 px-2.5 py-1.5 text-[11px]">
                    {r.periodLimits.map((slice) => (
                      <div key={slice.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted font-mono">
                          {slice.start} → {slice.end}
                        </span>
                        <span className="font-semibold text-fg">
                          <Money
                            amount={slice.amount.toString()}
                            code={slice.currencyCode || r.code}
                            decimals={slice.decimals ?? r.decimals}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {r.limitNotes && (
                  <p className="truncate text-[11px] italic text-muted" title={r.limitNotes}>
                    {r.limitNotes}
                  </p>
                )}

                {isEditing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      limitMut.mutate({
                        budgetId: r.id,
                        limitId: r.limitId,
                        limitStart: r.limitStart,
                        limitEnd: r.limitEnd,
                        amount: limitAmount,
                        currencyCode: r.code,
                      });
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      inputMode="decimal"
                      value={limitAmount}
                      onChange={(e) => setLimitAmount(e.target.value)}
                      placeholder={`Limit in ${r.code}`}
                      aria-label={`Monthly limit for ${r.name}`}
                      autoFocus
                    />
                    <Button type="submit" size="sm" loading={limitMut.isPending}>
                      Save
                    </Button>
                  </form>
                )}

                {r.limit.gt(0) ? (
                  <div className="flex flex-col gap-1.5">
                    <Progress value={pct} tone={tone} />
                    <div className="flex justify-between text-xs text-muted">
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
                  <p className="text-xs text-muted">No limit set for {range.label}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <BudgetConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
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
