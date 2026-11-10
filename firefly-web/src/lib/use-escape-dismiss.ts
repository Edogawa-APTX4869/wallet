"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

export interface Dismissible {
  id: string;
  onDismiss: () => void;
}

export class EscapeStackManager {
  private stack: Dismissible[] = [];
  private listeners: Set<() => void> = new Set();

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public register(id: string, onDismiss: () => void): () => void {
    this.stack = this.stack.filter((item) => item.id !== id);
    const item: Dismissible = { id, onDismiss };
    this.stack.push(item);
    this.notify();
    return () => {
      this.unregister(id);
    };
  }

  public unregister(id: string) {
    const prevLen = this.stack.length;
    this.stack = this.stack.filter((item) => item.id !== id);
    if (this.stack.length !== prevLen) {
      this.notify();
    }
  }

  public handleKeyDown(key: string): boolean {
    if (key !== "Escape" || this.stack.length === 0) {
      return false;
    }
    const top = this.stack.pop();
    this.notify();
    if (top) {
      top.onDismiss();
      return true;
    }
    return false;
  }

  public getStackSize = (): number => {
    return this.stack.length;
  };

  public getTopId(): string | undefined {
    return this.stack[this.stack.length - 1]?.id;
  }

  public clear() {
    if (this.stack.length > 0) {
      this.stack = [];
      this.notify();
    }
  }
}

export const globalEscapeStack = new EscapeStackManager();

function getServerStackSizeSnapshot(): number {
  return 0;
}

/**
 * Reactive hook that returns true whenever any dismissible overlay
 * (modal sheet, drawer, speed-dial menu, chatbar sheet, filter sheet, etc.)
 * is currently active on the global escape stack.
 */
export function useHasActiveOverlay(): boolean {
  const stackSize = useSyncExternalStore(
    globalEscapeStack.subscribe,
    globalEscapeStack.getStackSize,
    getServerStackSizeSnapshot,
  );
  return stackSize > 0;
}

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

export function useEscapeDismiss(
  enabled: boolean,
  onDismiss: () => void,
  explicitId?: string,
) {
  const autoId = useId();
  const id = explicitId ?? autoId;
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!enabled) return;
    return globalEscapeStack.register(id, () => {
      onDismissRef.current();
    });
  }, [enabled, id]);
}

export function registerDismissible(id: string, onDismiss: () => void): () => void {
  return globalEscapeStack.register(id, onDismiss);
}
