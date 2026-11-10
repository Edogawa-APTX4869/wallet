"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  ArrowLeftRight,
  BookmarkPlus,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Delete,
  FileText,
  Minus,
  Paperclip,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { NewSplit } from "@/lib/firefly/types";
import type { TransactionTemplateRow } from "@/lib/server/db";
import { accountCurrency, ASSET_LIKE, useAccounts, useCurrencies } from "@/lib/hooks";
import { formatRate } from "@/lib/fx/resolve";
import { cn, isoDate, monthRange, parseAmount, zeroPlaceholder } from "@/lib/utils";
import { AccountPicker } from "@/components/account-picker";
import { CategoryCascadeSelect } from "@/components/category-cascade";
import { LinkedAmountFields, useLinkedAmounts, type CurrencyInfo } from "@/components/linked-amounts";
import { MagicChatPanel } from "@/components/magic-chatbar";
import { ICON_CATALOG, inferCategoryDefaultStyle, ResourceIconBadge } from "@/components/resource-icon";
import { AnimatedTabs, Badge, Button, Card, ErrorBox, Field, Input, ModalSheet, Select, Skeleton } from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

type TxType = "withdrawal" | "deposit" | "transfer" | "ramble";

const TABS: { type: TxType; label: string; icon: typeof Minus }[] = [
  { type: "deposit", label: "INCOME", icon: Plus },
  { type: "withdrawal", label: "EXPENSE", icon: Minus },
  { type: "transfer", label: "TRANSFER", icon: ArrowLeftRight },
  { type: "ramble", label: "AI MAGIC", icon: Wand2 },
];

const RECENT_KEY = "ff-recent-transfer-pairs";
type Pair = { s: string; d: string };

