import { NextRequest, NextResponse } from "next/server";
import {
  assertSafeServerFireflyUrl,
  getSession,
  sealSession,
  SESSION_COOKIE,
} from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Current connection status (never exposes the token or any pre-configured URL). */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    connected: !!session,
    url: session?.url ?? null,
  });
}

/** Connect: validates the public HTTPS URL + Personal Access Token against Firefly III and stores them. */
export async function POST(req: NextRequest) {
  let body: { url?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }
  const token = body.token
    ?.trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\r\n\t\s]+/g, "");
  const rawUrl = body.url?.trim();
  if (!rawUrl || !token) {
    return NextResponse.json({ message: "Server URL and token are required." }, { status: 422 });
  }

  let url: string;
  try {
    url = await assertSafeServerFireflyUrl(rawUrl);
  } catch (e) {
    return NextResponse.json({ message: (e as Error).message }, { status: 422 });
  }

  let about: unknown;
  let user: unknown;
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" };
    const [aboutRes, userRes] = await Promise.all([
      fetch(`${url}/api/v1/about`, { headers, cache: "no-store" }),
      fetch(`${url}/api/v1/about/user`, { headers, cache: "no-store" }),
    ]);
    if (aboutRes.status === 401 || userRes.status === 401) {
      return NextResponse.json({ message: "Firefly III rejected the token (401)." }, { status: 401 });
    }
    if (!aboutRes.ok) {
      return NextResponse.json(
        { message: `Firefly III responded with HTTP ${aboutRes.status}. Is this the right URL?` },
        { status: 502 },
      );
    }
    about = await aboutRes.json();
    user = userRes.ok ? await userRes.json() : null;
  } catch (e) {
    return NextResponse.json(
      { message: `Could not reach ${url}: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const res = NextResponse.json({ connected: true, url, about, user });
  res.cookies.set(SESSION_COOKIE, sealSession({ url, token }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}

/** Disconnect. */
export async function DELETE() {
  const res = NextResponse.json({ connected: false });
  res.cookies.delete(SESSION_COOKIE);
  res.headers.set("Clear-Site-Data", '"cookies", "storage", "cache"');
  return res;
}
