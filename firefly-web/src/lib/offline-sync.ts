import { useSyncExternalStore } from "react";
import {
  clearOfflineHttpCache,
  clearOfflineQueue,
  enqueueOfflineOperation,
  getCachedOutboxSnapshot,
  getHttpCache,
  listOfflineQueue,
  removeOfflineQueueItem,
  setHttpCache,
  subscribeOfflineQueue,
  updateOfflineQueueItem,
  type OfflineQueueItem,
} from "@/lib/offline-store";

export type OfflineSyncPhase = "idle" | "validating_auth" | "syncing" | "auth_required" | "error";

export interface OfflineSyncState {
  isOnline: boolean;
  reachabilityConfirmed: boolean;
  syncPhase: OfflineSyncPhase;
  authValid: boolean | null;
  lastSyncedAt: string | null;
  lastSyncSummary: string | null;
  lastError: string | null;
  queue: OfflineQueueItem[];
}

export interface AuthValidationResult {
  ok: boolean;
  reason?: "unreachable" | "session_missing" | "token_invalid";
  message?: string;
}

export interface SyncRunResult {
  synced: number;
  failed: number;
  authRequired: boolean;
  offline: boolean;
}

export const OFFLINE_SYNCED_EVENT = "wallet:offline-synced";

const SERVER_SNAPSHOT: OfflineSyncState = {
  isOnline: true,
  reachabilityConfirmed: true,
  syncPhase: "idle",
  authValid: null,
  lastSyncedAt: null,
  lastSyncSummary: null,
  lastError: null,
  queue: [],
};

let clientState: OfflineSyncState = {
  ...SERVER_SNAPSHOT,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
};

const stateListeners = new Set<() => void>();
let inFlightSync: Promise<SyncRunResult> | null = null;
let monitorInstalled = false;

function notifyState() {
  for (const l of stateListeners) l();
}

function patchState(patch: Partial<OfflineSyncState>) {
  clientState = {
    ...clientState,
    ...patch,
    queue: patch.queue ?? clientState.queue,
  };
  notifyState();
}

export function getOfflineSyncSnapshot(): OfflineSyncState {
  return clientState;
}

function getServerOfflineSyncSnapshot(): OfflineSyncState {
  return SERVER_SNAPSHOT;
}

function subscribeOfflineSync(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function useOfflineSync(): OfflineSyncState {
  return useSyncExternalStore(
    subscribeOfflineSync,
    getOfflineSyncSnapshot,
    getServerOfflineSyncSnapshot,
  );
}

/** Detects browser offline status or transient network/gateway unreachable errors. */
export function isNetworkOrGatewayFailure(errOrStatus: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (typeof errOrStatus === "number") {
    return errOrStatus === 502 || errOrStatus === 503 || errOrStatus === 504;
  }
  if (errOrStatus instanceof TypeError) return true;
  if (errOrStatus instanceof Error) {
    if (errOrStatus.name === "AbortError" || errOrStatus.name === "TypeError") return true;
    const msg = errOrStatus.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed") ||
      msg.includes("load failed") ||
      msg.includes("could not reach") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout")
    );
  }
  return false;
}

export function markNetworkOffline(reason?: string) {
  patchState({
    isOnline: false,
    reachabilityConfirmed: false,
    ...(reason ? { lastError: reason } : {}),
  });
}

export function markNetworkOnline() {
  patchState({
    isOnline: true,
    reachabilityConfirmed: true,
    lastError: clientState.syncPhase === "auth_required" ? clientState.lastError : null,
  });
}

/**
 * Explicitly validates BOTH companion session cookie (`/api/session`)
 * and upstream Firefly III token validity (`/api/ff/about/user`) before syncing offline changes.
 */
export async function validateServerAuthentication(): Promise<AuthValidationResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, reason: "unreachable", message: "Device is offline." };
  }
  try {
    const sessRes = await fetch("/api/session", { cache: "no-store" });
    if (isNetworkOrGatewayFailure(sessRes.status)) {
      return { ok: false, reason: "unreachable", message: `Server unavailable (HTTP ${sessRes.status}).` };
    }
    if (!sessRes.ok) {
      return {
        ok: false,
        reason: "session_missing",
        message: "Your session has expired. Please re-authenticate to sync pending changes.",
      };
    }
    const sessJson = (await sessRes.json()) as { connected?: boolean };
    if (!sessJson?.connected) {
      return {
        ok: false,
        reason: "session_missing",
        message: "Not connected to Firefly III. Sign in to validate authentication and sync.",
      };
    }

    const userRes = await fetch("/api/ff/about/user", { cache: "no-store" });
    if (isNetworkOrGatewayFailure(userRes.status)) {
      return { ok: false, reason: "unreachable", message: "Firefly III server is temporarily unreachable." };
    }
    if (userRes.status === 401 || userRes.status === 403) {
      return {
        ok: false,
        reason: "token_invalid",
        message: "Authentication rejected (HTTP 401). Please update your Firefly III token to sync.",
      };
    }
    if (!userRes.ok) {
      return { ok: false, reason: "unreachable", message: `Auth check returned HTTP ${userRes.status}.` };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "unreachable", message: "Could not reach server to validate authentication." };
  }
}

