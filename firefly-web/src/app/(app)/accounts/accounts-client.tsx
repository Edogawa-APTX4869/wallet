"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { ArrowLeftRight, Building2, CreditCard, Landmark, Plus, Search, Store, Wallet, X } from "lucide-react";
import type { Account, Resource } from "@/lib/firefly/types";
import { useAccounts, usePrimaryCurrency, useRatesToPrimary } from "@/lib/hooks";
import { cn, formatDate, isoDate } from "@/lib/utils";
import { inferAccountDefaultStyle, ResourceIconBadge } from "@/components/resource-icon";
import { CreateAccountModal } from "@/components/create-account-modal";
import { formatAccountRole } from "./[id]/account-detail-client";
import { AnimatedTabs, Badge, Button, Card, EmptyState, ErrorBox, Input, Money, PageHeader, Skeleton } from "@/components/ui";

type GroupKey = "asset" | "liabilities" | "expense" | "revenue";

const GROUPS: { key: GroupKey; label: string; icon: typeof Wallet; types: Set<string> }[] = [
  { key: "asset", label: "Asset accounts", icon: Landmark, types: new Set(["asset", "cash"]) },
  {
    key: "liabilities",
    label: "Liabilities",
    icon: CreditCard,
    types: new Set(["liability", "liabilities", "loan", "debt", "mortgage"]),
  },
  { key: "expense", label: "Expense accounts", icon: Store, types: new Set(["expense"]) },
  { key: "revenue", label: "Revenue accounts", icon: Building2, types: new Set(["revenue"]) },
];

export function AccountsClient() {
  const accountsQ = useAccounts("all");
  const primaryQ = usePrimaryCurrency();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get("tab") as GroupKey | null;
  const tab: GroupKey = GROUPS.some((g) => g.key === rawTab) ? (rawTab as GroupKey) : "asset";
  const setTab = (next: GroupKey) => router.replace(`/accounts?tab=${next}`, { scroll: false });
  const [search, setSearch] = useState("");
  const createFromQuery = searchParams.get("create") === "1" || searchParams.get("create") === "true";
  const [createOpen, setCreateOpen] = useState(false);
  const isCreateOpen = createOpen || createFromQuery;
  const handleCloseCreate = () => {
    setCreateOpen(false);
    if (createFromQuery) {
      router.replace(`/accounts?tab=${tab}`, { scroll: false });
    }
  };
  const today = isoDate();

  useEffect(() => {
    const handler = () => setCreateOpen(true);
    window.addEventListener("ff:open-create-account", handler);
    return () => window.removeEventListener("ff:open-create-account", handler);
  }, []);

  const currentGroup = GROUPS.find((g) => g.key === tab) ?? GROUPS[0];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accountsQ.data ?? [])
      .filter((a) => currentGroup.types.has(a.attributes.type))
      .filter(
        (a) =>
          !q ||
          a.attributes.name.toLowerCase().includes(q) ||
          (a.attributes.currency_code ?? "").toLowerCase().includes(q) ||
          (a.attributes.iban ?? "").toLowerCase().includes(q),
      );
  }, [accountsQ.data, currentGroup, search]);

  const codes = useMemo(
    () => filtered.map((a) => a.attributes.currency_code || "").filter(Boolean),
    [filtered],
  );
  const ratesQ = useRatesToPrimary(codes, today);
  const primary = primaryQ.data;

  // Totals per currency in the current group
  const totalsByCurrency = useMemo(() => {
    const m = new Map<string, { code: string; decimals: number; symbol?: string | null; sum: Decimal }>();
    for (const a of filtered) {
      if (a.attributes.active === false) continue;
      const code = a.attributes.currency_code || "";
      if (!code) continue;
      const cur = m.get(code) ?? {
        code,
        decimals: a.attributes.currency_decimal_places ?? 2,
        symbol: a.attributes.currency_symbol,
        sum: new Decimal(0),
      };
      cur.sum = cur.sum.plus(a.attributes.current_balance ?? 0);
      m.set(code, cur);
    }
    return [...m.values()];
  }, [filtered]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Accounts"
        subtitle="Balances across all currencies with automatic conversion to your main currency"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden /> New account
            </Button>
            <Link href="/new?type=transfer">
              <Button size="sm" variant="secondary">
                <ArrowLeftRight className="size-4" aria-hidden /> New transfer
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnimatedTabs
          tabs={GROUPS}
          activeTab={tab}
          onChange={setTab}
          ariaLabel="Account groups"
        />

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            aria-label="Search accounts"
            className={cn("pl-9", search && "pr-9")}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted transition-all hover:bg-surface-2 hover:text-fg active:scale-90"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {totalsByCurrency.length > 0 && (tab === "asset" || tab === "liabilities") && (
        <div key={`totals-${tab}`} className="animate-tab-enter flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">Active totals:</span>
          {totalsByCurrency.map((t) => (
            <Badge key={t.code} tone="primary" className="px-2.5 py-1 text-xs transition-transform hover:scale-105 select-none">
              <Money animated amount={t.sum.toString()} code={t.code} decimals={t.decimals} symbol={t.symbol} />
            </Badge>
          ))}
        </div>
      )}

      <ErrorBox error={accountsQ.error} />

      {accountsQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : filtered.length === 0 ? (
        <div key={`empty-${tab}`} className="animate-tab-enter">
          <EmptyState title={`No ${currentGroup.label.toLowerCase()} found`}>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-2">
              <Plus className="size-4" aria-hidden /> New account
            </Button>
          </EmptyState>
        </div>
      ) : (
        <div key={`grid-${tab}`} className="animate-tab-enter grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {filtered.map((acc) => (
            <AccountCard
              key={acc.id}
              acc={acc}
              primaryCode={primary?.code}
              primaryDecimals={primary?.decimal_places ?? 2}
              rateToPrimary={
                acc.attributes.currency_code ? ratesQ.data?.[acc.attributes.currency_code]?.rate?.toString() : undefined
              }
            />
          ))}
        </div>
      )}

      <CreateAccountModal
        open={isCreateOpen}
        onClose={handleCloseCreate}
        initialType={tab}
      />
    </div>
  );
}

