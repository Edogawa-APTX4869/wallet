"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Pencil,
  Plus,
  Receipt,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { api, getAll } from "@/lib/firefly/api";
import type { Account, TransactionGroup } from "@/lib/firefly/types";
import { inferAccountDefaultStyle, ResourceIconBadge } from "@/components/resource-icon";
import { TransactionRow } from "@/components/transaction-row";
import { cn, formatDate, isoDate } from "@/lib/utils";
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
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";

export interface AccountKpiStats {
  inflow: Decimal;
  outflow: Decimal;
  netChange: Decimal;
  count: number;
}

export function computeAccount30dKpi(
  groups: Array<{ attributes: { transactions: Array<{ type: string; amount: string; destination_id?: string | null; source_id?: string | null; foreign_amount?: string | null }> } }>,
  accountId: string,
): AccountKpiStats {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);
  let count = 0;

  for (const group of groups || []) {
    for (const split of group.attributes?.transactions || []) {
      let rawDec: Decimal;
      try {
        rawDec = new Decimal(split.amount || "0");
      } catch {
        rawDec = new Decimal(0);
      }
      const amt = rawDec.abs();

      if (split.type === "deposit") {
        if (split.destination_id === accountId || !split.destination_id) {
          inflow = inflow.plus(amt);
          count++;
        }
      } else if (split.type === "withdrawal") {
        if (split.source_id === accountId) {
          outflow = outflow.plus(amt);
          count++;
        }
      } else if (split.type === "transfer") {
        let matched = false;
        if (split.destination_id === accountId) {
          let destAmt = amt;
          if (split.foreign_amount && split.foreign_amount.trim()) {
            try {
              destAmt = new Decimal(split.foreign_amount.trim()).abs();
            } catch {
              destAmt = amt;
            }
          }
          inflow = inflow.plus(destAmt);
          matched = true;
        }
        if (split.source_id === accountId) {
          outflow = outflow.plus(amt);
          matched = true;
        }
        if (matched) {
          count++;
        }
      } else if (split.type === "opening balance" || split.type === "reconciliation") {
        if (split.destination_id === accountId && split.source_id !== accountId) {
          inflow = inflow.plus(amt);
          count++;
        } else if (split.source_id === accountId && split.destination_id !== accountId) {
          outflow = outflow.plus(amt);
          count++;
        } else if (
          split.destination_id === accountId ||
          split.source_id === accountId ||
          (!split.destination_id && !split.source_id)
        ) {
          if (rawDec.gte(0)) {
            inflow = inflow.plus(amt);
          } else {
            outflow = outflow.plus(amt);
          }
          count++;
        }
      }
    }
  }

  return {
    inflow,
    outflow,
    netChange: inflow.minus(outflow),
    count,
  };
}

export function formatAccountRole(roleOrType?: string | null): string {
  if (!roleOrType) return "—";
  switch (roleOrType) {
    case "defaultAsset":
      return "Default asset account";
    case "savingAsset":
      return "Savings account";
    case "sharedAsset":
      return "Shared asset account";
    case "ccAsset":
      return "Credit card account";
    case "cashWalletAsset":
      return "Cash wallet";
    case "loan":
      return "Loan liability";
    case "debt":
      return "Debt liability";
    case "mortgage":
      return "Mortgage liability";
    case "asset":
      return "Asset account";
    case "liability":
    case "liabilities":
      return "Liability account";
    case "expense":
      return "Expense account";
    case "revenue":
      return "Revenue account";
    default:
      return roleOrType;
  }
}

