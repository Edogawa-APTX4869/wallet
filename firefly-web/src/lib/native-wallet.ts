import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getHttpCache, setHttpCache } from "@/lib/offline-store";
import {
  DEFAULT_DASHBOARD_PREFS,
  sanitizeCards,
  type DashboardPreferences,
} from "@/lib/dashboard-cards";
import {
  generateSmartReply,
  parseWithSmartHeuristics,
  type AiProviderType,
  type AttachmentPayload,
  type SmartParseContext,
} from "@/lib/ai-ramble-parser";
import { validatePublicFireflyUrl } from "@/lib/firefly/url-validation";
import type { TransactionTemplateRow } from "@/lib/server/db";

export interface WalletSessionStatus {
  connected: boolean;
  url: string | null;
  authMode: "standalone" | "server";
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  biometryType: string;
  biometricLocked: boolean;
  sessionUnlocked?: boolean;
}

export interface NativeHttpResponse {
  status: number;
  ok: boolean;
  body: string;
  contentType: string;
  networkError?: boolean;
  message?: string;
}

export interface BiometricCheckResult {
  available: boolean;
  biometryType: string;
  statusCode: number;
  biometricEnabled: boolean;
}

export interface BiometricAuthResult {
  verified: boolean;
  cancelled?: boolean;
  lockout?: boolean;
  biometricUnavailable?: boolean;
  errorCode?: number;
  message?: string;
}

export interface WalletNativePlugin {
  getSessionStatus(): Promise<WalletSessionStatus>;
  saveCredentials(options: { url: string; token: string }): Promise<{ saved: boolean; url: string }>;
  clearCredentials(): Promise<{ cleared: boolean }>;
  setBiometricEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  lockApp(): Promise<{ locked: boolean }>;
  suppressNextBackgroundLock(options?: { durationMs?: number }): Promise<{ ok: boolean }>;
  checkBiometric(): Promise<BiometricCheckResult>;
  readClipboard?(): Promise<{ text: string; message?: string }>;
  authenticateBiometric(options?: {
    title?: string;
    subtitle?: string;
    description?: string;
    negativeButtonText?: string;
  }): Promise<BiometricAuthResult>;
  ffRequest(options: {
    method: string;
    path: string;
    query?: string;
    bodyJson?: string;
    bodyBase64?: string;
    contentType?: string;
    overrideUrl?: string;
    overrideToken?: string;
  }): Promise<NativeHttpResponse>;
  addListener(
    eventName: "lockStateChanged",
    listenerFunc: (event: { locked: boolean; connected: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

const WalletNative = registerPlugin<WalletNativePlugin>("WalletNative");

const SESSION_LISTENERS = new Set<() => void>();
let testPluginOverride: Partial<WalletNativePlugin> | null = null;
let testStandaloneOverride: boolean | null = null;

export function subscribeWalletSession(listener: () => void): () => void {
  SESSION_LISTENERS.add(listener);
  return () => {
    SESSION_LISTENERS.delete(listener);
  };
}

export function notifyWalletSessionChanged(): void {
  for (const fn of SESSION_LISTENERS) fn();
}

export function _setNativeWalletForTests(opts: {
  standalone?: boolean | null;
  plugin?: Partial<WalletNativePlugin> | null;
}): void {
  testStandaloneOverride = opts.standalone ?? null;
  testPluginOverride = opts.plugin ?? null;
}

function plugin(): WalletNativePlugin {
  if (testPluginOverride) {
    return testPluginOverride as WalletNativePlugin;
  }
  return WalletNative;
}

/**
 * Returns true when running as the self-contained Capacitor Android/iOS APK
 * bundling the static app locally (without needing a companion Next.js container).
 */
export function isNativeStandalone(): boolean {
  if (testStandaloneOverride !== null) return testStandaloneOverride;
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform()) return false;
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "file:"
  );
}

/** Builds an account detail route compatible with both Web SSR and static Capacitor APK exports. */
export function accountHref(id?: string | null): string {
  const safeId = encodeURIComponent(id ?? "");
  if (isNativeStandalone()) {
    return `/accounts/detail/?id=${safeId}`;
  }
  return `/accounts/${safeId}`;
}

export function normalizeServerUrl(raw: string): string {
  let trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  trimmed = trimmed.replace(/^(https?):\/?([^/])/i, "$1://$2");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  trimmed = trimmed.replace(/\/(profile(\/oauth)?|api(\/v1)?|login)\/?$/i, "");
  return trimmed.replace(/\/+$/, "");
}

/**
 * Normalizes a Firefly III Personal Access Token (OAuth2 JWT) by stripping any
 * accidental leading `"Bearer "` prefix or line-wrap/clipboard whitespace.
 */
export function normalizePersonalAccessToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\r\n\t\s]+/g, "");
}

