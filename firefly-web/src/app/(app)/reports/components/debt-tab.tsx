"use client";

import { useMemo } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import {
  AlertCircle,
  CreditCard,
  ExternalLink,
  Receipt,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { Resource, Account } from "@/lib/firefly/types";
import { cn, formatMoney } from "@/lib/utils";
import { Badge, Card, CardTitle } from "@/components/ui";
import { ResourceIconBadge } from "@/components/resource-icon";
import { computeCreditDebtGauge } from "./reports-math";

export interface DebtTabProps {
  allAccounts: Resource<Account>[];
  primaryCode: string;
  primaryDecimals: number;
  toPrimary: (amount: string | number | Decimal, code?: string | null) => Decimal;
}

export function DebtTab({
  allAccounts,
  primaryCode,
  primaryDecimals,
  toPrimary,
}: DebtTabProps) {
  // Extract all liabilities & credit cards
  const liabilityAccounts = useMemo(() => {
    return allAccounts.filter((a) => {
      const type = String(a.attributes.type || "").toLowerCase();
      const role = a.attributes.account_role;
      const isLiability =
        type.includes("liabilit") ||
        type.includes("loan") ||
        type.includes("debt") ||
        type.includes("mortgage") ||
        Boolean(a.attributes.liability_type) ||
        role === "ccAsset";

      return isLiability && a.attributes.active !== false;
    });
  }, [allAccounts]);

  // Compute metrics with computeCreditDebtGauge
  const gaugeData = useMemo(() => {
    const rawList = liabilityAccounts.map((a) => {
      const nativeBal = new Decimal(a.attributes.current_balance || 0).abs();
      const primaryBal = toPrimary(nativeBal, a.attributes.currency_code);

      // Note: credit_limit might be on account attributes or liability_amount
      const rawLimit = new Decimal(
        (a.attributes as unknown as { credit_limit?: string }).credit_limit ||
        a.attributes.liability_amount ||
        0,
      ).abs();
      const primaryLimit = toPrimary(rawLimit, a.attributes.currency_code);

      const isCc =
        a.attributes.liability_type === "credit_card" ||
        a.attributes.liability_type === "credit card" ||
        a.attributes.account_role === "ccAsset";
      const isCredit = a.attributes.liability_direction === "credit";

      return {
        id: a.id,
        name: a.attributes.name,
        type: "liability",
        liability_type: isCc ? "credit_card" : a.attributes.liability_type || "loan",
        account_role: a.attributes.account_role,
        current_balance: primaryBal.toString(),
        credit_limit: primaryLimit.toString(),
        nativeBal,
        currencyCode: a.attributes.currency_code || primaryCode,
        currencySymbol: a.attributes.currency_symbol || "",
        decimals: a.attributes.currency_decimal_places ?? 2,
        isCc,
        isCredit,
      };
    });

    const metrics = computeCreditDebtGauge(rawList);
    const availableCredit = metrics.totalCreditLimit.gt(metrics.creditCardDebt)
      ? metrics.totalCreditLimit.minus(metrics.creditCardDebt)
      : new Decimal(0);

    return {
      rawList,
      metrics,
      availableCredit,
    };
  }, [liabilityAccounts, primaryCode, toPrimary]);

  const { metrics, rawList, availableCredit } = gaugeData;
  const utilPct = Math.min(100, Math.max(0, metrics.utilizationPercent));

  return (
    <div className="flex flex-col gap-5">
      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Total Debt */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-danger">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Total Debt Burden</span>
            <Receipt className="size-4 text-danger" />
          </div>
          <div className="font-mono text-2xl font-bold text-danger">
            {formatMoney(
              metrics.totalDebt.toFixed(primaryDecimals),
              primaryCode,
              primaryDecimals,
            )}
          </div>
          <span className="text-[11px] text-muted">All outstanding liabilities</span>
        </Card>

        {/* Credit Card Balances */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Credit Card Debt</span>
            <CreditCard className="size-4 text-amber-500" />
          </div>
          <div className="font-mono text-2xl font-bold text-fg">
            {formatMoney(
              metrics.creditCardDebt.toFixed(primaryDecimals),
              primaryCode,
              primaryDecimals,
            )}
          </div>
          <span className="text-[11px] text-muted">Revolving credit balances</span>
        </Card>

        {/* Total Credit Limit */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-primary">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Total Credit Limit</span>
            <ShieldCheck className="size-4 text-primary" />
          </div>
          <div className="font-mono text-2xl font-bold text-primary">
            {formatMoney(
              metrics.totalCreditLimit.toFixed(primaryDecimals),
              primaryCode,
              primaryDecimals,
            )}
          </div>
          <span className="text-[11px] text-muted">Combined revolving credit lines</span>
        </Card>

        {/* Available Credit */}
        <Card className="flex flex-col gap-1.5 p-4 border-l-4 border-l-success">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>Available Credit</span>
            <ShieldCheck className="size-4 text-success" />
          </div>
          <div className="font-mono text-2xl font-bold text-success">
            {formatMoney(
              availableCredit.toFixed(primaryDecimals),
              primaryCode,
              primaryDecimals,
            )}
          </div>
          <span className="text-[11px] text-muted">Unused revolving capacity</span>
        </Card>
      </div>

      {/* Revolving Credit Utilization Gauge */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <CardTitle>Revolving Credit Utilization Gauge</CardTitle>
            <p className="text-xs text-muted">
              Credit card balances relative to revolving credit limits. Standard guidance: stay below 30%.
            </p>
          </div>

          <Badge
            tone={
              metrics.riskLevel === "healthy"
                ? "success"
                : metrics.riskLevel === "moderate"
                  ? "warning"
                  : "danger"
            }
            className="text-xs font-semibold px-2.5 py-1"
          >
            {metrics.riskLevel === "healthy" && <ShieldCheck className="size-3.5" />}
            {metrics.riskLevel === "moderate" && <AlertCircle className="size-3.5" />}
            {metrics.riskLevel === "high" && <ShieldAlert className="size-3.5" />}
            <span>
              {metrics.riskLevel === "healthy"
                ? "Healthy (< 30%)"
                : metrics.riskLevel === "moderate"
                  ? "Moderate (30% – 50%)"
                  : "High Risk (> 50%)"}
            </span>
          </Badge>
        </div>

        {/* Visual Gauge Bar with Risk Tiers */}
        <div className="flex flex-col gap-2 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-mono font-bold text-fg">
              {metrics.utilizationPercent}%
            </span>
            <span className="text-xs font-medium text-muted">
              {formatMoney(metrics.creditCardDebt.toString(), primaryCode)} /{" "}
              {formatMoney(metrics.totalCreditLimit.toString(), primaryCode)}
            </span>
          </div>

          {/* Tiered Progress Track */}
          <div className="relative h-4 w-full overflow-hidden rounded-full bg-surface-2 border border-border">
            {/* 30% Marker */}
            <div
              className="absolute top-0 bottom-0 z-10 w-0.5 bg-border border-r border-fg/20"
              style={{ left: "30%" }}
              title="Healthy threshold: 30%"
            />
            {/* 50% Marker */}
            <div
              className="absolute top-0 bottom-0 z-10 w-0.5 bg-border border-r border-fg/20"
              style={{ left: "50%" }}
              title="Moderate threshold: 50%"
            />

            {/* Filled Progress Bar */}
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${utilPct}%`,
                backgroundColor:
                  metrics.riskLevel === "healthy"
                    ? "var(--success)"
                    : metrics.riskLevel === "moderate"
                      ? "var(--warning)"
                      : "var(--danger)",
              }}
            />
          </div>

          {/* Risk Tier Legend Ticks */}
          <div className="flex items-center justify-between text-[11px] font-medium text-muted pt-1">
            <span className="text-success">0% (Ideal)</span>
            <span className="text-success text-center">30% (Healthy limit)</span>
            <span className="text-warning text-center">50% (Moderate limit)</span>
            <span className="text-danger text-right">100% (Max)</span>
          </div>
        </div>
      </Card>

      {/* Liabilities & Credit Cards List */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <CardTitle>Liabilities &amp; Debt Accounts</CardTitle>
            <p className="text-xs text-muted">
              Breakdown of {liabilityAccounts.length} credit card and liability account
              {liabilityAccounts.length === 1 ? "" : "s"}.
            </p>
          </div>
          <Link
            href="/accounts?tab=liabilities"
            className="interactive-tap text-xs font-semibold text-primary hover:underline flex items-center gap-1 active:scale-95 transition-transform"
          >
            <span>Manage accounts</span>
            <ExternalLink className="size-3" />
          </Link>
        </div>

        {rawList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No debt or liability accounts recorded.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {rawList.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-3 px-2 rounded-xl transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <ResourceIconBadge
                    entityType="account"
                    entityId={item.id}
                    defaultIcon={item.isCc ? "CreditCard" : "Receipt"}
                    defaultColor={item.isCc ? "#f97316" : "#eab308"}
                    size="sm"
                  />
                  <div className="truncate">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-fg truncate">
                        {item.name}
                      </span>
                      <Badge tone={item.isCc ? "primary" : item.isCredit ? "success" : "neutral"} className="text-[10px]">
                        {item.isCc ? "Credit Card" : item.isCredit ? "Owed to me" : item.liability_type || "Loan"}
                      </Badge>
                    </div>
                    {item.isCc && Number(item.credit_limit) > 0 && (
                      <span className="text-[11px] text-muted">
                        Credit limit: {formatMoney(item.credit_limit, item.currencyCode)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className={cn("font-mono text-sm font-bold", item.isCredit ? "text-success" : "text-danger")}>
                    {item.isCredit ? "+" : "-"}{formatMoney(item.nativeBal.toFixed(item.decimals), item.currencyCode, item.decimals, item.currencySymbol)}
                  </div>
                  {item.currencyCode !== primaryCode && (
                    <div className="font-mono text-[11px] text-muted">
                      ≈ {item.isCredit ? "+" : "-"}{formatMoney(toPrimary(item.nativeBal, item.currencyCode).toFixed(primaryDecimals), primaryCode, primaryDecimals)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
