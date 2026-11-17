"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AccountFilterMode,
  type DateRange,
  type PeriodPreset,
  deserializeFilterFromQueryParams,
  filterAccountsForStats,
  getPeriodDisplayLabel,
  getPresetDateRange,
  getPriorPeriod,
  isValidPreset,
  serializeFilterToQueryParams,
  stepPeriod,
} from "./filter-presets";
import { pushRecentAccountId, saveOutsideSelectedAccountIds } from "./recent-selections";

export type { AccountFilterMode };
export {
  filterAccountsForStats,
  serializeFilterToQueryParams,
  deserializeFilterFromQueryParams,
};

export interface FilterState {
  preset: PeriodPreset;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  start: string; // alias to startDate
  end: string; // alias to endDate
  accountFilter: AccountFilterMode;
  accountFilterMode: AccountFilterMode; // alias to accountFilter
  selectedAccountIds: string[];
}

export interface UniversalFilterContextValue {
  state: FilterState;
  // Direct state accessors
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  dateRange: DateRange;
  priorPeriod: DateRange;
  accountFilter: AccountFilterMode;
  accountFilterMode: AccountFilterMode;
  selectedAccountIds: string[];
  excludeNonNetWorth: boolean;
  displayLabel: string;

  // Actions
  setPreset: (preset: PeriodPreset) => void;
  setDateRange: (start: string, end: string) => void;
  setCustomRange: (start: string, end: string) => void;
  stepPeriod: (direction: -1 | 1) => void;
  setAccountFilter: (filter: AccountFilterMode, accountIds?: string[]) => void;
  setAccountFilterMode: (mode: AccountFilterMode) => void;
  setSelectedAccountIds: (ids: string[]) => void;
  toggleAccountId: (id: string) => void;
  toggleAccount: (id: string) => void;
  setExcludeNonNetWorth: (exclude: boolean) => void;
  resetFilters: () => void;

  // Filtering helpers
  isAccountIncluded: (
    account:
      | {
          id?: string;
          attributes?: { include_net_worth?: boolean; active?: boolean };
          include_net_worth?: boolean;
        }
      | null
      | undefined,
    accountId?: string,
  ) => boolean;
  filterAccounts: <
    T extends {
      id?: string;
      attributes?: { include_net_worth?: boolean; active?: boolean };
      include_net_worth?: boolean;
    },
  >(
    accounts: T[],
  ) => T[];
}

const STORAGE_KEY = "firefly_universal_filter";

const defaultDates = getPresetDateRange("this_month");
const INITIAL_STATE: FilterState = {
  preset: "this_month",
  startDate: defaultDates.start,
  endDate: defaultDates.end,
  start: defaultDates.start,
  end: defaultDates.end,
  accountFilter: "all_stats",
  accountFilterMode: "all_stats",
  selectedAccountIds: [],
};

const UniversalFilterContext = createContext<UniversalFilterContextValue | null>(null);

function getSavedState(): Partial<FilterState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) || sessionStorage.getItem("ff_filter_state");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStateFromUrl(): Partial<FilterState> | null {
  if (typeof window === "undefined") return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    const period = sp.get("period") || sp.get("preset");
    const start = sp.get("start") || sp.get("startDate");
    const end = sp.get("end") || sp.get("endDate");
    const accountFilter =
      sp.get("accountFilter") ||
      sp.get("accountFilterMode") ||
      sp.get("account_filter");
    const accounts = sp.get("accounts") || sp.get("selectedAccounts");
    const bracketAccounts = sp.getAll("accounts[]");

    const partial: Partial<FilterState> = {};
    if (period && isValidPreset(period)) {
      partial.preset = period;
    }
    if (start && end) {
      partial.startDate = start;
      partial.endDate = end;
      if (!partial.preset) partial.preset = "custom";
    }
    if (accountFilter === "all" || accountFilter === "all_stats" || accountFilter === "custom") {
      partial.accountFilter = accountFilter;
    }
    if (bracketAccounts.length > 0) {
      partial.selectedAccountIds = bracketAccounts;
    } else if (accounts) {
      partial.selectedAccountIds = accounts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Object.keys(partial).length > 0) {
      return partial;
    }
  } catch {
    // Ignore URL parse errors
  }
  return null;
}

export interface UniversalFilterProviderProps {
  children: React.ReactNode;
  initialState?: Partial<FilterState>;
}

