/**
 * Test Harness & Contract Reference Implementations
 * For Milestone 4 Dual-Track E2E Testing (R1, R2, R3, R4)
 */

import Decimal from "decimal.js";
import type { Account, TransactionGroup } from "@/lib/firefly/types";

// ============================================================================
// 1. Mock Browser Environment Utilities
// ============================================================================

export interface MockStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  readonly length: number;
  key: (index: number) => string | null;
}

export function createMockLocalStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
}

export type MockMediaQueryListener = (e: { matches: boolean; media: string }) => void;

export interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => void) | null;
  addListener: (listener: MockMediaQueryListener) => void;
  removeListener: (listener: MockMediaQueryListener) => void;
  addEventListener: (type: string, listener: MockMediaQueryListener) => void;
  removeEventListener: (type: string, listener: MockMediaQueryListener) => void;
  dispatchEvent: (event: Event) => boolean;
  // Test helper to trigger change
  simulateChange: (matches: boolean) => void;
}

export function createMockMatchMedia(initialDark: boolean = false): {
  matchMedia: (query: string) => MockMediaQueryList;
  setDark: (dark: boolean) => void;
} {
  let isDark = initialDark;
  const listeners = new Set<MockMediaQueryListener>();

  const matchMedia = (query: string): MockMediaQueryList => {
    return {
      get matches() {
        if (query.includes("prefers-color-scheme: dark")) return isDark;
        if (query.includes("prefers-color-scheme: light")) return !isDark;
        return false;
      },
      media: query,
      onchange: null,
      addListener(listener: MockMediaQueryListener) {
        listeners.add(listener);
      },
      removeListener(listener: MockMediaQueryListener) {
        listeners.delete(listener);
      },
      addEventListener(type: string, listener: MockMediaQueryListener) {
        if (type === "change") listeners.add(listener);
      },
      removeEventListener(type: string, listener: MockMediaQueryListener) {
        if (type === "change") listeners.delete(listener);
      },
      dispatchEvent(event: Event) {
        void event;
        listeners.forEach((l) => l({ matches: isDark, media: query }));
        return true;
      },
      simulateChange(newDark: boolean) {
        isDark = newDark;
        listeners.forEach((l) => l({ matches: newDark, media: query }));
      },
    };
  };

  const setDark = (dark: boolean) => {
    isDark = dark;
    listeners.forEach((l) =>
      l({
        matches: dark,
        media: "(prefers-color-scheme: dark)",
      }),
    );
  };

  return { matchMedia, setDark };
}

// ============================================================================
// 2. R1: Account Creation & Normalization Specification Contract
// ============================================================================

export type CreatableAccountType = "asset" | "liability" | "expense" | "revenue";

export function normalizeAccountType(type?: string): CreatableAccountType {
  if (!type) return "asset";
  const lower = type.toLowerCase().trim();
  if (
    lower === "liabilities" ||
    lower === "liability" ||
    lower === "loan" ||
    lower === "debt" ||
    lower === "mortgage"
  ) {
    return "liability";
  }
  if (lower === "expense" || lower === "expenses") return "expense";
  if (lower === "revenue" || lower === "revenues" || lower === "income") return "revenue";
  return "asset";
}

export interface CreateAccountFormValues {
  name: string;
  type: string;
  currencyCode?: string;
  accountRole?: string;
  liabilityType?: string;
  liabilityDirection?: string;
  openingBalance?: string;
  openingBalanceDate?: string;
  iban?: string;
  accountNumber?: string;
  notes?: string;
}

export interface AccountPayload {
  name: string;
  type: string;
  currency_code?: string;
  account_role?: string;
  liability_type?: string;
  liability_direction?: string;
  opening_balance?: string;
  opening_balance_date?: string;
  iban?: string;
  account_number?: string;
  notes?: string;
}