/**
 * Reads plain text from the system clipboard (using native Android ClipboardManager
 * inside the Capacitor APK, falling back to browser `navigator.clipboard.readText`).
 */
export async function readNativeClipboardText(): Promise<string> {
  if (isNativeStandalone() && typeof plugin().readClipboard === "function") {
    try {
      const res = await plugin().readClipboard!();
      if (res?.text) return res.text;
    } catch {
      /* fall through to navigator.clipboard */
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }
  return "";
}

export async function nativeFireflyRequest(options: {
  method: string;
  path: string;
  query?: string;
  bodyJson?: string;
  bodyBase64?: string;
  contentType?: string;
  overrideUrl?: string;
  overrideToken?: string;
}): Promise<NativeHttpResponse> {
  return plugin().ffRequest(options);
}

/**
 * Shared transport for Firefly III REST calls:
 * - Standalone Capacitor APK: sends direct authenticated request natively via Android plugin.
 * - Web / Docker Server: sends request through `/api/ff/...` proxy with httpOnly session cookie.
 */
export async function executeFireflyHttp(options: {
  method: string;
  fullPath: string;
  bodyJson?: string;
  bodyBase64?: string;
  contentType?: string;
}): Promise<{ status: number; ok: boolean; text: string; networkError: boolean; message?: string }> {
  const cleanFull = options.fullPath.replace(/^\/+/, "");
  if (isNativeStandalone()) {
    const qIdx = cleanFull.indexOf("?");
    const ffPath = qIdx >= 0 ? cleanFull.slice(0, qIdx) : cleanFull;
    const query = qIdx >= 0 ? cleanFull.slice(qIdx) : "";
    try {
      const res = await nativeFireflyRequest({
        method: options.method,
        path: ffPath,
        query,
        bodyJson: options.bodyJson,
        bodyBase64: options.bodyBase64,
        contentType: options.contentType,
      });
      return {
        status: res.status,
        ok: Boolean(res.ok),
        text: res.body ?? "",
        networkError: Boolean(res.networkError || res.status === 0),
        message: res.message,
      };
    } catch (err) {
      return {
        status: 0,
        ok: false,
        text: "",
        networkError: true,
        message: (err as Error).message,
      };
    }
  }

  let body: BodyInit | undefined;
  let headers: Record<string, string> | undefined;
  if (options.bodyBase64 !== undefined) {
    const binaryStr = atob(options.bodyBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    body = bytes;
    headers = { "Content-Type": options.contentType ?? "application/octet-stream" };
  } else if (options.bodyJson !== undefined) {
    body = options.bodyJson;
    headers = { "Content-Type": options.contentType ?? "application/json" };
  }

  const res = await fetch(`/api/ff/${cleanFull}`, {
    method: options.method,
    headers,
    body,
    cache: "no-store",
  });
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    text,
    networkError: false,
  };
}

export async function nativeTestFireflyConnection(
  rawUrl: string,
  rawToken: string,
): Promise<{ url: string; about: unknown; user: unknown }> {
  const token = normalizePersonalAccessToken(rawToken);
  if (!rawUrl.trim() || !token) {
    throw new Error("Server URL and token are required.");
  }
  const url = validatePublicFireflyUrl(rawUrl);

  const [aboutRes, userRes] = await Promise.all([
    nativeFireflyRequest({
      method: "GET",
      path: "about",
      overrideUrl: url,
      overrideToken: token,
    }),
    nativeFireflyRequest({
      method: "GET",
      path: "about/user",
      overrideUrl: url,
      overrideToken: token,
    }),
  ]);

  if (aboutRes.networkError || aboutRes.status === 0) {
    throw new Error(`Could not reach ${url}: ${aboutRes.message || "Network error"}`);
  }
  if (aboutRes.status === 401 || userRes.status === 401) {
    throw new Error("Firefly III rejected the token (401).");
  }
  if (!aboutRes.ok) {
    throw new Error(`Firefly III responded with HTTP ${aboutRes.status}. Is this the right URL?`);
  }

  let about: unknown = null;
  let user: unknown = null;
  try {
    about = aboutRes.body ? JSON.parse(aboutRes.body) : null;
  } catch {
    throw new Error(
      "Server returned a webpage instead of Firefly III API JSON. Verify the URL and Personal Access Token.",
    );
  }
  try {
    user = userRes.ok && userRes.body ? JSON.parse(userRes.body) : null;
  } catch {
    user = null;
  }
  return { url, about, user };
}

export async function getWalletSessionStatus(): Promise<WalletSessionStatus> {
  if (isNativeStandalone()) {
    try {
      return await plugin().getSessionStatus();
    } catch {
      return {
        connected: false,
        url: null,
        authMode: "standalone",
        biometricEnabled: false,
        biometricAvailable: false,
        biometryType: "none",
        biometricLocked: false,
      };
    }
  }

  const res = await fetch("/api/session", { cache: "no-store" });
  if (!res.ok) {
    return {
      connected: false,
      url: null,
      authMode: "server",
      biometricEnabled: false,
      biometricAvailable: false,
      biometryType: "none",
      biometricLocked: false,
    };
  }
  const json = (await res.json()) as {
    connected?: boolean;
    url?: string | null;
  };
  return {
    connected: Boolean(json.connected),
    url: json.url ?? null,
    authMode: "server",
    biometricEnabled: false,
    biometricAvailable: false,
    biometryType: "none",
    biometricLocked: false,
  };
}

export async function checkNativeBiometric(): Promise<BiometricCheckResult> {
  if (!isNativeStandalone()) {
    return { available: false, biometryType: "none", statusCode: -1, biometricEnabled: false };
  }
  try {
    return await plugin().checkBiometric();
  } catch {
    return { available: false, biometryType: "none", statusCode: -1, biometricEnabled: false };
  }
}

export async function verifyNativeBiometric(options?: {
  title?: string;
  subtitle?: string;
  description?: string;
}): Promise<BiometricAuthResult> {
  if (!isNativeStandalone()) {
    return { verified: true };
  }
  try {
    const res = await plugin().authenticateBiometric(options);
    if (res.verified) {
      notifyWalletSessionChanged();
    }
    return res;
  } catch (e) {
    return {
      verified: false,
      message: (e as Error).message || "Biometric verification failed.",
    };
  }
}

export async function setNativeBiometricEnabled(enabled: boolean): Promise<boolean> {
  if (!isNativeStandalone()) return false;
  const res = await plugin().setBiometricEnabled({ enabled });
  notifyWalletSessionChanged();
  return res.enabled;
}

export async function lockNativeApp(): Promise<void> {
  if (!isNativeStandalone()) return;
  await plugin().lockApp();
  notifyWalletSessionChanged();
}

export async function suppressNativeAutoLock(durationMs = 90_000): Promise<void> {
  if (!isNativeStandalone()) return;
  try {
    await plugin().suppressNextBackgroundLock({ durationMs });
  } catch {
    /* ignore */
  }
}

export async function subscribeNativeLockChanges(
  handler: (event: { locked: boolean; connected: boolean }) => void,
): Promise<() => void> {
  if (!isNativeStandalone() || typeof plugin().addListener !== "function") {
    return () => {};
  }
  const handle = await plugin().addListener("lockStateChanged", handler);
  return () => {
    void handle.remove().catch(() => {});
  };
}

export async function connectWalletSession(options: {
  url: string;
  token: string;
  enableBiometric?: boolean;
}): Promise<{ connected: boolean; url: string }> {
  const cleanUrl = validatePublicFireflyUrl(options.url);
  const cleanToken = normalizePersonalAccessToken(options.token);
  if (isNativeStandalone()) {
    const verifiedConn = await nativeTestFireflyConnection(cleanUrl, cleanToken);
    const bioCheck = await checkNativeBiometric();
    const shouldUseBiometric = options.enableBiometric !== false && bioCheck.available;

    if (shouldUseBiometric) {
      const bioRes = await verifyNativeBiometric({
        title: "Verify Fingerprint",
        subtitle: "Confirm your Samsung fingerprint or screen lock to log in to Wallet",
      });
      if (!bioRes.verified && !bioRes.biometricUnavailable) {
        throw new Error(
          bioRes.cancelled
            ? "Fingerprint verification is required to complete login."
            : bioRes.message || "Fingerprint verification failed.",
        );
      }
    }

    await plugin().setBiometricEnabled({ enabled: options.enableBiometric !== false });
    await plugin().saveCredentials({ url: verifiedConn.url, token: cleanToken });
    notifyWalletSessionChanged();
    return { connected: true, url: verifiedConn.url };
  }

  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: cleanUrl, token: cleanToken }),
  });
  const json = (await res.json()) as { message?: string; url?: string };
  if (!res.ok) {
    throw new Error(json.message ?? "Could not connect.");
  }
  notifyWalletSessionChanged();
  return { connected: true, url: json.url ?? cleanUrl };
}

