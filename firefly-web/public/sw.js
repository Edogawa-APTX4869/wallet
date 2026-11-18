const STATIC_CACHE = "wallet-shell-v2";
const PAGES_CACHE = "wallet-pages-v2";
const DATA_CACHE = "wallet-data-v2";
const KNOWN_CACHES = new Set([STATIC_CACHE, PAGES_CACHE, DATA_CACHE]);

const PRECACHE_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
const WARM_ROUTES = [
  "/",
  "/new",
  "/accounts",
  "/transactions",
  "/budgets",
  "/reports",
  "/categories",
  "/piggy-banks",
  "/rules",
  "/tags",
  "/settings",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_ASSETS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "WARM_CACHE") {
    event.waitUntil(
      caches.open(PAGES_CACHE).then(async (cache) => {
        for (const route of WARM_ROUTES) {
          try {
            const existing = await cache.match(route);
            if (!existing) {
              const res = await fetch(route, { credentials: "same-origin" });
              if (res.ok && !res.redirected) {
                await cache.put(route, res.clone());
              }
            }
          } catch {
            /* ignore warm failure offline */
          }
        }
      }),
    );
  }
  if (data.type === "CLEAR_DATA_CACHE") {
    event.waitUntil(caches.delete(DATA_CACHE).then(() => caches.delete(PAGES_CACHE)));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Wipe cached financial data upon explicit Disconnect
  if (url.pathname === "/api/session" && request.method === "DELETE") {
    event.waitUntil(caches.delete(DATA_CACHE).then(() => caches.delete(PAGES_CACHE)));
    return;
  }

  if (request.method !== "GET") return;

  // 1. Static Next.js chunks & icons: Cache-First
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 2. Read API calls (/api/ff/*, /api/companion/*): Network-First with Data Cache Fallback
  if (url.pathname.startsWith("/api/ff/") || url.pathname.startsWith("/api/companion/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ message: "Offline and no cached data available." }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  // 3. Page navigations & Next.js RSC payloads: Network-First with Pages Cache Fallback
  if (request.mode === "navigate" || request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const finalPath = new URL(res.url || request.url).pathname;
          if (res.ok && !res.redirected && !finalPath.startsWith("/login")) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => {
          const exact = await caches.match(request);
          if (exact) return exact;
          const byPath = await caches.match(url.pathname);
          if (byPath) return byPath;
          const homeShell = await caches.match("/");
          if (homeShell && request.mode === "navigate") return homeShell;
          return new Response("Offline", { status: 503, statusText: "Offline" });
        }),
    );
  }
});
