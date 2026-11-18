import { NextRequest, NextResponse } from "next/server";
import { getKv, setKv } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { DEFAULT_DASHBOARD_PREFS, sanitizeCards, type DashboardPreferences } from "@/lib/dashboard-cards";

function read(): DashboardPreferences {
  const saved = getKv<Partial<DashboardPreferences>>("dashboard_prefs", {});
  return {
    selectedAccountIds: Array.isArray(saved.selectedAccountIds) ? saved.selectedAccountIds.map(String) : [],
    // An explicitly saved empty list means the user removed every card — respect it.
    cards: Array.isArray(saved.cards) ? sanitizeCards(saved.cards) : DEFAULT_DASHBOARD_PREFS.cards,
    ...(Array.isArray(saved.categoryOrder) ? { categoryOrder: saved.categoryOrder.map(String) } : {}),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json({ data: read() });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const body = (await req.json()) as Partial<DashboardPreferences>;
  const current = read();
  const next: DashboardPreferences = {
    selectedAccountIds: Array.isArray(body.selectedAccountIds)
      ? body.selectedAccountIds.map(String)
      : current.selectedAccountIds,
    cards: Array.isArray(body.cards) ? sanitizeCards(body.cards) : current.cards,
    ...(Array.isArray(body.categoryOrder)
      ? { categoryOrder: body.categoryOrder.map(String) }
      : current.categoryOrder
        ? { categoryOrder: current.categoryOrder }
        : {}),
  };
  setKv("dashboard_prefs", next);
  return NextResponse.json({ data: next });
}
