"use client";

import { forwardRef, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn, formatMoney } from "@/lib/utils";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-fg hover:opacity-90 active:opacity-95 shadow-2xs",
        variant === "secondary" && "border border-border bg-surface hover:bg-surface-2",
        variant === "ghost" && "hover:bg-surface-2",
        variant === "danger" && "bg-danger text-white hover:opacity-90 active:opacity-95",
        size === "sm" && "min-h-[48px] min-w-[48px] px-3.5 text-sm",
        size === "md" && "min-h-[48px] h-12 px-4 text-sm",
        size === "lg" && "min-h-[52px] h-[52px] px-6 text-base",
        size === "icon" && "min-h-[48px] min-w-[48px] size-12",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function Card({
  className,
  compact = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface",
        compact ? "p-2.5 sm:p-3.5" : "p-3 sm:p-4 md:p-4.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold text-muted", className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-surface px-3 text-base outline-none transition-colors md:text-sm",
        "placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/25",
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-surface px-3 text-base outline-none md:text-sm",
        "focus:border-primary focus:ring-2 focus:ring-primary/25",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "primary" | "success" | "danger" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "primary" && "bg-primary-soft text-primary",
        tone === "success" && "bg-success-soft text-success",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "warning" && "bg-warning-soft text-warning",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} aria-hidden />;
}

import { AnimatedMoney, AnimatedNumber } from "@/components/animated-number";
import { AnimatedTabs, type AnimatedTabsProps, type TabItem } from "@/components/animated-tabs";

export { AnimatedMoney, AnimatedNumber, AnimatedTabs, type AnimatedTabsProps, type TabItem };

export function Money({
  amount,
  code,
  decimals,
  symbol,
  signed,
  colored,
  skipCurrency,
  className,
  animated = false,
}: {
  amount: string | number | null | undefined;
  code?: string | null;
  decimals?: number | null;
  symbol?: string | null;
  signed?: boolean;
  colored?: boolean;
  skipCurrency?: boolean;
  className?: string;
  animated?: boolean;
}) {
  if (animated) {
    return (
      <AnimatedMoney
        amount={amount}
        code={code}
        decimals={decimals}
        symbol={symbol}
        signed={signed}
        colored={colored}
        skipCurrency={skipCurrency}
        className={className}
      />
    );
  }
  const n = Number(amount ?? 0);
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        colored && n > 0 && "text-success",
        colored && n < 0 && "text-danger",
        className,
      )}
    >
      {formatMoney(amount, code, decimals, symbol, { signed, skipCurrency })}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center min-h-[140px] w-full", className)}>
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 sm:mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs sm:text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Progress({ value, tone = "primary" }: { value: number; tone?: "primary" | "danger" | "warning" | "success" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500 ease-out",
          tone === "primary" && "bg-primary",
          tone === "danger" && "bg-danger",
          tone === "warning" && "bg-warning",
          tone === "success" && "bg-success",
        )}
        style={{ width: `${pct}%`, transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      />
    </div>
  );
}

/**
 * Adaptive Modal / Bottom Sheet:
 * - On mobile (< sm): slides up from the bottom edge with a grab pill and safe-area padding.
 * - On desktop (>= sm): centered elevated dialog card.
 */
export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = "max-w-lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  useEscapeDismiss(open, onClose, undefined, { hidesChrome: true });

  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!open && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 220);
      return () => window.clearTimeout(timer);
    }
  }, [open, rendered]);

  if (!open && !rendered) return null;

  const isClosing = !open && rendered;

  const modalNode = (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-0 backdrop-blur-md overscroll-none touch-none sm:items-center sm:p-4",
        isClosing ? "drawer-backdrop-out pointer-events-none" : "drawer-backdrop-in",
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl touch-auto sm:rounded-3xl",
          maxWidth,
          isClosing ? "sheet-down pointer-events-none" : "sheet-up",
        )}
      >
        {/* Mobile grab pill */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex min-h-[48px] min-w-[48px] size-12 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg active:scale-[0.96] transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  );

  if (mounted && typeof document !== "undefined" && document.body) {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
}
