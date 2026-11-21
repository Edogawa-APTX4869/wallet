import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/firefly/api";
import {
  clearLocalCompanionData,
  connectWalletSession,
  disconnectWalletSession,
  getWalletSessionStatus,
  accountHref,
  normalizePersonalAccessToken,
  normalizeServerUrl,
  readNativeClipboardText,
  _setNativeWalletForTests,
  type WalletNativePlugin,
} from "@/lib/native-wallet";
import {
  clearOfflineHttpCache,
  clearOfflineQueue,
  resetOfflineStoreForTests,
} from "@/lib/offline-store";
import {
  companionFetch,
  resetSyncStateForTests,
  syncOfflineQueue,
  validateServerAuthentication,
} from "@/lib/offline-sync";

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: value },
  });
}

describe("Standalone Android APK Mode & Biometric Verification", () => {
  beforeEach(async () => {
    resetOfflineStoreForTests();
    resetSyncStateForTests();
    await clearOfflineQueue();
    await clearOfflineHttpCache();
    await clearLocalCompanionData();
    setNavigatorOnline(true);
  });

  afterEach(() => {
    _setNativeWalletForTests({ standalone: null, plugin: null });
    vi.restoreAllMocks();
    setNavigatorOnline(true);
  });

  it("prompts biometric verification on standalone login and aborts credential save when fingerprint is cancelled", async () => {
    const savedCalls: Array<{ url: string; token: string }> = [];
    const mockPlugin: Partial<WalletNativePlugin> = {
      checkBiometric: async () => ({
        available: true,
        biometryType: "fingerprint",
        statusCode: 0,
        biometricEnabled: true,
      }),
      authenticateBiometric: async () => ({
        verified: false,
        cancelled: true,
        message: "Cancelled",
      }),
      saveCredentials: async (opts) => {
        savedCalls.push(opts);
        return { saved: true, url: opts.url };
      },
      setBiometricEnabled: async ({ enabled }) => ({ enabled }),
      ffRequest: async ({ path: reqPath }) => ({
        status: 200,
        ok: true,
        body: reqPath === "about" ? JSON.stringify({ data: { version: "6.1.0" } }) : JSON.stringify({ data: { attributes: { email: "u@example.com" } } }),
        contentType: "application/json",
      }),
    };

    _setNativeWalletForTests({ standalone: true, plugin: mockPlugin });

    await expect(
      connectWalletSession({
        url: "https://firefly.example.com/",
        token: "pat-secret",
        enableBiometric: true,
      }),
    ).rejects.toThrow(/Fingerprint verification is required/i);

    expect(savedCalls).toHaveLength(0);
  });

  it("saves encrypted credentials after Samsung fingerprint verification passes & computes standalone links", async () => {
    let bioEnabled = true;
    let savedCreds: { url: string; token: string } | null = null;
    const mockPlugin: Partial<WalletNativePlugin> = {
      checkBiometric: async () => ({
        available: true,
        biometryType: "fingerprint",
        statusCode: 0,
        biometricEnabled: bioEnabled,
      }),
      authenticateBiometric: async () => ({ verified: true }),
      saveCredentials: async (opts) => {
        savedCreds = opts;
        return { saved: true, url: opts.url };
      },
      setBiometricEnabled: async ({ enabled }) => {
        bioEnabled = enabled;
        return { enabled };
      },
      clearCredentials: async () => {
        savedCreds = null;
        return { cleared: true };
      },
      getSessionStatus: async () => ({
        connected: Boolean(savedCreds),
        url: savedCreds?.url ?? null,
        authMode: "standalone",
        biometricEnabled: bioEnabled,
        biometricAvailable: true,
        biometryType: "fingerprint",
        biometricLocked: false,
      }),
      ffRequest: async () => ({
        status: 200,
        ok: true,
        body: JSON.stringify({ data: { attributes: { email: "owner@nas.local" } } }),
        contentType: "application/json",
      }),
    };

    _setNativeWalletForTests({ standalone: true, plugin: mockPlugin });

    const res = await connectWalletSession({
      url: "https://firefly.nas.local///",
      token: "pat-valid-123",
      enableBiometric: true,
    });
    expect(res).toEqual({ connected: true, url: "https://firefly.nas.local" });
    expect(savedCreds).toEqual({ url: "https://firefly.nas.local", token: "pat-valid-123" });

    const status = await getWalletSessionStatus();
    expect(status.authMode).toBe("standalone");
    expect(status.connected).toBe(true);
    expect(status.biometricEnabled).toBe(true);
    expect(accountHref("42")).toBe("/accounts/detail/?id=42");

    await disconnectWalletSession();
    expect(savedCreds).toBeNull();

    _setNativeWalletForTests({ standalone: false, plugin: null });
    expect(accountHref("42")).toBe("/accounts/42");
  });

  it("routes Firefly reads, offline queue sync, and companion storage natively without /api/* server dependency", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const nativeCalls: Array<{ method: string; path: string; bodyJson?: string }> = [];
    let locked = true;

    const mockPlugin: Partial<WalletNativePlugin> = {
      getSessionStatus: async () => ({
        connected: true,
        url: "https://firefly.example.com",
        authMode: "standalone",
        biometricEnabled: true,
        biometricAvailable: true,
        biometryType: "fingerprint",
        biometricLocked: locked,
      }),
      ffRequest: async ({ method, path: reqPath, bodyJson }) => {
        nativeCalls.push({ method, path: reqPath, bodyJson });
        if (reqPath === "about/user") {
          return {
            status: 200,
            ok: true,
            body: JSON.stringify({ data: { attributes: { email: "me@example.com" } } }),
            contentType: "application/json",
          };
        }
        if (reqPath === "categories") {
          return {
            status: 200,
            ok: true,
            body: JSON.stringify({ data: [{ id: "1", type: "categories", attributes: { name: "Food" } }], meta: { pagination: { total_pages: 1 } } }),
            contentType: "application/json",
          };
        }
        return {
          status: 200,
          ok: true,
          body: JSON.stringify({ data: { id: "700", type: "transactions", attributes: { transactions: [] } } }),
          contentType: "application/json",
        };
      },
    };

    _setNativeWalletForTests({ standalone: true, plugin: mockPlugin });

    // Local companion store reads/writes Dashboard prefs + categoryOrder with zero fetch calls
    await companionFetch("/api/companion/dashboard", {
      method: "PUT",
      body: { categoryOrder: ["Housing", "Food", "Transport"], selectedAccountIds: ["1"] },
    });
    const dash = await companionFetch<{ data: { categoryOrder: string[]; selectedAccountIds: string[] } }>(
      "/api/companion/dashboard",
    );
    expect(dash.data.categoryOrder).toEqual(["Housing", "Food", "Transport"]);
    expect(dash.data.selectedAccountIds).toEqual(["1"]);

    // Direct Firefly API read uses native bridge (not fetch("/api/ff/..."))
    const cats = await api.categories();
    expect(cats).toHaveLength(1);
    expect(cats[0].attributes.name).toBe("Food");

    // Queue offline transaction
    setNavigatorOnline(false);
    await api.createTransaction([
      { type: "withdrawal", date: "2026-11-18T12:00:00+03:00", amount: "12.500", description: "Bakery" },
    ]);

    // While biometric lock is active, sync pauses without discarding or marking invalid auth
    setNavigatorOnline(true);
    const lockedAuth = await validateServerAuthentication();
    expect(lockedAuth.ok).toBe(false);

    // Once unlocked by fingerprint, auth validates directly and replays queue natively
    locked = false;
    const syncRes = await syncOfflineQueue();
    expect(syncRes).toEqual({ synced: 1, failed: 0, authRequired: false, offline: false });

    // Crucial: zero browser /api/* network calls made in standalone APK mode
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(nativeCalls.some((c) => c.method === "POST" && c.path === "transactions")).toBe(true);
  });

  it("verifies Samsung BiometricPrompt rules, Keystore encryption, and MainActivity lifecycle ordering", () => {
    const pluginJava = readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/alqubaiti/wallet/WalletNativePlugin.java"),
      "utf8",
    );
    const mainJava = readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/alqubaiti/wallet/MainActivity.java"),
      "utf8",
    );
    const manifestXml = readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    const gradle = readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    const capCfg = readFileSync(path.resolve(__dirname, "../../capacitor.config.ts"), "utf8");

    expect(pluginJava).toContain("AndroidKeyStore");
    expect(pluginJava).toContain("AES/GCM/NoPadding");
    expect(pluginJava).toContain("BiometricPrompt");
    // Ensures Samsung Android 10 (API 29) & DEVICE_CREDENTIAL mutual-exclusion rules are guarded
    expect(pluginJava).toContain("Build.VERSION_CODES.R");
    expect(pluginJava).toContain("(bioInfo.authenticators & BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0");

    // Capacitor 8 requires registering plugins BEFORE super.onCreate(savedInstanceState)
    const regIdx = mainJava.indexOf("registerPlugin(WalletNativePlugin.class)");
    const superIdx = mainJava.indexOf("super.onCreate(savedInstanceState)");
    expect(regIdx).toBeGreaterThan(-1);
    expect(superIdx).toBeGreaterThan(regIdx);
    // Standalone APK serves bundled UI from https://localhost/ so route path checks must apply there too
    expect(mainJava).not.toContain('if ("localhost".equalsIgnoreCase(host)) return false;');
    expect(mainJava).toContain("resolveStaticExportRoute");
    expect(mainJava).toContain('public/" + trimmed + "/index.html');

    expect(manifestXml).toContain("android.permission.USE_BIOMETRIC");
    expect(gradle).toContain("androidx.biometric:biometric:1.1.0");
    expect(capCfg).toContain('webDir: "out"');
    expect(pluginJava).toContain("public void readClipboard(");
    expect(pluginJava).toContain("User-Agent");

    const loginSrc = readFileSync(
      path.resolve(__dirname, "../app/login/login-form.tsx"),
      "utf8",
    );
    expect(loginSrc).toContain("WebkitTextSecurity");
    expect(loginSrc).toContain("Paste token from clipboard");
    expect(loginSrc).toContain("noValidate");
  });

  it("normalizes mobile URL typos, OAuth profile suffixes, and 1,100+ char JWT tokens with clipboard paste", async () => {
    expect(normalizeServerUrl("budget.alqubaiti.com")).toBe("https://budget.alqubaiti.com");
    expect(normalizeServerUrl("https:budget.alqubaiti.com/")).toBe("https://budget.alqubaiti.com");
    expect(normalizeServerUrl("https://budget.alqubaiti.com/profile/oauth")).toBe("https://budget.alqubaiti.com");
    expect(normalizeServerUrl("https://budget.alqubaiti.com/api/v1/")).toBe("https://budget.alqubaiti.com");

    const longJwt = `Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.\n${"a".repeat(600)} \r\n.${"b".repeat(500)}  `;
    const cleaned = normalizePersonalAccessToken(longJwt);
    expect(cleaned.startsWith("eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.")).toBe(true);
    expect(cleaned).not.toMatch(/\s/);
    expect(cleaned.length).toBeGreaterThan(1100);

    _setNativeWalletForTests({
      standalone: true,
      plugin: {
        readClipboard: async () => ({ text: longJwt }),
      },
    });
    const clipText = await readNativeClipboardText();
    expect(normalizePersonalAccessToken(clipText)).toBe(cleaned);
  });
});
