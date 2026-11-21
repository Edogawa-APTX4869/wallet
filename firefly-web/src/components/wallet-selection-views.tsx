"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, FolderTree, PiggyBank, Plus, Search, Settings, Wallet, X } from "lucide-react";
import type { Account, Budget, Category, Resource } from "@/lib/firefly/types";
import { cn } from "@/lib/utils";
import { buildCategoryTree, parseCategoryName } from "@/components/category-cascade";
import {
  ICON_CATALOG,
  inferAccountDefaultStyle,
  inferCategoryDefaultStyle,
  useResourceMeta,
} from "@/components/resource-icon";
import { Badge, Money } from "@/components/ui";
import { SwipePaginationDots } from "@/components/swipeable-widget";

function CircularEntityIcon({
  entityType,
  entityId,
  defaultIcon,
  defaultColor,
  size = "md",
}: {
  entityType: "account" | "category" | "budget";
  entityId: string;
  defaultIcon: string;
  defaultColor: string;
  size?: "md" | "lg";
}) {
  const meta = useResourceMeta();
  const item = meta.get(entityType, entityId);
  const iconName = item?.icon || defaultIcon;
  const color = item?.color || defaultColor || "#6366f1";
  const IconComp = ICON_CATALOG[iconName] ?? Wallet;

  return (
    <span
      style={{ backgroundColor: color }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white shadow-xs",
        size === "lg" ? "size-12" : "size-10",
      )}
    >
      <IconComp className={size === "lg" ? "size-5" : "size-5"} aria-hidden />
    </span>
  );
}

/**
 * Full-screen account selector pushed inside `/new` (no pop-up modal overlay).
 */
