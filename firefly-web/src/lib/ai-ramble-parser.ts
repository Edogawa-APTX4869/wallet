export type AiProviderType = "disabled" | "local-heuristic" | "gemini" | "openai-compatible";

export type AiActionKind =
  | "transaction"
  | "budget_adjust"
  | "budget_transfer"
  | "piggy_bank"
  | "bill"
  | "recurrence"
  | "category"
  | "account";

export interface AttachmentPayload {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface ParsedTransactionDraft {
  action_type?: AiActionKind;
  type: "withdrawal" | "deposit" | "transfer";
  amount: string;
  currency_code: string;
  foreign_amount?: string;
  foreign_currency_code?: string;
  description: string;
  source_name: string;
  destination_name: string;
  category_name: string;
  budget_name: string;
  bill_name?: string;
  tags: string[];
  notes?: string;
  date: string;
  adjust_mode?: "set" | "add" | "subtract" | "create";
  repeat_freq?: "daily" | "weekly" | "monthly" | "quarterly" | "half-year" | "yearly";
  target_date?: string;
  account_type?: "asset" | "liability" | "expense" | "revenue";
}

export interface AccountContextItem {
  name: string;
  currency: string;
  balance: string;
  type?: string;
}

export interface BudgetContextItem {
  name: string;
  limit: string;
  spent: string;
  left: string;
  currency: string;
}

export interface PiggyContextItem {
  name: string;
  current: string;
  target: string;
  account?: string;
  currency?: string;
}

export interface BillContextItem {
  name: string;
  amount: string;
  freq: string;
  currency: string;
}

export interface CategoryContextItem {
  name: string;
  spent?: string;
}

export interface SmartParseContext {
  text: string;
  today: string;
  defaultCurrency: string;
  defaultAccount: string;
  accounts: string[];
  categories: string[];
  budgets: string[];
  tags: string[];
  accountDetails?: AccountContextItem[];
  budgetDetails?: BudgetContextItem[];
  piggyDetails?: PiggyContextItem[];
  billDetails?: BillContextItem[];
  categoryDetails?: CategoryContextItem[];
}

const CURRENCY_MAP: Record<string, string> = {
  bhd: "BHD",
  bd: "BHD",
  dinar: "BHD",
  dinars: "BHD",
  usd: "USD",
  $: "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  "€": "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  "£": "GBP",
  sar: "SAR",
  aed: "AED",
  kwd: "KWD",
  omr: "OMR",
};

function extractAmountAndCurrency(
  seg: string,
  defaultCurrency: string,
): { amount: string; currency_code: string; rawMatch: string } | null {
  const amtMatch = seg.match(
    /(?:(BHD|BD|USD|\$|EUR|€|GBP|£|SAR|AED|KWD|OMR)\s*)?(\d+(?:[.,]\d{1,4})?)\s*(BHD|BD|dinars?|USD|\$|dollars?|EUR|€|euros?|GBP|£|SAR|AED|KWD|OMR)?/i,
  );
  if (!amtMatch) return null;
  const rawCur = (amtMatch[1] || amtMatch[3] || "").toLowerCase();
  return {
    amount: amtMatch[2].replace(",", "."),
    currency_code: CURRENCY_MAP[rawCur] || defaultCurrency,
    rawMatch: amtMatch[0],
  };
}

function findMatchedItem(names: string[], textLower: string, excludeLower?: string): string {
  const sorted = [...names]
    .filter((n) => n && n.toLowerCase() !== (excludeLower ?? ""))
    .sort((a, b) => b.length - a.length);
  return sorted.find((n) => textLower.includes(n.toLowerCase())) ?? "";
}

function extractFreq(
  lower: string,
): "daily" | "weekly" | "monthly" | "quarterly" | "half-year" | "yearly" {
  if (/\b(daily|every day)\b/i.test(lower)) return "daily";
  if (/\b(weekly|every week)\b/i.test(lower)) return "weekly";
  if (/\b(quarterly|every quarter)\b/i.test(lower)) return "quarterly";
  if (/\b(half[- ]year|semi[- ]annual)\b/i.test(lower)) return "half-year";
  if (/\b(yearly|annual|every year)\b/i.test(lower)) return "yearly";
  return "monthly";
}

/**
 * Generates a concise live answer from Firefly context when the user asks a question.
 */
export function generateSmartReply(
  ctx: SmartParseContext,
  drafts: ParsedTransactionDraft[],
): string {
  const lower = ctx.text.toLowerCase();
  const isQuestion =
    /\?/.test(ctx.text) ||
    /^\s*(what|how|which|show|list|tell me|check|status|summary)\b/i.test(lower);

  if (!isQuestion && drafts.length > 0) return "";

  if (/\b(balances?|accounts?|how much do i have|net worth|money)\b/i.test(lower)) {
    const list = ctx.accountDetails ?? [];
    if (list.length === 0) return "No account balances available yet.";
    const summary = list
      .slice(0, 6)
      .map((a) => `${a.name}: ${a.currency} ${a.balance}`)
      .join(" · ");
    return `Account balances: ${summary}${list.length > 6 ? ` (+${list.length - 6} more)` : ""}.`;
  }

  if (/\b(budgets?|overspent|over budget|left to spend|limits?)\b/i.test(lower)) {
    const list = ctx.budgetDetails ?? [];
    if (list.length === 0) return "No budgets configured for this month.";
    const overspent = list.filter((b) => Number(b.left) < 0);
    if (overspent.length > 0) {
      return `Overspent budgets: ${overspent
        .map((b) => `${b.name} (over by ${b.currency} ${Math.abs(Number(b.left)).toFixed(3)})`)
        .join(", ")}.`;
    }
    return `Budgets: ${list
      .slice(0, 5)
      .map((b) => `${b.name}: ${b.currency} ${b.left} left of ${b.limit}`)
      .join(" · ")}.`;
  }

  if (/\b(pigg(?:y|ies)|goals?|savings?)\b/i.test(lower)) {
    const list = ctx.piggyDetails ?? [];
    if (list.length === 0) return "No piggy banks created yet.";
    return `Piggy banks: ${list
      .slice(0, 5)
      .map((p) => `${p.name}: ${p.currency ?? ctx.defaultCurrency} ${p.current}/${p.target}`)
      .join(" · ")}.`;
  }

  if (/\b(bills?|subscriptions?|due)\b/i.test(lower)) {
    const list = ctx.billDetails ?? [];
    if (list.length === 0) return "No bills found.";
    return `Bills: ${list
      .slice(0, 5)
      .map((b) => `${b.name} (${b.currency} ${b.amount} ${b.freq})`)
      .join(" · ")}.`;
  }

  return "";
}

/**
 * Deterministic offline parser supporting transactions, budget adjustments,
 * budget transfers, piggy banks, bills, recurrences, categories, and accounts.
 */
export function parseWithSmartHeuristics(ctx: SmartParseContext): ParsedTransactionDraft[] {
  const segments = ctx.text
    .split(/\n+|;|\b(?:and\s+(?:spent|paid|bought|received|transferred|moved|got|add|set|create)|then)\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const results: ParsedTransactionDraft[] = [];

  for (const seg of segments) {
    const lower = seg.toLowerCase();

    const catCreateMatch = seg.match(
      /^\s*(?:create|add|new)\s+(?:a\s+)?category\s+(?:named\s+|called\s+)?["']?(.+?)["']?\s*$/i,
    );
    if (catCreateMatch) {
      const catName = catCreateMatch[1].trim();
      if (catName) {
        results.push({
          action_type: "category",
          type: "withdrawal",
          amount: "0",
          currency_code: ctx.defaultCurrency,
          description: catName,
          source_name: "",
          destination_name: "",
          category_name: catName,
          budget_name: "",
          tags: [],
          date: ctx.today,
        });
        continue;
      }
    }

    const accCreateMatch = seg.match(
      /^\s*(?:create|add|new)\s+(?:a\s+|an\s+)?(?:(asset|liability|expense|revenue)\s+)?account\s+(?:named\s+|called\s+)?(.+)$/i,
    );
    if (accCreateMatch) {
      const accType = (accCreateMatch[1]?.toLowerCase() as ParsedTransactionDraft["account_type"]) || "asset";
      const parsedAmt = extractAmountAndCurrency(accCreateMatch[2], ctx.defaultCurrency);
      const rawName = (parsedAmt ? accCreateMatch[2].replace(parsedAmt.rawMatch, "") : accCreateMatch[2])
        .replace(/\b(USD|BHD|EUR|GBP|SAR|AED|KWD|OMR|BD)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const curMatch = accCreateMatch[2].match(/\b(BHD|USD|EUR|GBP|SAR|AED|KWD|OMR)\b/i);
      const currency_code = parsedAmt?.currency_code || (curMatch ? curMatch[1].toUpperCase() : ctx.defaultCurrency);
      if (rawName) {
        results.push({
          action_type: "account",
          type: "withdrawal",
          amount: parsedAmt?.amount ?? "0",
          currency_code,
          description: rawName,
          source_name: rawName,
          destination_name: "",
          category_name: "",
          budget_name: "",
          tags: [],
          date: ctx.today,
          account_type: accType,
        });
        continue;
      }
    }

    const amtInfo = extractAmountAndCurrency(seg, ctx.defaultCurrency);
    if (!amtInfo) continue;

    const { amount, currency_code, rawMatch } = amtInfo;
    let date = ctx.today;
    if (/\byesterday\b/i.test(lower)) {
      const d = new Date(`${ctx.today}T12:00:00`);
      d.setDate(d.getDate() - 1);
      date = d.toISOString().slice(0, 10);
    } else if (/\btomorrow\b/i.test(lower)) {
      const d = new Date(`${ctx.today}T12:00:00`);
      d.setDate(d.getDate() + 1);
      date = d.toISOString().slice(0, 10);
    }

    if (
      /\bbudget\b/i.test(lower) &&
      /\b(transfer|move|shift|reallocate)\b/i.test(lower) &&
      /\bfrom\b.+\bto\b/i.test(lower)
    ) {
      const fromToMatch = seg.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+budget)?$/i);
      const knownBudgets = ctx.budgets ?? [];
      let fromBudget = "";
      let toBudget = "";
      if (fromToMatch) {
        const leftClean = fromToMatch[1].replace(/\bbudgets?\b/gi, "").trim();
        const rightClean = fromToMatch[2].replace(/\bbudgets?\b/gi, "").trim();
        fromBudget = findMatchedItem(knownBudgets, leftClean.toLowerCase()) || leftClean;
        toBudget = findMatchedItem(knownBudgets, rightClean.toLowerCase(), fromBudget.toLowerCase()) || rightClean;
      } else {
        fromBudget = findMatchedItem(knownBudgets, lower);
        toBudget = findMatchedItem(knownBudgets, lower, fromBudget.toLowerCase());
      }
      if (fromBudget && toBudget && fromBudget.toLowerCase() !== toBudget.toLowerCase()) {
        results.push({
          action_type: "budget_transfer",
          type: "transfer",
          amount,
          currency_code,
          description: `Transfer ${fromBudget} → ${toBudget}`,
          source_name: fromBudget,
          destination_name: toBudget,
          category_name: "",
          budget_name: toBudget,
          tags: [],
          date,
        });
        continue;
      }
    }

    if (/\bbudget\b/i.test(lower) && /\b(set|adjust|add|increase|subtract|reduce|decrease|create|new)\b/i.test(lower)) {
      const adjustMode: ParsedTransactionDraft["adjust_mode"] = /\b(create|new)\b/i.test(lower)
        ? "create"
        : /\b(subtract|reduce|decrease|minus|remove)\b/i.test(lower)
          ? "subtract"
          : /\b(add|increase|plus|top\s*up)\b/i.test(lower)
            ? "add"
            : "set";
      let budgetName = findMatchedItem(ctx.budgets ?? [], lower);
      if (!budgetName) {
        budgetName = seg
          .replace(rawMatch, "")
          .replace(/\b(set|adjust|add|increase|subtract|reduce|decrease|create|new|budget|to|from|for|of|limit)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      if (budgetName) {
        results.push({
          action_type: "budget_adjust",
          type: "withdrawal",
          amount,
          currency_code,
          description: budgetName,
          source_name: "",
          destination_name: budgetName,
          category_name: "",
          budget_name: budgetName,
          tags: [],
          date,
          adjust_mode: adjustMode,
        });
        continue;
      }
    }

    if (/\b(piggy(?:\s*bank)?|savings?\s*goal)\b/i.test(lower)) {
      const isCreate = /\b(create|new)\b/i.test(lower);
      const isSubtract = /\b(remove|withdraw|subtract|take)\b/i.test(lower);
      const knownPiggies = (ctx.piggyDetails ?? []).map((p) => p.name);
      let piggyName = findMatchedItem(knownPiggies, lower);
      if (!piggyName) {
        piggyName = seg
          .replace(rawMatch, "")
          .replace(/\b(create|add|new|remove|withdraw|subtract|piggy\s*bank|piggy|savings\s*goal|goal|to|from|for|of|named|called)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const matchedAcc = findMatchedItem(ctx.accounts, lower) || ctx.defaultAccount;
      results.push({
        action_type: "piggy_bank",
        type: isSubtract ? "withdrawal" : "deposit",
        amount,
        currency_code,
        description: piggyName || "Savings Goal",
        source_name: matchedAcc,
        destination_name: piggyName || "Savings Goal",
        category_name: "",
        budget_name: "",
        tags: [],
        date,
        adjust_mode: isCreate ? "create" : isSubtract ? "subtract" : "add",
      });
      continue;
    }

    if (/\b(recurring|recurrence|repeating|schedule)\b/i.test(lower)) {
      const freq = extractFreq(lower);
      const matchedAcc = findMatchedItem(ctx.accounts, lower) || ctx.defaultAccount;
      const category_name = findMatchedItem(ctx.categories, lower);
      const title = seg
        .replace(rawMatch, "")
        .replace(/\b(create|add|new|recurring|recurrence|repeating|schedule|transaction|daily|weekly|monthly|quarterly|yearly|every\s+month|every\s+week)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      results.push({
        action_type: "recurrence",
        type: /\b(salary|income|received|deposit)\b/i.test(lower) ? "deposit" : "withdrawal",
        amount,
        currency_code,
        description: title || "Recurring Payment",
        source_name: matchedAcc,
        destination_name: title || "Payee",
        category_name,
        budget_name: "",
        tags: [],
        date,
        repeat_freq: freq,
      });
      continue;
    }

    if (/\b(create|add|new)\s+(?:a\s+|an\s+)?(?:(?:daily|weekly|monthly|quarterly|yearly)\s+)?bill\b/i.test(lower)) {
      const freq = extractFreq(lower);
      const billName = seg
        .replace(rawMatch, "")
        .replace(/\b(create|add|new|bill|subscription|daily|weekly|monthly|quarterly|half-year|yearly|for|of)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      results.push({
        action_type: "bill",
        type: "withdrawal",
        amount,
        currency_code,
        description: billName || "Bill",
        source_name: ctx.defaultAccount,
        destination_name: billName || "Bill",
        category_name: "",
        budget_name: "",
        bill_name: billName || "Bill",
        tags: [],
        date,
        repeat_freq: freq,
      });
      continue;
    }

    let type: "withdrawal" | "deposit" | "transfer" = "withdrawal";
    if (/\b(received|salary|income|earned|deposited|refund|cashback)\b/i.test(lower)) {
      type = "deposit";
    } else if (/\b(transfer|transferred|moved)\b/i.test(lower)) {
      type = "transfer";
    }

    let category_name = "";
    if (type !== "transfer") {
      category_name = findMatchedItem(ctx.categories, lower);
      if (!category_name) {
        for (const c of ctx.categories) {
          const parts = c.toLowerCase().split(/[:/>›]/).map((p) => p.trim());
          if (parts.some((p) => p.length > 2 && lower.includes(p))) {
            category_name = c;
            break;
          }
        }
      }
    }

    let matchedAccount = findMatchedItem(ctx.accounts, lower) || ctx.defaultAccount;
    let destAccount = "";
    if (type === "transfer") {
      const fromToAccMatch = seg.match(/\bfrom\s+(.+?)\s+to\s+(.+)$/i);
      if (fromToAccMatch) {
        const srcMatch = findMatchedItem(ctx.accounts, fromToAccMatch[1].toLowerCase()) || matchedAccount;
        const dstMatch = findMatchedItem(ctx.accounts, fromToAccMatch[2].toLowerCase(), srcMatch.toLowerCase());
        matchedAccount = srcMatch;
        destAccount = dstMatch;
      } else {
        destAccount = findMatchedItem(ctx.accounts, lower, matchedAccount.toLowerCase());
      }
    }

    let budget_name = "";
    if (type === "withdrawal") {
      budget_name = findMatchedItem(ctx.budgets ?? [], lower);
      if (!budget_name && category_name) {
        const catParent = category_name.split(/[:/>›]/)[0].trim().toLowerCase();
        budget_name = (ctx.budgets ?? []).find((b) => b.toLowerCase() === catParent) ?? "";
      }
    }

    const bill_name =
      type === "withdrawal"
        ? findMatchedItem((ctx.billDetails ?? []).map((b) => b.name), lower)
        : "";

    const foundTags: string[] = [];
    const hashMatches = seg.matchAll(/#([\w-]+)/g);
    for (const m of hashMatches) foundTags.push(m[1]);
    for (const t of ctx.tags) {
      if (t && lower.includes(t.toLowerCase()) && !foundTags.includes(t)) {
        foundTags.push(t);
      }
    }

    let desc = seg
      .replace(rawMatch, "")
      .replace(/\b(spent|paid|bought|for|on|at|from|to|yesterday|today|tomorrow|this morning|tonight|transfer|transferred|moved|received)\b/gi, " ")
      .replace(/#[\w-]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!desc) {
      desc =
        type === "transfer" && destAccount
          ? `Transfer to ${destAccount}`
          : category_name || (type === "deposit" ? "Income" : "Expense");
    }
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);

    results.push({
      action_type: "transaction",
      type,
      amount,
      currency_code,
      description: desc,
      source_name: type === "deposit" ? desc : matchedAccount,
      destination_name:
        type === "transfer" ? destAccount : type === "deposit" ? matchedAccount : desc,
      category_name,
      budget_name,
      bill_name: bill_name || undefined,
      tags: foundTags,
      date,
    });
  }

  return results;
}
