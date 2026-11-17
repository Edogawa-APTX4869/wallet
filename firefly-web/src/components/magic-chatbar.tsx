"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { NewSplit } from "@/lib/firefly/types";
import type {
  AiActionKind,
  AiProviderType,
  AttachmentPayload,
  ParsedTransactionDraft,
} from "@/app/api/companion/ramble/route";
import { ASSET_LIKE, useAccounts, usePrimaryCurrency } from "@/lib/hooks";
import { useOptionalUniversalFilter } from "@/lib/filter-context";
import {
  getMostFrequentCategories,
  loadRecentAccountIds,
  pushRecentAccountId,
  recordCategoryUsage,
  resolveDefaultAccountForList,
} from "@/lib/recent-selections";
import { cn, isoDate, isoDateTimeWithOffset, isoTime, monthRange, sumDecimal } from "@/lib/utils";
import {
  FullScreenAccountSelectView,
  FullScreenCategorySelectView,
} from "@/components/wallet-selection-views";
import { Badge, Button, Input, ModalSheet, Select } from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

export interface ChatDraftItem extends ParsedTransactionDraft {
  id: string;
  saved?: boolean;
  attachments?: AttachmentPayload[];
}

export interface MagicChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  attachments?: AttachmentPayload[];
  engine?: string;
  drafts?: ChatDraftItem[];
  createdAt: string;
}

export interface AiStatusData {
  enabled: boolean;
  provider: AiProviderType;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
  verified: boolean;
  verifiedAt: string | null;
}

export function useAiAssistantConfig() {
  return useQuery({
    queryKey: ["llm-config"],
    queryFn: async (): Promise<AiStatusData> => {
      const res = await fetch("/api/companion/ramble");
      if (!res.ok) {
        return {
          enabled: false,
          provider: "disabled",
          endpoint: "",
          model: "gemini-2.5-flash",
          hasApiKey: false,
          verified: false,
          verifiedAt: null,
        };
      }
      const json = (await res.json()) as { data: AiStatusData };
      return json.data;
    },
    staleTime: 30_000,
  });
}

const QUICK_PROMPTS = [
  "Coffee 2.400 BHD Starbucks #food",
  "Transfer 25 BHD from Dining Out to Groceries budget",
  "Add 50 BHD to Emergency Fund piggy",
  "What are my balances?",
];

const ACTION_BADGE: Record<AiActionKind, string> = {
  transaction: "Transaction",
  budget_transfer: "Budget Transfer",
  budget_adjust: "Budget Limit",
  piggy_bank: "Piggy Bank",
  bill: "New Bill",
  recurrence: "Recurring",
  category: "New Category",
  account: "New Account",
};