function AccountCard({
  acc,
  primaryCode,
  primaryDecimals,
  rateToPrimary,
}: {
  acc: Resource<Account>;
  primaryCode?: string;
  primaryDecimals: number;
  rateToPrimary?: string;
}) {
  const a = acc.attributes;
  const bal = a.current_balance ?? "0";
  const inferred = inferAccountDefaultStyle(a, Number(acc.id) || 0);
  const isForeign = primaryCode && a.currency_code && a.currency_code !== primaryCode;
  const converted =
    isForeign && rateToPrimary ? new Decimal(bal).mul(rateToPrimary).toFixed(primaryDecimals) : null;

  return (
    <Link href={`/accounts/${acc.id}`} className="group block cursor-pointer">
      <Card className="card-hover-spring flex h-full flex-col justify-between gap-3 cursor-pointer group-hover:border-primary/50 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <ResourceIconBadge
              entityType="account"
              entityId={acc.id}
              defaultIcon={inferred.icon}
              defaultColor={inferred.color}
            />
            <div className="min-w-0">
              <h3 className="truncate font-semibold transition-colors group-hover:text-primary">{a.name}</h3>
              <p className="truncate text-xs text-muted">
                {formatAccountRole(a.account_role || a.liability_type || a.type)}
                {a.iban ? ` · ${a.iban}` : a.account_number ? ` · ${a.account_number}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {a.active === false && <Badge tone="warning">Inactive</Badge>}
            {a.currency_code && <Badge tone="neutral">{a.currency_code}</Badge>}
          </div>
        </div>

        <div>
          <p className="text-xl font-bold tracking-tight">
            <Money
              amount={bal}
              code={a.currency_code}
              decimals={a.currency_decimal_places}
              symbol={a.currency_symbol}
              colored={
                a.type === "asset" ||
                a.type === "liabilities" ||
                a.type === "liability" ||
                a.type === "loan" ||
                a.type === "debt" ||
                a.type === "mortgage"
              }
              animated
            />
          </p>
          {converted && primaryCode && (
            <p className="text-xs text-muted">
              ≈ <Money amount={converted} code={primaryCode} decimals={primaryDecimals} animated />
            </p>
          )}
          {a.current_balance_date && (
            <p className="mt-1 text-[11px] text-muted">As of {formatDate(a.current_balance_date)}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}
