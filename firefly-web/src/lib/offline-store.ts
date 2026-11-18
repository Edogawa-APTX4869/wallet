import type { NewSplit, Resource, TransactionGroup, TransactionSplit } from "@/lib/firefly/types";

export type OfflineOperationKind = "ff-request" | "ff-attachment" | "companion-request";
export type OfflineOperationStatus = "pending" | "syncing" | "failed";

export interface OfflineAttachmentPayload {
  attachableType: "TransactionJournal" | "Budget";
  attachableId: string;
  file: { name: string; type: string; dataUrl: string };
}

export interface OfflineQueueItem {
  id: string;
  tempId?: string;
  createdAt: string;
  kind: OfflineOperationKind;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  label: string;
  body?: unknown;
  attachment?: OfflineAttachmentPayload;
  status: OfflineOperationStatus;
  attempts: number;
  lastError?: string;
}

export interface EnqueueOfflineInput {
  tempId?: string;
  kind: OfflineOperationKind;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  label: string;
  body?: unknown;
  attachment?: OfflineAttachmentPayload;
}

const DB_NAME = "wallet-offline-db";
const DB_VERSION = 1;
const STORE_OUTBOX = "outbox";
const STORE_KV = "kv";
const LS_OUTBOX_KEY = "wallet_offline_outbox_v1";
const LS_HTTP_PREFIX = "wallet_offline_http_v1:";

