"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Account, NewSplit, Resource, TransactionGroup, TransactionSplit } from "@/lib/firefly/types";
import { ASSET_LIKE, useAccounts } from "@/lib/hooks";
import { isLiabilityAccount } from "@/lib/liability-actions";
import {
  cn,
  extractLocalDate,
  extractLocalTime,
  isoDateTimeWithOffset,
  monthRange,
  parseAmount,
} from "@/lib/utils";
import { AccountPicker } from "@/components/account-picker";
import { CategoryCascadeSelect } from "@/components/category-cascade";
import { TimeInput24h } from "@/components/time-input-24h";
import { Badge, Button, Field, Input, ModalSheet, Select } from "@/components/ui";
import { useToast } from "@/components/providers";

export interface EditSplitDraft {
  description: string;
  amount: string;
  foreignAmount: string;
  foreignCurrencyCode: string;
  date: string;
  time: string;
  sourceId: string;
  destId: string;
  counterparty: string;
  category: string;
  budgetId: string;
  tags: string;
  notes: string;
}

function splitToEditablePayload(split: TransactionSplit): Partial<NewSplit> {
  return {
    transaction_journal_id: split.transaction_journal_id,
    type: split.type,
    date: split.date,
    amount: String(Math.abs(Number(split.amount || 0))),
    description: split.description,
    source_id: split.source_id || undefined,
    source_name: split.source_id ? undefined : split.source_name || undefined,
    destination_id: split.destination_id || undefined,
    destination_name: split.destination_id ? undefined : split.destination_name || undefined,
    currency_code: split.currency_code || undefined,
    foreign_amount: split.foreign_amount ? String(Math.abs(Number(split.foreign_amount))) : undefined,
    foreign_currency_code: split.foreign_currency_code || undefined,
    category_name: split.type === "transfer" ? undefined : split.category_name ?? null,
    budget_id: split.type === "withdrawal" ? split.budget_id ?? null : undefined,
    tags: split.tags ?? [],
    notes: split.notes ?? null,
  };
}

/**
 * Pure builder for Firefly III `PUT /api/v1/transactions/{id}` split payloads.
 * Preserves `transaction_journal_id` (audit trail), multi-split siblings,
 * liability links, cross-currency amounts, and explicit field clearing.
 */
export function buildEditTransactionPayload({
  splits,
  activeSplitIndex = 0,
  draft,
  liabilityAccounts = [],
}: {
  splits: TransactionSplit[];
  activeSplitIndex?: number;
  draft: EditSplitDraft;
  liabilityAccounts?: Resource<Account>[];
}): Partial<NewSplit>[] {
  const target = splits[activeSplitIndex];
  if (!target) throw new Error("Transaction split not found.");

  const parsedAmt = parseAmount(draft.amount);
  if (!parsedAmt || Number(parsedAmt) <= 0) {
    throw new Error("Enter a valid amount greater than zero.");
  }

  const txType = target.type;
  const trimmedCounterparty = draft.counterparty.trim();
  const matchedLiability = trimmedCounterparty
    ? liabilityAccounts.find(
        (a) => a.attributes.name.trim().toLowerCase() === trimmedCounterparty.toLowerCase(),
      ) ?? null
    : null;

  let accountFields: Partial<NewSplit> = {};
  if (txType === "transfer") {
    accountFields = {
      source_id: draft.sourceId || target.source_id || undefined,
      destination_id: draft.destId || target.destination_id || undefined,
    };
  } else if (txType === "deposit") {
    const unchangedSource =
      trimmedCounterparty.toLowerCase() === (target.source_name ?? "").trim().toLowerCase() &&
      Boolean(target.source_id);
    accountFields = {
      destination_id: draft.sourceId || target.destination_id || undefined,
      ...(matchedLiability
        ? { source_id: matchedLiability.id }
        : unchangedSource
          ? { source_id: target.source_id || undefined }
          : trimmedCounterparty
            ? { source_name: trimmedCounterparty }
            : target.source_id
              ? { source_id: target.source_id || undefined }
              : {}),
    };
  } else if (txType === "withdrawal") {
    const unchangedDest =
      trimmedCounterparty.toLowerCase() === (target.destination_name ?? "").trim().toLowerCase() &&
      Boolean(target.destination_id);
    accountFields = {
      source_id: draft.sourceId || target.source_id || undefined,
      ...(matchedLiability
        ? { destination_id: matchedLiability.id }
        : unchangedDest
          ? { destination_id: target.destination_id || undefined }
          : trimmedCounterparty
            ? { destination_name: trimmedCounterparty }
            : target.destination_id
              ? { destination_id: target.destination_id || undefined }
              : {}),
    };
  } else {
    // opening balance / reconciliation: keep original account bindings intact
    accountFields = {
      source_id: target.source_id || undefined,
      destination_id: target.destination_id || undefined,
    };
  }

  const parsedForeign = draft.foreignAmount.trim() ? parseAmount(draft.foreignAmount) : "";
  const foreignFields: Partial<NewSplit> =
    draft.foreignCurrencyCode && parsedForeign && Number(parsedForeign) > 0
      ? {
          foreign_amount: parsedForeign,
          foreign_currency_code: draft.foreignCurrencyCode,
        }
      : target.foreign_currency_code && !draft.foreignAmount.trim()
        ? {
            foreign_amount: null,
            foreign_currency_code: null,
          }
        : {};

  const isNonEditableClassification =
    txType === "transfer" || txType === "opening balance" || txType === "reconciliation";

  const editedSplit: Partial<NewSplit> = {
    transaction_journal_id: target.transaction_journal_id,
    type: txType,
    description: draft.description.trim() || target.description || "Transaction",
    amount: parsedAmt,
    date: draft.date
      ? isoDateTimeWithOffset(draft.date, draft.time)
      : target.date || isoDateTimeWithOffset(),
    ...accountFields,
    ...foreignFields,
    category_name: isNonEditableClassification ? undefined : draft.category.trim() || null,
    budget_id: txType === "withdrawal" ? draft.budgetId || null : undefined,
    tags: draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    notes: draft.notes.trim() || null,
  };

  return splits.map((s, idx) =>
    idx === activeSplitIndex ? editedSplit : splitToEditablePayload(s),
  );
}

