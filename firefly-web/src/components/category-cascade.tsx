"use client";

import type { Category, Resource } from "@/lib/firefly/types";
import { inferCategoryDefaultStyle, ResourceIconBadge } from "@/components/resource-icon";
import { cn } from "@/lib/utils";
import { Field, Input, Select } from "@/components/ui";

export interface ParsedCategory {
  parent: string;
  sub: string;
  full: string;
}

const SEPARATORS = /\s*(?::|\/|>|›|→)\s*/;

/**
 * Splits a Firefly III category string like `"Food: Groceries"` or `"Housing / Rent"`
 * into `{ parent: "Food", sub: "Groceries", full: "Food: Groceries" }`.
 */
export function parseCategoryName(raw?: string | null): ParsedCategory {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { parent: "", sub: "", full: "" };
  const parts = trimmed.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { parent: trimmed, sub: "", full: trimmed };
  }
  const [parent, ...rest] = parts;
  const sub = rest.join(": ");
  return { parent, sub, full: `${parent}: ${sub}` };
}

/**
 * Formats a parent category and optional subcategory into the canonical Firefly III
 * category name `"Parent: Subcategory"` (or `"Parent"` when `sub` is empty).
 */
export function formatCategoryName(parent: string, sub?: string): string {
  const p = parent.trim();
  const s = (sub ?? "").trim();
  if (!p) return s;
  if (!s) return p;
  return `${p}: ${s}`;
}

export interface CategoryTreeGroup {
  parent: string;
  parentResource: Resource<Category> | null;
  subcategories: Array<{
    sub: string;
    full: string;
    resource: Resource<Category>;
  }>;
}

/**
 * Groups flat Firefly III categories into a two-level `Category → Sub-category` tree.
 * Optionally sorts parents by a custom ordered list of parent names (falling back to alphabetical).
 */
export function buildCategoryTree(
  categories: Array<Resource<Category>> = [],
  customOrder?: string[],
): CategoryTreeGroup[] {
  const map = new Map<string, CategoryTreeGroup>();

  for (const r of categories) {
    const { parent, sub } = parseCategoryName(r.attributes.name);
    if (!parent) continue;
    let group = map.get(parent);
    if (!group) {
      group = { parent, parentResource: null, subcategories: [] };
      map.set(parent, group);
    }
    if (!sub) {
      group.parentResource = r;
    } else {
      group.subcategories.push({ sub, full: r.attributes.name, resource: r });
    }
  }

  const list = [...map.values()];
  if (customOrder && customOrder.length > 0) {
    const orderIndex = new Map(customOrder.map((name, idx) => [name.toLowerCase(), idx]));
    return list.sort((a, b) => {
      const idxA = orderIndex.has(a.parent.toLowerCase()) ? orderIndex.get(a.parent.toLowerCase())! : 999999;
      const idxB = orderIndex.has(b.parent.toLowerCase()) ? orderIndex.get(b.parent.toLowerCase())! : 999999;
      if (idxA !== idxB) return idxA - idxB;
      return a.parent.localeCompare(b.parent);
    });
  }

  return list.sort((a, b) => a.parent.localeCompare(b.parent));
}

/**
 * Two-step Category + Sub-category selector with visual icon chips (each icon is customizable
 * on the fly and persisted to the SQLite database).
 */
