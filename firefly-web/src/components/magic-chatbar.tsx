"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
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
  AiProviderType,
  AttachmentPayload,
  ParsedTransactionDraft,
} from "@/app/api/companion/ramble/route";
import { ASSET_LIKE, useAccounts, usePrimaryCurrency } from "@/lib/hooks";
import { cn, isoDate, monthRange } from "@/lib/utils";
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
  "Gas 12.500 BHD & Lunch 4.200 BHD",
  "Salary 850.000 BHD into DailyAccount",
];

/**
 * Shared conversational AI Magic ("Ramble") surface with:
 * - Voice dictation (Web Speech API)
 * - Receipt / file attachments (multimodal AI parsing + automatic upload to Firefly III `/api/v1/attachments`)
 * - Inline editable multi-transaction draft cards
 */
export function MagicChatPanel({
  mode = "dock",
  onClose,
}: {
  mode?: "dock" | "inline";
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
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
  const tagsQ = useQuery({
    queryKey: ["tags-list"],
    queryFn: api.tags,
    staleTime: 5 * 60_000,
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(mode === "inline");
  useEscapeDismiss(mode === "dock" && expanded, () => setExpanded(false), "magic-chat-dock");
  const [messages, setMessages] = useState<MagicChatMessage[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const assetAccounts = (accountsQ.data ?? []).filter(
    (a) => ASSET_LIKE.has(a.attributes.type) && a.attributes.active !== false,
  );
  const defaultAsset = assetAccounts[0];
  const defaultCurrency = primaryQ.data?.code || defaultAsset?.attributes.currency_code || "BHD";

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
      if (detail?.prompt) {
        setInput(detail.prompt);
      }
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
        toast(`File ${file.name} exceeds 8 MB limit.`, "error");
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
          budgets: (budgetsQ.data ?? []).map((b) => b.attributes.name),
          tags: (tagsQ.data ?? []).map((t) => t.attributes.tag),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to parse transactions");
      }
      return (await res.json()) as { data: ParsedTransactionDraft[]; engine: string };
    },
    onSuccess: (res, payload) => {
      const userMsg: MagicChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: payload.promptText || (payload.files.length > 0 ? `Attached ${payload.files.length} file(s)` : ""),
        attachments: payload.files,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      const draftsWithIds: ChatDraftItem[] = (res.data ?? []).map((d, idx) => ({
        ...d,
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
          draftsWithIds.length === 0
            ? "I couldn't detect any monetary amounts. Try including numbers like 'Spent 3.500 BHD on lunch' or attach a clear receipt image."
            : undefined,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setExpanded(true);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  async function saveDraftToFirefly(d: ChatDraftItem) {
    const matchedAcc =
      assetAccounts.find((a) => a.attributes.name.toLowerCase() === d.source_name.toLowerCase()) ||
      assetAccounts.find((a) => a.attributes.name.toLowerCase() === d.destination_name.toLowerCase()) ||
      defaultAsset;

    const split: NewSplit = {
      type: d.type,
      date: d.date || isoDate(),
      amount: d.amount,
      currency_code: d.currency_code || defaultCurrency,
      description: d.description,
      category_name: d.category_name || undefined,
      tags: d.tags,
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
        assetAccounts.find((a) => a.attributes.name.toLowerCase() === d.destination_name.toLowerCase()) ||
        assetAccounts.find((a) => a.id !== matchedAcc?.id);
      split.destination_id = destAcc?.id;
    }

    const createdGroup = await api.createTransaction([split]);
    const journalId =
      createdGroup.data.attributes.transactions?.[0]?.transaction_journal_id ||
      createdGroup.data.id;

    // Upload any attached receipts/files to Firefly III and link them to this transaction journal
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
        toast(`Saved ${count} transaction${count === 1 ? "" : "s"} to Firefly III!`);
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
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
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
      toast("Voice dictation is not supported in this browser. Try Chrome, Edge, or Safari.", "error");
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
        if (event.results[i].isFinal) {
          finalTranscript += chunk;
        } else {
          interimTranscript += chunk;
        }
      }
      if (finalTranscript) {
        setInput((prev) => {
          const combined = prev ? `${prev} ${finalTranscript}`.trim() : finalTranscript.trim();
          return combined;
        });
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
  if (!aiConfigQ.isLoading && !isVerifiedAndEnabled) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl transition-all",
        mode === "dock" ? "backdrop-blur-md" : "shadow-sm",
      )}
    >
      {/* Expandable Conversational Thread Drawer */}
      {(expanded || mode === "inline") && (
        <div className="flex flex-col border-b border-border">
          {/* Desktop Dock Header (only shown in dock mode since ModalSheet provides header in mobile inline mode) */}
          {mode === "dock" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3.5 py-2">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-primary text-primary-fg">
                  <Sparkles className="size-3.5" aria-hidden />
                </span>
                <span className="text-xs font-bold">AI Magic Assistant</span>
                <Badge tone="success">
                  ✓ {aiConfigQ.data?.provider === "gemini" ? "Google Gemini" : aiConfigQ.data?.provider === "openai-compatible" ? "AI LLM" : "Verified"}
                </Badge>
                {totalUnsavedDrafts > 0 && <Badge tone="warning">{totalUnsavedDrafts} unsaved</Badge>}
              </div>

              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-fg"
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
                  className="rounded-lg p-1 text-muted hover:bg-surface hover:text-fg"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          )}

          {/* Inline Mobile Mode Status Bar (only shown when thread has active messages or unsaved drafts) */}
          {mode === "inline" && (messages.length > 0 || totalUnsavedDrafts > 0) && (
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface-2/40 px-3 py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <Badge tone="success" className="text-[10px]">
                  ✓ {aiConfigQ.data?.provider === "gemini" ? "Google Gemini" : "Verified"}
                </Badge>
                {totalUnsavedDrafts > 0 && <Badge tone="warning" className="text-[10px]">{totalUnsavedDrafts} unsaved</Badge>}
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-surface hover:text-fg"
                >
                  Clear thread
                </button>
              )}
            </div>
          )}

          {/* Messages & Interactive Draft Cards */}
          <div
            ref={threadRef}
            className={cn(
              "flex flex-col gap-3 overflow-y-auto px-3.5 py-3",
              mode === "dock" ? "max-h-[55dvh] sm:max-h-96" : "max-h-[65dvh]",
            )}
          >
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2 py-1.5">
                <p className="text-[11px] font-medium text-muted">
                  Quick suggestions:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((sample, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSend(undefined, sample)}
                      className="interactive-tap rounded-xl border border-border bg-surface-2/70 px-2.5 py-1 text-left text-xs text-fg transition-all duration-150 hover:border-primary hover:bg-primary-soft/40 active:scale-[0.98]"
                    >
                      &ldquo;{sample}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex flex-col items-end gap-1.5">
                      <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-primary px-3.5 py-2 text-xs font-medium text-primary-fg shadow-xs">
                        {m.text && <p>{m.text}</p>}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {m.attachments.map((att, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 text-xs"
                              >
                                {att.mimeType.startsWith("image/") ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={att.dataUrl}
                                    alt={att.name}
                                    className="size-6 rounded object-cover"
                                  />
                                ) : (
                                  <FileText className="size-3.5" aria-hidden />
                                )}
                                <span className="max-w-32 truncate">{att.name}</span>
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
                    className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface-2/40 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">
                          ✦ Parsed {drafts.length} transaction{drafts.length === 1 ? "" : "s"}
                        </span>
                        {m.engine && (
                          <Badge tone="primary">
                            {m.engine === "gemini"
                              ? "Google Gemini"
                              : m.engine === "llm"
                                ? "AI LLM"
                                : "Smart Local Parser"}
                          </Badge>
                        )}
                      </div>

                      {unsaved.length > 0 ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            saveDraftsMut.mutate({
                              msgId: m.id,
                              draftIds: unsaved.map((d) => d.id),
                            })
                          }
                          loading={saveDraftsMut.isPending}
                          className="h-7 px-2.5 text-xs"
                        >
                          <Check className="size-3.5" aria-hidden /> Save All ({unsaved.length})
                        </Button>
                      ) : drafts.length > 0 ? (
                        <Badge tone="success">✓ All Saved to Firefly III</Badge>
                      ) : null}
                    </div>

                    {m.text && <p className="text-xs text-muted">{m.text}</p>}

                    {drafts.length > 0 && (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {drafts.map((d) => (
                          <div
                            key={d.id}
                            className={cn(
                              "flex flex-col gap-2 rounded-xl border p-2.5 transition-colors",
                              d.saved
                                ? "border-success/40 bg-success-soft/20 opacity-80"
                                : "border-border bg-surface",
                            )}
                          >
                            {/* Top Row: Type Selector + Amount + Currency */}
                            <div className="flex items-center justify-between gap-1.5">
                              <Select
                                value={d.type}
                                disabled={d.saved}
                                onChange={(e) =>
                                  updateDraftField(m.id, d.id, {
                                    type: e.target.value as ChatDraftItem["type"],
                                  })
                                }
                                className="h-7 w-28 px-2 text-xs font-semibold"
                                aria-label="Transaction type"
                              >
                                <option value="withdrawal">Expense</option>
                                <option value="deposit">Income</option>
                                <option value="transfer">Transfer</option>
                              </Select>

                              <div className="flex items-center gap-1">
                                <Input
                                  inputMode="decimal"
                                  disabled={d.saved}
                                  value={d.amount}
                                  onChange={(e) =>
                                    updateDraftField(m.id, d.id, { amount: e.target.value })
                                  }
                                  className="h-7 w-24 px-2 text-right font-mono text-xs font-bold"
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
                                  className="h-7 w-14 px-1.5 text-center font-mono text-xs font-semibold uppercase"
                                  aria-label="Currency"
                                />
                              </div>
                            </div>

                            {/* Description + Category + Date */}
                            <div className="grid grid-cols-2 gap-1.5">
                              <Input
                                disabled={d.saved}
                                value={d.description}
                                onChange={(e) =>
                                  updateDraftField(m.id, d.id, { description: e.target.value })
                                }
                                placeholder="Description"
                                className="col-span-2 h-7 px-2 text-xs"
                                aria-label="Description"
                              />
                              <Input
                                disabled={d.saved}
                                value={d.category_name}
                                onChange={(e) =>
                                  updateDraftField(m.id, d.id, { category_name: e.target.value })
                                }
                                placeholder="Category"
                                className="h-7 px-2 text-xs"
                                aria-label="Category"
                              />
                              <Input
                                type="date"
                                disabled={d.saved}
                                value={d.date}
                                onChange={(e) =>
                                  updateDraftField(m.id, d.id, { date: e.target.value })
                                }
                                className="h-7 px-2 text-xs"
                                aria-label="Date"
                              />
                            </div>

                            {/* Linked Attachment Badge */}
                            {d.attachments && d.attachments.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                                <Paperclip className="size-3 text-primary" aria-hidden />
                                <span>
                                  {d.attachments.length} attachment{d.attachments.length === 1 ? "" : "s"} will upload
                                  to Firefly
                                </span>
                              </div>
                            )}

                            {/* Footer Actions */}
                            <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
                              <span className="truncate text-xs text-muted">
                                {d.source_name || defaultAsset?.attributes.name || "Account"}
                              </span>
                              <div className="flex items-center gap-1">
                                {d.saved ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                                    <Check className="size-3.5" aria-hidden /> Saved
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => removeDraft(m.id, d.id)}
                                      aria-label="Remove transaction draft"
                                      className="rounded-md p-1 text-muted hover:bg-danger-soft hover:text-danger"
                                    >
                                      <Trash2 className="size-3.5" aria-hidden />
                                    </button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() =>
                                        saveDraftsMut.mutate({ msgId: m.id, draftIds: [d.id] })
                                      }
                                      loading={saveDraftsMut.isPending}
                                      className="h-6 px-2.5 text-xs"
                                    >
                                      Save
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Selected Attachment Previews Strip above Input */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-1.5">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
            >
              {att.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={att.dataUrl} alt={att.name} className="size-5 rounded object-cover" />
              ) : (
                <FileText className="size-3.5 text-primary" aria-hidden />
              )}
              <span className="max-w-36 truncate font-medium">{att.name}</span>
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

      {/* Fast-Access Bottom Chatbar Input Row */}
      <form
        onSubmit={(e) => handleSend(e)}
        className="flex items-center gap-1.5 bg-surface px-2.5 py-2 sm:gap-2"
      >
        {/* Expand / Collapse Drawer Button (in Dock mode) */}
        {mode === "dock" && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse AI chat history" : "Expand AI chat history"}
            title={expanded ? "Collapse AI chat" : "Open AI Magic Assistant"}
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

        {/* Hidden File Input + Attachment Button */}
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
          title="Attach receipt image or PDF"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
            attachments.length > 0
              ? "border-primary bg-primary-soft text-primary"
              : "border-border bg-surface-2 text-muted hover:border-primary hover:text-fg",
          )}
        >
          <Paperclip className="size-4" aria-hidden />
        </button>

        {/* Voice Dictation Mic Button with Radar Waveform Pulse */}
        <div className="relative flex shrink-0 items-center justify-center">
          {listening && (
            <span className="animate-voice-ripple absolute inset-0 rounded-xl bg-danger" aria-hidden />
          )}
          <button
            type="button"
            onClick={toggleVoiceDictation}
            aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
            title={listening ? "Listening… click to stop" : "Dictate with voice"}
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

        {/* Natural-Language Chat Input */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onFocus={() => {
            if (mode === "dock" && messages.length > 0) setExpanded(true);
          }}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            listening
              ? "Listening… speak your expense or income now"
              : attachments.length > 0
                ? "Add optional note for attached receipt, or press Send…"
                : "Ask AI, attach receipt, or ramble: 'Spent 3.500 BHD lunch'…"
          }
          aria-label="AI Magic Assistant chat input"
          className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-surface-2/60 px-3 text-xs text-fg placeholder:text-muted focus:border-primary focus:bg-surface focus:outline-none sm:text-sm"
        />

        {/* Send / Parse Button */}
        <Button
          type="submit"
          size="sm"
          loading={parseMut.isPending}
          disabled={!input.trim() && attachments.length === 0}
          className="h-9 shrink-0 rounded-xl px-3 text-xs font-semibold"
        >
          <Send className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Send</span>
        </Button>

        {mode === "dock" && messages.length > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-primary-soft px-2.5 text-xs font-semibold text-primary"
          >
            <ChevronUp className="size-3.5" aria-hidden />
            <span>{totalUnsavedDrafts > 0 ? `${totalUnsavedDrafts} draft` : "Chat"}</span>
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Persistent Fast-Access Bottom Chatbar mounted across the app shell.
 * STRICT REQUIREMENT: Remains completely hidden unless the AI configuration is completed and verified!
 */
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

  // Do not render the bottom chatbar unless AI configuration is done and verified
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
      {/* Mobile Slide-Up ModalSheet (z-50 / modal layer) */}
      <ModalSheet
        open={mobileSheetOpen}
        title="AI Magic Assistant"
        subtitle="Natural language expenses, voice dictation & receipts"
        onClose={() => setMobileSheetOpen(false)}
        maxWidth="max-w-2xl"
      >
        <div className="p-1 sm:p-2">
          <MagicChatPanel mode="inline" onClose={() => setMobileSheetOpen(false)} />
        </div>
      </ModalSheet>

      {/* Sleek Trigger Pill on Bottom-Left (opposite the FAB, stratified at z-35) */}
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

      {/* Desktop Expanded Dock Bar (hidden on mobile to eliminate overlap, stratified at z-35) */}
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
