"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Paperclip, Trash2, X } from "lucide-react";
import { api, type BudgetPayload } from "@/lib/firefly/api";
import type { AutoBudgetPeriod, AutoBudgetType, Budget, Resource } from "@/lib/firefly/types";
import { useCurrencies, usePrimaryCurrency } from "@/lib/hooks";
import { parseAmount } from "@/lib/utils";
import { Button, Field, Input, ModalSheet, Select } from "@/components/ui";
import { useToast } from "@/components/providers";

export const AUTO_BUDGET_TYPES: Array<{ value: AutoBudgetType; label: string; hint: string }> = [
  { value: "none", label: "No auto-budget", hint: "Set monthly limits manually when needed" },
  {
    value: "reset",
    label: "Set a fixed amount every period",
    hint: "Resets the budget limit to this exact amount each period",
  },
  {
    value: "rollover",
    label: "Add an amount every period",
    hint: "Adds this amount on top of any unspent remainder",
  },
  {
    value: "adjusted",
    label: "Add an amount every period and correct for overspending",
    hint: "Adds this amount and adjusts for overspending from the prior period",
  },
];

export const AUTO_BUDGET_PERIODS: Array<{ value: AutoBudgetPeriod; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half-year", label: "Every half year" },
  { value: "yearly", label: "Yearly" },
];

export interface BudgetFormValues {
  name: string;
  active: boolean;
  autoBudgetType: AutoBudgetType;
  currencyCode: string;
  autoBudgetAmount: string;
  autoBudgetPeriod: AutoBudgetPeriod;
  notes: string;
}

/**
 * Validates and constructs a Firefly III `/api/v1/budgets` payload from form values.
 */
export function buildBudgetPayload(values: BudgetFormValues): BudgetPayload {
  const name = values.name.trim();
  if (!name) {
    throw new Error("Enter a budget name.");
  }

  const payload: BudgetPayload = {
    name,
    active: values.active,
    notes: values.notes.trim() || null,
  };

  if (values.autoBudgetType === "none") {
    payload.auto_budget_type = "none";
    payload.auto_budget_amount = null;
    payload.auto_budget_currency_code = null;
    payload.auto_budget_period = null;
  } else {
    const parsed = parseAmount(values.autoBudgetAmount);
    if (!parsed || new Decimal(parsed).lte(0)) {
      throw new Error("Enter a valid auto-budget amount greater than 0.");
    }
    payload.auto_budget_type = values.autoBudgetType;
    payload.auto_budget_amount = parsed;
    payload.auto_budget_currency_code = values.currencyCode.trim() || undefined;
    payload.auto_budget_period = values.autoBudgetPeriod;
  }

  return payload;
}

function normalizeAutoBudgetType(raw?: string | null): AutoBudgetType {
  if (raw === "reset" || raw === "rollover" || raw === "adjusted") return raw;
  return "none";
}

function normalizeAutoBudgetPeriod(raw?: string | null): AutoBudgetPeriod {
  if (
    raw === "daily" ||
    raw === "weekly" ||
    raw === "monthly" ||
    raw === "quarterly" ||
    raw === "half-year" ||
    raw === "yearly"
  ) {
    return raw;
  }
  return "monthly";
}

