"use client";

import Link from "next/link";
import Decimal from "decimal.js";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Account, Bill, PiggyBank, Resource, TransactionGroup } from "@/lib/firefly/types";
import type { DashboardCardConfig } from "@/lib/dashboard-cards";
import { formatDate, isoDate } from "@/lib/utils";
import { ResourceIconBadge } from "@/components/resource-icon";
import { Badge, EmptyState, Money, Progress } from "@/components/ui";

export interface ExtraCardContext {
  transactions: Array<Resource<TransactionGroup>>;
  allTransactions?: Array<Resource<TransactionGroup>>;
  accounts: Array<Resource<Account>>;
  allAccounts?: Array<Resource<Account>>;
  toPrimary: (amount: string | number | Decimal, code?: string | null) => Decimal;
  primaryCode: string;
  primaryDecimals: number;
  primarySymbol?: string | null;
  balancesByCurrency: Array<{ code: string; decimals: number; symbol?: string | null; total: Decimal }>;
  bills: Array<Resource<Bill>>;
  piggies: Array<Resource<PiggyBank>>;
  barData: Array<{ name: string; Income: number; Expense: number }>;
  trendData: Array<{ date: string; Balance: number }>;
}

const LIABILITY_TYPES = new Set(["liability", "liabilities", "loan", "debt", "mortgage"]);

/** Transactions within the card's period (by split date). */
export function inPeriod(txs: Array<Resource<TransactionGroup>>, days: number) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromIso = isoDate(from);
  return txs.filter((g) => (g.attributes.transactions[0]?.date ?? "").slice(0, 10) >= fromIso);
}

interface GroupedExpenseRow {
  id: string;
  name: string;
  total: Decimal;
  count: number;
  href: string;
}

function groupExpenses(
  ctx: ExtraCardContext,
  days: number,
  extract: (s: TransactionGroup["transactions"][number]) => { id: string; name: string; href: string },
): GroupedExpenseRow[] {
  const map = new Map<string, GroupedExpenseRow>();
  for (const g of inPeriod(ctx.transactions, days)) {
    for (const s of g.attributes.transactions) {
      if (s.type !== "withdrawal") continue;
      const info = extract(s);
      const key = info.name || "(Uncategorised)";
      const cur = map.get(key) ?? {
        id: info.id || key,
        name: key,
        total: new Decimal(0),
        count: 0,
        href: info.href,
      };
      cur.total = cur.total.plus(ctx.toPrimary(new Decimal(s.amount || 0).abs(), s.currency_code));
      cur.count++;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.total.cmp(a.total));
}

function PrimaryMoney({
  ctx,
  value,
  animated = false,
}: {
  ctx: ExtraCardContext;
  value: Decimal | number;
  animated?: boolean;
}) {
  return (
    <Money
      amount={new Decimal(value).toFixed(ctx.primaryDecimals)}
      code={ctx.primaryCode}
      decimals={ctx.primaryDecimals}
      symbol={ctx.primarySymbol}
      animated={animated}
    />
  );
}

function RankedBars({
  ctx,
  rows,
  limit,
  entityType,
}: {
  ctx: ExtraCardContext;
  rows: GroupedExpenseRow[];
  limit: number;
  entityType?: "category" | "account";
}) {
  if (rows.length === 0) return <EmptyState title="No expenses in this period" />;
  const max = rows[0].total.toNumber() || 1;
  const total = rows.reduce((acc, r) => acc.plus(r.total), new Decimal(0));
  return (
    <div className="flex flex-1 flex-col gap-2.5">
      {rows.slice(0, limit).map((r) => {
        const pct = Math.round((r.total.toNumber() / max) * 100);
        const share = total.gt(0) ? Math.round(r.total.div(total).mul(100).toNumber()) : 0;
        return (
          <Link
            key={r.name}
            href={r.href}
            className="interactive-row flex flex-col gap-1.5 rounded-xl p-1.5 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                {entityType && (
                  <ResourceIconBadge
                    entityType={entityType}
                    entityId={r.id}
                    defaultIcon={entityType === "category" ? "FolderTree" : "Landmark"}
                    size="sm"
                  />
                )}
                <span className="truncate">{r.name.replace(/\s*:\s*/g, " › ")}</span>
                <span className="shrink-0 text-xs text-muted">· {r.count}×</span>
              </span>
              <span className="tabular shrink-0 font-semibold text-danger">
                <PrimaryMoney ctx={ctx} value={r.total} />{" "}
                <span className="text-xs font-normal text-muted">({share}%)</span>
              </span>
            </div>
            <Progress value={pct} tone="danger" />
          </Link>
        );
      })}
    </div>
  );
}

