"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fingerprint, ShieldCheck, Wallet } from "lucide-react";
import {
  checkNativeBiometric,
  connectWalletSession,
  getWalletSessionStatus,
  isNativeStandalone,
} from "@/lib/native-wallet";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

export function LoginForm({ defaultUrl = "" }: { defaultUrl?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [urlValue, setUrlValue] = useState(defaultUrl);
  const [tokenValue, setTokenValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isNative = useSyncExternalStore(
    () => () => {},
    isNativeStandalone,
    () => false,
  );
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string>("fingerprint");
  const [enableBiometric, setEnableBiometric] = useState(true);

  useEffect(() => {
    let active = true;
    void getWalletSessionStatus().then((st) => {
      if (!active) return;
      setUrlValue((prev) => prev || st.defaultUrl || st.url || "");
      if (isNative) {
        setEnableBiometric(st.biometricEnabled ?? true);
      }
    });

    if (isNative) {
      void checkNativeBiometric().then((bio) => {
        if (!active) return;
        setBiometricAvailable(bio.available);
        setBiometryType(bio.biometryType || "fingerprint");
      });
    }
    return () => {
      active = false;
    };
  }, [isNative]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await connectWalletSession({
        url: urlValue,
        token: tokenValue,
        enableBiometric: isNative ? enableBiometric : false,
      });
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-lg">
            <Wallet className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Connect to Wallet</h1>
          <p className="text-sm text-muted">
            {isNative
              ? "Standalone mode — connects directly to Firefly III with Android Keystore encryption & biometric verification."
              : "Your token is kept encrypted on the server and never stored in the browser."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
          {params.get("expired") && (
            <ErrorBox error="Your session expired or the token was revoked. Please reconnect." />
          )}

          <Field label="Firefly III URL" hint="e.g. https://firefly.example.com">
            {(id) => (
              <Input
                id={id}
                name="url"
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                autoCapitalize="none"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://firefly.example.com"
                enterKeyHint="next"
                required
              />
            )}
          </Field>

          <Field
            label="Personal Access Token"
            hint={<>Create one in Firefly III → Options → Profile → OAuth → Personal Access Tokens.</>}
          >
            {(id) => (
              <Input
                id={id}
                name="token"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                value={tokenValue}
                onChange={(e) => setTokenValue(e.target.value)}
                enterKeyHint="done"
                required
              />
            )}
          </Field>

          {isNative && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2/60 p-3 text-left">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                {biometricAvailable ? (
                  <Fingerprint className="size-4" aria-hidden />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-fg">
                  Biometric Fingerprint Verification
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {biometricAvailable
                    ? `Verify with ${biometryType === "device_credential" ? "device screen lock" : "fingerprint / biometrics"} on login and whenever Wallet opens.`
                    : "Enroll a fingerprint or screen lock in Android Settings to enable biometric verification."}
                </p>
              </div>
              <input
                type="checkbox"
                checked={biometricAvailable ? enableBiometric : false}
                disabled={!biometricAvailable}
                onChange={(e) => setEnableBiometric(e.target.checked)}
                aria-label="Enable biometric fingerprint verification"
                className="mt-1 size-4 shrink-0 accent-primary"
              />
            </label>
          )}

          <ErrorBox error={error} />

          <Button type="submit" size="lg" loading={loading}>
            {isNative && biometricAvailable && enableBiometric ? (
              <>
                <Fingerprint className="size-4" aria-hidden /> Verify &amp; Connect
              </>
            ) : (
              "Connect"
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
