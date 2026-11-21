import Decimal from "decimal.js";
import type { Account, Category, Resource } from "@/lib/firefly/types";

export interface LiabilityCategoryPrefs {
  owedToMeCategory: string;
  iOweCategory: string;
}

export const LIABILITY_CATEGORY_STORAGE_KEY = "ff_liability_category_prefs_v1";

const LIABILITY_ACCOUNT_TYPES = new Set([
  "liability",
  "liabilities",
  "loan",
  "debt",
  "mortgage",
]);

export function isLiabilityAccount(acc: Resource<Account> | null | undefined): boolean {
  if (!acc) return false;
  const t = String(acc.attributes.type || "").toLowerCase().trim();
  return LIABILITY_ACCOUNT_TYPES.has(t) || Boolean(acc.attributes.liability_type);
}

export function loadLocalLiabilityCategoryPrefs(): LiabilityCategoryPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIABILITY_CATEGORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiabilityCategoryPrefs>;
    return {
      owedToMeCategory: typeof parsed.owedToMeCategory === "string" ? parsed.owedToMeCategory.trim() : "",
      iOweCategory: typeof parsed.iOweCategory === "string" ? parsed.iOweCategory.trim() : "",
    };
  } catch {
    return null;
  }
}

export function saveLocalLiabilityCategoryPrefs(prefs: LiabilityCategoryPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LIABILITY_CATEGORY_STORAGE_KEY,
      JSON.stringify({
        owedToMeCategory: prefs.owedToMeCategory.trim(),
        iOweCategory: prefs.iOweCategory.trim(),
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Resolves the default category name for a liability transaction ("credit" = Owed to me, "debit" = I owe).
 * Priority:
 * 1. Explicit user setting from Settings (`prefs`)
 * 2. LocalStorage cached setting
 * 3. Smart auto-match from existing Firefly III categories (e.g. "Loan (Owed to me)")
 * 4. Sensible default ("Loan (Owed to me)" or "Loan")
 */
export function resolveLiabilityCategory(params: {
  direction?: "credit" | "debit" | string | null;
  prefs?: Partial<LiabilityCategoryPrefs> | null;
  categories?: Array<Resource<Category>> | string[];
}): string {
  const isCredit = params.direction === "credit";
  const local = loadLocalLiabilityCategoryPrefs();
  const configured = isCredit
    ? params.prefs?.owedToMeCategory?.trim() || local?.owedToMeCategory?.trim()
    : params.prefs?.iOweCategory?.trim() || local?.iOweCategory?.trim();

  if (configured) return configured;

  const names: string[] = (params.categories ?? []).map((c) =>
    typeof c === "string" ? c : c.attributes.name,
  );

  if (isCredit) {
    const exactOwed = names.find((n) => /loan.*owed|owed.*me/i.test(n));
    if (exactOwed) return exactOwed;
  } else {
    const exactDebt = names.find((n) => /debt|repay|installment|loan/i.test(n) && !/owed to me/i.test(n));
    if (exactDebt) return exactDebt;
  }

  const anyLoan = names.find((n) => /loan|debt|liabilit/i.test(n));
  if (anyLoan) return anyLoan;

  return isCredit ? "Loan (Owed to me)" : "Loan";
}

/**
 * Builds a prefilled `/new` URL for recording a liability repayment or loan disbursement.
 *
 * Firefly III Accounting Rules for Liabilities:
 * - "Owed to me" (`liability_direction === "credit"`):
 *   - `action = "repay"` ("They paid me"): `type = "deposit"` (Income), `source_id = liability.id`, `destination_id = asset.id`
 *   - `action = "advance"` ("Lend more"): `type = "withdrawal"` (Expense), `source_id = asset.id`, `destination_id = liability.id`
 * - "I owe" (`liability_direction !== "credit"`):
 *   - `action = "repay"` ("I'm paying"): `type = "withdrawal"` (Expense), `source_id = asset.id`, `destination_id = liability.id`
 *   - `action = "advance"` ("Borrow more"): `type = "deposit"` (Income), `source_id = liability.id`, `destination_id = asset.id`
 */
export function buildLiabilityActionHref(params: {
  account: Resource<Account>;
  action: "repay" | "advance";
  prefs?: Partial<LiabilityCategoryPrefs> | null;
  categories?: Array<Resource<Category>> | string[];
  prefillAmount?: boolean;
}): string {
  const { account, action, prefs, categories, prefillAmount = action === "repay" } = params;
  const a = account.attributes;
  const isCredit = a.liability_direction === "credit";

  // Determine Firefly III transaction type:
  // Money coming into user's asset account from liability -> deposit (Income)
  // Money leaving user's asset account into liability -> withdrawal (Expense)
  const txType: "deposit" | "withdrawal" =
    (isCredit && action === "repay") || (!isCredit && action === "advance")
      ? "deposit"
      : "withdrawal";

  const category = resolveLiabilityCategory({
    direction: isCredit ? "credit" : "debit",
    prefs,
    categories,
  });

  let description: string;
  if (isCredit) {
    description = action === "repay" ? `Collect Loan - ${a.name}` : `Loan to ${a.name}`;
  } else {
    description = action === "repay" ? `Loan Payment - ${a.name}` : `Loan from ${a.name}`;
  }

  const q = new URLSearchParams();
  q.set("type", txType);
  q.set("liabilityId", String(account.id));
  q.set("counterparty", a.name);
  q.set("description", description);
  if (category) q.set("category", category);

  if (prefillAmount) {
    try {
      const bal = new Decimal(a.current_balance ?? 0).abs();
      if (bal.gt(0)) {
        q.set("amount", bal.toString());
      }
    } catch {
      // ignore invalid balance
    }
  }

  return `/new?${q.toString()}`;
}