export function buildAccountPayload(values: CreateAccountFormValues, fallbackDate: string): AccountPayload {
  const normType = normalizeAccountType(values.type);
  const name = values.name.trim();
  if (!name) {
    throw new Error("Account name is required");
  }

  const payload: AccountPayload = {
    name,
    type: normType,
  };

  if (values.currencyCode?.trim()) {
    payload.currency_code = values.currencyCode.trim();
  }
  if (values.notes?.trim()) {
    payload.notes = values.notes.trim();
  }
  if (values.iban?.trim()) {
    payload.iban = values.iban.trim();
  }
  if (values.accountNumber?.trim()) {
    payload.account_number = values.accountNumber.trim();
  }

  if (normType === "asset") {
    payload.account_role = values.accountRole?.trim() || "defaultAsset";
    if (values.openingBalance?.trim()) {
      payload.opening_balance = values.openingBalance.trim();
      payload.opening_balance_date = values.openingBalanceDate?.trim() || fallbackDate;
    }
  } else if (normType === "liability") {
    payload.liability_type = values.liabilityType?.trim() || "loan";
    payload.liability_direction = values.liabilityDirection?.trim() || "credit";
    if (values.openingBalance?.trim()) {
      payload.opening_balance = values.openingBalance.trim();
      payload.opening_balance_date = values.openingBalanceDate?.trim() || fallbackDate;
    }
  }

  return payload;
}

// ============================================================================
// 3. R2: 30-Day KPI Calculations with Decimal.js Specification Contract
// ============================================================================

export interface KpiResult {
  inflow: Decimal;
  outflow: Decimal;
  netChange: Decimal;
  transactionCount: number;
}

export interface AccountMetadataDisplay {
  iban: string;
  role: string;
  openingBalanceDate: string;
  currency: string;
  notes: string;
}

export function compute30DayKpis(params: {
  accountId: string;
  groups: TransactionGroup[];
  referenceDate: string; // ISO date YYYY-MM-DD
}): KpiResult {
  const { accountId, groups, referenceDate } = params;
  const refStart = new Date(referenceDate + "T00:00:00.000Z");
  const refEnd = new Date(referenceDate + "T23:59:59.999Z");
  // 30 days prior (start of day)
  const cutoff = new Date(refStart.getTime() - 30 * 24 * 60 * 60 * 1000);

  let inflow = new Decimal(0);
  let outflow = new Decimal(0);
  let transactionCount = 0;

  for (const group of groups) {
    let groupCounted = false;

    for (const split of group.transactions) {
      const splitDate = new Date(split.date);
      // Check if within 30-day window [cutoff, refEnd]
      if (splitDate < cutoff || splitDate > refEnd) {
        continue;
      }

      const amountDec = new Decimal(split.amount || "0").abs();
      const isDestination = split.destination_id === accountId;
      const isSource = split.source_id === accountId;

      if (!isDestination && !isSource) {
        continue;
      }

      if (!groupCounted) {
        transactionCount++;
        groupCounted = true;
      }

      // Inflow types
      if (split.type === "deposit" && isDestination) {
        inflow = inflow.plus(amountDec);
      } else if (split.type === "transfer" && isDestination) {
        inflow = inflow.plus(amountDec);
      } else if (split.type === "opening balance" && isDestination) {
        inflow = inflow.plus(amountDec);
      }
      // Outflow types
      else if (split.type === "withdrawal" && isSource) {
        outflow = outflow.plus(amountDec);
      } else if (split.type === "transfer" && isSource) {
        outflow = outflow.plus(amountDec);
      }
    }
  }

  const netChange = inflow.minus(outflow);

  return {
    inflow,
    outflow,
    netChange,
    transactionCount,
  };
}

export function formatAccountMetadata(account?: Partial<Account>): AccountMetadataDisplay {
  return {
    iban: account?.iban?.trim() || "—",
    role: account?.account_role?.trim() || (account?.type ? String(account.type) : "—"),
    openingBalanceDate: account?.current_balance_date || "—",
    currency: account?.currency_code || account?.currency_symbol || "—",
    notes: account?.notes?.trim() || "No notes recorded",
  };
}

