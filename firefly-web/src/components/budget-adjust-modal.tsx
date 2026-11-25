"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Minus, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { api } from "@/lib/firefly/api";
import {
  formatBudgetAmountInput,
  type BudgetLimitSlice,
  type BudgetPeriodRow,
} from "@/lib/budget-periods";
import { cn, parseAmount } from "@/lib/utils";
import { Button, Field, Input, ModalSheet, Money, Select } from "@/components/ui";
import { useToast } from "@/components/providers";

export type { BudgetLimitSlice, BudgetPeriodRow };

export type AdjustMode = "set" | "add" | "subtract";

/**
 * Computes the updated period budget limit and delta from user adjustment input.
 */
export function computeAdjustedBudgetLimit(params: {
  currentLimit: Decimal | string | number;
  mode: AdjustMode;
  inputAmount: string;
  decimals?: number;
}): { newLimit: Decimal; delta: Decimal; formatted: string } {
  const base = new Decimal(params.currentLimit || 0);
  const parsed = parseAmount(params.inputAmount);
  if (!parsed || new Decimal(parsed).lte(0)) {
    throw new Error("Enter an amount greater than 0.");
  }
  const val = new Decimal(parsed);
  let newLimit: Decimal;
  if (params.mode === "set") {
    newLimit = val;
  } else if (params.mode === "add") {
    newLimit = base.plus(val);
  } else {
    newLimit = base.minus(val);
  }
  if (newLimit.lt(0)) {
    throw new Error("Resulting budget limit cannot be negative.");
  }
  if (params.mode === "set" && newLimit.lte(0)) {
    throw new Error("Budget limit must be greater than 0 (or use Clear limit).");
  }
  const delta = newLimit.minus(base);
  const formatted = params.decimals !== undefined ? newLimit.toFixed(params.decimals) : newLimit.toString();
  return { newLimit, delta, formatted };
}

const QUICK_DELTA_AMOUNTS = ["5", "10", "25", "50", "100"];

export function BudgetAdjustModal({
  open,
  onClose,
  row,
  start,
  end,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  row: BudgetPeriodRow | null;
  start: string;
  end: string;
  periodLabel: string;
}) {
  const [rendered, setRendered] = useState(open);

  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!open && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 240);
      return () => window.clearTimeout(timer);
    }
  }, [open, rendered]);

  if ((!open && !rendered) || !row) return null;

  return (
    <BudgetAdjustModalContent
      key={`${row.id}:${row.limitId ?? ""}:${row.limitStart}`}
      open={open}
      onClose={onClose}
      row={row}
      start={start}
      end={end}
      periodLabel={periodLabel}
    />
  );
}