function makeInitialDraft(split: TransactionSplit | undefined): EditSplitDraft {
  const txType = split?.type ?? "withdrawal";
  return {
    description: split?.description ?? "",
    amount: String(Math.abs(Number(split?.amount ?? 0))),
    foreignAmount: split?.foreign_amount ? String(Math.abs(Number(split.foreign_amount))) : "",
    foreignCurrencyCode: split?.foreign_currency_code ?? "",
    date: extractLocalDate(split?.date),
    time: extractLocalTime(split?.date),
    sourceId:
      txType === "deposit" ? (split?.destination_id ?? "") : (split?.source_id ?? ""),
    destId: txType === "transfer" ? (split?.destination_id ?? "") : "",
    counterparty:
      txType === "deposit"
        ? (split?.source_name ?? "")
        : txType === "withdrawal"
          ? (split?.destination_name ?? "")
          : "",
    category: split?.category_name ?? "",
    budgetId: split?.budget_id ?? "",
    tags: (split?.tags ?? []).join(", "),
    notes: split?.notes ?? "",
  };
}

export interface EditTransactionModalProps {
  group: Resource<TransactionGroup>;
  accounts?: Awaited<ReturnType<typeof api.accounts>>;
  categories?: Awaited<ReturnType<typeof api.categories>>;
  budgets?: Awaited<ReturnType<typeof api.budgets>>;
  onClose: () => void;
  onSaved?: (updated: Resource<TransactionGroup>) => void;
}

