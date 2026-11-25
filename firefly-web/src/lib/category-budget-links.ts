// Shared (client + server safe) helpers for Category -> Budget auto-fill links.

export const CATEGORY_BUDGET_LINKS_STORAGE_KEY = "ff_category_budget_links_v1";

/** Normalize a raw map of category name -> budget ID, discarding blank entries. */
export function sanitizeCategoryBudgetMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || (typeof v !== "string" && typeof v !== "number")) continue;
    const key = k.trim();
    const val = String(v).trim();
    if (key && val) {
      out[key] = val;
    }
  }
  return out;
}

/** Read cached category->budget links from localStorage (returns {} on SSR/unavailable). */
export function loadLocalCategoryBudgetMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CATEGORY_BUDGET_LINKS_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeCategoryBudgetMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Persist category->budget links in localStorage for offline/standalone fallback. */
export function saveLocalCategoryBudgetMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CATEGORY_BUDGET_LINKS_STORAGE_KEY,
      JSON.stringify(sanitizeCategoryBudgetMap(map)),
    );
  } catch {
    // Ignore storage quota / privacy errors
  }
}

/** Prefer server-synced prefs when available; fall back to localStorage otherwise. */
export function resolveEffectiveCategoryBudgetMap(
  serverMap?: Record<string, string> | null,
): Record<string, string> {
  if (serverMap !== undefined && serverMap !== null) {
    return sanitizeCategoryBudgetMap(serverMap);
  }
  return loadLocalCategoryBudgetMap();
}

/**
 * Resolve candidate category names from most specific to root so subcategories like
 * "Food : Groceries" or "Food:Groceries" match either an exact link or their parent "Food".
 */
function buildCategoryCandidates(rawCategory: string): string[] {
  const trimmed = rawCategory.trim();
  if (!trimmed) return [];
  const candidates: string[] = [trimmed];
  if (trimmed.includes(":")) {
    const parts = trimmed
      .split(/\s*:\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (let len = parts.length - 1; len >= 1; len--) {
      const normalized = parts.slice(0, len).join(" : ");
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    }
    let idx = trimmed.lastIndexOf(":");
    while (idx > 0) {
      const rawPrefix = trimmed.slice(0, idx).trim();
      if (rawPrefix && !candidates.includes(rawPrefix)) {
        candidates.push(rawPrefix);
      }
      idx = trimmed.lastIndexOf(":", idx - 1);
    }
  }
  return candidates;
}

/** Find the linked active budget ID for a category (case-insensitive, with parent inheritance). */
export function resolveLinkedBudgetId(params: {
  category: string;
  map?: Record<string, string> | null;
  activeBudgets?: Array<{ id: string; attributes?: { active?: boolean } }>;
}): string | null {
  const trimmed = params.category.trim();
  if (!trimmed) return null;

  const cleanMap = sanitizeCategoryBudgetMap(params.map);
  const lowerLookup = new Map<string, string>();
  for (const [cat, bId] of Object.entries(cleanMap)) {
    lowerLookup.set(cat.toLowerCase(), bId);
  }
  if (lowerLookup.size === 0) return null;

  const candidates = buildCategoryCandidates(trimmed);
  for (const candidate of candidates) {
    const candidateBudgetId = lowerLookup.get(candidate.toLowerCase());
    if (!candidateBudgetId) continue;
    if (params.activeBudgets) {
      const isValidActive = params.activeBudgets.some(
        (b) => String(b.id) === candidateBudgetId && b.attributes?.active !== false,
      );
      if (!isValidActive) continue;
    }
    return candidateBudgetId;
  }

  return null;
}

/** List sorted category names currently mapped to the given budget ID. */
export function categoriesForBudget(
  map: Record<string, string> | null | undefined,
  budgetId: string,
): string[] {
  const target = String(budgetId || "").trim();
  if (!target) return [];
  const cleanMap = sanitizeCategoryBudgetMap(map);
  return Object.entries(cleanMap)
    .filter(([, bId]) => bId === target)
    .map(([cat]) => cat)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Compute updated budget selection when a category changes on the New Transaction screen.
 * Respects any manual budget selection (including explicitly choosing "No budget").
 */
export function computeBudgetOnCategoryChange(params: {
  type: "withdrawal" | "deposit" | "transfer";
  nextCategory: string;
  currentBudgetId: string;
  budgetManuallySet: boolean;
  budgetAutoFilled: boolean;
  map?: Record<string, string> | null;
  activeBudgets?: Array<{ id: string; attributes?: { active?: boolean } }>;
}): { budgetId: string; budgetAutoFilled: boolean } {
  if (params.type !== "withdrawal" || params.budgetManuallySet) {
    return {
      budgetId: params.currentBudgetId,
      budgetAutoFilled: params.budgetAutoFilled,
    };
  }

  const linked = resolveLinkedBudgetId({
    category: params.nextCategory,
    map: params.map,
    activeBudgets: params.activeBudgets,
  });

  if (linked) {
    return { budgetId: linked, budgetAutoFilled: true };
  }

  if (params.budgetAutoFilled) {
    return { budgetId: "", budgetAutoFilled: false };
  }

  return { budgetId: params.currentBudgetId, budgetAutoFilled: false };
}