const EMPTY_OUTBOX: OfflineQueueItem[] = [];
let outboxSnapshot: OfflineQueueItem[] = EMPTY_OUTBOX;
const memoryKv = new Map<string, { data: unknown; cachedAt: string }>();
const listeners = new Set<(items: OfflineQueueItem[]) => void>();
let initPromise: Promise<void> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function emitOutbox(items: OfflineQueueItem[]) {
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  outboxSnapshot = sorted;
  if (hasLocalStorage()) {
    try {
      // Mirror outbox without oversized base64 binary blobs when localStorage quota is tight
      const compact = sorted.map((it) =>
        it.attachment
          ? {
              ...it,
              attachment: {
                ...it.attachment,
                file: { ...it.attachment.file, dataUrl: "" },
              },
            }
          : it,
      );
      localStorage.setItem(LS_OUTBOX_KEY, JSON.stringify(compact));
    } catch {
      /* ignore localStorage quota errors; IndexedDB holds full payload */
    }
  }
  for (const fn of listeners) fn(sorted);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbGetAllOutbox(): Promise<OfflineQueueItem[]> {
  if (!hasIndexedDb()) {
    if (hasLocalStorage()) {
      try {
        const raw = localStorage.getItem(LS_OUTBOX_KEY);
        return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : [];
      } catch {
        return [...outboxSnapshot];
      }
    }
    return [...outboxSnapshot];
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readonly");
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OfflineQueueItem[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutOutboxItem(item: OfflineQueueItem): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    tx.objectStore(STORE_OUTBOX).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDeleteOutboxItem(id: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    tx.objectStore(STORE_OUTBOX).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearOutbox(): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    tx.objectStore(STORE_OUTBOX).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureHydrated(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const items = await idbGetAllOutbox();
        if (items.length > 0 || outboxSnapshot.length === 0) {
          emitOutbox(items);
        }
      } catch {
        if (hasLocalStorage()) {
          try {
            const raw = localStorage.getItem(LS_OUTBOX_KEY);
            if (raw) emitOutbox(JSON.parse(raw) as OfflineQueueItem[]);
          } catch {
            /* ignore */
          }
        }
      }
    })();
  }
  return initPromise;
}

export function getCachedOutboxSnapshot(): OfflineQueueItem[] {
  return outboxSnapshot;
}

export function subscribeOfflineQueue(listener: (items: OfflineQueueItem[]) => void): () => void {
  listeners.add(listener);
  void ensureHydrated();
  return () => {
    listeners.delete(listener);
  };
}

export async function listOfflineQueue(): Promise<OfflineQueueItem[]> {
  await ensureHydrated();
  return [...outboxSnapshot];
}

function makeQueueId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function makeOfflineTempId(prefix = "offline-tx"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

/**
 * Adds a write operation to the durable offline outbox.
 * Coalesces edits or deletes targeting an item that was itself created offline and not yet synced.
 */
export async function enqueueOfflineOperation(
  input: EnqueueOfflineInput,
): Promise<{ item?: OfflineQueueItem; cancelledTempId?: string }> {
  await ensureHydrated();
  const normPath = input.path.replace(/^\/+/, "");

  // Coalesce DELETE on an unsynced temp transaction
  const txTargetMatch = normPath.match(/^transactions\/([^/?#]+)$/);
  if (input.kind === "ff-request" && txTargetMatch) {
    const targetId = decodeURIComponent(txTargetMatch[1]);
    const pendingCreate = outboxSnapshot.find(
      (it) => it.kind === "ff-request" && it.method === "POST" && it.path === "transactions" && it.tempId === targetId,
    );
    if (pendingCreate) {
      if (input.method === "DELETE") {
        const toRemove = outboxSnapshot.filter(
          (it) =>
            it.id === pendingCreate.id ||
            (it.attachment && it.attachment.attachableId === targetId),
        );
        for (const rm of toRemove) {
          await idbDeleteOutboxItem(rm.id);
        }
        emitOutbox(outboxSnapshot.filter((it) => !toRemove.some((rm) => rm.id === it.id)));
        return { cancelledTempId: targetId };
      }
      if (input.method === "PUT") {
        const updated: OfflineQueueItem = {
          ...pendingCreate,
          body: input.body,
          label: input.label,
          status: "pending",
          lastError: undefined,
        };
        await idbPutOutboxItem(updated);
        emitOutbox(outboxSnapshot.map((it) => (it.id === updated.id ? updated : it)));
        return { item: updated };
      }
    }
  }

  // Coalesce repeated companion prefs PUTs on the exact same path
  if (input.kind === "companion-request" && input.method === "PUT") {
    const existingCompanion = outboxSnapshot.find(
      (it) => it.kind === "companion-request" && it.method === "PUT" && it.path === normPath && it.status === "pending",
    );
    if (existingCompanion) {
      const merged: OfflineQueueItem = {
        ...existingCompanion,
        body: input.body,
        label: input.label,
        createdAt: new Date().toISOString(),
        lastError: undefined,
      };
      await idbPutOutboxItem(merged);
      emitOutbox(outboxSnapshot.map((it) => (it.id === merged.id ? merged : it)));
      return { item: merged };
    }
  }

  const item: OfflineQueueItem = {
    id: makeQueueId("oq"),
    tempId: input.tempId,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    method: input.method,
    path: normPath,
    label: input.label,
    body: input.body,
    attachment: input.attachment,
    status: "pending",
    attempts: 0,
  };
  await idbPutOutboxItem(item);
  emitOutbox([...outboxSnapshot, item]);
  return { item };
}

export async function updateOfflineQueueItem(
  id: string,
  patch: Partial<OfflineQueueItem>,
): Promise<OfflineQueueItem | null> {
  await ensureHydrated();
  const existing = outboxSnapshot.find((it) => it.id === id);
  if (!existing) return null;
  const next: OfflineQueueItem = { ...existing, ...patch, id };
  await idbPutOutboxItem(next);
  emitOutbox(outboxSnapshot.map((it) => (it.id === id ? next : it)));
  return next;
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  await ensureHydrated();
  const target = outboxSnapshot.find((it) => it.id === id);
  const relatedIds = new Set([id]);
  if (target?.tempId) {
    for (const it of outboxSnapshot) {
      if (it.attachment?.attachableId === target.tempId) {
        relatedIds.add(it.id);
      }
    }
  }
  for (const rid of relatedIds) {
    await idbDeleteOutboxItem(rid);
  }
  emitOutbox(outboxSnapshot.filter((it) => !relatedIds.has(it.id)));
}

export async function clearOfflineQueue(): Promise<void> {
  await idbClearOutbox();
  emitOutbox([]);
}

/** HTTP GET Response Cache in IndexedDB (+ localStorage/memory fallback). */
export async function getHttpCache<T>(cacheKey: string): Promise<{ data: T; cachedAt: string } | null> {
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      const row = await new Promise<{ key: string; data: T; cachedAt: string } | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_KV, "readonly");
        const req = tx.objectStore(STORE_KV).get(cacheKey);
        req.onsuccess = () => resolve(req.result as { key: string; data: T; cachedAt: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      if (row) return { data: row.data, cachedAt: row.cachedAt };
    } catch {
      /* fallback below */
    }
  }
  const mem = memoryKv.get(cacheKey);
  if (mem) return { data: mem.data as T, cachedAt: mem.cachedAt };
  if (hasLocalStorage()) {
    try {
      const raw = localStorage.getItem(`${LS_HTTP_PREFIX}${cacheKey}`);
      if (raw) return JSON.parse(raw) as { data: T; cachedAt: string };
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function setHttpCache<T>(cacheKey: string, data: T): Promise<void> {
  const cachedAt = new Date().toISOString();
  memoryKv.set(cacheKey, { data, cachedAt });
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KV, "readwrite");
        tx.objectStore(STORE_KV).put({ key: cacheKey, data, cachedAt });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* ignore */
    }
  }
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(`${LS_HTTP_PREFIX}${cacheKey}`, JSON.stringify({ data, cachedAt }));
    } catch {
      /* ignore quota errors */
    }
  }
}

export async function clearOfflineHttpCache(): Promise<void> {
  memoryKv.clear();
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KV, "readwrite");
        tx.objectStore(STORE_KV).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* ignore */
    }
  }
  if (hasLocalStorage()) {
    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_HTTP_PREFIX)) keysToDelete.push(k);
      }
      for (const k of keysToDelete) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/** Synthesizes an optimistic TransactionGroup from a queued POST transactions payload. */
