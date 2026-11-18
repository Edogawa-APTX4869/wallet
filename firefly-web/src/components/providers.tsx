"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { FireflyError } from "@/lib/firefly/api";
import { OFFLINE_SYNCED_EVENT, startOfflineSyncMonitor } from "@/lib/offline-sync";
import { isNativeStandalone } from "@/lib/native-wallet";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { CapacitorBridge } from "@/components/capacitor-bridge";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: "always",
            refetchOnWindowFocus: true,
            retry: (count, err) =>
              !(err instanceof FireflyError && (err.status === 0 || err.status < 500)) && count < 2,
          },
          mutations: {
            networkMode: "always",
          },
        },
      }),
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Register service worker for web/PWA offline shell/data cache + warm routes when online.
  // Standalone Capacitor APK already bundles static assets inside the APK itself.
  useEffect(() => {
    if (isNativeStandalone()) return;
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          const worker = reg.active || navigator.serviceWorker.controller;
          if (worker && navigator.onLine) {
            worker.postMessage({ type: "WARM_CACHE" });
          }
        })
        .catch(() => {});
    }
  }, []);

  // Start offline queue monitor, auto-validate auth on reconnect & refresh queries after sync.
  useEffect(() => {
    const stopMonitor = startOfflineSyncMonitor();
    const onSynced = (ev: Event) => {
      const detail = (ev as CustomEvent<{ synced?: number }>).detail;
      const n = detail?.synced ?? 0;
      if (n > 0) {
        push(`Synced ${n} offline change${n === 1 ? "" : "s"}`, "success");
        void client.invalidateQueries();
      }
    };
    window.addEventListener(OFFLINE_SYNCED_EVENT, onSynced);
    return () => {
      stopMonitor();
      window.removeEventListener(OFFLINE_SYNCED_EVENT, onSynced);
    };
  }, [client, push]);

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <CapacitorBridge />
        <ToastCtx.Provider value={push}>
          {children}
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "fade-in pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
                  t.tone === "success" && "bg-success text-white",
                  t.tone === "error" && "bg-danger text-white",
                  t.tone === "info" && "bg-fg text-bg",
                )}
              >
                {t.message}
              </div>
            ))}
          </div>
        </ToastCtx.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