function BudgetAdjustModalContent({
  open,
  onClose,
  row,
  start,
  end,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  row: BudgetPeriodRow;
  start: string;
  end: string;
  periodLabel: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const slices = row.periodLimits ?? [];
  const [selectedSliceId, setSelectedSliceId] = useState<string>(
    () =>
      slices.find(
        (s) =>
          s.id === row.limitId ||
          (row.limitId === null && s.start === row.limitStart && s.end === row.limitEnd),
      )?.id ??
      slices[0]?.id ??
      "",
  );
  const activeSlice = slices.find((s) => s.id === selectedSliceId) ?? slices[0] ?? null;
  const selectedSliceKey = activeSlice?.id ?? "";
  const activeLimitId = activeSlice ? activeSlice.limitId : row.limitId;
  const activeStart = activeSlice ? activeSlice.start : row.limitStart || start;
  const activeEnd = activeSlice ? activeSlice.end : row.limitEnd || end;
  const activeCurrentLimit = activeSlice ? activeSlice.amount : row.limit;
  const activeSliceSpent = activeSlice?.spent ?? row.spent;
  const activeSliceLeft = activeCurrentLimit.minus(activeSliceSpent);
  const activeCurrencyCode = activeSlice?.currencyCode || row.code;
  const activeDecimals = activeSlice?.decimals ?? row.decimals;

  const [mode, setMode] = useState<AdjustMode>(() => (activeCurrentLimit.gt(0) ? "add" : "set"));
  const [amount, setAmount] = useState<string>("");
  const [notes, setNotes] = useState<string>(() => activeSlice?.notes ?? row.limitNotes ?? "");

  const preview = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const res = computeAdjustedBudgetLimit({
        currentLimit: activeCurrentLimit,
        mode,
        inputAmount: amount,
        decimals: activeDecimals,
      });
      return { ok: true as const, ...res, newLeft: res.newLimit.minus(activeSliceSpent) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [activeCurrentLimit, activeSliceSpent, activeDecimals, mode, amount]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["budget-limits"] }),
      qc.invalidateQueries({ queryKey: ["budgets"] }),
      qc.invalidateQueries({ queryKey: ["budgets-list"] }),
      qc.invalidateQueries({ queryKey: ["available-budgets"] }),
    ]);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const { newLimit, formatted } = computeAdjustedBudgetLimit({
        currentLimit: activeCurrentLimit,
        mode,
        inputAmount: amount,
        decimals: activeDecimals,
      });
      if (newLimit.eq(0)) {
        if (activeLimitId) {
          await api.deleteBudgetLimit(row.id, activeLimitId);
        }
        return { cleared: true };
      }
      await api.upsertBudgetLimit({
        budgetId: row.id,
        limitId: activeLimitId,
        amount: formatted,
        start: activeStart,
        end: activeEnd,
        currency_code: activeCurrencyCode,
        notes: notes.trim() || null,
      });
      return { cleared: false };
    },
    onSuccess: (res) => {
      void invalidateAll();
      toast(res.cleared ? `Cleared limit for ${row.name}` : `Updated ${row.name} limit`);
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      if (!activeLimitId) return;
      await api.deleteBudgetLimit(row.id, activeLimitId);
    },
    onSuccess: () => {
      void invalidateAll();
      toast(`Cleared limit for ${row.name}`);
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const overspentAmount = activeSliceSpent.gt(activeCurrentLimit)
    ? activeSliceSpent.minus(activeCurrentLimit)
    : new Decimal(0);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Adjust Budget · ${row.name}`}
      subtitle={`Period ${periodLabel} (${activeStart} → ${activeEnd}) · Adjusts only this period's budgeted amount; your Auto-budget rule stays unchanged.`}
      maxWidth="max-w-lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {slices.length > 1 && (
          <Field label="Target period slice (weekly / sub-period)">
            {(id) => (
              <Select
                id={id}
                value={selectedSliceKey}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedSliceId(nextId);
                  const nextSlice = slices.find((s) => s.id === nextId);
                  if (nextSlice) {
                    setNotes(nextSlice.notes ?? "");
                    if (nextSlice.amount.eq(0) && mode === "subtract") {
                      setMode("set");
                    }
                  }
                }}
              >
                {slices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.start} → {s.end}
                    {s.isActive ? " (Active)" : ""} ({s.currencyCode || row.code}{" "}
                    {s.amount.toFixed(s.decimals ?? row.decimals ?? 2)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {/* Current status summary */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-2/40 p-3 text-xs">
          <div>
            <span className="text-muted block">{slices.length > 1 ? "Period limit" : "Current limit"}</span>
            <span className="font-semibold text-fg">
              <Money amount={activeCurrentLimit.toString()} code={activeCurrencyCode} decimals={activeDecimals} />
            </span>
          </div>
          <div>
            <span className="text-muted block">{slices.length > 1 ? "Period spent" : "Spent"}</span>
            <span className="font-semibold text-fg">
              <Money amount={activeSliceSpent.toString()} code={activeCurrencyCode} decimals={activeDecimals} />
            </span>
          </div>
          <div>
            <span className="text-muted block">{activeSliceLeft.gte(0) ? "Remaining" : "Over budget"}</span>
            <span className={cn("font-semibold", activeSliceLeft.lt(0) ? "text-danger" : "text-success")}>
              <Money amount={activeSliceLeft.abs().toString()} code={activeCurrencyCode} decimals={activeDecimals} />
            </span>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Adjustment mode</span>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-surface-2/60 p-1">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition",
                mode === "add" ? "bg-surface text-primary shadow-xs" : "text-muted hover:text-fg",
              )}
            >
              <Plus className="size-3.5" aria-hidden /> Add (+)
            </button>
            <button
              type="button"
              onClick={() => setMode("subtract")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition",
                mode === "subtract" ? "bg-surface text-danger shadow-xs" : "text-muted hover:text-fg",
              )}
            >
              <Minus className="size-3.5" aria-hidden /> Subtract (−)
            </button>
            <button
              type="button"
              onClick={() => setMode("set")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition",
                mode === "set" ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg",
              )}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden /> Set exact
            </button>
          </div>
        </div>

        {/* Amount + Quick Fill Chips */}
        <Field
          label={
            mode === "add"
              ? `Amount to add (${row.code})`
              : mode === "subtract"
                ? `Amount to subtract (${row.code})`
                : `New exact limit (${row.code})`
          }
        >
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={
                mode === "set" && activeCurrentLimit.gt(0)
                  ? formatBudgetAmountInput(activeCurrentLimit, activeDecimals)
                  : activeDecimals !== undefined
                    ? new Decimal(0).toFixed(activeDecimals)
                    : "0.000"
              }
              required
              autoFocus
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-1.5">
          {mode !== "set" &&
            QUICK_DELTA_AMOUNTS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  const current = parseAmount(amount);
                  const next = current ? new Decimal(current).plus(chip) : new Decimal(chip);
                  setAmount(next.toString());
                }}
                className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg hover:border-primary hover:text-primary transition"
              >
                {mode === "add" ? "+" : "−"}
                {chip}
              </button>
            ))}

          {overspentAmount.gt(0) && (
            <button
              type="button"
              onClick={() => {
                setMode("add");
                setAmount(formatBudgetAmountInput(overspentAmount, activeDecimals));
              }}
              className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning hover:bg-warning/20 transition"
            >
              Cover overspent (+{overspentAmount.toFixed(activeDecimals ?? 2)})
            </button>
          )}

          {mode === "set" && activeSliceSpent.gt(0) && (
            <button
              type="button"
              onClick={() => setAmount(formatBudgetAmountInput(activeSliceSpent, activeDecimals))}
              className="rounded-full border border-primary/30 bg-primary-soft/40 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/70 transition"
            >
              Match spent ({activeSliceSpent.toFixed(activeDecimals ?? 2)})
            </button>
          )}
        </div>

        {/* Live Preview */}
        {preview && (
          preview.ok ? (
            <div className="rounded-xl border border-primary/25 bg-primary-soft/15 p-3 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted">Adjustment</span>
                <span className={cn("font-semibold", preview.delta.gte(0) ? "text-success" : "text-danger")}>
                  {preview.delta.gte(0) ? "+" : "−"}
                  <Money amount={preview.delta.abs().toString()} code={row.code} decimals={row.decimals} />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">New period limit</span>
                <span className="font-bold text-fg">
                  <Money amount={preview.newLimit.toString()} code={row.code} decimals={row.decimals} />
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
                <span className="text-muted">New remaining after spent</span>
                <span className={cn("font-semibold", preview.newLeft.lt(0) ? "text-danger" : "text-success")}>
                  {preview.newLeft.lt(0) ? "−" : ""}
                  <Money amount={preview.newLeft.abs().toString()} code={row.code} decimals={row.decimals} />
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs font-medium text-danger">{preview.error}</p>
          )
        )}

        {/* Notes */}
        <Field label="Note (optional)">
          {(id) => (
            <Input
              id={id}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Manual top-up for weekend groceries"
            />
          )}
        </Field>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {activeLimitId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={clearMut.isPending}
              onClick={() => clearMut.mutate()}
              className="text-danger hover:bg-danger/10"
            >
              <Trash2 className="size-3.5" aria-hidden /> Clear limit
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={saveMut.isPending}
              disabled={!amount.trim() || (preview !== null && !preview.ok)}
            >
              Save adjustment
            </Button>
          </div>
        </div>
      </form>
    </ModalSheet>
  );
}
