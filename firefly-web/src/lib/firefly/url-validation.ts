export const PUBLIC_URL_ERROR =
  "Enter a valid public HTTPS domain (e.g. https://firefly.example.com). Internal hostnames, private IPs, and plain HTTP links are not permitted.";

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Checks whether an IPv4 or IPv6 literal belongs to loopback, private, link-local,
 * CGNAT/Tailscale (`100.64.0.0/10`), ULA (`fc00::/7`), multicast, or unspecified space.
 */
export function isDisallowedIpAddress(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!clean) return true;

  const v4 = clean.match(IPV4_REGEX);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    const c = Number(v4[3]);
    const d = Number(v4[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (Tailscale / CGNAT)
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  // IPv6 checks
  if (clean.includes(":")) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("::ffff:")) {
      const mapped = clean.slice(7);
      if (IPV4_REGEX.test(mapped)) {
        return isDisallowedIpAddress(mapped);
      }
      // Also check hex-encoded IPv4-mapped IPv6 e.g. ::ffff:7f00:1
      const hexParts = mapped.split(":");
      if (hexParts.length === 2) {
        const hi = Number.parseInt(hexParts[0], 16);
        const lo = Number.parseInt(hexParts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isDisallowedIpAddress(ipv4);
        }
      }
      return true;
    }
    const firstHextet = Number.parseInt(clean.split(":")[0] || "0", 16);
    if (!Number.isNaN(firstHextet)) {
      if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (incl. Tailscale fd7a::)
      if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
      if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    }
    return false;
  }

  return true;
}

const DISALLOWED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".localdomain",
  ".ts.net",
];

/**
 * Checks whether a hostname is an internal/single-label/IP-literal/localhost/private-suffix host
 * rather than a valid multi-label public domain name.
 */
export function isDisallowedHostname(hostname: string): boolean {
  const h = hostname.trim().replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.startsWith("localhost.")) return true;
  if (DISALLOWED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  if (IPV4_REGEX.test(h) || h.includes(":")) return true;
  const labels = h.split(".");
  if (labels.length < 2) return true;
  if (labels.some((label) => !label || label.length > 63)) return true;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/i.test(tld)) return true;
  return false;
}

/**
 * Normalizes and validates a user-supplied Firefly III base URL, enforcing public HTTPS domains only.
 */
export function validatePublicFireflyUrl(raw: string): string {
  let candidate = raw.trim().replace(/\/+$/, "");
  if (!candidate) {
    throw new Error(PUBLIC_URL_ERROR);
  }
  candidate = candidate.replace(/^(https?):\/?([^/])/i, "$1://$2");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  candidate = candidate.replace(/\/(profile(\/oauth)?|api(\/v1)?|login)\/?$/i, "").replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(PUBLIC_URL_ERROR);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(PUBLIC_URL_ERROR);
  }
  if (parsed.username || parsed.password) {
    throw new Error(PUBLIC_URL_ERROR);
  }
  if (isDisallowedHostname(parsed.hostname)) {
    throw new Error(PUBLIC_URL_ERROR);
  }

  const cleanPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${cleanPath}`;
}