export function buildSyntheticTransactionGroup(
  tempId: string,
  payload: { group_title?: string; transactions?: NewSplit[] },
): Resource<TransactionGroup> & { __offlinePending?: boolean; __offlineQueued?: boolean } {
  const splits = (payload.transactions ?? []).map((s, idx): TransactionSplit => ({
    transaction_journal_id: `${tempId}-j-${idx}`,
    type: s.type,
    date: s.date,
    amount: String(s.amount),
    description: s.description,
    currency_code: s.currency_code ?? "",
    currency_symbol: undefined,
    currency_decimal_places: undefined,
    foreign_amount: s.foreign_amount ?? null,
    foreign_currency_code: s.foreign_currency_code ?? null,
    source_id: s.source_id ?? "",
    source_name: s.source_name ?? (s.source_id ? "Selected account" : "Cash / External"),
    destination_id: s.destination_id ?? "",
    destination_name: s.destination_name ?? (s.destination_id ? "Destination account" : s.description),
    category_name: s.category_name ?? null,
    budget_id: s.budget_id ?? null,
    tags: s.tags ?? [],
    notes: s.notes ?? null,
  }));

  return {
    id: tempId,
    type: "transactions",
    attributes: {
      group_title: payload.group_title ?? null,
      transactions: splits,
    },
    __offlinePending: true,
    __offlineQueued: true,
  };
}

/** Applies pending queued offline transaction creations/edits/deletes on top of cached/fetched groups. */
export function mergePendingTransactionsIntoGroups(
  groups: Array<Resource<TransactionGroup>>,
  queue: OfflineQueueItem[],
): Array<Resource<TransactionGroup> & { __offlinePending?: boolean }> {
  if (!queue.length) return groups;

  const deletedIds = new Set<string>();
  const editedBodies = new Map<string, { group_title?: string; transactions?: Partial<NewSplit>[] }>();
  const createdItems: Array<Resource<TransactionGroup> & { __offlinePending?: boolean }> = [];

  for (const it of queue) {
    if (it.kind !== "ff-request") continue;
    if (it.method === "POST" && it.path === "transactions" && it.tempId) {
      createdItems.push(
        buildSyntheticTransactionGroup(it.tempId, (it.body ?? {}) as { group_title?: string; transactions?: NewSplit[] }),
      );
      continue;
    }
    const m = it.path.match(/^transactions\/([^/?#]+)$/);
    if (!m) continue;
    const id = decodeURIComponent(m[1]);
    if (it.method === "DELETE") {
      deletedIds.add(id);
    } else if (it.method === "PUT") {
      editedBodies.set(id, (it.body ?? {}) as { group_title?: string; transactions?: Partial<NewSplit>[] });
    }
  }

  const adjusted = groups
    .filter((g) => !deletedIds.has(g.id))
    .map((g): Resource<TransactionGroup> & { __offlinePending?: boolean } => {
      const patch = editedBodies.get(g.id);
      if (!patch) return g;
      const mergedSplits = g.attributes.transactions.map((sp, idx) => {
        const p = patch.transactions?.[idx];
        return p ? ({ ...sp, ...p } as TransactionSplit) : sp;
      });
      return {
        ...g,
        attributes: {
          ...g.attributes,
          group_title: patch.group_title ?? g.attributes.group_title,
          transactions: mergedSplits,
        },
        __offlinePending: true,
      };
    });

  // Put newest pending creations first cleanly without duplicates
  const existingIds = new Set(adjusted.map((g) => g.id));
  const pendingToAdd = createdItems.filter((c) => !existingIds.has(c.id)).reverse();
  return [...pendingToAdd, ...adjusted];
}

export function resetOfflineStoreForTests() {
  outboxSnapshot = EMPTY_OUTBOX;
  memoryKv.clear();
  initPromise = null;
}
