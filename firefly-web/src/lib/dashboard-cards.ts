// Shared (client + server safe) dashboard card catalog & preference types.
// IMPORTANT: keep this file free of server-only imports so client components can use it.

export type DashboardCardKey =
  | "gauges"
  | "cashflow_table"
  | "recent_records"
  | "charts"
  | "budgets_goals"
  | "balance_trend"
  | "income_expense_bars"
  | "top_categories"
  | "top_payees"
  | "largest_expenses"
  | "spending_by_account"
  | "balance_by_currency"
  | "upcoming_bills"
  | "piggy_banks"
  | "liabilities"
  | "quick_stats";

export type CardPeriod = 7 | 30 | 90;
export type CardSpan = 1 | 2;
export type CardGroup = "overview" | "spending" | "charts" | "planning";

export interface DashboardCardConfig {
  key: DashboardCardKey;
  title: string;
  visible: boolean;
  periodDays: CardPeriod;
  recordLimit: number;
  span: CardSpan;
}

export interface DashboardPreferences {
  selectedAccountIds: string[]; // empty = all active asset/liability accounts included
  cards: DashboardCardConfig[];
  categoryOrder?: string[];
  liabilityCategories?: {
    owedToMeCategory: string;
    iOweCategory: string;
  };
}

export interface CardCatalogEntry {
  key: DashboardCardKey;
  title: string;
  description: string;
  group: CardGroup;
  defaultSpan: CardSpan;
  /** Whether the card uses the period selector */
  usesPeriod: boolean;
  /** Whether the card uses the row-limit selector */
  usesLimit: boolean;
}

export const CARD_GROUP_LABELS: Record<CardGroup, string> = {
  overview: "Overview & Cash Flow",
  spending: "Spending Breakdown",
  charts: "Charts & Balances",
  planning: "Budgets, Bills & Goals",
};

export const CARD_CATALOG: CardCatalogEntry[] = [
  { key: "gauges", title: "Financial Health", description: "Balance, cash flow, outlook, spending, credit & debt gauges", group: "overview", defaultSpan: 2, usesPeriod: true, usesLimit: false },
  { key: "quick_stats", title: "Quick Stats", description: "Spent today, last 7 days, this period and daily average", group: "overview", defaultSpan: 2, usesPeriod: true, usesLimit: false },
  { key: "recent_records", title: "Last Records Overview", description: "Most recent transactions of selected accounts", group: "overview", defaultSpan: 1, usesPeriod: true, usesLimit: true },
  { key: "cashflow_table", title: "Cash Flow Table", description: "Income vs expenses: count, daily/record averages, totals", group: "overview", defaultSpan: 1, usesPeriod: true, usesLimit: false },
  { key: "top_categories", title: "Expenses by Category", description: "Where your money goes, ranked by category", group: "spending", defaultSpan: 1, usesPeriod: true, usesLimit: true },
  { key: "top_payees", title: "Top Payees", description: "Merchants & people you pay the most", group: "spending", defaultSpan: 1, usesPeriod: true, usesLimit: true },
  { key: "largest_expenses", title: "Largest Expenses", description: "Biggest single expenses in the period", group: "spending", defaultSpan: 1, usesPeriod: true, usesLimit: true },
  { key: "spending_by_account", title: "Spending by Account", description: "Expenses split by paying account", group: "spending", defaultSpan: 1, usesPeriod: true, usesLimit: true },
  { key: "charts", title: "Balance & Income/Expense Charts", description: "Combined balance trend + 6-month bars", group: "charts", defaultSpan: 2, usesPeriod: false, usesLimit: false },
  { key: "balance_trend", title: "Balance Trend", description: "Balance curve over the last 30 days", group: "charts", defaultSpan: 1, usesPeriod: false, usesLimit: false },
  { key: "income_expense_bars", title: "Income vs Expense (6 months)", description: "Monthly bars for the last 6 months", group: "charts", defaultSpan: 1, usesPeriod: false, usesLimit: false },
  { key: "balance_by_currency", title: "Balance by Currency", description: "Totals per currency with conversion to main currency", group: "charts", defaultSpan: 1, usesPeriod: false, usesLimit: false },
  { key: "budgets_goals", title: "Active Budgets", description: "Monthly budget limits and progress", group: "planning", defaultSpan: 1, usesPeriod: false, usesLimit: true },
  { key: "piggy_banks", title: "Savings Goals", description: "Piggy bank target progress", group: "planning", defaultSpan: 1, usesPeriod: false, usesLimit: true },
  { key: "upcoming_bills", title: "Planned Payments", description: "Active bills & subscriptions not yet paid", group: "planning", defaultSpan: 1, usesPeriod: false, usesLimit: true },
  { key: "liabilities", title: "Debts & Liabilities Payoff", description: "Paid vs remaining chart, expected installments and payoff timeline", group: "planning", defaultSpan: 2, usesPeriod: false, usesLimit: true },
];

export const CATALOG_BY_KEY = new Map(CARD_CATALOG.map((c) => [c.key, c]));

export function makeCard(key: DashboardCardKey): DashboardCardConfig {
  const entry = CATALOG_BY_KEY.get(key);
  return {
    key,
    title: entry?.title ?? key,
    visible: true,
    periodDays: 30,
    recordLimit: 5,
    span: entry?.defaultSpan ?? 1,
  };
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPreferences = {
  selectedAccountIds: [],
  cards: (
    ["gauges", "recent_records", "cashflow_table", "liabilities", "top_categories", "charts", "budgets_goals"] as DashboardCardKey[]
  ).map(makeCard),
};

/** Drop unknown keys & duplicates so stale saved layouts never break rendering. */
export function sanitizeCards(cards: unknown): DashboardCardConfig[] {
  if (!Array.isArray(cards)) return DEFAULT_DASHBOARD_PREFS.cards;
  const seen = new Set<string>();
  const out: DashboardCardConfig[] = [];
  for (const raw of cards as Partial<DashboardCardConfig>[]) {
    if (!raw?.key || !CATALOG_BY_KEY.has(raw.key) || seen.has(raw.key)) continue;
    seen.add(raw.key);
    const entry = CATALOG_BY_KEY.get(raw.key)!;
    out.push({
      ...makeCard(raw.key),
      ...raw,
      title: raw.title || entry.title,
      periodDays: ([7, 30, 90] as number[]).includes(Number(raw.periodDays)) ? (raw.periodDays as CardPeriod) : 30,
      recordLimit: Number(raw.recordLimit) > 0 ? Number(raw.recordLimit) : 5,
      span: raw.span === 1 || raw.span === 2 ? raw.span : entry.defaultSpan,
      visible: raw.visible !== false,
    });
  }
  return out;
}
