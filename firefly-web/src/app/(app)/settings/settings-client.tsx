"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  Check,
  Coins,
  ExternalLink,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Server,
  Sliders,
  Star,
  Sun,
  Trash2,
  Wand2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Currency } from "@/lib/firefly/types";
import type { AiProviderType } from "@/app/api/companion/ramble/route";
import { formatRate } from "@/lib/fx/resolve";
import { qk, useCurrencies, usePrimaryCurrency } from "@/lib/hooks";
import { cn, formatDate, isoDate, parseAmount } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { useTheme } from "@/components/theme-provider";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

const CONFIG_LABELS: Record<string, { label: string; desc: string }> = {
  "configuration.enable_exchange_rates": {
    label: "Enable Exchange Rates",
    desc: "Allow Firefly III to store and convert foreign currency rates.",
  },
  "configuration.enable_external_rates": {
    label: "Enable External Exchange Rates",
    desc: "Allow Firefly III to download exchange rates from external providers.",
  },
  "configuration.use_running_balance": {
    label: "Calculate Running Balances",
    desc: "Calculate and return running balances on account registers.",
  },
  "configuration.allow_webhooks": {
    label: "Allow Outgoing Webhooks",
    desc: "Let Firefly III send HTTP webhooks when transactions or budgets change.",
  },
  "configuration.enable_batch_processing": {
    label: "Enable Batch Processing",
    desc: "Allow batch rule & webhook processing.",
  },
  "configuration.single_user_mode": {
    label: "Single User Mode",
    desc: "Prevent new user registrations on this Firefly III instance.",
  },
};

