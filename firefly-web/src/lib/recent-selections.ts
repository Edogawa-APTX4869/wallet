const OUTSIDE_SELECTED_ACCOUNTS_KEY = "ff-outside-selected-accounts";
const RECENT_ACCOUNTS_KEY = "ff-recent-account-ids";
const CATEGORY_FREQ_KEY = "ff-category-frequency";

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveOutsideSelectedAccountIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OUTSIDE_SELECTED_ACCOUNTS_KEY, JSON.stringify(ids.map(String)));
  } catch {
    // ignore storage quota errors
  }
}

export function loadOutsideSelectedAccountIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = safeParseJson<unknown>(
      window.localStorage.getItem(OUTSIDE_SELECTED_ACCOUNTS_KEY),
      [],
    );
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function loadRecentAccountIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = safeParseJson<unknown>(window.localStorage.getItem(RECENT_ACCOUNTS_KEY), []);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function pushRecentAccountId(id: string): void {
  const clean = String(id).trim();
  if (!clean || typeof window === "undefined") return;
  try {
    const prev = loadRecentAccountIds();
    const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, 20);
    window.localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/**
 * Resolves the default source account on `/new` using outside dashboard/filter selections
 * and most-recently-selected account history.
 */
export function resolveDefaultAccountId(params: {
  urlSourceId?: string | null;
  outsideSelectedIds?: string[];
  recentAccountIds?: string[];
  eligibleAccountIds: string[];
}): string | null {
  const eligible = params.eligibleAccountIds.map(String);
  if (eligible.length === 0) return null;
  const eligibleSet = new Set(eligible);

  if (params.urlSourceId && eligibleSet.has(params.urlSourceId)) {
    return params.urlSourceId;
  }

  const outsideValid = (params.outsideSelectedIds ?? [])
    .map(String)
    .filter((id) => eligibleSet.has(id));

  if (outsideValid.length === 1) {
    return outsideValid[0];
  }

  const recent = (params.recentAccountIds ?? []).map(String);

  if (outsideValid.length > 1) {
    const outsideSet = new Set(outsideValid);
    const recentOutside = recent.find((id) => outsideSet.has(id));
    if (recentOutside) return recentOutside;
    return outsideValid[outsideValid.length - 1];
  }

  const recentEligible = recent.find((id) => eligibleSet.has(id));
  if (recentEligible) return recentEligible;

  return eligible[0];
}

export function getOutsideSelectedAccountIds(
  filterContextSelectedIds?: string[],
  dashboardPrefSelectedIds?: string[],
): string[] {
  if (dashboardPrefSelectedIds && dashboardPrefSelectedIds.length > 0) {
    return dashboardPrefSelectedIds;
  }
  if (filterContextSelectedIds && filterContextSelectedIds.length > 0) {
    return filterContextSelectedIds;
  }
  return loadOutsideSelectedAccountIds();
}

export function resolveDefaultAccountForList(
  eligibleAccounts: Array<{ id: string }>,
  options?: {
    urlSourceId?: string | null;
    filterSelectedIds?: string[];
    dashboardSelectedIds?: string[];
  },
): string | null {
  const outsideSelectedIds = getOutsideSelectedAccountIds(
    options?.filterSelectedIds,
    options?.dashboardSelectedIds,
  );
  return resolveDefaultAccountId({
    urlSourceId: options?.urlSourceId,
    outsideSelectedIds,
    recentAccountIds: loadRecentAccountIds(),
    eligibleAccountIds: eligibleAccounts.map((a) => a.id),
  });
}

interface CategoryFreqEntry {
  count: number;
  lastUsed: number;
}

function loadCategoryFreqMap(): Record<string, CategoryFreqEntry> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = safeParseJson<unknown>(window.localStorage.getItem(CATEGORY_FREQ_KEY), {});
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CategoryFreqEntry>) : {};
  } catch {
    return {};
  }
}

export function recordCategoryUsage(categoryName: string): void {
  const clean = categoryName.trim();
  if (!clean || typeof window === "undefined") return;
  try {
    const map = loadCategoryFreqMap();
    const prev = map[clean] ?? { count: 0, lastUsed: 0 };
    map[clean] = { count: prev.count + 1, lastUsed: Date.now() };
    window.localStorage.setItem(CATEGORY_FREQ_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getMostFrequentCategories(allCategoryNames: string[], limit = 8): string[] {
  const unique = Array.from(new Set(allCategoryNames.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const freq = loadCategoryFreqMap();

  const used = unique
    .filter((name) => (freq[name]?.count ?? 0) > 0)
    .sort((a, b) => {
      const fa = freq[a];
      const fb = freq[b];
      const countDiff = (fb?.count ?? 0) - (fa?.count ?? 0);
      if (countDiff !== 0) return countDiff;
      return (fb?.lastUsed ?? 0) - (fa?.lastUsed ?? 0);
    });

  const unused = unique.filter((name) => (freq[name]?.count ?? 0) === 0);
  const seenParents = new Set(used.map((n) => n.split(/\s*[:/>›→]\s*/)[0].trim().toLowerCase()));
  const firstPassUnused: string[] = [];
  const remainderUnused: string[] = [];

  for (const name of unused) {
    const parent = name.split(/\s*[:/>›→]\s*/)[0].trim().toLowerCase();
    if (!seenParents.has(parent)) {
      seenParents.add(parent);
      firstPassUnused.push(name);
    } else {
      remainderUnused.push(name);
    }
  }

  return [...used, ...firstPassUnused, ...remainderUnused].slice(0, limit);
}
