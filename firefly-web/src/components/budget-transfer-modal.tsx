"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { api } from "@/lib/firefly/api";
import { parseAmount } from "@/lib/utils";
import type { BudgetPeriodRow } from "@/components/budget-adjust-modal";
import { Button, Field, Input, ModalSheet, Money, Select } from "@/components/ui";
import { useToast } from "@/components/providers";

/**
 * Computes resulting source & destination limits and remaining amounts for a budget-to-budget transfer.
 */
export function computeBudgetTransfer(params: {
  sourceLimit: Decimal | string | number;
  sourceSpent?: Decimal | string | number;
  destLimit: Decimal | string | number;
  destSpent?: Decimal | string | number;
  amount: string;
  decimals?: number;
  sourceId: string;
  destId: string;
  sourceCurrency?: string;
  destCurrency?: string;
}): {
  transferAmount: Decimal;
  newSourceLimit: Decimal;
  newDestLimit: Decimal;
  newSourceLeft: Decimal;
  newDestLeft: Decimal;
  formattedSourceLimit: string;
  formattedDestLimit: string;
} {
  if (!params.sourceId || !params.destId || params.sourceId === params.destId) {
    throw new Error("Choose two different budgets.");
  }
  if (params.sourceCurrency && params.destCurrency && params.sourceCurrency !== params.destCurrency) {
    throw new Error("Budgets must use the same currency to transfer directly.");
  }
  const parsed = parseAmount(params.amount);
  if (!parsed || new Decimal(parsed).lte(0)) {
    throw new Error("Enter a transfer amount greater than 0.");
  }

  const transferAmount = new Decimal(parsed);
  const srcLimit = new Decimal(params.sourceLimit || 0);
  const srcSpent = new Decimal(params.sourceSpent || 0);
  const dstLimit = new Decimal(params.destLimit || 0);
  const dstSpent = new Decimal(params.destSpent || 0);

  const newSourceLimit = srcLimit.minus(transferAmount);
  if (newSourceLimit.lt(0)) {
    throw new Error("Transfer amount exceeds the source budget limit.");
  }
  const newDestLimit = dstLimit.plus(transferAmount);

  const formattedSourceLimit =
    params.decimals !== undefined ? newSourceLimit.toFixed(params.decimals) : newSourceLimit.toString();
  const formattedDestLimit =
    params.decimals !== undefined ? newDestLimit.toFixed(params.decimals) : newDestLimit.toString();

  return {
    transferAmount,
    newSourceLimit,
    newDestLimit,
    newSourceLeft: newSourceLimit.minus(srcSpent),
    newDestLeft: newDestLimit.minus(dstSpent),
    formattedSourceLimit,
    formattedDestLimit,
  };
}

