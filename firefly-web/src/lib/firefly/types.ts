// Minimal, defensive typings for the parts of the Firefly III v1 API this app uses.

export interface Pagination {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

export interface Resource<T> {
  id: string;
  type: string;
  attributes: T;
}

export interface ListResponse<T> {
  data: Resource<T>[];
  meta?: { pagination?: Pagination };
}

export interface SingleResponse<T> {
  data: Resource<T>;
}

export type AccountType =
  | "asset"
  | "expense"
  | "revenue"
  | "liability"
  | "liabilities"
  | "cash"
  | "initial-balance"
  | "reconciliation";

export interface Account {
  name: string;
  type: AccountType | string;
  active: boolean;
  account_role?: string | null;
  currency_id?: string | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  currency_decimal_places?: number | null;
  current_balance?: string | null;
  current_balance_date?: string | null;
  iban?: string | null;
  account_number?: string | null;
  include_net_worth?: boolean;
  liability_type?: string | null;
  liability_amount?: string | null;
  liability_direction?: string | null;
  interest?: string | null;
  interest_period?: string | null;
  notes?: string | null;
  order?: number | null;
  object_group_title?: string | null;
  opening_balance_date?: string | null;
}

export type TransactionType =
  | "withdrawal"
  | "deposit"
  | "transfer"
  | "opening balance"
  | "reconciliation";

export interface TransactionSplit {
  transaction_journal_id?: string;
  type: TransactionType;
  date: string;
  amount: string;
  description: string;
  currency_id?: string | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  currency_decimal_places?: number | null;
  foreign_amount?: string | null;
  foreign_currency_id?: string | null;
  foreign_currency_code?: string | null;
  foreign_currency_symbol?: string | null;
  foreign_currency_decimal_places?: number | null;
  source_id?: string | null;
  source_name?: string | null;
  source_type?: string | null;
  destination_id?: string | null;
  destination_name?: string | null;
  destination_type?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  budget_id?: string | null;
  budget_name?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  bill_id?: string | null;
  bill_name?: string | null;
}

export interface TransactionGroup {
  group_title?: string | null;
  created_at?: string;
  transactions: TransactionSplit[];
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  enabled?: boolean;
  default?: boolean;
  primary?: boolean;
}

export interface SpentEntry {
  sum: string;
  currency_id?: string;
  currency_code: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
}

export type AutoBudgetType = "none" | "reset" | "rollover" | "adjusted";
export type AutoBudgetPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "half-year" | "yearly";

export interface Budget {
  name: string;
  active: boolean;
  order?: number;
  notes?: string | null;
  spent?: SpentEntry[];
  auto_budget_type?: AutoBudgetType | string | null;
  auto_budget_amount?: string | null;
  auto_budget_currency_id?: string | null;
  auto_budget_currency_code?: string | null;
  auto_budget_period?: AutoBudgetPeriod | string | null;
}

export interface BudgetLimit {
  budget_id: string;
  start: string;
  end: string;
  amount: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  spent?: string | SpentEntry[] | null;
  notes?: string | null;
}

export interface AvailableBudget {
  currency_id?: string;
  currency_code: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  amount: string;
  start: string;
  end: string;
  spent_in_budgets?: SpentEntry[];
  spent_outside_budget?: SpentEntry[];
}

export interface Category {
  name: string;
  notes?: string | null;
  spent?: SpentEntry[];
  earned?: SpentEntry[];
}

export interface Tag {
  tag: string;
  date?: string | null;
  description?: string | null;
}

export interface ExchangeRate {
  from_currency_code?: string;
  to_currency_code?: string;
  from?: string;
  to?: string;
  rate: string;
  date: string;
}

export interface SummaryEntry {
  key: string;
  title?: string;
  monetary_value: string | number;
  currency_code: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  value_parsed?: string;
  sub_title?: string;
}

export type BasicSummary = Record<string, SummaryEntry>;

export interface ChartDataSet {
  label: string;
  currency_code?: string;
  currency_symbol?: string;
  entries: Record<string, number | string> | Array<{ key?: string; date?: string; value: number | string }>;
}

export interface AboutUser {
  email: string;
  role?: string | null;
}

export interface About {
  version: string;
  api_version: string;
  php_version?: string;
  os?: string;
  driver?: string;
}

/** Split payload for POST /transactions. */
export interface NewSplit {
  transaction_journal_id?: string;
  type: "withdrawal" | "deposit" | "transfer";
  date: string;
  amount: string;
  description: string;
  source_id?: string;
  source_name?: string;
  destination_id?: string;
  destination_name?: string;
  currency_code?: string;
  foreign_amount?: string;
  foreign_currency_code?: string;
  category_name?: string;
  budget_id?: string;
  tags?: string[];
  notes?: string;
  bill_id?: string | null;
  bill_name?: string | null;
}

export type RuleMoment = "store-journal" | "update-journal" | "manual-activation";

export interface RuleTrigger {
  id?: string;
  type: string;
  value: string;
  prohibited?: boolean;
  active?: boolean;
  stop_processing?: boolean;
  order?: number;
}

export interface RuleAction {
  id?: string;
  type: string;
  value: string | null;
  active?: boolean;
  stop_processing?: boolean;
  order?: number;
}

export interface Rule {
  title: string;
  description?: string | null;
  rule_group_id: string;
  rule_group_title?: string;
  order?: number;
  active: boolean;
  strict: boolean;
  stop_processing: boolean;
  trigger: RuleMoment;
  triggers: RuleTrigger[];
  actions: RuleAction[];
}

export interface RulePayload {
  title: string;
  description?: string;
  rule_group_id?: string;
  rule_group_title?: string;
  trigger: RuleMoment;
  strict: boolean;
  stop_processing: boolean;
  active: boolean;
  triggers: Array<{
    type: string;
    value: string;
    prohibited?: boolean;
    active?: boolean;
    stop_processing?: boolean;
  }>;
  actions: Array<{
    type: string;
    value: string | null;
    active?: boolean;
    stop_processing?: boolean;
  }>;
}

export interface RuleGroup {
  title: string;
  description?: string | null;
  order?: number;
  active: boolean;
}

export interface RecurrenceRepetition {
  id?: string;
  type: "daily" | "weekly" | "ndom" | "monthly" | "yearly";
  moment: string;
  skip?: number;
  weekend?: number;
  description?: string;
  occurrences?: string[];
}

export interface RecurrenceTransaction {
  id?: string;
  description: string;
  amount: string;
  foreign_amount?: string | null;
  currency_id?: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  foreign_currency_code?: string | null;
  source_id?: string;
  source_name?: string;
  destination_id?: string;
  destination_name?: string;
  category_name?: string | null;
  budget_id?: string | null;
  budget_name?: string | null;
  tags?: string[] | null;
}

export interface Recurrence {
  type: "withdrawal" | "deposit" | "transfer";
  title: string;
  description?: string | null;
  first_date: string;
  latest_date?: string | null;
  repeat_until?: string | null;
  nr_of_repetitions?: number | null;
  apply_rules: boolean;
  active: boolean;
  notes?: string | null;
  repetitions: RecurrenceRepetition[];
  transactions: RecurrenceTransaction[];
}

export interface Bill {
  name: string;
  amount_min: string;
  amount_max: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  date: string;
  end_date?: string | null;
  repeat_freq: "weekly" | "monthly" | "quarterly" | "half-year" | "yearly";
  skip?: number;
  active: boolean;
  notes?: string | null;
  next_expected_match?: string | null;
  paid_dates?: Array<{ transaction_group_id?: string; date: string }>;
}

export interface ConfigEntry {
  title: string;
  value: boolean | number | string | Record<string, unknown> | null;
  editable: boolean;
}

export interface Webhook {
  active: boolean;
  title: string;
  secret?: string;
  trigger?: string;
  triggers?: string[];
  response?: string;
  responses?: string[];
  delivery?: string;
  deliveries?: string[];
  url: string;
}

export interface PiggyBank {
  name: string;
  account_id: string;
  account_name?: string;
  currency_id?: string;
  currency_code: string;
  currency_symbol?: string;
  currency_decimal_places: number;
  target_amount?: string | null;
  percentage?: number | null;
  current_amount: string;
  left_to_save?: string | null;
  save_per_month?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  order?: number;
  active?: boolean;
  notes?: string | null;
}

export interface InsightEntry {
  id: string;
  name: string;
  difference: string;
  difference_float: number;
  currency_id?: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
  value?: string;
  value_float?: number;
  asset_account_id?: string | null;
  asset_account_name?: string | null;
}

export interface InsightTotalEntry {
  difference: string;
  difference_float: number;
  currency_id?: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_decimal_places?: number;
}