// ============================================================================
// 4. R3: Theme Management Specification Contract
// ============================================================================

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface ThemeManagerOptions {
  storage: MockStorage;
  matchMedia: (query: string) => MockMediaQueryList;
  onThemeChange?: (theme: Theme, resolved: ResolvedTheme) => void;
}

export class ThemeManager {
  private theme: Theme = "system";
  private resolvedTheme: ResolvedTheme = "light";
  private storage: MockStorage;
  private matchMediaQuery: MockMediaQueryList;
  private onThemeChange?: (theme: Theme, resolved: ResolvedTheme) => void;
  private cleanupListener?: () => void;

  constructor(options: ThemeManagerOptions) {
    this.storage = options.storage;
    this.onThemeChange = options.onThemeChange;
    this.matchMediaQuery = options.matchMedia("(prefers-color-scheme: dark)");

    // Initialize from storage or default to system
    const saved = this.storage.getItem("color-scheme");
    if (saved === "light" || saved === "dark" || saved === "system") {
      this.theme = saved;
    } else {
      this.theme = "system";
    }

    this.resolve();
    this.bindMediaListener();
  }

  private resolve() {
    if (this.theme === "system") {
      this.resolvedTheme = this.matchMediaQuery.matches ? "dark" : "light";
    } else {
      this.resolvedTheme = this.theme;
    }
    this.onThemeChange?.(this.theme, this.resolvedTheme);
  }

  private bindMediaListener() {
    const handler = (e: { matches: boolean }) => {
      if (this.theme === "system") {
        this.resolvedTheme = e.matches ? "dark" : "light";
        this.onThemeChange?.(this.theme, this.resolvedTheme);
      }
    };
    this.matchMediaQuery.addEventListener("change", handler);
    this.cleanupListener = () => {
      this.matchMediaQuery.removeEventListener("change", handler);
    };
  }

  public getTheme(): Theme {
    return this.theme;
  }

  public getResolvedTheme(): ResolvedTheme {
    return this.resolvedTheme;
  }

  public setTheme(newTheme: Theme) {
    this.theme = newTheme;
    this.storage.setItem("color-scheme", newTheme);
    this.resolve();
  }

  public cycleTheme() {
    // Cycle: system -> light -> dark -> system
    if (this.theme === "system") {
      this.setTheme("light");
    } else if (this.theme === "light") {
      this.setTheme("dark");
    } else {
      this.setTheme("system");
    }
  }

  public destroy() {
    this.cleanupListener?.();
  }
}

// ============================================================================
// 5. R4: Universal Escape Stack Specification Contract
// ============================================================================

export interface Dismissible {
  id: string;
  onDismiss: () => void;
}

export class EscapeStackManager {
  private stack: Dismissible[] = [];

  public register(id: string, onDismiss: () => void): () => void {
    const item: Dismissible = { id, onDismiss };
    this.stack.push(item);
    return () => {
      this.unregister(id);
    };
  }

  public unregister(id: string) {
    this.stack = this.stack.filter((item) => item.id !== id);
  }

  public handleKeyDown(key: string): boolean {
    if (key !== "Escape" || this.stack.length === 0) {
      return false;
    }
    // LIFO: pop the topmost overlay
    const top = this.stack.pop();
    if (top) {
      top.onDismiss();
      return true;
    }
    return false;
  }

  public getStackSize(): number {
    return this.stack.length;
  }

  public getTopId(): string | undefined {
    return this.stack[this.stack.length - 1]?.id;
  }

  public clear() {
    this.stack = [];
  }
}

// ============================================================================
// 6. R4: Usability & Accessibility Specification Contract Helpers
// ============================================================================

export interface TouchTargetDimensions {
  width: number;
  height: number;
}

export function meetsTouchTargetMinimum(dimensions: TouchTargetDimensions): boolean {
  return dimensions.width >= 48 && dimensions.height >= 48;
}

export function parseCssPxDimension(styleValue: string): number {
  const match = styleValue.match(/^([\d.]+)px$/);
  if (!match) return 0;
  return parseFloat(match[1]);
}

