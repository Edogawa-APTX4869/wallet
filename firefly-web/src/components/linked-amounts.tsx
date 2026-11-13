"use client";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { AlertTriangle, ArrowDown, Link2, Link2Off, Pencil, RotateCcw } from "lucide-react";
import { useExchangeRate } from "@/lib/hooks";
import { convert, convertBack, formatRate, impliedRate, type RateSource } from "@/lib/fx/resolve";
import { cn, parseAmount, zeroPlaceholder } from "@/lib/utils";
import { Badge, Input } from "@/components/ui";

export interface CurrencyInfo {
  code: string;
  symbol?: string;
  decimals: number;
}

export interface LinkedAmountsState {
  fromAmount: string;
  toAmount: string;
  isCross: boolean;
  /** Effective rate used (or implied by the two amounts when not auto-linked). */
  rate: Decimal | null;
  rateSource: RateSource | null;
  /** True when the rate came from user input rather than Firefly's stored rates. */
  isManualRate: boolean;
  loadingRate: boolean;
  noStoredRate: boolean;
}

/**
 * Two amount fields linked by the exchange rate stored in Firefly III.
 * Edit either side; the other recalculates. Unlink to enter both amounts exactly
 * (e.g. what your bank actually charged) and optionally save the implied rate.
 */
export function useLinkedAmounts(from: CurrencyInfo | null, to: CurrencyInfo | null, date: string) {
  const isCross = !!from?.code && !!to?.code && from.code !== to.code;
  const rateQ = useExchangeRate(isCross ? from!.code : null, isCross ? to!.code : null, date);

  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [lead, setLead] = useState<"from" | "to">("from");
  const [linked, setLinked] = useState(true);
  const [rateOverride, setRateOverride] = useState<string | null>(null);

  const stored = rateQ.data ?? null;
  const overrideDec = useMemo(() => {
    const p = rateOverride ? parseAmount(rateOverride) : "";
    return p && new Decimal(p).gt(0) ? new Decimal(p) : null;
  }, [rateOverride]);
  const linkRate: Decimal | null = !isCross ? new Decimal(1) : (overrideDec ?? stored?.rate ?? null);
  const noStoredRate = isCross && rateQ.isSuccess && !stored;
  const autoActive = isCross && linked && !!linkRate;

  const fromDec = from?.decimals ?? 2;
  const toDec = to?.decimals ?? 2;
  const fromParsed = parseAmount(fromInput);
  const toParsed = parseAmount(toInput);

  let fromAmount = fromParsed;
  let toAmount = isCross ? toParsed : fromParsed;
  if (autoActive && linkRate) {
    if (lead === "from") toAmount = fromParsed ? convert(fromParsed, linkRate, toDec) : "";
    else fromAmount = toParsed ? convertBack(toParsed, linkRate, fromDec) : "";
  }

  const effectiveRate = autoActive ? linkRate : isCross ? impliedRate(fromAmount, toAmount) : new Decimal(1);
  const isManualRate = isCross && (!!overrideDec || !autoActive);

  const state: LinkedAmountsState = {
    fromAmount,
    toAmount,
    isCross,
    rate: effectiveRate,
    rateSource: !isCross ? "identity" : isManualRate ? "manual" : (stored?.source ?? null),
    isManualRate,
    loadingRate: isCross && rateQ.isLoading,
    noStoredRate,
  };

  const controls = {
    fromValue: autoActive && lead === "to" ? fromAmount : fromInput,
    toValue: autoActive && lead === "from" ? toAmount : toInput,
    setFrom: (v: string) => {
      setFromInput(v);
      setLead("from");
    },
    setTo: (v: string) => {
      setToInput(v);
      setLead("to");
    },
    linked: autoActive,
    lead,
    canLink: isCross && !!linkRate,
    toggleLinked: () => {
      // Freeze what the user currently sees so nothing jumps.
      setFromInput(fromAmount);
      setToInput(toAmount);
      setLinked((l) => !l);
    },
    rateOverride,
    setRateOverride,
    stored,
    reset: (keepFrom?: boolean) => {
      if (!keepFrom) setFromInput("");
      setToInput("");
      setLead("from");
      setRateOverride(null);
      setLinked(true);
    },
  };
  return { state, controls };
}

const SOURCE_LABEL: Record<RateSource, string> = {
  identity: "Same currency",
  direct: "Stored rate",
  inverse: "Stored rate (inverse)",
  triangulated: "Via primary currency",
  manual: "Manual rate",
};

