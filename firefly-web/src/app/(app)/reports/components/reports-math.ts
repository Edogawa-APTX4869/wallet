import Decimal from "decimal.js";

export interface BalanceTrendResult {
  currentTotal: Decimal;
  previousTotal: Decimal;
  difference: Decimal;
  percentageChange: number;
  trend: "up" | "down" | "flat";
}

/**
 * Computes balance trend and percentage change vs prior period.
 */
export function computeBalanceTrend(params: {
  currentTotal: Decimal | number | string;
  previousTotal: Decimal | number | string;
}): BalanceTrendResult {
  const cur = new Decimal(params.currentTotal || 0);
  const prev = new Decimal(params.previousTotal || 0);
  const diff = cur.minus(prev);

  let percentageChange = 0;
  if (!prev.isZero()) {
    percentageChange = diff.div(prev.abs()).mul(100).toDecimalPlaces(2).toNumber();
  } else if (!cur.isZero()) {
    percentageChange = cur.isPositive() ? 100 : -100;
  }

  const trend: "up" | "down" | "flat" = diff.gt(0) ? "up" : diff.lt(0) ? "down" : "flat";

  return {
    currentTotal: cur,
    previousTotal: prev,
    difference: diff,
    percentageChange,
    trend,
  };
}

export interface CashFlowKpis {
  inflow: Decimal;
  outflow: Decimal;
  netSaved: Decimal;
  savingsRatePercent: number;
}

/**
 * Computes inflow, outflow, net saved, and savings rate percentage.
 */
export function computeCashFlowKpis(
  transactions: Array<{ type: string; amount: string | number; destination_id?: string; source_id?: string }>,
): CashFlowKpis {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);

  for (const tx of transactions) {
    const amt = new Decimal(tx.amount || 0).abs();
    if (tx.type === "deposit") {
      inflow = inflow.plus(amt);
    } else if (tx.type === "withdrawal") {
      outflow = outflow.plus(amt);
    }
  }

  const netSaved = inflow.minus(outflow);
  let savingsRatePercent = 0;
  if (inflow.gt(0)) {
    savingsRatePercent = netSaved.div(inflow).mul(100).toDecimalPlaces(2).toNumber();
  }

  return {
    inflow,
    outflow,
    netSaved,
    savingsRatePercent,
  };
}

export interface SpendingCategoryItem {
  name: string;
  amount: Decimal;
  percentage: number;
}

export interface SpendingBreakdownResult {
  categories: SpendingCategoryItem[];
  totalSpend: Decimal;
  dailyAverage: Decimal;
}

/**
 * Computes spending breakdown by category and daily average spend.
 */
export function computeSpendingBreakdown(params: {
  expenses: Array<{ category?: string; amount: string | number }>;
  periodDays: number;
}): SpendingBreakdownResult {
  const { expenses, periodDays } = params;
  const map = new Map<string, Decimal>();
  let totalSpend = new Decimal(0);

  for (const exp of expenses) {
    const cat = exp.category?.trim() || "Uncategorized";
    const amt = new Decimal(exp.amount || 0).abs();
    totalSpend = totalSpend.plus(amt);
    const existing = map.get(cat) || new Decimal(0);
    map.set(cat, existing.plus(amt));
  }

  const categories: SpendingCategoryItem[] = [];
  for (const [name, amt] of map.entries()) {
    const percentage = totalSpend.gt(0)
      ? amt.div(totalSpend).mul(100).toDecimalPlaces(2).toNumber()
      : 0;
    categories.push({ name, amount: amt, percentage });
  }

  // Sort descending by amount
  categories.sort((a, b) => (b.amount.gt(a.amount) ? 1 : b.amount.lt(a.amount) ? -1 : 0));

  const days = Math.max(1, periodDays);
  const dailyAverage = totalSpend.div(days).toDecimalPlaces(2);

  return {
    categories,
    totalSpend,
    dailyAverage,
  };
}

export interface RecurrenceConfig {
  name: string;
  amount: Decimal | number | string;
  type: "income" | "expense";
  cadence: "daily" | "weekly" | "monthly";
  dayOfWeek?: number; // 0 = Sun, 6 = Sat
  dayOfMonth?: number; // 1-31
}

export interface UnpaidBillConfig {
  name: string;
  amount: Decimal | number | string;
  dueDate: string; // YYYY-MM-DD
}

export interface DailyProjection {
  date: string;
  balance: Decimal;
}

export interface OutlookProjectionResult {
  dailyBalances: DailyProjection[];
  minBalance: Decimal;
  minBalanceDate: string;
  endingBalance: Decimal;
}

