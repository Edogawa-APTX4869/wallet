"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, Pencil, Trash2 } from "lucide-react";
import type { Resource, TransactionGroup, TransactionSplit } from "@/lib/firefly/types";
import { cn, formatDate } from "@/lib/utils";
import { ICON_CATALOG, inferCategoryDefaultStyle, useResourceMeta } from "@/components/resource-icon";
import { Badge, Money } from "@/components/ui";

function signFor(split: TransactionSplit, perspectiveAccountId?: string): 1 | -1 | 0 {
  if (split.type === "withdrawal") return -1;
  if (split.type === "deposit") return 1;
  if (split.type === "transfer" && perspectiveAccountId) {
    if (split.source_id === perspectiveAccountId) return -1;
    if (split.destination_id === perspectiveAccountId) return 1;
  }
  if (split.type === "opening balance") return Number(split.amount) >= 0 ? 1 : -1;
  return 0;
}

export function buildDuplicateHref(split: TransactionSplit): string {
  const p = new URLSearchParams();
  const t = split.type === "deposit" || split.type === "transfer" ? split.type : "withdrawal";
  p.set("type", t);
  if (split.amount) p.set("amount", String(Math.abs(Number(split.amount))));
  if (split.description) p.set("description", split.description);
  if (split.category_name) p.set("category", split.category_name);
  if (t === "withdrawal") {
    if (split.source_id) p.set("sourceId", String(split.source_id));
    if (split.destination_name) p.set("counterparty", split.destination_name);
  } else if (t === "deposit") {
    if (split.destination_id) p.set("sourceId", String(split.destination_id));
    if (split.source_name) p.set("counterparty", split.source_name);
  } else {
    if (split.source_id) p.set("sourceId", String(split.source_id));
    if (split.destination_id) p.set("destId", String(split.destination_id));
  }
  if (split.budget_id) p.set("budgetId", String(split.budget_id));
  if (split.tags?.length) p.set("tags", split.tags.join(", "));
  return `/new?${p.toString()}`;
}

export function TransactionRow({
  group,
  perspectiveAccountId,
  onEdit,
  onDelete,
}: {
  group: Resource<TransactionGroup>;
  perspectiveAccountId?: string;
  onEdit?: (group: Resource<TransactionGroup>) => void;
  onDelete?: (id: string) => void;
}) {
  const meta = useResourceMeta();
  const splits = group.attributes.transactions;
  const first = splits[0];
  if (!first) return null;
  const isSplit = splits.length > 1;
  const sign = signFor(first, perspectiveAccountId);
  const total = splits.reduce((acc, s) => acc + Math.abs(Number(s.amount)), 0);
  const viewFromDest = first.type === "transfer" && perspectiveAccountId && first.destination_id === perspectiveAccountId;

  // When viewing a cross-currency transfer from the destination account, show the received (foreign) amount.
  const shownAmount = viewFromDest && first.foreign_amount ? Math.abs(Number(first.foreign_amount)) : total;
  const shownCode = viewFromDest && first.foreign_currency_code ? first.foreign_currency_code : first.currency_code;
  const shownDecimals =
    viewFromDest && first.foreign_currency_code ? first.foreign_currency_decimal_places : first.currency_decimal_places;
  const secondaryAmount = viewFromDest ? first.amount : first.foreign_amount;
  const secondaryCode = viewFromDest ? first.currency_code : first.foreign_currency_code;
  const secondaryDecimals = viewFromDest ? first.currency_decimal_places : first.foreign_currency_decimal_places;

  const catMeta =
    (first.category_id ? meta.get("category", String(first.category_id)) : undefined) ||
    (first.category_name ? meta.get("category", first.category_name) : undefined);
  const inferredCat = first.category_name ? inferCategoryDefaultStyle(first.category_name) : undefined;
  const DefaultIcon =
    first.type === "transfer" ? ArrowLeftRight : first.type === "deposit" ? ArrowDownLeft : ArrowUpRight;
  const iconName = catMeta?.icon || inferredCat?.icon;
  const iconColor = catMeta?.color || inferredCat?.color;
  const Icon = (iconName && ICON_CATALOG[iconName]) || DefaultIcon;

  return (
    <li className="group flex items-center gap-2 sm:gap-3 py-2 sm:py-2.5 min-w-0">
      <span
        style={iconColor ? { backgroundColor: `${iconColor}22`, color: iconColor } : undefined}
        className={cn(
          "flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-xl",
          !iconColor && first.type === "withdrawal" && "bg-danger-soft text-danger",
          !iconColor && first.type === "deposit" && "bg-success-soft text-success",
          !iconColor && first.type !== "withdrawal" && first.type !== "deposit" && "bg-primary-soft text-primary",
        )}
      >
        <Icon className="size-3.5 sm:size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs sm:text-sm font-medium">
          {isSplit ? group.attributes.group_title || first.description : first.description}
          {isSplit && <Badge className="ml-1.5 text-[10px] sm:text-xs">{splits.length} splits</Badge>}
        </p>
        <p className="truncate text-[11px] sm:text-xs text-muted">
          <Link href={`/accounts/${first.source_id}`} className="hover:underline">
            {first.source_name}
          </Link>
          {" → "}
          <Link href={`/accounts/${first.destination_id}`} className="hover:underline">
            {first.destination_name}
          </Link>
          {first.category_name && (
            <>
              {" · "}
              <Link
                href={`/transactions?category=${encodeURIComponent(first.category_name)}`}
                className="font-medium text-fg/80 hover:underline"
              >
                {first.category_name.replace(/\s*:\s*/g, " › ")}
              </Link>
            </>
          )}
          {" · "}
          {formatDate(first.date)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={cn("text-xs sm:text-sm font-semibold tabular", sign > 0 && "text-success", sign < 0 && "text-fg")}>
          <Money amount={sign * shownAmount || shownAmount} code={shownCode} decimals={shownDecimals} signed={sign !== 0} />
        </p>
        {secondaryAmount && secondaryCode && !isSplit && (
          <p className="text-[10px] sm:text-xs text-muted tabular">
            <Money amount={Math.abs(Number(secondaryAmount))} code={secondaryCode} decimals={secondaryDecimals} />
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(group)}
            className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg active:scale-95 transition-transform duration-120 ease-[cubic-bezier(0.16,1,0.3,1)]"
            title="Edit transaction"
            aria-label={`Edit ${first.description}`}
          >
            <Pencil className="size-3.5 sm:size-4" />
          </button>
        )}
        <Link
          href={buildDuplicateHref(first)}
          className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg active:scale-95 transition-transform duration-120 ease-[cubic-bezier(0.16,1,0.3,1)]"
          title="Duplicate transaction"
          aria-label={`Duplicate ${first.description}`}
        >
          <Copy className="size-3.5 sm:size-4" />
        </Link>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(group.id)}
            className="rounded-lg p-1 text-muted hover:bg-danger-soft hover:text-danger active:scale-95 transition-transform duration-120 ease-[cubic-bezier(0.16,1,0.3,1)]"
            title="Delete transaction"
            aria-label={`Delete ${first.description}`}
          >
            <Trash2 className="size-3.5 sm:size-4" />
          </button>
        )}
      </div>
    </li>
  );
}