export interface SafeAreaCheck {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export function hasSafeAreaInsets(cssText: string): SafeAreaCheck {
  return {
    top: cssText.includes("env(safe-area-inset-top)"),
    bottom: cssText.includes("env(safe-area-inset-bottom)"),
    left: cssText.includes("env(safe-area-inset-left)"),
    right: cssText.includes("env(safe-area-inset-right)"),
  };
}


// ============================================================================
// 7. R5: Universal Filter Engine Specification Contract
// ============================================================================

export type PeriodPreset =
  | "7D"
  | "30D"
  | "12W"
  | "6M"
  | "1Y"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "custom";

export type AccountFilterMode = "all_stats" | "all" | "custom";

export interface FilterState {
  preset: PeriodPreset;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  accountFilter: AccountFilterMode;
  selectedAccountIds: string[];
}

/**
 * Format Date to YYYY-MM-DD string in UTC to avoid time-zone drift
 */
export function formatIsoDateUtc(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDateUtc(str: string): Date {
  const parts = str.split("-").map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

/**
 * Derives start and end date for any filter preset based on an optional reference date (defaults to today)
 */
export function calculatePresetDateRange(
  preset: PeriodPreset,
  referenceDateStr?: string,
): { startDate: string; endDate: string } {
  const ref = referenceDateStr ? parseIsoDateUtc(referenceDateStr) : new Date();
  const refYear = ref.getUTCFullYear();
  const refMonth = ref.getUTCMonth();
  const refDate = ref.getUTCDate();

  switch (preset) {
    case "7D": {
      // 7 days inclusive: [ref - 6 days, ref]
      const start = new Date(Date.UTC(refYear, refMonth, refDate - 6));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(ref) };
    }
    case "30D": {
      // 30 days inclusive: [ref - 29 days, ref]
      const start = new Date(Date.UTC(refYear, refMonth, refDate - 29));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(ref) };
    }
    case "12W": {
      // 12 weeks = 84 days inclusive: [ref - 83 days, ref]
      const start = new Date(Date.UTC(refYear, refMonth, refDate - 83));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(ref) };
    }
    case "6M": {
      // 6 calendar months ago to today
      const start = new Date(Date.UTC(refYear, refMonth - 6, refDate));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(ref) };
    }
    case "1Y": {
      // 1 calendar year ago to today
      const start = new Date(Date.UTC(refYear - 1, refMonth, refDate));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(ref) };
    }
    case "this_month": {
      const start = new Date(Date.UTC(refYear, refMonth, 1));
      // Last day of current month: Day 0 of next month
      const end = new Date(Date.UTC(refYear, refMonth + 1, 0));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(end) };
    }
    case "last_month": {
      const start = new Date(Date.UTC(refYear, refMonth - 1, 1));
      const end = new Date(Date.UTC(refYear, refMonth, 0));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(end) };
    }
    case "this_year": {
      const start = new Date(Date.UTC(refYear, 0, 1));
      const end = new Date(Date.UTC(refYear, 11, 31));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(end) };
    }
    case "last_year": {
      const start = new Date(Date.UTC(refYear - 1, 0, 1));
      const end = new Date(Date.UTC(refYear - 1, 11, 31));
      return { startDate: formatIsoDateUtc(start), endDate: formatIsoDateUtc(end) };
    }
    case "custom":
    default: {
      return { startDate: formatIsoDateUtc(ref), endDate: formatIsoDateUtc(ref) };
    }
  }
}

/**
 * Step backward (-1) or forward (+1) by one period duration
 */