/**
 * Projects daily cash balance forward 30 days factoring recurrences and unpaid bills.
 */
export function project30DayCashOutlook(params: {
  startingBalance: Decimal | number | string;
  startDate: string;
  recurrences: RecurrenceConfig[];
  unpaidBills: UnpaidBillConfig[];
}): OutlookProjectionResult {
  const { startingBalance, startDate, recurrences, unpaidBills } = params;
  let running = new Decimal(startingBalance || 0);
  const dailyBalances: DailyProjection[] = [];

  let minBalance = running;
  let minBalanceDate = startDate;

  const parts = startDate.split("-").map(Number);
  const baseDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

  for (let dayOffset = 1; dayOffset <= 30; dayOffset++) {
    const targetDate = new Date(
      Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + dayOffset),
    );
    const year = targetDate.getUTCFullYear();
    const month = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(targetDate.getUTCDate()).padStart(2, "0");
    const targetDateStr = `${year}-${month}-${day}`;
    const dayOfWeek = targetDate.getUTCDay();
    const dayOfMonth = targetDate.getUTCDate();

    // 1. Process recurrences
    for (const rec of recurrences) {
      let matches = false;
      if (rec.cadence === "daily") {
        matches = true;
      } else if (rec.cadence === "weekly" && rec.dayOfWeek === dayOfWeek) {
        matches = true;
      } else if (rec.cadence === "monthly" && rec.dayOfMonth === dayOfMonth) {
        matches = true;
      }

      if (matches) {
        const amt = new Decimal(rec.amount || 0).abs();
        if (rec.type === "income") {
          running = running.plus(amt);
        } else {
          running = running.minus(amt);
        }
      }
    }

    // 2. Process unpaid bills matching this date
    for (const bill of unpaidBills) {
      if (bill.dueDate === targetDateStr) {
        const amt = new Decimal(bill.amount || 0).abs();
        running = running.minus(amt);
      }
    }

    dailyBalances.push({
      date: targetDateStr,
      balance: running,
    });

    if (running.lt(minBalance)) {
      minBalance = running;
      minBalanceDate = targetDateStr;
    }
  }

  return {
    dailyBalances,
    minBalance,
    minBalanceDate,
    endingBalance: running,
  };
}

export interface CreditDebtGaugeResult {
  totalDebt: Decimal;
  creditCardDebt: Decimal;
  totalCreditLimit: Decimal;
  utilizationPercent: number;
  riskLevel: "healthy" | "moderate" | "high";
}

/**
 * Computes total debt, credit card balances, revolving credit utilization, and risk tier.
 */
export function computeCreditDebtGauge(
  accounts: Array<{
    type?: string;
    liability_type?: string;
    account_role?: string | null;
    current_balance?: string | number;
    credit_limit?: string | number;
  }>,
): CreditDebtGaugeResult {
  let totalDebt = new Decimal(0);
  let creditCardDebt = new Decimal(0);
  let totalCreditLimit = new Decimal(0);

  for (const acc of accounts) {
    const typeLower = (acc.type || "").toLowerCase().trim();
    if (
      typeLower === "initial-balance" ||
      typeLower === "reconciliation" ||
      typeLower === "import" ||
      typeLower.includes("initial")
    ) {
      continue;
    }

    const bal = new Decimal(acc.current_balance || 0).abs();
    const limit = new Decimal(acc.credit_limit || 0).abs();

    const isLiability =
      acc.type === "liability" ||
      acc.type === "liabilities" ||
      acc.type === "loan" ||
      acc.type === "debt" ||
      acc.type === "mortgage" ||
      acc.account_role === "ccAsset" ||
      Boolean(acc.liability_type);

    if (isLiability) {
      totalDebt = totalDebt.plus(bal);
      const isCard =
        acc.liability_type === "credit_card" ||
        acc.liability_type === "credit card" ||
        acc.account_role === "ccAsset";

      if (isCard) {
        creditCardDebt = creditCardDebt.plus(bal);
        totalCreditLimit = totalCreditLimit.plus(limit);
      }
    }
  }

  let utilizationPercent = 0;
  if (totalCreditLimit.gt(0)) {
    utilizationPercent = creditCardDebt.div(totalCreditLimit).mul(100).toDecimalPlaces(2).toNumber();
  }

  let riskLevel: "healthy" | "moderate" | "high" = "healthy";
  if (utilizationPercent > 50) {
    riskLevel = "high";
  } else if (utilizationPercent >= 30) {
    riskLevel = "moderate";
  }

  return {
    totalDebt,
    creditCardDebt,
    totalCreditLimit,
    utilizationPercent,
    riskLevel,
  };
}
