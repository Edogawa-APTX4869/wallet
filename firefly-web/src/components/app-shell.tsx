"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Bell,
  ChevronDown,
  FolderTree,
  LayoutDashboard,
  List,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Plus,
  Settings,
  Sun,
  Wallet,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UniversalFilterProvider } from "@/lib/filter-context";
import { SpeedDialFab } from "@/components/speed-dial-fab";
import { MagicChatbar } from "@/components/magic-chatbar";
import { useTheme } from "@/components/theme-provider";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { PageTransition } from "@/components/page-transition";

interface NavChild {
  href: string;
  label: string;
  matchPath?: string;
  matchQuery?: Record<string, string>;
}

interface NavGroup {
  key: string;
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  matchPrefixes: string[];
  children?: NavChild[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: "dashboard",
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    matchPrefixes: ["/"],
  },
  {
    key: "accounts",
    href: "/accounts?tab=asset",
    label: "Accounts",
    icon: Wallet,
    matchPrefixes: ["/accounts"],
    children: [
      { href: "/accounts?tab=asset", label: "Asset accounts", matchPath: "/accounts", matchQuery: { tab: "asset" } },
      { href: "/accounts?tab=liabilities", label: "Liabilities", matchPath: "/accounts", matchQuery: { tab: "liabilities" } },
      { href: "/accounts?tab=expense", label: "Expense accounts", matchPath: "/accounts", matchQuery: { tab: "expense" } },
      { href: "/accounts?tab=revenue", label: "Revenue accounts", matchPath: "/accounts", matchQuery: { tab: "revenue" } },
    ],
  },
  {
    key: "transactions",
    href: "/transactions",
    label: "Transactions",
    icon: List,
    matchPrefixes: ["/transactions", "/new"],
    children: [
      { href: "/transactions", label: "All transactions", matchPath: "/transactions", matchQuery: { type: "" } },
      { href: "/new?type=transfer", label: "New transfer", matchPath: "/new", matchQuery: { type: "transfer" } },
      { href: "/new?type=withdrawal", label: "New expense", matchPath: "/new", matchQuery: { type: "withdrawal" } },
      { href: "/new?type=deposit", label: "New income", matchPath: "/new", matchQuery: { type: "deposit" } },
      { href: "/new?type=ramble", label: "Magic assistant (AI)", matchPath: "/new", matchQuery: { type: "ramble" } },
    ],
  },
  {
    key: "reports",
    href: "/reports",
    label: "Statistics & Reports",
    icon: BarChart3,
    matchPrefixes: ["/reports"],
    children: [
      { href: "/reports?tab=balance", label: "Balance & Net Worth", matchPath: "/reports", matchQuery: { tab: "balance" } },
      { href: "/reports?tab=cash-flow", label: "Cash-flow", matchPath: "/reports", matchQuery: { tab: "cash-flow" } },
      { href: "/reports?tab=spending", label: "Spending & Categories", matchPath: "/reports", matchQuery: { tab: "spending" } },
      { href: "/reports?tab=outlook", label: "30-Day Outlook", matchPath: "/reports", matchQuery: { tab: "outlook" } },
      { href: "/reports?tab=debt", label: "Credit & Debt", matchPath: "/reports", matchQuery: { tab: "debt" } },
    ],
  },
  {
    key: "automation",
    href: "/rules?tab=rules",
    label: "Automation",
    icon: Wand2,
    matchPrefixes: ["/rules"],
    children: [
      { href: "/rules?tab=rules", label: "Automatic rules", matchPath: "/rules", matchQuery: { tab: "rules" } },
      { href: "/rules?tab=recurrences", label: "Recurring transactions", matchPath: "/rules", matchQuery: { tab: "recurrences" } },
      { href: "/rules?tab=bills", label: "Bills & subscriptions", matchPath: "/rules", matchQuery: { tab: "bills" } },
    ],
  },
  {
    key: "classification",
    href: "/categories",
    label: "Classification",
    icon: FolderTree,
    matchPrefixes: ["/categories", "/budgets", "/tags", "/piggy-banks"],
    children: [
      { href: "/categories", label: "Categories & sub", matchPath: "/categories" },
      { href: "/budgets", label: "Budgets", matchPath: "/budgets" },
      { href: "/piggy-banks", label: "Piggy banks & goals", matchPath: "/piggy-banks" },
      { href: "/tags", label: "Tags & sub-tags", matchPath: "/tags" },
    ],
  },
  {
    key: "settings",
    href: "/settings",
    label: "Configuration",
    icon: Settings,
    matchPrefixes: ["/settings"],
    children: [
      { href: "/settings#currencies", label: "Currencies & decimals", matchPath: "/settings" },
      { href: "/settings#rates", label: "Exchange rates", matchPath: "/settings" },
      { href: "/settings#system", label: "Server settings", matchPath: "/settings" },
      { href: "/settings#webhooks", label: "Webhooks", matchPath: "/settings" },
    ],
  },
];