export function BudgetConfigModal({
  open,
  onClose,
  budget,
  initialName = "",
}: {
  open: boolean;
  onClose: () => void;
  budget?: Resource<Budget> | null;
  initialName?: string;
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

  if (!open && !rendered) return null;

  return <BudgetConfigModalContent open={open} onClose={onClose} budget={budget} initialName={initialName} />;
}

function BudgetConfigModalContent({
  open,
  onClose,
  budget,
  initialName = "",
}: {
  open: boolean;
  onClose: () => void;
  budget?: Resource<Budget> | null;
  initialName?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const primaryQ = usePrimaryCurrency();
  const currenciesQ = useCurrencies();
  const currencies = (currenciesQ.data ?? []).filter((c) => c.attributes.enabled !== false);
  const primaryCode = primaryQ.data?.code ?? currencies[0]?.attributes.code ?? "USD";

  const isEdit = Boolean(budget);

  const [name, setName] = useState(() => (budget ? budget.attributes.name || "" : initialName));
  const [active, setActive] = useState(() => (budget ? budget.attributes.active !== false : true));
  const [autoBudgetType, setAutoBudgetType] = useState<AutoBudgetType>(() =>
    budget ? normalizeAutoBudgetType(budget.attributes.auto_budget_type) : "none",
  );
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(() =>
    budget ? budget.attributes.auto_budget_currency_code || null : null,
  );
  const [autoBudgetAmount, setAutoBudgetAmount] = useState(() =>
    budget && budget.attributes.auto_budget_amount ? String(budget.attributes.auto_budget_amount) : "",
  );
  const [autoBudgetPeriod, setAutoBudgetPeriod] = useState<AutoBudgetPeriod>(() =>
    budget ? normalizeAutoBudgetPeriod(budget.attributes.auto_budget_period) : "monthly",
  );
  const [notes, setNotes] = useState(() => (budget ? budget.attributes.notes || "" : ""));
  const [returnHere, setReturnHere] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; dataUrl: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currencyCode = selectedCurrency ?? primaryCode;

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setAttachments([]);
    if (budget) {
      const b = budget.attributes;
      setName(b.name || "");
      setActive(b.active !== false);
      setAutoBudgetType(normalizeAutoBudgetType(b.auto_budget_type));
      setSelectedCurrency(b.auto_budget_currency_code || null);
      setAutoBudgetAmount(b.auto_budget_amount ? String(b.auto_budget_amount) : "");
      setAutoBudgetPeriod(normalizeAutoBudgetPeriod(b.auto_budget_period));
      setNotes(b.notes || "");
    } else {
      setName(initialName);
      setActive(true);
      setAutoBudgetType("none");
      setSelectedCurrency(null);
      setAutoBudgetAmount("");
      setAutoBudgetPeriod("monthly");
      setNotes("");
    }
  }, [open, budget, initialName]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["budgets-list"] });
    qc.invalidateQueries({ queryKey: ["budget-limits"] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = buildBudgetPayload({
        name,
        active,
        autoBudgetType,
        currencyCode,
        autoBudgetAmount,
        autoBudgetPeriod,
        notes,
      });

      const res = isEdit && budget
        ? await api.updateBudget(budget.id, payload)
        : await api.createBudget(payload);

      const budgetId = res?.data?.id ?? budget?.id;
      if (budgetId && attachments.length > 0) {
        for (const file of attachments) {
          await api.uploadBudgetAttachment(budgetId, file);
        }
      }
      return res;
    },
    onSuccess: () => {
      invalidateAll();
      if (!isEdit && returnHere) {
        toast("Budget stored — ready to create another");
        setName("");
        setAutoBudgetAmount("");
        setNotes("");
        setAttachments([]);
      } else {
        toast(isEdit ? "Budget updated" : "Budget created");
        onClose();
      }
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!budget) return;
      await api.deleteBudget(budget.id);
    },
    onSuccess: () => {
      invalidateAll();
      toast("Budget deleted");
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) {
        toast(`${file.name} exceeds 100 MB limit`, "error");
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setAttachments((prev) => [
            ...prev,
            { name: file.name, type: file.type || "application/octet-stream", dataUrl: reader.result as string },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const selectedTypeMeta = AUTO_BUDGET_TYPES.find((t) => t.value === autoBudgetType);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={isEdit ? `Configure Budget · ${budget?.attributes.name}` : "Create a new budget"}
      subtitle={
        isEdit
          ? "Update budget settings, auto-budget schedule, active state, or attachments"
          : "Configure name, optional auto-budget schedule, currency, and attachments"
      }
      maxWidth="max-w-xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {/* Mandatory fields */}
        <div className="rounded-xl border border-border bg-surface-2/40 p-3.5 flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Mandatory fields</p>
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Groceries, Dining Out, Subscriptions"
                required
                autoFocus
              />
            )}
          </Field>
        </div>

        {/* Optional fields */}
        <div className="rounded-xl border border-border bg-surface-2/40 p-3.5 flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Optional fields</p>

          <Field label="Auto-budget" hint={selectedTypeMeta?.hint}>
            {(id) => (
              <Select
                id={id}
                value={autoBudgetType}
                onChange={(e) => setAutoBudgetType(e.target.value as AutoBudgetType)}
              >
                {AUTO_BUDGET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {autoBudgetType !== "none" && (
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-primary/20 bg-primary-soft/15 p-3">
              <Field label="Currency">
                {(id) => (
                  <Select
                    id={id}
                    value={currencyCode}
                    onChange={(e) => setSelectedCurrency(e.target.value)}
                  >
                    {currencies.length > 0 ? (
                      currencies.map((c) => (
                        <option key={c.id} value={c.attributes.code}>
                          {c.attributes.name} ({c.attributes.code})
                        </option>
                      ))
                    ) : (
                      <option value={currencyCode}>{currencyCode}</option>
                    )}
                  </Select>
                )}
              </Field>

              <Field label="Auto-budget period">
                {(id) => (
                  <Select
                    id={id}
                    value={autoBudgetPeriod}
                    onChange={(e) => setAutoBudgetPeriod(e.target.value as AutoBudgetPeriod)}
                  >
                    {AUTO_BUDGET_PERIODS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Auto-budget amount" className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={autoBudgetAmount}
                    onChange={(e) => setAutoBudgetAmount(e.target.value)}
                    placeholder={`Amount in ${currencyCode}`}
                    required
                  />
                )}
              </Field>
            </div>
          )}

          <Field label="Notes">
            {(id) => (
              <Input
                id={id}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this budget…"
              />
            )}
          </Field>

          <Field label="Attachments" hint="Maximum file size: 100 MB">
            {(id) => (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={id}
                  className="inline-flex cursor-pointer items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-fg hover:bg-surface-2 transition-colors"
                >
                  <Paperclip className="size-3.5 text-muted" />
                  <span>Choose Files</span>
                  <input
                    id={id}
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((att, idx) => (
                      <span
                        key={`${att.name}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs"
                      >
                        <span className="max-w-44 truncate">{att.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={`Remove ${att.name}`}
                          className="text-muted hover:text-danger cursor-pointer"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 rounded border-border accent-primary cursor-pointer"
            />
            <span>Active budget</span>
          </label>
        </div>

        {/* Options */}
        {!isEdit && (
          <div className="rounded-xl border border-border bg-surface-2/40 p-3.5 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Options</p>
            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={returnHere}
                onChange={(e) => setReturnHere(e.target.checked)}
                className="size-4 rounded border-border accent-primary cursor-pointer"
              />
              <span>After storing, return here to create another one.</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <div>
            {isEdit && !confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-soft/40"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" /> Delete budget
              </Button>
            )}
            {isEdit && confirmDelete && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={deleteMut.isPending}
                  onClick={() => deleteMut.mutate()}
                >
                  Confirm delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saveMut.isPending}>
              {isEdit ? "Save changes" : "Store new budget"}
            </Button>
          </div>
        </div>
      </form>
    </ModalSheet>
  );
}