export function stepPeriod(
  current: { preset?: PeriodPreset; startDate: string; endDate: string },
  direction: -1 | 1,
): { startDate: string; endDate: string } {
  const { preset = "custom", startDate, endDate } = current;
  const start = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);

  switch (preset) {
    case "7D": {
      const shiftedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + direction * 7));
      const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + direction * 7));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "30D": {
      const shiftedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + direction * 30));
      const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + direction * 30));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "12W": {
      const shiftedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + direction * 84));
      const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + direction * 84));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "6M": {
      const shiftedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + direction * 6, start.getUTCDate()));
      const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + direction * 6, end.getUTCDate()));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "1Y": {
      const shiftedStart = new Date(Date.UTC(start.getUTCFullYear() + direction, start.getUTCMonth(), start.getUTCDate()));
      const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear() + direction, end.getUTCMonth(), end.getUTCDate()));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "this_month":
    case "last_month": {
      // Step to whole calendar month
      const currentYear = start.getUTCFullYear();
      const currentMonth = start.getUTCMonth();
      const targetMonth = currentMonth + direction;
      const shiftedStart = new Date(Date.UTC(currentYear, targetMonth, 1));
      const shiftedEnd = new Date(Date.UTC(currentYear, targetMonth + 1, 0));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "this_year":
    case "last_year": {
      // Step whole calendar year
      const targetYear = start.getUTCFullYear() + direction;
      const shiftedStart = new Date(Date.UTC(targetYear, 0, 1));
      const shiftedEnd = new Date(Date.UTC(targetYear, 11, 31));
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
    case "custom":
    default: {
      // Compute span in milliseconds and shift both ends
      const spanMs = end.getTime() - start.getTime() + 24 * 60 * 60 * 1000;
      const shiftedStart = new Date(start.getTime() + direction * spanMs);
      const shiftedEnd = new Date(end.getTime() + direction * spanMs);
      return { startDate: formatIsoDateUtc(shiftedStart), endDate: formatIsoDateUtc(shiftedEnd) };
    }
  }
}

/**
 * Filter accounts based on mode:
 * - 'all_stats': exclude accounts where include_net_worth === false
 * - 'all': all accounts included
 * - 'custom': only selected account IDs
 */
export function filterAccountsForStats<T extends { id: string; include_net_worth?: boolean; attributes?: { include_net_worth?: boolean } }>(
  accounts: T[],
  mode: AccountFilterMode,
  selectedAccountIds: string[] = [],
): T[] {
  if (mode === "all") {
    return accounts;
  }
  if (mode === "custom") {
    const set = new Set(selectedAccountIds);
    return accounts.filter((a) => set.has(a.id));
  }
  // 'all_stats' (default)
  return accounts.filter((a) => {
    if (a.include_net_worth === false) return false;
    if (a.attributes && a.attributes.include_net_worth === false) return false;
    return true;
  });
}

/**
 * Serialize FilterState to URLSearchParams or query string
 */
export function serializeFilterToQueryParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("period", state.preset);
  params.set("start", state.startDate);
  params.set("end", state.endDate);
  params.set("account_filter", state.accountFilter);
  if (state.accountFilter === "custom" && state.selectedAccountIds.length > 0) {
    for (const id of state.selectedAccountIds) {
      params.append("accounts[]", id);
    }
  }
  return params;
}

/**
 * Deserialize FilterState from URLSearchParams
 */
export function deserializeFilterFromQueryParams(params: URLSearchParams | Record<string, string | string[]>): Partial<FilterState> {
  const getParam = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const val = params[key];
    return Array.isArray(val) ? val[0] : val ?? null;
  };

  const result: Partial<FilterState> = {};
  const period = getParam("period") as PeriodPreset | null;
  if (period) result.preset = period;

  const start = getParam("start");
  if (start) result.startDate = start;

  const end = getParam("end");
  if (end) result.endDate = end;

  const accFilter = getParam("account_filter") as AccountFilterMode | null;
  if (accFilter) result.accountFilter = accFilter;

  if (params instanceof URLSearchParams) {
    const accs = params.getAll("accounts[]");
    if (accs.length > 0) result.selectedAccountIds = accs;
  } else if ("accounts[]" in params) {
    const accs = params["accounts[]"];
    result.selectedAccountIds = Array.isArray(accs) ? accs : [accs];
  }

  return result;
}

// ============================================================================
// 8. R6: Desktop PEMDAS Math Evaluator Specification Contract
// ============================================================================