export function BudgetTransferModal({
  open,
  onClose,
  rows,
  initialSourceId = null,
  initialDestId = null,
  start,
  end,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  rows: BudgetPeriodRow[];
  initialSourceId?: string | null;
  initialDestId?: string | null;
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

  if ((!open && !rendered) || rows.length < 2) return null;

  return (
    <BudgetTransferModalContent
      open={open}
      onClose={onClose}
      rows={rows}
      initialSourceId={initialSourceId}
      initialDestId={initialDestId}
      start={start}
      end={end}
      periodLabel={periodLabel}
    />
  );
}

function BudgetTransferModalContent({
  open,
  onClose,
  rows,
  initialSourceId,
  initialDestId,
  start,
  end,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  rows: BudgetPeriodRow[];
  initialSourceId?: string | null;
  initialDestId?: string | null;
  start: string;
  end: string;
  periodLabel: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const pickDefaults = () => {
    const firstWithLimit = rows.find((r) => r.limit.gt(0)) ?? rows[0];
    let src = initialSourceId && rows.some((r) => r.id === initialSourceId) ? initialSourceId : firstWithLimit.id;
    let dst = initialDestId && rows.some((r) => r.id === initialDestId) ? initialDestId : "";
    if (dst && src === dst) {
      src = rows.find((r) => r.id !== dst && r.limit.gt(0))?.id ?? rows.find((r) => r.id !== dst)?.id ?? "";
    }
    if (!dst) {
      dst = rows.find((r) => r.id !== src && r.left.lt(0))?.id ?? rows.find((r) => r.id !== src)?.id ?? "";
    }
    return { src, dst };
  };

  const defaults = pickDefaults();
  const [sourceId, setSourceId] = useState<string>(defaults.src);
  const [destId, setDestId] = useState<string>(defaults.dst);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const next = pickDefaults();
    setSourceId(next.src);
    setDestId(next.dst);
    setAmount("");
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSourceId, initialDestId]);

  const sourceRow = rows.find((r) => r.id === sourceId) ?? rows[0];
  const destRow = rows.find((r) => r.id === destId) ?? rows.find((r) => r.id !== sourceRow?.id);

  const getSlice = (row: BudgetPeriodRow | undefined) => {
    if (!row) return null;
    const match = row.periodLimits?.find((s) => s.id === row.limitId) ?? row.periodLimits?.[0];
    return {
      limitId: match?.id ?? row.limitId,
      start: match?.start ?? (row.limitStart || start),
      end: match?.end ?? (row.limitEnd || end),
      amount: match?.amount ?? row.limit,
    };
  };

  const srcSlice = getSlice(sourceRow);
  const dstSlice = getSlice(destRow);

  const preview = useMemo(() => {
    if (!sourceRow || !destRow || !srcSlice || !dstSlice || !amount.trim()) return null;
    try {
      const res = computeBudgetTransfer({
        sourceLimit: srcSlice.amount,
        sourceSpent: sourceRow.spent,
        destLimit: dstSlice.amount,
        destSpent: destRow.spent,
        amount,
        decimals: sourceRow.decimals,
        sourceId: sourceRow.id,
        destId: destRow.id,
        sourceCurrency: sourceRow.code,
        destCurrency: destRow.code,
      });
      return { ok: true as const, ...res };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [sourceRow, destRow, srcSlice, dstSlice, amount]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["budget-limits"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["budgets-list"] });
    qc.invalidateQueries({ queryKey: ["available-budgets"] });
  };

  const transferMut = useMutation({
    mutationFn: async () => {
      if (!sourceRow || !destRow || !srcSlice || !dstSlice) throw new Error("Choose two budgets.");
      const calc = computeBudgetTransfer({
        sourceLimit: srcSlice.amount,
        sourceSpent: sourceRow.spent,
        destLimit: dstSlice.amount,
        destSpent: destRow.spent,
        amount,
        decimals: sourceRow.decimals,
        sourceId: sourceRow.id,
        destId: destRow.id,
        sourceCurrency: sourceRow.code,
        destCurrency: destRow.code,
      });

      const dec = sourceRow.decimals ?? 2;
      const auditNote =
        note.trim() ||
        `Budget transfer: ${sourceRow.code} ${calc.transferAmount.toFixed(dec)} from ${sourceRow.name} to ${destRow.name}`;

      if (calc.newSourceLimit.eq(0)) {
        if (srcSlice.limitId) {
          await api.deleteBudgetLimit(sourceRow.id, srcSlice.limitId);
        }
      } else {
        await api.upsertBudgetLimit({
          budgetId: sourceRow.id,
          limitId: srcSlice.limitId,
          amount: calc.formattedSourceLimit,
          start: srcSlice.start,
          end: srcSlice.end,
          currency_code: sourceRow.code,
          notes: auditNote,
        });
      }

      await api.upsertBudgetLimit({
        budgetId: destRow.id,
        limitId: dstSlice.limitId,
        amount: calc.formattedDestLimit,
        start: dstSlice.start,
        end: dstSlice.end,
        currency_code: destRow.code,
        notes: auditNote,
      });

      return { amountStr: calc.transferAmount.toFixed(dec), code: sourceRow.code };
    },
    onSuccess: (res) => {
      invalidateAll();
      toast(`Transferred ${res.code} ${res.amountStr} from ${sourceRow?.name} to ${destRow?.name}`);
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const swapBudgets = () => {
    if (!sourceRow || !destRow) return;
    setSourceId(destRow.id);
    setDestId(sourceRow.id);
  };

  const sourceRemaining =
    sourceRow && srcSlice
      ? Decimal.min(sourceRow.left.gt(0) ? sourceRow.left : new Decimal(0), srcSlice.amount)
      : new Decimal(0);
  const destDeficit = destRow && destRow.left.lt(0) ? destRow.left.abs() : new Decimal(0);
  const coverableDeficit =
    srcSlice && destDeficit.gt(0) ? Decimal.min(destDeficit, srcSlice.amount) : new Decimal(0);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title="Transfer Between Budgets"
      subtitle={`Reallocate envelope limits for ${periodLabel} — Auto-budget templates stay unchanged`}
      maxWidth="max-w-lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          transferMut.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {/* Source & Destination Selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="From budget">
            {(id) => (
              <Select
                id={id}
                value={sourceRow?.id ?? ""}
                onChange={(e) => {
                  const nextSrc = e.target.value;
                  setSourceId(nextSrc);
                  if (nextSrc === destId) {
                    const other = rows.find((r) => r.id !== nextSrc);
                    if (other) setDestId(other.id);
                  }
                }}
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code} {r.limit.toFixed(r.decimals ?? 2)})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={swapBudgets}
            aria-label="Swap budgets"
            title="Swap source and destination"
            className="mb-0.5"
          >
            <ArrowLeftRight className="size-4" />
          </Button>

          <Field label="To budget">
            {(id) => (
              <Select
                id={id}
                value={destRow?.id ?? ""}
                onChange={(e) => {
                  const nextDst = e.target.value;
                  setDestId(nextDst);
                  if (nextDst === sourceId) {
                    const other = rows.find((r) => r.id !== nextDst);
                    if (other) setSourceId(other.id);
                  }
                }}
              >
                {rows
                  .filter((r) => r.id !== sourceRow?.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code} {r.limit.toFixed(r.decimals ?? 2)})
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>

        {/* Status pills for Source and Destination */}
        {sourceRow && destRow && (
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-2">
              <div className="font-semibold text-fg truncate">{sourceRow.name}</div>
              <div className="text-muted">
                Limit: <Money amount={sourceRow.limit.toString()} code={sourceRow.code} decimals={sourceRow.decimals} />
              </div>
              <div className={sourceRow.left.lt(0) ? "text-danger" : "text-success"}>
                {sourceRow.left.gte(0) ? "Left: " : "Over: "}
                <Money amount={sourceRow.left.abs().toString()} code={sourceRow.code} decimals={sourceRow.decimals} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-2">
              <div className="font-semibold text-fg truncate">{destRow.name}</div>
              <div className="text-muted">
                Limit: <Money amount={destRow.limit.toString()} code={destRow.code} decimals={destRow.decimals} />
              </div>
              <div className={destRow.left.lt(0) ? "text-danger" : "text-success"}>
                {destRow.left.gte(0) ? "Left: " : "Over: "}
                <Money amount={destRow.left.abs().toString()} code={destRow.code} decimals={destRow.decimals} />
              </div>
            </div>
          </div>
        )}

        {/* Amount Input */}
        <Field label={`Transfer amount (${sourceRow?.code || "USD"})`}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.000"
              required
              autoFocus
            />
          )}
        </Field>

        {/* Smart Quick-Fill Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {sourceRemaining.gt(0) && (
            <button
              type="button"
              onClick={() =>
                setAmount(
                  sourceRow?.decimals !== undefined
                    ? sourceRemaining.toFixed(sourceRow.decimals)
                    : sourceRemaining.toString(),
                )
              }
              className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg hover:border-primary hover:text-primary transition"
            >
              Move all remaining ({sourceRemaining.toFixed(sourceRow?.decimals ?? 2)})
            </button>
          )}
          {coverableDeficit.gt(0) && (
            <button
              type="button"
              onClick={() =>
                setAmount(
                  sourceRow?.decimals !== undefined
                    ? coverableDeficit.toFixed(sourceRow.decimals)
                    : coverableDeficit.toString(),
                )
              }
              className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning hover:bg-warning/20 transition"
            >
              Cover overspending ({coverableDeficit.toFixed(sourceRow?.decimals ?? 2)})
            </button>
          )}
        </div>

        {/* Live Before -> After Preview */}
        {preview && sourceRow && destRow && srcSlice && dstSlice && (
          preview.ok ? (
            <div className="rounded-xl border border-primary/25 bg-primary-soft/15 p-3 text-xs flex flex-col gap-2">
              <p className="font-semibold uppercase tracking-wider text-muted text-[10px]">
                Before → After Preview
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-fg truncate">{sourceRow.name}</span>
                <span className="flex items-center gap-1.5 font-mono">
                  <span className="text-muted">
                    <Money amount={srcSlice.amount.toString()} code={sourceRow.code} decimals={sourceRow.decimals} />
                  </span>
                  <ArrowRight className="size-3 text-muted" />
                  <span className="font-bold text-danger">
                    <Money amount={preview.newSourceLimit.toString()} code={sourceRow.code} decimals={sourceRow.decimals} />
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-fg truncate">{destRow.name}</span>
                <span className="flex items-center gap-1.5 font-mono">
                  <span className="text-muted">
                    <Money amount={dstSlice.amount.toString()} code={destRow.code} decimals={destRow.decimals} />
                  </span>
                  <ArrowRight className="size-3 text-muted" />
                  <span className="font-bold text-success">
                    <Money amount={preview.newDestLimit.toString()} code={destRow.code} decimals={destRow.decimals} />
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs font-medium text-danger">{preview.error}</p>
          )
        )}

        {/* Reason / Audit Note */}
        <Field label="Reason / Note (optional)">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Cover extra dining spend from unused transport budget"
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={transferMut.isPending}
            disabled={!amount.trim() || (preview !== null && !preview.ok)}
          >
            <ArrowLeftRight className="size-4" aria-hidden /> Confirm transfer
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
