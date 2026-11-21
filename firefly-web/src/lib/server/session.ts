import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ff_session";

export interface Session {
  /** Base URL of the Firefly III instance, without trailing slash or /api/v1. */
  url: string;
  /** Personal Access Token. */
  token: string;
}

let warned = false;
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret && !warned) {
    warned = true;
    console.warn("[firefly-web] SESSION_SECRET is not set; using an insecure development fallback.");
  }
  return createHash("sha256").update(secret || "firefly-web-dev-secret-change-me").digest();
}

export function sealSession(session: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

export function unsealSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as Session;
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const cookieSession = unsealSession(store.get(SESSION_COOKIE)?.value);
  if (cookieSession) return cookieSession;
  if (process.env.FIREFLY_URL && process.env.FIREFLY_TOKEN) {
    return {
      url: normaliseBaseUrl(process.env.FIREFLY_URL),
      token: process.env.FIREFLY_TOKEN.trim(),
    };
  }
  return null;
}

/** Normalises user input like "https://ff.example.com/api/v1/" to "https://ff.example.com". */
export function normaliseBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!url) return "";
  url = url.replace(/^(https?):\/?([^/])/i, "$1://$2");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/(profile(\/oauth)?|api(\/v1)?|login)\/?$/i, "");
  return url.replace(/\/+$/, "");
}