export function FullScreenAccountSelectView({
  title = "Select account",
  accounts,
  selectedId,
  excludeId,
  recentIds = [],
  allowEmpty = false,
  emptyLabel = "Any account",
  onSelect,
  onBack,
}: {
  title?: string;
  accounts: Resource<Account>[];
  selectedId: string | null;
  excludeId?: string | null;
  recentIds?: string[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  onSelect: (accountId: string) => void;
  onBack: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const eligible = useMemo(
    () => accounts.filter((a) => a.attributes.active !== false && a.id !== excludeId),
    [accounts, excludeId],
  );

  const frequentAccounts = useMemo(() => {
    const byId = new Map(eligible.map((a) => [a.id, a]));
    const ordered: Resource<Account>[] = [];
    for (const id of recentIds) {
      const acc = byId.get(id);
      if (acc && !ordered.some((x) => x.id === acc.id)) {
        ordered.push(acc);
      }
    }
    if (recentIds.length === 0 && eligible.length > 4) {
      for (const acc of eligible) {
        if (ordered.length >= 4) break;
        if (!ordered.some((x) => x.id === acc.id)) {
          ordered.push(acc);
        }
      }
    }
    return ordered.slice(0, 4);
  }, [eligible, recentIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(
      (a) =>
        a.attributes.name.toLowerCase().includes(q) ||
        (a.attributes.currency_code ?? "").toLowerCase().includes(q),
    );
  }, [eligible, query]);

  return (
    <div className="flex flex-1 flex-col bg-surface min-h-dvh lg:min-h-[560px]">
      {/* Top App Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-fg">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          {allowEmpty && selectedId && (
            <button
              type="button"
              onClick={() => onSelect("")}
              className="!min-h-0 !min-w-0 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft/80 transition"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => !o);
              if (searchOpen) setQuery("");
            }}
            aria-label="Search accounts"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Search className="size-5" />
          </button>
          <Link
            href="/accounts"
            aria-label="Manage accounts"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2">
          <Search className="size-4 text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts by name or currency…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {!query.trim() && frequentAccounts.length > 0 && (
          <div>
            <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              MOST FREQUENT
            </div>
            <div className="grid grid-cols-4 gap-2 border-b border-border bg-surface px-3 py-4">
              {frequentAccounts.map((acc, idx) => {
                const style = inferAccountDefaultStyle(acc.attributes, idx);
                const isSelected = acc.id === selectedId;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onSelect(acc.id)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-center transition hover:bg-surface-2 active:scale-95",
                      isSelected && "ring-2 ring-primary/40 bg-primary-soft/20",
                    )}
                  >
                    <CircularEntityIcon
                      entityType="account"
                      entityId={acc.id}
                      defaultIcon={style.icon}
                      defaultColor={style.color}
                      size="lg"
                    />
                    <span className="line-clamp-2 w-full text-xs font-medium text-fg leading-tight">
                      {acc.attributes.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          ALL ACCOUNTS
        </div>
        <div className="divide-y divide-border bg-surface">
          {allowEmpty && !query.trim() && (
            <button
              type="button"
              onClick={() => onSelect("")}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                !selectedId && "bg-primary-soft/20",
              )}
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                  <Wallet className="size-5" aria-hidden />
                </span>
                <span className="truncate text-sm font-medium text-fg">{emptyLabel}</span>
              </div>
              {!selectedId && <Check className="size-4 text-primary shrink-0" aria-hidden />}
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No matching accounts found.</p>
          ) : (
            filtered.map((acc, idx) => {
              const style = inferAccountDefaultStyle(acc.attributes, idx);
              const isSelected = acc.id === selectedId;
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => onSelect(acc.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                    isSelected && "bg-primary-soft/20",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <CircularEntityIcon
                      entityType="account"
                      entityId={acc.id}
                      defaultIcon={style.icon}
                      defaultColor={style.color}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">
                        {acc.attributes.name}
                      </div>
                      <div className="text-xs text-muted">{acc.attributes.currency_code}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-fg">
                      <Money
                        amount={acc.attributes.current_balance}
                        code={acc.attributes.currency_code}
                        decimals={acc.attributes.currency_decimal_places}
                        symbol={acc.attributes.currency_symbol}
                      />
                    </span>
                    {isSelected && <Check className="size-4 text-primary" aria-hidden />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * BudgetBakers Wallet-style two-level full-screen category selector:
 * - Level 1: "Category" with MOST FREQUENT strip + ALL CATEGORIES list
 * - Level 2: "{Parent}" with GENERAL row + SUBCATEGORIES list
 */
export function FullScreenCategorySelectView({
  categories,
  selectedCategory,
  frequentCategories = [],
  categoryOrder,
  allowEmpty = false,
  emptyLabel = "Any category",
  allowCreate = true,
  onSelect,
  onBack,
}: {
  categories: Resource<Category>[];
  selectedCategory: string;
  frequentCategories?: string[];
  categoryOrder?: string[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  allowCreate?: boolean;
  onSelect: (fullCategoryName: string) => void;
  onBack: () => void;
}) {
  const [activeParent, setActiveParent] = useState<string | null>(null);
  const [levelAnimDir, setLevelAnimDir] = useState<"none" | "next" | "prev">("none");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [freqPage, setFreqPage] = useState(0);
  const [freqAnimDir, setFreqAnimDir] = useState<"none" | "next" | "prev">("none");
  const [freqTouchX, setFreqTouchX] = useState<number | null>(null);

  const resolvedOrder = useMemo(() => {
    if (categoryOrder && categoryOrder.length > 0) return categoryOrder;
    if (typeof window === "undefined") return undefined;
    try {
      const raw = localStorage.getItem("wallet_categories_order");
      return raw ? (JSON.parse(raw) as string[]) : undefined;
    } catch {
      return undefined;
    }
  }, [categoryOrder]);

  const tree = useMemo(
    () => buildCategoryTree(categories, resolvedOrder),
    [categories, resolvedOrder],
  );

  const currentGroup = useMemo(() => {
    if (!activeParent) return null;
    return (
      tree.find((g) => g.parent.toLowerCase() === activeParent.toLowerCase()) ?? null
    );
  }, [tree, activeParent]);

  const freqPages = Math.max(1, Math.ceil(frequentCategories.length / 4));
  const safeFreqPage = Math.min(freqPage, freqPages - 1);
  const visibleFrequent = frequentCategories.slice(safeFreqPage * 4, safeFreqPage * 4 + 4);

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ label: string; full: string; entityId: string; icon: string; color: string }> = [];
    for (const g of tree) {
      const parentStyle = inferCategoryDefaultStyle(g.parent);
      if (g.parent.toLowerCase().includes(q)) {
        out.push({
          label: g.parent,
          full: g.parent,
          entityId: g.parentResource?.id || g.parent,
          icon: parentStyle.icon,
          color: parentStyle.color,
        });
      }
      for (const s of g.subcategories) {
        if (s.sub.toLowerCase().includes(q) || s.full.toLowerCase().includes(q)) {
          const subStyle = inferCategoryDefaultStyle(s.full);
          out.push({
            label: `${g.parent} › ${s.sub}`,
            full: s.full,
            entityId: s.resource.id || s.full,
            icon: subStyle.icon,
            color: parentStyle.color,
          });
        }
      }
    }
    return out;
  }, [tree, query]);

  const findCategoryEntityId = (fullName: string): string => {
    const found = categories.find(
      (c) => c.attributes.name.toLowerCase() === fullName.toLowerCase(),
    );
    return found?.id || fullName;
  };

  const handleHeaderBack = () => {
    if (activeParent !== null && !query.trim()) {
      setLevelAnimDir("prev");
      setActiveParent(null);
      return;
    }
    onBack();
  };

  return (
    <div className="flex flex-1 flex-col bg-surface min-h-dvh lg:min-h-[560px]">
      {/* Top App Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-fg">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleHeaderBack}
            aria-label="Back"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="truncate text-base font-semibold">
            {query.trim() ? "Search categories" : activeParent ?? "Category"}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {selectedCategory && (
            <button
              type="button"
              onClick={() => onSelect("")}
              className="!min-h-0 !min-w-0 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft/80 transition"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => !o);
              if (searchOpen) setQuery("");
            }}
            aria-label="Search categories"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Search className="size-5" />
          </button>
          <Link
            href="/categories"
            aria-label="Manage categories"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2">
          <Search className="size-4 text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories or subcategories…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {query.trim() ? (
          <div>
            <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              SEARCH RESULTS
            </div>
            <div className="divide-y divide-border bg-surface">
              {searchMatches.length === 0 && !allowCreate ? (
                <p className="px-4 py-8 text-center text-sm text-muted">No matching categories found.</p>
              ) : (
                searchMatches.map((item) => {
                  const isSelected = selectedCategory.toLowerCase() === item.full.toLowerCase();
                  return (
                    <button
                      key={item.full}
                      type="button"
                      onClick={() => onSelect(item.full)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                        isSelected && "bg-primary-soft/20",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <CircularEntityIcon
                          entityType="category"
                          entityId={item.entityId}
                          defaultIcon={item.icon}
                          defaultColor={item.color}
                        />
                        <span className="truncate text-sm font-medium text-fg">{item.label}</span>
                      </div>
                      {isSelected && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                    </button>
                  );
                })
              )}
              {allowCreate &&
                query.trim() &&
                !searchMatches.some((m) => m.full.toLowerCase() === query.trim().toLowerCase()) && (
                  <button
                    type="button"
                    onClick={() => onSelect(query.trim())}
                    className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-sm font-semibold text-primary hover:bg-primary-soft/20"
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Plus className="size-5" aria-hidden />
                    </span>
                    <span className="truncate">Use &ldquo;{query.trim()}&rdquo; as new category</span>
                  </button>
                )}
            </div>
          </div>
        ) : activeParent !== null && currentGroup ? (
          /* LEVEL 2: GENERAL + SUBCATEGORIES */
          <div
            key={`cat-level-2-${currentGroup.parent}`}
            className={cn(levelAnimDir === "next" && "animate-swipe-next")}
          >
            <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              GENERAL
            </div>
            <div className="border-b border-border bg-surface">
              {(() => {
                const parentStyle = inferCategoryDefaultStyle(currentGroup.parent);
                const parentEntityId = currentGroup.parentResource?.id || currentGroup.parent;
                const isSelected =
                  selectedCategory.toLowerCase() === currentGroup.parent.toLowerCase();
                return (
                  <button
                    type="button"
                    onClick={() => onSelect(currentGroup.parent)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                      isSelected && "bg-primary-soft/20",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <CircularEntityIcon
                        entityType="category"
                        entityId={parentEntityId}
                        defaultIcon={parentStyle.icon}
                        defaultColor={parentStyle.color}
                      />
                      <span className="truncate text-sm font-medium text-fg">
                        {currentGroup.parent}
                      </span>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                  </button>
                );
              })()}
            </div>

            {currentGroup.subcategories.length > 0 && (
              <div>
                <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  SUBCATEGORIES
                </div>
                <div className="divide-y divide-border bg-surface">
                  {currentGroup.subcategories.map((sub) => {
                    const parentStyle = inferCategoryDefaultStyle(currentGroup.parent);
                    const subStyle = inferCategoryDefaultStyle(sub.full);
                    const isSelected =
                      selectedCategory.toLowerCase() === sub.full.toLowerCase();
                    return (
                      <button
                        key={sub.full}
                        type="button"
                        onClick={() => onSelect(sub.full)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                          isSelected && "bg-primary-soft/20",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3.5">
                          <CircularEntityIcon
                            entityType="category"
                            entityId={sub.resource.id || sub.full}
                            defaultIcon={subStyle.icon}
                            defaultColor={parentStyle.color}
                          />
                          <span className="truncate text-sm font-medium text-fg">{sub.sub}</span>
                        </div>
                        {isSelected && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* LEVEL 1: MOST FREQUENT + ALL CATEGORIES */
          <div
            key="cat-level-1"
            className={cn(levelAnimDir === "prev" && "animate-swipe-prev")}
          >
            {visibleFrequent.length > 0 && (
              <div>
                <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  MOST FREQUENT
                </div>
                <div
                  className="border-b border-border bg-surface px-3 py-4 overflow-hidden"
                  onTouchStart={(e) => {
                    if (freqPages <= 1) return;
                    setFreqTouchX(e.touches[0]?.clientX ?? null);
                  }}
                  onTouchEnd={(e) => {
                    if (freqTouchX === null || freqPages <= 1) return;
                    const deltaX = (e.changedTouches[0]?.clientX ?? freqTouchX) - freqTouchX;
                    setFreqTouchX(null);
                    if (Math.abs(deltaX) > 40) {
                      const nextIdx =
                        deltaX < 0
                          ? (safeFreqPage + 1) % freqPages
                          : (safeFreqPage - 1 + freqPages) % freqPages;
                      setFreqAnimDir(deltaX < 0 ? "next" : "prev");
                      setFreqPage(nextIdx);
                    }
                  }}
                >
                  <div
                    key={safeFreqPage}
                    className={cn(
                      "grid grid-cols-4 gap-2",
                      freqAnimDir === "next" && "animate-swipe-next",
                      freqAnimDir === "prev" && "animate-swipe-prev",
                    )}
                  >
                    {visibleFrequent.map((fullName) => {
                      const parsed = parseCategoryName(fullName);
                      const style = inferCategoryDefaultStyle(fullName);
                      const isSelected =
                        selectedCategory.toLowerCase() === fullName.toLowerCase();
                      return (
                        <button
                          key={fullName}
                          type="button"
                          onClick={() => onSelect(fullName)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-center transition hover:bg-surface-2 active:scale-95",
                            isSelected && "ring-2 ring-primary/40 bg-primary-soft/20",
                          )}
                        >
                          <CircularEntityIcon
                            entityType="category"
                            entityId={findCategoryEntityId(fullName)}
                            defaultIcon={style.icon}
                            defaultColor={style.color}
                            size="lg"
                          />
                          <span className="line-clamp-2 w-full text-xs font-medium text-fg leading-tight">
                            {parsed.sub || parsed.parent}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {freqPages > 1 && (
                    <SwipePaginationDots
                      total={freqPages}
                      activeIndex={safeFreqPage}
                      onSelect={(idx) => {
                        if (idx === safeFreqPage) return;
                        setFreqAnimDir(idx > safeFreqPage ? "next" : "prev");
                        setFreqPage(idx);
                      }}
                      className="mt-2.5"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              ALL CATEGORIES
            </div>
            <div className="divide-y divide-border bg-surface">
              {allowEmpty && (
                <button
                  type="button"
                  onClick={() => onSelect("")}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                    !selectedCategory && "bg-primary-soft/20",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <FolderTree className="size-5" aria-hidden />
                    </span>
                    <span className="truncate text-sm font-medium text-fg">{emptyLabel}</span>
                  </div>
                  {!selectedCategory && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                </button>
              )}
              {tree.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">No categories available.</p>
              ) : (
                tree.map((group, idx) => {
                  const style = inferCategoryDefaultStyle(group.parent, idx);
                  const entityId = group.parentResource?.id || group.parent;
                  const hasSubs = group.subcategories.length > 0;
                  const parsedSelected = parseCategoryName(selectedCategory);
                  const isParentOrChildSelected =
                    parsedSelected.parent.toLowerCase() === group.parent.toLowerCase();

                  return (
                    <button
                      key={group.parent}
                      type="button"
                      onClick={() => {
                        if (hasSubs) {
                          setLevelAnimDir("next");
                          setActiveParent(group.parent);
                        } else {
                          onSelect(group.parent);
                        }
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                        isParentOrChildSelected && "bg-primary-soft/15",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <CircularEntityIcon
                          entityType="category"
                          entityId={entityId}
                          defaultIcon={style.icon}
                          defaultColor={style.color}
                        />
                        <span className="truncate text-sm font-medium text-fg">{group.parent}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isParentOrChildSelected && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {parsedSelected.sub || "Selected"}
                          </span>
                        )}
                        {hasSubs && (
                          <ChevronRight className="size-4 text-muted shrink-0" aria-hidden />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen Payee / Merchant / Payer & Liability selector pushed inside `/new`
 * (same design as FullScreenAccountSelectView and FullScreenCategorySelectView).
 */
export function FullScreenCounterpartySelectView({
  title = "Payee / Merchant (or Liability)",
  mode = "withdrawal",
  liabilities,
  counterpartyAccounts,
  selectedName,
  selectedLiabilityId,
  onSelect,
  onBack,
}: {
  title?: string;
  mode?: "withdrawal" | "deposit";
  liabilities: Resource<Account>[];
  counterpartyAccounts: Resource<Account>[];
  selectedName: string;
  selectedLiabilityId?: string | null;
  onSelect: (result: { name: string; liabilityAccount: Resource<Account> | null }) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const qLower = trimmedQuery.toLowerCase();

  const filteredLiabilities = useMemo(() => {
    if (!qLower) return liabilities;
    return liabilities.filter(
      (a) =>
        a.attributes.name.toLowerCase().includes(qLower) ||
        (a.attributes.currency_code ?? "").toLowerCase().includes(qLower),
    );
  }, [liabilities, qLower]);

  const filteredCounterparties = useMemo(() => {
    const liabNames = new Set(liabilities.map((l) => l.attributes.name.toLowerCase()));
    const base = counterpartyAccounts.filter(
      (a) => a.attributes.active !== false && !liabNames.has(a.attributes.name.toLowerCase()),
    );
    if (!qLower) return base;
    return base.filter((a) => a.attributes.name.toLowerCase().includes(qLower));
  }, [counterpartyAccounts, liabilities, qLower]);

  const exactMatchExists = useMemo(() => {
    if (!qLower) return true;
    return (
      liabilities.some((a) => a.attributes.name.toLowerCase() === qLower) ||
      counterpartyAccounts.some((a) => a.attributes.name.toLowerCase() === qLower)
    );
  }, [liabilities, counterpartyAccounts, qLower]);

  return (
    <div className="flex flex-1 flex-col bg-surface min-h-dvh lg:min-h-[560px]">
      {/* Top App Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-fg">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          {(selectedName || selectedLiabilityId) && (
            <button
              type="button"
              onClick={() => onSelect({ name: "", liabilityAccount: null })}
              className="!min-h-0 !min-w-0 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft/80 transition"
            >
              Clear
            </button>
          )}
          <Link
            href="/accounts?tab=liabilities"
            aria-label="Manage liabilities and accounts"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </div>

      {/* Search & Custom Name Entry Bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
        <Search className="size-4 text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmedQuery) {
              e.preventDefault();
              const matchedLiab =
                liabilities.find((a) => a.attributes.name.toLowerCase() === qLower) ?? null;
              onSelect({
                name: matchedLiab ? matchedLiab.attributes.name : trimmedQuery,
                liabilityAccount: matchedLiab,
              });
            }
          }}
          placeholder={
            mode === "withdrawal"
              ? "Search or type a new payee / merchant / liability…"
              : "Search or type a new payer / liability…"
          }
          className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="text-muted hover:text-fg"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {/* Custom merchant/payer quick-use row when typing a new name */}
        {trimmedQuery && !exactMatchExists && (
          <div className="border-b border-border bg-surface">
            <button
              type="button"
              onClick={() => onSelect({ name: trimmedQuery, liabilityAccount: null })}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Plus className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-primary">
                    Use &ldquo;{trimmedQuery}&rdquo;
                  </div>
                  <div className="text-xs text-muted">
                    {mode === "withdrawal" ? "New payee / merchant" : "New payer / revenue source"}
                  </div>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted shrink-0" aria-hidden />
            </button>
          </div>
        )}

        {/* Section 1: Liabilities & Loans */}
        {filteredLiabilities.length > 0 && (
          <div>
            <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              LIABILITIES & LOANS
            </div>
            <div className="divide-y divide-border bg-surface">
              {filteredLiabilities.map((acc, idx) => {
                const style = inferAccountDefaultStyle(acc.attributes, idx);
                const isSelected =
                  selectedLiabilityId === acc.id ||
                  selectedName.trim().toLowerCase() === acc.attributes.name.toLowerCase();
                const isCredit = acc.attributes.liability_direction === "credit";
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onSelect({ name: acc.attributes.name, liabilityAccount: acc })}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                      isSelected && "bg-primary-soft/20",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <CircularEntityIcon
                        entityType="account"
                        entityId={acc.id}
                        defaultIcon={style.icon}
                        defaultColor={style.color}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-fg">
                            {acc.attributes.name}
                          </span>
                          <Badge tone={isCredit ? "success" : "danger"} className="text-[10px]">
                            {isCredit ? "Owed to me" : "I owe"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted">
                          {mode === "deposit"
                            ? isCredit
                              ? "They paid me (reduces loan balance)"
                              : "Borrow more from liability"
                            : isCredit
                              ? "Lend to liability (increases loan balance)"
                              : "Pay towards debt (reduces debt balance)"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-fg">
                        <Money
                          amount={acc.attributes.current_balance}
                          code={acc.attributes.currency_code}
                          decimals={acc.attributes.currency_decimal_places}
                          symbol={acc.attributes.currency_symbol}
                        />
                      </span>
                      {isSelected && <Check className="size-4 text-primary" aria-hidden />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: Expense / Revenue Counterparty Accounts */}
        <div>
          <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {mode === "withdrawal" ? "PAYEES & MERCHANTS" : "PAYERS & REVENUE"}
          </div>
          <div className="divide-y divide-border bg-surface">
            {filteredCounterparties.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {trimmedQuery
                  ? `Tap "Use "${trimmedQuery}"" above to use this name.`
                  : mode === "withdrawal"
                    ? "No saved payees or merchants yet."
                    : "No saved payers yet."}
              </p>
            ) : (
              filteredCounterparties.map((acc, idx) => {
                const style = inferAccountDefaultStyle(acc.attributes, idx);
                const isSelected =
                  !selectedLiabilityId &&
                  selectedName.trim().toLowerCase() === acc.attributes.name.toLowerCase();
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onSelect({ name: acc.attributes.name, liabilityAccount: null })}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                      isSelected && "bg-primary-soft/20",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <CircularEntityIcon
                        entityType="account"
                        entityId={acc.id}
                        defaultIcon={style.icon}
                        defaultColor={style.color}
                      />
                      <span className="truncate text-sm font-medium text-fg">
                        {acc.attributes.name}
                      </span>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const BUDGET_PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#0ea5e9",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

/**
 * Full-screen budget selector pushed inside `/new`, matching the Category,
 * Account, and Payee selection sub-views.
 */
export function FullScreenBudgetSelectView({
  title = "Budget",
  budgets,
  selectedBudgetId,
  onSelect,
  onBack,
}: {
  title?: string;
  budgets: Resource<Budget>[];
  selectedBudgetId: string;
  onSelect: (budgetId: string) => void;
  onBack: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const qLower = query.trim().toLowerCase();

  const activeBudgets = useMemo(
    () => budgets.filter((b) => b.attributes.active !== false),
    [budgets],
  );

  const filteredBudgets = useMemo(() => {
    if (!qLower) return activeBudgets;
    return activeBudgets.filter((b) =>
      b.attributes.name.toLowerCase().includes(qLower),
    );
  }, [activeBudgets, qLower]);

  return (
    <div className="flex flex-1 flex-col bg-surface min-h-dvh lg:min-h-[560px]">
      {/* Top App Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-fg">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          {selectedBudgetId && (
            <button
              type="button"
              onClick={() => onSelect("")}
              className="!min-h-0 !min-w-0 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft/80 transition"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => !o);
              if (searchOpen) setQuery("");
            }}
            aria-label="Search budgets"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Search className="size-5" />
          </button>
          <Link
            href="/budgets"
            aria-label="Manage budgets"
            className="flex size-10 items-center justify-center rounded-full text-fg hover:bg-surface-2 active:scale-95 transition"
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2">
          <Search className="size-4 text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search budgets…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {/* No budget option */}
        {!qLower && (
          <div className="border-b border-border bg-surface">
            <button
              type="button"
              onClick={() => onSelect("")}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                !selectedBudgetId && "bg-primary-soft/20",
              )}
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                  <PiggyBank className="size-5" aria-hidden />
                </span>
                <span className="truncate text-sm font-medium text-muted">No budget</span>
              </div>
              {!selectedBudgetId && <Check className="size-4 text-primary shrink-0" aria-hidden />}
            </button>
          </div>
        )}

        <div>
          <div className="bg-surface-2/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {qLower ? "SEARCH RESULTS" : "ALL BUDGETS"}
          </div>
          <div className="divide-y divide-border bg-surface">
            {filteredBudgets.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {qLower ? "No matching budgets found." : "No active budgets yet."}
              </p>
            ) : (
              filteredBudgets.map((b, idx) => {
                const isSelected = selectedBudgetId === b.id;
                const spentEntry = b.attributes.spent?.[0];
                const spentAmt = spentEntry ? Math.abs(Number(spentEntry.sum || 0)) : null;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelect(b.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/70 active:bg-surface-2",
                      isSelected && "bg-primary-soft/20",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <CircularEntityIcon
                        entityType="budget"
                        entityId={b.id}
                        defaultIcon="PiggyBank"
                        defaultColor={BUDGET_PALETTE[idx % BUDGET_PALETTE.length]}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-fg">
                            {b.attributes.name}
                          </span>
                          {b.attributes.auto_budget_period && (
                            <Badge className="text-[10px] capitalize">
                              {b.attributes.auto_budget_period}
                            </Badge>
                          )}
                        </div>
                        {spentEntry && spentAmt !== null && (
                          <div className="text-xs text-muted tabular-nums">
                            Spent:{" "}
                            <Money
                              amount={spentAmt}
                              code={spentEntry.currency_code}
                              decimals={spentEntry.currency_decimal_places}
                              symbol={spentEntry.currency_symbol}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0" aria-hidden />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