async function replayAttachmentItem(
  item: OfflineQueueItem,
  resolvedIds: Map<string, string>,
): Promise<{ status: number; ok: boolean; errorMessage?: string }> {
  const att = item.attachment;
  if (!att) return { status: 400, ok: false, errorMessage: "Missing attachment payload." };
  const targetId =
    resolvedIds.get(`${att.attachableId}:journal`) ??
    resolvedIds.get(att.attachableId) ??
    att.attachableId;

  const createRes = await fetch("/api/ff/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: att.file.name,
      attachable_type: att.attachableType,
      attachable_id: String(targetId),
      title: att.file.name,
      notes: "Uploaded via FireFly Companion",
    }),
    cache: "no-store",
  });
  if (!createRes.ok) {
    let msg = `Attachment metadata failed (HTTP ${createRes.status})`;
    try {
      const errJson = (await createRes.json()) as { message?: string };
      if (errJson?.message) msg = errJson.message;
    } catch {
      /* ignore */
    }
    return { status: createRes.status, ok: false, errorMessage: msg };
  }
  const createdJson = (await createRes.json()) as { data?: { id?: string } };
  const attachmentId = createdJson?.data?.id;
  if (!attachmentId) return { status: 500, ok: false, errorMessage: "Attachment ID missing." };

  const base64Part = att.file.dataUrl.includes(",") ? att.file.dataUrl.split(",")[1] : att.file.dataUrl;
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const uploadRes = await fetch(`/api/ff/attachments/${encodeURIComponent(attachmentId)}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
    cache: "no-store",
  });
  if (!uploadRes.ok) {
    return {
      status: uploadRes.status,
      ok: false,
      errorMessage: `Attachment binary upload failed (HTTP ${uploadRes.status})`,
    };
  }
  return { status: uploadRes.status, ok: true };
}

function resolvePathIds(rawPath: string, resolvedIds: Map<string, string>): string {
  return rawPath.replace(/offline-[a-z0-9-]+/gi, (match) => resolvedIds.get(match) ?? match);
}

/**
 * Validates authentication first, then replays all queued offline mutations strictly in FIFO order.
 * Guarded by an in-flight singleton lock so reconnect bursts cannot duplicate transactions.
 */
export function syncOfflineQueue(opts: { validateOnlyWhenEmpty?: boolean } = {}): Promise<SyncRunResult> {
  if (inFlightSync) return inFlightSync;

  inFlightSync = (async (): Promise<SyncRunResult> => {
    const queue = await listOfflineQueue();
    patchState({ queue });

    if (queue.length === 0) {
      if (opts.validateOnlyWhenEmpty) {
        const auth = await validateServerAuthentication();
        if (auth.ok) {
          patchState({ isOnline: true, reachabilityConfirmed: true, authValid: true, syncPhase: "idle", lastError: null });
        } else if (auth.reason === "unreachable") {
          patchState({ isOnline: false, reachabilityConfirmed: false, syncPhase: "idle" });
        } else {
          patchState({ isOnline: true, authValid: false, syncPhase: "auth_required", lastError: auth.message ?? null });
        }
      }
      return { synced: 0, failed: 0, authRequired: false, offline: !clientState.isOnline };
    }

    patchState({ syncPhase: "validating_auth", lastError: null });
    const auth = await validateServerAuthentication();
    if (!auth.ok) {
      if (auth.reason === "unreachable") {
        patchState({
          isOnline: false,
          reachabilityConfirmed: false,
          syncPhase: "idle",
        });
        return { synced: 0, failed: 0, authRequired: false, offline: true };
      }
      patchState({
        isOnline: true,
        reachabilityConfirmed: true,
        authValid: false,
        syncPhase: "auth_required",
        lastError: auth.message ?? "Authentication required before syncing.",
      });
      return { synced: 0, failed: 0, authRequired: true, offline: false };
    }

    patchState({
      isOnline: true,
      reachabilityConfirmed: true,
      authValid: true,
      syncPhase: "syncing",
      lastError: null,
    });

    const resolvedIds = new Map<string, string>();
    const blockedTempIds = new Set<string>();
    let synced = 0;
    let failed = 0;

    for (const item of queue) {
      const targetTempId = item.attachment?.attachableId;
      if (targetTempId && blockedTempIds.has(targetTempId)) {
        failed++;
        continue;
      }

      await updateOfflineQueueItem(item.id, { status: "syncing", lastError: undefined });

      try {
        if (item.kind === "ff-attachment") {
          const attResult = await replayAttachmentItem(item, resolvedIds);
          if (attResult.ok) {
            await removeOfflineQueueItem(item.id);
            synced++;
            continue;
          }
          if (isNetworkOrGatewayFailure(attResult.status)) {
            await updateOfflineQueueItem(item.id, { status: "pending" });
            patchState({ isOnline: false, reachabilityConfirmed: false, syncPhase: "idle" });
            return { synced, failed, authRequired: false, offline: true };
          }
          if (attResult.status === 401 || attResult.status === 403) {
            await updateOfflineQueueItem(item.id, { status: "pending" });
            patchState({
              authValid: false,
              syncPhase: "auth_required",
              lastError: "Session expired while uploading attachments. Please reconnect to finish syncing.",
            });
            return { synced, failed, authRequired: true, offline: false };
          }
          await updateOfflineQueueItem(item.id, {
            status: "failed",
            attempts: item.attempts + 1,
            lastError: attResult.errorMessage ?? `HTTP ${attResult.status}`,
          });
          failed++;
          continue;
        }

        const resolvedPath = resolvePathIds(item.path, resolvedIds);
        const url =
          item.kind === "companion-request"
            ? resolvedPath.startsWith("/")
              ? resolvedPath
              : `/api/companion/${resolvedPath}`
            : `/api/ff/${resolvedPath}`;

        const res = await fetch(url, {
          method: item.method,
          headers: item.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
          cache: "no-store",
        });

        if (isNetworkOrGatewayFailure(res.status)) {
          await updateOfflineQueueItem(item.id, { status: "pending" });
          patchState({ isOnline: false, reachabilityConfirmed: false, syncPhase: "idle" });
          return { synced, failed, authRequired: false, offline: true };
        }

        if (res.status === 401 || res.status === 403) {
          await updateOfflineQueueItem(item.id, { status: "pending" });
          patchState({
            authValid: false,
            syncPhase: "auth_required",
            lastError: "Authentication failed during sync (401). Please re-verify your token.",
          });
          return { synced, failed, authRequired: true, offline: false };
        }

        const text = await res.text();
        let json: Record<string, unknown> | null = null;
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
          /* non-JSON */
        }

        if (!res.ok) {
          const msg =
            (json?.message as string | undefined) ||
            (json?.error as string | undefined) ||
            `Request failed (HTTP ${res.status})`;
          if (item.tempId) blockedTempIds.add(item.tempId);
          await updateOfflineQueueItem(item.id, {
            status: "failed",
            attempts: item.attempts + 1,
            lastError: msg,
          });
          failed++;
          continue;
        }

        if (item.tempId && json?.data && typeof json.data === "object") {
          const dataObj = json.data as {
            id?: string | number;
            attributes?: { transactions?: Array<{ transaction_journal_id?: string | number }> };
          };
          if (dataObj.id !== undefined) {
            resolvedIds.set(item.tempId, String(dataObj.id));
            const jid = dataObj.attributes?.transactions?.[0]?.transaction_journal_id;
            resolvedIds.set(`${item.tempId}:journal`, String(jid ?? dataObj.id));
          }
        }

        await removeOfflineQueueItem(item.id);
        synced++;
      } catch (e) {
        if (isNetworkOrGatewayFailure(e)) {
          await updateOfflineQueueItem(item.id, { status: "pending" });
          patchState({ isOnline: false, reachabilityConfirmed: false, syncPhase: "idle" });
          return { synced, failed, authRequired: false, offline: true };
        }
        if (item.tempId) blockedTempIds.add(item.tempId);
        await updateOfflineQueueItem(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: (e as Error).message || "Sync failed",
        });
        failed++;
      }
    }

    const remaining = await listOfflineQueue();
    const nowIso = new Date().toISOString();
    patchState({
      queue: remaining,
      syncPhase: failed > 0 ? "error" : "idle",
      lastSyncedAt: synced > 0 ? nowIso : clientState.lastSyncedAt,
      lastSyncSummary: synced > 0 ? `Synced ${synced} offline change${synced === 1 ? "" : "s"}` : clientState.lastSyncSummary,
      lastError: failed > 0 ? `${failed} item${failed === 1 ? "" : "s"} need attention.` : null,
    });

    if (synced > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OFFLINE_SYNCED_EVENT, { detail: { synced, failed } }));
    }

    return { synced, failed, authRequired: false, offline: false };
  })().finally(() => {
    inFlightSync = null;
  });

  return inFlightSync;
}

/**
 * Installs global online/offline + visibility listeners once on client startup
 * so returning connectivity triggers automatic auth validation + FIFO sync.
 */
export function startOfflineSyncMonitor(): () => void {
  if (typeof window === "undefined") return () => {};
  const unsubOutbox = subscribeOfflineQueue((items) => {
    patchState({ queue: items });
  });

  if (monitorInstalled) return unsubOutbox;
  monitorInstalled = true;

  // Initialize queue snapshot immediately
  void listOfflineQueue().then((items) => {
    patchState({ queue: items });
    if (items.length > 0 && navigator.onLine !== false) {
      void syncOfflineQueue();
    }
  });

  const handleOnline = () => {
    markNetworkOnline();
    void syncOfflineQueue({ validateOnlyWhenEmpty: false });
  };
  const handleOffline = () => {
    markNetworkOffline();
  };
  const handleVisibilityOrFocus = () => {
    if (document.visibilityState === "hidden") return;
    if (navigator.onLine === false) {
      markNetworkOffline();
      return;
    }
    if (getCachedOutboxSnapshot().length > 0) {
      markNetworkOnline();
      void syncOfflineQueue();
    }
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("focus", handleVisibilityOrFocus);
  document.addEventListener("visibilitychange", handleVisibilityOrFocus);

  return () => {
    unsubOutbox();
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("focus", handleVisibilityOrFocus);
    document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    monitorInstalled = false;
  };
}

/**
 * Companion API helper with offline GET fallback cache and offline PUT/POST/DELETE queueing
 * (dashboard prefs, resource icon metadata, transaction templates).
 */
export async function companionFetch<T = unknown>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    label?: string;
    cacheKey?: string;
  } = {},
): Promise<T & { __offlineQueued?: boolean }> {
  const method = options.method ?? "GET";
  const url = path.startsWith("/api/") ? path : `/api/companion/${path.replace(/^\/+/, "")}`;
  const cacheKey = options.cacheKey ?? `companion:${url}`;

  const queueMutation = async (): Promise<T & { __offlineQueued?: boolean }> => {
    const cleanPath = url.replace(/^\/api\/companion\//, "");
    await enqueueOfflineOperation({
      kind: "companion-request",
      method: method as "POST" | "PUT" | "DELETE",
      path: cleanPath,
      label: options.label ?? `Companion update (${cleanPath.split("?")[0]})`,
      body: options.body,
    });
    if (method === "PUT" && options.body && cacheKey) {
      // Optimistically update local GET cache for immediate offline continuity
      const prev = await getHttpCache<{ data?: Record<string, unknown> }>(cacheKey);
      if (prev?.data) {
        const merged =
          cleanPath === "dashboard" && typeof prev.data.data === "object" && prev.data.data
            ? { ...prev.data, data: { ...prev.data.data, ...(options.body as Record<string, unknown>) } }
            : { ...prev.data, data: options.body };
        await setHttpCache(cacheKey, merged);
      }
    }
    return { data: options.body ?? null, __offlineQueued: true } as unknown as T & { __offlineQueued?: boolean };
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (method === "GET") {
      const cached = await getHttpCache<T>(cacheKey);
      if (cached) return cached.data as T & { __offlineQueued?: boolean };
      throw new Error("Offline and no cached data available.");
    }
    return queueMutation();
  }

  try {
    const res = await fetch(url, {
      method,
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
    if (isNetworkOrGatewayFailure(res.status)) {
      markNetworkOffline();
      if (method === "GET") {
        const cached = await getHttpCache<T>(cacheKey);
        if (cached) return cached.data as T & { __offlineQueued?: boolean };
      } else {
        return queueMutation();
      }
    }
    const json = (await res.json()) as T;
    if (res.ok && method === "GET") {
      markNetworkOnline();
      await setHttpCache(cacheKey, json);
    }
    if (!res.ok) {
      const msg = (json as { error?: string; message?: string })?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json as T & { __offlineQueued?: boolean };
  } catch (err) {
    if (isNetworkOrGatewayFailure(err)) {
      markNetworkOffline();
      if (method === "GET") {
        const cached = await getHttpCache<T>(cacheKey);
        if (cached) return cached.data as T & { __offlineQueued?: boolean };
      } else {
        return queueMutation();
      }
    }
    throw err;
  }
}

/** Clears all offline cached data and outbox entries (used on explicit Disconnect / logout). */
export async function resetAllOfflineData(): Promise<void> {
  await clearOfflineQueue();
  await clearOfflineHttpCache();
  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.includes("wallet-data")).map((k) => caches.delete(k)));
    } catch {
      /* ignore */
    }
  }
  patchState({
    queue: [],
    syncPhase: "idle",
    authValid: null,
    lastSyncedAt: null,
    lastSyncSummary: null,
    lastError: null,
  });
}

export function resetSyncStateForTests() {
  clientState = { ...SERVER_SNAPSHOT };
  inFlightSync = null;
}