export type MathToken =
  | { type: "number"; value: Decimal }
  | { type: "operator"; op: "+" | "-" | "*" | "/" }
  | { type: "left_paren" }
  | { type: "right_paren" };

export function tokenizeMathExpression(expr: string): MathToken[] {
  const cleaned = expr.trim();
  if (!cleaned) return [];

  const tokens: MathToken[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const char = cleaned[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "left_paren" });
      i++;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "right_paren" });
      i++;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      // Check for unary minus:
      // A minus is unary if it is at the start of expression or preceded by operator or left paren
      const prevToken = tokens[tokens.length - 1];
      const isUnaryMinus =
        char === "-" &&
        (!prevToken || prevToken.type === "operator" || prevToken.type === "left_paren");

      if (isUnaryMinus) {
        // Read the number following the unary minus
        let numStr = "-";
        i++;
        while (i < cleaned.length && /\s/.test(cleaned[i])) i++;
        while (i < cleaned.length && /[\d.]/.test(cleaned[i])) {
          numStr += cleaned[i];
          i++;
        }
        if (numStr === "-") {
          // Unary minus with no number
          continue;
        }
        try {
          tokens.push({ type: "number", value: new Decimal(numStr) });
        } catch {
          // Malformed number
        }
        continue;
      }

      tokens.push({ type: "operator", op: char });
      i++;
      continue;
    }

    if (/[\d.]/.test(char)) {
      let numStr = "";
      while (i < cleaned.length && /[\d.]/.test(cleaned[i])) {
        numStr += cleaned[i];
        i++;
      }
      try {
        tokens.push({ type: "number", value: new Decimal(numStr) });
      } catch {
        // Ignore malformed token
      }
      continue;
    }

    // Skip any non-math character
    i++;
  }

  return tokens;
}

/**
 * Evaluates math expression using standard Shunting Yard + RPN evaluation with Decimal.js
 * Respects PEMDAS: Parentheses, Multiplication/Division, Addition/Subtraction
 */
export function evaluateMathExpression(expr: string): string {
  if (!expr || !expr.trim()) return "0";

  try {
    const tokens = tokenizeMathExpression(expr);
    if (tokens.length === 0) return "0";

    // Clean up trailing operators if user is still typing (e.g. "150 +")
    while (tokens.length > 0 && tokens[tokens.length - 1].type === "operator") {
      tokens.pop();
    }
    if (tokens.length === 0) return "0";

    // Convert infix tokens to postfix (RPN) via Shunting Yard
    const outputQueue: MathToken[] = [];
    const operatorStack: MathToken[] = [];

    const precedence: Record<string, number> = {
      "+": 1,
      "-": 1,
      "*": 2,
      "/": 2,
    };

    for (const token of tokens) {
      if (token.type === "number") {
        outputQueue.push(token);
      } else if (token.type === "operator") {
        while (
          operatorStack.length > 0 &&
          operatorStack[operatorStack.length - 1].type === "operator" &&
          precedence[(operatorStack[operatorStack.length - 1] as Extract<MathToken, { type: "operator" }>).op] >= precedence[token.op]
        ) {
          outputQueue.push(operatorStack.pop()!);
        }
        operatorStack.push(token);
      } else if (token.type === "left_paren") {
        operatorStack.push(token);
      } else if (token.type === "right_paren") {
        while (
          operatorStack.length > 0 &&
          operatorStack[operatorStack.length - 1].type !== "left_paren"
        ) {
          outputQueue.push(operatorStack.pop()!);
        }
        if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].type === "left_paren") {
          operatorStack.pop(); // Discard '('
        }
      }
    }

    while (operatorStack.length > 0) {
      const top = operatorStack.pop()!;
      if (top.type !== "left_paren" && top.type !== "right_paren") {
        outputQueue.push(top);
      }
    }

    if (outputQueue.length === 0) return "0";

    // Evaluate RPN
    const evalStack: Decimal[] = [];

    for (const token of outputQueue) {
      if (token.type === "number") {
        evalStack.push(token.value);
      } else if (token.type === "operator") {
        if (evalStack.length < 2) continue;
        const b = evalStack.pop()!;
        const a = evalStack.pop()!;
        let res: Decimal;

        switch (token.op) {
          case "+":
            res = a.plus(b);
            break;
          case "-":
            res = a.minus(b);
            break;
          case "*":
            res = a.mul(b);
            break;
          case "/":
            if (b.isZero()) {
              // Division by zero: fall back to a or return 0
              res = new Decimal(0);
            } else {
              res = a.div(b);
            }
            break;
          default:
            res = new Decimal(0);
        }
        evalStack.push(res);
      }
    }

    if (evalStack.length === 0) return "0";
    const finalVal = evalStack[0];

    // Clamping to 0 if negative, formatted cleanly
    if (finalVal.isNegative()) return "0";

    // Return clean string with up to 10 significant digits
    return finalVal.toSignificantDigits(10).toString();
  } catch {
    return "0";
  }
}

