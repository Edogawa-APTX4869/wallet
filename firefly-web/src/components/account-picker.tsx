"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Account, Resource } from "@/lib/firefly/types";
import { cn } from "@/lib/utils";
import { Money } from "@/components/ui";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

const GROUP_LABEL: Record<string, string> = {
  asset: "Asset accounts",
  liabilities: "Liabilities",
  liability: "Liabilities",
  expense: "Expense accounts",
  revenue: "Revenue accounts",
};

/** Searchable account picker that shows balance and currency for each option. */
export function AccountPicker({
  label,
  accounts,
  value,
  onChange,
  excludeId,
  placeholder = "Choose account",
}: {
  label: string;
  accounts: Resource<Account>[];
  value: string | null;
  onChange: (id: string) => void;
  excludeId?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts
      .filter((a) => a.attributes.active !== false && a.id !== excludeId)
      .filter(
        (a) =>
          !needle ||
          a.attributes.name.toLowerCase().includes(needle) ||
          (a.attributes.currency_code ?? "").toLowerCase().includes(needle),
      );
  }, [accounts, q, excludeId]);

  useEscapeDismiss(open, () => setOpen(false), "account-picker");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    searchRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(a: Resource<Account>) {
    onChange(a.id);
    setOpen(false);
    setQ("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const opt = options[active];
      if (opt) choose(opt);
    }
  }

  return (
    <div ref={root} className="relative flex flex-col gap-1.5" onKeyDown={open ? onKeyDown : undefined}>
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
        className={cn(
          "interactive-tap flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-all duration-150 active:scale-[0.98]",
          "hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none",
        )}
      >
        <span id={`${id}-value`} className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate font-medium">{selected.attributes.name}</span>
              <span className="block text-xs text-muted">
                <Money
                  amount={selected.attributes.current_balance}
                  code={selected.attributes.currency_code}
                  decimals={selected.attributes.currency_decimal_places}
                  symbol={selected.attributes.currency_symbol}
                />
              </span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        {selected?.attributes.currency_code && (
          <span className="rounded-lg bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
            {selected.attributes.currency_code}
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>

      {open && (
        <div className="popover-in absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder="Search accounts…"
              aria-label="Search accounts"
              aria-controls={`${id}-list`}
              className="h-11 flex-1 bg-transparent text-base outline-none md:text-sm"
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="max-h-72 overflow-y-auto py-1">
            {options.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">No accounts found</li>}
            {options.map((a, i) => {
              const group = GROUP_LABEL[a.attributes.type] ?? a.attributes.type;
              const prevGroup = i > 0 ? (GROUP_LABEL[options[i - 1].attributes.type] ?? options[i - 1].attributes.type) : "";
              const header = group !== prevGroup ? group : null;
              return (
                <li key={a.id} role="presentation">
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {header}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={a.id === value}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(a)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2",
                      i === active && "bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.attributes.name}</span>
                      <span className="block text-xs text-muted">
                        <Money
                          amount={a.attributes.current_balance}
                          code={a.attributes.currency_code}
                          decimals={a.attributes.currency_decimal_places}
                          symbol={a.attributes.currency_symbol}
                        />
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-muted">{a.attributes.currency_code}</span>
                    {a.id === value && <Check className="size-4 text-primary" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
