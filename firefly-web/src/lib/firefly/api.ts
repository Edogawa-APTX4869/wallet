import type {
  About,
  AboutUser,
  Account,
  BasicSummary,
  Bill,
  Budget,
  BudgetLimit,
  Category,
  ChartDataSet,
  ConfigEntry,
  Currency,
  ExchangeRate,
  InsightEntry,
  InsightTotalEntry,
  ListResponse,
  NewSplit,
  PiggyBank,
  Recurrence,
  Resource,
  Rule,
  RuleGroup,
  RulePayload,
  SingleResponse,
  Tag,
  TransactionGroup,
  Webhook,
} from "./types";
import type { StoredRate } from "@/lib/fx/resolve";

export class FireflyError extends Error {
  status: number;
  fields: Record<string, string[]>;
  constructor(message: string, status: number, fields: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export type Params = Record<
  string,
  string | number | boolean | undefined | null | Array<string | number>
>;

export function qs(params?: Params): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      const key = k.endsWith("[]") ? k : `${k}[]`;
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") {
          sp.append(key, String(item));
        }
      }
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, params?: Params, body?: unknown): Promise<T> {
  const res = await fetch(`/api/ff/${path.replace(/^\/+/, "")}${qs(params)}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { message?: string; errors?: Record<string, string[]> };
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("about")) {
      window.location.replace("/login?expired=1");
    }
    const fieldMsgs = j.errors ? Object.values(j.errors).flat() : [];
    throw new FireflyError(
      fieldMsgs[0] || j.message || `Request failed (HTTP ${res.status})`,
      res.status,
      j.errors ?? {},
    );
  }
  return json as T;
}

export const ff = {
  get: <T>(path: string, params?: Params) => request<T>("GET", path, params),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, undefined, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, undefined, body),
  del: (path: string) => request<void>("DELETE", path),
};

/** Fetches every page of a list endpoint (capped to protect the server). */
export async function getAll<T>(path: string, params: Params = {}, maxPages = 20): Promise<Resource<T>[]> {
  const out: Resource<T>[] = [];
  let page = 1;
  for (;;) {
    const res = await ff.get<ListResponse<T>>(path, { ...params, page, limit: params.limit ?? 100 });
    out.push(...res.data);
    const total = res.meta?.pagination?.total_pages ?? 1;
    if (page >= total || page >= maxPages || res.data.length === 0) break;
    page++;
  }
  return out;
}

// ---------- Domain helpers ----------

export const api = {
  about: () => ff.get<{ data: About }>("about").then((r) => r.data),
  user: () => ff.get<{ data: { attributes: AboutUser } }>("about/user").then((r) => r.data.attributes),

  accounts: (type: string = "all") => getAll<Account>("accounts", { type }),
  account: (id: string) => ff.get<SingleResponse<Account>>(`accounts/${id}`).then((r) => r.data),
  updateAccount: (id: string, payload: Partial<Account>) =>
    ff.put<SingleResponse<Account>>(`accounts/${id}`, payload),
  createAccount: (payload: {
    name: string;
    type: string;
    currency_code?: string;
    account_role?: string;
    liability_type?: string;
    liability_direction?: string;
    iban?: string;
    account_number?: string;
    opening_balance?: string;
    opening_balance_date?: string;
    notes?: string;
  }) =>
    ff.post<SingleResponse<Account>>("accounts", payload),
  deleteAccount: (id: string) => ff.del(`accounts/${id}`),
  accountTransactions: (id: string, page = 1, params: Params = {}) =>
    ff.get<ListResponse<TransactionGroup>>(`accounts/${id}/transactions`, { page, limit: 50, ...params }),

  transactions: (page = 1, params: Params = {}) =>
    ff.get<ListResponse<TransactionGroup>>("transactions", { page, limit: 50, ...params }),
  searchTransactions: (query: string, page = 1) =>
    ff.get<ListResponse<TransactionGroup>>("search/transactions", { query, page, limit: 50 }),
  createTransaction: (splits: NewSplit[], groupTitle?: string) =>
    ff.post<SingleResponse<TransactionGroup>>("transactions", {
      error_if_duplicate_hash: false,
      apply_rules: true,
      fire_webhooks: true,
      group_title: groupTitle,
      transactions: splits,
    }),
  uploadTransactionAttachment: async (
    journalId: string,
    file: { name: string; type: string; dataUrl: string },
  ) => {
    const created = await ff.post<SingleResponse<{ filename: string }>>("attachments", {
      filename: file.name,
      attachable_type: "TransactionJournal",
      attachable_id: String(journalId),
      title: file.name,
      notes: "Uploaded via FireFly Companion",
    });
    const attachmentId = created.data.id;
    const base64Part = file.dataUrl.includes(",") ? file.dataUrl.split(",")[1] : file.dataUrl;
    const binaryStr = atob(base64Part);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const uploadRes = await fetch(`/api/ff/attachments/${encodeURIComponent(attachmentId)}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!uploadRes.ok) {
      throw new Error(`Failed to upload binary for attachment ${file.name} (HTTP ${uploadRes.status})`);
    }
    return attachmentId;
  },
  updateTransaction: (id: string, splits: Partial<NewSplit>[], groupTitle?: string) =>
    ff.put<SingleResponse<TransactionGroup>>(`transactions/${id}`, {
      apply_rules: true,
      fire_webhooks: true,
      group_title: groupTitle,
      transactions: splits,
    }),
  deleteTransaction: (id: string) => ff.del(`transactions/${id}`),

  currencies: () => getAll<Currency>("currencies"),
  primaryCurrency: async (): Promise<Currency | null> => {
    for (const path of ["currencies/primary", "currencies/default"]) {
      try {
        const r = await ff.get<SingleResponse<Currency>>(path);
        if (r?.data?.attributes?.code) return r.data.attributes;
      } catch {
        /* try next */
      }
    }
    return null;
  },

  exchangeRates: () => getAll<ExchangeRate>("exchange-rates", {}, 10),
  exchangeRatesFor: async (from: string, to: string): Promise<StoredRate[]> => {
    try {
      const list = await getAll<ExchangeRate>(`exchange-rates/${from}/${to}`, {}, 10);
      return list.map((r) => ({
        from: r.attributes.from_currency_code ?? r.attributes.from ?? from,
        to: r.attributes.to_currency_code ?? r.attributes.to ?? to,
        rate: String(r.attributes.rate),
        date: String(r.attributes.date),
      }));
    } catch (e) {
      if (e instanceof FireflyError && (e.status === 404 || e.status === 422)) return [];
      throw e;
    }
  },
  storeExchangeRate: (from: string, to: string, rate: string, date: string) =>
    ff.post("exchange-rates", { from, to, rate, date }),
  deleteExchangeRate: (id: string) => ff.del(`exchange-rates/${id}`),

  summary: (start: string, end: string) => ff.get<BasicSummary>("summary/basic", { start, end }),
  accountChart: (start: string, end: string) =>
    ff.get<ChartDataSet[]>("chart/account/overview", { start, end }),

  // ---------- Insight & Analytical Helpers ----------
  insightExpenseCategory: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/expense/category", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightExpenseNoCategory: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/expense/no-category", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightRevenueCategory: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/income/category", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightIncomeCategory: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/income/category", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightExpenseAsset: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/expense/asset", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightExpenseBill: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/expense/bill", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightExpenseBudget: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightEntry[]>("insight/expense/budget", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightExpenseTotal: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightTotalEntry[]>("insight/expense/total", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),
  insightIncomeTotal: (start: string, end: string, accountIds?: string[]) =>
    ff.get<InsightTotalEntry[]>("insight/income/total", {
      start,
      end,
      ...(accountIds?.length ? { accounts: accountIds } : {}),
    }),

  budgets: (start: string, end: string) => getAll<Budget>("budgets", { start, end }),
  budgetLimits: (start: string, end: string) => getAll<BudgetLimit>("budget-limits", { start, end }),
  createBudget: (name: string) => ff.post("budgets", { name, active: true }),
  setBudgetLimit: (budgetId: string, amount: string, start: string, end: string, currency_code?: string) =>
    ff.post(`budgets/${budgetId}/limits`, { amount, start, end, currency_code }),

  categories: (start?: string, end?: string) => getAll<Category>("categories", { start, end }),
  createCategory: (name: string) => ff.post<SingleResponse<Category>>("categories", { name }),
  updateCategory: (id: string, name: string) => ff.put<SingleResponse<Category>>(`categories/${id}`, { name }),
  deleteCategory: (id: string) => ff.del(`categories/${id}`),

  tags: () => getAll<Tag>("tags"),
  createTag: (tag: string) => ff.post<SingleResponse<Tag>>("tags", { tag }),
  updateTag: (id: string, tag: string) => ff.put<SingleResponse<Tag>>(`tags/${id}`, { tag }),
  deleteTag: (id: string) => ff.del(`tags/${id}`),

  // ---------- Automatic Rules & Rule Groups ----------
  rules: () => getAll<Rule>("rules"),
  rule: (id: string) => ff.get<SingleResponse<Rule>>(`rules/${id}`).then((r) => r.data),
  createRule: (payload: RulePayload) => ff.post<SingleResponse<Rule>>("rules", payload),
  updateRule: (id: string, payload: Partial<RulePayload>) => ff.put<SingleResponse<Rule>>(`rules/${id}`, payload),
  deleteRule: (id: string) => ff.del(`rules/${id}`),
  testRule: (id: string, params?: { start?: string; end?: string; accounts?: string }) =>
    ff.get<ListResponse<TransactionGroup>>(`rules/${id}/test`, params),
  triggerRule: (id: string, params?: { start?: string; end?: string; accounts?: string }) =>
    ff.post<void>(`rules/${id}/trigger${qs(params)}`, {}),

  ruleGroups: () => getAll<RuleGroup>("rule-groups"),
  createRuleGroup: (title: string, description?: string) =>
    ff.post<SingleResponse<RuleGroup>>("rule-groups", { title, description, active: true }),
  updateRuleGroup: (id: string, data: { title: string; description?: string; active?: boolean }) =>
    ff.put<SingleResponse<RuleGroup>>(`rule-groups/${id}`, data),
  deleteRuleGroup: (id: string) => ff.del(`rule-groups/${id}`),
  testRuleGroup: (id: string, params?: { start?: string; end?: string; accounts?: string }) =>
    ff.get<ListResponse<TransactionGroup>>(`rule-groups/${id}/test`, params),
  triggerRuleGroup: (id: string, params?: { start?: string; end?: string; accounts?: string }) =>
    ff.post<void>(`rule-groups/${id}/trigger${qs(params)}`, {}),

  // ---------- Recurring Transactions & Bills ----------
  recurrences: () => getAll<Recurrence>("recurrences"),
  createRecurrence: (payload: unknown) => ff.post<SingleResponse<Recurrence>>("recurrences", payload),
  triggerRecurrence: (id: string, date?: string) =>
    ff.post<unknown>(`recurrences/${id}/trigger${qs(date ? { date } : undefined)}`, {}),
  deleteRecurrence: (id: string) => ff.del(`recurrences/${id}`),

  bills: (start?: string, end?: string) => getAll<Bill>("bills", { start, end }),
  billRules: (id: string) => getAll<Rule>(`bills/${id}/rules`),
  billTransactions: (id: string, params?: { start?: string; end?: string }) =>
    getAll<TransactionGroup>(`bills/${id}/transactions`, params),
  createBill: (payload: {
    name: string;
    amount_min: string;
    amount_max: string;
    currency_code?: string;
    date: string;
    repeat_freq: Bill["repeat_freq"];
    skip?: number;
    active?: boolean;
    notes?: string;
  }) => ff.post<SingleResponse<Bill>>("bills", payload),
  deleteBill: (id: string) => ff.del(`bills/${id}`),

  // ---------- Server Configuration, Currencies & Webhooks ----------
  configuration: () =>
    ff
      .get<{ data: Array<Resource<ConfigEntry> | ConfigEntry> } | Array<Resource<ConfigEntry> | ConfigEntry>>(
        "configuration",
      )
      .then((r) => {
        const list = Array.isArray(r) ? r : r.data ?? [];
        return list.map((item): ConfigEntry => {
          if ("attributes" in item && item.attributes) {
            return {
              title: item.attributes.title ?? item.id,
              value: item.attributes.value,
              editable: item.attributes.editable ?? true,
            };
          }
          return item as ConfigEntry;
        });
      }),
  updateConfiguration: (key: string, value: boolean | number | string) =>
    ff.put(`configuration/${key.replace(/^configuration\./, "")}`, { value }),

  createCurrency: (data: { code: string; name: string; symbol: string; decimal_places: number; enabled?: boolean }) =>
    ff.post<SingleResponse<Currency>>("currencies", data),
  updateCurrency: (
    code: string,
    data: { code: string; name: string; symbol: string; decimal_places: number; enabled?: boolean; primary?: boolean },
  ) => ff.put<SingleResponse<Currency>>(`currencies/${encodeURIComponent(code)}`, data),
  enableCurrency: (code: string) => ff.post<SingleResponse<Currency>>(`currencies/${encodeURIComponent(code)}/enable`, {}),
  disableCurrency: (code: string) => ff.post<SingleResponse<Currency>>(`currencies/${encodeURIComponent(code)}/disable`, {}),
  defaultCurrency: (code: string) => ff.post<SingleResponse<Currency>>(`currencies/${encodeURIComponent(code)}/primary`, {}),

  webhooks: () => getAll<Webhook>("webhooks"),
  createWebhook: (data: {
    title: string;
    url: string;
    trigger?: string;
    triggers?: string[];
    response?: string;
    responses?: string[];
    delivery?: string;
    deliveries?: string[];
    active?: boolean;
  }) => ff.post<SingleResponse<Webhook>>("webhooks", data),
  deleteWebhook: (id: string) => ff.del(`webhooks/${id}`),

  // ---------- Piggy Banks ----------
  piggyBanks: () => getAll<PiggyBank>("piggy-banks"),
  createPiggyBank: (data: {
    name: string;
    account_id: string;
    target_amount: string;
    current_amount?: string;
    start_date?: string;
    target_date?: string;
    notes?: string;
  }) => ff.post<SingleResponse<PiggyBank>>("piggy-banks", data),
  updatePiggyBank: (
    id: string,
    data: {
      name: string;
      account_id: string;
      target_amount: string;
      current_amount?: string;
      target_date?: string | null;
      notes?: string | null;
    },
  ) => ff.put<SingleResponse<PiggyBank>>(`piggy-banks/${id}`, data),
  deletePiggyBank: (id: string) => ff.del(`piggy-banks/${id}`),
};