export function MagicChatPanel({
  mode = "dock",
  alwaysShow = false,
  onClose,
}: {
  mode?: "dock" | "inline";
  alwaysShow?: boolean;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const filterCtx = useOptionalUniversalFilter();
  const accountsQ = useAccounts("all");
  const primaryQ = usePrimaryCurrency();
  const aiConfigQ = useAiAssistantConfig();
  const month = monthRange(0);

  const categoriesQ = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => api.categories(),
    staleTime: 5 * 60_000,
  });
  const budgetsQ = useQuery({
    queryKey: ["budgets-list"],
    queryFn: () => api.budgets(month.start, month.end),
    staleTime: 5 * 60_000,
  });
  const budgetLimitsQ = useQuery({
    queryKey: ["budget-limits", month.start, month.end],
    queryFn: () => api.budgetLimits(month.start, month.end),
    staleTime: 60_000,
  });
  const piggyBanksQ = useQuery({
    queryKey: ["piggy-banks"],
    queryFn: api.piggyBanks,
    staleTime: 60_000,
  });
  const billsQ = useQuery({
    queryKey: ["bills", month.start, month.end],
    queryFn: () => api.bills(month.start, month.end),
    staleTime: 60_000,
  });
  const tagsQ = useQuery({
    queryKey: ["tags-list"],
    queryFn: api.tags,
    staleTime: 5 * 60_000,
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(mode === "inline");
  useEscapeDismiss(
    mode === "dock" && expanded,
    () => setExpanded(false),
    "magic-chat-dock",
    { hidesChrome: true },
  );
  const [pickerTarget, setPickerTarget] = useState<null | {
    msgId: string;
    draftId: string;
    kind: "account" | "dest-account" | "category";
    currentVal: string;
  }>(null);
  useEscapeDismiss(
    pickerTarget !== null,
    () => setPickerTarget(null),
    "magic-chat-picker",
    { hidesChrome: true },
  );
  const [messages, setMessages] = useState<MagicChatMessage[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const assetAccounts = (accountsQ.data ?? []).filter(
    (a) => ASSET_LIKE.has(a.attributes.type) && a.attributes.active !== false,
  );
  const defaultAssetId = resolveDefaultAccountForList(assetAccounts, {
    filterSelectedIds: filterCtx?.selectedAccountIds,
  });
  const defaultAsset = assetAccounts.find((a) => a.id === defaultAssetId) ?? assetAccounts[0];
  const defaultCurrency =
    primaryQ.data?.code || defaultAsset?.attributes.currency_code || "BHD";

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, expanded]);

  useEffect(() => {
    if (mode !== "dock") return;
    function handleOpenEvent(e: Event) {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      setExpanded(true);
      if (detail?.prompt) setInput(detail.prompt);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
    window.addEventListener("ff:open-magic-chat", handleOpenEvent);
    return () => window.removeEventListener("ff:open-magic-chat", handleOpenEvent);
  }, [mode]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const loaded: AttachmentPayload[] = [];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        toast(`${file.name} exceeds 8 MB`, "error");
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      loaded.push({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
      });
    }

    setAttachments((prev) => [...prev, ...loaded]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const parseMut = useMutation({
    mutationFn: async (payload: { promptText: string; files: AttachmentPayload[] }) => {
      const budgetsList = budgetsQ.data ?? [];
      const limitsList = budgetLimitsQ.data ?? [];
      const budgetDetails = budgetsList.map((b) => {
        const matching = limitsList.filter((l) => l.attributes.budget_id === b.id);
        const limitVal =
          matching.length > 0
            ? sumDecimal(matching.map((l) => new Decimal(l.attributes.amount || 0)))
            : new Decimal(b.attributes.auto_budget_amount ?? 0);
        const spentVal = sumDecimal((b.attributes.spent ?? []).map((s) => new Decimal(s.sum).abs()));
        return {
          name: b.attributes.name,
          limit: limitVal.toString(),
          spent: spentVal.toString(),
          left: limitVal.minus(spentVal).toString(),
          currency: matching[0]?.attributes.currency_code || b.attributes.auto_budget_currency_code || defaultCurrency,
        };
      });

      const res = await fetch("/api/companion/ramble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: payload.promptText,
          attachments: payload.files,
          today: isoDate(),
          defaultCurrency,
          defaultAccount: defaultAsset?.attributes.name ?? "",
          accounts: assetAccounts.map((a) => a.attributes.name),
          categories: (categoriesQ.data ?? []).map((c) => c.attributes.name),
          budgets: budgetsList.map((b) => b.attributes.name),
          tags: (tagsQ.data ?? []).map((t) => t.attributes.tag),
          accountDetails: assetAccounts.map((a) => ({
            name: a.attributes.name,
            currency: a.attributes.currency_code || defaultCurrency,
            balance: String(a.attributes.current_balance ?? "0"),
            type: a.attributes.type,
          })),
          budgetDetails,
          piggyDetails: (piggyBanksQ.data ?? []).map((p) => ({
            name: p.attributes.name,
            current: String(p.attributes.current_amount ?? "0"),
            target: String(p.attributes.target_amount ?? "0"),
            account: p.attributes.account_name ?? undefined,
            currency: p.attributes.currency_code ?? defaultCurrency,
          })),
          billDetails: (billsQ.data ?? []).map((b) => ({
            name: b.attributes.name,
            amount: String(b.attributes.amount_min || b.attributes.amount_max || "0"),
            freq: b.attributes.repeat_freq,
            currency: b.attributes.currency_code || defaultCurrency,
          })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to parse request");
      }
      return (await res.json()) as {
        data: ParsedTransactionDraft[];
        reply?: string;
        engine: string;
      };
    },
    onSuccess: (res, payload) => {
      const userMsg: MagicChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: payload.promptText || (payload.files.length > 0 ? `${payload.files.length} file(s)` : ""),
        attachments: payload.files,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      const draftsWithIds: ChatDraftItem[] = (res.data ?? []).map((d, idx) => ({
        ...d,
        action_type: d.action_type ?? "transaction",
        id: `d-${Date.now()}-${idx}`,
        saved: false,
        attachments: payload.files,
      }));
      const assistantMsg: MagicChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: "assistant",
        engine: res.engine,
        drafts: draftsWithIds,
        text:
          res.reply ||
          (draftsWithIds.length === 0
            ? "Could not match an action. Try e.g. 'Spent 3.500 BHD lunch' or 'What are my balances?'."
            : undefined),
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setExpanded(true);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  async function saveDraftToFirefly(d: ChatDraftItem) {
    const kind: AiActionKind = d.action_type ?? "transaction";

    if (kind === "budget_transfer") {
      const budgetsList = budgetsQ.data ?? [];
      const limitsList = budgetLimitsQ.data ?? [];
      const srcBudget = budgetsList.find(
        (b) => b.attributes.name.toLowerCase() === (d.source_name || "").toLowerCase(),
      );
      const dstBudget = budgetsList.find(
        (b) => b.attributes.name.toLowerCase() === (d.destination_name || d.budget_name || "").toLowerCase(),
      );
      if (!srcBudget || !dstBudget || srcBudget.id === dstBudget.id) {
        throw new Error("Choose valid source and destination budgets.");
      }
      const xfer = new Decimal(d.amount || 0);
      if (xfer.lte(0)) throw new Error("Enter a transfer amount greater than 0.");
      const srcLim = limitsList.find((l) => l.attributes.budget_id === srcBudget.id);
      const dstLim = limitsList.find((l) => l.attributes.budget_id === dstBudget.id);
      const curSrc = new Decimal(srcLim?.attributes.amount ?? 0);
      const curDst = new Decimal(dstLim?.attributes.amount ?? 0);
      const nextSrc = curSrc.minus(xfer);
      if (nextSrc.lt(0)) throw new Error("Transfer exceeds source budget limit.");
      const nextDst = curDst.plus(xfer);
      const curCode = d.currency_code || defaultCurrency;
      const note = `AI budget transfer: ${curCode} ${xfer.toString()} ${srcBudget.attributes.name} → ${dstBudget.attributes.name}`;

      if (nextSrc.eq(0) && srcLim) {
        await api.deleteBudgetLimit(srcBudget.id, srcLim.id);
      } else {
        await api.upsertBudgetLimit({
          budgetId: srcBudget.id,
          limitId: srcLim?.id,
          amount: nextSrc.toString(),
          start: (srcLim?.attributes.start || month.start).slice(0, 10),
          end: (srcLim?.attributes.end || month.end).slice(0, 10),
          currency_code: curCode,
          notes: note,
        });
      }
      await api.upsertBudgetLimit({
        budgetId: dstBudget.id,
        limitId: dstLim?.id,
        amount: nextDst.toString(),
        start: (dstLim?.attributes.start || month.start).slice(0, 10),
        end: (dstLim?.attributes.end || month.end).slice(0, 10),
        currency_code: curCode,
        notes: note,
      });
      return;
    }

    if (kind === "budget_adjust") {
      const targetName = (d.budget_name || d.description || "").trim();
      if (!targetName) throw new Error("Enter a budget name.");
      const val = new Decimal(d.amount || 0);
      if (val.lte(0)) throw new Error("Enter a valid budget amount.");
      const budgetsList = budgetsQ.data ?? [];
      const limitsList = budgetLimitsQ.data ?? [];
      let existing = budgetsList.find((b) => b.attributes.name.toLowerCase() === targetName.toLowerCase());
      if (!existing) {
        const created = await api.createBudget(targetName);
        existing = created.data;
      }
      const lim = limitsList.find((l) => l.attributes.budget_id === existing!.id);
      const cur = new Decimal(lim?.attributes.amount ?? 0);
      const modeAdj = d.adjust_mode ?? "set";
      const nextLim =
        modeAdj === "add" ? cur.plus(val) : modeAdj === "subtract" ? cur.minus(val) : val;
      if (nextLim.lt(0)) throw new Error("Budget limit cannot be negative.");
      if (nextLim.eq(0) && lim) {
        await api.deleteBudgetLimit(existing.id, lim.id);
      } else {
        await api.upsertBudgetLimit({
          budgetId: existing.id,
          limitId: lim?.id,
          amount: nextLim.toString(),
          start: (lim?.attributes.start || month.start).slice(0, 10),
          end: (lim?.attributes.end || month.end).slice(0, 10),
          currency_code: d.currency_code || defaultCurrency,
        });
      }
      return;
    }

    if (kind === "piggy_bank") {
      const targetName = (d.destination_name || d.description || "").trim();
      if (!targetName) throw new Error("Enter a piggy bank name.");
      const val = new Decimal(d.amount || 0);
      if (val.lte(0)) throw new Error("Enter a valid amount.");
      const existing = (piggyBanksQ.data ?? []).find(
        (p) => p.attributes.name.toLowerCase() === targetName.toLowerCase(),
      );
      if (existing && d.adjust_mode !== "create") {
        const sign = d.adjust_mode === "subtract" ? -1 : 1;
        const nextCur = Decimal.max(
          0,
          new Decimal(existing.attributes.current_amount || 0).plus(val.mul(sign)),
        );
        await api.updatePiggyBank(existing.id, {
          name: existing.attributes.name,
          account_id: existing.attributes.account_id,
          target_amount: existing.attributes.target_amount || "0",
          current_amount: nextCur.toFixed(existing.attributes.currency_decimal_places ?? 2),
          target_date: existing.attributes.target_date,
          notes: existing.attributes.notes,
        });
      } else {
        const acc =
          assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.source_name || "").toLowerCase()) ||
          defaultAsset;
        if (!acc) throw new Error("Choose an asset account for this piggy bank.");
        await api.createPiggyBank({
          name: targetName,
          account_id: acc.id,
          target_amount: val.toString(),
          current_amount: "0",
          target_date: d.target_date || undefined,
        });
      }
      return;
    }

    if (kind === "bill") {
      const billName = (d.bill_name || d.description || "").trim();
      if (!billName || new Decimal(d.amount || 0).lte(0)) throw new Error("Enter bill name and amount.");
      const billFreq: "weekly" | "monthly" | "quarterly" | "half-year" | "yearly" =
        d.repeat_freq && d.repeat_freq !== "daily" ? d.repeat_freq : "monthly";
      await api.createBill({
        name: billName,
        amount_min: d.amount,
        amount_max: d.amount,
        currency_code: d.currency_code || defaultCurrency,
        date: d.date || isoDate(),
        repeat_freq: billFreq,
        skip: 0,
        active: true,
        notes: d.notes || undefined,
      });
      return;
    }

    if (kind === "recurrence") {
      const matchedAcc =
        assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.source_name || "").toLowerCase()) ||
        defaultAsset;
      if (!matchedAcc) throw new Error("Choose an account.");
      const repType = d.repeat_freq === "daily" || d.repeat_freq === "weekly" || d.repeat_freq === "yearly"
        ? d.repeat_freq
        : "monthly";
      const tx: Record<string, unknown> = {
        description: d.description.trim() || "Recurring Payment",
        amount: d.amount,
        currency_code: d.currency_code || matchedAcc.attributes.currency_code || defaultCurrency,
        category_name: d.category_name || undefined,
      };
      if (d.type === "deposit") {
        tx.destination_id = matchedAcc.id;
        tx.source_name = d.description || "Income";
      } else if (d.type === "transfer") {
        tx.source_id = matchedAcc.id;
        tx.destination_id =
          assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.destination_name || "").toLowerCase())?.id ||
          assetAccounts.find((a) => a.id !== matchedAcc.id)?.id;
      } else {
        tx.source_id = matchedAcc.id;
        tx.destination_name = d.destination_name || d.description;
      }
      await api.createRecurrence({
        type: d.type,
        title: d.description.trim() || "Recurring Payment",
        description: d.description.trim() || "Recurring Payment",
        first_date: d.date || isoDate(),
        apply_rules: true,
        active: true,
        repetitions: [{ type: repType, moment: repType === "daily" ? "" : "1", skip: 0, weekend: 1 }],
        transactions: [tx],
      });
      return;
    }

    if (kind === "category") {
      const name = (d.category_name || d.description || "").trim();
      if (!name) throw new Error("Enter a category name.");
      await api.createCategory(name);
      return;
    }

    if (kind === "account") {
      const name = (d.source_name || d.description || "").trim();
      if (!name) throw new Error("Enter an account name.");
      const accType = d.account_type || "asset";
      const bal = Number(d.amount || 0);
      await api.createAccount({
        name,
        type: accType,
        currency_code: d.currency_code || defaultCurrency,
        ...(accType === "asset" ? { account_role: "defaultAsset" } : {}),
        ...(accType === "liability" ? { liability_type: "loan", liability_direction: "debit" } : {}),
        ...(bal > 0 ? { opening_balance: String(d.amount), opening_balance_date: d.date || isoDate() } : {}),
      });
      return;
    }

    // Default: standard Transaction
    const matchedAcc =
      assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.source_name || "").toLowerCase()) ||
      assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.destination_name || "").toLowerCase()) ||
      defaultAsset;

    const matchedBudget = d.budget_name
      ? (budgetsQ.data ?? []).find((b) => b.attributes.name.toLowerCase() === d.budget_name.toLowerCase())
      : undefined;
    const matchedBill = d.bill_name
      ? (billsQ.data ?? []).find((b) => b.attributes.name.toLowerCase() === d.bill_name!.toLowerCase())
      : undefined;

    const split: NewSplit = {
      type: d.type,
      date: d.date ? (d.date.includes("T") ? d.date : isoDateTimeWithOffset(d.date, isoTime())) : isoDateTimeWithOffset(isoDate(), isoTime()),
      amount: d.amount,
      currency_code: d.currency_code || defaultCurrency,
      description: d.description,
      category_name: d.type === "transfer" ? undefined : d.category_name || undefined,
      budget_id: d.type === "withdrawal" && matchedBudget ? matchedBudget.id : undefined,
      bill_id: d.type === "withdrawal" && matchedBill ? matchedBill.id : undefined,
      bill_name: d.type === "withdrawal" && !matchedBill && d.bill_name ? d.bill_name : undefined,
      foreign_amount: d.foreign_amount || undefined,
      foreign_currency_code: d.foreign_currency_code || undefined,
      tags: d.tags,
      notes: d.notes || undefined,
    };

    if (d.type === "withdrawal") {
      split.source_id = matchedAcc?.id;
      split.destination_name = d.destination_name || d.description;
    } else if (d.type === "deposit") {
      split.destination_id = matchedAcc?.id;
      split.source_name = d.source_name || d.description;
    } else {
      split.source_id = matchedAcc?.id;
      const destAcc =
        assetAccounts.find((a) => a.attributes.name.toLowerCase() === (d.destination_name || "").toLowerCase()) ||
        assetAccounts.find((a) => a.id !== matchedAcc?.id);
      split.destination_id = destAcc?.id;
    }

    const createdGroup = await api.createTransaction([split]);
    if (matchedAcc?.id) pushRecentAccountId(matchedAcc.id);
    if (d.type !== "transfer" && d.category_name) recordCategoryUsage(d.category_name);
    const journalId =
      createdGroup.data.attributes.transactions?.[0]?.transaction_journal_id ||
      createdGroup.data.id;

    if (d.attachments && d.attachments.length > 0 && journalId) {
      for (const file of d.attachments) {
        await api.uploadTransactionAttachment(String(journalId), {
          name: file.name,
          type: file.mimeType,
          dataUrl: file.dataUrl,
        });
      }
    }
  }

  const saveDraftsMut = useMutation({
    mutationFn: async ({ msgId, draftIds }: { msgId: string; draftIds: string[] }) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg?.drafts) return 0;
      const targets = msg.drafts.filter((d) => draftIds.includes(d.id) && !d.saved);
      for (const d of targets) {
        await saveDraftToFirefly(d);
      }
      return targets.length;
    },
    onSuccess: (count, { msgId, draftIds }) => {
      if (count > 0) {
        toast(`Saved ${count} item${count === 1 ? "" : "s"}`);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== msgId
            ? m
            : {
                ...m,
                drafts: m.drafts?.map((d) => (draftIds.includes(d.id) ? { ...d, saved: true } : d)),
              },
        ),
      );
      for (const key of [
        "transactions",
        "accounts",
        "dashboard",
        "budgets",
        "budget-limits",
        "piggy-banks",
        "bills",
        "recurrences",
        "categories",
        "categories-list",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  function updateDraftField(msgId: string, draftId: string, patch: Partial<ChatDraftItem>) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== msgId
          ? m
          : {
              ...m,
              drafts: m.drafts?.map((d) => (d.id === draftId ? { ...d, ...patch } : d)),
            },
      ),
    );
  }

  function removeDraft(msgId: string, draftId: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== msgId
          ? m
          : {
              ...m,
              drafts: m.drafts?.filter((d) => d.id !== draftId),
            },
      ),
    );
  }

  function handleSend(e?: React.FormEvent, overrideText?: string) {
    e?.preventDefault();
    const textToSend = (overrideText ?? input).trim();
    const filesToSend = overrideText ? [] : attachments;
    if ((!textToSend && filesToSend.length === 0) || parseMut.isPending) return;
    if (!overrideText) {
      setInput("");
      setAttachments([]);
    }
    parseMut.mutate({ promptText: textToSend, files: filesToSend });
  }

  function toggleVoiceDictation() {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast("Voice dictation is not supported in this browser.", "error");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SpeechRecognition as any)();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    setListening(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += chunk;
        else interimTranscript += chunk;
      }
      if (finalTranscript) {
        setInput((prev) => (prev ? `${prev} ${finalTranscript}`.trim() : finalTranscript.trim()));
      } else if (interimTranscript) {
        setInput(interimTranscript);
      }
    };

    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  const totalUnsavedDrafts = messages.reduce(
    (acc, m) => acc + (m.drafts?.filter((d) => !d.saved).length ?? 0),
    0,
  );

  const isVerifiedAndEnabled = Boolean(aiConfigQ.data?.enabled && aiConfigQ.data?.verified);
  if (!alwaysShow && !aiConfigQ.isLoading && !isVerifiedAndEnabled) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all",
        mode === "dock" ? "shadow-xl backdrop-blur-md" : "shadow-xs",
      )}
    >
      {(expanded || mode === "inline") && (
        <div className="flex flex-col border-b border-border">
          {mode === "dock" && (
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-fg">
                  <Sparkles className="size-3" aria-hidden />
                </span>
                <span className="text-xs font-bold">AI Assistant</span>
                <Badge tone="success" className="text-[10px]">
                  {aiConfigQ.data?.provider === "gemini"
                    ? "Gemini"
                    : aiConfigQ.data?.provider === "openai-compatible"
                      ? "LLM"
                      : "Local"}
                </Badge>
                {totalUnsavedDrafts > 0 && (
                  <Badge tone="warning" className="text-[10px]">
                    {totalUnsavedDrafts} pending
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-surface hover:text-fg"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(false);
                    onClose?.();
                  }}
                  aria-label="Minimize AI chat drawer"
                  className="rounded-md p-1 text-muted hover:bg-surface hover:text-fg"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          )}

          {mode === "inline" && (messages.length > 0 || totalUnsavedDrafts > 0) && (
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface-2/40 px-3 py-1 text-xs">
              <div className="flex items-center gap-1.5">
                <Badge tone="success" className="text-[10px]">
                  {aiConfigQ.data?.provider === "gemini" ? "Gemini" : isVerifiedAndEnabled ? "Active" : "Smart Parser"}
                </Badge>
                {totalUnsavedDrafts > 0 && (
                  <Badge tone="warning" className="text-[10px]">
                    {totalUnsavedDrafts} pending
                  </Badge>
                )}
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-surface hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div
            ref={threadRef}
            className={cn(
              "flex flex-col gap-2.5 overflow-y-auto px-3 py-2.5",
              mode === "dock" ? "max-h-[55dvh] sm:max-h-96" : "max-h-[65dvh]",
            )}
          >
            {messages.length === 0 ? (
              <div className="flex flex-col gap-1.5 py-0.5">
                <span className="text-[11px] font-medium text-muted">Quick suggestions:</span>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((sample, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSend(undefined, sample)}
                      className="interactive-tap rounded-lg border border-border bg-surface-2/70 px-2 py-1 text-left text-[11px] text-fg transition hover:border-primary hover:bg-primary-soft/40 active:scale-[0.98]"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex flex-col items-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-primary px-3 py-1.5 text-xs font-medium text-primary-fg shadow-xs">
                        {m.text && <p>{m.text}</p>}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {m.attachments.map((att, idx) => (
                              <div key={idx} className="flex items-center gap-1 rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
                                <FileText className="size-3" aria-hidden />
                                <span className="max-w-28 truncate">{att.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                const drafts = m.drafts ?? [];
                const unsaved = drafts.filter((d) => !d.saved);

                return (
                  <div
                    key={m.id}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/40 p-2.5"
                  >
                    {(drafts.length > 0 || m.engine) && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold">
                            {drafts.length > 0
                              ? `${drafts.length} action${drafts.length === 1 ? "" : "s"}`
                              : "Answer"}
                          </span>
                          {m.engine && (
                            <Badge tone="primary" className="text-[10px]">
                              {m.engine === "gemini" ? "Gemini" : m.engine === "llm" ? "LLM" : "Smart"}
                            </Badge>
                          )}
                        </div>

                        {unsaved.length > 1 && (
                          <Button
                            size="sm"
                            onClick={() =>
                              saveDraftsMut.mutate({
                                msgId: m.id,
                                draftIds: unsaved.map((d) => d.id),
                              })
                            }
                            loading={saveDraftsMut.isPending}
                            className="h-6 px-2 text-[11px]"
                          >
                            <Check className="size-3" aria-hidden /> Save All ({unsaved.length})
                          </Button>
                        )}
                      </div>
                    )}

                    {m.text && <p className="text-xs text-fg leading-snug">{m.text}</p>}

                    {drafts.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {drafts.map((d) => {
                          const kind: AiActionKind = d.action_type ?? "transaction";
                          const isTx = kind === "transaction";
                          return (
                            <div
                              key={d.id}
                              className={cn(
                                "flex flex-col gap-1.5 rounded-xl border p-2 transition-colors",
                                d.saved
                                  ? "border-success/40 bg-success-soft/20 opacity-80"
                                  : "border-border bg-surface",
                              )}
                            >
                              {/* Row 1: Action/Type + Amount + Currency + Save/Trash */}
                              <div className="flex items-center justify-between gap-1">
                                {isTx ? (
                                  <Select
                                    value={d.type}
                                    disabled={d.saved}
                                    onChange={(e) =>
                                      updateDraftField(m.id, d.id, {
                                        type: e.target.value as ChatDraftItem["type"],
                                      })
                                    }
                                    className="h-7 w-24 px-1.5 text-xs font-semibold"
                                    aria-label="Transaction type"
                                  >
                                    <option value="withdrawal">Expense</option>
                                    <option value="deposit">Income</option>
                                    <option value="transfer">Transfer</option>
                                  </Select>
                                ) : (
                                  <Badge tone="primary" className="text-[10px]">
                                    {ACTION_BADGE[kind]}
                                  </Badge>
                                )}

                                <div className="flex items-center gap-1">
                                  {kind !== "category" && (
                                    <>
                                      <Input
                                        inputMode="decimal"
                                        disabled={d.saved}
                                        value={d.amount}
                                        onChange={(e) =>
                                          updateDraftField(m.id, d.id, { amount: e.target.value })
                                        }
                                        className="h-7 w-20 px-1.5 text-right font-mono text-xs font-bold"
                                        aria-label="Amount"
                                      />
                                      <Input
                                        disabled={d.saved}
                                        value={d.currency_code}
                                        onChange={(e) =>
                                          updateDraftField(m.id, d.id, {
                                            currency_code: e.target.value.toUpperCase(),
                                          })
                                        }
                                        className="h-7 w-12 px-1 text-center font-mono text-[11px] font-semibold uppercase"
                                        aria-label="Currency"
                                      />
                                    </>
                                  )}
                                  {d.saved ? (
                                    <Check className="size-4 text-success shrink-0" aria-label="Saved" />
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => removeDraft(m.id, d.id)}
                                        aria-label="Remove draft"
                                        className="rounded p-1 text-muted hover:text-danger"
                                      >
                                        <Trash2 className="size-3.5" aria-hidden />
                                      </button>
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          saveDraftsMut.mutate({ msgId: m.id, draftIds: [d.id] })
                                        }
                                        loading={saveDraftsMut.isPending}
                                        className="h-7 px-2 text-xs"
                                      >
                                        Save
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Row 2: Title/Description + Date */}
                              <div className="flex items-center gap-1.5">
                                <Input
                                  disabled={d.saved}
                                  value={d.description}
                                  onChange={(e) =>
                                    updateDraftField(m.id, d.id, { description: e.target.value })
                                  }
                                  placeholder="Description"
                                  className="h-7 flex-1 px-2 text-xs"
                                  aria-label="Description"
                                />
                                {isTx && (
                                  <Input
                                    type="date"
                                    disabled={d.saved}
                                    value={d.date}
                                    onChange={(e) =>
                                      updateDraftField(m.id, d.id, { date: e.target.value })
                                    }
                                    className="h-7 w-32 px-1.5 text-xs"
                                    aria-label="Date"
                                  />
                                )}
                              </div>

                              {/* Row 3: Account / Dest Account / Category / Budget */}
                              {isTx && (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <button
                                    type="button"
                                    disabled={d.saved}
                                    onClick={() => {
                                      const matched = assetAccounts.find(
                                        (a) =>
                                          a.attributes.name.toLowerCase() ===
                                          (d.source_name || "").toLowerCase(),
                                      );
                                      setPickerTarget({
                                        msgId: m.id,
                                        draftId: d.id,
                                        kind: "account",
                                        currentVal: matched?.id || defaultAsset?.id || "",
                                      });
                                    }}
                                    className="flex h-7 items-center justify-between gap-1 rounded-lg border border-border bg-surface px-2 text-left text-xs text-fg disabled:opacity-60"
                                  >
                                    <span className="truncate">
                                      {d.source_name || defaultAsset?.attributes.name || "Account"}
                                    </span>
                                    <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />
                                  </button>

                                  {d.type === "transfer" ? (
                                    <button
                                      type="button"
                                      disabled={d.saved}
                                      onClick={() => {
                                        const matched = assetAccounts.find(
                                          (a) =>
                                            a.attributes.name.toLowerCase() ===
                                            (d.destination_name || "").toLowerCase(),
                                        );
                                        setPickerTarget({
                                          msgId: m.id,
                                          draftId: d.id,
                                          kind: "dest-account",
                                          currentVal: matched?.id || "",
                                        });
                                      }}
                                      className="flex h-7 items-center justify-between gap-1 rounded-lg border border-border bg-surface px-2 text-left text-xs text-fg disabled:opacity-60"
                                    >
                                      <span className={cn("truncate", !d.destination_name && "text-muted")}>
                                        {d.destination_name || "To account"}
                                      </span>
                                      <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={d.saved}
                                      onClick={() =>
                                        setPickerTarget({
                                          msgId: m.id,
                                          draftId: d.id,
                                          kind: "category",
                                          currentVal: d.category_name,
                                        })
                                      }
                                      aria-label="Category"
                                      className="flex h-7 items-center justify-between gap-1 rounded-lg border border-border bg-surface px-2 text-left text-xs text-fg disabled:opacity-60"
                                    >
                                      <span className={cn("truncate", !d.category_name && "text-muted")}>
                                        {d.category_name
                                          ? d.category_name.replace(/\s*:\s*/g, " › ")
                                          : "Category"}
                                      </span>
                                      <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />
                                    </button>
                                  )}

                                  {d.type === "withdrawal" && (budgetsQ.data?.length ?? 0) > 0 && (
                                    <select
                                      disabled={d.saved}
                                      value={d.budget_name || ""}
                                      onChange={(e) =>
                                        updateDraftField(m.id, d.id, { budget_name: e.target.value })
                                      }
                                      aria-label="Budget"
                                      className="col-span-2 h-7 rounded-lg border border-border bg-surface px-2 text-xs text-fg outline-none disabled:opacity-60"
                                    >
                                      <option value="">No budget</option>
                                      {budgetsQ.data
                                        ?.filter((b) => b.attributes.active)
                                        .map((b) => (
                                          <option key={b.id} value={b.attributes.name}>
                                            {b.attributes.name}
                                          </option>
                                        ))}
                                    </select>
                                  )}
                                </div>
                              )}

                              {/* Attachments indicator if present */}
                              {d.attachments && d.attachments.length > 0 && (
                                <div className="flex items-center gap-1 text-[11px] text-muted">
                                  <Paperclip className="size-3 text-primary" aria-hidden />
                                  <span>{d.attachments.length} attachment(s)</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-2/50 px-2.5 py-1">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px]"
            >
              <FileText className="size-3 text-primary" aria-hidden />
              <span className="max-w-28 truncate">{att.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((list) => list.filter((_, i) => i !== idx))}
                aria-label={`Remove ${att.name}`}
                className="text-muted hover:text-danger"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => handleSend(e)}
        className="flex items-center gap-1.5 bg-surface px-2 py-1.5"
      >
        {mode === "dock" && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse AI chat history" : "Expand AI chat history"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
              expanded
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface-2 text-primary hover:border-primary",
            )}
          >
            {expanded ? <ChevronDown className="size-4" /> : <Wand2 className="size-4" />}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach receipt image or PDF"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
            attachments.length > 0
              ? "border-primary bg-primary-soft text-primary"
              : "border-border bg-surface-2 text-muted hover:border-primary hover:text-fg",
          )}
        >
          <Paperclip className="size-4" aria-hidden />
        </button>

        <div className="relative flex shrink-0 items-center justify-center">
          {listening && (
            <span className="animate-voice-ripple absolute inset-0 rounded-xl bg-danger" aria-hidden />
          )}
          <button
            type="button"
            onClick={toggleVoiceDictation}
            aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
            className={cn(
              "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all active:scale-95",
              listening
                ? "border-danger bg-danger text-white shadow-md"
                : "border-border bg-surface-2 text-muted hover:border-primary hover:text-fg",
            )}
          >
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onFocus={() => {
            if (mode === "dock" && messages.length > 0) setExpanded(true);
          }}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Ask or command AI…"}
          aria-label="AI Magic Assistant chat input"
          className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-surface-2/60 px-2.5 text-xs text-fg placeholder:text-muted focus:border-primary focus:bg-surface focus:outline-none sm:text-sm"
        />

        <Button
          type="submit"
          size="sm"
          loading={parseMut.isPending}
          disabled={!input.trim() && attachments.length === 0}
          className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-semibold"
        >
          <Send className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Send</span>
        </Button>

        {mode === "dock" && messages.length > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-primary-soft px-2 text-xs font-semibold text-primary"
          >
            <ChevronUp className="size-3.5" aria-hidden />
            <span>{totalUnsavedDrafts > 0 ? totalUnsavedDrafts : "Chat"}</span>
          </button>
        )}
      </form>

      {pickerTarget !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex flex-col overflow-hidden bg-surface animate-swipe-next">
            {pickerTarget.kind === "account" || pickerTarget.kind === "dest-account" ? (
              <FullScreenAccountSelectView
                title={pickerTarget.kind === "dest-account" ? "To account" : "Select account"}
                accounts={assetAccounts}
                selectedId={pickerTarget.currentVal || null}
                recentIds={loadRecentAccountIds()}
                onSelect={(accId) => {
                  const chosen = assetAccounts.find((a) => a.id === accId);
                  if (chosen) {
                    pushRecentAccountId(chosen.id);
                    updateDraftField(
                      pickerTarget.msgId,
                      pickerTarget.draftId,
                      pickerTarget.kind === "dest-account"
                        ? { destination_name: chosen.attributes.name }
                        : { source_name: chosen.attributes.name },
                    );
                  }
                  setPickerTarget(null);
                }}
                onBack={() => setPickerTarget(null)}
              />
            ) : (
              <FullScreenCategorySelectView
                categories={categoriesQ.data ?? []}
                selectedCategory={pickerTarget.currentVal}
                frequentCategories={getMostFrequentCategories(
                  (categoriesQ.data ?? []).map((c) => c.attributes.name),
                  8,
                )}
                onSelect={(catName) => {
                  if (catName) recordCategoryUsage(catName);
                  updateDraftField(pickerTarget.msgId, pickerTarget.draftId, {
                    category_name: catName,
                  });
                  setPickerTarget(null);
                }}
                onBack={() => setPickerTarget(null)}
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MagicChatbar({
  onOpenSheet,
}: {
  onOpenSheet?: () => void;
} = {}) {
  const pathname = usePathname();
  const aiConfigQ = useAiAssistantConfig();
  const [minimized, setMinimized] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  useEffect(() => {
    function onOpen() {
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setMobileSheetOpen(true);
      } else {
        setMinimized(false);
      }
    }
    window.addEventListener("ff:open-magic-chat", onOpen);
    return () => window.removeEventListener("ff:open-magic-chat", onOpen);
  }, []);

  if (pathname === "/new") return null;
  if (!aiConfigQ.data?.enabled || !aiConfigQ.data?.verified) return null;

  const handleTriggerClick = () => {
    onOpenSheet?.();
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSheetOpen(true);
    } else {
      setMinimized(false);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ff:open-magic-chat"));
      }, 50);
    }
  };

  return (
    <>
      <ModalSheet
        open={mobileSheetOpen}
        title="AI Assistant"
        onClose={() => setMobileSheetOpen(false)}
        maxWidth="max-w-2xl"
      >
        <div className="p-1 sm:p-2">
          <MagicChatPanel mode="inline" onClose={() => setMobileSheetOpen(false)} />
        </div>
      </ModalSheet>

      <div
        className={cn(
          "fixed left-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-35 md:bottom-6 md:left-72",
          !minimized && "md:hidden",
          mobileSheetOpen && "hidden",
        )}
      >
        <button
          type="button"
          onClick={handleTriggerClick}
          aria-label="Ask AI Assistant"
          className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-primary/30 bg-surface/95 px-2.5 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-primary shadow-lg backdrop-blur transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-primary-soft hover:shadow-xl"
        >
          <Sparkles className="size-3 sm:size-3.5" aria-hidden />
          <span>Ask AI / Ramble</span>
        </button>
      </div>

      {!minimized && (
        <div className="sheet-up fixed inset-x-2.5 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-35 mx-auto max-w-2xl hidden md:block md:right-24 md:bottom-5 md:left-72">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Minimize AI chatbar to pill"
              title="Minimize chatbar"
              className="absolute -top-2.5 -right-2 z-10 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-xs hover:text-fg"
            >
              <X className="size-3" aria-hidden />
            </button>
            <MagicChatPanel mode="dock" />
          </div>
        </div>
      )}
    </>
  );
}