export function UniversalFilterProvider({ children, initialState }: UniversalFilterProviderProps) {
  const [state, setState] = useState<FilterState>(() => {
    const base: FilterState = {
      ...INITIAL_STATE,
      ...initialState,
    };
    base.start = base.startDate;
    base.end = base.endDate;
    base.accountFilterMode = base.accountFilter;
    return base;
  });

  const isMountedRef = useRef(false);

  // Sync from URL or sessionStorage after mount
  useEffect(() => {
    const urlState = getStateFromUrl();
    const savedState = getSavedState();
    const restored = urlState || savedState;

    if (restored) {
      queueMicrotask(() => {
        setState((prev) => {
          const nextPreset =
            restored.preset && isValidPreset(restored.preset) ? restored.preset : prev.preset;
          let nextStart = restored.startDate || (restored as { start?: string }).start;
          let nextEnd = restored.endDate || (restored as { end?: string }).end;

          if (!nextStart || !nextEnd) {
            const computed = getPresetDateRange(nextPreset);
            nextStart = computed.start;
            nextEnd = computed.end;
          }

          const nextFilter =
            restored.accountFilter === "all" ||
            restored.accountFilter === "all_stats" ||
            restored.accountFilter === "custom"
              ? restored.accountFilter
              : (restored as { accountFilterMode?: AccountFilterMode }).accountFilterMode ||
                prev.accountFilter;

          const nextSelected = Array.isArray(restored.selectedAccountIds)
            ? restored.selectedAccountIds
            : prev.selectedAccountIds;

          return {
            preset: nextPreset,
            startDate: nextStart,
            endDate: nextEnd,
            start: nextStart,
            end: nextEnd,
            accountFilter: nextFilter,
            accountFilterMode: nextFilter,
            selectedAccountIds: nextSelected,
          };
        });
      });
    }
    isMountedRef.current = true;
  }, []);

  // Listen for browser navigation (back/forward)
  useEffect(() => {
    function handlePopState() {
      const fromUrl = getStateFromUrl();
      if (fromUrl) {
        setState((prev) => {
          const nextPreset = fromUrl.preset || prev.preset;
          const nextStart = fromUrl.startDate || prev.startDate;
          const nextEnd = fromUrl.endDate || prev.endDate;
          const nextFilter = fromUrl.accountFilter || prev.accountFilter;
          const nextSelected = fromUrl.selectedAccountIds || prev.selectedAccountIds;
          return {
            preset: nextPreset,
            startDate: nextStart,
            endDate: nextEnd,
            start: nextStart,
            end: nextEnd,
            accountFilter: nextFilter,
            accountFilterMode: nextFilter,
            selectedAccountIds: nextSelected,
          };
        });
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Persist state to sessionStorage and URL query params
  useEffect(() => {
    if (!isMountedRef.current || typeof window === "undefined") return;

    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          preset: state.preset,
          startDate: state.startDate,
          endDate: state.endDate,
          accountFilter: state.accountFilter,
          selectedAccountIds: state.selectedAccountIds,
        }),
      );
    } catch {
      // sessionStorage full or unavailable
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("period", state.preset);
      url.searchParams.set("start", state.startDate);
      url.searchParams.set("end", state.endDate);
      if (state.accountFilter !== "all_stats") {
        url.searchParams.set("accountFilter", state.accountFilter);
      } else {
        url.searchParams.delete("accountFilter");
      }
      if (state.selectedAccountIds.length > 0) {
        url.searchParams.set("accounts", state.selectedAccountIds.join(","));
      } else {
        url.searchParams.delete("accounts");
      }
      window.history.replaceState(null, "", url.toString());
    } catch {
      // replaceState error
    }
  }, [state]);

  const setPreset = useCallback((preset: PeriodPreset) => {
    if (preset === "custom") {
      setState((prev) => ({
        ...prev,
        preset: "custom",
      }));
      return;
    }
    const range = getPresetDateRange(preset);
    setState((prev) => ({
      ...prev,
      preset,
      startDate: range.start,
      endDate: range.end,
      start: range.start,
      end: range.end,
    }));
  }, []);

  const setDateRange = useCallback((start: string, end: string) => {
    setState((prev) => ({
      ...prev,
      preset: "custom",
      startDate: start,
      endDate: end,
      start,
      end,
    }));
  }, []);

  const stepPeriodAction = useCallback((direction: -1 | 1) => {
    setState((prev) => {
      const nextRange = stepPeriod(prev.preset, prev.startDate, prev.endDate, direction);
      return {
        ...prev,
        startDate: nextRange.start,
        endDate: nextRange.end,
        start: nextRange.start,
        end: nextRange.end,
      };
    });
  }, []);

  const setAccountFilter = useCallback(
    (filter: AccountFilterMode, accountIds?: string[]) => {
      setState((prev) => ({
        ...prev,
        accountFilter: filter,
        accountFilterMode: filter,
        selectedAccountIds: accountIds !== undefined ? accountIds : prev.selectedAccountIds,
      }));
    },
    [],
  );

  const setAccountFilterMode = useCallback((mode: AccountFilterMode) => {
    setState((prev) => ({
      ...prev,
      accountFilter: mode,
      accountFilterMode: mode,
    }));
  }, []);

  const setSelectedAccountIds = useCallback((ids: string[]) => {
    if (ids.length > 0) {
      pushRecentAccountId(ids[ids.length - 1]);
    }
    saveOutsideSelectedAccountIds(ids);
    setState((prev) => ({
      ...prev,
      selectedAccountIds: ids,
    }));
  }, []);

  const toggleAccountId = useCallback((id: string) => {
    setState((prev) => {
      const exists = prev.selectedAccountIds.includes(id);
      const updated = exists
        ? prev.selectedAccountIds.filter((item) => item !== id)
        : [...prev.selectedAccountIds, id];
      if (!exists) {
        pushRecentAccountId(id);
      }
      saveOutsideSelectedAccountIds(updated);
      return {
        ...prev,
        accountFilter: "custom",
        accountFilterMode: "custom",
        selectedAccountIds: updated,
      };
    });
  }, []);

  const setExcludeNonNetWorth = useCallback((exclude: boolean) => {
    setState((prev) => ({
      ...prev,
      accountFilter: exclude ? "all_stats" : "all",
      accountFilterMode: exclude ? "all_stats" : "all",
    }));
  }, []);

  const resetFilters = useCallback(() => {
    const range = getPresetDateRange("this_month");
    setState({
      preset: "this_month",
      startDate: range.start,
      endDate: range.end,
      start: range.start,
      end: range.end,
      accountFilter: "all_stats",
      accountFilterMode: "all_stats",
      selectedAccountIds: [],
    });
  }, []);

  const isAccountIncluded = useCallback(
    (
      account:
        | {
            id?: string;
            attributes?: { include_net_worth?: boolean; active?: boolean };
            include_net_worth?: boolean;
          }
        | null
        | undefined,
      accountId?: string,
    ): boolean => {
      if (!account && !accountId) return false;
      const id = accountId || (account as { id?: string })?.id;
      const includeNetWorth =
        (account as { attributes?: { include_net_worth?: boolean } })?.attributes
          ?.include_net_worth ??
        (account as { include_net_worth?: boolean })?.include_net_worth;

      if (state.accountFilter === "all_stats") {
        return includeNetWorth !== false;
      }
      if (state.accountFilter === "all") {
        return true;
      }
      if (state.accountFilter === "custom") {
        return id ? state.selectedAccountIds.includes(String(id)) : false;
      }
      return true;
    },
    [state.accountFilter, state.selectedAccountIds],
  );

  const filterAccounts = useCallback(
    <
      T extends {
        id?: string;
        attributes?: { include_net_worth?: boolean; active?: boolean };
        include_net_worth?: boolean;
      },
    >(
      accounts: T[],
    ): T[] => {
      return accounts.filter((acc) => isAccountIncluded(acc));
    },
    [isAccountIncluded],
  );

  const contextValue: UniversalFilterContextValue = useMemo(() => {
    const prior = getPriorPeriod(state.startDate, state.endDate);
    const label = getPeriodDisplayLabel(state.preset, state.startDate, state.endDate);

    return {
      state,
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      start: state.startDate,
      end: state.endDate,
      dateRange: {
        start: state.startDate,
        end: state.endDate,
        startDate: state.startDate,
        endDate: state.endDate,
      },
      priorPeriod: prior,
      accountFilter: state.accountFilter,
      accountFilterMode: state.accountFilterMode,
      selectedAccountIds: state.selectedAccountIds,
      excludeNonNetWorth: state.accountFilter === "all_stats",
      displayLabel: label,

      setPreset,
      setDateRange,
      setCustomRange: setDateRange,
      stepPeriod: stepPeriodAction,
      setAccountFilter,
      setAccountFilterMode,
      setSelectedAccountIds,
      toggleAccountId,
      toggleAccount: toggleAccountId,
      setExcludeNonNetWorth,
      resetFilters,
      isAccountIncluded,
      filterAccounts,
    };
  }, [
    state,
    setPreset,
    setDateRange,
    stepPeriodAction,
    setAccountFilter,
    setAccountFilterMode,
    setSelectedAccountIds,
    toggleAccountId,
    setExcludeNonNetWorth,
    resetFilters,
    isAccountIncluded,
    filterAccounts,
  ]);

  return (
    <UniversalFilterContext.Provider value={contextValue}>
      {children}
    </UniversalFilterContext.Provider>
  );
}

export function useUniversalFilter(): UniversalFilterContextValue {
  const ctx = useContext(UniversalFilterContext);
  if (!ctx) {
    throw new Error("useUniversalFilter must be used within a UniversalFilterProvider");
  }
  return ctx;
}