export function SettingsClient() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const { theme, resolvedTheme, setTheme, systemTheme } = useTheme();
  const isSystemDark = (systemTheme ?? (resolvedTheme === "dark" ? "dark" : "light")) === "dark";

  const sessionQ = useQuery({
    queryKey: ["session"],
    queryFn: () => fetch("/api/session").then((r) => r.json() as Promise<{ connected: boolean; url: string | null }>),
  });
  const aboutQ = useQuery({ queryKey: ["about"], queryFn: api.about });
  const userQ = useQuery({ queryKey: ["about-user"], queryFn: api.user });
  const primaryQ = usePrimaryCurrency();
  const currenciesQ = useCurrencies();
  const ratesQ = useQuery({ queryKey: ["rates", "all"], queryFn: api.exchangeRates });
  const configQ = useQuery({ queryKey: ["configuration"], queryFn: api.configuration });
  const webhooksQ = useQuery({ queryKey: ["webhooks"], queryFn: api.webhooks });

  const [selectedFromCode, setFromCode] = useState("");
  const [selectedToCode, setToCode] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [rateDate, setRateDate] = useState(isoDate());

  const enabledCurrencies = (currenciesQ.data ?? []).filter((c) => c.attributes.enabled !== false);
  const fromCode = selectedFromCode || primaryQ.data?.code || enabledCurrencies[0]?.attributes.code || "";
  const toCode =
    selectedToCode ||
    enabledCurrencies.find((c) => c.attributes.code !== fromCode)?.attributes.code ||
    enabledCurrencies[0]?.attributes.code ||
    "";

  const addRateMut = useMutation({
    mutationFn: async () => {
      if (!fromCode || !toCode) throw new Error("Choose both currencies.");
      if (fromCode === toCode) throw new Error("Source and target currencies must differ.");
      const parsed = parseAmount(rateInput);
      if (!parsed || new Decimal(parsed).lte(0)) throw new Error("Enter a rate greater than zero.");
      return api.storeExchangeRate(fromCode, toCode, parsed, rateDate);
    },
    onSuccess: () => {
      toast(`Saved rate 1 ${fromCode} = ${rateInput} ${toCode}`);
      setRateInput("");
      qc.invalidateQueries({ queryKey: ["rates"] });
      qc.invalidateQueries({ queryKey: ["resolved-rate"] });
      qc.invalidateQueries({ queryKey: ["rates-to-primary"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delRateMut = useMutation({
    mutationFn: (id: string) => api.deleteExchangeRate(id),
    onSuccess: () => {
      toast("Exchange rate deleted", "info");
      qc.invalidateQueries({ queryKey: ["rates"] });
      qc.invalidateQueries({ queryKey: ["resolved-rate"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // --- Currency Management ---
  const [newCurCode, setNewCurCode] = useState("");
  const [newCurName, setNewCurName] = useState("");
  const [newCurSymbol, setNewCurSymbol] = useState("");
  const [newCurDecimals, setNewCurDecimals] = useState("2");
  const [editingCur, setEditingCur] = useState<string | null>(null);
  useEscapeDismiss(editingCur !== null, () => setEditingCur(null), "settings-currency-edit");
  const [editDecimals, setEditDecimals] = useState("2");
  const [editSymbol, setEditSymbol] = useState("");
  const [editName, setEditName] = useState("");

  const addCurMut = useMutation({
    mutationFn: () =>
      api.createCurrency({
        code: newCurCode.trim().toUpperCase(),
        name: newCurName.trim(),
        symbol: newCurSymbol.trim(),
        decimal_places: Math.max(0, Math.min(8, Number(newCurDecimals) || 2)),
        enabled: true,
      }),
    onSuccess: (res) => {
      toast(`Currency ${res.data.attributes.code} added (${res.data.attributes.decimal_places} decimals)`);
      setNewCurCode("");
      setNewCurName("");
      setNewCurSymbol("");
      setNewCurDecimals("2");
      qc.invalidateQueries({ queryKey: qk.currencies });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const updateCurMut = useMutation({
    mutationFn: (c: { code: string; name: string; symbol: string; decimal_places: number }) =>
      api.updateCurrency(c.code, {
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        decimal_places: c.decimal_places,
      }),
    onSuccess: (res) => {
      toast(`Updated ${res.data.attributes.code} (${res.data.attributes.decimal_places} decimal places)`);
      setEditingCur(null);
      qc.invalidateQueries({ queryKey: qk.currencies });
      qc.invalidateQueries({ queryKey: qk.primary });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const toggleCurMut = useMutation({
    mutationFn: (c: { code: string; enabled: boolean }) =>
      c.enabled ? api.enableCurrency(c.code) : api.disableCurrency(c.code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.currencies });
      toast("Currency status updated");
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const defaultCurMut = useMutation({
    mutationFn: (code: string) => api.defaultCurrency(code),
    onSuccess: (_res, code) => {
      toast(`${code} set as primary currency`);
      qc.invalidateQueries({ queryKey: qk.currencies });
      qc.invalidateQueries({ queryKey: qk.primary });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // --- Server Configuration ---
  const configMut = useMutation({
    mutationFn: (p: { title: string; value: boolean | string }) => api.updateConfiguration(p.title, p.value),
    onSuccess: () => {
      toast("Server configuration updated");
      qc.invalidateQueries({ queryKey: ["configuration"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // --- Webhooks ---
  const [whTitle, setWhTitle] = useState("");
  const [whUrl, setWhUrl] = useState("");
  const [whTrigger, setWhTrigger] = useState("STORE_TRANSACTION");
  const [whResponse, setWhResponse] = useState("TRANSACTIONS");

  const createWhMut = useMutation({
    mutationFn: () =>
      api.createWebhook({
        title: whTitle.trim(),
        url: whUrl.trim(),
        trigger: whTrigger,
        response: whResponse,
        delivery: "JSON",
        active: true,
      }),
    onSuccess: () => {
      toast("Webhook created");
      setWhTitle("");
      setWhUrl("");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delWhMut = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      toast("Webhook deleted", "info");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // --- AI Assistant ("Ramble") Configuration ---
  const llmConfigQ = useQuery({
    queryKey: ["llm-config"],
    queryFn: async () => {
      const res = await fetch("/api/companion/ramble");
      if (!res.ok) {
        return {
          enabled: false,
          provider: "disabled" as AiProviderType,
          endpoint: "",
          model: "gemini-2.5-flash",
          hasApiKey: false,
          verified: false,
          verifiedAt: null as string | null,
        };
      }
      const json = (await res.json()) as {
        data: {
          enabled: boolean;
          provider: AiProviderType;
          endpoint: string;
          model: string;
          hasApiKey: boolean;
          verified: boolean;
          verifiedAt: string | null;
        };
      };
      return json.data;
    },
  });
  const [llmProvider, setLlmProvider] = useState<AiProviderType | "">("");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmKey, setLlmKey] = useState("");

  const activeProvider: AiProviderType =
    (llmProvider as AiProviderType) || llmConfigQ.data?.provider || "gemini";

  const saveLlmMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/companion/ramble", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: activeProvider !== "disabled",
          provider: activeProvider,
          endpoint: llmEndpoint || llmConfigQ.data?.endpoint || "",
          model:
            llmModel ||
            llmConfigQ.data?.model ||
            (activeProvider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"),
          ...(llmKey ? { apiKey: llmKey } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to verify and save AI configuration");
      return json;
    },
    onSuccess: () => {
      toast(
        activeProvider === "disabled"
          ? "AI Magic Chatbar disabled and hidden."
          : "AI connection verified! The fast-access Magic Chatbar is now active.",
      );
      setLlmKey("");
      qc.invalidateQueries({ queryKey: ["llm-config"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  function startEditCurrency(c: { id: string; attributes: Currency }) {
    setEditingCur(c.attributes.code);
    setEditDecimals(String(c.attributes.decimal_places ?? 2));
    setEditSymbol(c.attributes.symbol);
    setEditName(c.attributes.name);
  }

  async function disconnect() {
    await fetch("/api/session", { method: "DELETE" });
    qc.clear();
    router.replace("/login");
  }

  const booleanConfigs = (configQ.data ?? []).filter(
    (item) => typeof item.value === "boolean" && item.editable !== false,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings & Server Configuration"
        subtitle="Manage Firefly III server configuration, currencies & decimal places, exchange rates, and webhooks"
      />

      {/* Connection info */}
      <Card id="connection" className="scroll-mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Server className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">Firefly III Server</h2>
              <p className="text-xs text-muted">{sessionQ.data?.url ?? "Connected"}</p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={disconnect}>
            <LogOut className="size-4" aria-hidden /> Disconnect
          </Button>
        </div>

        <div className="grid gap-3 rounded-xl bg-surface-2 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Signed in as</p>
            <p className="truncate font-medium">{userQ.data?.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Firefly III version</p>
            <p className="font-medium">
              {aboutQ.data ? `v${aboutQ.data.version} (API ${aboutQ.data.api_version})` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Primary currency</p>
            <p className="font-medium">
              {primaryQ.data
                ? `${primaryQ.data.code} (${primaryQ.data.symbol}) · ${primaryQ.data.decimal_places} decimals`
                : "—"}
            </p>
          </div>
        </div>
      </Card>

      {/* Theme */}
      <Card className="flex flex-col gap-3">
        <CardTitle>Color scheme</CardTitle>
        <div role="radiogroup" aria-label="Color scheme" className="grid gap-2 sm:grid-cols-3">
          {(
            [
              {
                key: "system",
                label: `System (${isSystemDark ? "currently dark" : "currently light"})`,
                icon: Monitor,
              },
              { key: "light", label: "Light", icon: Sun },
              { key: "dark", label: "Dark", icon: Moon },
            ] as const
          ).map((opt) => {
            const checked = theme === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setTheme(opt.key)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
                  checked ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2",
                )}
              >
                <opt.icon className="size-4 shrink-0" aria-hidden />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Currencies & Decimal Places Configuration */}
      <Card id="currencies" className="scroll-mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Coins className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">Currencies & Decimal Precision</h2>
            <p className="text-xs text-muted">
              Configure exact decimal places per currency (e.g. 3 decimals for BHD/KWD/OMR, 2 for USD/EUR, 0 for JPY),
              enable/disable currencies, or change your primary currency.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addCurMut.mutate();
          }}
          className="grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-5"
        >
          <Field label="ISO Code">
            {(id) => (
              <Input
                id={id}
                placeholder="BHD"
                maxLength={5}
                value={newCurCode}
                onChange={(e) => setNewCurCode(e.target.value.toUpperCase())}
                required
              />
            )}
          </Field>
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                placeholder="Bahraini Dinar"
                value={newCurName}
                onChange={(e) => setNewCurName(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Symbol">
            {(id) => (
              <Input
                id={id}
                placeholder="BD"
                value={newCurSymbol}
                onChange={(e) => setNewCurSymbol(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Decimal places">
            {(id) => (
              <Select id={id} value={newCurDecimals} onChange={(e) => setNewCurDecimals(e.target.value)}>
                <option value="0">0 (e.g. 100)</option>
                <option value="2">2 (e.g. 10.00)</option>
                <option value="3">3 (e.g. 10.000 — BHD)</option>
                <option value="4">4 (e.g. 10.0000)</option>
                <option value="8">8 (Crypto)</option>
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={addCurMut.isPending} className="w-full">
              <Plus className="size-4" aria-hidden /> Add currency
            </Button>
          </div>
        </form>

        {currenciesQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-border">
            {(currenciesQ.data ?? []).map((c) => {
              const a = c.attributes;
              const isPrimary = a.default === true || a.primary === true || primaryQ.data?.code === a.code;
              const isEditing = editingCur === a.code;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  {isEditing ? (
                    <div className="grid flex-1 gap-2 sm:grid-cols-4">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                      <Input value={editSymbol} onChange={(e) => setEditSymbol(e.target.value)} placeholder="Symbol" />
                      <Select value={editDecimals} onChange={(e) => setEditDecimals(e.target.value)}>
                        <option value="0">0 decimals</option>
                        <option value="2">2 decimals (0.00)</option>
                        <option value="3">3 decimals (0.000)</option>
                        <option value="4">4 decimals (0.0000)</option>
                        <option value="8">8 decimals</option>
                      </Select>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          loading={updateCurMut.isPending}
                          onClick={() =>
                            updateCurMut.mutate({
                              code: a.code,
                              name: editName,
                              symbol: editSymbol,
                              decimal_places: Number(editDecimals),
                            })
                          }
                        >
                          <Check className="size-4" aria-hidden /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingCur(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold">{a.code}</span>
                        <span className="font-medium">{a.name}</span>
                        <Badge tone="neutral">{a.symbol}</Badge>
                        <Badge tone="primary">{a.decimal_places} decimals</Badge>
                        {isPrimary && <Badge tone="success">Primary</Badge>}
                        {a.enabled === false && <Badge tone="warning">Disabled</Badge>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!isPrimary && a.enabled !== false && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => defaultCurMut.mutate(a.code)}
                            title="Set as Primary Currency"
                          >
                            <Star className="size-3.5" aria-hidden /> Make Primary
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleCurMut.mutate({ code: a.code, enabled: a.enabled === false })}
                        >
                          {a.enabled === false ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEditCurrency(c)}
                          aria-label={`Edit ${a.code}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Exchange-rate manager */}
      <Card id="rates" className="scroll-mt-6 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Stored Exchange Rates</h2>
          <p className="text-xs text-muted">
            Cross-currency transfers and foreign expenses automatically use these rates (direct, inverse, or triangulated via{" "}
            {primaryQ.data?.code ?? "your primary currency"}).
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addRateMut.mutate();
          }}
          className="grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-5"
        >
          <Field label="From">
            {(id) => (
              <Select id={id} value={fromCode} onChange={(e) => setFromCode(e.target.value)}>
                {enabledCurrencies.map((c) => (
                  <option key={c.id} value={c.attributes.code}>
                    {c.attributes.code} · {c.attributes.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <Select id={id} value={toCode} onChange={(e) => setToCode(e.target.value)}>
                {enabledCurrencies.map((c) => (
                  <option key={c.id} value={c.attributes.code}>
                    {c.attributes.code} · {c.attributes.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`Rate (1 ${fromCode || "FROM"} = ? ${toCode || "TO"})`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="0.376"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Effective date">
            {(id) => <Input id={id} type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} required />}
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={addRateMut.isPending} className="w-full">
              <Plus className="size-4" aria-hidden /> Save rate
            </Button>
          </div>
        </form>

        <ErrorBox error={ratesQ.error} />

        {ratesQ.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (ratesQ.data?.length ?? 0) === 0 ? (
          <EmptyState title="No exchange rates stored in Firefly III yet">
            Add a rate above or enter a custom rate during a transfer to save it automatically.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {ratesQ.data!.map((r) => {
              const from = r.attributes.from_currency_code ?? r.attributes.from ?? "?";
              const to = r.attributes.to_currency_code ?? r.attributes.to ?? "?";
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">
                      {from} → {to}
                    </Badge>
                    <span className="tabular font-medium">
                      1 {from} = {formatRate(r.attributes.rate)} {to}
                    </span>
                    <span className="text-xs text-muted">· {formatDate(r.attributes.date)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => delRateMut.mutate(r.id)}
                    aria-label={`Delete rate ${from} to ${to}`}
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Firefly III Server Configuration */}
      <Card id="system" className="scroll-mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Sliders className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">Firefly III System Configuration</h2>
            <p className="text-xs text-muted">
              Toggle Firefly III server-level settings directly via <code>/api/v1/configuration</code>.
            </p>
          </div>
        </div>

        <ErrorBox error={configQ.error} />

        {configQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : booleanConfigs.length === 0 ? (
          <p className="text-xs text-muted">No editable boolean configurations exposed by this Firefly III instance.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {booleanConfigs.map((item) => {
              const title = item.title;
              const val = Boolean(item.value);
              const meta = CONFIG_LABELS[title] ?? {
                label: title.replace(/^configuration\./, "").replaceAll("_", " "),
                desc: title,
              };
              return (
                <label
                  key={title}
                  className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-border p-3 hover:bg-surface-2"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{meta.label}</p>
                    <p className="text-xs text-muted">{meta.desc}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={val}
                    disabled={configMut.isPending}
                    onChange={(e) => configMut.mutate({ title, value: e.target.checked })}
                    className="mt-1 size-4 accent-primary"
                  />
                </label>
              );
            })}
          </div>
        )}
      </Card>

      {/* Outgoing Webhooks */}
      <Card id="webhooks" className="scroll-mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <WebhookIcon className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">Webhooks</h2>
            <p className="text-xs text-muted">
              Trigger external automations (n8n, Home Assistant, custom scripts) when transactions are created or updated.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createWhMut.mutate();
          }}
          className="grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-5"
        >
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                placeholder="Notify Telegram / n8n"
                value={whTitle}
                onChange={(e) => setWhTitle(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Target URL">
            {(id) => (
              <Input
                id={id}
                type="url"
                placeholder="https://example.com/webhook"
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Trigger event">
            {(id) => (
              <Select id={id} value={whTrigger} onChange={(e) => setWhTrigger(e.target.value)}>
                <option value="STORE_TRANSACTION">When transaction is created</option>
                <option value="UPDATE_TRANSACTION">When transaction is updated</option>
                <option value="DESTROY_TRANSACTION">When transaction is deleted</option>
              </Select>
            )}
          </Field>
          <Field label="Payload">
            {(id) => (
              <Select id={id} value={whResponse} onChange={(e) => setWhResponse(e.target.value)}>
                <option value="TRANSACTIONS">Transaction details</option>
                <option value="ACCOUNTS">Account details</option>
                <option value="NONE">Empty ping</option>
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={createWhMut.isPending} className="w-full">
              <Plus className="size-4" aria-hidden /> Add webhook
            </Button>
          </div>
        </form>

        {(webhooksQ.data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-border">
            {webhooksQ.data!.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{w.attributes.title}</span>
                    <Badge tone={w.attributes.active ? "success" : "neutral"}>{w.attributes.trigger}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted">{w.attributes.url}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => delWhMut.mutate(w.id)}
                  aria-label={`Delete webhook ${w.attributes.title}`}
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* AI Assistant ("Ramble") Configuration */}
      <Card id="assistant" className="scroll-mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Wand2 className="size-4" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">Magic Assistant (&ldquo;Ramble&rdquo;) &amp; Bottom Chatbar</h2>
              <p className="text-xs text-muted">
                The bottom AI Chatbar stays hidden until configured and verified here. Supports voice, text, and
                receipt attachments.
              </p>
            </div>
          </div>

          {llmConfigQ.data?.enabled && llmConfigQ.data?.verified ? (
            <Badge tone="success">✓ Verified &amp; Chatbar Active ({llmConfigQ.data.provider})</Badge>
          ) : (
            <Badge tone="neutral">Chatbar Hidden (Not Configured)</Badge>
          )}
        </div>

        {activeProvider === "gemini" && (
          <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3.5 text-xs leading-relaxed">
            <p className="font-semibold text-primary">
              Using your Google Account (Google Pro / Google AI Studio):
            </p>
            <p className="mt-1 text-muted">
              Google restricts third-party self-hosted Docker apps from using consumer Google One subscription cookies
              directly, <strong className="text-fg">but your Google Account includes free Gemini 2.5 Flash &amp; Pro access via Google AI Studio</strong>{" "}
              (including multimodal receipt image vision). Sign in with your Google Account to copy your personal key:
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90"
            >
              <span>Sign in with Google Account at AI Studio</span>
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveLlmMut.mutate();
          }}
          className="grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-4"
        >
          <Field label="AI Provider">
            {(id) => (
              <Select
                id={id}
                value={activeProvider}
                onChange={(e) => {
                  const next = e.target.value as AiProviderType;
                  setLlmProvider(next);
                  if (next === "gemini") setLlmModel("gemini-2.5-flash");
                  else if (next === "openai-compatible") setLlmModel("gpt-4o-mini");
                }}
              >
                <option value="gemini">Google Gemini (via Google Account)</option>
                <option value="openai-compatible">OpenAI / Ollama / OpenRouter</option>
                <option value="local-heuristic">Built-in Smart Local Parser (No Key)</option>
                <option value="disabled">Disabled (Hide AI Chatbar)</option>
              </Select>
            )}
          </Field>

          {activeProvider === "gemini" && (
            <>
              <Field label="Gemini Model">
                {(id) => (
                  <Select
                    id={id}
                    value={llmModel || llmConfigQ.data?.model || "gemini-2.5-flash"}
                    onChange={(e) => setLlmModel(e.target.value)}
                  >
                    <option value="gemini-2.5-flash">gemini-2.5-flash (Fast + Vision)</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro (Pro Reasoning + Vision)</option>
                    <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                  </Select>
                )}
              </Field>
              <Field
                label={
                  llmConfigQ.data?.hasApiKey
                    ? "Google AI Studio Key (saved · enter to replace)"
                    : "Google AI Studio Key"
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    placeholder="AIzaSy..."
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}

          {activeProvider === "openai-compatible" && (
            <>
              <Field label="Chat Completions URL">
                {(id) => (
                  <Input
                    id={id}
                    placeholder={llmConfigQ.data?.endpoint || "https://api.openai.com/v1/chat/completions"}
                    value={llmEndpoint}
                    onChange={(e) => setLlmEndpoint(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Model">
                {(id) => (
                  <Input
                    id={id}
                    placeholder={llmConfigQ.data?.model || "gpt-4o-mini"}
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={
                  llmConfigQ.data?.hasApiKey
                    ? "API Key (saved · enter to replace)"
                    : "API Key (optional for Ollama)"
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    placeholder="sk-..."
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}

          {activeProvider === "local-heuristic" && (
            <div className="flex items-center text-xs text-muted sm:col-span-2">
              Uses the built-in offline parser for natural language and voice dictation. Attachments are uploaded to
              Firefly III automatically.
            </div>
          )}

          {activeProvider === "disabled" && (
            <div className="flex items-center text-xs text-muted sm:col-span-2">
              The AI Magic Chatbar will remain completely hidden across the app.
            </div>
          )}

          <div className="flex items-end">
            <Button type="submit" loading={saveLlmMut.isPending} className="w-full">
              {activeProvider === "disabled" ? "Disable & Hide Chatbar" : "Verify & Enable Chatbar"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
