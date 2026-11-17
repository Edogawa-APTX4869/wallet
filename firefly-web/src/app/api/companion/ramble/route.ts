import { NextRequest, NextResponse } from "next/server";
import { getKv, setKv } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import {
  generateSmartReply,
  parseWithSmartHeuristics,
  type AccountContextItem,
  type AiActionKind,
  type AiProviderType,
  type AttachmentPayload,
  type BillContextItem,
  type BudgetContextItem,
  type CategoryContextItem,
  type ParsedTransactionDraft,
  type PiggyContextItem,
  type SmartParseContext,
} from "@/lib/ai-ramble-parser";

export type {
  AccountContextItem,
  AiActionKind,
  AiProviderType,
  AttachmentPayload,
  BillContextItem,
  BudgetContextItem,
  CategoryContextItem,
  ParsedTransactionDraft,
  PiggyContextItem,
  SmartParseContext,
};

export interface LlmConfig {
  enabled: boolean;
  provider: AiProviderType;
  endpoint: string;
  model: string;
  apiKey: string;
  verified: boolean;
  verifiedAt?: string;
}

const GEMINI_OPENAI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function getLlmConfig(): LlmConfig {
  const saved = getKv<Partial<LlmConfig>>("llm_config", {});
  const envEndpoint = process.env.ASSISTANT_LLM_ENDPOINT || "";
  const envModel = process.env.ASSISTANT_LLM_MODEL || "";
  const envKey = process.env.ASSISTANT_LLM_API_KEY || "";

  const provider: AiProviderType =
    saved.provider ||
    (saved.endpoint?.includes("generativelanguage.googleapis.com")
      ? "gemini"
      : saved.endpoint || envEndpoint
        ? "openai-compatible"
        : "disabled");

  const endpoint =
    provider === "gemini"
      ? GEMINI_OPENAI_ENDPOINT
      : saved.endpoint ?? envEndpoint;

  const model =
    saved.model ||
    envModel ||
    (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");

  const apiKey = saved.apiKey ?? envKey;
  const verified = Boolean(saved.verified);
  const enabled = Boolean(saved.enabled && verified && provider !== "disabled");

  return {
    enabled,
    provider,
    endpoint,
    model,
    apiKey,
    verified,
    verifiedAt: saved.verifiedAt,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const cfg = getLlmConfig();
  return NextResponse.json({
    data: {
      enabled: cfg.enabled,
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      model: cfg.model,
      hasApiKey: Boolean(cfg.apiKey),
      verified: cfg.verified,
      verifiedAt: cfg.verifiedAt ?? null,
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = (await req.json()) as Partial<LlmConfig> & { testConnection?: boolean };
  const prev = getLlmConfig();

  const provider: AiProviderType = body.provider ?? prev.provider;
  const endpoint =
    provider === "gemini"
      ? GEMINI_OPENAI_ENDPOINT
      : (body.endpoint ?? prev.endpoint).trim();
  const model =
    (body.model ?? prev.model).trim() ||
    (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
  const apiKey = body.apiKey !== undefined ? body.apiKey.trim() : prev.apiKey;

  if (provider === "disabled") {
    const disabledCfg: LlmConfig = {
      enabled: false,
      provider: "disabled",
      endpoint,
      model,
      apiKey,
      verified: false,
    };
    setKv("llm_config", disabledCfg);
    return NextResponse.json({
      data: {
        enabled: false,
        provider: "disabled",
        endpoint,
        model,
        hasApiKey: Boolean(apiKey),
        verified: false,
        verifiedAt: null,
      },
    });
  }

  let verified = false;
  let verifyError = "";

  if (provider === "local-heuristic") {
    const testDrafts = parseWithSmartHeuristics({
      text: "Spent 1.000 BHD test",
      today: new Date().toISOString().slice(0, 10),
      defaultCurrency: "BHD",
      defaultAccount: "DailyAccount",
      accounts: ["DailyAccount"],
      categories: [],
      budgets: [],
      tags: [],
    });
    verified = testDrafts.length > 0;
  } else {
    if (!endpoint) {
      return NextResponse.json(
        { error: "Endpoint URL is required for external AI providers." },
        { status: 400 },
      );
    }
    if (provider === "gemini" && !apiKey) {
      return NextResponse.json(
        { error: "A Google AI Studio (Gemini) key is required to verify Gemini." },
        { status: 400 },
      );
    }
    try {
      await verifyLlmConnection({
        enabled: true,
        provider,
        endpoint,
        model,
        apiKey,
        verified: false,
      });
      verified = true;
    } catch (e) {
      verifyError = (e as Error).message || "Connection test failed";
    }
  }

  if (!verified) {
    const failedCfg: LlmConfig = {
      enabled: false,
      provider,
      endpoint,
      model,
      apiKey,
      verified: false,
    };
    setKv("llm_config", failedCfg);
    return NextResponse.json(
      { error: `AI verification failed: ${verifyError}` },
      { status: 400 },
    );
  }

  const verifiedAt = new Date().toISOString();
  const next: LlmConfig = {
    enabled: body.enabled ?? true,
    provider,
    endpoint,
    model,
    apiKey,
    verified: true,
    verifiedAt,
  };
  setKv("llm_config", next);

  return NextResponse.json({
    data: {
      enabled: next.enabled,
      provider: next.provider,
      endpoint: next.endpoint,
      model: next.model,
      hasApiKey: Boolean(next.apiKey),
      verified: next.verified,
      verifiedAt: next.verifiedAt,
    },
  });
}

async function verifyLlmConnection(cfg: LlmConfig): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 25,
      temperature: 0,
      messages: [{ role: "user", content: 'Reply with {"ok":true}' }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${errText ? `: ${errText.slice(0, 140)}` : ""}`);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = (await req.json()) as {
    text?: string;
    attachments?: AttachmentPayload[];
    today?: string;
    defaultCurrency?: string;
    defaultAccount?: string;
    accounts?: string[];
    categories?: string[];
    budgets?: string[];
    tags?: string[];
    accountDetails?: AccountContextItem[];
    budgetDetails?: BudgetContextItem[];
    piggyDetails?: PiggyContextItem[];
    billDetails?: BillContextItem[];
    categoryDetails?: CategoryContextItem[];
  };

  const text = (body.text ?? "").trim();
  const attachments = body.attachments ?? [];
  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: "Enter text or attach a file to parse" }, { status: 400 });
  }

  const today = body.today || new Date().toISOString().slice(0, 10);
  const defaultCurrency = body.defaultCurrency || "BHD";
  const defaultAccount = body.defaultAccount || "";
  const cfg = getLlmConfig();

  const ctx: SmartParseContext = {
    text: text || "Extract the transaction details from the attached receipt/document.",
    today,
    defaultCurrency,
    defaultAccount,
    accounts: body.accounts ?? [],
    categories: body.categories ?? [],
    budgets: body.budgets ?? [],
    tags: body.tags ?? [],
    accountDetails: body.accountDetails,
    budgetDetails: body.budgetDetails,
    piggyDetails: body.piggyDetails,
    billDetails: body.billDetails,
    categoryDetails: body.categoryDetails,
  };

  if ((cfg.provider === "gemini" || cfg.provider === "openai-compatible") && cfg.endpoint) {
    try {
      const llmRes = await parseWithLlm(cfg, { ...ctx, attachments });
      if (llmRes.drafts.length > 0 || llmRes.reply) {
        return NextResponse.json({
          data: llmRes.drafts,
          reply: llmRes.reply || undefined,
          engine: cfg.provider === "gemini" ? "gemini" : "llm",
        });
      }
    } catch {
      // Fall back to deterministic smart parser if LLM fails
    }
  }

  const fallbackText =
    text ||
    attachments.map((a) => a.name.replace(/\.[^.]+$/, "")).join(" ");

  const drafts = parseWithSmartHeuristics({ ...ctx, text: fallbackText });
  const reply = generateSmartReply({ ...ctx, text: fallbackText }, drafts);

  if (drafts.length === 0 && attachments.length > 0) {
    drafts.push({
      action_type: "transaction",
      type: "withdrawal",
      amount: "0.000",
      currency_code: defaultCurrency,
      description: attachments[0].name.replace(/\.[^.]+$/, "") || "Receipt Expense",
      source_name: defaultAccount,
      destination_name: attachments[0].name.replace(/\.[^.]+$/, "") || "Merchant",
      category_name: "",
      budget_name: "",
      tags: ["receipt"],
      date: today,
    });
  }

  return NextResponse.json({
    data: drafts,
    reply: reply || undefined,
    engine: "smart-local",
  });
}

async function parseWithLlm(
  cfg: LlmConfig,
  ctx: SmartParseContext & { attachments: AttachmentPayload[] },
): Promise<{ drafts: ParsedTransactionDraft[]; reply?: string }> {
  const prompt = `You are a full-system Firefly III assistant.
Today: ${ctx.today}. Default currency: ${ctx.defaultCurrency}. Default account: "${ctx.defaultAccount}".
Accounts: ${JSON.stringify(ctx.accountDetails ?? ctx.accounts)}
Categories: ${JSON.stringify(ctx.categoryDetails ?? ctx.categories)}
Budgets (month): ${JSON.stringify(ctx.budgetDetails ?? ctx.budgets)}
Piggy Banks: ${JSON.stringify(ctx.piggyDetails ?? [])}
Bills: ${JSON.stringify(ctx.billDetails ?? [])}
Tags: ${JSON.stringify(ctx.tags)}

Return ONLY a JSON object {"transactions": [...], "reply": "optional concise answer"}.
If the user asks a financial question (balances, overspent budgets, bills, savings), answer concisely in "reply" using the provided live data and leave "transactions" empty unless they also asked to log/change something.
Each item in "transactions" supports ALL system actions:
- "action_type": "transaction" | "budget_adjust" | "budget_transfer" | "piggy_bank" | "bill" | "recurrence" | "category" | "account"
- "type": "withdrawal" | "deposit" | "transfer"
- "amount": numeric string (e.g. "4.500")
- "currency_code": 3-letter ISO code (default "${ctx.defaultCurrency}")
- "foreign_amount": optional string if converting currency
- "foreign_currency_code": optional ISO code
- "description": concise title / payee / resource name
- "source_name": source asset account (or source budget for "budget_transfer")
- "destination_name": merchant (withdrawal), target asset account (deposit/transfer), target budget ("budget_transfer"), or piggy bank name ("piggy_bank")
- "category_name": best matching category
- "budget_name": best matching budget (for withdrawal or "budget_adjust")
- "bill_name": best matching or new bill name
- "tags": array of strings
- "notes": optional notes
- "date": YYYY-MM-DD
- "adjust_mode": optional "set" | "add" | "subtract" | "create" (for budget_adjust / piggy_bank)
- "repeat_freq": optional "daily" | "weekly" | "monthly" | "quarterly" | "half-year" | "yearly" (for bill / recurrence)
- "target_date": optional YYYY-MM-DD (for piggy_bank)
- "account_type": optional "asset" | "liability" | "expense" | "revenue" (for account)`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const imageAttachments = ctx.attachments.filter((a) => a.mimeType.startsWith("image/"));
  const userContent: unknown =
    imageAttachments.length > 0
      ? [
          { type: "text", text: ctx.text },
          ...imageAttachments.map((img) => ({
            type: "image_url",
            image_url: { url: img.dataUrl },
          })),
        ]
      : ctx.text;

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = data.choices?.[0]?.message?.content ?? "{}";
  const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned) as {
    transactions?: ParsedTransactionDraft[];
    reply?: string;
  };
  return {
    drafts: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    reply: typeof parsed.reply === "string" ? parsed.reply.trim() : undefined,
  };
}