export function LinkedAmountFields({
  from,
  to,
  fromLabel,
  toLabel,
  linked: { state, controls },
  autoFocus,
}: {
  from: CurrencyInfo | null;
  to: CurrencyInfo | null;
  fromLabel: string;
  toLabel: string;
  linked: ReturnType<typeof useLinkedAmounts>;
  autoFocus?: boolean;
}) {
  const [editingRate, setEditingRate] = useState(false);

  const amountInput = (
    id: string,
    label: string,
    cur: CurrencyInfo | null,
    value: string,
    onChange: (v: string) => void,
    computed: boolean,
    focus?: boolean,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center justify-between text-sm font-medium">
        <span>{label}</span>
        {computed && <span className="text-xs font-normal text-primary">auto-calculated</span>}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={zeroPlaceholder(cur?.decimals ?? 2)}
          autoFocus={focus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const p = parseAmount(value);
            if (p) {
              const dec = cur?.decimals ?? 2;
              onChange(new Decimal(p).toDecimalPlaces(dec, Decimal.ROUND_HALF_UP).toFixed(dec));
            }
          }}
          className={cn("tabular h-14 pr-20 text-2xl font-semibold md:text-2xl", computed && "bg-primary-soft/40")}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-lg bg-surface-2 px-2 py-1 text-sm font-semibold text-muted">
          {cur?.code || "—"}
        </span>
      </div>
    </div>
  );

  if (!state.isCross) {
    return amountInput("amount", fromLabel, from, controls.fromValue, controls.setFrom, false, autoFocus);
  }

  const r = state.rate;
  return (
    <div className="flex flex-col gap-2">
      {amountInput("amount", fromLabel, from, controls.fromValue, controls.setFrom, controls.linked && controls.lead === "to", autoFocus)}

      {/* Rate bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm">
        <ArrowDown className="size-4 text-muted" aria-hidden />
        {state.loadingRate ? (
          <span className="text-muted">Looking up rate…</span>
        ) : editingRate ? (
          <span className="flex items-center gap-2">
            <span className="text-muted">1 {from?.code} =</span>
            <Input
              aria-label={`Exchange rate ${from?.code} to ${to?.code}`}
              inputMode="decimal"
              className="h-8 w-28 text-sm"
              autoFocus
              defaultValue={controls.rateOverride ?? (controls.stored ? controls.stored.rate.toString() : "")}
              onChange={(e) => controls.setRateOverride(e.target.value || null)}
              onBlur={() => setEditingRate(false)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && setEditingRate(false)}
            />
            <span className="text-muted">{to?.code}</span>
          </span>
        ) : r ? (
          <span className="tabular font-medium">
            1 {from?.code} = {formatRate(r)} {to?.code}
          </span>
        ) : (
          <span className="text-muted">No rate yet</span>
        )}

        {state.rateSource && !state.loadingRate && (
          <Badge tone={state.isManualRate ? "warning" : "primary"}>{SOURCE_LABEL[state.rateSource]}</Badge>
        )}
        {controls.stored && !state.isManualRate && controls.stored.date && (
          <span className="text-xs text-muted">
            {controls.stored.path.length > 2 && `${controls.stored.path.join(" → ")} · `}
            {controls.stored.date}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          {(controls.linked || state.noStoredRate) && (
            <button
              type="button"
              onClick={() => setEditingRate(true)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Edit rate for this transaction"
              title="Edit rate for this transaction"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {controls.rateOverride && (
            <button
              type="button"
              onClick={() => controls.setRateOverride(null)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Use stored rate"
              title="Use stored rate"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          {controls.canLink && (
            <button
              type="button"
              onClick={controls.toggleLinked}
              aria-pressed={controls.linked}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium",
                controls.linked ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted",
              )}
              title={controls.linked ? "Amounts are linked by the rate" : "Enter both amounts exactly"}
            >
              {controls.linked ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
              {controls.linked ? "Auto" : "Exact"}
            </button>
          )}
        </span>
      </div>

      {controls.stored?.approximate && !state.isManualRate && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden />
          No rate stored on or before this date. Using the closest later rate.
        </p>
      )}
      {state.noStoredRate && !controls.rateOverride && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden />
          No stored rate for {from?.code} → {to?.code}. Enter both amounts, or set a rate with the pencil.
        </p>
      )}

      {amountInput("foreign_amount", toLabel, to, controls.toValue, controls.setTo, controls.linked && controls.lead === "from")}
    </div>
  );
}