export function CategoryCascadeSelect({
  categories = [],
  value,
  onChange,
  compact = false,
  allowCreate = true,
}: {
  categories?: Array<Resource<Category>>;
  value: string;
  onChange: (fullCategoryName: string) => void;
  compact?: boolean;
  allowCreate?: boolean;
}) {
  const tree = buildCategoryTree(categories);
  const parsed = parseCategoryName(value);
  const currentGroup = tree.find((g) => g.parent.toLowerCase() === parsed.parent.toLowerCase());
  const subs = currentGroup?.subcategories ?? [];

  // Resolve entityId for the currently selected category so its icon can be customized right next to the input
  const matchedFullResource = categories.find(
    (c) => c.attributes.name.toLowerCase() === (parsed.full || parsed.parent).toLowerCase(),
  );
  const activeEntityId = matchedFullResource?.id || currentGroup?.parentResource?.id || parsed.full || parsed.parent;
  const activeDefaultStyle = inferCategoryDefaultStyle(parsed.full || parsed.parent);

  const handleParentChange = (nextParent: string) => {
    const cleanParent = nextParent.trim();
    if (!cleanParent) {
      onChange("");
      return;
    }
    const check = parseCategoryName(cleanParent);
    if (check.sub) {
      onChange(check.full);
      return;
    }
    onChange(cleanParent);
  };

  const handleSubChange = (nextSub: string) => {
    const cleanSub = nextSub.trim();
    if (!parsed.parent) {
      onChange(cleanSub);
      return;
    }
    onChange(formatCategoryName(parsed.parent, cleanSub));
  };

  if (compact) {
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {parsed.parent && (
          <ResourceIconBadge
            entityType="category"
            entityId={activeEntityId}
            defaultIcon={activeDefaultStyle.icon}
            defaultColor={activeDefaultStyle.color}
            size="sm"
          />
        )}
        {allowCreate ? (
          <>
            <Input
              list="cascade-parent-dl"
              value={parsed.parent}
              onChange={(e) => handleParentChange(e.target.value)}
              placeholder="Category (e.g. Food)…"
              className="min-w-36 flex-1"
            />
            <datalist id="cascade-parent-dl">
              {tree.map((g) => (
                <option key={g.parent} value={g.parent} />
              ))}
            </datalist>
            <Input
              list={`cascade-sub-dl-${parsed.parent}`}
              value={parsed.sub}
              onChange={(e) => handleSubChange(e.target.value)}
              placeholder={parsed.parent ? `Sub-category in ${parsed.parent}…` : "Sub-category (optional)…"}
              disabled={!parsed.parent}
              className="min-w-36 flex-1"
            />
            <datalist id={`cascade-sub-dl-${parsed.parent}`}>
              {subs.map((s) => (
                <option key={s.full} value={s.sub} />
              ))}
            </datalist>
          </>
        ) : (
          <>
            <Select
              value={parsed.parent}
              onChange={(e) => handleParentChange(e.target.value)}
              className="min-w-36 flex-1"
              aria-label="Category"
            >
              <option value="">Any category</option>
              {tree.map((g) => (
                <option key={g.parent} value={g.parent}>
                  {g.parent}
                </option>
              ))}
            </Select>
            <Select
              value={parsed.sub}
              onChange={(e) => handleSubChange(e.target.value)}
              disabled={!parsed.parent || subs.length === 0}
              className="min-w-36 flex-1"
              aria-label="Sub-category"
            >
              <option value="">All in {parsed.parent || "category"}</option>
              {subs.map((s) => (
                <option key={s.full} value={s.sub}>
                  {s.sub}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Visual Expense/Income Category Menu with Editable Icons */}
      {tree.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Quick category menu (tap icon to customize &amp; save to database)
            </span>
            {parsed.parent && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="text-xs font-medium text-muted hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tree.map((g, idx) => {
              const active = g.parent.toLowerCase() === parsed.parent.toLowerCase();
              const entityId = g.parentResource?.id ?? g.parent;
              const style = inferCategoryDefaultStyle(g.parent, idx);
              return (
                <div
                  key={g.parent}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleParentChange(g.parent)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleParentChange(g.parent)}
                  style={
                    active
                      ? {
                          borderColor: style.color,
                          borderLeftWidth: "4px",
                          backgroundColor: `${style.color}14`,
                        }
                      : undefined
                  }
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-xl border px-2 py-1 text-xs font-medium transition-all select-none active:scale-[0.96]",
                    active ? "text-fg shadow-xs" : "border-border bg-surface text-muted hover:border-primary/40 hover:text-fg",
                  )}
                >
                  <ResourceIconBadge
                    entityType="category"
                    entityId={entityId}
                    defaultIcon={style.icon}
                    defaultColor={style.color}
                    size="sm"
                  />
                  <span>{g.parent}</span>
                </div>
              );
            })}
          </div>

          {/* Sub-categories visual menu when a parent with sub-categories is active */}
          {subs.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-border">
              <span className="text-xs text-muted">{parsed.parent} ›</span>
              {subs.map((s, idx) => {
                const subActive = s.sub.toLowerCase() === parsed.sub.toLowerCase();
                const style = inferCategoryDefaultStyle(s.full, idx);
                return (
                  <div
                    key={s.full}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSubChange(s.sub)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleSubChange(s.sub)}
                    style={
                      subActive
                        ? {
                            borderColor: style.color,
                            borderLeftWidth: "4px",
                            backgroundColor: `${style.color}14`,
                          }
                        : undefined
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-xl border px-2 py-1 text-xs font-medium transition-all select-none active:scale-[0.96]",
                      subActive
                        ? "text-fg shadow-xs"
                        : "border-border bg-surface text-muted hover:border-primary/40 hover:text-fg",
                    )}
                  >
                    <ResourceIconBadge
                      entityType="category"
                      entityId={s.resource.id}
                      defaultIcon={style.icon}
                      defaultColor={style.color}
                      size="sm"
                    />
                    <span>{s.sub}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" hint={allowCreate ? "Pick above or type a new main category" : undefined}>
          {(id) =>
            allowCreate ? (
              <div className="flex items-center gap-2">
                {parsed.parent && (
                  <ResourceIconBadge
                    entityType="category"
                    entityId={activeEntityId}
                    defaultIcon={activeDefaultStyle.icon}
                    defaultColor={activeDefaultStyle.color}
                  />
                )}
                <Input
                  id={id}
                  list={`${id}-parent-list`}
                  value={parsed.parent}
                  onChange={(e) => handleParentChange(e.target.value)}
                  placeholder="e.g. Food, Housing, Transport"
                  autoComplete="off"
                  className="flex-1"
                />
                <datalist id={`${id}-parent-list`}>
                  {tree.map((g) => (
                    <option key={g.parent} value={g.parent} />
                  ))}
                </datalist>
              </div>
            ) : (
              <Select id={id} value={parsed.parent} onChange={(e) => handleParentChange(e.target.value)}>
                <option value="">Any category</option>
                {tree.map((g) => (
                  <option key={g.parent} value={g.parent}>
                    {g.parent}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>

        <Field
          label="Sub-category"
          hint={
            parsed.parent
              ? subs.length > 0
                ? `${subs.length} sub-categor${subs.length === 1 ? "y" : "ies"} in ${parsed.parent}`
                : allowCreate
                  ? `Type to create under ${parsed.parent}`
                  : "No sub-categories"
              : "Select a main category first"
          }
        >
          {(id) =>
            allowCreate ? (
              <>
                <Input
                  id={id}
                  list={`${id}-sub-list`}
                  value={parsed.sub}
                  onChange={(e) => handleSubChange(e.target.value)}
                  placeholder={parsed.parent ? `e.g. Groceries, Restaurants` : "Optional sub-category"}
                  disabled={!parsed.parent}
                  autoComplete="off"
                />
                <datalist id={`${id}-sub-list`}>
                  {subs.map((s) => (
                    <option key={s.full} value={s.sub} />
                  ))}
                </datalist>
              </>
            ) : (
              <Select
                id={id}
                value={parsed.sub}
                onChange={(e) => handleSubChange(e.target.value)}
                disabled={!parsed.parent || subs.length === 0}
              >
                <option value="">All in {parsed.parent || "category"}</option>
                {subs.map((s) => (
                  <option key={s.full} value={s.sub}>
                    {s.sub}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
      </div>
    </div>
  );
}
