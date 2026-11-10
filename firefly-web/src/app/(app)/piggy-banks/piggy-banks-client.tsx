"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Minus, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { PiggyBank, Resource } from "@/lib/firefly/types";
import { useAccounts } from "@/lib/hooks";
import { formatDate, parseAmount } from "@/lib/utils";
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
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

export function PiggyBanksClient() {
  const qc = useQueryClient();
  const toast = useToast();

  const piggyQ = useQuery({ queryKey: ["piggy-banks"], queryFn: api.piggyBanks });
  const accountsQ = useAccounts("all");

  const assetAccounts = (accountsQ.data ?? []).filter(
    (a) => a.attributes.type === "asset" && a.attributes.active !== false,
  );

  const [showNew, setShowNew] = useState(false);
  useEscapeDismiss(showNew, () => setShowNew(false), "piggy-banks-new-form");
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("0");
  const [targetDate, setTargetDate] = useState("");
  const [adjustDelta, setAdjustDelta] = useState<Record<string, string>>({});

  const defaultAccountId = accountId || assetAccounts[0]?.id || "";

  const createMut = useMutation({
    mutationFn: async () => {
      const target = parseAmount(targetAmount);
      const current = parseAmount(currentAmount) || "0";
      if (!name.trim() || !target || !defaultAccountId) {
        throw new Error("Enter a name, account, and target amount.");
      }
      return api.createPiggyBank({
        name: name.trim(),
        account_id: defaultAccountId,
        target_amount: target,
        current_amount: current,
        target_date: targetDate || undefined,
      });
    },
    onSuccess: () => {
      toast("Piggy bank created");
      setShowNew(false);
      setName("");
      setTargetAmount("");
      setCurrentAmount("0");
      setTargetDate("");
      qc.invalidateQueries({ queryKey: ["piggy-banks"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const adjustMut = useMutation({
    mutationFn: async ({ p, sign }: { p: Resource<PiggyBank>; sign: 1 | -1 }) => {
      const raw = parseAmount(adjustDelta[p.id] || "");
      if (!raw || new Decimal(raw).lte(0)) throw new Error("Enter an amount to add or remove.");
      const next = Decimal.max(
        0,
        new Decimal(p.attributes.current_amount || 0).plus(new Decimal(raw).mul(sign)),
      );
      return api.updatePiggyBank(p.id, {
        name: p.attributes.name,
        account_id: p.attributes.account_id,
        target_amount: p.attributes.target_amount || "0",
        current_amount: next.toFixed(p.attributes.currency_decimal_places ?? 2),
        target_date: p.attributes.target_date,
        notes: p.attributes.notes,
      });
    },
    onSuccess: (_res, { p }) => {
      toast(`Updated ${p.attributes.name}`);
      setAdjustDelta((d) => ({ ...d, [p.id]: "" }));
      qc.invalidateQueries({ queryKey: ["piggy-banks"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.deletePiggyBank(id),
    onSuccess: () => {
      toast("Piggy bank deleted", "info");
      qc.invalidateQueries({ queryKey: ["piggy-banks"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const items = piggyQ.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Piggy Banks & Savings Goals"
        subtitle="Track savings goals attached to your asset accounts · Click any icon to customize"
        actions={
          <Button size="sm" onClick={() => setShowNew((s) => !s)}>
            <Plus className="size-4" aria-hidden /> New Piggy Bank
          </Button>
        }
      />

      {showNew && (
        <div className="rounded-xl border border-border bg-surface p-3.5 sm:p-4 shadow-2xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            className="grid gap-3 sm:grid-cols-4"
          >
            <Field label="Goal name">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Emergency Fund, New Car"
                  required
                />
              )}
            </Field>
            <Field label="Linked Asset Account">
              {(id) => (
                <Select id={id} value={defaultAccountId} onChange={(e) => setAccountId(e.target.value)}>
                  {assetAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.attributes.name} ({a.attributes.currency_code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Target amount">
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder="1000.000"
                  required
                />
              )}
            </Field>
            <Field label="Target date (optional)">
              {(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
            </Field>
            <div className="flex justify-end gap-2 sm:col-span-4">
              <Button type="button" variant="secondary" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMut.isPending}>
                Create Piggy Bank
              </Button>
            </div>
          </form>
        </div>
      )}

      <ErrorBox error={piggyQ.error} />

      {piggyQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No piggy banks yet">
            Create a piggy bank to set aside savings inside your asset accounts.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((p) => {
            const a = p.attributes;
            const cur = Number(a.current_amount || 0);
            const target = Number(a.target_amount || 0);
            const pct = target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : Number(a.percentage ?? 0);
            return (
              <Card key={p.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ResourceIconBadge entityType="piggy" entityId={p.id} defaultIcon="PiggyBank" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold">{a.name}</h2>
                        <Badge tone={pct >= 100 ? "success" : "primary"}>{pct}%</Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {a.account_name ?? "Account"}
                        {a.target_date && ` · Target ${formatDate(a.target_date)}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => delMut.mutate(p.id)}
                    aria-label={`Delete ${a.name}`}
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>

                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-bold">
                    <Money
                      amount={a.current_amount}
                      code={a.currency_code}
                      decimals={a.currency_decimal_places}
                      symbol={a.currency_symbol}
                    />
                  </span>
                  {a.target_amount && (
                    <span className="text-xs text-muted">
                      of{" "}
                      <Money
                        amount={a.target_amount}
                        code={a.currency_code}
                        decimals={a.currency_decimal_places}
                        symbol={a.currency_symbol}
                      />
                    </span>
                  )}
                </div>

                <Progress value={pct} tone={pct >= 100 ? "success" : "primary"} />

                <div className="flex items-center gap-2 pt-1">
                  <Input
                    inputMode="decimal"
                    value={adjustDelta[p.id] ?? ""}
                    onChange={(e) => setAdjustDelta((d) => ({ ...d, [p.id]: e.target.value }))}
                    placeholder={`Amount (${a.currency_code})`}
                    className="h-9 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => adjustMut.mutate({ p, sign: 1 })}
                    disabled={adjustMut.isPending}
                  >
                    <Plus className="size-3.5" aria-hidden /> Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => adjustMut.mutate({ p, sign: -1 })}
                    disabled={adjustMut.isPending}
                  >
                    <Minus className="size-3.5" aria-hidden /> Remove
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
