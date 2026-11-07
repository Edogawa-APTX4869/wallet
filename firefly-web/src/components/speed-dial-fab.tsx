"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, Landmark, Plus, Wand2 } from "lucide-react";
import type { TransactionTemplateRow } from "@/lib/server/db";
import { ICON_CATALOG } from "@/components/resource-icon";
import { useAiAssistantConfig } from "@/components/magic-chatbar";
import { cn } from "@/lib/utils";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

/**
 * Floating Speed-Dial ("+" button in bottom-right):
 * Tapping "+" expands floating action pills for saved Templates, Transfer, Magic AI Assistant,
 * Income, and Expense. Automatically hides on `/new` so it never blocks form submit buttons.
 */
export function SpeedDialFab({
  isOpen: controlledOpen,
  onToggle: controlledOnToggle,
}: {
  isOpen?: boolean;
  onToggle?: () => void;
} = {}) {
  const pathname = usePathname();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (val: boolean | ((prev: boolean) => boolean)) => {
    if (controlledOnToggle) {
      const nextVal = typeof val === "function" ? val(open) : val;
      if (nextVal !== open) {
        controlledOnToggle();
      }
    } else {
      setInternalOpen(val);
    }
  };

  const [rendered, setRendered] = useState(open);

  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!open && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 200);
      return () => window.clearTimeout(timer);
    }
  }, [open, rendered]);

  const aiConfigQ = useAiAssistantConfig();
  const aiReady = Boolean(aiConfigQ.data?.enabled && aiConfigQ.data?.verified);

  const templatesQ = useQuery({
    queryKey: ["companion-templates"],
    queryFn: async () => {
      const res = await fetch("/api/companion/templates");
      if (!res.ok) return [] as TransactionTemplateRow[];
      const json = (await res.json()) as { data?: TransactionTemplateRow[] };
      return json.data ?? [];
    },
    staleTime: 60_000,
  });

  useEscapeDismiss(open, () => setOpen(false), "speed-dial-fab");

  if (pathname === "/new") return null;

  const isClosing = !open && rendered;
  const showSpeedDial = open || isClosing;
  const templates = (templatesQ.data ?? []).slice(0, 6);

  return (
    <>
      {showSpeedDial && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-bg/75 backdrop-blur-xs",
            isClosing ? "drawer-backdrop-out pointer-events-none" : "drawer-backdrop-in",
          )}
          onClick={() => {
            if (controlledOnToggle) controlledOnToggle();
            else setOpen(false);
          }}
          data-testid="fab-backdrop"
        />
      )}

      <div className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2 md:right-8 md:bottom-8">
        {showSpeedDial && (
          <div className="flex flex-col items-end gap-2">
            {templates.map((t, tIdx) => {
              const IconComp = ICON_CATALOG[t.icon] ?? Copy;
              // Stagger delay starts from bottom-most template upward
              const bottomUpDist = (aiReady ? 5 : 4) + (templates.length - 1 - tIdx);
              const delay = isClosing ? 0 : bottomUpDist * 35;
              return (
                <Link
                  key={t.id}
                  href={`/new?type=${t.type}&template=${encodeURIComponent(t.id)}`}
                  onClick={() => setOpen(false)}
                  style={{ animationDelay: `${delay}ms` }}
                  className={cn(
                    "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                    isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
                  )}
                >
                  <span
                    className="flex size-6 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: t.color || "var(--primary)" }}
                  >
                    <IconComp className="size-3.5" aria-hidden />
                  </span>
                  <span>Template: {t.name}</span>
                </Link>
              );
            })}

            {aiReady && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent("ff:open-magic-chat"));
                }}
                style={{ animationDelay: isClosing ? "0ms" : "140ms" }}
                className={cn(
                  "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                  isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
                )}
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Wand2 className="size-3.5" aria-hidden />
                </span>
                <span>AI Magic Chatbar</span>
              </button>
            )}

            <Link
              href="/accounts?create=1"
              onClick={(e) => {
                setOpen(false);
                if (pathname === "/accounts") {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("ff:open-create-account"));
                }
              }}
              style={{ animationDelay: isClosing ? "0ms" : "105ms" }}
              className={cn(
                "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Landmark className="size-3.5" aria-hidden />
              </span>
              <span>New account</span>
            </Link>

            <Link
              href="/new?type=transfer"
              onClick={() => setOpen(false)}
              style={{ animationDelay: isClosing ? "0ms" : "70ms" }}
              className={cn(
                "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-primary">
                <ArrowLeftRight className="size-3.5" aria-hidden />
              </span>
              <span>Transfer</span>
            </Link>

            <Link
              href="/new?type=deposit"
              onClick={() => setOpen(false)}
              style={{ animationDelay: isClosing ? "0ms" : "35ms" }}
              className={cn(
                "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-success-soft text-success">
                <ArrowDownLeft className="size-3.5" aria-hidden />
              </span>
              <span>New income</span>
            </Link>

            <Link
              href="/new?type=withdrawal"
              onClick={() => setOpen(false)}
              style={{ animationDelay: isClosing ? "0ms" : "0ms" }}
              className={cn(
                "interactive-tap flex min-h-[48px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-md transition-colors hover:bg-surface-2 active:scale-[0.97]",
                isClosing ? "fab-pill-out pointer-events-none" : "fab-pill-in",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-danger-soft text-danger">
                <ArrowUpRight className="size-3.5" aria-hidden />
              </span>
              <span>New expense</span>
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close quick actions" : "Add transaction"}
          aria-expanded={open}
          className={cn(
            "flex size-14 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg transition-all duration-300 hover:scale-105 active:scale-95",
            open && "bg-fg text-bg shadow-xl",
          )}
        >
          <Plus
            className={cn(
              "size-7 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              open && "rotate-45",
            )}
            style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            aria-hidden
          />
        </button>
      </div>
    </>
  );
}