export async function reauthenticateWalletSession(options: {
  url: string;
  token: string;
}): Promise<{ connected: boolean; url: string }> {
  const cleanUrl = validatePublicFireflyUrl(options.url);
  const cleanToken = normalizePersonalAccessToken(options.token);
  if (isNativeStandalone()) {
    const verifiedConn = await nativeTestFireflyConnection(cleanUrl, cleanToken);
    await plugin().saveCredentials({ url: verifiedConn.url, token: cleanToken });
    notifyWalletSessionChanged();
    return { connected: true, url: verifiedConn.url };
  }

  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: cleanUrl, token: cleanToken }),
  });
  const json = (await res.json()) as { message?: string; url?: string };
  if (!res.ok) {
    throw new Error(json.message ?? "Authentication failed.");
  }
  notifyWalletSessionChanged();
  return { connected: true, url: json.url ?? cleanUrl };
}

export async function disconnectWalletSession(): Promise<void> {
  if (isNativeStandalone()) {
    try {
      await plugin().clearCredentials();
    } catch {
      /* ignore */
    }
    notifyWalletSessionChanged();
    return;
  }
  await fetch("/api/session", { method: "DELETE" });
  notifyWalletSessionChanged();
}

// ---------- Local Standalone Companion Store (Android on-device persistence) ----------

