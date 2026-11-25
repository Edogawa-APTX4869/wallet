import { NextRequest, NextResponse } from "next/server";
import { assertSafeServerFireflyUrl, getSession, SESSION_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Transparent proxy: /api/ff/<path>?<query>  →  <firefly>/api/v1/<path>?<query>
 * The Personal Access Token lives only in the encrypted httpOnly cookie, never in browser JS.
 */
async function forward(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Not connected to Firefly III." }, { status: 401 });
  }
  let safeBaseUrl: string;
  try {
    safeBaseUrl = await assertSafeServerFireflyUrl(session.url);
  } catch (e) {
    const res = NextResponse.json(
      { message: (e as Error).message || "Session server URL is not permitted." },
      { status: 401 },
    );
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  const { path } = await params;
  if (path.some((p) => p === ".." || p.includes("/"))) {
    return NextResponse.json({ message: "Invalid path." }, { status: 400 });
  }
  const target = `${safeBaseUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const contentType = req.headers.get("content-type") || "";
  const isBinaryUpload = contentType.includes("application/octet-stream");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    Accept: "application/vnd.api+json",
  };
  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (isBinaryUpload) {
      body = await req.arrayBuffer();
      headers["Content-Type"] = "application/octet-stream";
    } else {
      const textBody = await req.text();
      if (textBody) {
        body = textBody;
        headers["Content-Type"] = "application/json";
      }
    }
  }

  try {
    const upstream = await fetch(target, { method: req.method, headers, body, cache: "no-store" });
    const text = await upstream.text();
    return new NextResponse(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { message: `Could not reach Firefly III: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