export function AccountDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const accQ = useQuery({
    queryKey: ["account", id],
    queryFn: () => api.account(id),
  });

  const txQ = useInfiniteQuery({
    queryKey: ["transactions", "account", id],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.accountTransactions(id, pageParam),
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      return p && p.current_page < p.total_pages ? p.current_page + 1 : undefined;
    },
  });

  const { start30d, end30d } = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start30d: isoDate(start), end30d: isoDate(end) };
  }, []);

  const kpiQ = useQuery({
    queryKey: ["account-transactions-30d", id, start30d, end30d],
    queryFn: () => getAll<TransactionGroup>(`accounts/${id}/transactions`, { start: start30d, end: end30d }),
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    return computeAccount30dKpi(kpiQ.data ?? [], id);
  }, [kpiQ.data, id]);

  const delMut = useMutation({
    mutationFn: (txId: string) => api.deleteTransaction(txId),
    onSuccess: () => {
      toast("Transaction deleted", "info");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["account-transactions-30d", id] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const updateMut = useMutation({
    mutationFn: (payload: Partial<Account>) => api.updateAccount(id, payload),
    onSuccess: () => {
      toast("Account updated successfully", "success");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // Keyboard shortcut 'e' to quickly edit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEditing(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const a = accQ.data?.attributes;
  const inferred = a ? inferAccountDefaultStyle(a, Number(id) || 0) : { icon: "Landmark", color: "#6366f1" };
  const groups = txQ.data?.pages.flatMap((p) => p.data) ?? [];

  const openingDate = a?.opening_balance_date
    ? formatDate(a.opening_balance_date)
    : (() => {
        for (const group of groups) {
          for (const split of group.attributes.transactions) {
            if (split.type === "opening balance" && split.date) {
              return formatDate(split.date);
            }
          }
        }
        return "—";
      })();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Back to accounts
        </Link>
      </div>

      {accQ.isLoading ? (
        <Skeleton className="h-24" />
      ) : a ? (
        <PageHeader
          title={
            <div className="flex items-center gap-3">
              <ResourceIconBadge
                entityType="account"
                entityId={id}
                defaultIcon={inferred.icon}
                defaultColor={inferred.color}
                size="lg"
                editable
              />
              <span className="truncate">{a.name}</span>
            </div>
          }
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge>{a.account_role || a.type}</Badge>
              {a.currency_code && <Badge tone="primary">{a.currency_code}</Badge>}
              {a.iban && <span className="font-mono text-xs">IBAN: {a.iban}</span>}
              {a.account_number && <span className="font-mono text-xs">#{a.account_number}</span>}
              {a.include_net_worth === false && <Badge tone="warning">Excluded from net worth</Badge>}
              {a.active === false && <Badge tone="danger">Inactive</Badge>}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-muted">Current balance</p>
                <p className="text-2xl font-bold">
                  <Money
                    animated
                    amount={a.current_balance}
                    code={a.currency_code}
                    decimals={a.currency_decimal_places}
                    symbol={a.currency_symbol}
                  />
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(true)}
                title="Edit account details (Shortcut: E)"
              >
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
              <Link href="/new?type=transfer">
                <Button variant="secondary" size="sm">
                  <ArrowLeftRight className="size-4" aria-hidden /> Transfer
                </Button>
              </Link>
              <Link href="/new?type=withdrawal">
                <Button size="sm">
                  <Plus className="size-4" aria-hidden /> New
                </Button>
              </Link>
            </div>
          }
        />
      ) : null}

      <ErrorBox error={accQ.error || txQ.error || kpiQ.error} />

      {/* 30-Day KPI Summary Cards */}
      {kpiQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {/* Inflow Card */}
          <Card className="flex flex-col justify-between gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">30D Inflow</span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-success-soft text-success">
                <ArrowDownLeft className="size-4" aria-hidden />
              </span>
            </div>
            <div>
              <p className="text-lg font-bold sm:text-xl">
                <Money
                  amount={stats.inflow.toString()}
                  code={a?.currency_code}
                  decimals={a?.currency_decimal_places}
                  symbol={a?.currency_symbol}
                />
              </p>
              <p className="text-[11px] text-muted">Total received (30d)</p>
            </div>
          </Card>

          {/* Outflow Card */}
          <Card className="flex flex-col justify-between gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">30D Outflow</span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-danger-soft text-danger">
                <ArrowUpRight className="size-4" aria-hidden />
              </span>
            </div>
            <div>
              <p className="text-lg font-bold sm:text-xl">
                <Money
                  amount={stats.outflow.toString()}
                  code={a?.currency_code}
                  decimals={a?.currency_decimal_places}
                  symbol={a?.currency_symbol}
                />
              </p>
              <p className="text-[11px] text-muted">Total spent (30d)</p>
            </div>
          </Card>

          {/* Net 30D Change Card */}
          <Card className="flex flex-col justify-between gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Net 30D Change</span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg",
                  stats.netChange.gte(0)
                    ? "bg-success-soft text-success"
                    : "bg-danger-soft text-danger",
                )}
              >
                {stats.netChange.gte(0) ? (
                  <TrendingUp className="size-4" aria-hidden />
                ) : (
                  <TrendingDown className="size-4" aria-hidden />
                )}
              </span>
            </div>
            <div>
              <p
                className={cn(
                  "text-lg font-bold sm:text-xl",
                  stats.netChange.gte(0) ? "text-success" : "text-danger",
                )}
              >
                <Money
                  amount={stats.netChange.toString()}
                  code={a?.currency_code}
                  decimals={a?.currency_decimal_places}
                  symbol={a?.currency_symbol}
                  signed
                />
              </p>
              <p className="text-[11px] text-muted">Inflow vs outflow</p>
            </div>
          </Card>

          {/* 30D Transactions Count Card */}
          <Card className="flex flex-col justify-between gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">30D Transactions</span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Receipt className="size-4" aria-hidden />
              </span>
            </div>
            <div>
              <p className="text-lg font-bold sm:text-xl">{stats.count}</p>
              <p className="text-[11px] text-muted">Total entries in 30 days</p>
            </div>
          </Card>
        </div>
      )}

      {/* Account Metadata Card */}
      {a && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-fg">Account Metadata</h2>
            <div className="flex items-center gap-2">
              {a.liability_type && (
                <Badge tone="warning">Liability: {a.liability_type}</Badge>
              )}
              {a.liability_direction && (
                <Badge tone="neutral">
                  {a.liability_direction === "credit" ? "Owed to me" : "I owe"}
                </Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-muted">IBAN</p>
              <p className="mt-1 font-mono text-sm font-medium">{a.iban || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Role</p>
              <p className="mt-1 text-sm font-medium">{formatAccountRole(a.account_role || a.liability_type || a.type)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Opening balance date</p>
              <p className="mt-1 text-sm font-medium">{openingDate}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Currency</p>
              <p className="mt-1 text-sm font-medium">
                {a.currency_code ? `${a.currency_code}${a.currency_symbol ? ` (${a.currency_symbol})` : ""}` : "—"}
              </p>
            </div>
          </div>
          {a.notes ? (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-fg/90">{a.notes}</p>
            </div>
          ) : (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">Notes</p>
              <p className="mt-1 text-xs italic text-muted">No notes recorded</p>
            </div>
          )}
        </Card>
      )}

      <Card>
        {txQ.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title="No transactions for this account yet" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {groups.map((g) => (
                <TransactionRow
                  key={g.id}
                  group={g}
                  perspectiveAccountId={id}
                  onDelete={(txId) => delMut.mutate(txId)}
                />
              ))}
            </ul>
            {txQ.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={txQ.isFetchingNextPage}
                  onClick={() => txQ.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Edit Account Modal with smooth exit */}
      {a && (
        <EditAccountModal
          open={editing}
          account={a}
          onClose={() => setEditing(false)}
          onSave={(payload) => updateMut.mutate(payload)}
          isSaving={updateMut.isPending}
        />
      )}
    </div>
  );
}

export function EditAccountModal({
  open,
  account,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  account: Account;
  onClose: () => void;
  onSave: (payload: Partial<Account>) => void;
  isSaving: boolean;
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

  return (
    <EditAccountModalContent
      open={open}
      account={account}
      onClose={onClose}
      onSave={onSave}
      isSaving={isSaving}
    />
  );
}

function EditAccountModalContent({
  open,
  account,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  account: Account;
  onClose: () => void;
  onSave: (payload: Partial<Account>) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.account_role || "defaultAsset");
  const [liabilityType, setLiabilityType] = useState(account.liability_type || "loan");
  const [liabilityDirection, setLiabilityDirection] = useState(account.liability_direction || "debit");
  const [iban, setIban] = useState(account.iban || "");
  const [accountNumber, setAccountNumber] = useState(account.account_number || "");
  const [active, setActive] = useState(account.active ?? true);
  const [includeNetWorth, setIncludeNetWorth] = useState(account.include_net_worth ?? true);
  const [notes, setNotes] = useState(account.notes || "");

  const isAsset = account.type === "asset";
  const isLiability = account.type === "liability" || account.type === "liabilities";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      ...(isAsset ? { account_role: role || undefined } : {}),
      ...(isLiability
        ? {
            liability_type: liabilityType || undefined,
            liability_direction: liabilityDirection || undefined,
          }
        : {}),
      iban: iban.trim() || undefined,
      account_number: accountNumber.trim() || undefined,
      active,
      include_net_worth: includeNetWorth,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title="Edit Account"
      subtitle={`Update settings for ${account.name}`}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Account name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Checking, Savings, Cash"
              required
              autoFocus
            />
          )}
        </Field>

        {isAsset && (
          <Field label="Account role">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="defaultAsset">Default asset account</option>
                <option value="savingAsset">Savings account</option>
                <option value="sharedAsset">Shared asset account</option>
                <option value="ccAsset">Credit card account</option>
                <option value="cashWalletAsset">Cash wallet</option>
              </Select>
            )}
          </Field>
        )}

        {isLiability && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Liability type">
              {(id) => (
                <Select id={id} value={liabilityType} onChange={(e) => setLiabilityType(e.target.value)}>
                  <option value="loan">Loan</option>
                  <option value="debt">Debt</option>
                  <option value="mortgage">Mortgage</option>
                </Select>
              )}
            </Field>

            <Field label="Liability direction">
              {(id) => (
                <Select
                  id={id}
                  value={liabilityDirection}
                  onChange={(e) => setLiabilityDirection(e.target.value)}
                >
                  <option value="debit">I owe this debt (debit)</option>
                  <option value="credit">I am owed this debt (credit)</option>
                </Select>
              )}
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="IBAN">
            {(id) => (
              <Input
                id={id}
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="e.g. BH00ABCD0123456789"
              />
            )}
          </Field>
          <Field label="Account number">
            {(id) => (
              <Input
                id={id}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 100200300"
              />
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
            <span>Active account</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 cursor-pointer rounded accent-primary"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
            <span>Include in net worth calculations</span>
            <input
              type="checkbox"
              checked={includeNetWorth}
              onChange={(e) => setIncludeNetWorth(e.target.checked)}
              className="size-4 cursor-pointer rounded accent-primary"
            />
          </label>
        </div>

        <Field label="Notes / description (optional)">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional information about this account…"
              className="w-full rounded-xl border border-border bg-surface p-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          )}
        </Field>

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            Save changes
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