interface LocalMetaRow {
  entity_type: string;
  entity_id: string;
  icon: string;
  color: string;
  hidden: boolean;
  is_todo: boolean;
  extra: Record<string, unknown>;
}

interface LocalLlmConfig {
  enabled: boolean;
  provider: AiProviderType;
  endpoint: string;
  model: string;
  apiKey: string;
  verified: boolean;
  verifiedAt: string | null;
}

const LOCAL_COMPANION_PREFIX = "local-companion:";
const GEMINI_OPENAI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

async function readLocalStore<T>(key: string, fallback: T): Promise<T> {
  const fullKey = `${LOCAL_COMPANION_PREFIX}${key}`;
  const cached = await getHttpCache<T>(fullKey);
  if (cached && cached.data !== undefined && cached.data !== null) {
    return cached.data;
  }
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

async function writeLocalStore<T>(key: string, value: T): Promise<void> {
  const fullKey = `${LOCAL_COMPANION_PREFIX}${key}`;
  await setHttpCache(fullKey, value);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      /* ignore quota */
    }
  }
}

export async function clearLocalCompanionData(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LOCAL_COMPANION_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export async function localCompanionRequest<T = unknown>(
  rawUrl: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const [pathname, searchStr = ""] = rawUrl.split("?");
  const params = new URLSearchParams(searchStr);

  if (pathname === "/api/companion/dashboard") {
    const saved = await readLocalStore<DashboardPreferences>("dashboard", DEFAULT_DASHBOARD_PREFS);
    const current: DashboardPreferences = {
      selectedAccountIds: Array.isArray(saved.selectedAccountIds)
        ? saved.selectedAccountIds.map(String)
        : [],
      cards: Array.isArray(saved.cards) ? sanitizeCards(saved.cards) : DEFAULT_DASHBOARD_PREFS.cards,
      categoryOrder: Array.isArray(saved.categoryOrder)
        ? saved.categoryOrder.map(String)
        : undefined,
    };
    if (method === "GET") {
      return { data: current } as unknown as T;
    }
    const patch = (body ?? {}) as Partial<DashboardPreferences>;
    const next: DashboardPreferences = {
      selectedAccountIds: Array.isArray(patch.selectedAccountIds)
        ? patch.selectedAccountIds.map(String)
        : current.selectedAccountIds,
      cards: Array.isArray(patch.cards) ? sanitizeCards(patch.cards) : current.cards,
      categoryOrder: Array.isArray(patch.categoryOrder)
        ? patch.categoryOrder.map(String)
        : current.categoryOrder,
    };
    await writeLocalStore("dashboard", next);
    return { data: next } as unknown as T;
  }

  if (pathname === "/api/companion/meta") {
    const list = await readLocalStore<LocalMetaRow[]>("meta", []);
    if (method === "GET") {
      const typeFilter = params.get("entity_type");
      const filtered = typeFilter ? list.filter((m) => m.entity_type === typeFilter) : list;
      return { data: filtered } as unknown as T;
    }
    const payload = (body ?? {}) as Partial<LocalMetaRow>;
    const entity_type = String(payload.entity_type || "");
    const entity_id = String(payload.entity_id || "");
    if (!entity_type || !entity_id) {
      throw new Error("entity_type and entity_id are required");
    }
    const next = [...list];
    const idx = next.findIndex((m) => m.entity_type === entity_type && m.entity_id === entity_id);
    const updated: LocalMetaRow = {
      entity_type,
      entity_id,
      icon: payload.icon ?? (idx >= 0 ? next[idx].icon : ""),
      color: payload.color ?? (idx >= 0 ? next[idx].color : ""),
      hidden: payload.hidden ?? (idx >= 0 ? next[idx].hidden : false),
      is_todo: payload.is_todo ?? (idx >= 0 ? next[idx].is_todo : false),
      extra: payload.extra ?? (idx >= 0 ? next[idx].extra : {}),
    };
    if (idx >= 0) next[idx] = updated;
    else next.push(updated);
    await writeLocalStore("meta", next);
    return { data: updated } as unknown as T;
  }

  if (pathname === "/api/companion/templates") {
    const list = await readLocalStore<TransactionTemplateRow[]>("templates", []);
    if (method === "GET") {
      return { data: list } as unknown as T;
    }
    if (method === "DELETE") {
      const id = params.get("id");
      const next = id ? list.filter((t) => t.id !== id) : list;
      await writeLocalStore("templates", next);
      return { deleted: Boolean(id) } as unknown as T;
    }
    const input = (body ?? {}) as Partial<TransactionTemplateRow>;
    const row: TransactionTemplateRow = {
      id: input.id || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(input.name || "Template"),
      icon: String(input.icon || "Sparkles"),
      color: String(input.color || "#6366f1"),
      type: input.type || "withdrawal",
      amount: String(input.amount || ""),
      currency_code: String(input.currency_code || ""),
      foreign_amount: String(input.foreign_amount || ""),
      foreign_currency_code: String(input.foreign_currency_code || ""),
      source_id: String(input.source_id || ""),
      source_name: String(input.source_name || ""),
      destination_id: String(input.destination_id || ""),
      destination_name: String(input.destination_name || ""),
      description: String(input.description || ""),
      category_name: String(input.category_name || ""),
      budget_id: String(input.budget_id || ""),
      tags: String(input.tags || ""),
      notes: String(input.notes || ""),
      sort_order: Number(input.sort_order ?? list.length),
    };
    const next = [...list.filter((t) => t.id !== row.id), row];
    await writeLocalStore("templates", next);
    return { data: row } as unknown as T;
  }

  if (pathname === "/api/companion/ramble") {
    const saved = await readLocalStore<LocalLlmConfig>("ramble_cfg", {
      enabled: false,
      provider: "disabled",
      endpoint: "",
      model: "gemini-2.5-flash",
      apiKey: "",
      verified: false,
      verifiedAt: null,
    });

    if (method === "GET") {
      return {
        data: {
          enabled: saved.enabled,
          provider: saved.provider,
          endpoint: saved.endpoint,
          model: saved.model,
          hasApiKey: Boolean(saved.apiKey),
          verified: saved.verified,
          verifiedAt: saved.verifiedAt,
        },
      } as unknown as T;
    }

    if (method === "PUT") {
      const patch = (body ?? {}) as Partial<LocalLlmConfig>;
      const provider: AiProviderType = patch.provider ?? saved.provider;
      if (provider === "disabled") {
        const disabled: LocalLlmConfig = {
          ...saved,
          enabled: false,
          provider: "disabled",
          verified: false,
          verifiedAt: null,
        };
        await writeLocalStore("ramble_cfg", disabled);
        return {
          data: {
            enabled: false,
            provider: "disabled",
            endpoint: disabled.endpoint,
            model: disabled.model,
            hasApiKey: Boolean(disabled.apiKey),
            verified: false,
            verifiedAt: null,
          },
        } as unknown as T;
      }

      const model =
        (patch.model ?? saved.model).trim() ||
        (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
      const endpoint =
        provider === "gemini"
          ? GEMINI_OPENAI_ENDPOINT
          : (patch.endpoint ?? saved.endpoint).trim();
      const apiKey = patch.apiKey !== undefined ? patch.apiKey.trim() : saved.apiKey;

      if (provider !== "local-heuristic" && !apiKey) {
        throw new Error("Please enter an API key.");
      }
      if (provider === "openai-compatible" && !endpoint) {
        throw new Error("Please enter an OpenAI-compatible endpoint URL.");
      }

      const nextCfg: LocalLlmConfig = {
        enabled: true,
        provider,
        endpoint,
        model,
        apiKey,
        verified: true,
        verifiedAt: new Date().toISOString(),
      };
      await writeLocalStore("ramble_cfg", nextCfg);
      return {
        data: {
          enabled: true,
          provider: nextCfg.provider,
          endpoint: nextCfg.endpoint,
          model: nextCfg.model,
          hasApiKey: Boolean(nextCfg.apiKey),
          verified: true,
          verifiedAt: nextCfg.verifiedAt,
        },
      } as unknown as T;
    }

    if (method === "POST") {
      const payload = (body ?? {}) as Partial<SmartParseContext> & {
        text?: string;
        attachments?: AttachmentPayload[];
      };
      const text = (payload.text ?? "").trim();
      const ctx: SmartParseContext = {
        text,
        today: payload.today ?? new Date().toISOString().slice(0, 10),
        defaultCurrency: payload.defaultCurrency ?? "USD",
        defaultAccount: payload.defaultAccount ?? "",
        accounts: payload.accounts ?? [],
        categories: payload.categories ?? [],
        budgets: payload.budgets ?? [],
        tags: payload.tags ?? [],
        accountDetails: payload.accountDetails,
        budgetDetails: payload.budgetDetails,
        piggyDetails: payload.piggyDetails,
        billDetails: payload.billDetails,
      };
      const drafts = text ? parseWithSmartHeuristics(ctx) : [];
      const reply = text
        ? generateSmartReply(ctx, drafts)
        : `Attached ${payload.attachments?.length ?? 0} receipt file(s).`;
      return {
        data: drafts,
        reply,
        engine: "local-heuristic",
      } as unknown as T;
    }
  }

  throw new Error(`Unsupported local companion route: ${pathname}`);
}