function loadPairs(): Pair[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function savePair(p: Pair) {
  try {
    const list = [p, ...loadPairs().filter((x) => !(x.s === p.s && x.d === p.d))].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

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

      // Check for unary plus:
      const isUnaryPlus =
        char === "+" &&
        (!prevToken || prevToken.type === "operator" || prevToken.type === "left_paren");
      if (isUnaryPlus) {
        i++;
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

export function evaluateCalcExpression(expr: string): string {
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
              // Division by zero: fall back to 0
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

    // Return clean fixed string without exponential notation, trimmed of trailing zeroes
    const fixedStr = finalVal.toFixed();
    return fixedStr.includes(".") ? fixedStr.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : fixedStr;
  } catch {
    return "0";
  }
}

export function applyDenominationChip(currentExpr: string, delta: number): string {
  const currentVal = new Decimal(evaluateCalcExpression(currentExpr));
  const nextVal = currentVal.plus(delta);
  return nextVal.isNegative() ? "0" : nextVal.toString();
}

export function NewTransaction() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("type");
  const templateParam = params.get("template");
  const type: TxType =
    raw === "deposit" || raw === "transfer" || raw === "ramble" ? raw : "withdrawal";

  return (
    <div className="mx-auto w-full max-w-5xl">
      {type === "ramble" ? (
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold">Magic Assistant (&ldquo;Ramble&rdquo;)</h1>
            <Button variant="secondary" size="sm" onClick={() => router.replace("/new?type=withdrawal")}>
              Calculator View
            </Button>
          </div>
          <RambleAssistant />
        </div>
      ) : (
        <WalletCalculatorForm key={`${type}-${templateParam ?? ""}`} type={type} initialTemplateId={templateParam} />
      )}
    </div>
  );
}

// ============================================================================
// BUDGETBAKERS WALLET-STYLE CALCULATOR + SWIPE DETAILS + SETUP CURRENCY MODAL
// ============================================================================

function WalletCalculatorForm({
  type,
  initialTemplateId,
}: {
  type: "withdrawal" | "deposit" | "transfer";
  initialTemplateId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const accountsQ = useAccounts("all");
  const currenciesQ = useCurrencies();
  const month = monthRange(0);
  const budgetsQ = useQuery({
    queryKey: ["budgets-list"],
    queryFn: () => api.budgets(month.start, month.end),
    enabled: type === "withdrawal",
    staleTime: 5 * 60_000,
  });
  const categoriesQ = useQuery({ queryKey: ["categories-list"], queryFn: () => api.categories(), staleTime: 5 * 60_000 });
  const tagsQ = useQuery({ queryKey: ["tags-list"], queryFn: api.tags, staleTime: 5 * 60_000 });
  const templatesQ = useQuery({
    queryKey: ["companion-templates"],
    queryFn: async () => {
      const res = await fetch("/api/companion/templates");
      if (!res.ok) return [] as TransactionTemplateRow[];
      const json = (await res.json()) as { data?: TransactionTemplateRow[] };
      return json.data ?? [];
    },
  });

  const all = accountsQ.data ?? [];
  const assetLike = all
    .filter((a) => ASSET_LIKE.has(a.attributes.type) && a.attributes.active !== false)
    .sort((a, b) => (a.attributes.type === "asset" ? 0 : 1) - (b.attributes.type === "asset" ? 0 : 1));
  const expenseNames = all.filter((a) => a.attributes.type === "expense").map((a) => a.attributes.name);
  const revenueNames = all.filter((a) => a.attributes.type === "revenue").map((a) => a.attributes.name);

  // Form state (supports pre-filling from URL query params when duplicating a transaction or paying a bill)
  const [selectedAssetId, setAssetId] = useState<string | null>(() => searchParams.get("sourceId"));
  const [destId, setDestId] = useState<string | null>(() => searchParams.get("destId"));
  const [counterparty, setCounterparty] = useState(() => searchParams.get("counterparty") ?? "");
  const [foreignCode, setForeignCode] = useState(() => searchParams.get("foreignCode") ?? "");
  const [description, setDescription] = useState(() => searchParams.get("description") ?? "");
  const [date, setDate] = useState(isoDate());
  const [category, setCategory] = useState(() => searchParams.get("category") ?? "");
  const [budgetId, setBudgetId] = useState(() => searchParams.get("budgetId") ?? "");
  const [tags, setTags] = useState(() => searchParams.get("tags") ?? "");
  const [billId, setBillId] = useState<string | null>(() => searchParams.get("billId") ?? searchParams.get("bill_id"));
  const [billName, setBillName] = useState<string | null>(() => searchParams.get("billName") ?? searchParams.get("bill_name"));
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; dataUrl: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Pair[]>(() => (typeof window !== "undefined" ? loadPairs() : []));

  // Calculator & Details Drawer state
  const [expr, setExpr] = useState(() => searchParams.get("amount") ?? "");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [seededUrlAmount, setSeededUrlAmount] = useState(false);

  // Two-toggle Exchange Rate Mode:
  // "save" = Save the new exchange rate to Firefly III
  // "once" = Just one-time change for this transaction only
  const [rateMode, setRateMode] = useState<"save" | "once">("save");
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [modalSourceAmt, setModalSourceAmt] = useState("");
  const [modalTargetAmt, setModalTargetAmt] = useState("");
  const [modalRateStr, setModalRateStr] = useState("");

  // Save as Template state
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [appliedInitTemplate, setAppliedInitTemplate] = useState<string | null>(null);

  useEscapeDismiss(detailsOpen, () => setDetailsOpen(false), "new-transaction-details");
  useEscapeDismiss(showSaveTemplate, () => setShowSaveTemplate(false), "new-transaction-save-template");

  const handleCancelOrBack = () => {
    if (detailsOpen) {
      setDetailsOpen(false);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const assetId = selectedAssetId ?? assetLike[0]?.id ?? null;
  const asset = all.find((a) => a.id === assetId) ?? null;
  const defaultDest = assetLike.find((a) => a.id !== assetId) ?? assetLike[0] ?? null;
  const effectiveDestId = destId ?? (type === "transfer" ? defaultDest?.id ?? null : null);
  const dest = all.find((a) => a.id === effectiveDestId) ?? null;

  const assetCur: CurrencyInfo | null = asset ? accountCurrency(asset) : null;
  let otherCur: CurrencyInfo | null = null;
  if (type === "transfer") otherCur = dest ? accountCurrency(dest) : null;
  else if (foreignCode) {
    const c = currenciesQ.data?.find((x) => x.attributes.code === foreignCode);
    otherCur = c ? { code: c.attributes.code, symbol: c.attributes.symbol, decimals: c.attributes.decimal_places } : null;
  } else otherCur = assetCur;

  const linked = useLinkedAmounts(assetCur, otherCur, date);
  const { state } = linked;

  const urlAmount = searchParams.get("amount");
  if (urlAmount && !seededUrlAmount) {
    setSeededUrlAmount(true);
    linked.controls.setFrom(urlAmount);
  }

  // Apply URL `?template=` once loaded
  if (initialTemplateId && appliedInitTemplate !== initialTemplateId && templatesQ.data) {
    const found = templatesQ.data.find((t) => t.id === initialTemplateId);
    if (found) {
      setAppliedInitTemplate(initialTemplateId);
      if (found.source_id) setAssetId(found.source_id);
      if (found.destination_id) setDestId(found.destination_id);
      if (found.destination_name || found.source_name) setCounterparty(found.destination_name || found.source_name);
      if (found.foreign_currency_code) setForeignCode(found.foreign_currency_code);
      if (found.description) setDescription(found.description);
      if (found.category_name) setCategory(found.category_name);
      if (found.budget_id) setBudgetId(found.budget_id);
      if (found.tags) setTags(found.tags);
      if (found.notes) setNotes(found.notes);
      if (found.amount) {
        setExpr(found.amount);
        linked.controls.setFrom(found.amount);
      }
    }
  }

  function applyTemplate(t: TransactionTemplateRow) {
    if (t.source_id) setAssetId(t.source_id);
    if (t.destination_id) setDestId(t.destination_id);
    if (t.destination_name || t.source_name) setCounterparty(t.destination_name || t.source_name);
    if (t.foreign_currency_code) setForeignCode(t.foreign_currency_code);
    if (t.description) setDescription(t.description);
    if (t.category_name) setCategory(t.category_name);
    if (t.budget_id) setBudgetId(t.budget_id);
    if (t.tags) setTags(t.tags);
    if (t.notes) setNotes(t.notes);
    if (t.amount) {
      setExpr(t.amount);
      linked.controls.setFrom(t.amount);
    }
    toast(`Applied template "${t.name}"`);
  }

  function onCalcPress(key: string) {
    let next = expr;
    if (key === "BACK") {
      next = expr.slice(0, -1);
    } else if (key === "C") {
      next = "";
    } else if (key === "=") {
      next = evaluateCalcExpression(expr);
    } else if (["+", "-", "*", "/"].includes(key)) {
      if (!expr) next = "0" + key;
      else if (/[+\-*/]$/.test(expr)) next = expr.slice(0, -1) + key;
      else next = expr + key;
    } else {
      next = expr === "0" && key !== "." ? key : expr + key;
    }
    setExpr(next);
    const val = evaluateCalcExpression(next);
    linked.controls.setFrom(val === "0" && !next ? "" : val);
  }

  function swapTransferAccounts() {
    if (type !== "transfer" || !assetId || !effectiveDestId) return;
    setAssetId(effectiveDestId);
    setDestId(assetId);
    linked.controls.reset();
  }

  function openSetupCurrencyModal() {
    const srcAmt = state.fromAmount || "100";
    const curRate = state.rate ?? new Decimal(1);
    const dstDec = otherCur?.decimals ?? 2;
    const dstAmt = state.toAmount || new Decimal(srcAmt).mul(curRate).toFixed(dstDec);
    setModalSourceAmt(srcAmt);
    setModalTargetAmt(dstAmt);
    setModalRateStr(formatRate(curRate));
    setCurrencyModalOpen(true);
  }

  function onModalTargetChange(nextTarget: string) {
    setModalTargetAmt(nextTarget);
    const s = parseAmount(modalSourceAmt);
    const t = parseAmount(nextTarget);
    if (s && t && new Decimal(s).gt(0) && new Decimal(t).gt(0)) {
      const r = new Decimal(t).div(s);
      setModalRateStr(r.toSignificantDigits(8).toString());
    }
  }

  function onModalRateChange(nextRate: string) {
    setModalRateStr(nextRate);
    const s = parseAmount(modalSourceAmt) || "1";
    const r = parseAmount(nextRate);
    if (r && new Decimal(r).gt(0)) {
      const dstDec = otherCur?.decimals ?? 2;
      setModalTargetAmt(new Decimal(s).mul(r).toFixed(dstDec));
    }
  }

  function confirmSetupCurrencyModal() {
    const s = parseAmount(modalSourceAmt);
    const r = parseAmount(modalRateStr);
    if (s) {
      setExpr(s);
      linked.controls.setFrom(s);
    }
    if (r && new Decimal(r).gt(0)) {
      linked.controls.setRateOverride(r);
    }
    setCurrencyModalOpen(false);
  }

  const saveTemplateMut = useMutation({
    mutationFn: async () => {
      if (!templateName.trim()) throw new Error("Enter a template name");
      const res = await fetch("/api/companion/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          type,
          amount: state.fromAmount,
          currency_code: assetCur?.code || "",
          foreign_amount: state.isCross ? state.toAmount : "",
          foreign_currency_code: state.isCross ? otherCur?.code || "" : "",
          source_id: asset?.id || "",
          source_name: counterparty,
          destination_id: dest?.id || "",
          destination_name: counterparty,
          description: description || defaultDescription(),
          category_name: category,
          budget_id: budgetId,
          tags,
          notes,
        }),
      });
      if (!res.ok) throw new Error("Could not save template");
      return res.json();
    },
    onSuccess: () => {
      toast(`Template "${templateName}" saved`);
      setTemplateName("");
      setShowSaveTemplate(false);
      qc.invalidateQueries({ queryKey: ["companion-templates"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delTemplateMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/companion/templates?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("Template removed", "info");
      qc.invalidateQueries({ queryKey: ["companion-templates"] });
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!asset) throw new Error("Choose an account.");
      const amount = state.fromAmount;
      if (!amount || new Decimal(amount).lte(0)) throw new Error("Enter an amount greater than zero.");
      if (state.isCross && (!state.toAmount || new Decimal(state.toAmount).lte(0))) {
        throw new Error(`Enter the ${otherCur?.code} amount.`);
      }

      const split: NewSplit = {
        type,
        date,
        amount,
        description: description.trim() || defaultDescription(),
        currency_code: assetCur?.code || undefined,
        category_name: category.trim() || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        notes: notes.trim() || undefined,
      };
      if (state.isCross) {
        split.foreign_amount = state.toAmount;
        split.foreign_currency_code = otherCur!.code;
      }
      if (type === "withdrawal") {
        split.source_id = asset.id;
        if (counterparty.trim()) split.destination_name = counterparty.trim();
        if (budgetId) split.budget_id = budgetId;
        if (billId) split.bill_id = billId;
        if (billName) split.bill_name = billName;
      } else if (type === "deposit") {
        split.destination_id = asset.id;
        if (counterparty.trim()) split.source_name = counterparty.trim();
      } else {
        if (!dest) throw new Error("Choose the destination account.");
        split.source_id = asset.id;
        split.destination_id = dest.id;
      }

      const res = await api.createTransaction([split]);
      const journalId =
        res.data.attributes.transactions?.[0]?.transaction_journal_id ||
        res.data.id;

      if (attachments.length > 0 && journalId) {
        for (const file of attachments) {
          await api.uploadTransactionAttachment(String(journalId), file);
        }
      }

      // Only persist the exchange rate if the user selected "Save new exchange rate" (not "Just one-time change")
      if (
        state.isCross &&
        state.isManualRate &&
        rateMode === "save" &&
        state.rate &&
        state.rate.gt(0)
      ) {
        try {
          await api.storeExchangeRate(
            assetCur!.code,
            otherCur!.code,
            state.rate.toSignificantDigits(12).toString(),
            date,
          );
          qc.invalidateQueries({ queryKey: ["rates"] });
          qc.invalidateQueries({ queryKey: ["resolved-rate"] });
          qc.invalidateQueries({ queryKey: ["rates-to-primary"] });
        } catch (e) {
          toast(`Transaction saved, but the rate could not be stored: ${(e as Error).message}`, "error");
        }
      }
      return res;
    },
    onSuccess: () => {
      toast(`${TABS.find((t) => t.type === type)?.label} saved`);
      if (type === "transfer" && asset && dest) {
        savePair({ s: asset.id, d: dest.id });
        setPairs(loadPairs());
      }
      linked.controls.reset();
      setExpr("");
      setDescription("");
      setNotes("");
      setAttachments([]);
      setError(null);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      router.push("/");
    },
    onError: (e) => setError((e as Error).message),
  });

  // Physical keyboard / numpad support when not focused inside an input/textarea/select
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (currencyModalOpen) return;
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        onCalcPress(e.key);
      } else if (["+", "-", "*", "/"].includes(e.key)) {
        e.preventDefault();
        onCalcPress(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onCalcPress("BACK");
      } else if (e.key === "=") {
        e.preventDefault();
        onCalcPress("=");
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (/[+\-*/]/.test(expr)) onCalcPress("=");
        else mutation.mutate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function defaultDescription() {
    if (type === "transfer") return `Transfer to ${dest?.attributes.name ?? "account"}`;
    if (counterparty.trim()) return counterparty.trim();
    if (category.trim()) return category.trim();
    return type === "withdrawal" ? "Expense" : "Income";
  }

  if (accountsQ.isLoading) {
    return (
      <Card className="flex flex-col gap-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </Card>
    );
  }
  if (accountsQ.error) return <ErrorBox error={accountsQ.error} />;

  const matchingTemplates = (templatesQ.data ?? []).filter((t) => t.type === type);
  // Accent follows the app's semantic tokens (not hard-coded brand colours)
  const accentText = type === "deposit" ? "text-success" : type === "withdrawal" ? "text-danger" : "text-primary";
  const accentSoft = type === "deposit" ? "bg-success-soft" : type === "withdrawal" ? "bg-danger-soft" : "bg-primary-soft";

  return (
    <div
      className="relative mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:max-w-5xl"
      onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchStartX === null) return;
        const deltaX = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
        // Swipe left or right to toggle the in-depth details panel on mobile
        if (Math.abs(deltaX) > 65) {
          setDetailsOpen(deltaX < 0);
        }
        setTouchStartX(null);
      }}
    >
      {/* Top Bar + Mode Tabs + Saved Templates */}
      <div className="flex flex-col gap-3 border-b border-border p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleCancelOrBack}
            aria-label={detailsOpen ? "Back to calculator" : "Cancel"}
          >
            {detailsOpen ? <ChevronLeft className="size-5" /> : <X className="size-5" />}
          </Button>
          <span className="text-sm font-semibold">
            {detailsOpen ? "Transaction details" : "New transaction"}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            aria-label="Save transaction"
          >
            <Check className="size-4" /> Save
          </Button>
        </div>

        {/* Mode Tabs — same segmented control used across the app */}
        <AnimatedTabs
          tabs={TABS.map((t) => ({
            key: t.type,
            label: <span className="capitalize">{t.label.toLowerCase()}</span>,
            icon: t.icon,
          }))}
          activeTab={type}
          onChange={(newType) => router.replace(`/new?type=${newType}`, { scroll: false })}
          className="grid grid-cols-4"
          ariaLabel="Transaction types"
        />

        {/* Saved Templates Strip */}
        {matchingTemplates.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="shrink-0 text-xs text-muted">Templates:</span>
            {matchingTemplates.map((t) => {
              const IconComp = ICON_CATALOG[t.icon] ?? Sparkles;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-2"
                >
                  <IconComp className="size-3 text-primary" aria-hidden />
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ErrorBox error={error} />

      {/* ADAPTIVE WORKSPACE:
          - Mobile (< lg): flips between Keypad/Amount pane and Details pane via swipe or pull-tab
          - Desktop (>= lg): ergonomic keyboard-first 2-column form
            - Left Column (5 cols): Amount input with live math evaluation preview, denomination chips (+10, +50, +100), dual-currency preview with in-place rate editing
            - Right Column (7 cols): Description, Source/Destination Accounts, Category cascade select, Date/Budget, Tags, Notes, Attachments, Submit */}
      <div className="lg:grid lg:grid-cols-12 lg:divide-x lg:divide-border">
        {/* LEFT PANE:
            - On Mobile (< lg): Keypad view with Giant Amount card, inline account select, and 4x4 keypad
            - On Desktop (>= lg): Keyboard-first financial core */}
        <div className={cn("flex-col lg:col-span-5 lg:flex", detailsOpen ? "hidden" : "flex")}>
          {/* MOBILE ONLY (< lg) KEYPAD VIEW */}
          <div className="flex flex-col lg:hidden">
            <div className="flex flex-col gap-3 border-b border-border p-3 sm:p-4">
              {(billName || billId) && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                  <div className="flex items-center gap-1.5 truncate">
                    <Sparkles className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate">Paying Bill: <strong>{billName || "Linked Bill"}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setBillId(null); setBillName(null); }}
                    className="rounded p-0.5 hover:bg-primary/20"
                    title="Remove bill link"
                    aria-label="Remove bill link"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              {/* Giant Amount Display + Mobile Pull-Tab */}
              <div className={cn("relative flex min-h-28 flex-col items-center justify-center rounded-xl px-10 py-4", accentSoft)}>
                <div className="flex items-baseline gap-2">
                  <span className={cn("tabular text-4xl font-semibold tracking-tight sm:text-5xl", accentText)}>
                    {type === "withdrawal" ? "−" : type === "deposit" ? "+" : ""}
                    {expr || state.fromAmount || "0"}
                  </span>
                  <span className="text-base font-medium text-muted">{assetCur?.code || "BHD"}</span>
                </div>
                {/* Live Formula Preview on mobile too if typing expression */}
                {expr && /[+\-*/()]/.test(expr) && (
                  <span className="mt-1 text-xs font-semibold text-muted">
                    = {evaluateCalcExpression(expr)} {assetCur?.code}
                  </span>
                )}
                {category && <Badge className="mt-2">{category.replace(/\s*:\s*/g, " › ")}</Badge>}

                {/* Mobile pull-tab to flip to details */}
                <button
                  type="button"
                  onClick={() => setDetailsOpen((o) => !o)}
                  aria-label={detailsOpen ? "Back to calculator" : "Open in-depth details"}
                  title="Swipe or tap for in-depth details"
                  className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-fg"
                >
                  {detailsOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                </button>
              </div>

              {/* Inline From → To / Category bar */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted">{type === "deposit" ? "To account" : "From account"}</span>
                  <Select
                    value={assetId ?? ""}
                    onChange={(e) => {
                      setAssetId(e.target.value);
                      linked.controls.reset();
                    }}
                    aria-label="Select primary account"
                  >
                    {assetLike.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.attributes.name} ({a.attributes.currency_code})
                      </option>
                    ))}
                  </Select>
                </label>

                {type === "transfer" ? (
                  <button
                    type="button"
                    onClick={swapTransferAccounts}
                    title="Swap source and destination accounts"
                    aria-label="Swap source and destination accounts"
                    className="mb-1 flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:text-fg"
                  >
                    <ArrowLeftRight className="size-4" />
                  </button>
                ) : (
                  <span className="pb-2.5 text-muted">→</span>
                )}

                {type === "transfer" ? (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-muted">To account</span>
                    <Select
                      value={effectiveDestId ?? ""}
                      onChange={(e) => {
                        setDestId(e.target.value);
                        linked.controls.reset();
                      }}
                      aria-label="Select destination account"
                    >
                      {assetLike
                        .filter((a) => a.id !== assetId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.attributes.name} ({a.attributes.currency_code})
                          </option>
                        ))}
                    </Select>
                  </label>
                ) : (
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-muted">Category</span>
                    <div className="flex items-center gap-1.5">
                      {category && (
                        <ResourceIconBadge
                          entityType="category"
                          entityId={
                            categoriesQ.data?.find((c) => c.attributes.name.toLowerCase() === category.toLowerCase())?.id ??
                            category
                          }
                          defaultIcon={inferCategoryDefaultStyle(category).icon}
                          defaultColor={inferCategoryDefaultStyle(category).color}
                          size="sm"
                        />
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setDetailsOpen(true)}
                        className="min-w-0 flex-1 justify-start truncate"
                      >
                        {category ? category.replace(/\s*:\s*/g, " › ") : counterparty || "Choose…"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Target Amount Bar for Cross-Currency Transfers / Foreign Expenses (Mobile) */}
            {state.isCross && otherCur && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-xs">
                <span className="text-muted">Target amount ~</span>
                <button
                  type="button"
                  onClick={openSetupCurrencyModal}
                  className="font-semibold text-primary underline decoration-primary/50 underline-offset-2 hover:opacity-80"
                >
                  {otherCur.symbol || otherCur.code}
                  {state.toAmount || "0.00"} ({otherCur.code})
                </button>
                {state.rate && (
                  <span className="text-[11px] text-muted">
                    · 1 {assetCur?.code} = {formatRate(state.rate)} {otherCur.code}
                  </span>
                )}
                <Badge tone={rateMode === "save" && state.isManualRate ? "primary" : "neutral"}>
                  {state.isManualRate ? (rateMode === "save" ? "Saves new rate" : "One-time rate") : "Stored rate"}
                </Badge>
              </div>
            )}

            {/* Quick Description Bar above keypad (Mobile) */}
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 text-xs">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={defaultDescription() + " (tap to add note / description)…"}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="shrink-0 rounded-lg bg-primary-soft px-2.5 py-1 font-semibold text-primary"
              >
                Details & Category →
              </button>
            </div>

            {/* 4x4 Calculator Keypad (Mobile only) */}
            <div className="grid flex-1 grid-cols-4 select-none bg-surface">
              <div className="col-span-3 grid grid-cols-3 divide-x divide-y divide-border">
                {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => onCalcPress(digit)}
                    className="flex h-16 items-center justify-center text-2xl font-normal text-fg hover:bg-surface-2/60 active:bg-surface-2 sm:h-18"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onCalcPress(".")}
                  className="flex h-16 items-center justify-center text-2xl font-normal text-fg hover:bg-surface-2/60 active:bg-surface-2 sm:h-18"
                >
                  .
                </button>
                <button
                  type="button"
                  onClick={() => onCalcPress("0")}
                  className="flex h-16 items-center justify-center text-2xl font-normal text-fg hover:bg-surface-2/60 active:bg-surface-2 sm:h-18"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => onCalcPress("BACK")}
                  aria-label="Backspace"
                  className="flex h-16 items-center justify-center text-muted hover:bg-surface-2/60 active:bg-surface-2 sm:h-18"
                >
                  <Delete className="size-5" />
                </button>
              </div>

              {/* Right column operators */}
              <div className="grid grid-rows-5 divide-y divide-border border-l border-border bg-surface-2">
                {[
                  { key: "/", label: "÷" },
                  { key: "*", label: "×" },
                  { key: "-", label: "−" },
                  { key: "+", label: "+" },
                  { key: "=", label: "=" },
                ].map((op) => (
                  <button
                    key={op.key}
                    type="button"
                    onClick={() => onCalcPress(op.key)}
                    className="flex items-center justify-center text-xl font-medium text-muted hover:text-fg active:bg-border"
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-4 py-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setDetailsOpen(true)}>
                More details (Category, Budget, Tags)
              </Button>
              <Button type="button" onClick={() => mutation.mutate()} loading={mutation.isPending}>
                <Check className="size-4" aria-hidden /> Save {TABS.find((t) => t.type === type)?.label.toLowerCase()}
              </Button>
            </div>
          </div>

          {/* DESKTOP KEYBOARD-FIRST FINANCIAL COLUMN (>= lg) */}
          <div className="hidden lg:flex flex-col gap-5 p-5">
            {(billName || billId) && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                <div className="flex items-center gap-1.5 truncate">
                  <Sparkles className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate">Paying Bill / Subscription: <strong>{billName || "Linked Bill"}</strong></span>
                </div>
                <button
                  type="button"
                  onClick={() => { setBillId(null); setBillName(null); }}
                  className="rounded p-0.5 hover:bg-primary/20"
                  title="Remove bill link"
                  aria-label="Remove bill link"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {/* Amount Input with Live Math Evaluator */}
            <div className="flex flex-col gap-2">
              <label htmlFor="desktop-amount" className="flex items-center justify-between text-sm font-semibold">
                <span>Amount</span>
                <span className="text-xs font-normal text-muted">Keyboard math (e.g. 150 + 25 * 3)</span>
              </label>

              <div className="relative">
                <Input
                  id="desktop-amount"
                  name="amount"
                  type="text"
                  autoComplete="off"
                  value={expr}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExpr(val);
                    const evaluated = evaluateCalcExpression(val);
                    linked.controls.setFrom(evaluated === "0" && !val ? "" : evaluated);
                  }}
                  onBlur={() => {
                    if (expr && /[+\-*/()]/.test(expr)) {
                      const evaluated = evaluateCalcExpression(expr);
                      setExpr(evaluated);
                      linked.controls.setFrom(evaluated);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "=") {
                      e.preventDefault();
                      const evaluated = evaluateCalcExpression(expr);
                      setExpr(evaluated);
                      linked.controls.setFrom(evaluated);
                    }
                  }}
                  placeholder="0.00"
                  className={cn(
                    "tabular h-14 pr-20 text-3xl font-semibold tracking-tight transition",
                    accentText,
                  )}
                  autoFocus
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-muted">
                  {assetCur?.code || "—"}
                </span>
              </div>

              {/* Live Math Expression Evaluation Preview */}
              {expr && /[+\-*/()]/.test(expr) && (
                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary-soft/60 px-3.5 py-2 text-xs font-medium text-primary">
                  <div className="flex items-center gap-1.5">
                    <Calculator className="size-3.5" aria-hidden />
                    <span>Formula Preview (PEMDAS):</span>
                  </div>
                  <span className="tabular text-sm font-bold">
                    = {evaluateCalcExpression(expr)} {assetCur?.code}
                  </span>
                </div>
              )}

              {/* Quick Denomination Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs font-medium text-muted">Quick add:</span>
                {[10, 25, 50, 100, 500].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => {
                      const next = applyDenominationChip(expr || state.fromAmount || "0", delta);
                      setExpr(next);
                      linked.controls.setFrom(next);
                    }}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-fg hover:border-primary hover:bg-primary-soft transition active:scale-95"
                  >
                    +{delta}
                  </button>
                ))}
                {expr && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpr("");
                      linked.controls.setFrom("");
                    }}
                    className="ml-auto rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-danger hover:text-danger transition"
                    title="Clear amount"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Payment Currency Selector (when not transfer) */}
            {type !== "transfer" && (
              <Field label="Payment currency (optional foreign currency)">
                {(id) => (
                  <Select
                    id={id}
                    value={foreignCode}
                    onChange={(e) => {
                      setForeignCode(e.target.value === assetCur?.code ? "" : e.target.value);
                      linked.controls.reset();
                    }}
                  >
                    <option value="">{assetCur ? `${assetCur.code} (Account currency)` : "Account currency"}</option>
                    {currenciesQ.data
                      ?.filter((c) => c.attributes.enabled !== false && c.attributes.code !== assetCur?.code)
                      .map((c) => (
                        <option key={c.id} value={c.attributes.code}>
                          {c.attributes.code} · {c.attributes.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}

            {/* Live Dual-Currency Preview with In-Place Exchange Rate Editing */}
            {state.isCross && otherCur && (
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">
                    Target amount ({otherCur.code})
                  </span>
                  <Badge tone={rateMode === "save" && state.isManualRate ? "primary" : "neutral"}>
                    {state.isManualRate ? (rateMode === "save" ? "Saves new rate" : "One-time rate") : "Stored rate"}
                  </Badge>
                </div>

                <div className="relative">
                  <Input
                    id="desktop-target-amount"
                    name="targetAmount"
                    inputMode="decimal"
                    value={linked.controls.toValue}
                    onChange={(e) => linked.controls.setTo(e.target.value)}
                    placeholder={zeroPlaceholder(otherCur.decimals)}
                    className="tabular h-12 pr-16 text-lg font-semibold"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md bg-surface px-2 py-0.5 text-xs font-bold text-muted">
                    {otherCur.code}
                  </span>
                </div>

                {/* Inline Exchange Rate Editor */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted">1 {assetCur?.code} =</span>
                    <Input
                      aria-label={`Exchange rate ${assetCur?.code} to ${otherCur.code}`}
                      inputMode="decimal"
                      value={linked.controls.rateOverride ?? (state.rate ? formatRate(state.rate) : "")}
                      onChange={(e) => linked.controls.setRateOverride(e.target.value || null)}
                      className="h-7 w-24 text-center font-bold text-xs"
                    />
                    <span className="font-semibold">{otherCur.code}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (state.rate && state.rate.gt(0)) {
                          const inv = new Decimal(1).div(state.rate).toSignificantDigits(8).toString();
                          linked.controls.setRateOverride(inv);
                        }
                      }}
                      className="h-7 px-2 text-xs"
                      title="Invert rate (1 ÷ r)"
                    >
                      <ArrowLeftRight className="size-3" /> Invert (1÷r)
                    </Button>
                    {linked.controls.rateOverride && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => linked.controls.setRateOverride(null)}
                        className="h-7 px-2 text-xs text-muted"
                        title="Use stored rate"
                      >
                        <RotateCcw className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Inline Rate Mode Selector */}
                <div className="flex flex-col gap-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-muted">How should this exchange rate apply?</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRateMode("save")}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                        rateMode === "save"
                          ? "border-primary bg-primary-soft text-primary font-semibold"
                          : "border-border text-muted hover:bg-surface",
                      )}
                    >
                      Save new rate
                    </button>
                    <button
                      type="button"
                      onClick={() => setRateMode("once")}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                        rateMode === "once"
                          ? "border-primary bg-primary-soft text-primary font-semibold"
                          : "border-border text-muted hover:bg-surface",
                      )}
                    >
                      One-time change
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Transfer Pairs Quick Selector (when transfer) */}
            {type === "transfer" && pairs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                <span className="text-xs text-muted">Recent pairs:</span>
                {pairs
                  .map((p) => ({ p, s: assetLike.find((a) => a.id === p.s), d: assetLike.find((a) => a.id === p.d) }))
                  .filter((x) => x.s && x.d)
                  .map(({ p, s, d }) => (
                    <button
                      key={`${p.s}-${p.d}`}
                      type="button"
                      onClick={() => {
                        setAssetId(p.s);
                        setDestId(p.d);
                        linked.controls.reset();
                      }}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium hover:border-primary hover:bg-surface-2 transition"
                    >
                      {s!.attributes.name} → {d!.attributes.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE: IN-DEPTH DETAILS VIEW
            - On Desktop (>= lg): Always visible, keyboard-first fields (Description, Source/Dest Account, Category, Budget, Tags, Date, Notes, Submission buttons)
            - On Mobile (< lg): Shown when detailsOpen is true */}
        <div className={cn("flex-col gap-4 p-4 sm:p-5 lg:col-span-7 lg:flex", detailsOpen ? "flex fade-in" : "hidden")}>
          <div className="flex items-center justify-between lg:hidden">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDetailsOpen(false)}>
              ← Back to Calculator
            </Button>
            {state.isCross && (
              <Button type="button" variant="secondary" size="sm" onClick={openSetupCurrencyModal}>
                Setup Currency & Rate
              </Button>
            )}
          </div>

          {/* Description field at top of right pane for clean keyboard tab navigation from Amount */}
          <Field label="Description">
            {(id) => (
              <Input
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={defaultDescription()}
              />
            )}
          </Field>

          {/* Account Pickers */}
          <div className="grid gap-3 sm:grid-cols-2">
            <AccountPicker
              label={type === "deposit" ? "Received into" : "From account"}
              accounts={assetLike}
              value={assetId}
              onChange={(id) => {
                setAssetId(id);
                linked.controls.reset();
              }}
            />
            {type === "transfer" ? (
              <AccountPicker
                label="To account"
                accounts={assetLike}
                value={effectiveDestId}
                excludeId={assetId}
                onChange={(id) => {
                  setDestId(id);
                  linked.controls.reset();
                }}
              />
            ) : (
              <Field label={type === "withdrawal" ? "Payee / Merchant" : "Payer"}>
                {(id) => (
                  <>
                    <Input
                      id={id}
                      list={`${id}-list`}
                      value={counterparty}
                      onChange={(e) => setCounterparty(e.target.value)}
                      placeholder={type === "withdrawal" ? "e.g. Supermarket" : "e.g. Employer"}
                    />
                    <datalist id={`${id}-list`}>
                      {(type === "withdrawal" ? expenseNames : revenueNames).map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            )}
          </div>

          {/* Mobile-only LinkedAmountFields (Desktop uses Left Column financial core) */}
          <div className="lg:hidden">
            {type !== "transfer" && (
              <Field label="Payment currency (optional foreign currency)">
                {(id) => (
                  <Select
                    id={id}
                    value={foreignCode}
                    onChange={(e) => {
                      setForeignCode(e.target.value === assetCur?.code ? "" : e.target.value);
                      linked.controls.reset();
                    }}
                  >
                    <option value="">{assetCur ? `${assetCur.code} (account currency)` : "Account currency"}</option>
                    {currenciesQ.data
                      ?.filter((c) => c.attributes.enabled !== false && c.attributes.code !== assetCur?.code)
                      .map((c) => (
                        <option key={c.id} value={c.attributes.code}>
                          {c.attributes.code} · {c.attributes.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}

            <LinkedAmountFields
              from={assetCur}
              to={otherCur}
              fromLabel={`Amount (${assetCur?.code || ""})`}
              toLabel={`Target amount (${otherCur?.code || ""})`}
              linked={linked}
            />
          </div>

          <div className="sm:col-span-2">
            <CategoryCascadeSelect categories={categoriesQ.data} value={category} onChange={setCategory} />
          </div>

          <div className={cn("grid gap-3", type === "withdrawal" ? "sm:grid-cols-2" : "grid-cols-1")}>
            <Field label="Date">
              {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}
            </Field>

            {type === "withdrawal" && (
              <Field label="Budget">
                {(id) => (
                  <Select id={id} value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                    <option value="">No budget</option>
                    {budgetsQ.data
                      ?.filter((b) => b.attributes.active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.attributes.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}
          </div>

          <Field label="Tags (comma-separated)">
            {(id) => (
              <>
                <Input id={id} list={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. food, tech, transport" />
                <datalist id={`${id}-tags`}>
                  {tagsQ.data?.map((t) => <option key={t.id} value={t.attributes.tag} />)}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Notes">
            {(id) => (
              <textarea
                id={id}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes or memos…"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            )}
          </Field>

          <Field label="Attachments (Receipt Image or PDF)">
            {(id) => (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={id}
                  className="inline-flex cursor-pointer items-center gap-2 self-start rounded-xl border border-dashed border-border bg-surface-2/60 px-3.5 py-2 text-xs font-medium text-fg transition hover:border-primary hover:bg-primary-soft/30"
                >
                  <Paperclip className="size-3.5 text-primary" aria-hidden />
                  <span>Add receipt or attachment…</span>
                </label>
                <input
                  id={id}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    const next: Array<{ name: string; type: string; dataUrl: string }> = [];
                    for (const file of files) {
                      if (file.size > 8 * 1024 * 1024) {
                        toast(`File ${file.name} exceeds 8 MB limit.`, "error");
                        continue;
                      }
                      const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = () => reject(new Error("Failed to read file"));
                        reader.readAsDataURL(file);
                      });
                      next.push({ name: file.name, type: file.type || "application/octet-stream", dataUrl });
                    }
                    setAttachments((prev) => [...prev, ...next]);
                    e.target.value = "";
                  }}
                />
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs"
                      >
                        <FileText className="size-3.5 text-primary" aria-hidden />
                        <span className="max-w-44 truncate">{att.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachments((list) => list.filter((_, i) => i !== idx))}
                          aria-label={`Remove ${att.name}`}
                          className="text-muted hover:text-danger"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          {/* Save as reusable Template & Submission buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
            {!showSaveTemplate ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowSaveTemplate(true)}>
                <BookmarkPlus className="size-4" aria-hidden /> Save as 1-tap Template
              </Button>
            ) : (
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name (e.g. كواي, حلاق, Morning Coffee)"
                  className="h-9 flex-1 text-xs"
                />
                <Button type="button" size="sm" loading={saveTemplateMut.isPending} onClick={() => saveTemplateMut.mutate()}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowSaveTemplate(false)}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="button" onClick={() => mutation.mutate()} loading={mutation.isPending}>
                <Check className="size-4" aria-hidden /> Save {TABS.find((t) => t.type === type)?.label.toLowerCase()}
              </Button>
            </div>
          </div>

          {matchingTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs">
              <span className="text-muted">Manage templates:</span>
              {matchingTemplates.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5">
                  {t.name}
                  <button
                    type="button"
                    onClick={() => delTemplateMut.mutate(t.id)}
                    className="text-muted hover:text-danger"
                    aria-label={`Delete template ${t.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          "SETUP CURRENCY" MODAL SHEET WITH TWO RATE MODE TOGGLES
         ==================================================================== */}
      {assetCur && otherCur && (
        <ModalSheet
          open={currencyModalOpen}
          onClose={() => setCurrencyModalOpen(false)}
          title="Setup Currency & Exchange Rate"
          subtitle={`Convert ${assetCur.code} (${assetCur.decimals} decimals) → ${otherCur.code} (${otherCur.decimals} decimals)`}
          maxWidth="max-w-md"
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Source Amount (${assetCur.code})`}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={modalSourceAmt}
                    onChange={(e) => {
                      setModalSourceAmt(e.target.value);
                      const s = parseAmount(e.target.value);
                      const r = parseAmount(modalRateStr);
                      if (s && r && new Decimal(r).gt(0)) {
                        setModalTargetAmt(new Decimal(s).mul(r).toFixed(otherCur.decimals));
                      }
                    }}
                  />
                )}
              </Field>
              <Field label="Currency">
                {(id) => <Input id={id} value={assetCur.code} disabled className="opacity-70" />}
              </Field>

              <Field label={`Target Amount (${otherCur.code})`}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={modalTargetAmt}
                    onChange={(e) => onModalTargetChange(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Currency">
                {(id) => <Input id={id} value={otherCur.code} disabled className="opacity-70" />}
              </Field>
            </div>

            {/* Editable Exchange Rate Line + 1-click Invert Helper */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted">1 {assetCur.code} =</span>
                <Input
                  inputMode="decimal"
                  value={modalRateStr}
                  onChange={(e) => onModalRateChange(e.target.value)}
                  className="h-8 w-28 text-center font-bold"
                  aria-label="Exchange rate"
                />
                <span className="font-semibold">{otherCur.code}</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const r = parseAmount(modalRateStr);
                  if (r && new Decimal(r).gt(0)) {
                    const inv = new Decimal(1).div(r).toSignificantDigits(8).toString();
                    onModalRateChange(inv);
                  }
                }}
                title="Invert rate (1 ÷ rate)"
              >
                <ArrowLeftRight className="size-3.5" /> Invert (1÷r)
              </Button>
            </div>

            {/* Two Toggles requested by User:
                1. Save the new exchange rate
                2. Just one-time change */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted">How should this exchange rate change apply?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRateMode("save")}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
                    rateMode === "save"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted hover:bg-surface-2",
                  )}
                >
                  Save new exchange
                </button>
                <button
                  type="button"
                  onClick={() => setRateMode("once")}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
                    rateMode === "once"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted hover:bg-surface-2",
                  )}
                >
                  Just one-time change
                </button>
              </div>
            </div>

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCurrencyModalOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmSetupCurrencyModal}>
                Confirm
              </Button>
            </div>
          </div>
        </ModalSheet>
      )}
    </div>
  );
}

// ============================================================================
// PICO "RAMBLE" MAGIC ASSISTANT (Natural-Language & Voice Multi-Transaction)
// ============================================================================

function RambleAssistant() {
  return <MagicChatPanel mode="inline" />;
}
