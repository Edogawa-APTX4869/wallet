"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/firefly/api";
import { usePrimaryCurrency } from "@/lib/hooks";
import { monthRange, parseAmount, sumDecimal } from "@/lib/utils";
import { ResourceIconBadge } from "@/components/resource-icon";
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

  const [newName, setNewName] = useState("");
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [limitAmount, setLimitAmount] = useState("");

  useEscapeDismiss(editingLimitId !== null, () => setEditingLimitId(null), "budget-edit-limit");

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
    mutationFn: async ({ budgetId, amount }: { budgetId: string; amount: string }) => {
      const parsed = parseAmount(amount);
      if (!parsed || new Decimal(parsed).lte(0)) throw new Error("Enter a valid limit amount.");
      return api.setBudgetLimit(budgetId, parsed, range.start, range.end, primaryQ.data?.code);
    },
    onSuccess: () => {
      toast("Budget limit updated");
      setEditingLimitId(null);
      setLimitAmount("");
      qc.invalidateQueries({ queryKey: ["budget-limits"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const defaultCode = primaryQ.data?.code || "USD";
  const defaultDecimals = primaryQ.data?.decimal_places;
  const rows = useMemo(() => {
    const budgets = budgetsQ.data ?? [];
    const limits = limitsQ.data ?? [];
    return budgets.map((b) => {
      const lim = limits.find((l) => l.attributes.budget_id === b.id);
      const limitVal = new Decimal(lim?.attributes.amount ?? b.attributes.auto_budget_amount ?? 0);
      const spentEntries = b.attributes.spent ?? [];
      const spentVal = sumDecimal(spentEntries.map((s) => new Decimal(s.sum).abs()));
      const leftVal = limitVal.minus(spentVal);
      const code =
        lim?.attributes.currency_code ||
        spentEntries[0]?.currency_code ||
        b.attributes.auto_budget_currency_code ||
        defaultCode;
      const decimals =
        lim?.attributes.currency_decimal_places ??
        spentEntries[0]?.currency_decimal_places ??
        defaultDecimals;
      return {
        id: b.id,
        name: b.attributes.name,
        active: b.attributes.active,
        limit: limitVal,
        spent: spentVal,
        left: leftVal,
        code,
        decimals,
      };
    });
  }, [budgetsQ.data, limitsQ.data, defaultCode, defaultDecimals]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Budgets"
        subtitle={`${range.start} → ${range.end}`}
        actions={
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
          <Field label="Create a new budget" className="min-w-56 flex-1">
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

      <ErrorBox error={budgetsQ.error || limitsQ.error} />

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
                  <div className="flex items-center gap-1.5">
                    {!r.active && <Badge tone="warning">Inactive</Badge>}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingLimitId(isEditing ? null : r.id);
                        setLimitAmount(r.limit.gt(0) ? r.limit.toString() : "");
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden /> {r.limit.gt(0) ? "Edit limit" : "Set limit"}
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      limitMut.mutate({ budgetId: r.id, amount: limitAmount });
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
    </div>
  );
}
