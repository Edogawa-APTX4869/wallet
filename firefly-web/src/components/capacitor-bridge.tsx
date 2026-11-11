"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { useTheme } from "@/components/theme-provider";
import { globalEscapeStack } from "@/lib/use-escape-dismiss";

/**
 * Returns true if the given pathname is one of the 5 primary bottom-navigation
 * screens where the mobile navigation bar is displayed on screen:
 * `/` (Home), `/accounts` (Accounts list), `/transactions` (Records),
 * `/reports` (Reports), `/budgets` (Budgets).
 *
 * Secondary / drill-down / overlay routes (`/new`, `/accounts/[id]`, `/rules`,
 * `/piggy-banks`, `/categories`, `/tags`, `/settings`) return false because
 * they overlay the main view without the bottom navigation bar.
 */
export function isMainBottomNavRoute(pathname: string): boolean {
  const clean = (pathname || "/").split("?")[0].replace(/\/+$/, "") || "/";
  return (
    clean === "/" ||
    clean === "/accounts" ||
    clean === "/transactions" ||
    clean === "/reports" ||
    clean === "/budgets"
  );
}

/**
 * Checks whether the mobile bottom navigation bar is currently visible in the DOM.
 * Falls back to `isMainBottomNavRoute(window.location.pathname)` if DOM measurement
 * is unavailable (e.g. unit test environment).
 */
export function isBottomNavVisibleOnScreen(pathname?: string): boolean {
  if (globalEscapeStack.getStackSize() > 0) {
    return false;
  }
  if (typeof document !== "undefined") {
    const navEl = document.querySelector<HTMLElement>('[data-mobile-bottom-nav="true"]');
    if (navEl) {
      if (navEl.getAttribute("data-nav-hidden") === "true" || navEl.hidden) {
        return false;
      }
      return true;
    }
  }
  const currentPath =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  return isMainBottomNavRoute(currentPath);
}

/**
 * Core Android hardware back-button / back-swipe resolution logic.
 *
 * Rules:
 * 1. If any overlay layer (modal, sheet, drawer, speed-dial, picker, or nested detail layer)
 *    is open in `globalEscapeStack`, dismiss the topmost layer and stay in the app.
 * 2. If the bottom navigation bar is visible on the screen (main bottom-nav view with no
 *    overlay open), ANY back swipe in Android quits/minimizes the program (`minimizeApp`)
 *    instead of going to the previously opened page!
 * 3. Otherwise, the user is inside an overlay route / sub-page where the bottom navigation
 *    bar is hidden (`/new`, `/accounts/[id]`, `/rules`, `/piggy-banks`, `/categories`,
 *    `/tags`, `/settings`), so swiping back returns to the main view.
 */
export function handleAndroidBackSwipe(options?: {
  pathname?: string;
  canGoBack?: boolean;
  onNavigateBack?: () => void;
  onMinimizeApp?: () => void;
}): "dismissed-overlay" | "minimized-app" | "navigated-back" {
  // Priority 1: Dismiss topmost open overlay, modal, sheet, or drawer
  const dismissedOverlay = globalEscapeStack.handleKeyDown("Escape");
  if (dismissedOverlay) {
    return "dismissed-overlay";
  }

  const path =
    options?.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");

  // Priority 2: If the navigation bar is shown on screen -> quit/minimize the program!
  if (isBottomNavVisibleOnScreen(path)) {
    if (options?.onMinimizeApp) {
      options.onMinimizeApp();
    } else {
      App.minimizeApp().catch(() => {});
    }
    return "minimized-app";
  }

  // Priority 3: User is in an overlay route (no bottom navigation bar shown) -> return to main view
  if (options?.onNavigateBack) {
    options.onNavigateBack();
  } else if (typeof window !== "undefined") {
    if (options?.canGoBack || window.history.length > 1) {
      window.history.back();
    } else {
      window.location.replace("/");
    }
  }
  return "navigated-back";
}

/**
 * Triggers a light native haptic tap when running inside the Capacitor Android APK.
 * Safe no-op on desktop/mobile web browsers.
 */
export async function triggerNativeHaptic(style: ImpactStyle = ImpactStyle.Light): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style });
  } catch {
    // Ignore on unsupported devices
  }
}

declare global {
  interface Window {
    __walletBack?: () => "handled" | "exit" | "back";
  }
}

/**
 * Bridges native Android capabilities (Status Bar theme sync, Hardware Back Button
 * LIFO modal/drawer dismissal, and Splash Screen lifecycle) when running as an APK.
 */
export function CapacitorBridge() {
  const { resolvedTheme } = useTheme();

  // Always expose window.__walletBack so the native Android WebView host (MainActivity)
  // can query the live React escape stack and navigation bar state on any origin.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__walletBack = () => {
      const dismissedOverlay = globalEscapeStack.handleKeyDown("Escape");
      if (dismissedOverlay) {
        return "handled";
      }
      if (isBottomNavVisibleOnScreen(window.location.pathname)) {
        return "exit";
      }
      return "back";
    };
    return () => {
      delete window.__walletBack;
    };
  }, []);

  // 1. Sync native Android status bar with active light/dark theme
  useEffect(() => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;

    const isDark = resolvedTheme === "dark";
    const bgColor = isDark ? "#161821" : "#f8f9fc";
    const barStyle = isDark ? Style.Dark : Style.Light;

    StatusBar.setStyle({ style: barStyle }).catch(() => {});
    StatusBar.setBackgroundColor({ color: bgColor }).catch(() => {});
  }, [resolvedTheme]);

  // 2. Hide native splash screen after initial client hydration
  useEffect(() => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
    SplashScreen.hide().catch(() => {});
  }, []);

  // 3. Wire Android hardware back button into the LIFO Escape stack & navigation bar rule
  useEffect(() => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;

    const listenerPromise = App.addListener("backButton", ({ canGoBack }) => {
      handleAndroidBackSwipe({ canGoBack });
    });

    return () => {
      listenerPromise.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);

  return null;
}
