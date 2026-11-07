"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Decimal from "decimal.js";
import { ArrowDownRight, ArrowUpRight, PiggyBank, Scale } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Resource, Account } from "@/lib/firefly/types";
import { formatMoney } from "@/lib/utils";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui";

export interface CashFlowTabProps {
  startDate: string;
  endDate: string;
  accounts: Resource<Account>[];
  primaryCode: string;
  primaryDecimals: number;
  toPrimary: (amount: string | number | Decimal, code?: string | null) => Decimal;
  selectedAccountIds: string[];
  isAccountIncluded?: (
    account?: {
      id?: string;
      attributes?: { include_net_worth?: boolean; active?: boolean };
      include_net_worth?: boolean;
    } | null,
    accountId?: string,
  ) => boolean;
}

interface MonthlyBarPoint {
  name: string;
  monthStart: string;
  Inflow: number;
  Outflow: number;
  Net: number;
}

function CashFlowTooltip({ active, payload, label, primaryCode }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  label?: string;
  primaryCode: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const inflow = payload.find((p) => p.name === "Inflow")?.value ?? 0;
  const outflow = payload.find((p) => p.name === "Outflow")?.value ?? 0;
  const net = inflow - outflow;

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-lg text-xs flex flex-col gap-1.5 min-w-[140px]">
      <div className="font-semibold text-fg border-b border-border pb-1">{label}</div>
      <div className="flex items-center justify-between text-success">
        <span>Inflow:</span>
        <span className="font-mono font-semibold">{formatMoney(inflow, primaryCode)}</span>
      </div>
      <div className="flex items-center justify-between text-danger">
        <span>Outflow:</span>
        <span className="font-mono font-semibold">{formatMoney(outflow, primaryCode)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-1 font-semibold">
        <span className="text-muted">Net Saved:</span>
        <span className={net >= 0 ? "text-primary font-mono" : "text-danger font-mono"}>
          {net >= 0 ? "+" : ""}{formatMoney(net, primaryCode)}
        </span>
      </div>
    </div>
  );
}

