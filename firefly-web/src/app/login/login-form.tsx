"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ClipboardPaste, Eye, EyeOff, Fingerprint, ShieldCheck, Wallet, X } from "lucide-react";
import {
  checkNativeBiometric,
  connectWalletSession,
  getWalletSessionStatus,
  isNativeStandalone,
  normalizePersonalAccessToken,
  normalizeServerUrl,
  readNativeClipboardText,
} from "@/lib/native-wallet";
import { validatePublicFireflyUrl } from "@/lib/firefly/url-validation";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [urlValue, setUrlValue] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const latestUrlRef = useRef<string>("");
  const latestTokenRef = useRef<string>("");
  const userClearedTokenRef = useRef<boolean>(false);

  const isNative = useSyncExternalStore(
    () => () => {},
    isNativeStandalone,
    () => false,
  );
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string>("fingerprint");
  const [enableBiometric, setEnableBiometric] = useState(true);

  const syncUrl = (val: string) => {
    latestUrlRef.current = val;
    setUrlValue(val);
  };

  const syncToken = (val: string, allowEmpty = false) => {
    const cleaned = val;
    if (cleaned.trim().length > 0) {
      userClearedTokenRef.current = false;
      latestTokenRef.current = cleaned;
      setTokenValue(cleaned);
    } else if (allowEmpty) {
      userClearedTokenRef.current = true;
      latestTokenRef.current = "";
      setTokenValue("");
    }
  };

  useEffect(() => {
    let active = true;
    if (isNative) {
      void getWalletSessionStatus().then((st) => {
        if (!active) return;
        setEnableBiometric(st.biometricEnabled ?? true);
      });

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

  // Poll live DOM values while inputs exist so Android Samsung Keyboard Clipboard / IME commits
  // are captured immediately even if the IME does not dispatch synthetic React onChange events
  // or attempts to clear the field buffer on blur.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const urlEl = urlInputRef.current;
      if (urlEl && urlEl.value && urlEl.value !== latestUrlRef.current) {
        latestUrlRef.current = urlEl.value;
        setUrlValue(urlEl.value);
      }
      const tokEl = tokenInputRef.current;
      if (tokEl) {
        if (tokEl.value && tokEl.value !== latestTokenRef.current) {
          userClearedTokenRef.current = false;
          latestTokenRef.current = tokEl.value;
          setTokenValue(tokEl.value);
        } else if (!tokEl.value && latestTokenRef.current && !userClearedTokenRef.current) {
          // Restore DOM value if Android IME cleared the buffer on focus change
          tokEl.value = latestTokenRef.current;
        }
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  function snapshotLiveDomInputs() {
    const domUrl = urlInputRef.current?.value;
    if (domUrl && domUrl.trim()) {
      latestUrlRef.current = domUrl;
      setUrlValue(domUrl);
    }
    const domTok = tokenInputRef.current?.value;
    if (domTok && domTok.trim()) {
      userClearedTokenRef.current = false;
      latestTokenRef.current = domTok;
      setTokenValue(domTok);
    }
  }

  async function handlePasteToken() {
    setError(null);
    const clip = await readNativeClipboardText();
    const cleaned = normalizePersonalAccessToken(clip);
    if (!cleaned) {
      setError("Clipboard is empty or permission was denied. Long-press the token field to paste.");
      tokenInputRef.current?.focus();
      return;
    }
    userClearedTokenRef.current = false;
    latestTokenRef.current = cleaned;
    setTokenValue(cleaned);
    if (tokenInputRef.current) {
      tokenInputRef.current.value = cleaned;
    }
  }

  function handleClearToken() {
    userClearedTokenRef.current = true;
    latestTokenRef.current = "";
    setTokenValue("");
    if (tokenInputRef.current) {
      tokenInputRef.current.value = "";
      tokenInputRef.current.focus();
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    snapshotLiveDomInputs();
    const formData = new FormData(e.currentTarget);
    const rawUrl =
      urlInputRef.current?.value?.trim() ||
      latestUrlRef.current?.trim() ||
      urlValue.trim() ||
      String(formData.get("url") ?? "").trim();
    const rawToken =
      tokenInputRef.current?.value?.trim() ||
      latestTokenRef.current?.trim() ||
      tokenValue.trim() ||
      String(formData.get("token") ?? "").trim();

    const finalToken = normalizePersonalAccessToken(rawToken);

    if (!rawUrl || !finalToken) {
      setError("Server URL and token are required.");
      return;
    }

    let finalUrl: string;
    try {
      finalUrl = validatePublicFireflyUrl(rawUrl);
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await connectWalletSession({
        url: finalUrl,
        token: finalToken,
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

  const normalizedTokenLen = normalizePersonalAccessToken(tokenValue).length;

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

        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6"
        >
          {params.get("expired") && (
            <ErrorBox error="Your session expired or the token was revoked. Please reconnect." />
          )}

          <Field label="Firefly III URL" hint="e.g. https://firefly.example.com">
            {(id) => (
              <Input
                ref={urlInputRef}
                id={id}
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                autoCorrect="off"
                spellCheck={false}
                autoCapitalize="none"
                value={urlValue}
                onChange={(e) => syncUrl(e.target.value)}
                onInput={(e) => syncUrl((e.target as HTMLInputElement).value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData("text");
                  if (pasted) {
                    e.preventDefault();
                    const clean = normalizeServerUrl(pasted);
                    syncUrl(clean);
                    if (urlInputRef.current) urlInputRef.current.value = clean;
                  }
                }}
                onBlur={(e) => {
                  const val = e.currentTarget.value.trim();
                  if (val) {
                    const clean = normalizeServerUrl(val);
                    syncUrl(clean);
                    e.currentTarget.value = clean;
                  }
                }}
                placeholder="https://firefly.example.com"
                enterKeyHint="next"
              />
            )}
          </Field>

          <Field
            label="Personal Access Token"
            hint={
              normalizedTokenLen > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-success">
                  <Check className="size-3.5" aria-hidden /> Token ready ({normalizedTokenLen} chars)
                </span>
              ) : (
                <>Create one in Firefly III → Options → Profile → OAuth → Personal Access Tokens.</>
              )
            }
          >
            {(id) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface pr-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
                  <input
                    ref={tokenInputRef}
                    id={id}
                    name="token"
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={tokenValue}
                    style={
                      !showToken
                        ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
                        : undefined
                    }
                    onChange={(e) => {
                      const next = e.target.value;
                      syncToken(next, next.length === 0);
                    }}
                    onInput={(e) => {
                      const next = (e.target as HTMLInputElement).value;
                      if (next) syncToken(next);
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData?.getData("text");
                      if (pasted) {
                        e.preventDefault();
                        const clean = normalizePersonalAccessToken(pasted);
                        syncToken(clean);
                        if (tokenInputRef.current) {
                          tokenInputRef.current.value = clean;
                        }
                      }
                    }}
                    onBlur={(e) => {
                      if (!e.currentTarget.value && latestTokenRef.current && !userClearedTokenRef.current) {
                        e.currentTarget.value = latestTokenRef.current;
                        setTokenValue(latestTokenRef.current);
                      }
                    }}
                    placeholder="Paste your Firefly III Personal Access Token"
                    enterKeyHint="done"
                    className="h-11 min-w-0 flex-1 bg-transparent pl-3 pr-1 text-base text-fg outline-none placeholder:text-muted md:text-sm"
                  />
                  {normalizedTokenLen > 0 && (
                    <button
                      type="button"
                      onClick={handleClearToken}
                      aria-label="Clear token"
                      title="Clear token"
                      className="!min-h-0 !min-w-0 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? "Hide token" : "Show token"}
                    title={showToken ? "Hide token" : "Show token"}
                    className="!min-h-0 !min-w-0 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
                  >
                    {showToken ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteToken}
                    aria-label="Paste token from clipboard"
                    title="Paste token from clipboard"
                    className="!min-h-0 !min-w-0 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary-soft px-2.5 text-xs font-semibold text-primary hover:bg-primary-soft/80 active:scale-95 transition"
                  >
                    <ClipboardPaste className="size-3.5" aria-hidden />
                    <span>Paste</span>
                  </button>
                </div>
              </div>
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

          <Button
            type="submit"
            size="lg"
            loading={loading}
            onPointerDown={snapshotLiveDomInputs}
            onTouchStart={snapshotLiveDomInputs}
          >
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