export function EditTransactionModal({
  group,
  accounts: accountsProp,
  categories: categoriesProp,
  budgets: budgetsProp,
  onClose,
  onSaved,
}: EditTransactionModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const listId = useId();
  const [open, setOpen] = useState(true);

  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 240);
  };

  const splits = group.attributes.transactions;
  const [activeSplitIdx, setActiveSplitIdx] = useState(0);
  const activeSplit = splits[activeSplitIdx] ?? splits[0];
  const txType = activeSplit?.type ?? "withdrawal";
  const isSystemType = txType === "opening balance" || txType === "reconciliation";

  const [groupTitle, setGroupTitle] = useState(group.attributes.group_title ?? "");
  const [draft, setDraft] = useState<EditSplitDraft>(() => makeInitialDraft(activeSplit));

  // Shared cached lookups so EditTransactionModal works from any screen (Dashboard, Account Detail, Records, Rules)
  const allAccountsQ = useAccounts("all");
  const month = useMemo(() => monthRange(0), []);
  const categoriesQ = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => api.categories(),
    enabled: !categoriesProp,
    staleTime: 5 * 60_000,
  });
  const budgetsQ = useQuery({
    queryKey: ["budgets-list"],
    queryFn: () => api.budgets(month.start, month.end),
    enabled: !budgetsProp && txType === "withdrawal",
    staleTime: 5 * 60_000,
  });
  const tagsQ = useQuery({
    queryKey: ["tags-list"],
    queryFn: api.tags,
    staleTime: 5 * 60_000,
  });

  const allAccounts = useMemo(() => allAccountsQ.data ?? [], [allAccountsQ.data]);
  const assetAccounts = useMemo(() => {
    if (accountsProp && accountsProp.length > 0) return accountsProp;
    return allAccounts.filter(
      (a) => ASSET_LIKE.has(a.attributes.type) && a.attributes.active !== false,
    );
  }, [accountsProp, allAccounts]);

  const liabilityAccounts = useMemo(
    () =>
      allAccounts.filter(
        (a) =>
          isLiabilityAccount(a) &&
          a.attributes.active !== false &&
          !/^initial balance for/i.test(a.attributes.name || ""),
      ),
    [allAccounts],
  );

  const counterpartySuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const acc of liabilityAccounts) {
      if (acc.attributes.name) names.add(acc.attributes.name);
    }
    const targetType = txType === "deposit" ? "revenue" : "expense";
    for (const acc of allAccounts) {
      if (acc.attributes.type === targetType && acc.attributes.name) {
        names.add(acc.attributes.name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [allAccounts, liabilityAccounts, txType]);

  const categories = categoriesProp ?? categoriesQ.data;
  const budgets = budgetsProp ?? budgetsQ.data;

  // Detect source/destination currencies for cross-currency transfer or foreign expense editing
  const sourceAcc = assetAccounts.find((a) => a.id === draft.sourceId);
  const destAcc = assetAccounts.find((a) => a.id === draft.destId);
  const primaryCurrencyCode =
    sourceAcc?.attributes.currency_code || activeSplit?.currency_code || "";
  const effectiveForeignCurrencyCode =
    txType === "transfer" &&
    sourceAcc?.attributes.currency_code &&
    destAcc?.attributes.currency_code &&
    sourceAcc.attributes.currency_code !== destAcc.attributes.currency_code
      ? destAcc.attributes.currency_code
      : draft.foreignCurrencyCode || activeSplit?.foreign_currency_code || "";
  const showForeignAmount = Boolean(effectiveForeignCurrencyCode);

  const switchSplit = (nextIdx: number) => {
    if (nextIdx === activeSplitIdx || !splits[nextIdx]) return;
    setActiveSplitIdx(nextIdx);
    setDraft(makeInitialDraft(splits[nextIdx]));
  };

  const updateMut = useMutation({
    mutationFn: async () => {
      const payload = buildEditTransactionPayload({
        splits,
        activeSplitIndex: activeSplitIdx,
        draft: {
          ...draft,
          foreignCurrencyCode: effectiveForeignCurrencyCode,
        },
        liabilityAccounts,
      });
      return api.updateTransaction(
        group.id,
        payload,
        splits.length > 1 ? groupTitle.trim() || group.attributes.group_title || undefined : undefined,
      );
    },
    onSuccess: (res) => {
      const queuedOffline = Boolean(
        (res as unknown as { __offlineQueued?: boolean })?.__offlineQueued,
      );
      toast(
        queuedOffline ? "Edit queued offline — will sync when online" : "Transaction updated",
        queuedOffline ? "info" : "success",
      );
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["account-transactions-30d"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets-list"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      if (res?.data) onSaved?.(res.data);
      handleClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  if (!activeSplit) return null;

  const typeLabel =
    txType === "deposit"
      ? "Income"
      : txType === "transfer"
        ? "Transfer"
        : txType === "opening balance"
          ? "Opening balance"
          : txType === "reconciliation"
            ? "Reconciliation"
            : "Expense";

  return (
    <ModalSheet
      open={open}
      onClose={handleClose}
      title="Edit Transaction"
      subtitle={`${typeLabel} · ${activeSplit.source_name ?? ""} → ${activeSplit.destination_name ?? ""}${primaryCurrencyCode ? ` (${primaryCurrencyCode})` : ""}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMut.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {splits.length > 1 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">
                Split transaction ({splits.length} splits)
              </span>
              <Badge tone="primary">Other splits preserved</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {splits.map((sp, idx) => (
                <button
                  key={sp.transaction_journal_id ?? idx}
                  type="button"
                  onClick={() => switchSplit(idx)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    idx === activeSplitIdx
                      ? "bg-primary text-primary-fg"
                      : "border border-border bg-surface text-muted hover:text-fg",
                  )}
                >
                  #{idx + 1}: {sp.description || "Split"}
                </button>
              ))}
            </div>
            <Field label="Group title">
              {(id) => (
                <Input
                  id={id}
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Optional group title"
                />
              )}
            </Field>
          </div>
        )}

        <div className={cn("grid gap-3", showForeignAmount ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <Field label="Description">
            {(id) => (
              <Input
                id={id}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                required
              />
            )}
          </Field>
          <Field label={`Amount${primaryCurrencyCode ? ` (${primaryCurrencyCode})` : ""}`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                required
              />
            )}
          </Field>
          {showForeignAmount && (
            <Field
              label={
                txType === "transfer"
                  ? `Received (${effectiveForeignCurrencyCode})`
                  : `Foreign (${effectiveForeignCurrencyCode})`
              }
            >
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={draft.foreignAmount}
                  onChange={(e) => setDraft((d) => ({ ...d, foreignAmount: e.target.value }))}
                  placeholder="0.00"
                />
              )}
            </Field>
          )}
        </div>

        {!isSystemType && assetAccounts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <AccountPicker
              label={txType === "deposit" ? "To account" : "From account"}
              accounts={assetAccounts}
              value={draft.sourceId || null}
              onChange={(id) => setDraft((d) => ({ ...d, sourceId: id }))}
            />
            {txType === "transfer" ? (
              <AccountPicker
                label="To account"
                accounts={assetAccounts}
                value={draft.destId || null}
                excludeId={draft.sourceId || null}
                onChange={(id) => setDraft((d) => ({ ...d, destId: id }))}
              />
            ) : (
              <Field
                label={
                  txType === "deposit"
                    ? "Payer (or Liability)"
                    : "Payee / Merchant (or Liability)"
                }
              >
                {(id) => (
                  <>
                    <Input
                      id={id}
                      list={`${listId}-counterparty`}
                      value={draft.counterparty}
                      onChange={(e) => setDraft((d) => ({ ...d, counterparty: e.target.value }))}
                      placeholder={
                        txType === "deposit"
                          ? "e.g. Employer or Liability name"
                          : "e.g. Supermarket or Liability name"
                      }
                    />
                    <datalist id={`${listId}-counterparty`}>
                      {counterpartySuggestions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            )}
          </div>
        )}

        {txType !== "transfer" && !isSystemType && (
          <CategoryCascadeSelect
            categories={categories}
            value={draft.category}
            onChange={(nextCategory) => setDraft((d) => ({ ...d, category: nextCategory }))}
          />
        )}

        <div
          className={cn(
            "grid gap-3",
            txType === "withdrawal" ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
          <Field label="Date">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                required
              />
            )}
          </Field>
          <Field label="Time">
            {(id) => (
              <TimeInput24h
                id={id}
                value={draft.time}
                onChange={(nextTime) => setDraft((d) => ({ ...d, time: nextTime }))}
                required
              />
            )}
          </Field>

          {txType === "withdrawal" && (
            <Field label="Budget">
              {(id) => (
                <Select
                  id={id}
                  value={draft.budgetId}
                  onChange={(e) => setDraft((d) => ({ ...d, budgetId: e.target.value }))}
                >
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
          {(id) => (
            <>
              <Input
                id={id}
                list={`${listId}-tags`}
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="e.g. food, tech, transport"
              />
              <datalist id={`${listId}-tags`}>
                {tagsQ.data?.map((t) => (
                  <option key={t.id} value={t.attributes.tag} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Optional notes or memos…"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={updateMut.isPending}>
            <Check className="size-4" aria-hidden /> Save changes
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
