import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/firefly/api";
import type { Resource, TransactionGroup } from "@/lib/firefly/types";
import {
  clearOfflineHttpCache,
  clearOfflineQueue,
  listOfflineQueue,
  mergePendingTransactionsIntoGroups,
  resetOfflineStoreForTests,
} from "@/lib/offline-store";
import {
  companionFetch,
  getOfflineSyncSnapshot,
  OFFLINE_SYNCED_EVENT,
  resetSyncStateForTests,
  syncOfflineQueue,
  validateServerAuthentication,
} from "@/lib/offline-sync";
import { OfflineStatusBanner } from "@/components/offline-status-banner";

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: value },
  });
}

describe("Offline Mode, Auth Validation & Ordered FIFO Sync", () => {
  beforeEach(async () => {
    resetOfflineStoreForTests();
    resetSyncStateForTests();
    await clearOfflineQueue();
    await clearOfflineHttpCache();
    setNavigatorOnline(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setNavigatorOnline(true);
  });

  it("caches GET responses online and serves cached data seamlessly while offline", async () => {
    const accountsPayload = {
      data: [
        {
          id: "1",
          type: "accounts",
          attributes: { name: "ila White", type: "asset", currency_code: "BHD", current_balance: "120.000" },
        },
      ],
      meta: { pagination: { current_page: 1, total_pages: 1 } },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(accountsPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // 1. Online fetch caches accounts
    const liveAccounts = await api.accounts("all");
    expect(liveAccounts).toHaveLength(1);
    expect(liveAccounts[0].attributes.name).toBe("ila White");

    // 2. Device goes offline — read succeeds from IndexedDB / KV cache without calling network
    setNavigatorOnline(false);
    fetchMock.mockClear();
    const cachedAccounts = await api.accounts("all");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cachedAccounts).toHaveLength(1);
    expect(cachedAccounts[0].attributes.name).toBe("ila White");
  });

  it("queues transactions + attachments offline, coalesces edits/deletes on pending items, and merges into UI lists", async () => {
    setNavigatorOnline(false);

    // 1. Create expense offline
    const created = await api.createTransaction([
      {
        type: "withdrawal",
        date: "2026-11-18T12:10:00+03:00",
        amount: "14.500",
        currency_code: "BHD",
        description: "Coffee & Pastry",
        source_id: "1",
        category_name: "Food",
      },
    ]);
    const tempGroup = created.data;
    expect(tempGroup.id).toMatch(/^offline-tx-/);
    expect((created as unknown as { __offlineQueued?: boolean }).__offlineQueued).toBe(true);

    // 2. Attach receipt to that pending temp transaction
    const attId = await api.uploadTransactionAttachment(tempGroup.id, {
      name: "receipt.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(attId).toMatch(/^offline-att-/);

    let queue = await listOfflineQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe("ff-request");
    expect(queue[0].label).toContain("Expense: 14.500 BHD");
    expect(queue[1].kind).toBe("ff-attachment");
    expect(queue[1].attachment?.attachableId).toBe(tempGroup.id);

    // 3. Edit that unsynced offline transaction (coalesces cleanly into the same creation item)
    await api.updateTransaction(tempGroup.id, [
      {
        type: "withdrawal",
        date: "2026-11-18T12:10:00+03:00",
        amount: "18.000",
        currency_code: "BHD",
        description: "Lunch & Coffee",
        source_id: "1",
      },
    ]);
    queue = await listOfflineQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].label).toContain("18.000 BHD");

    // 4. Merge pending queue with cached server transactions
    const serverGroups: Resource<TransactionGroup>[] = [
      {
        id: "99",
        type: "transactions",
        attributes: {
          transactions: [
            {
              transaction_journal_id: "990",
              type: "withdrawal",
              date: "2026-11-17T10:00:00+03:00",
              amount: "5.000",
              description: "Old Server Item",
              currency_code: "BHD",
              source_id: "1",
              source_name: "ila White",
              destination_id: "2",
              destination_name: "Shop",
            },
          ],
        },
      },
    ];
    const merged = mergePendingTransactionsIntoGroups(serverGroups, queue);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe(tempGroup.id);
    expect(merged[0].__offlinePending).toBe(true);
    expect(merged[0].attributes.transactions[0].amount).toBe("18.000");

    // 5. Delete that unsynced offline transaction -> cancels BOTH creation and attachment
    await api.deleteTransaction(tempGroup.id);
    expect(await listOfflineQueue()).toHaveLength(0);
  });

  it("queues writes even if navigator.onLine is true when upstream server returns 502 or network fails", async () => {
    setNavigatorOnline(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const budgetRes = await api.upsertBudgetLimit({
      budgetId: "7",
      amount: "50.000",
      start: "2026-11-01",
      end: "2026-11-30",
      currency_code: "BHD",
    });
    expect((budgetRes as unknown as { __offlineQueued?: boolean }).__offlineQueued).toBe(true);

    const companionRes = await companionFetch("/api/companion/dashboard", {
      method: "PUT",
      body: { selectedAccountIds: ["1", "2"] },
      label: "Update dashboard accounts",
    });
    expect(companionRes.__offlineQueued).toBe(true);

    const queue = await listOfflineQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe("ff-request");
    expect(queue[1].kind).toBe("companion-request");
    expect(getOfflineSyncSnapshot().isOnline).toBe(false);
  });

  it("validates authentication before syncing on reconnect and pauses cleanly without dropping queued items on 401", async () => {
    // Queue a transaction while offline
    setNavigatorOnline(false);
    await api.createTransaction([
      {
        type: "deposit",
        date: "2026-11-18T12:15:00+03:00",
        amount: "500.000",
        currency_code: "BHD",
        description: "Bonus",
        destination_id: "1",
      },
    ]);
    expect(await listOfflineQueue()).toHaveLength(1);

    // Reconnect online, but Firefly III rejects the token (401) during auth validation
    setNavigatorOnline(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/session") {
        return new Response(JSON.stringify({ connected: true, url: "https://ff.test" }), { status: 200 });
      }
      if (url === "/api/ff/about/user") {
        return new Response(JSON.stringify({ message: "Unauthenticated" }), { status: 401 });
      }
      throw new Error(`Unexpected replay call before auth passes: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncOfflineQueue();
    expect(result.authRequired).toBe(true);
    expect(result.synced).toBe(0);
    expect(getOfflineSyncSnapshot().syncPhase).toBe("auth_required");
    expect(getOfflineSyncSnapshot().authValid).toBe(false);

    // Queue MUST remain intact!
    expect(await listOfflineQueue()).toHaveLength(1);
  });

  it("verifies auth and replays queued transaction + dependent attachment FIFO with real ID substitution", async () => {
    setNavigatorOnline(false);
    const created = await api.createTransaction([
      {
        type: "withdrawal",
        date: "2026-11-18T12:20:00+03:00",
        amount: "22.000",
        currency_code: "BHD",
        description: "Grocery Run",
        source_id: "1",
      },
    ]);
    await api.uploadTransactionAttachment(created.data.id, {
      name: "bill.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(await listOfflineQueue()).toHaveLength(2);

    // Reconnect with valid auth
    setNavigatorOnline(true);
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const bodyStr = typeof init?.body === "string" ? init.body : undefined;
        calls.push({ url, method, body: bodyStr });

        if (url === "/api/session") {
          return new Response(JSON.stringify({ connected: true, url: "https://ff.test" }), { status: 200 });
        }
        if (url === "/api/ff/about/user") {
          return new Response(JSON.stringify({ data: { attributes: { email: "user@example.com" } } }), {
            status: 200,
          });
        }
        if (url === "/api/ff/transactions" && method === "POST") {
          return new Response(
            JSON.stringify({
              data: {
                id: "777",
                type: "transactions",
                attributes: { transactions: [{ transaction_journal_id: "8888" }] },
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/ff/attachments" && method === "POST") {
          return new Response(JSON.stringify({ data: { id: "att-99" } }), { status: 200 });
        }
        if (url === "/api/ff/attachments/att-99/upload" && method === "POST") {
          return new Response(null, { status: 204 });
        }
        return new Response("Not Found", { status: 404 });
      }),
    );

    const authCheck = await validateServerAuthentication();
    expect(authCheck.ok).toBe(true);

    // Simultaneous trigger test: singleton lock ensures only one FIFO pass executes
    const [syncA, syncB] = await Promise.all([syncOfflineQueue(), syncOfflineQueue()]);
    expect(syncA).toBe(syncB);
    expect(syncA.synced).toBe(2);
    expect(syncA.failed).toBe(0);
    expect(syncA.authRequired).toBe(false);
    expect(await listOfflineQueue()).toHaveLength(0);

    // Verify FIFO order & tempId substitution (`8888` journal ID used in attachment metadata)
    const txPostIdx = calls.findIndex((c) => c.url === "/api/ff/transactions" && c.method === "POST");
    const attPostIdx = calls.findIndex((c) => c.url === "/api/ff/attachments" && c.method === "POST");
    const attUploadIdx = calls.findIndex((c) => c.url === "/api/ff/attachments/att-99/upload");
    expect(txPostIdx).toBeGreaterThan(-1);
    expect(attPostIdx).toBeGreaterThan(txPostIdx);
    expect(attUploadIdx).toBeGreaterThan(attPostIdx);
    expect(JSON.parse(calls[attPostIdx].body!).attachable_id).toBe("8888");
  });

  it("keeps banner invisible when online & synced, and configures SW & React Query networkMode='always'", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(OfflineStatusBanner, { serverUrl: "https://ff.test" }),
      ),
    );
    expect(html).toBe("");

    const swSrc = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    const providersSrc = readFileSync(path.resolve(__dirname, "../components/providers.tsx"), "utf8");
    expect(swSrc).toContain("wallet-data-v2");
    expect(swSrc).toContain("wallet-pages-v2");
    expect(swSrc).toContain("WARM_CACHE");
    expect(swSrc).toContain("url.pathname === \"/api/session\" && request.method === \"DELETE\"");
    expect(providersSrc).toContain('networkMode: "always"');
    expect(providersSrc).toContain("startOfflineSyncMonitor");
    expect(providersSrc).toContain("OFFLINE_SYNCED_EVENT");
    expect(OFFLINE_SYNCED_EVENT).toBe("wallet:offline-synced");
  });
});
