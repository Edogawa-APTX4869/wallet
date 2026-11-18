"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Fingerprint, KeyRound, LogOut, ShieldCheck, Wallet } from "lucide-react";
import {
  disconnectWalletSession,
  getWalletSessionStatus,
  isNativeStandalone,
  subscribeNativeLockChanges,
  subscribeWalletSession,
  verifyNativeBiometric,
  type WalletSessionStatus,
} from "@/lib/native-wallet";
import { resetAllOfflineData, syncOfflineQueue } from "@/lib/offline-sync";
import { AppShell } from "@/components/app-shell";
import { Button, ErrorBox } from "@/components/ui";

export function AppAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<WalletSessionStatus | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const promptAttemptedForLockRef = useRef(false);
  const isPromptingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const next = await getWalletSessionStatus();
    setStatus(next);
    if (!next.connected) {
      router.replace("/login");
    }
    if (!next.biometricLocked) {
      promptAttemptedForLockRef.current = false;
      setLockError(null);
    }
    return next;
  }, [router]);

  const handleUnlock = useCallback(async () => {
    if (isPromptingRef.current) return;
    isPromptingRef.current = true;
    setUnlocking(true);
    setLockError(null);
    try {
      const res = await verifyNativeBiometric({
        title: "Unlock Wallet",
        subtitle: "Verify with your Samsung fingerprint or screen lock",
      });
      if (res.verified) {
        promptAttemptedForLockRef.current = false;
        await refreshStatus();
        void syncOfflineQueue();
      } else {
        setLockError(
          res.lockout
            ? "Too many biometric attempts. Unlock using your device PIN/pattern or try again shortly."
            : res.cancelled
              ? "Fingerprint verification cancelled. Tap below to unlock Wallet."
              : res.message || "Fingerprint verification failed. Please try again.",
        );
      }
    } finally {
      isPromptingRef.current = false;
      setUnlocking(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    let active = true;
    const triggerRefresh = () => {
      void getWalletSessionStatus().then((next) => {
        if (!active) return;
        setStatus(next);
        if (!next.connected) {
          router.replace("/login");
        }
        if (!next.biometricLocked) {
          promptAttemptedForLockRef.current = false;
          setLockError(null);
        }
      });
    };

    triggerRefresh();

    const unsubSession = subscribeWalletSession(triggerRefresh);

    let unsubNativeLock = () => {};
    let unsubAppState: { remove: () => Promise<void> } | null = null;

    if (isNativeStandalone()) {
      void subscribeNativeLockChanges((ev) => {
        if (ev.locked) {
          promptAttemptedForLockRef.current = false;
        }
        triggerRefresh();
      }).then((fn) => {
        if (active) unsubNativeLock = fn;
        else fn();
      });

      if (Capacitor.isNativePlatform()) {
        void App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            triggerRefresh();
          }
        }).then((handle) => {
          if (active) unsubAppState = handle;
          else void handle.remove().catch(() => {});
        });
      }
    }

    return () => {
      active = false;
      unsubSession();
      unsubNativeLock();
      if (unsubAppState) {
        void unsubAppState.remove().catch(() => {});
      }
    };
  }, [router]);

  // Auto-trigger Samsung BiometricPrompt once whenever app enters locked state
  useEffect(() => {
    if (status?.connected && status.biometricLocked && !promptAttemptedForLockRef.current) {
      promptAttemptedForLockRef.current = true;
      const timer = window.setTimeout(() => {
        void handleUnlock();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [status, handleUnlock]);

  async function handleSignOut() {
    await resetAllOfflineData();
    await disconnectWalletSession();
    router.replace("/login");
  }

  if (!status || !status.connected) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-lg animate-pulse">
            <Wallet className="size-7" aria-hidden />
          </div>
          <p className="text-sm font-medium text-muted">Loading Wallet…</p>
        </div>
      </div>
    );
  }

  if (status.biometricLocked) {
    const cleanHost = (status.url ?? "").replace(/^https?:\/\//, "");
    return (
      <div
        data-testid="biometric-lock-screen"
        className="flex min-h-dvh items-center justify-center bg-bg p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-xl">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="relative flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-lg">
              <Fingerprint className="size-8" aria-hidden />
              <span className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-success text-white">
                <ShieldCheck className="size-3.5" aria-hidden />
              </span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-fg">Wallet Locked</h1>
              <p className="mt-1 text-xs text-muted">
                Verify with your fingerprint or screen lock to open{" "}
                {cleanHost ? <span className="font-medium text-fg">{cleanHost}</span> : "Wallet"}.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <ErrorBox error={lockError} />

            <Button
              type="button"
              size="lg"
              loading={unlocking}
              onClick={() => void handleUnlock()}
              className="w-full"
            >
              {status.biometryType === "device_credential" ? (
                <>
                  <KeyRound className="size-4" aria-hidden /> Unlock with Screen Lock
                </>
              ) : (
                <>
                  <Fingerprint className="size-4" aria-hidden /> Unlock with Fingerprint
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleSignOut()}
              className="text-muted hover:text-danger"
            >
              <LogOut className="size-4" aria-hidden /> Disconnect &amp; Change Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <AppShell serverUrl={status.url ?? ""}>{children}</AppShell>;
}