export function ExtraCard({ card, ctx }: { card: DashboardCardConfig; ctx: ExtraCardContext }) {
  const days = card.periodDays;
  const limit = card.recordLimit || 5;

  switch (card.key) {
    case "top_categories":
      return (
        <RankedBars
          ctx={ctx}
          entityType="category"
          rows={groupExpenses(ctx, days, (s) => {
            const name = s.category_name || "Uncategorised";
            return {
              id: s.category_id || name,
              name,
              href: s.category_name
                ? `/transactions?category=${encodeURIComponent(s.category_name)}`
                : "/transactions?type=withdrawal",
            };
          })}
          limit={limit}
        />
      );

    case "top_payees":
      return (
        <RankedBars
          ctx={ctx}
          rows={groupExpenses(ctx, days, (s) => {
            const name = s.destination_name || "Unknown payee";
            return {
              id: s.destination_id || name,
              name,
              href: `/transactions?query=${encodeURIComponent(name)}`,
            };
          })}
          limit={limit}
        />
      );

    case "spending_by_account":
      return (
        <RankedBars
          ctx={ctx}
          entityType="account"
          rows={groupExpenses(ctx, days, (s) => {
            const name = s.source_name || "Account";
            return {
              id: s.source_id || name,
              name,
              href: s.source_id
                ? `/transactions?accountId=${encodeURIComponent(s.source_id)}`
                : `/transactions?query=${encodeURIComponent(name)}`,
            };
          })}
          limit={limit}
        />
      );

    case "largest_expenses": {
      const rows = inPeriod(ctx.transactions, days)
        .flatMap((g) => g.attributes.transactions.map((s) => ({ g, s })))
        .filter(({ s }) => s.type === "withdrawal")
        .sort((a, b) => new Decimal(b.s.amount || 0).abs().cmp(new Decimal(a.s.amount || 0).abs()))
        .slice(0, limit);
      if (rows.length === 0) return <EmptyState title="No expenses in this period" />;
      return (
        <ul className="flex-1 divide-y divide-border">
          {rows.map(({ g, s }, i) => (
            <li key={`${g.id}-${i}`}>
              <Link
                href={`/transactions?query=${encodeURIComponent(s.description)}`}
                className="interactive-row flex items-center justify-between gap-2 rounded-lg px-1.5 py-2 text-sm transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.description}</span>
                  <span className="text-xs text-muted">
                    {(s.category_name || "Uncategorised").replace(/\s*:\s*/g, " › ")} · {formatDate(s.date)}
                  </span>
                </span>
                <span className="tabular shrink-0 font-semibold text-danger">
                  -
                  <Money
                    amount={new Decimal(s.amount || 0).abs().toString()}
                    code={s.currency_code}
                    decimals={s.currency_decimal_places}
                    symbol={s.currency_symbol}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    }

    case "quick_stats": {
      const today = isoDate();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekIso = isoDate(weekAgo);
      let spentToday = new Decimal(0);
      let spentWeek = new Decimal(0);
      let spentPeriod = new Decimal(0);
      let earnedPeriod = new Decimal(0);
      for (const g of inPeriod(ctx.transactions, days)) {
        for (const s of g.attributes.transactions) {
          const amt = ctx.toPrimary(new Decimal(s.amount || 0).abs(), s.currency_code);
          const d = (s.date || "").slice(0, 10);
          if (s.type === "withdrawal") {
            spentPeriod = spentPeriod.plus(amt);
            if (d === today) spentToday = spentToday.plus(amt);
            if (d >= weekIso) spentWeek = spentWeek.plus(amt);
          } else if (s.type === "deposit") earnedPeriod = earnedPeriod.plus(amt);
        }
      }
      const stats = [
        { label: "Spent today", value: spentToday, tone: "text-danger" },
        { label: "Spent last 7 days", value: spentWeek, tone: "text-danger" },
        { label: `Spent (${days}d)`, value: spentPeriod, tone: "text-danger" },
        { label: "Daily average", value: spentPeriod.div(days), tone: "text-warning" },
        { label: `Earned (${days}d)`, value: earnedPeriod, tone: "text-success" },
        {
          label: `Net saved (${days}d)`,
          value: earnedPeriod.minus(spentPeriod),
          tone: earnedPeriod.gte(spentPeriod) ? "text-success" : "text-danger",
        },
      ];
      return (
        <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border/60 bg-surface-2 p-2.5 sm:p-3 min-w-0">
              <p className="text-[10px] sm:text-[11px] font-semibold tracking-wide text-muted uppercase truncate">{s.label}</p>
              <p className={`tabular mt-1 text-sm sm:text-base font-bold truncate ${s.tone}`}>
                <PrimaryMoney ctx={ctx} value={s.value} animated />
              </p>
            </div>
          ))}
        </div>
      );
    }

    case "balance_by_currency": {
      if (ctx.balancesByCurrency.length === 0) return <EmptyState title="No balances" />;
      return (
        <ul className="flex-1 divide-y divide-border">
          {ctx.balancesByCurrency.map((b) => (
            <li key={b.code} className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone="primary">{b.code}</Badge>
                <span className="text-xs text-muted">{b.decimals} decimals</span>
              </div>
              <span className="text-right">
                <span className="tabular block font-semibold">
                  <Money amount={b.total.toFixed(b.decimals)} code={b.code} decimals={b.decimals} symbol={b.symbol} />
                </span>
                {b.code !== ctx.primaryCode && (
                  <span className="tabular text-xs text-muted">
                    ≈ <PrimaryMoney ctx={ctx} value={ctx.toPrimary(b.total, b.code)} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      );
    }

    case "balance_trend":
      return (
        <div className="h-56 flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={ctx.trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                }}
              />
              <Area type="monotone" dataKey="Balance" stroke="var(--primary)" strokeWidth={2} fill="var(--primary-soft)" isAnimationActive animationDuration={900} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );

    case "income_expense_bars":
      return (
        <div className="h-56 flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ctx.barData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                }}
              />
              <Bar dataKey="Income" fill="var(--success)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
              <Bar dataKey="Expense" fill="var(--danger)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "upcoming_bills": {
      const rows = ctx.bills
        .filter((b) => b.attributes.active && (b.attributes.paid_dates?.length ?? 0) === 0)
        .sort((a, b) => (a.attributes.next_expected_match ?? "9").localeCompare(b.attributes.next_expected_match ?? "9"))
        .slice(0, limit);
      if (rows.length === 0) return <EmptyState title="Nothing left to pay this month" />;
      return (
        <ul className="flex-1 divide-y divide-border">
          {rows.map((b) => {
            const a = b.attributes;
            const avg = new Decimal(a.amount_min || 0).plus(a.amount_max || 0).div(2);
            return (
              <li key={b.id}>
                <Link
                  href="/rules?tab=bills"
                  className="interactive-row flex items-center justify-between gap-2 rounded-lg px-1.5 py-2 text-sm transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="text-xs text-muted">
                      {a.repeat_freq}
                      {a.next_expected_match ? ` · due ${formatDate(a.next_expected_match)}` : ""}
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-semibold">
                    <Money
                      amount={avg.toString()}
                      code={a.currency_code}
                      decimals={a.currency_decimal_places}
                      symbol={a.currency_symbol}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      );
    }

    case "piggy_banks": {
      const rows = ctx.piggies.filter((p) => p.attributes.active !== false).slice(0, limit);
      if (rows.length === 0) return <EmptyState title="No savings goals yet" />;
      return (
        <div className="flex flex-1 flex-col gap-3">
          {rows.map((p) => {
            const a = p.attributes;
            const cur = Number(a.current_amount || 0);
            const target = Number(a.target_amount || 0);
            const pct = target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0;
            return (
              <Link key={p.id} href="/piggy-banks" className="interactive-row flex flex-col gap-1.5 rounded-xl p-1.5 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <ResourceIconBadge entityType="piggy" entityId={p.id} defaultIcon="PiggyBank" size="sm" />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="tabular text-xs text-muted">
                    <Money amount={cur} code={a.currency_code} decimals={a.currency_decimal_places} />
                    {target > 0 && (
                      <>
                        {" / "}
                        <Money amount={target} code={a.currency_code} decimals={a.currency_decimal_places} />
                      </>
                    )}
                  </span>
                </div>
                <Progress value={pct} tone="success" />
              </Link>
            );
          })}
        </div>
      );
    }

    case "liabilities": {
      const sourceAccounts = ctx.allAccounts ?? ctx.accounts;
      const sourceTxs = ctx.allTransactions ?? ctx.transactions;
      const liabilityAccounts = sourceAccounts
        .filter(
          (a) =>
            a.attributes.active !== false &&
            (LIABILITY_TYPES.has(String(a.attributes.type).toLowerCase()) ||
              Boolean(a.attributes.liability_type) ||
              a.attributes.account_role === "ccAsset" ||
              Number(a.attributes.current_balance ?? 0) < 0),
        )
        .slice(0, limit);

      if (liabilityAccounts.length === 0) {
        return <EmptyState title="No active liabilities or debts — well done!" />;
      }

      // Compute Paid, Remaining, and Expected installment metrics for each liability from Firefly III data
      const items = liabilityAccounts.map((acc) => {
        const a = acc.attributes;
        const code = a.currency_code || ctx.primaryCode;
        const decimals = a.currency_decimal_places ?? ctx.primaryDecimals;
        const remainingRaw = new Decimal(a.current_balance ?? 0).abs();

        // Sum payments made toward this liability (transfers/deposits to this account or withdrawals referencing its name)
        let paidRaw = new Decimal(0);
        let paymentCount = 0;
        const accNameLower = a.name.toLowerCase();

        for (const g of sourceTxs) {
          for (const s of g.attributes.transactions) {
            const isDest = String(s.destination_id) === String(acc.id);
            const isSource = String(s.source_id) === String(acc.id);
            const nameMatch =
              (s.destination_name || "").toLowerCase() === accNameLower ||
              (s.description || "").toLowerCase().includes(accNameLower);

            if (isDest || (s.type === "withdrawal" && nameMatch && !isSource)) {
              const amt = new Decimal(s.amount || 0).abs();
              paidRaw = paidRaw.plus(amt);
              paymentCount++;
            }
          }
        }

        // Expected recurring payment: match active bill by name, or average payment per transaction
        let expectedRaw = new Decimal(0);
        let nextDue: string | null = null;
        for (const b of ctx.bills) {
          if (!b.attributes.active) continue;
          const bName = b.attributes.name.toLowerCase();
          if (bName.includes(accNameLower) || accNameLower.includes(bName)) {
            expectedRaw = new Decimal(b.attributes.amount_min || 0)
              .plus(b.attributes.amount_max || 0)
              .div(2);
            nextDue = b.attributes.next_expected_match || b.attributes.date || null;
            break;
          }
        }
        if (expectedRaw.lte(0) && paymentCount > 0) {
          expectedRaw = paidRaw.div(paymentCount);
        }

        const totalPrincipalRaw = paidRaw.plus(remainingRaw);
        const paidPct = totalPrincipalRaw.gt(0)
          ? Math.min(100, Math.round(paidRaw.div(totalPrincipalRaw).mul(100).toNumber()))
          : 0;
        const estMonthsLeft =
          expectedRaw.gt(0) && remainingRaw.gt(0)
            ? Math.ceil(remainingRaw.div(expectedRaw).toNumber())
            : null;

        return {
          acc,
          name: a.name,
          shortName: a.name.length > 14 ? `${a.name.slice(0, 12)}…` : a.name,
          role: a.liability_type || a.account_role || a.type,
          code,
          decimals,
          symbol: a.currency_symbol,
          paidRaw,
          remainingRaw,
          expectedRaw,
          paidPrimary: ctx.toPrimary(paidRaw, code).toNumber(),
          remainingPrimary: ctx.toPrimary(remainingRaw, code).toNumber(),
          expectedPrimary: ctx.toPrimary(expectedRaw, code).toNumber(),
          paidPct,
          estMonthsLeft,
          nextDue,
        };
      });

      const totalPaidPrimary = items.reduce((s, x) => s + x.paidPrimary, 0);
      const totalRemainingPrimary = items.reduce((s, x) => s + x.remainingPrimary, 0);
      const totalExpectedPrimary = items.reduce((s, x) => s + x.expectedPrimary, 0);

      return (
        <div className="flex flex-1 flex-col gap-4">
          {/* Global Debt KPI Summary Row */}
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <div className="rounded-xl border border-success/30 bg-success-soft/30 p-2 sm:p-2.5 min-w-0">
              <p className="text-[10px] sm:text-xs text-muted truncate">Paid so far</p>
              <p className="tabular mt-0.5 font-mono text-[11px] sm:text-sm font-bold text-success truncate">
                <PrimaryMoney ctx={ctx} value={totalPaidPrimary} animated />
              </p>
            </div>
            <div className="rounded-xl border border-danger/30 bg-danger-soft/30 p-2 sm:p-2.5 min-w-0">
              <p className="text-[10px] sm:text-xs text-muted truncate">Remaining</p>
              <p className="tabular mt-0.5 font-mono text-[11px] sm:text-sm font-bold text-danger truncate">
                <PrimaryMoney ctx={ctx} value={totalRemainingPrimary} animated />
              </p>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning-soft/30 p-2 sm:p-2.5 min-w-0">
              <p className="text-[10px] sm:text-xs text-muted truncate">Expected / inst.</p>
              <p className="tabular mt-0.5 font-mono text-[11px] sm:text-sm font-bold text-warning truncate">
                <PrimaryMoney ctx={ctx} value={totalExpectedPrimary} animated />
              </p>
            </div>
          </div>

          {/* Stacked Bar Chart: Paid vs Remaining per Liability */}
          <div className="h-44 w-full rounded-xl border border-border bg-surface-2/40 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={items} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis
                  type="category"
                  dataKey="shortName"
                  width={90}
                  tick={{ fontSize: 11, fill: "var(--fg)" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--surface)",
                    borderColor: "var(--border)",
                    borderRadius: "0.75rem",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="paidPrimary" name={`Paid (${ctx.primaryCode})`} stackId="debt" fill="var(--success)" radius={[4, 0, 0, 4]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
                <Bar dataKey="remainingPrimary" name={`Remaining (${ctx.primaryCode})`} stackId="debt" fill="var(--danger)" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-Liability Breakdown Cards */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map((item) => (
              <Link
                key={item.acc.id}
                href={`/accounts/${item.acc.id}`}
                className="card-hover-spring flex flex-col justify-between gap-2 rounded-xl border border-border bg-surface-2/40 p-3 hover:border-primary/50 hover:bg-surface-2 hover:shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ResourceIconBadge
                      entityType="account"
                      entityId={item.acc.id}
                      defaultIcon="CreditCard"
                      defaultColor="#f97316"
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-fg">{item.name}</p>
                      <p className="truncate text-xs text-muted">
                        {item.role}
                        {item.nextDue ? ` · Due ${formatDate(item.nextDue)}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge tone={item.paidPct >= 50 ? "success" : "warning"}>{item.paidPct}% paid</Badge>
                </div>

                <Progress value={item.paidPct} tone="success" />

                <div className="grid grid-cols-3 gap-1 border-t border-border/60 pt-1.5 text-xs">
                  <div>
                    <p className="text-muted">Paid</p>
                    <p className="tabular font-mono font-semibold text-success">
                      <Money amount={item.paidRaw.toString()} code={item.code} decimals={item.decimals} symbol={item.symbol} />
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">Remaining</p>
                    <p className="tabular font-mono font-semibold text-danger">
                      <Money amount={item.remainingRaw.toString()} code={item.code} decimals={item.decimals} symbol={item.symbol} />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted">Expected</p>
                    <p className="tabular font-mono font-semibold text-warning">
                      {item.expectedRaw.gt(0) ? (
                        <Money amount={item.expectedRaw.toString()} code={item.code} decimals={item.decimals} symbol={item.symbol} />
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                </div>

                {item.estMonthsLeft && (
                  <p className="text-xs text-muted">
                    Est. payoff: ~{item.estMonthsLeft} payment{item.estMonthsLeft === 1 ? "" : "s"} remaining
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
