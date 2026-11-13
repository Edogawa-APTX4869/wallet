"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

export interface Dismissible {
  id: string;
  onDismiss: () => void;
  /**
   * Full-screen layers (modal sheets, navigation drawer, notifications) cover the
   * whole view, so the app chrome (bottom nav bar, FAB, AI pill) is hidden while
   * they are open. Small popovers / inline panels keep the chrome visible.
   */
  hidesChrome: boolean;
}

export class EscapeStackManager {
  private stack: Dismissible[] = [];
  private listeners: Set<() => void> = new Set();
  private chromeCount = 0;
  private scrollLocked = false;
  private savedHtmlOverflow = "";
  private savedBodyOverflow = "";
  private savedHtmlOverscroll = "";
  private savedBodyOverscroll = "";

  private syncScrollLock() {
    if (typeof document === "undefined") return;
    const shouldLock = this.chromeCount > 0;
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    if (shouldLock && !this.scrollLocked) {
      this.savedHtmlOverflow = html.style.overflow;
      this.savedBodyOverflow = body.style.overflow;
      this.savedHtmlOverscroll = html.style.overscrollBehavior;
      this.savedBodyOverscroll = body.style.overscrollBehavior;
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      body.style.overscrollBehavior = "none";
      this.scrollLocked = true;
    } else if (!shouldLock && this.scrollLocked) {
      html.style.overflow = this.savedHtmlOverflow;
      body.style.overflow = this.savedBodyOverflow;
      html.style.overscrollBehavior = this.savedHtmlOverscroll;
      body.style.overscrollBehavior = this.savedBodyOverscroll;
      this.scrollLocked = false;
    }
  }

  private recount() {
    this.chromeCount = this.stack.filter((i) => i.hidesChrome).length;
    this.syncScrollLock();
    for (const listener of this.listeners) listener();
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public register(id: string, onDismiss: () => void, hidesChrome = false): () => void {
    this.stack = this.stack.filter((item) => item.id !== id);
    const item: Dismissible = { id, onDismiss, hidesChrome };
    this.stack.push(item);
    this.recount();
    return () => {
      // Only remove this exact registration (a newer one with the same id may exist).
      const before = this.stack.length;
      this.stack = this.stack.filter((i) => i !== item);
      if (this.stack.length !== before) this.recount();
    };
  }

  public unregister(id: string) {
    const before = this.stack.length;
    this.stack = this.stack.filter((item) => item.id !== id);
    if (this.stack.length !== before) this.recount();
  }

  /** Dismisses the top-most layer. Returns true if something was dismissed. */
  public handleKeyDown(key: string): boolean {
    if (key !== "Escape" || this.stack.length === 0) return false;
    const top = this.stack.pop();
    this.recount();
    if (top) {
      top.onDismiss();
      return true;
    }
    return false;
  }

  public getStackSize = (): number => this.stack.length;

  /** Number of open full-screen layers that hide the app chrome. */
  public getChromeOverlayCount = (): number => this.chromeCount;

  public getTopId(): string | undefined {
    return this.stack[this.stack.length - 1]?.id;
  }

  public clear() {
    if (this.stack.length > 0) {
      this.stack = [];
      this.recount();
    }
  }
}

export const globalEscapeStack = new EscapeStackManager();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const handled = globalEscapeStack.handleKeyDown("Escape");
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });
}

const getServerZero = () => 0;

/**
 * True while a full-screen layer (modal sheet, drawer, notifications) is open.
 * Small popovers do not count, so they never make the bottom nav bar flicker.
 */
export function useHasActiveOverlay(): boolean {
  const count = useSyncExternalStore(
    globalEscapeStack.subscribe,
    globalEscapeStack.getChromeOverlayCount,
    getServerZero,
  );
  return count > 0;
}

export function useEscapeDismiss(
  enabled: boolean,
  onDismiss: () => void,
  explicitId?: string,
  options?: { hidesChrome?: boolean },
) {
  const autoId = useId();
  const id = explicitId ?? autoId;
  const onDismissRef = useRef(onDismiss);
  const hidesChrome = options?.hidesChrome ?? false;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!enabled) return;
    return globalEscapeStack.register(
      id,
      () => {
        onDismissRef.current();
      },
      hidesChrome,
    );
  }, [enabled, id, hidesChrome]);
}

export function registerDismissible(id: string, onDismiss: () => void, hidesChrome = false): () => void {
  return globalEscapeStack.register(id, onDismiss, hidesChrome);
}
