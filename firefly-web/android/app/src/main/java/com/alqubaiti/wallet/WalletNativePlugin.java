package com.alqubaiti.wallet;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native Android plugin making the Wallet APK 100% standalone & independent:
 * - Encrypted Firefly III URL & Personal Access Token storage backed by Android Keystore AES-GCM.
 * - Samsung / AndroidX BiometricPrompt (Fingerprint + Device Credential fallback) unlock & verification.
 * - Direct Firefly III REST API HTTP client (supports JSON and binary attachment uploads cleanly without CORS).
 */
@CapacitorPlugin(name = "WalletNative")
public class WalletNativePlugin extends Plugin {

    private static final String PREFS_NAME = "wallet_native_secure";
    private static final String KEY_ENC_URL = "enc_firefly_url";
    private static final String KEY_ENC_TOKEN = "enc_firefly_token";
    private static final String KEY_BIOMETRIC_ENABLED = "biometric_enabled";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "wallet_firefly_creds_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final long BACKGROUND_RELOCK_MS = 5000L;

    private final ExecutorService httpExecutor = Executors.newCachedThreadPool();

    private volatile boolean sessionUnlocked = false;
    private volatile boolean authPromptActive = false;
    private volatile long backgroundedAtMs = 0L;
    private volatile long suppressAutoLockUntilMs = 0L;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateSecretKey() throws GeneralSecurityException, IOException {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private synchronized String encryptString(String plaintext) throws GeneralSecurityException, IOException {
        if (plaintext == null) return "";
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private synchronized String decryptString(String stored) throws GeneralSecurityException, IOException {
        if (stored == null || !stored.contains(":")) return null;
        String[] parts = stored.split(":", 2);
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plain = cipher.doFinal(ciphertext);
        return new String(plain, StandardCharsets.UTF_8);
    }

    private String readDecrypted(String key) {
        String raw = prefs().getString(key, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            return decryptString(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static String normalizeBaseUrl(String raw) {
        if (raw == null) return "";
        return raw.trim().replaceAll("/+$", "");
    }

    private boolean isBiometricEnabledInternal() {
        return prefs().getBoolean(KEY_BIOMETRIC_ENABLED, true);
    }

    private static class BiometricSupportInfo {
        final boolean available;
        final int authenticators;
        final String biometryType;
        final int statusCode;

        BiometricSupportInfo(boolean available, int authenticators, String biometryType, int statusCode) {
            this.available = available;
            this.authenticators = authenticators;
            this.biometryType = biometryType;
            this.statusCode = statusCode;
        }
    }

    private BiometricSupportInfo inspectBiometricSupport() {
        BiometricManager bm = BiometricManager.from(getContext());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int strong = BiometricManager.Authenticators.BIOMETRIC_STRONG;
            int strongCred = strong | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            int weakCred = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

            int sStrong = bm.canAuthenticate(strong);
            if (sStrong == BiometricManager.BIOMETRIC_SUCCESS) {
                int sCombined = bm.canAuthenticate(strongCred);
                int auth = (sCombined == BiometricManager.BIOMETRIC_SUCCESS) ? strongCred : strong;
                return new BiometricSupportInfo(true, auth, "fingerprint", BiometricManager.BIOMETRIC_SUCCESS);
            }
            int sStrongCred = bm.canAuthenticate(strongCred);
            if (sStrongCred == BiometricManager.BIOMETRIC_SUCCESS) {
                return new BiometricSupportInfo(true, strongCred, "biometric", BiometricManager.BIOMETRIC_SUCCESS);
            }
            int sWeakCred = bm.canAuthenticate(weakCred);
            if (sWeakCred == BiometricManager.BIOMETRIC_SUCCESS) {
                return new BiometricSupportInfo(true, weakCred, "biometric", BiometricManager.BIOMETRIC_SUCCESS);
            }
            int sCred = bm.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            if (sCred == BiometricManager.BIOMETRIC_SUCCESS) {
                return new BiometricSupportInfo(true, BiometricManager.Authenticators.DEVICE_CREDENTIAL, "device_credential", BiometricManager.BIOMETRIC_SUCCESS);
            }
            return new BiometricSupportInfo(false, 0, "none", sStrong);
        } else {
            // Android 10 (API 29) and below: never combine BIOMETRIC_STRONG | DEVICE_CREDENTIAL in PromptInfo
            int strong = BiometricManager.Authenticators.BIOMETRIC_STRONG;
            int sStrong = bm.canAuthenticate(strong);
            if (sStrong == BiometricManager.BIOMETRIC_SUCCESS) {
                return new BiometricSupportInfo(true, strong, "fingerprint", BiometricManager.BIOMETRIC_SUCCESS);
            }
            int weak = BiometricManager.Authenticators.BIOMETRIC_WEAK;
            int sWeak = bm.canAuthenticate(weak);
            if (sWeak == BiometricManager.BIOMETRIC_SUCCESS) {
                return new BiometricSupportInfo(true, weak, "biometric", BiometricManager.BIOMETRIC_SUCCESS);
            }
            return new BiometricSupportInfo(false, 0, "none", sStrong);
        }
    }

    private void emitLockStateChanged() {
        String savedUrl = readDecrypted(KEY_ENC_URL);
        boolean connected = savedUrl != null && !savedUrl.isEmpty() && readDecrypted(KEY_ENC_TOKEN) != null;
        boolean bioEnabled = isBiometricEnabledInternal();
        BiometricSupportInfo info = inspectBiometricSupport();
        boolean locked = connected && bioEnabled && info.available && !sessionUnlocked;

        JSObject ev = new JSObject();
        ev.put("locked", locked);
        ev.put("connected", connected);
        notifyListeners("lockStateChanged", ev);
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        if (authPromptActive) return;
        long now = System.currentTimeMillis();
        if (now <= suppressAutoLockUntilMs) return;
        if (sessionUnlocked) {
            backgroundedAtMs = now;
        }
    }

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        long now = System.currentTimeMillis();
        if (now <= suppressAutoLockUntilMs) {
            suppressAutoLockUntilMs = 0L;
            backgroundedAtMs = 0L;
            return;
        }
        if (backgroundedAtMs > 0L && !authPromptActive && sessionUnlocked) {
            long awayMs = now - backgroundedAtMs;
            KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
            boolean screenLocked = km != null && km.isKeyguardLocked();
            if (screenLocked || awayMs >= BACKGROUND_RELOCK_MS) {
                sessionUnlocked = false;
                emitLockStateChanged();
            }
        }
        backgroundedAtMs = 0L;
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        httpExecutor.shutdownNow();
    }

    @PluginMethod
    public void getSessionStatus(PluginCall call) {
        String url = readDecrypted(KEY_ENC_URL);
        String token = readDecrypted(KEY_ENC_TOKEN);
        boolean connected = url != null && !url.isEmpty() && token != null && !token.isEmpty();
        boolean bioEnabled = isBiometricEnabledInternal();
        BiometricSupportInfo bioInfo = inspectBiometricSupport();
        boolean locked = connected && bioEnabled && bioInfo.available && !sessionUnlocked;

        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("url", connected ? url : JSObject.NULL);
        ret.put("authMode", "standalone");
        ret.put("biometricEnabled", bioEnabled);
        ret.put("biometricAvailable", bioInfo.available);
        ret.put("biometryType", bioInfo.biometryType);
        ret.put("biometricLocked", locked);
        ret.put("sessionUnlocked", sessionUnlocked);
        call.resolve(ret);
    }

    @PluginMethod
    public void saveCredentials(PluginCall call) {
        String url = normalizeBaseUrl(call.getString("url"));
        String token = call.getString("token");
        if (token != null) token = token.trim();

        if (url.isEmpty() || token == null || token.isEmpty()) {
            call.reject("Firefly III URL and Personal Access Token are required.");
            return;
        }

        try {
            String encUrl = encryptString(url);
            String encToken = encryptString(token);
            prefs().edit()
                    .putString(KEY_ENC_URL, encUrl)
                    .putString(KEY_ENC_TOKEN, encToken)
                    .apply();
            sessionUnlocked = true;

            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("url", url);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not encrypt credentials in Android Keystore: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        prefs().edit()
                .remove(KEY_ENC_URL)
                .remove(KEY_ENC_TOKEN)
                .apply();
        sessionUnlocked = false;
        backgroundedAtMs = 0L;
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setBiometricEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        prefs().edit().putBoolean(KEY_BIOMETRIC_ENABLED, enabled).apply();
        if (!enabled) {
            sessionUnlocked = true;
        }
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void lockApp(PluginCall call) {
        sessionUnlocked = false;
        emitLockStateChanged();
        JSObject ret = new JSObject();
        ret.put("locked", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void suppressNextBackgroundLock(PluginCall call) {
        int durationMs = call.getInt("durationMs", 60000);
        suppressAutoLockUntilMs = System.currentTimeMillis() + Math.max(0, durationMs);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkBiometric(PluginCall call) {
        BiometricSupportInfo bioInfo = inspectBiometricSupport();
        JSObject ret = new JSObject();
        ret.put("available", bioInfo.available);
        ret.put("biometryType", bioInfo.biometryType);
        ret.put("statusCode", bioInfo.statusCode);
        ret.put("biometricEnabled", isBiometricEnabledInternal());
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticateBiometric(final PluginCall call) {
        final String title = call.getString("title", "Unlock Wallet");
        final String subtitle = call.getString("subtitle", "Use your fingerprint or screen lock to continue");
        final String description = call.getString("description", "");
        final String negativeText = call.getString("negativeButtonText", "Cancel");

        if (!(getActivity() instanceof FragmentActivity)) {
            call.reject("Host activity does not support BiometricPrompt.");
            return;
        }
        final FragmentActivity activity = (FragmentActivity) getActivity();
        final BiometricSupportInfo bioInfo = inspectBiometricSupport();

        if (!bioInfo.available) {
            JSObject ret = new JSObject();
            ret.put("verified", false);
            ret.put("errorCode", bioInfo.statusCode);
            ret.put("biometricUnavailable", true);
            ret.put("message", bioInfo.statusCode == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                    ? "No fingerprint or screen lock is enrolled on this device."
                    : "Biometric authentication is not available on this device.");
            call.resolve(ret);
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                authPromptActive = true;
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        authPromptActive = false;
                        boolean cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED
                                || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                || errorCode == BiometricPrompt.ERROR_CANCELED;
                        boolean lockout = errorCode == BiometricPrompt.ERROR_LOCKOUT
                                || errorCode == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                        JSObject ret = new JSObject();
                        ret.put("verified", false);
                        ret.put("errorCode", errorCode);
                        ret.put("cancelled", cancelled);
                        ret.put("lockout", lockout);
                        ret.put("message", errString.toString());
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        authPromptActive = false;
                        sessionUnlocked = true;
                        backgroundedAtMs = 0L;
                        JSObject ret = new JSObject();
                        ret.put("verified", true);
                        ret.put("authenticationType", result.getAuthenticationType());
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                        // Keep prompt open for retry on Samsung ultrasonic sensor
                    }
                });

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(bioInfo.authenticators)
                        .setConfirmationRequired(false);

                if (description != null && !description.trim().isEmpty()) {
                    builder.setDescription(description);
                }

                // Device credential already supplies its own system fallback button and must not combine with setNegativeButtonText
                if ((bioInfo.authenticators & BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0) {
                    builder.setNegativeButtonText(negativeText);
                }

                prompt.authenticate(builder.build());
            } catch (Exception e) {
                authPromptActive = false;
                JSObject ret = new JSObject();
                ret.put("verified", false);
                ret.put("message", "Biometric prompt failed: " + e.getMessage());
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void ffRequest(final PluginCall call) {
        final String method = (call.getString("method", "GET")).toUpperCase();
        final String rawPath = call.getString("path", "");
        final String query = call.getString("query", "");
        final String bodyJson = call.getString("bodyJson", null);
        final String bodyBase64 = call.getString("bodyBase64", null);
        final String customContentType = call.getString("contentType", null);
        final String overrideUrl = normalizeBaseUrl(call.getString("overrideUrl", null));
        final String overrideToken = call.getString("overrideToken", null);

        final String baseUrl = !overrideUrl.isEmpty() ? overrideUrl : normalizeBaseUrl(readDecrypted(KEY_ENC_URL));
        final String token = (overrideToken != null && !overrideToken.trim().isEmpty())
                ? overrideToken.trim()
                : readDecrypted(KEY_ENC_TOKEN);

        if (baseUrl.isEmpty() || token == null || token.isEmpty()) {
            JSObject err = new JSObject();
            err.put("status", 401);
            err.put("ok", false);
            err.put("body", "{\"message\":\"Not connected to Firefly III.\"}");
            err.put("contentType", "application/json");
            err.put("networkError", false);
            call.resolve(err);
            return;
        }

        final String cleanPath = rawPath.replaceAll("^/+", "");
        if (cleanPath.contains("..")) {
            call.reject("Invalid Firefly III API path.");
            return;
        }

        final String targetUrl = baseUrl + "/api/v1/" + cleanPath + (query != null ? query : "");

        httpExecutor.submit(() -> {
            HttpURLConnection conn = null;
            try {
                URL urlObj = new URL(targetUrl);
                conn = (HttpURLConnection) urlObj.openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Accept", "application/vnd.api+json");

                boolean hasBodyMethod = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
                if (hasBodyMethod && (bodyBase64 != null || bodyJson != null)) {
                    byte[] payloadBytes;
                    String contentType;
                    if (bodyBase64 != null) {
                        payloadBytes = Base64.decode(bodyBase64, Base64.DEFAULT);
                        contentType = (customContentType != null && !customContentType.isEmpty())
                                ? customContentType
                                : "application/octet-stream";
                    } else {
                        payloadBytes = bodyJson.getBytes(StandardCharsets.UTF_8);
                        contentType = (customContentType != null && !customContentType.isEmpty())
                                ? customContentType
                                : "application/json";
                    }
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", contentType);
                    conn.setFixedLengthStreamingMode(payloadBytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payloadBytes);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String responseBody = "";
                if (is != null) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = is.read(chunk)) != -1) {
                        buffer.write(chunk, 0, n);
                    }
                    responseBody = buffer.toString(StandardCharsets.UTF_8.name());
                }

                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("ok", status >= 200 && status < 300);
                ret.put("body", responseBody);
                ret.put("contentType", conn.getContentType() != null ? conn.getContentType() : "application/json");
                ret.put("networkError", false);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("status", 0);
                ret.put("ok", false);
                ret.put("body", "");
                ret.put("contentType", "application/json");
                ret.put("networkError", true);
                ret.put("message", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                call.resolve(ret);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }
}