const MOBILE_NAV = [
  { href: "/", label: "Home", icon: LayoutDashboard, match: "/" },
  { href: "/accounts", label: "Accounts", icon: Wallet, match: "/accounts" },
  { href: "/transactions", label: "Records", icon: List, match: "/transactions" },
  { href: "/reports", label: "Reports", icon: BarChart3, match: "/reports" },
  { href: "/budgets", label: "Budgets", icon: PieChart, match: "/budgets" },
];

function isGroupActive(pathname: string, group: NavGroup) {
  return group.matchPrefixes.some((prefix) => (prefix === "/" ? pathname === "/" : pathname.startsWith(prefix)));
}

function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Manual overrides for category accordion toggles (collapsed by default unless currently active)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  if (collapsed) {
    return (
      <nav className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto pr-0 select-none" aria-label="Main navigation rail">
        {NAV_GROUPS.map((group) => {
          const active = isGroupActive(pathname, group);
          return (
            <Link
              key={group.key}
              href={group.href}
              onClick={onNavigate}
              aria-label={group.label}
              title={group.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex size-10 items-center justify-center rounded-xl text-muted transition-all duration-150 hover:bg-surface-2 hover:text-fg active:scale-95",
                active ? "bg-primary-soft text-primary font-bold shadow-2xs" : "",
              )}
            >
              <group.icon className="size-5 shrink-0" aria-hidden />
              {active && (
                <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  function isChildActive(child: NavChild): boolean {
    if (!child.matchPath) return false;
    if (pathname !== child.matchPath) return false;
    if (!child.matchQuery) return true;
    for (const [k, expected] of Object.entries(child.matchQuery)) {
      const actual = searchParams.get(k) ?? "";
      // Default values when query param is omitted
      const normalizedActual =
        actual ||
        (pathname === "/accounts" && k === "tab"
          ? "asset"
          : pathname === "/rules" && k === "tab"
            ? "rules"
            : pathname === "/new" && k === "type"
              ? "withdrawal"
              : "");
      if (normalizedActual !== expected) return false;
    }
    return true;
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1" aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const active = isGroupActive(pathname, group);
        const hasChildren = !!group.children?.length;
        const isOpen = openMap[group.key] ?? active;

        if (!hasChildren) {
          return (
            <Link
              key={group.key}
              href={group.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "interactive-tap flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.98]",
                active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <group.icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{group.label}</span>
            </Link>
          );
        }

        return (
          <div key={group.key} className="flex flex-col">
            <div
              className={cn(
                "flex items-center rounded-xl transition-colors",
                active ? "bg-primary-soft/60 text-primary" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Link
                href={group.href}
                onClick={() => {
                  setOpenMap((m) => ({ ...m, [group.key]: true }));
                  onNavigate?.();
                }}
                className="interactive-tap flex flex-1 items-center gap-3 py-2 pl-3 pr-1 text-sm font-semibold active:scale-[0.98] transition-transform"
              >
                <group.icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{group.label}</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpenMap((m) => ({ ...m, [group.key]: !isOpen }))}
                aria-label={`Toggle ${group.label} submenu`}
                aria-expanded={isOpen}
                className="rounded-lg p-2 hover:bg-surface-2/80 transition-all active:scale-90"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform duration-200 ease-out", isOpen ? "rotate-0" : "-rotate-90")}
                  aria-hidden
                />
              </button>
            </div>

            <div className={cn("accordion-wrapper", isOpen && "is-open")}>
              <div className="overflow-hidden">
                <ul className="mt-0.5 ml-5 flex flex-col gap-0.5 border-l border-border pl-2.5 py-0.5">
                  {group.children!.map((child) => {
                    const childActive = isChildActive(child);
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          onClick={onNavigate}
                          aria-current={childActive ? "page" : undefined}
                          className={cn(
                            "interactive-tap block rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.98]",
                            childActive
                              ? "bg-primary-soft font-semibold text-primary"
                              : "text-muted hover:bg-surface-2 hover:text-fg",
                          )}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function getScreenTitle(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/accounts")) return "Accounts";
  if (pathname.startsWith("/transactions")) return "Records";
  if (pathname.startsWith("/reports")) return "Reports";
  if (pathname.startsWith("/budgets")) return "Budgets";
  if (pathname.startsWith("/categories")) return "Categories";
  if (pathname.startsWith("/piggy-banks")) return "Piggy Banks";
  if (pathname.startsWith("/rules")) return "Automation";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/new")) return "New Transaction";
  if (pathname.startsWith("/bills")) return "Bills";
  if (pathname.startsWith("/subscriptions")) return "Subscriptions";
  if (pathname.startsWith("/tags")) return "Tags";
  return "Home";
}

export interface MobileHeaderProps {
  title?: string;
  drawerOpen?: boolean;
  onOpenMenu?: () => void;
  onOpenNotifications?: () => void;
  hasUnreadNotifications?: boolean;
}

export function MobileTopHeader({
  title = "Home",
  drawerOpen = false,
  onOpenMenu,
  onOpenNotifications,
  hasUnreadNotifications = false,
}: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/95 px-2.5 py-1.5 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav-drawer"
          className="flex min-h-[48px] min-w-[48px] size-12 items-center justify-center rounded-xl text-fg hover:bg-surface-2 active:scale-95 transition-all"
        >
          <Menu className="size-5" />
        </button>
        <span className="font-semibold text-base text-fg truncate">
          {title}
        </span>
      </div>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className="relative flex min-h-[48px] min-w-[48px] size-12 items-center justify-center rounded-xl text-muted hover:text-fg hover:bg-surface-2 active:scale-95 transition-all"
        >
          <Bell className="size-5" />
          {hasUnreadNotifications && (
            <span
              data-testid="notification-badge"
              className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-surface"
            />
          )}
        </button>
      </div>
    </header>
  );
}

export interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  serverUrl?: string;
  theme?: string;
  themeAriaLabel?: string;
  themeTitle?: string;
  onCycleTheme?: () => void;
  children?: React.ReactNode;
}

export function MobileNavDrawer({
  isOpen,
  onClose,
  serverUrl = "",
  theme,
  themeAriaLabel,
  themeTitle,
  onCycleTheme,
  children,
}: MobileDrawerProps) {
  useEscapeDismiss(isOpen, onClose, "mobile-nav-drawer");
  const [rendered, setRendered] = useState(isOpen);

  if (isOpen && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!isOpen && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 220);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, rendered]);

  if (!isOpen && !rendered) return null;

  const isClosing = !isOpen && rendered;

  return (
    <div id="mobile-nav-drawer" className="fixed inset-0 z-[60] flex md:hidden">
      <div
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-xs",
          isClosing ? "drawer-backdrop-out pointer-events-none" : "drawer-backdrop-in",
        )}
        onClick={onClose}
        aria-hidden="true"
        data-testid="drawer-backdrop"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-surface p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl will-change-transform",
          isClosing ? "drawer-slide-out pointer-events-none" : "drawer-slide-in",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" onClick={onClose} className="flex items-center gap-2 text-lg font-bold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-xs">
              <Wallet className="size-4" aria-hidden />
            </span>
            Wallet
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="flex min-h-[48px] min-w-[48px] size-12 items-center justify-center rounded-xl text-muted hover:bg-surface-2 active:scale-95 transition-all"
          >
            <X className="size-5" />
          </button>
        </div>
        {children ?? (
          <Suspense fallback={<div className="flex-1" />}>
            <SidebarNav onNavigate={onClose} />
          </Suspense>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 px-1">
          <p className="truncate text-xs text-muted" title={serverUrl}>
            {(serverUrl ?? "").replace(/^https?:\/\//, "")}
          </p>
          <button
            type="button"
            onClick={onCycleTheme}
            aria-label={themeAriaLabel}
            title={themeTitle}
            className="flex min-h-[48px] min-w-[48px] size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:text-fg active:scale-95 transition-all"
          >
            {theme === "system" && <Monitor className="size-4" aria-hidden />}
            {theme === "light" && <Sun className="size-4" aria-hidden />}
            {theme === "dark" && <Moon className="size-4" aria-hidden />}
          </button>
        </div>
      </aside>
    </div>
  );
}

function subscribeDesktopSidebar(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener("wallet-sidebar-toggle", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("wallet-sidebar-toggle", callback);
  };
}

function getDesktopSidebarSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem("wallet_desktop_sidebar") !== "false";
  } catch {
    return true;
  }
}

function getServerDesktopSidebarSnapshot(): boolean {
  return true;
}

function NotificationsSheet({
  isOpen,
  onClose,
  serverUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  serverUrl: string;
}) {
  const [rendered, setRendered] = useState(isOpen);

  if (isOpen && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!isOpen && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 220);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, rendered]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!isOpen && !rendered) return null;

  const isClosing = !isOpen && rendered;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notifications-dialog-title"
      className={cn(
        "fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-0 backdrop-blur-md sm:items-center sm:p-4",
        isClosing ? "drawer-backdrop-out pointer-events-none" : "drawer-backdrop-in",
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl",
          isClosing ? "sheet-down pointer-events-none" : "sheet-up",
        )}
      >
        {/* Mobile grab pill */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Bell className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="notifications-dialog-title" className="text-base font-bold text-fg">
                Notifications
              </h2>
              <p className="text-xs text-muted">Alerts and activity updates</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="flex min-h-[48px] min-w-[48px] size-12 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg active:scale-95 transition-all"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Bell className="size-7 stroke-[1.5] text-primary/80" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-fg">All caught up!</h3>
            <p className="mt-1 max-w-xs text-xs text-muted leading-relaxed">
              No unread notifications at this time. Upcoming recurring bills, budget alerts, and account activity will appear here.
            </p>
          </div>

          <div className="mt-2 flex w-full flex-col gap-2 rounded-xl border border-border/70 bg-surface-2/40 p-3 text-left">
            <div className="flex items-center justify-between text-xs font-medium text-fg">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success animate-pulse" />
                System Status
              </span>
              <span className="text-[11px] font-semibold text-success">
                All caught up
              </span>
            </div>
            <p className="text-[11px] text-muted truncate" title={serverUrl}>
              Server: {(serverUrl ?? "").replace(/^https?:\/\//, "")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-2 flex min-h-[48px] h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-fg hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(node, document.body);
  }
  return node;
}

export function AppShellInner({ children, serverUrl }: { children: React.ReactNode; serverUrl: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const desktopSidebarOpen = useSyncExternalStore(
    subscribeDesktopSidebar,
    getDesktopSidebarSnapshot,
    getServerDesktopSidebarSnapshot,
  );
  const { theme, resolvedTheme, cycleTheme } = useTheme();

  function toggleDesktopSidebar() {
    try {
      const current = getDesktopSidebarSnapshot();
      localStorage.setItem("wallet_desktop_sidebar", String(!current));
      window.dispatchEvent(new Event("wallet-sidebar-toggle"));
    } catch {
      // ignore in non-browser env
    }
  }

  useEscapeDismiss(drawerOpen, () => setDrawerOpen(false), "mobile-nav-drawer");
  useEscapeDismiss(notificationsOpen, () => setNotificationsOpen(false), "mobile-notifications-dialog");

  const screenTitle = getScreenTitle(pathname);

  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const currentLabel = theme === "system" ? `System (${resolvedTheme})` : theme === "light" ? "Light" : "Dark";
  const nextLabel = nextTheme === "system" ? "System" : nextTheme === "light" ? "Light" : "Dark";
  const themeTitle = `Theme: ${currentLabel} (click for ${nextLabel})`;
  const themeAriaLabel = `Current theme: ${currentLabel}. Switch to ${nextLabel} theme`;

  // Keyboard shortcuts: N = new expense, T = transfer, I = income, S = reports, / = search transactions, [ = toggle sidebar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.isComposing) return;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "[" || ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B"))) {
        e.preventDefault();
        toggleDesktopSidebar();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") router.push("/new?type=withdrawal");
      if (e.key === "t") router.push("/new?type=transfer");
      if (e.key === "i") router.push("/new?type=deposit");
      if (e.key === "s" || e.key === "S") router.push("/reports");
      if (e.key === "/") {
        e.preventDefault();
        router.push("/transactions");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Mobile top bar */}
      <MobileTopHeader
        title={screenTitle}
        drawerOpen={drawerOpen}
        onOpenMenu={() => setDrawerOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
      />

      {/* Mobile slide-over drawer with full Main + Sub menu */}
      <MobileNavDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        serverUrl={serverUrl}
        theme={theme}
        themeAriaLabel={themeAriaLabel}
        themeTitle={themeTitle}
        onCycleTheme={cycleTheme}
      />

      {/* Desktop sidebar: full w-64 when expanded, compact w-16 icon rail when collapsed */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-all duration-200 ease-in-out md:flex",
          desktopSidebarOpen
            ? "w-64 p-4"
            : "w-16 p-2 items-center",
        )}
      >
        {desktopSidebarOpen ? (
          <>
            <div className="mb-5 flex items-center justify-between px-2">
              <Link href="/" className="flex items-center gap-2 text-lg font-bold">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-xs">
                  <Wallet className="size-4" aria-hidden />
                </span>
                Wallet
              </Link>
              <button
                type="button"
                onClick={toggleDesktopSidebar}
                aria-label="Collapse side menu"
                title="Collapse side menu (Hotkey: [ or Ctrl+B)"
                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg active:scale-95 transition-all"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
            <Link
              href="/new?type=withdrawal"
              className="mb-4 flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-fg hover:opacity-90 active:scale-[0.97] transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
            >
              <Plus className="size-4" aria-hidden /> New transaction
            </Link>

            <Suspense fallback={<div className="flex-1" />}>
              <SidebarNav />
            </Suspense>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 px-1">
              <p className="truncate text-xs text-muted" title={serverUrl}>
                {serverUrl.replace(/^https?:\/\//, "")}
              </p>
              <button
                type="button"
                onClick={cycleTheme}
                aria-label={themeAriaLabel}
                title={themeTitle}
                className="flex min-h-[48px] min-w-[48px] size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:text-fg active:scale-95 transition-all"
              >
                {theme === "system" && <Monitor className="size-4" aria-hidden />}
                {theme === "light" && <Sun className="size-4" aria-hidden />}
                {theme === "dark" && <Moon className="size-4" aria-hidden />}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed Rail Header: Expand Toggle Button */}
            <div className="mb-3 flex flex-col items-center gap-2 pt-1">
              <button
                type="button"
                onClick={toggleDesktopSidebar}
                aria-label="Expand side menu"
                title="Expand side menu (Hotkey: [ or Ctrl+B)"
                className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-primary hover:bg-primary-soft active:scale-95 transition-all shadow-xs"
              >
                <PanelLeftOpen className="size-5" />
              </button>
            </div>

            {/* Collapsed Quick New Transaction Action */}
            <Link
              href="/new?type=withdrawal"
              aria-label="New transaction"
              title="New transaction (Hotkey: N)"
              className="mb-3 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-xs hover:opacity-90 active:scale-95 transition-all"
            >
              <Plus className="size-5" aria-hidden />
            </Link>

            {/* Collapsed Compact Icon Rail */}
            <Suspense fallback={<div className="flex-1" />}>
              <SidebarNav collapsed />
            </Suspense>

            {/* Collapsed Footer: Theme Toggle */}
            <div className="mt-auto flex flex-col items-center gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={cycleTheme}
                aria-label={themeAriaLabel}
                title={themeTitle}
                className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:text-fg active:scale-95 transition-all"
              >
                {theme === "system" && <Monitor className="size-4" aria-hidden />}
                {theme === "light" && <Sun className="size-4" aria-hidden />}
                {theme === "dark" && <Moon className="size-4" aria-hidden />}
              </button>
            </div>
          </>
        )}
      </aside>

      <main className="min-w-0 flex-1 px-3.5 pt-4 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 md:px-8 md:pt-7 md:pb-24 pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))]">
        <div className="mx-auto w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1720px] 3xl:max-w-[2400px] transition-all duration-150">
          {/* Desktop quick shortcut bar */}
          <div className="mb-5 hidden items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2 text-xs text-muted md:flex">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-fg">Shortcuts:</span>
              <Link href="/new?type=withdrawal" className="interactive-tap inline-flex items-center gap-1 hover:text-fg transition-all active:scale-95">
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">N</kbd> Expense
              </Link>
              <Link href="/new?type=transfer" className="interactive-tap inline-flex items-center gap-1 hover:text-fg transition-all active:scale-95">
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">T</kbd> Transfer
              </Link>
              <Link href="/new?type=deposit" className="interactive-tap inline-flex items-center gap-1 hover:text-fg transition-all active:scale-95">
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">I</kbd> Income
              </Link>
              <Link href="/transactions" className="interactive-tap inline-flex items-center gap-1 hover:text-fg transition-all active:scale-95">
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">/</kbd> Search records
              </Link>
              <Link href="/reports" className="interactive-tap inline-flex items-center gap-1 hover:text-fg transition-all active:scale-95">
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">S</kbd> Reports
              </Link>
            </div>
            <span className="text-[11px] text-muted font-mono">
              Press [ or Ctrl+B to toggle menu
            </span>
          </div>
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </main>

      {/* Notifications Modal Sheet / Dialog with smooth enter/exit animation */}
      <NotificationsSheet
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        serverUrl={serverUrl}
      />

      {/* Fast-Access Bottom AI Magic Chatbar ("Ramble" voice & text dock) */}
      <div
        aria-hidden={drawerOpen}
        className={cn("transition-opacity duration-150", drawerOpen && "max-md:hidden max-md:pointer-events-none max-md:opacity-0")}
      >
        {!drawerOpen && <MagicChatbar />}
      </div>

      {/* BudgetBakers Wallet-style Speed Dial FAB (Templates, Transfer, New Record) */}
      <div
        aria-hidden={drawerOpen}
        className={cn("transition-opacity duration-150", drawerOpen && "max-md:hidden max-md:pointer-events-none max-md:opacity-0")}
      >
        {!drawerOpen && <SpeedDialFab />}
      </div>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden select-none"
      >
        {MOBILE_NAV.map((item) => {
          const active = item.match === "/" ? pathname === "/" : pathname.startsWith(item.match);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[50px] flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-all duration-150 active:scale-90",
                active ? "font-semibold text-primary" : "text-muted hover:text-fg",
              )}
            >
              <item.icon className={cn("size-5 transition-transform duration-200", active && "scale-110")} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell({ children, serverUrl }: { children: React.ReactNode; serverUrl: string }) {
  return (
    <UniversalFilterProvider>
      <AppShellInner serverUrl={serverUrl}>{children}</AppShellInner>
    </UniversalFilterProvider>
  );
}