export function CashFlowTab({
  startDate,
  endDate,
  primaryCode,
  primaryDecimals,
  toPrimary,
  selectedAccountIds,
  isAccountIncluded,
}: CashFlowTabProps) {
  // Query transactions in active period
  const transactionsQ = useQuery({
    queryKey: ["reports", "cashflow-transactions", startDate, endDate],
    queryFn: () => api.transactions(1, { start: startDate, end: endDate, limit: 100 }),
    staleTime: 60_000,
  });

  // Query basic summary as fallback / confirmation
  const summaryQ = useQuery({
    queryKey: ["reports", "cashflow-summary", startDate, endDate],
    queryFn: () => api.summary(startDate, endDate),
    staleTime: 60_000,
  });

  // Filter transactions by included accounts
  const filteredTransactions = useMemo(() => {
    const list = transactionsQ.data?.data ?? [];
    if (selectedAccountIds.length > 0) {
      const selectedSet = new Set(selectedAccountIds);
      return list.filter((g) => {
        const s = g.attributes.transactions[0];
        if (!s) return false;
        const srcMatch = s.source_id && selectedSet.has(String(s.source_id));
        const destMatch = s.destination_id && selectedSet.has(String(s.destination_id));
        return srcMatch || destMatch;
      });
    }
    if (isAccountIncluded) {
      return list.filter((g) => {
        const s = g.attributes.transactions[0];
        if (!s) return false;
        const srcOk = !s.source_id || isAccountIncluded(null, String(s.source_id));
        const destOk = !s.destination_id || isAccountIncluded(null, String(s.destination_id));
        return srcOk || destOk;
      });
    }
    return list;
  }, [transactionsQ.data?.data, selectedAccountIds, isAccountIncluded]);

  // Compute KPIs using reports-math
  const kpis = useMemo(() => {
    let inflowPrimary = new Decimal(0);
    let outflowPrimary = new Decimal(0);

    if (filteredTransactions.length > 0) {
      for (const group of filteredTransactions) {
        for (const split of group.attributes.transactions) {
          const amt = new Decimal(split.amount || 0).abs();
          const amtPrimary = toPrimary(amt, split.currency_code);

          if (split.type === "deposit") {
            inflowPrimary = inflowPrimary.plus(amtPrimary);
          } else if (split.type === "withdrawal") {
            outflowPrimary = outflowPrimary.plus(amtPrimary);
          }
        }
      }
    } else if (summaryQ.data) {
      // Fallback to basic summary
      for (const [key, entry] of Object.entries(summaryQ.data)) {
        if (!entry || typeof entry !== "object" || !("monetary_value" in entry)) continue;
        const val = toPrimary(new Decimal(entry.monetary_value || 0).abs(), entry.currency_code);
        if (key.startsWith("earned-in-")) {
          inflowPrimary = inflowPrimary.plus(val);
        } else if (key.startsWith("spent-in-")) {
          outflowPrimary = outflowPrimary.plus(val);
        }
      }
    }

    const netSaved = inflowPrimary.minus(outflowPrimary);
    let savingsRatePercent = 0;
    if (inflowPrimary.gt(0)) {
      savingsRatePercent = netSaved.div(inflowPrimary).mul(100).toDecimalPlaces(2).toNumber();
    }

    return {
      inflow: inflowPrimary,
      outflow: outflowPrimary,
      netSaved,
      savingsRatePercent,
    };
  }, [filteredTransactions, summaryQ.data, toPrimary]);

  // Generate 6 rolling months ending at endDate for comparative monthly bars
  const months = useMemo(() => {
    const end = new Date(endDate);
    const result: Array<{ label: string; start: string; end: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth();
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const monthStr = String(month + 1).padStart(2, "0");
      const startStr = `${year}-${monthStr}-01`;
      const endStr = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      result.push({ label, start: startStr, end: endStr });
    }
    return result;
  }, [endDate]);

  // Fetch summaries for each of the 6 comparison months
  const monthlySummaries = useQueries({
    queries: months.map((m) => ({
      queryKey: ["reports", "month-summary", m.start, m.end],
      queryFn: () => api.summary(m.start, m.end),
      staleTime: 5 * 60_000,
    })),
  });

  const monthlyBarData: MonthlyBarPoint[] = useMemo(() => {
    return months.map((m, idx) => {
      const summary = monthlySummaries[idx]?.data;
      let inflow = 0;
      let outflow = 0;

      if (summary) {
        for (const [key, entry] of Object.entries(summary)) {
          if (!entry || typeof entry !== "object" || !("monetary_value" in entry)) continue;
          const amt = toPrimary(new Decimal(entry.monetary_value || 0).abs(), entry.currency_code).toNumber();
          if (key.startsWith("earned-in-")) {
            inflow += amt;
          } else if (key.startsWith("spent-in-")) {
            outflow += amt;
          }
        }
      }

      return {
        name: m.label,
        monthStart: m.start,
        Inflow: Math.round(inflow * 100) / 100,
        Outflow: Math.round(outflow * 100) / 100,
        Net: Math.round((inflow - outflow) * 100) / 100,
      };
    });
  }, [months, monthlySummaries, toPrimary]);

  const isLoading = transactionsQ.isLoading && summaryQ.isLoading;

  return (
    <div className="flex flex-col gap-5">
      {/* 4 KPI Cards: Inflow, Outflow, Net Saved, Savings Rate % */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Total Inflow */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-success">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Total Inflow</span>
            <ArrowDownRight className="size-4 text-success" />
          </div>
          <div className="font-mono text-2xl font-bold text-success">
            +{formatMoney(kpis.inflow.toFixed(primaryDecimals), primaryCode, primaryDecimals)}
          </div>
          <span className="text-[11px] text-muted">Income &amp; deposits</span>
        </Card>

        {/* Total Outflow */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-danger">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Total Outflow</span>
            <ArrowUpRight className="size-4 text-danger" />
          </div>
          <div className="font-mono text-2xl font-bold text-danger">
            -{formatMoney(kpis.outflow.toFixed(primaryDecimals), primaryCode, primaryDecimals)}
          </div>
          <span className="text-[11px] text-muted">Expenses &amp; withdrawals</span>
        </Card>

        {/* Net Saved */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-primary">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Net Saved</span>
            <Scale className="size-4 text-primary" />
          </div>
          <div
            className={
              kpis.netSaved.gte(0)
                ? "font-mono text-2xl font-bold text-primary"
                : "font-mono text-2xl font-bold text-danger"
            }
          >
            {kpis.netSaved.gte(0) ? "+" : ""}
            {formatMoney(kpis.netSaved.toFixed(primaryDecimals), primaryCode, primaryDecimals)}
          </div>
          <span className="text-[11px] text-muted">Inflow minus outflow</span>
        </Card>

        {/* Savings Rate % */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-warning">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Savings Rate</span>
            <PiggyBank className="size-4 text-warning" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-fg">
              {kpis.savingsRatePercent}%
            </span>
            <Badge
              tone={
                kpis.savingsRatePercent >= 20
                  ? "success"
                  : kpis.savingsRatePercent >= 0
                    ? "warning"
                    : "danger"
              }
              className="text-[10px] font-semibold"
            >
              {kpis.savingsRatePercent >= 20
                ? "Healthy"
                : kpis.savingsRatePercent >= 0
                  ? "Moderate"
                  : "Deficit"}
            </Badge>
          </div>
          <span className="text-[11px] text-muted">Percentage of inflow retained</span>
        </Card>
      </div>

      {/* Monthly Comparison Bar Chart (Inflow vs Outflow) */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <CardTitle>Monthly Cash-flow Comparison</CardTitle>
            <p className="text-xs text-muted">
              Rolling 6-month comparison of total money in vs money out ({primaryCode}).
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-success">
              <span className="size-2.5 rounded-sm bg-success inline-block" />
              Inflow
            </span>
            <span className="flex items-center gap-1.5 text-danger">
              <span className="size-2.5 rounded-sm bg-danger inline-block" />
              Outflow
            </span>
          </div>
        </div>

        <div className="h-72 w-full">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyBarData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => formatMoney(val, primaryCode, 0)}
                />
                <Tooltip content={<CashFlowTooltip primaryCode={primaryCode} />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                />
                <Bar
                  dataKey="Inflow"
                  fill="var(--success)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive
                  animationDuration={800}
                />
                <Bar
                  dataKey="Outflow"
                  fill="var(--danger)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive
                  animationDuration={800}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
