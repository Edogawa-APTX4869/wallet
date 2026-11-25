import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cookies } from "next/headers";
import { isDisallowedIpAddress, validatePublicFireflyUrl } from "@/lib/firefly/url-validation";

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
    parsed.url = validatePublicFireflyUrl(parsed.url);
    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return unsealSession(store.get(SESSION_COOKIE)?.value);
}

/** Validates public HTTPS URL syntax and verifies DNS resolution does not point to private/internal IPs. */
export async function assertSafeServerFireflyUrl(rawUrl: string): Promise<string> {
  const url = validatePublicFireflyUrl(rawUrl);
  if (process.env.NODE_ENV !== "test") {
    const hostname = new URL(url).hostname;
    let records: Array<{ address: string }>;
    try {
      records = await lookup(hostname, { all: true });
    } catch {
      throw new Error(`Could not resolve public DNS for ${hostname}.`);
    }
    if (!records || records.length === 0 || records.some((r) => isDisallowedIpAddress(r.address))) {
      throw new Error("Server URL resolves to a private or internal network address, which is not permitted.");
    }
  }
  return url;
}

/** Normalises and validates user input like "https://ff.example.com/api/v1/" to "https://ff.example.com". */
export function normaliseBaseUrl(input: string): string {
  return validatePublicFireflyUrl(input);
}