/**
 * Apply quick denomination chip (+10, +50, +100) to current expression or amount
 */
export function applyDenominationChip(currentExpr: string, delta: number): string {
  const currentVal = new Decimal(evaluateMathExpression(currentExpr));
  const nextVal = currentVal.plus(delta);
  return nextVal.isNegative() ? "0" : nextVal.toString();
}

// ============================================================================
// 9. R7: BudgetBakers Reports Aggregations Specification Contract
// ============================================================================

export interface BalanceTrendResult {
  currentTotal: Decimal;
  previousTotal: Decimal;
  difference: Decimal;
  percentageChange: number;
  trend: "up" | "down" | "flat";
}

export function computeBalanceTrend(params: {
  currentTotal: Decimal | number | string;
  previousTotal: Decimal | number | string;
}): BalanceTrendResult {
  const cur = new Decimal(params.currentTotal || 0);
  const prev = new Decimal(params.previousTotal || 0);
  const diff = cur.minus(prev);

  let pctChange = 0;
  if (!prev.isZero()) {
    pctChange = diff.div(prev.abs()).mul(100).toDecimalPlaces(2).toNumber();
  } else if (!cur.isZero()) {
    pctChange = cur.isPositive() ? 100 : -100;
  }

  const trend: "up" | "down" | "flat" = diff.gt(0) ? "up" : diff.lt(0) ? "down" : "flat";

  return {
    currentTotal: cur,
    previousTotal: prev,
    difference: diff,
    percentageChange: pctChange,
    trend,
  };
}

export interface CashFlowKpis {
  inflow: Decimal;
  outflow: Decimal;
  netSaved: Decimal;
  savingsRatePercent: number;
}

export function computeCashFlowKpis(
  transactions: Array<{ type: string; amount: string | number; destination_id?: string; source_id?: string }>,
): CashFlowKpis {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);

  for (const tx of transactions) {
    const amt = new Decimal(tx.amount || 0).abs();
    if (tx.type === "deposit" || tx.type === "opening balance") {
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

  const baseDate = parseIsoDateUtc(startDate);

  for (let dayOffset = 1; dayOffset <= 30; dayOffset++) {
    const targetDate = new Date(
      Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + dayOffset),
    );
    const targetDateStr = formatIsoDateUtc(targetDate);
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

export function computeCreditDebtGauge(
  accounts: Array<{
    type?: string;
    liability_type?: string;
    current_balance?: string | number;
    credit_limit?: string | number;
  }>,
): CreditDebtGaugeResult {
  let totalDebt = new Decimal(0);
  let creditCardDebt = new Decimal(0);
  let totalCreditLimit = new Decimal(0);

  for (const acc of accounts) {
    const bal = new Decimal(acc.current_balance || 0).abs();
    const limit = new Decimal(acc.credit_limit || 0).abs();

    if (acc.type === "liability") {
      totalDebt = totalDebt.plus(bal);
      if (acc.liability_type === "credit_card" || acc.liability_type === "credit card") {
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
