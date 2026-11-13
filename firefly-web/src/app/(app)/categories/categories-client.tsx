"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Category, SpentEntry } from "@/lib/firefly/types";
import { buildCategoryTree, formatCategoryName, type CategoryTreeGroup } from "@/components/category-cascade";
import { inferCategoryDefaultStyle, ResourceIconBadge } from "@/components/resource-icon";
import { monthRange, cn } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Money, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

const CATEGORY_ORDER_STORAGE_KEY = "wallet_categories_order";

function getStoredCategoryOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredCategoryOrder(order: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

function mergeTotals(list: Array<SpentEntry[]>): SpentEntry[] {
  const byCur = new Map<string, { code: string; symbol?: string; decimals?: number; sum: Decimal }>();
  for (const arr of list) {
    for (const item of arr) {
      const code = item.currency_code;
      const prev = byCur.get(code) ?? {
        code,
        symbol: item.currency_symbol,
        decimals: item.currency_decimal_places,
        sum: new Decimal(0),
      };
      prev.sum = prev.sum.plus(new Decimal(item.sum || 0).abs());
      byCur.set(code, prev);
    }
  }
  return [...byCur.values()].map((x) => ({
    currency_code: x.code,
    currency_symbol: x.symbol,
    currency_decimal_places: x.decimals,
    sum: x.sum.toString(),
  }));
}

export function CategoriesClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const range = useMemo(() => monthRange(0), []);

  const categoriesQ = useQuery({
    queryKey: ["categories", range.start, range.end],
    queryFn: () => api.categories(range.start, range.end),
  });

  const [newParent, setNewParent] = useState("");
  const [newSub, setNewSub] = useState("");
  const [quickAddUnderParent, setQuickAddUnderParent] = useState<string | null>(null);
  const [quickSubName, setQuickSubName] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEscapeDismiss(quickAddUnderParent !== null, () => setQuickAddUnderParent(null), "categories-quick-add");
  useEscapeDismiss(editId !== null, () => setEditId(null), "categories-edit");
  const [parentOrder, setParentOrder] = useState<string[]>(() => getStoredCategoryOrder());
  const [draggingParent, setDraggingParent] = useState<string | null>(null);
  const [dragOverParent, setDragOverParent] = useState<string | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["categories-list"] });
  };

  const createMut = useMutation({
    mutationFn: async (payload: { parent: string; sub?: string }) => {
      const fullName = formatCategoryName(payload.parent, payload.sub);
      if (!fullName) throw new Error("Enter a category name.");
      // Also ensure the parent category exists as a top-level item if creating a sub-category
      const existingNames = new Set((categoriesQ.data ?? []).map((c) => c.attributes.name.toLowerCase()));
      if (payload.sub?.trim() && !existingNames.has(payload.parent.trim().toLowerCase())) {
        try {
          await api.createCategory(payload.parent.trim());
        } catch {
          /* ignore if already exists */
        }
      }
      return api.createCategory(fullName);
    },
    onSuccess: (_res, payload) => {
      toast(`Created "${formatCategoryName(payload.parent, payload.sub)}"`);
      setNewParent("");
      setNewSub("");
      setQuickAddUnderParent(null);
      setQuickSubName("");
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateCategory(id, name.trim()),
    onSuccess: () => {
      toast("Category updated");
      setEditId(null);
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      toast("Category deleted", "info");
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const items = categoriesQ.data ?? [];
  const tree = useMemo(() => buildCategoryTree(items, parentOrder), [items, parentOrder]);

  const moveCategory = (fromParent: string, toParent: string) => {
    if (fromParent === toParent) return;
    const allParents = tree.map((g) => g.parent);
    const fromIdx = allParents.indexOf(fromParent);
    const toIdx = allParents.indexOf(toParent);
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = [...allParents];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setParentOrder(newOrder);
    saveStoredCategoryOrder(newOrder);
    toast(`Reordered "${fromParent}"`);
  };

  const allCollapsed = tree.length > 0 && tree.every((g) => collapsedParents.has(g.parent));

  const toggleCollapse = (parent: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  };

  const toggleCollapseAll = () => {
    if (allCollapsed) {
      setCollapsedParents(new Set());
    } else {
      setCollapsedParents(new Set(tree.map((g) => g.parent)));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Categories & Sub-categories"
        subtitle={`Hierarchical categories (Category → Sub-category) · Totals for ${range.label}`}
        actions={
          tree.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={toggleCollapseAll}>
              {allCollapsed ? (
                <>
                  <ChevronsUpDown className="size-4" aria-hidden /> Expand all
                </>
              ) : (
                <>
                  <ChevronsDownUp className="size-4" aria-hidden /> Collapse all
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-border bg-surface p-3.5 sm:p-4 shadow-2xs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate({ parent: newParent, sub: newSub });
          }}
          className="grid items-center gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Field label="Main Category" hint="Pick an existing category or type a new one">
            {(id) => (
              <>
                <Input
                  id={id}
                  list={`${id}-parents`}
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                  placeholder="e.g. Food, Housing, Transport"
                  required
                  autoComplete="off"
                />
                <datalist id={`${id}-parents`}>
                  {tree.map((g) => (
                    <option key={g.parent} value={g.parent} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Sub-category (optional)" hint="Leave empty to create only the main category">
            {(id) => (
              <Input
                id={id}
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="e.g. Groceries, Restaurants, Rent"
                autoComplete="off"
              />
            )}
          </Field>

          <div className="flex sm:self-center sm:pt-0">
            <Button
              type="submit"
              loading={createMut.isPending}
              className="h-11 min-h-[44px] w-full px-5 text-sm font-semibold sm:w-auto"
            >
              <Plus className="size-4" aria-hidden />{" "}
              {newSub.trim() ? `Add "${formatCategoryName(newParent || "Category", newSub)}"` : "Add Category"}
            </Button>
          </div>
        </form>
      </div>

      <ErrorBox error={categoriesQ.error} />

      {categoriesQ.isLoading ? (
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </Card>
      ) : tree.length === 0 ? (
        <Card>
          <EmptyState title="No categories yet">
            Create a main category (e.g. <strong>Food</strong>) and sub-categories (e.g. <strong>Groceries</strong>,{" "}
            <strong>Dining Out</strong>) above.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {tree.map((group) => {
            const parentRes = group.parentResource;
            const allSpent = mergeTotals([
              parentRes?.attributes.spent ?? [],
              ...group.subcategories.map((s) => s.resource.attributes.spent ?? []),
            ]);
            const allEarned = mergeTotals([
              parentRes?.attributes.earned ?? [],
              ...group.subcategories.map((s) => s.resource.attributes.earned ?? []),
            ]);
            const isEditingParent = parentRes && editId === parentRes.id;
            const isCollapsed = collapsedParents.has(group.parent);
            const isDropTarget = dragOverParent === group.parent && draggingParent !== group.parent;

            return (
              <Card
                key={group.parent}
                className={cn(
                  "flex flex-col gap-3 transition-all duration-150",
                  isDropTarget && "border-primary bg-primary-soft/10 ring-2 ring-primary/40",
                  draggingParent === group.parent && "opacity-50",
                )}
                onDragOver={(e) => {
                  if (draggingParent && draggingParent !== group.parent) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverParent(group.parent);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverParent === group.parent) {
                    setDragOverParent(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingParent && draggingParent !== group.parent) {
                    moveCategory(draggingParent, group.parent);
                  }
                  setDraggingParent(null);
                  setDragOverParent(null);
                }}
              >
                {/* Parent Category Header */}
                <div
                  className={cn(
                    "flex items-center justify-between gap-2",
                    (!isCollapsed || quickAddUnderParent === group.parent) && "border-b border-border pb-3",
                  )}
                >
                  {isEditingParent ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        updateMut.mutate({ id: parentRes.id, name: editName });
                      }}
                      className="flex flex-1 items-center gap-2"
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Category name"
                        autoFocus
                      />
                      <Button type="submit" size="icon" variant="primary" aria-label="Save">
                        <Check className="size-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditId(null)} aria-label="Cancel">
                        <X className="size-4" />
                      </Button>
                    </form>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                      {/* Drag handle */}
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", group.parent);
                          setDraggingParent(group.parent);
                        }}
                        onDragEnd={() => {
                          setDraggingParent(null);
                          setDragOverParent(null);
                        }}
                        aria-label={`Drag to reorder ${group.parent}`}
                        title="Drag to reorder category"
                        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted/70 hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" />
                      </button>

                      {/* Collapse / Expand toggle */}
                      <button
                        type="button"
                        onClick={() => toggleCollapse(group.parent)}
                        aria-label={isCollapsed ? `Expand ${group.parent}` : `Collapse ${group.parent}`}
                        aria-expanded={!isCollapsed}
                        title={isCollapsed ? "Expand category" : "Collapse category"}
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-4" aria-hidden />
                        ) : (
                          <ChevronDown className="size-4" aria-hidden />
                        )}
                      </button>

                      <ResourceIconBadge
                        entityType="category"
                        entityId={parentRes?.id ?? group.parent}
                        defaultIcon={inferCategoryDefaultStyle(group.parent).icon}
                        defaultColor={inferCategoryDefaultStyle(group.parent).color}
                      />

                      <button
                        type="button"
                        onClick={() => toggleCollapse(group.parent)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <h2 className="truncate font-semibold text-sm sm:text-base text-fg">{group.parent}</h2>
                          <Badge tone="neutral" className="text-[11px] px-1.5 py-0">
                            {group.subcategories.length}
                          </Badge>
                        </div>
                        <TotalsInline spent={allSpent} earned={allEarned} labelPrefix="Total " />
                      </button>
                    </div>
                  )}

                  {!isEditingParent && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => {
                          if (isCollapsed) toggleCollapse(group.parent);
                          setQuickAddUnderParent(
                            quickAddUnderParent === group.parent ? null : group.parent,
                          );
                          setQuickSubName("");
                        }}
                        aria-label={`Add sub-category under ${group.parent}`}
                        title="Add sub-category"
                        className="size-8 min-h-8 min-w-8 rounded-lg p-0"
                      >
                        <Plus className="size-4" aria-hidden />
                      </Button>
                      {parentRes && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditId(parentRes.id);
                              setEditName(parentRes.attributes.name);
                            }}
                            aria-label={`Rename ${group.parent}`}
                            title="Rename category"
                            className="size-8 min-h-8 min-w-8 rounded-lg p-0"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => delMut.mutate(parentRes.id)}
                            aria-label={`Delete ${group.parent}`}
                            title="Delete category"
                            className="size-8 min-h-8 min-w-8 rounded-lg p-0"
                          >
                            <Trash2 className="size-3.5 text-danger" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick inline add sub-category under this parent */}
                {quickAddUnderParent === group.parent && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createMut.mutate({ parent: group.parent, sub: quickSubName });
                    }}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2.5"
                  >
                    <span className="text-xs font-medium text-muted">{group.parent} :</span>
                    <Input
                      value={quickSubName}
                      onChange={(e) => setQuickSubName(e.target.value)}
                      placeholder="New sub-category name…"
                      className="h-9 flex-1"
                      autoFocus
                      required
                    />
                    <Button type="submit" size="sm" loading={createMut.isPending}>
                      <Check className="size-3.5" aria-hidden /> Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setQuickAddUnderParent(null)}>
                      Cancel
                    </Button>
                  </form>
                )}

                {/* Sub-categories list (hidden when collapsed) */}
                {!isCollapsed && (
                  group.subcategories.length === 0 ? (
                    <p className="pl-2 text-xs text-muted">
                      No sub-categories under <strong>{group.parent}</strong> yet. Tap <strong>+</strong> to create one.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border pl-4">
                      {group.subcategories.map(({ sub, full, resource }) => {
                        const isEditingSub = editId === resource.id;
                        const spent = resource.attributes.spent ?? [];
                        const earned = resource.attributes.earned ?? [];
                        return (
                          <li key={resource.id} className="flex items-center justify-between gap-2 py-2.5">
                            {isEditingSub ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  updateMut.mutate({ id: resource.id, name: formatCategoryName(group.parent, editName) });
                                }}
                                className="flex flex-1 items-center gap-2"
                              >
                                <span className="text-xs font-medium text-muted">{group.parent} :</span>
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  aria-label="Sub-category name"
                                  autoFocus
                                />
                                <Button type="submit" size="icon" variant="primary" aria-label="Save">
                                  <Check className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setEditId(null)}
                                  aria-label="Cancel"
                                >
                                  <X className="size-4" />
                                </Button>
                              </form>
                            ) : (
                              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                <ResourceIconBadge
                                  entityType="category"
                                  entityId={resource.id}
                                  defaultIcon={inferCategoryDefaultStyle(full).icon}
                                  defaultColor={inferCategoryDefaultStyle(full).color}
                                  size="sm"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 text-sm">
                                    <span className="hidden sm:inline text-muted">{group.parent}</span>
                                    <ChevronRight className="hidden sm:inline size-3.5 text-muted" aria-hidden />
                                    <span className="truncate font-medium">{sub}</span>
                                  </div>
                                  <TotalsInline spent={spent} earned={earned} />
                                </div>
                              </div>
                            )}

                            {!isEditingSub && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditId(resource.id);
                                    setEditName(sub);
                                  }}
                                  aria-label={`Rename ${full}`}
                                  className="size-8 min-h-8 min-w-8 rounded-lg p-0"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => delMut.mutate(resource.id)}
                                  aria-label={`Delete ${full}`}
                                  className="size-8 min-h-8 min-w-8 rounded-lg p-0"
                                >
                                  <Trash2 className="size-3.5 text-danger" />
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TotalsInline({
  spent,
  earned,
  labelPrefix = "",
}: {
  spent: Category["spent"];
  earned: Category["earned"];
  labelPrefix?: string;
}) {
  if ((!spent || spent.length === 0) && (!earned || earned.length === 0)) return null;
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {spent?.map((s) => (
        <span key={`s-${s.currency_code}`}>
          {labelPrefix}Spent:{" "}
          <Money amount={Math.abs(Number(s.sum))} code={s.currency_code} decimals={s.currency_decimal_places} />
        </span>
      ))}
      {earned?.map((e) => (
        <span key={`e-${e.currency_code}`} className="text-success">
          {labelPrefix}Earned:{" "}
          <Money amount={Math.abs(Number(e.sum))} code={e.currency_code} decimals={e.currency_decimal_places} />
        </span>
      ))}
    </div>
  );
}
